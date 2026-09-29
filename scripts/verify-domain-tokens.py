"""Prova que a consolidacao das familias de pagina nao moveu pixel.

Para cada token de escopo local (--goals-*, --bases-*, --tag-*,
--workspace-*, --selection-*), compara o valor resolvido de ANTES (HEAD,
dentro do seletor de pagina) com o de DEPOIS (o mesmo token local, que
agora aponta para um slot da camada semantica).

    python scripts/verify-domain-tokens.py
"""
import re
import os
import sys
import argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from token_baseline import git_show, BASELINE  # noqa: E402


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = {
    'goals': 'src/features/goals/goals.css',
    'bases': 'src/features/bases/bases.css',
    'tag': 'src/features/tags/tag-management.css',
    'workspace': 'src/features/shell/workspace-chrome.css',
    'selection': 'src/features/shell/workspace-chrome.css',
}
DECL = re.compile(r'(--[a-z][a-z0-9-]+)\s*:\s*([^;]+);')
PRIM_RE = re.compile(r'(--mm-[a-z]+-\d+(?:-\d+)?):\s*(#[0-9a-fA-F]{3,8})\s*;')


def read(path, head=False):
    """head=True le no baseline (estado com hex), nao em HEAD."""
    if head:
        return git_show(path)
    return open(os.path.join(ROOT, path), encoding='utf-8').read()


def primitives():
    return {m.group(1): m.group(2).lower()
            for m in PRIM_RE.finditer(read('src/styles/tokens/primitive.css'))}


def scopes_with(css, fam):
    """{seletor_normalizado: {token: valor}} dos blocos que definem --fam-*."""
    out = {}
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css, re.S):
        if re.search(r'--' + fam + r'-[a-z0-9-]+\s*:', m.group(2)):
            sel = re.sub(r'^/\*.*?\*/\s*', '', ' '.join(m.group(1).split()), flags=re.S)
            out[sel] = dict(DECL.findall(m.group(2)))
    return out


def resolve(v, table, d=0):
    if d > 10:
        return norm(v)
    m = re.fullmatch(r'var\(\s*(--[a-z0-9-]+)\s*\)', v)
    if m and m.group(1) in table:
        return resolve(table[m.group(1)], table, d + 1)
    return norm(v)


def norm(v):
    """Normaliza para comparar: #fff == #ffffff, rgb() com espacos."""
    v = v.strip().lower()
    v = re.sub(r'\s+', '', v)
    if re.fullmatch(r'#([0-9a-f]{3})', v):
        v = '#' + ''.join(c * 2 for c in v[1:])
    if re.fullmatch(r'#([0-9a-f]{6})', v):
        v = _hex_to_rgb(v)
    if v.startswith('rgb('):
        v = _hex_to_rgb('#' + ''.join(
            f'{int(x):02x}' for x in re.findall(r'[\d.]+', v)[:3]))
    return v


def _hex_to_rgb(h):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return f'rgb({r},{g},{b})'


def main():
    ap = argparse.ArgumentParser()

    args = ap.parse_args()

    prim = primitives()
    sem = read('src/styles/tokens/semantic.css')
    i = sem.find(":root[data-theme='dark']")
    sem_light = dict(DECL.findall(sem[:i]))
    sem_dark = dict(DECL.findall(sem[i:]))
    sem_light.update(prim)
    sem_dark.update(prim)

    checked = bad = 0
    problems = []
    for fam, path in SOURCES.items():
        old_css = read(path, head=True)
        new_css = read(path)
        if old_css is None:
            continue
        old_sc = scopes_with(old_css, fam)
        new_sc = scopes_with(new_css, fam)
        # Casa por seletor, nao pelo conjunto de tokens: o bloco claro e o
        # dark de uma pagina declaram EXATAMENTE os mesmos tokens, entao
        # casar pelo conjunto mistura os dois temas e acusa divergencia
        # onde nao ha.
        def key(sel):
            dark = "data-theme='dark'" in sel or 'data-theme="dark"' in sel
            return dark
        old_by_theme = {}
        for sel, decl in old_sc.items():
            old_by_theme.setdefault(key(sel), {})[sel] = decl
        new_by_theme = {}
        for sel, decl in new_sc.items():
            new_by_theme.setdefault(key(sel), {})[sel] = decl

        for is_dark, oldmap in old_by_theme.items():
            newmap = new_by_theme.get(is_dark, {})
            for sel, old_decl in oldmap.items():
                match = None
                for nsel, ndecl in newmap.items():
                    if set(ndecl) == set(old_decl):
                        match = ndecl
                        break
                if match is None:
                    bad += 1
                    problems.append(f'{path}: bloco {"dark" if is_dark else "claro"} nao casou')
                    continue
                table = sem_dark if is_dark else sem_light
                for tok, oval in old_decl.items():
                    if not tok.startswith(f'--{fam}-'):
                        continue
                    nval = match[tok]
                    a = resolve(oval, table)
                    b = resolve(nval, table)
                    checked += 1
                    if a != b:
                        bad += 1
                        if len(problems) < 24:
                            problems.append(
                                f'{path} [{"dark" if is_dark else "claro"}] {tok}: '
                                f'{oval} -> {nval} = {b} (antes {a})')

    print(f'baseline: {BASELINE}')
    print(f'verificacoes: {checked}   divergencias: {bad}')
    for p in problems[:24]:
        print('  !', p)
    if bad:
        print('\nFALHOU: a consolidacao de dominios mudou algum valor.')
        return 1
    print('OK: todo token de pagina mantem o valor de antes (claro e escuro).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
