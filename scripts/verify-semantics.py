"""Prova que a fusao da familia --review-* nao moveu nenhum pixel.

Regra: para cada token novo em semantic.css, o valor resolvido tem de ser
IDENTICO ao valor que o token de origem tinha no index.css ANTES da
migration, nos DOIS temas. A fonte da verdade do "antes" e o HEAD do git
(os tokens antigos ja sairam do index.css e vivem em semantic.css).

    python scripts/verify-semantics.py
"""
import re
import os
import sys
import argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from token_baseline import git_show, BASELINE  # noqa: E402


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECL = re.compile(r'^\s*(--[a-z][a-z0-9-]*):\s*([^;]+);', re.M)


def head_index(path='src/index.css'):
    """index.css no baseline: os tokens antigos, antes de virarem
    semantic.css. Nao HEAD -- ver scripts/token-baseline.py."""
    return git_show(path)


def blocks(css):
    """{nome_escopo: {token: valor}} por bloco :root / :root[data-theme=...]."""
    out = {}
    for m in re.finditer(r'(:root(?:\[[^\]]*\])?)\s*\{', css):
        head = m.group(1)
        i = m.end()
        depth = 1
        j = i
        while j < len(css) and depth:
            if css[j] == '{':
                depth += 1
            elif css[j] == '}':
                depth -= 1
            j += 1
        out.setdefault(head, {})
        for t, v in DECL.findall(css[i:j]):
            out[head][t] = v.strip()
    return out


def resolve(value, table, seen=None):
    """Resolve var() aninhado contra um mapa de tokens.

    O lado "antes" (HEAD) e hex cru; o lado "depois" aponta para
    primitivas. Para comparar os dois, as primitivas precisam entrar no
    mesmo mapa -- caso contrario todo token novo parece divergir.
    """
    seen = seen or set()
    m = re.fullmatch(r'var\(\s*(--[a-z0-9-]+)\s*\)', value)
    if m and m.group(1) in table and m.group(1) not in seen:
        return resolve(table[m.group(1)], table, seen | {m.group(1)})
    return value


def primitives():
    """--mm-* -> hex, lido de src/styles/tokens/primitive.css."""
    p = os.path.join(ROOT, 'src/styles/tokens/primitive.css')
    out = {}
    for m in re.finditer(r'(--mm-[a-z]+-\d+(?:-\d+)?):\s*(#[0-9a-fA-F]{3,8})\s*;',
                         open(p, encoding='utf-8').read()):
        out[m.group(1)] = m.group(2).lower()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--index', default='src/index.css',
                    help='index.css no baseline (tokens antigos)')
    args = ap.parse_args()

    idx_src = head_index(args.index)
    if idx_src is None:
        print(f'FALHA: nao consegui ler HEAD:{args.index}')
        return 1
    sem_path = os.path.join(ROOT, 'src/styles/tokens/semantic.css')

    idx = blocks(idx_src)
    sem = blocks(open(sem_path, encoding='utf-8').read())
    prim = primitives()
    if not prim:
        print('FALHA: nenhuma primitiva em primitive.css')
        return 1
    # As primitivas entram nos dois mapas: o hex do "antes" e o var() do
    # "depois" precisam resolver para a mesma coisa.
    for sc in (':root', ":root[data-theme='dark']"):
        idx.setdefault(sc, {}).update(prim)
        sem.setdefault(sc, {}).update(prim)

    scopes = [':root', ":root[data-theme='dark']"]
    ORIGIN = {
        '--text-h': '--text-h', '--text': '--text', '--text-strong': '--review-ink',
        '--text-soft': '--review-ink-soft', '--text-normal': '--review-text',
        '--text-muted': '--review-muted', '--text-subtle': '--review-muted-2',
        '--faint': '--review-faint', '--bg': '--bg', '--hero-bg': '--hero-bg',
        '--panel': '--panel', '--surface': '--surface',
        '--surface-canvas': '--review-surface', '--surface-raised': '--review-raised',
        '--surface-sunk': '--review-sunk', '--surface-field': '--review-field',
        '--surface-header': '--review-header', '--border': '--border',
        '--border-strong': '--border-strong', '--line': '--review-line',
        '--line-soft': '--review-line-soft', '--line-strong': '--review-line-strong',
        '--accent': '--accent', '--accent-strong': '--accent-strong',
        '--accent-soft': '--review-accent-soft', '--button-bg': '--button-bg',
        '--button-text': '--button-text', '--button-secondary': '--button-secondary',
        '--code-bg': '--code-bg', '--panel-shadow': '--panel-shadow',
    }
    for st, ks in [('ok', ['ok', 'soft', 'bg', 'bg-strong', 'bg-soft']),
                   ('warn', ['warn', 'strong', 'bg', 'bg-soft']),
                   ('bad', ['bad', 'strong', 'bg', 'bg-soft']),
                   ('info', ['info', 'bg']),
                   ('alt', ['alt', 'bg', 'bg-soft', 'line'])]:
        for k in ks:
            # k ja vem sem o prefixo do status: 'soft', 'bg', 'bg-strong'...
            ORIGIN[f'--status-{st}-{k}' if k != st else f'--status-{st}'] = \
                f'--review-{st}' + ('' if k == st else '-' + k)

    checked = bad = 0
    problems = []
    for sc in scopes:
        old, new = idx.get(sc, {}), sem.get(sc, {})
        for tok, src in ORIGIN.items():
            if tok not in new:
                problems.append(f'{sc}: {tok} ausente em semantic.css')
                bad += 1
                continue
            a = resolve(old.get(src, '<AUSENTE>'), old)
            b = resolve(new[tok], new)
            checked += 1
            if a != b:
                bad += 1
                if len(problems) < 24:
                    problems.append(f'{sc}: {tok} = {b} mas {src} = {a}')

    # aliases de compatibilidade tambem tem de bater
    for sc in scopes:
        old, new = idx.get(sc, {}), sem.get(sc, {})
        for tok, val in new.items():
            if not tok.startswith('--review-'):
                continue
            checked += 1
            a = resolve(old.get(tok, '<AUSENTE>'), old)
            b = resolve(val, new)
            if a != b:
                bad += 1
                if len(problems) < 24:
                    problems.append(f'{sc}: alias {tok} -> {val} ({b}) != {a}')

    print(f'baseline: {BASELINE}')
    print(f'verificacoes: {checked}   divergencias: {bad}')
    for p in problems[:24]:
        print('  !', p)
    if bad:
        print('\nFALHOU: a fusao da familia --review-* mudou algum valor.')
        return 1
    print('OK: todo token novo e todo alias batem com o valor antigo, nos 2 temas.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
