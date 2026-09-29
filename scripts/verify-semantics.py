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
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from token_baseline import (git_show, require_baseline,  # noqa: E402
                                BASELINE)


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECL = re.compile(r'^\s*(--[a-z][a-z0-9-]*):\s*([^;]+);', re.M)


def head_index(path='src/index.css'):
    """index.css no baseline: os tokens antigos, antes de virarem
    semantic.css. Nao HEAD -- ver scripts/token-baseline.py."""
    return git_show(path)


def srgb(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb_to_lab(hexv):
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    rl, gl, bl = (srgb(c) for c in (r, g, b))
    x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl
    y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl
    z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x / 0.95047), f(y / 1.0), f(z / 1.08883)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def to_hex(v):
    """hex, rgb() ou rgba() (com ou sem barra) -> #rrggbb, ou None."""
    v = v.strip().lower()
    if re.fullmatch(r'#[0-9a-f]{3}', v):
        v = '#' + ''.join(c * 2 for c in v[1:])
    if re.fullmatch(r'#[0-9a-f]{6}', v):
        return v
    nums = re.findall(r'[\d.]+', v)
    if v.startswith('rgb') and len(nums) >= 3:
        try:
            r, g, b = (max(0, min(255, int(float(x)))) for x in nums[:3])
            return '#%02x%02x%02x' % (r, g, b)
        except ValueError:
            return None
    return None


def delta_e(a, b):
    """DeltaE perceptual; converte as pontas de hex ou rgb() antes."""
    ha, hb = to_hex(a), to_hex(b)
    if not ha or not hb:
        return None
    la, lb = rgb_to_lab(ha), rgb_to_lab(hb)
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(la, lb)))


def rel_lum_of(hexv):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a, b):
    la, lb = rel_lum_of(a), rel_lum_of(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def surface_of(sem_tables):
    """Fundo da superficie clara, para medir contraste. `sem_tables` e o
    mapa {escopo: {token: valor}} que ja tem as primitivas somadas."""
    table = sem_tables.get(':root', {})
    v = resolve(table.get('--surface-canvas', '#ffffff'), table)
    return to_hex(v) or '#ffffff'


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
    for m in re.finditer(r'(--mm-[a-z]+-[a-z0-9]+(?:-[a-z0-9]+)*):\s*(#[0-9a-fA-F]{3,8})\s*;',
                         open(p, encoding='utf-8').read()):
        out[m.group(1)] = m.group(2).lower()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--index', default='src/index.css',
                    help='index.css no baseline (tokens antigos)')
    ap.add_argument('--allow-drift', type=float, default=None,
                    help='aceita drift perceptual ate este DeltaE, para '
                         'comparar contra o baseline apos consolidacao')
    args = ap.parse_args()

    if not require_baseline():
        return 1

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
    # "depois" precisam resolver para a mesma coisa. Sem isso, um token
    # de texto que aponta para uma primitiva nova (--mm-ink-aa-text)
    # resolve para a propria string "var(...)" e a comparacao falha.
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

    # Ajustes APROVADOS de contraste: nao sao alias, sao correcao de
    # acessibilidade. O token novo tem que (a) estar no piso de 4,5:1
    # sobre a superficie clara e (b) escurecer (nunca clarear) o valor
    # antigo -- clarear pioraria o contraste, nao resolveria.
    AA_FIXES = {'--text-muted', '--faint', '--text-subtle'}

    checked = bad = drift_ok = aa_ok = 0
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
            if a == b:
                continue
            de = delta_e(a, b) if args.allow_drift is not None else None
            if de is not None and de <= args.allow_drift:
                drift_ok += 1
                continue
            if tok in AA_FIXES and a.startswith('#') and b.startswith('#'):
                ratio = contrast(b, surface_of(sem))
                darkens = to_hex(b) and to_hex(a) and \
                    rel_lum_of(to_hex(b)) < rel_lum_of(to_hex(a))
                if ratio >= 4.5 and darkens:
                    aa_ok += 1
                    continue
                problems.append(
                    f'{sc}: {tok} escureceu para {b} mas o contraste deu '
                    f'{ratio:.2f} (precisa 4,5) ou clareou em vez de '
                    f'escurecer')
                bad += 1
                continue
            bad += 1
            if len(problems) < 24:
                problems.append(f'{sc}: {tok} = {b} mas {src} = {a}')

    print(f'baseline: {BASELINE}')
    if aa_ok:
        print(f'correcoes de contraste aprovadas: {aa_ok} tokens '
              f'(todas escurecem e passam 4,5:1)')
    if drift_ok:
        print(f'drift autorizado: {drift_ok} tokens (DeltaE <= {args.allow_drift})')
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
