"""Aplica a consolidacao de uma familia de primitivas.

Ponto de partida: scripts/cluster-primitives.py agrupa, este aplica.

O que ele faz: os hex de um cluster passam a compartilhar UM token. O
representante do cluster mantem o nome; os demais sao removidos e todas
as referencias `var(--mm-*)` passam a apontar para o representante.

O bug da primeira versao (que gerou 8 hex com DeltaE 16,43): ela
remapeava cada token para um step derivado da luminancia. Isso mudava
o NOME de cores que nao deviam mudar de nome e, quando dois clusters
caiam no mesmo step, um deles ficava sem representacao -- o hex sumia
sem destino. Aqui o nome do representante e preservado e nenhum hex e
descartado: o gate `verify-tokenization` compara token a token com o
baseline e acusa qualquer perda.

Por que o agrupamento e seguro: o criterio e DeltaE76 <= 2.3 em CIELAB
(o piso de "mesma cor" da literatura de identidade de cor). Acima do
piso o script RECUSA -- ai ja seria uma mudanca visual, e isso e
decisao humana.

    python scripts/consolidate-primitives.py --family gold --dry-run
    python scripts/consolidate-primitives.py --family gold
"""
import re
import os
import sys
import math
import argparse
import collections

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
    txt = open(os.path.join(ROOT, 'src/styles/tokens/primitive.css'),
               encoding='utf-8').read()
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
            clusters.append({'rep': it['hex'], 'members': [it]})
    return clusters


def pick_representative(members):
    """O membro mais CENTRAL do cluster (menor DeltaE medio), nao o mais
    claro. Escolher o extremo puxaria a rampa para um lado e criaria um
    salto visivel entre steps vizinhos."""
    if len(members) == 1:
        return members[0]
    best, best_d = None, None
    for cand in members:
        avg = sum(delta_e(cand['hex'], m['hex'])
                  for m in members if m is not cand) / (len(members) - 1)
        if best_d is None or avg < best_d:
            best, best_d = cand, avg
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--family', required=True)
    ap.add_argument('--tolerance', type=float, default=2.3)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--min-group', type=int, default=2)
    args = ap.parse_args()

    items = read_tokens(args.family)
    if not items:
        print(f'familia sem tokens: {args.family}')
        return 1
    clusters = cluster(items, args.tolerance)
    by_token = {it['token']: it for it in items}

    worst = max(delta_e(c['rep'], m['hex'])
                for c in clusters for m in c['members'])
    if worst > args.tolerance:
        print(f'RECUSA: pior DeltaE = {worst:.2f} > {args.tolerance}. '
              f'Acima do piso isso ja e mudanca visual; consolide em partes.')
        return 1

    rename = {}
    for c in clusters:
        if len(c['members']) < args.min_group:
            continue
        rep = pick_representative(c['members'])
        for m in c['members']:
            if m['token'] != rep['token']:
                rename[m['token']] = rep['token']

    kept = len(items) - len(rename)
    print(f'{args.family}: {len(items)} -> {kept} tokens '
          f'({len(rename)} consolidados)')
    print(f'pior DeltaE do agrupamento: {worst:.2f} (tolerancia '
          f'{args.tolerance})')
    for old, new in sorted(rename.items()):
        print(f'    {old:22s} ({by_token[old]["hex"]}) -> {new} '
              f'({by_token[new]["hex"]})')

    if args.dry_run:
        print('\n(dry-run: nada escrito)')
        return 0

    # 1) primitive.css: remove as linhas dos tokens consolidados
    prim = os.path.join(ROOT, 'src/styles/tokens/primitive.css')
    txt = open(prim, 'rb').read().decode('utf-8')
    drop = set(rename)
    kept_lines, removed = [], 0
    for line in txt.split('\n'):
        m = re.match(r'\s*(--mm-[\w-]+):', line)
        if m and m.group(1) in drop:
            removed += 1
            continue
        kept_lines.append(line)
    open(prim, 'wb').write('\n'.join(kept_lines).encode('utf-8'))
    print(f'primitive.css: {removed} tokens removidos')

    # 2) todas as referencias em src/
    #    reescreve em ordem de comprimento para --mm-x-10 nao casar com
    #    --mm-x-1 quando uma regra cita o primeiro
    touched = 0
    order = sorted(rename, key=len, reverse=True)
    for root, _, files in os.walk(os.path.join(ROOT, 'src')):
        for fn in files:
            if not fn.endswith('.css') or fn == 'primitive.css':
                continue
            p = os.path.join(root, fn)
            body = open(p, 'rb').read().decode('utf-8')
            n = 0
            for old in order:
                new = rename[old]
                body, k = re.subn(
                    r'var\(\s*' + re.escape(old) + r'\s*([,)])',
                    lambda m: f'var({new}' + m.group(1), body)
                n += k
            if n:
                open(p, 'wb').write(body.encode('utf-8'))
                touched += n
    print(f'{touched} referencias var(--mm-*) atualizadas')
    print('\nRode `npm run tokens:verify` -- verify-tokenization e o que '
          'garante que nenhum hex se perdeu.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
