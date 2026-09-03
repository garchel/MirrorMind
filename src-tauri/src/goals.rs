//! Metas de aprendizado (Goals): o usuário define um objetivo ou cola um texto
//! com diversos conteúdos e o app gera um card com a meta + propostas de notas
//! ordenadas por lógica de aprendizado.
//!
//! Armazenamento: `.mirmind/goals/<id>.json` (dentro do Vault, junto com o
//! restante dos dados locais — destruído junto com o Vault, nunca pelo
//! instalador). Escrita atômica (temp + rename), validação de `id`/caminhos e
//! limites explícitos. A geração do plano tenta IA (mesmo gate de
//! consentimento da revisão) e cai para segmentação determinística offline.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::review::ipc::{provider_for_selection, reserve_ai_call, AiProviderSelection};
use crate::review::provider::ProviderRequest;

const METADATA_DIR: &str = ".mirmind";
const GOALS_DIR: &str = "goals";
const MAX_GOALS: usize = 200;
const MAX_STEPS: usize = 30;
const MAX_TITLE_LEN: usize = 200;
const MAX_OBJECTIVE_LEN: usize = 4_000;
const MAX_SOURCE_LEN: usize = 100_000;
const MAX_SUMMARY_LEN: usize = 1_000;
const MAX_GOAL_FILE_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStepStatus {
    Planned,
    InProgress,
    Done,
}

impl Default for GoalStepStatus {
    fn default() -> Self {
        Self::Planned
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalStep {
    pub order: u32,
    pub title: String,
    pub summary: String,
    pub suggested_relative_path: String,
    #[serde(default)]
    pub status: GoalStepStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub title: String,
    pub objective: String,
    #[serde(default)]
    pub source_text: String,
    pub created_at_unix_ms: u64,
    pub steps: Vec<GoalStep>,
    /// `true` quando o plano veio da IA; `false` = segmentação determinística local.
    #[serde(default)]
    pub ai_generated: bool,
}

fn now_unix_ms() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .context("Relogio do sistema indisponivel.")
}

fn goals_directory(vault_root: &Path) -> Result<PathBuf> {
    let canonical = crate::canonicalize_directory(vault_root)?;
    Ok(canonical.join(METADATA_DIR).join(GOALS_DIR))
}

fn ensure_goals_directory(vault_root: &Path) -> Result<PathBuf> {
    let dir = goals_directory(vault_root)?;
    fs::create_dir_all(&dir)
        .with_context(|| format!("Nao foi possivel criar '{}'.", dir.display()))?;
    Ok(dir)
}

pub(crate) fn validate_goal_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        bail!("O identificador da meta e invalido.");
    }
    Ok(())
}

/// Validação sintática de caminho relativo `.md` (sem tocar no disco):
/// relativo, sem `..`, sem `.mirmind`, termina em `.md`.
fn validate_relative_note_path(value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 512 {
        bail!("O caminho da nota e invalido.");
    }
    let candidate = Path::new(trimmed);
    if candidate.is_absolute() || candidate.has_root() {
        bail!("A nota precisa usar um caminho relativo ao vault.");
    }
    if candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        bail!("Nao e permitido navegar para fora do vault.");
    }
    let mut has_normal = false;
    for component in candidate.components() {
        match component {
            std::path::Component::Normal(segment) => {
                has_normal = true;
                let name = segment
                    .to_str()
                    .ok_or_else(|| anyhow::anyhow!("O caminho possui caracteres invalidos."))?;
                if name.is_empty() || name.len() > 128 {
                    bail!("O caminho da nota e invalido.");
                }
                if name.eq_ignore_ascii_case(METADATA_DIR) {
                    bail!("A pasta .mirmind e reservada para metadados do app.");
                }
            }
            std::path::Component::CurDir => {}
            _ => bail!("O caminho precisa ser relativo e permanecer dentro do vault."),
        }
    }
    if !has_normal {
        bail!("O caminho da nota e invalido.");
    }
    if !trimmed.to_ascii_lowercase().ends_with(".md") {
        bail!("A nota precisa terminar em .md.");
    }
    Ok(())
}

fn validate_goal(goal: &Goal) -> Result<()> {
    validate_goal_id(&goal.id)?;
    let title = goal.title.trim();
    if title.is_empty() || title.len() > MAX_TITLE_LEN {
        bail!("O titulo da meta e invalido (1-200 caracteres).");
    }
    if goal.objective.trim().is_empty() || goal.objective.len() > MAX_OBJECTIVE_LEN {
        bail!("O objetivo da meta e invalido (1-4000 caracteres).");
    }
    if goal.source_text.len() > MAX_SOURCE_LEN {
        bail!("O texto de origem excede o limite de 100 mil caracteres.");
    }
    if goal.steps.is_empty() || goal.steps.len() > MAX_STEPS {
        bail!("A meta precisa de 1 a 30 passos.");
    }
    let mut expected_order = 1u32;
    for step in &goal.steps {
        if step.order != expected_order {
            bail!("Os passos da meta precisam de ordem sequencial a partir de 1.");
        }
        expected_order += 1;
        if step.title.trim().is_empty() || step.title.len() > MAX_TITLE_LEN {
            bail!("Um passo possui titulo invalido.");
        }
        if step.summary.len() > MAX_SUMMARY_LEN {
            bail!("Um passo possui resumo longo demais.");
        }
        validate_relative_note_path(&step.suggested_relative_path)
            .context("Um passo possui caminho de nota invalido.")?;
        if let Some(note) = &step.note_relative_path {
            if !note.trim().is_empty() {
                validate_relative_note_path(note).context("Um passo referencia nota invalida.")?;
            }
        }
    }
    Ok(())
}

fn goal_path(directory: &Path, id: &str) -> PathBuf {
    directory.join(format!("{id}.json"))
}

fn write_atomic_json(path: &Path, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 > MAX_GOAL_FILE_BYTES {
        bail!("A meta excede o limite de 256 KB.");
    }
    let stage = path.with_extension(format!(
        "json.stage-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&stage)?;
    let result = (|| -> Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&stage, path)?;
        Ok(())
    })();
    if result.is_err() && stage.exists() {
        let _ = fs::remove_file(&stage);
    }
    result
}

fn read_goal_file(path: &Path) -> Result<Goal> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        bail!("A meta nao e um arquivo regular.");
    }
    if metadata.len() > MAX_GOAL_FILE_BYTES {
        bail!("A meta excede o limite suportado.");
    }
    let bytes = fs::read(path)?;
    let goal: Goal = serde_json::from_slice(&bytes).context("A meta esta corrompida.")?;
    validate_goal(&goal)?;
    Ok(goal)
}

/// Slug seguro para pasta/arquivo: minúsculas, acentos removidos de forma
/// simples, resto vira `-`, colapsado, máx 48 chars.
fn slugify(input: &str) -> String {
    let lowered = input.to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut last_dash = false;
    for ch in lowered.chars() {
        let mapped = match ch {
            'á' | 'à' | 'ã' | 'â' | 'ä' => Some('a'),
            'é' | 'è' | 'ê' | 'ë' => Some('e'),
            'í' | 'ì' | 'î' | 'ï' => Some('i'),
            'ó' | 'ò' | 'õ' | 'ô' | 'ö' => Some('o'),
            'ú' | 'ù' | 'û' | 'ü' => Some('u'),
            'ç' => Some('c'),
            'ñ' => Some('n'),
            c if c.is_ascii_alphanumeric() => Some(c),
            _ => None,
        };
        match mapped {
            Some(c) => {
                out.push(c);
                last_dash = false;
            }
            None => {
                if !last_dash && !out.is_empty() {
                    out.push('-');
                    last_dash = true;
                }
            }
        }
        if out.len() >= 48 {
            break;
        }
    }
    let slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        "meta".to_string()
    } else {
        slug
    }
}

fn suggested_path(goal_slug: &str, order: u32, step_title: &str) -> String {
    format!(
        "Metas/{}/{:02}-{}.md",
        goal_slug,
        order,
        slugify(step_title)
    )
}

fn section_summary(lines: &[&str]) -> String {
    let mut text = lines
        .iter()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect::<Vec<_>>()
        .join(" ");
    if text.len() > 280 {
        // Corta em limite de palavra.
        let mut end = 280;
        while end > 0 && !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        if let Some(space) = text.rfind(' ') {
            text.truncate(space);
        }
        text.push('…');
    }
    text
}

/// Segmentação determinística (offline): headings viram passos em ordem;
/// sem headings, fatia o texto em blocos; sem texto, roteiro pedagógico genérico.
pub(crate) fn deterministic_plan(
    title: &str,
    objective: &str,
    source_text: &str,
) -> Vec<(String, String)> {
    let source = source_text.trim();
    if source.is_empty() {
        let o = objective.trim();
        let short = if o.len() > 120 {
            format!(
                "{}…",
                &o[..o.char_indices().nth(110).map(|(i, _)| i).unwrap_or(o.len())]
            )
        } else {
            o.to_string()
        };
        return vec![
            (
                "Fundamentos".to_string(),
                format!("Base mínima para começar: vocabulário e ideias centrais de {short}."),
            ),
            (
                "Conceitos centrais".to_string(),
                format!("Os 3–5 conceitos que sustentam {short}, com exemplos simples."),
            ),
            (
                "Prática guiada".to_string(),
                format!("Exercícios curtos aplicando {short} com gabarito."),
            ),
            (
                "Aprofundamento".to_string(),
                format!(
                    "Casos-limite, erros comuns e conexões com o que você já sabe sobre {short}."
                ),
            ),
            (
                "Revisão e aplicação".to_string(),
                format!("Resumo final + autoavaliação: explique {short} sem consultar."),
            ),
        ];
    }
    // Headings markdown?
    let lines: Vec<&str> = source.lines().collect();
    let mut headings: Vec<(usize, String)> = Vec::new();
    for (idx, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.starts_with('#') {
            let title = t.trim_start_matches('#').trim();
            if !title.is_empty() && title.len() <= MAX_TITLE_LEN {
                headings.push((idx, title.to_string()));
            }
        }
        if headings.len() >= 12 {
            break;
        }
    }
    if headings.len() >= 2 {
        let mut steps = Vec::new();
        for (i, (line_idx, heading)) in headings.iter().enumerate() {
            let end = headings
                .get(i + 1)
                .map(|(idx, _)| *idx)
                .unwrap_or(lines.len());
            let body = &lines[line_idx + 1..end];
            steps.push((heading.clone(), section_summary(body)));
            if steps.len() >= 12 {
                break;
            }
        }
        return steps;
    }
    // Sem headings: fatia por parágrafos em blocos de ~600 chars, máx 8.
    let paragraphs: Vec<&str> = source
        .split("\n\n")
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    let mut steps: Vec<(String, String)> = Vec::new();
    let mut current = String::new();
    for para in paragraphs {
        if current.len() + para.len() > 600 && !current.is_empty() {
            let preview: String = current
                .split_whitespace()
                .take(6)
                .collect::<Vec<_>>()
                .join(" ");
            steps.push((
                format!("Parte {}: {}", steps.len() + 1, preview),
                current.clone(),
            ));
            current.clear();
            if steps.len() >= 8 {
                break;
            }
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(para);
    }
    if !current.is_empty() && steps.len() < 8 {
        let preview: String = current
            .split_whitespace()
            .take(6)
            .collect::<Vec<_>>()
            .join(" ");
        steps.push((format!("Parte {}: {}", steps.len() + 1, preview), current));
    }
    if steps.is_empty() {
        // Texto curto de um parágrafo só.
        let preview: String = source
            .split_whitespace()
            .take(8)
            .collect::<Vec<_>>()
            .join(" ");
        steps.push((format!("Estudar: {preview}"), section_summary(&[source])));
    }
    // Título da meta como contexto no primeiro resumo? Não — mantém ordem lógica do texto.
    let _ = title;
    steps
}

fn goal_plan_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "minItems": 1,
                "maxItems": 12,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "minLength": 1, "maxLength": 120 },
                        "summary": { "type": "string", "minLength": 1, "maxLength": 500 }
                    },
                    "required": ["title", "summary"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["steps"],
        "additionalProperties": false
    })
}

/// Tenta gerar o plano via IA; qualquer falha → `None` (chamador usa fallback).
fn try_ai_plan(
    vault_root: &Path,
    provider_selection: AiProviderSelection,
    title: &str,
    objective: &str,
    source_text: &str,
) -> Option<Vec<(String, String)>> {
    let provider = provider_for_selection(provider_selection).ok()?;
    let source_markdown = if source_text.trim().is_empty() {
        format!("# {title}\n\nObjetivo: {objective}")
    } else {
        let mut capped = source_text.trim().to_string();
        if capped.len() > 12_000 {
            let mut end = 12_000;
            while end > 0 && !capped.is_char_boundary(end) {
                end -= 1;
            }
            capped.truncate(end);
        }
        format!("# {title}\n\nObjetivo: {objective}\n\n---\n\n{capped}")
    };
    let input_chars = source_markdown.len() + 800;
    if reserve_ai_call(vault_root, provider.as_ref(), input_chars).is_err() {
        return None;
    }
    let request = ProviderRequest {
        system_instructions: "Você é um planejador de estudos. Receberá um objetivo e opcionalmente um texto com vários conteúdos. Devolva de 3 a 10 passos em ORDEM LÓGICA DE APRENDIZADO (do básico ao avançado/prático), cada um com 'title' curto (máx 80 caracteres) e 'summary' de 1-2 frases dizendo o que estudar e por quê nessa posição. Responda SOMENTE com o JSON solicitado.".to_string(),
        source_markdown,
        user_content: format!("Meta: {title}. Gere o plano em ordem lógica."),
        response_schema: goal_plan_schema(),
    };
    let response = provider.generate_structured(request).ok()?;
    let steps = response.structured.get("steps")?.as_array()?;
    if steps.is_empty() || steps.len() > 12 {
        return None;
    }
    let mut out = Vec::with_capacity(steps.len());
    for step in steps {
        let t = step.get("title")?.as_str()?.trim();
        let s = step.get("summary")?.as_str()?.trim();
        if t.is_empty() || t.len() > 120 || s.is_empty() || s.len() > 500 {
            return None;
        }
        out.push((t.to_string(), s.to_string()));
    }
    if out.is_empty() {
        return None;
    }
    Some(out)
}

fn build_goal_from_steps(
    title: &str,
    objective: &str,
    source_text: &str,
    planned: Vec<(String, String)>,
    ai_generated: bool,
) -> Result<Goal> {
    if planned.is_empty() || planned.len() > MAX_STEPS {
        bail!("O plano precisa de 1 a 30 passos.");
    }
    let id = format!(
        "{}-{}",
        now_unix_ms()?,
        slugify(title).chars().take(12).collect::<String>()
    );
    let id = id.chars().take(64).collect::<String>().replace(
        |c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        "-",
    );
    let goal_slug = slugify(title);
    let steps = planned
        .into_iter()
        .enumerate()
        .map(|(idx, (step_title, summary))| {
            let order = (idx + 1) as u32;
            GoalStep {
                order,
                suggested_relative_path: suggested_path(&goal_slug, order, &step_title),
                title: step_title,
                summary,
                status: GoalStepStatus::Planned,
                note_relative_path: None,
            }
        })
        .collect::<Vec<_>>();
    let goal = Goal {
        id,
        title: title.to_string(),
        objective: objective.to_string(),
        source_text: source_text.to_string(),
        created_at_unix_ms: now_unix_ms()?,
        steps,
        ai_generated,
    };
    validate_goal(&goal)?;
    Ok(goal)
}

fn persist_goal(vault_root: &Path, goal: &Goal) -> Result<()> {
    validate_goal(goal)?;
    let dir = ensure_goals_directory(vault_root)?;
    let path = goal_path(&dir, &goal.id);
    if path.exists() {
        bail!("A meta ja existe.");
    }
    let bytes = serde_json::to_vec_pretty(goal)?;
    write_atomic_json(&path, &bytes)
}

pub fn list_goals(vault_root: &Path) -> Result<Vec<Goal>> {
    let dir = goals_directory(vault_root)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut goals = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let file_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if validate_goal_id(&file_name).is_err() {
            continue;
        }
        match read_goal_file(&path) {
            Ok(goal) => goals.push(goal),
            Err(_) => continue,
        }
        if goals.len() > MAX_GOALS {
            bail!("O Vault excede o limite de 200 metas.");
        }
    }
    goals.sort_by(|a, b| b.created_at_unix_ms.cmp(&a.created_at_unix_ms));
    Ok(goals)
}

pub fn load_goal(vault_root: &Path, id: &str) -> Result<Option<Goal>> {
    validate_goal_id(id)?;
    let dir = goals_directory(vault_root)?;
    let path = goal_path(&dir, id);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(read_goal_file(&path)?))
}

pub fn delete_goal(vault_root: &Path, id: &str) -> Result<()> {
    validate_goal_id(id)?;
    let dir = goals_directory(vault_root)?;
    let path = goal_path(&dir, id);
    if !path.exists() {
        bail!("A meta nao existe.");
    }
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        bail!("A meta nao e um arquivo regular.");
    }
    fs::remove_file(&path)?;
    Ok(())
}

pub fn update_goal_step(
    vault_root: &Path,
    id: &str,
    order: u32,
    status: Option<GoalStepStatus>,
    note_relative_path: Option<Option<String>>,
) -> Result<Goal> {
    let mut goal =
        load_goal(vault_root, id)?.ok_or_else(|| anyhow::anyhow!("A meta nao existe."))?;
    let step = goal
        .steps
        .iter_mut()
        .find(|s| s.order == order)
        .ok_or_else(|| anyhow::anyhow!("O passo nao existe."))?;
    if let Some(status) = status {
        step.status = status;
    }
    if let Some(note) = note_relative_path {
        match note {
            Some(path) if !path.trim().is_empty() => {
                let trimmed = path.trim().to_string();
                crate::resolve_note_path(&PathBuf::from("/tmp/__goals_validate__"), &trimmed)
                    .map_err(|_| anyhow::anyhow!("A nota vinculada e invalida."))?;
                step.note_relative_path = Some(trimmed);
            }
            _ => step.note_relative_path = None,
        }
    }
    validate_goal(&goal)?;
    let dir = ensure_goals_directory(vault_root)?;
    let path = goal_path(&dir, &goal.id);
    let bytes = serde_json::to_vec_pretty(&goal)?;
    // Reescrita: remove + escreve atomicamente (o id já existe).
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        bail!("A meta nao e um arquivo regular.");
    }
    fs::remove_file(&path)?;
    write_atomic_json(&path, &bytes)?;
    Ok(goal)
}

// ── Comandos Tauri ──────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn list_goals_command(
    path: String,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<Vec<Goal>, String> {
    let root = crate::canonicalize_directory(Path::new(&path)).map_err(|e| e.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|e| e.to_string())?;
    list_goals(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn create_goal_command(
    path: String,
    title: String,
    objective: String,
    source_text: String,
    provider: Option<AiProviderSelection>,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<Goal, String> {
    let root = crate::canonicalize_directory(Path::new(&path)).map_err(|e| e.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|e| e.to_string())?;
    // Geração com IA é bloqueada no backend sem consentimento (mesmo gate da
    // revisão); sem provider ou com falha, cai para o plano determinístico.
    let planned: Vec<(String, String)> = match provider {
        Some(selection) => {
            match try_ai_plan_with_flag(
                &root,
                selection,
                title.trim(),
                objective.trim(),
                &source_text,
            ) {
                Some((steps, ai)) => {
                    return finalize_create(&root, &title, &objective, &source_text, steps, ai)
                        .map_err(|e| e.to_string());
                }
                None => deterministic_plan(title.trim(), objective.trim(), &source_text),
            }
        }
        None => deterministic_plan(title.trim(), objective.trim(), &source_text),
    };
    finalize_create(&root, &title, &objective, &source_text, planned, false)
        .map_err(|e| e.to_string())
}

fn try_ai_plan_with_flag(
    root: &Path,
    selection: AiProviderSelection,
    title: &str,
    objective: &str,
    source_text: &str,
) -> Option<(Vec<(String, String)>, bool)> {
    try_ai_plan(root, selection, title, objective, source_text).map(|steps| (steps, true))
}

fn finalize_create(
    root: &Path,
    title: &str,
    objective: &str,
    source_text: &str,
    planned: Vec<(String, String)>,
    ai_generated: bool,
) -> Result<Goal> {
    let goal = build_goal_from_steps(
        title.trim(),
        objective.trim(),
        source_text,
        planned,
        ai_generated,
    )?;
    persist_goal(root, &goal)?;
    Ok(goal)
}

#[tauri::command]
pub(crate) fn get_goal_command(
    path: String,
    id: String,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<Option<Goal>, String> {
    let root = crate::canonicalize_directory(Path::new(&path)).map_err(|e| e.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|e| e.to_string())?;
    load_goal(&root, id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn delete_goal_command(
    path: String,
    id: String,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<(), String> {
    let root = crate::canonicalize_directory(Path::new(&path)).map_err(|e| e.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|e| e.to_string())?;
    delete_goal(&root, id.trim()).map_err(|e| e.to_string())
}

/// `note_relative_path`: `None` = não altera; `Some(None)` = desvincula;
/// `Some(Some(path))` = vincula.
#[tauri::command]
pub(crate) fn update_goal_step_command(
    path: String,
    id: String,
    order: u32,
    status: Option<GoalStepStatus>,
    note_relative_path: Option<Option<String>>,
    authorized_paths: tauri::State<'_, crate::AuthorizedPaths>,
) -> Result<Goal, String> {
    let root = crate::canonicalize_directory(Path::new(&path)).map_err(|e| e.to_string())?;
    authorized_paths
        .ensure_authorized_vault_root(&root)
        .map_err(|e| e.to_string())?;
    // Se uma nota foi vinculada, ela precisa existir de verdade no Vault.
    if let Some(Some(note)) = &note_relative_path {
        if !note.trim().is_empty() {
            let note_path =
                crate::resolve_note_path(&root, note.trim()).map_err(|e| e.to_string())?;
            if !note_path.exists() {
                return Err("A nota vinculada nao existe.".to_string());
            }
        }
    }
    update_goal_step(&root, id.trim(), order, status, note_relative_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_become_ordered_steps() {
        let plan = deterministic_plan(
            "Fotossíntese",
            "Entender fotossíntese",
            "# Luz\nA luz é capturada.\n\n# Clorofila\nPigmento verde.\n\n# Glicose\nProduto final.",
        );
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].0, "Luz");
        assert_eq!(plan[1].0, "Clorofila");
        assert_eq!(plan[2].0, "Glicose");
    }

    #[test]
    fn empty_source_generates_pedagogical_order() {
        let plan = deterministic_plan("Inglês", "Aprender inglês básico", "");
        assert_eq!(plan.len(), 5);
        assert_eq!(plan[0].0, "Fundamentos");
        assert!(plan[4].0.contains("Revisão"));
    }

    #[test]
    fn rejects_invalid_goal_ids() {
        assert!(validate_goal_id("../evil").is_err());
        assert!(validate_goal_id("").is_err());
        assert!(validate_goal_id("ok-123_abc").is_ok());
    }

    #[test]
    fn build_goal_suggests_safe_note_paths() {
        let goal = build_goal_from_steps(
            "Violão",
            "Tocar violão",
            "",
            vec![("Acordes básicos".to_string(), "Dedilhados.".to_string())],
            false,
        )
        .expect("build goal");
        assert_eq!(goal.steps.len(), 1);
        assert_eq!(goal.steps[0].order, 1);
        assert!(goal.steps[0]
            .suggested_relative_path
            .starts_with("Metas/violao/01-"));
        assert!(goal.steps[0].suggested_relative_path.ends_with(".md"));
    }

    #[test]
    fn build_goal_without_ai_never_calls_network() {
        let planned = deterministic_plan("X", "Aprender X", "");
        let goal = build_goal_from_steps("X", "Aprender X", "", planned, false)
            .expect("deterministic build");
        assert!(!goal.ai_generated);
        assert!(!goal.steps.is_empty());
    }
}
