"""Aplica a consolidacao de uma familia de primitivas.

Ponto de partida: scripts/cluster-primitives.py agrupa, este aplica. Ele
so roda para as familias listadas em --family e exige que o agrupamento
passe no criterio de DeltaE de --tolerance (default 2.3, o piso de
"mesma cor"). Acima do piso o script RECUSA: consolidar passa a ser uma
mudanca visual e isso e decisao humana, nao do script.

O que ele faz, por token consolidation:
  --mm-gold-850-3: #e8e6dd    ->  --mm-gold-700: #e8e6dd
O nome e o valor mudam; o pixel renderizado NAO. A cor de destino e a
hex representante do cluster, entao a equivalencia visual e o criterio de
agrupamento -- e o verificador que confirma.

Idempotente: rodar de novo nao muda nada (nao ha mais hex duplicado a
trocar). --dry-run mostra o plano sem escrever.

    python scripts/consolidate-primitives.py --family gold
    python scripts/consolidate-primitives.py --family gold --dry-run
"""
import re
import os
import sys
import json
import math
import argparse
import collections
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOK_RE = re.compile(r'(--mm-([a-z]+)-(\d+)(?:-(\d+))?):\s*(#[0-9a-fA-F]{6})')


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


def delta_e(a, b):
    la, lb = rgb_to_lab(a), rgb_to_lab(b)
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(la, lb)))


def rel_lum(hexv):
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    return (0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b))


def read_tokens(family):
    path = os.path.join(ROOT, 'src/styles/tokens/primitive.css')
    txt = open(path, encoding='utf-8').read()
    out = []
    for m in TOK_RE.finditer(txt):
        if m.group(2) != family:
            continue
        out.append({'token': m.group(1), 'step': int(m.group(3)),
                    'suffix': int(m.group(4)) if m.group(4) else 1,
                    'hex': m.group(5).lower()})
    return out


def cluster(items, tolerance):
    clusters = []
    for it in sorted(items, key=lambda x: (-rel_lum(x['hex']), x['hex'])):
        for c in clusters:
            if delta_e(c['rep'], it['hex']) <= tolerance:
                c['members'].append(it)
                break
        else:
            clusters.append({'rep': it['hex'], 'rep_token': it['token'],
                             'rep_step': it['step'], 'members': [it]})
    return clusters


def step_for(hexv, steps):
    """Step da rampa mais proximo da luminancia deste hex."""
    target = round((1 - rel_lum(hexv)) * 900 + 50)
    return min(steps, key=lambda s: abs(s - target))


def allocate_steps(clusters, density=2):
    """Sorteia um step NOVO para cada cluster, nao reaproveita o legado.

    Reaproveitar os steps antigos nao funciona: a familia tem 11 steps
    para 15 clusters, entao 3 clusters caem todos em --mm-gold-250 e o
    nome continua ambiguo -- exatamente o defeito que estamos
    consertando. Aqui cada cluster recebe um step da grade cheia
    (50..950, passo 50) mais proximo da propria luminancia; se dois
    clusters disputarem o mesmo step, o segundo avanca 50. O resultado e
    uma rampa onde 1 step = 1 cor, que e a garantia que o nome promete.
    """
    grid = list(range(50, 1000, 50))
    used = {}
    out = {}
    for c in sorted(clusters, key=lambda c: -rel_lum(c['rep'])):
        target = round((1 - rel_lum(c['rep'])) * 900 + 50)
        st = min(grid, key=lambda s: abs(s - target))
        while st in used.values():
            nxt = st + 50
            if nxt > 950:
                st = st - 50
                while st in used.values():
                    st -= 50
                break
            st = nxt
        used[c['rep']] = st
        out[id(c)] = st
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--family', required=True,
                    help='familia a consolidar (ex: gold, ink, lilac)')
    ap.add_argument('--tolerance', type=float, default=2.3)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--min-group', type=int, default=2,
                    help='so colapsa grupos com pelo menos N cores')
    args = ap.parse_args()

    items = read_tokens(args.family)
    if not items:
        print(f'familia sem tokens: {args.family}')
        return 1
    clusters = cluster(items, args.tolerance)
    big = [c for c in clusters if len(c['members']) >= args.min_group]
    if not big:
        print(f'{args.family}: nada a consolidar '
              f'(todos os grupos tem 1 cor)')
        return 0

    # recusa explicita se o agrupamento passou do piso perceptual
    worst = max(delta_e(c['rep'], m['hex'])
                for c in clusters for m in c['members'])
    if worst > args.tolerance:
        print(f'RECUSA: pior DeltaE do agrupamento = {worst:.2f} '
              f'> tolerancia {args.tolerance}. Isso ja e mudanca visual; '
              f'consolide por partes ou chame com --tolerance maior.')
        return 1

    steps = sorted({it['step'] for it in items})
    # Cada cluster recebe um step NOVO. Reaproveitar os steps legados
    # nao resolve: a familia tem menos steps que clusters, entao varios
    # caem no mesmo --mm-gold-250 e o nome continua ambiguo.
    allocated = allocate_steps(clusters)
    # dois clusters de mesma cor representante viram o mesmo token
    rename = {}
    for c in clusters:
        new_token = f'--mm-{args.family}-{allocated[id(c)]}'
        for m in c['members']:
            if m['token'] != new_token:
                rename[m['token']] = new_token

    print(f'{args.family}: {len(items)} -> {len(clusters)} tokens '
          f'({len(items) - len(clusters)} a menos)')
    print(f'pior DeltaE do agrupamento: {worst:.2f} (tolerancia '
          f'{args.tolerance})')
    print(f'grade de steps: {steps} -> {sorted(set(allocated.values()))}')
    print(f'renomeacoes: {len(rename)}')
    for old, new in sorted(rename.items()):
        print(f'    {old:22s} -> {new}')

    if args.dry_run:
        print('\n(dry-run: nada escrito)')
        return 0

    # reescreve primitive.css e todas as referencias em src/
    prim_path = os.path.join(ROOT, 'src/styles/tokens/primitive.css')
    txt = open(prim_path, 'rb').read().decode('utf-8')
    for old, new in rename.items():
        txt = re.sub(r'^(\s*)' + re.escape(old) + r':',
                     lambda m: m.group(1) + new + ':', txt, flags=re.M)
    # remove as linhas duplicadas (varias cores viraram o mesmo token)
    seen, lines, dropped = set(), [], 0
    for line in txt.split('\n'):
        m = re.match(r'\s*(--mm-[\w-]+):', line)
        if m:
            if m.group(1) in seen:
                dropped += 1
                continue
            seen.add(m.group(1))
        lines.append(line)
    open(prim_path, 'wb').write(('\n'.join(lines)).encode('utf-8'))
    print(f'primitive.css: {dropped} linhas duplicadas removidas')

    touched = 0
    for root, _, files in os.walk(os.path.join(ROOT, 'src')):
        for fn in files:
            if not fn.endswith('.css') or fn == 'primitive.css':
                continue
            p = os.path.join(root, fn)
            raw = open(p, 'rb').read()
            body = raw.decode('utf-8')
            n = 0
            for old, new in rename.items():
                body, k = re.subn(r'var\(\s*' + re.escape(old) + r'\s*([,)])',
                                  lambda m: f'var({new}' + m.group(1), body)
                n += k
            if n:
                open(p, 'wb').write(body.encode('utf-8'))
                touched += n
    print(f'{touched} referencias var(--mm-*) atualizadas em src/')
    print('\nRode `npm run tokens:verify` e confira o diff antes de commitar.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
