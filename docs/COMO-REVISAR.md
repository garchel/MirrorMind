# Como revisar o golden set e fechar o gate do JEV

Este é o roteiro do que falta para a decisão do §11 (pode o motor calibrado
substituir o legado?) sair de "palpite" e virar "medido".

São três passos. O meio precisa de **você** (ou de um modelo que não seja o
JEV), os outros dois são comandos.

---

## Passo 1 — gerar o pacote

```powershell
cd C:\Users\paulo\OneDrive\Documentos\MirrorMind
node scripts/golden-readiness-review.mjs
```

Saída: `docs/golden-readiness-review.md`, com **23 notas**.

---

## Passo 2 — mandar para outro modelo

Abra `docs/golden-readiness-review.md`, copie **o arquivo inteiro** e cole na
primeira mensagem de um chat com o modelo de sua preferência.

**Qual modelo:** um **diferente** do JEV (TypeSafe). Se você usar a TypeSafe
para revisar, a medição vira tautologia — o revisor e o motor medido seriam o
mesmo. Um Gemini, um GPT, um Claude local — qualquer um que não seja a
TypeSafe serve.

**O prompt está no próprio arquivo.** Ele já explica a rubrica, exige a
evidência contra o rótulo proposto e avisa que `ambiguous` e `insufficient` são
respostas tão válidas quanto `ready`. Você não precisa escrever prompt nenhum:
o arquivo é a instrução.

Se preferir um prompt separado, este é o mesmo:

> Você vai revisar 23 notas de um conjunto de testes. Para cada uma, leia a nota
> e julgue se o rótulo de prontidão proposto está certo, segundo a rubrica do
> arquivo. **Antes de responder, procure a evidência CONTRA o rótulo** — e se
> não houver, escreva isso. As respostas `ambiguous` e `insufficient` são tão
> válidas quanto `ready`. Cite a frase da nota que sustenta a sua leitura.
> Responda apenas com o JSON de cada bloco, sem texto em volta.

**Se o modelo responder com texto antes do JSON**, tudo bem: o importador
aceita um array com os blocos no meio, desde que o JSON esteja lá. Se ele
embrulhar tudo num bloco de código, salve o conteúdo **sem** as linhas de
``` ``` **.

### Salvar a resposta

Salve como `respostas-readiness.json` em `scripts/`
(`C:\Users\paulo\OneDrive\Documentos\MirrorMind\scripts\`).

UTF-8, **sem BOM**. (O importador remove a BOM sozinho, mas o editor às vezes
insiste em salvá-la.)

---

## Passo 3 — importar

```powershell
node scripts/golden-readiness-import.mjs scripts/respostas-readiness.json
node scripts/apply-golden-review.mjs
```

O primeiro diz quantos foram aplicados e quantos o revisor **discordou** do
rótulo proposto. O segundo recalcula as bandas de síntese (que não mudam — são
outra revisão).

---

## Passo 4 — medir e marcar o seu Vault

```powershell
cd src-tauri
$env:MIRRORMIND_JEV_EVAL="1"
$env:MIRRORMIND_JEV_EVAL_VAULT="C:\Users\paulo\Documents\SeuVault"
cargo test --test jev_eval -- --ignored --nocapture
```

**O `MIRRORMIND_JEV_EVAL_VAULT` é o seu Vault de verdade** — é lá que a
`calibration_validated` vai ser gravada, e é o Vault que o app lê.

**Pré-requisitos:**
- a chave da TypeSafe no cofre nativo (você já salvou pelo painel)
- o consentimento concedido (você já marcou)
- **Ollama rodando** — a medição compara com o legado, e o legado é local

Custa pouco: ~US$ 0,0003 e ~12 minutos por rodada (o Ollama é o lento).

### O que sai

O relatório vai para `docs/jev-eval-report.md` (legível) e
`docs/jev-eval-report.json` (bruto). No terminal, o `veredito` sai direto.

E no seu Vault, `.mirmind/review-calibration.json` passa a ter
`"calibrationValidated": true` — **se e somente se** os dois critérios
passarem: o gate do ECE e a revisão dos rótulos. Se o ECE reprovar, a flag
continua `false` e a UI continua avisando que o número não foi validado.

---

## Se algo der errado

| sintoma | o que é |
|---|---|
| `nao consegui ler ... como JSON` | o arquivo tem BOM ou tem texto antes do JSON |
| `Nao foi possivel ler ...` | o modelo não devolveu JSON no formato pedido |
| `caso 'x': rotulo invalido` | o modelo devolveu um rótulo fora de `ready`/`ambiguous`/`insufficient` |
| `caso 'x': "agreed" e false, mas o rotulo e o mesmo` | o revisor discordou mas não reclassificou — mande de volta pedindo o rótulo certo |
| `faltou core, connections, application, gaps` | é a revisão das **sínteses**, não dos rótulos — use o outro importador |

**Reverter tudo:**
```powershell
git checkout -- src-tauri/tests/fixtures/jev-golden/golden.json
```

---

## O que eu já fiz, para você não ter que refazer

- As **19 sínteses** já estão revisadas e ancoradas nas notas (`provenance: human`).
- A nota `divisibilidade.md` foi renomeada para `contradicao-fotossintese.md`
  (o título não batia com o conteúdo — era copy-paste do F1).
- As duas notas que estavam com conteúdo trocado foram consertadas.
