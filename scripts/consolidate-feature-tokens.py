"""Consolida as familias de token de pagina dentro do proprio escopo.

Cada page do app mantem a sua familia de token escopada ao seletor dela
(.goals-page, .bases-page, .tag-management-page, .workspace-shell), com
bloco [data-theme='dark'] proprio. Este script NAO move nenhuma
declaracao para o :root -- a escopo e sacredo, porque mover mudaria onde
a cor se aplica (a tag deixaria de ser so da pagina de tags).

O que ele faz e trocar o VALOR: cada token local passa a apontar para o
token semantico equivalente, ou, quando o valor e genuinamente distinto,
ganha um slot nomeado na camada semantica. O alias antigo continua
declarado no mesmo lugar, com o mesmo valor de sempre.

    python scripts/consolidate-feature-tokens.py --dry-run
    python scripts/consolidate-feature-tokens.py
"""
import re
import os
import sys
import json
import argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# familia -> arquivo
SOURCES = {
    'goals': 'src/features/goals/goals.css',
    'bases': 'src/features/bases/bases.css',
    'tag': 'src/features/tags/tag-management.css',
    'workspace': 'src/features/shell/workspace-chrome.css',
    'selection': 'src/features/shell/workspace-chrome.css',
}

# Token local -> token semantico de destino, POR FAMILIA e POR TEMA.
# '__SAME__' = o destino ja carrega exatamente este valor nos dois temas.
# Um nome de slot = o valor e distinto; o slot entra na camada semantica.
DEST = {
    'goals': {
        'surface': '__SAME__',        # == --surface-canvas
        'field': '__SAME__',          # == --surface-field
        'ink': '__SAME__',            # == --text-strong
        'ink-soft': '__SAME__',       # == --text-soft
        'text': '__SAME__',           # == --text-normal
        'faint': '__SAME__',          # == --faint
        'muted': '__SAME__',          # == --text-muted
        'line': '__SAME__',           # == --line
        'line-soft': '__SAME__',      # == --line-soft
        'field-line': '__SAME__',     # == --line-strong
        'track': '__SAME__',          # == --surface-raised
        'sunk': '__SAME__',           # == --surface-sunk
        'done': '__SAME__',           # == --status-ok
        'success': '__SAME__',        # == --status-ok
        'on-accent': '__SAME__',      # == --text-inverse
    },
    'bases': {
        'surface': '__SAME__',        # == --surface-canvas
        'surface-raised': '__SAME__',  # == --surface-raised
        'header-bg': '__SAME__',      # == --surface-header
        'line': '__SAME__',           # == --line
        'line-soft': '__SAME__',      # == --line-soft
        'text': '__SAME__',           # == --text-normal
        'muted': '__SAME__',          # == --text-muted
        'accent': '__SAME__',         # == --status-ok
        'accent-soft': '__SAME__',    # == --status-ok-bg-soft
    },
    'tag': {
        'surface': '__TAG_SURFACE__',
        'border': '__TAG_BORDER__',
        'line': '__SAME__',           # == --line
        'ink': '__SAME__',            # == --text-strong
        'muted': '__SAME__',          # == --text-muted
        'accent': '__SAME__',         # == --status-ok
        'accent-soft': '__TAG_ACCENT_SOFT__',
        'danger': '__SAME__',         # == --status-bad
        'btn-ink': '__TAG_BTN_INK__',
        'btn-hover': '__TAG_BTN_HOVER__',
        'warn-bg': '__TAG_WARN_BG__',
        'warn-line': '__TAG_WARN_LINE__',
        'warn-ink': '__TAG_WARN_INK__',
        'warn-strong': '__TAG_WARN_STRONG__',
        'warn-soft': '__TAG_WARN_SOFT__',
    },
    'workspace': {
        'bg': '__WS_BG__', 'raised': '__WS_RAISED__', 'sidebar': '__WS_SIDEBAR__',
        'line': '__WS_LINE__', 'text': '__WS_TEXT__', 'muted': '__WS_MUTED__',
        'accent': '__WS_ACCENT__',
    },
    'selection': {
        'paper': '__SEL_PAPER__', 'raised': '__SEL_RAISED__', 'rail': '__SEL_RAIL__',
        'line': '__SEL_LINE__', 'ink': '__SEL_INK__', 'muted': '__SEL_MUTED__',
    },
}

# Nome do slot na camada semantica, quando o valor e distinto.
SLOT = {
    '__TAG_SURFACE__': '--tag-surface', '__TAG_BORDER__': '--tag-border',
    '__TAG_ACCENT_SOFT__': '--tag-accent-soft', '__TAG_BTN_INK__': '--tag-btn-ink',
    '__TAG_BTN_HOVER__': '--tag-btn-hover', '__TAG_WARN_BG__': '--tag-warn-bg',
    '__TAG_WARN_LINE__': '--tag-warn-line', '__TAG_WARN_INK__': '--tag-warn-ink',
    '__TAG_WARN_STRONG__': '--tag-warn-strong', '__TAG_WARN_SOFT__': '--tag-warn-soft',
    '__WS_BG__': '--workspace-bg', '__WS_RAISED__': '--workspace-raised',
    '__WS_SIDEBAR__': '--workspace-sidebar', '__WS_LINE__': '--workspace-line',
    '__WS_TEXT__': '--workspace-text', '__WS_MUTED__': '--workspace-muted',
    '__WS_ACCENT__': '--workspace-accent', '__SEL_PAPER__': '--selection-paper',
    '__SEL_RAISED__': '--selection-raised', '__SEL_RAIL__': '--selection-rail',
    '__SEL_LINE__': '--selection-line', '__SEL_INK__': '--selection-ink',
    '__SEL_MUTED__': '--selection-muted',
}

# O que cada '__SAME__' equivale a, para gerar o alias e checar o valor.
SAME_AS = {
    'goals': {'surface': '--surface-canvas', 'field': '--surface-field',
              'ink': '--text-strong', 'ink-soft': '--text-soft', 'text': '--text-normal',
              'faint': '--faint', 'muted': '--text-muted', 'line': '--line',
              'line-soft': '--line-soft', 'field-line': '--line-strong',
              'track': '--surface-raised', 'sunk': '--surface-sunk',
              'done': '--status-ok', 'success': '--status-ok',
              'on-accent': '--text-inverse'},
    'bases': {'surface': '--surface-canvas', 'surface-raised': '--surface-raised',
              'header-bg': '--surface-header', 'line': '--line',
              'line-soft': '--line-soft', 'text': '--text-normal',
              'muted': '--text-muted', 'accent': '--status-ok',
              'accent-soft': '--status-ok-bg-soft'},
    'tag': {'line': '--line', 'ink': '--text-strong', 'muted': '--text-muted',
            'accent': '--status-ok', 'danger': '--status-bad'},
}

DECL = re.compile(r'(--[a-z][a-z0-9-]+)\s*:\s*([^;]+);')
PRIM_RE = re.compile(r'(--mm-[a-z]+-\d+(?:-\d+)?):\s*(#[0-9a-fA-F]{3,8})\s*;')


def read(path):
    return open(os.path.join(ROOT, path), encoding='utf-8').read()


def apply_plan(per_file):
    """Aplica o plano: cada valor local vira var(--slot) no MESMO seletor.

    Nenhuma declaracao sai do seu escopo -- so o valor troca. Os slots
    com valor proprio entram na camada semantica (escopo global, porque
    sao cores compartilhadas entre paginas), preservando o valor exato
    de antes nos dois temas.
    """
    # 1) reescreve os valores dentro dos arquivos de feature
    for fam, (path, edits, nl, nd) in per_file.items():
        p = os.path.join(ROOT, path)
        raw = open(p, 'rb').read()
        text = raw.decode('utf-8')
        # cada edicao tem o span do bloco; reescreve de tras para frente
        for span, tok, target in sorted(edits, key=lambda e: -e[0][0]):
            s, e = span
            block = text[s:e]
            new_block = re.sub(
                r'(' + re.escape(tok) + r'\s*:\s*)[^;]+;',
                lambda m: m.group(1) + f'var({target});',
                block)
            text = text[:s] + new_block + text[e:]
        open(p, 'wb').write(text.encode('utf-8'))
        print(f'  {path}: {len(edits)} valores -> var()')

    # 2) slots com valor proprio: eles NAO entram no :root.
    #
    # A armadilha (e o motivo de verify-domain-tokens.py existir): um slot
    # de pagina promovido a :root vaza para fora da pagina E perde o
    # tema -- o bloco [data-theme='dark'] .goals-page resolveria
    # --goals-done contra o valor CLARO do :root. Por isso cada slot
    # declarado no CSS da feature mantem a SUA declaracao, com o valor
    # exato de antes, e so a familia que era 100% igual (alias) e
    # reescrita para var(--semantico).
    kept = []
    for fam, (path, edits, nl, nd) in per_file.items():
        for name, val in sorted(nl.items()):
            kept.append((path, name, val, 'claro'))
        for name, val in sorted(nd.items()):
            kept.append((path, name, val, 'escuro'))
    if not kept:
        print('  nenhum slot novo (tudo virou alias)')
        return
    for path, name, val, theme in kept:
        print(f'    {name:22s} {theme:6s} {val}   (mantido em {path.split("/")[-1]})')
    print(f'  {len(kept)} slots preservados no escopo de origem (nao promovidos a :root)')


def primitives():
    return {m.group(1): m.group(2).lower() for m in PRIM_RE.finditer(
        read('src/styles/tokens/primitive.css'))}


def split_scopes(css, fam):
    """Divide o arquivo em blocos (seletor, corpo) que definem --fam-*."""
    out = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css, re.S):
        if re.search(r'--' + fam + r'-[a-z0-9-]+\s*:', m.group(2)):
            sel = ' '.join(m.group(1).split())
            # descarta o comentario que precedes o seletor
            sel = re.sub(r'^/\*.*?\*/\s*', '', sel, flags=re.S).strip()
            out.append((sel, m.group(2), m.span()))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    prim = primitives()
    sem = read('src/styles/tokens/semantic.css')

    # tabela de resolucao: token semantico -> valor, nos dois temas
    def sem_table(theme):
        if theme == 'light':
            body = sem[:sem.find(":root[data-theme='dark']")]
        else:
            body = sem[sem.find(":root[data-theme='dark']"):]
        t = dict(DECL.findall(body))
        t.update(prim)
        return t

    LIGHT, DARK = sem_table('light'), sem_table('dark')

    def resolve(v, table, d=0):
        if d > 8:
            return v
        m = re.fullmatch(r'var\(\s*(--[a-z0-9-]+)\s*\)', v)
        if m and m.group(1) in table:
            return resolve(table[m.group(1)], table, d + 1)
        return v

    total_alias = total_slot = 0
    per_file = {}

    for fam, path in SOURCES.items():
        css = read(path)
        scopes = split_scopes(css, fam)
        if not scopes:
            continue
        # tema de cada bloco, por seletor
        new_slots_light, new_slots_dark = {}, {}
        edits = []
        for sel, body, span in scopes:
            is_dark = "data-theme='dark'" in sel or 'data-theme="dark"' in sel
            table = DARK if is_dark else LIGHT
            for tok, val in DECL.findall(body):
                if not tok.startswith(f'--{fam}-'):
                    continue
                slot = tok[len(f'--{fam}-'):]
                dest = DEST[fam].get(slot)
                if dest is None:
                    continue
                if dest == '__SAME__':
                    target = SAME_AS[fam][slot]
                    # confere que o valor e realmente o mesmo
                    got = resolve(val, table)
                    want = resolve(table.get(target, '\x00'), table)
                    if got != want:
                        print(f'  DIVERGE {tok} ({sel[:40]}): {got} != {target}={want}')
                        continue
                    edits.append((span, tok, target))
                    total_alias += 1
                else:
                    name = SLOT[dest]
                    val_final = f'var({name})'
                    if is_dark:
                        new_slots_dark[name] = val
                    else:
                        new_slots_light[name] = val
                    edits.append((span, tok, name))
                    total_slot += 1
        per_file[fam] = (path, edits, new_slots_light, new_slots_dark)

    print(f'alias para token semantico: {total_alias}')
    print(f'slots com valor proprio:     {total_slot}')
    for fam, (path, edits, nl, nd) in per_file.items():
        print(f'  {fam:10s} {len(edits):2d} trocas em {path.split("/")[-1]}'
              f'  (+{len(nl)} slots light, +{len(nd)} dark)')

    if args.dry_run:
        json.dump({k: [[[s, t, n] for s, t, n in v[1]], v[2], v[3]]
                   for k, v in per_file.items()},
                  open(os.path.join(ROOT, 'scripts/.token-plan.json'), 'w'),
                  indent=1)
        print('\nplano: scripts/.token-plan.json (revisar antes de aplicar)')
        return 0
    json.dump({k: [[[s, t, n] for s, t, n in v[1]], v[2], v[3]]
               for k, v in per_file.items()},
              open(os.path.join(ROOT, 'scripts/.token-plan.json'), 'w'),
              indent=1)
    apply_plan(per_file)
    return 0


if __name__ == '__main__':
    sys.exit(main())
