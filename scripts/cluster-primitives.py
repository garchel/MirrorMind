"""Agrupa as 456 primitivas em rampas consolidaveis.

Problema que este script existe para resolver: a camada 1 foi gerada
1:1 do hex em uso, entao tem 456 tokens -- 68 deles caem no mesmo step
(quando deveria caber uma cor so por step) e 93 violam a ordem de
luminancia que o nome promete. E rastreamento automatico, nao uma rampa.

Este script AGRUPA, nao aplica. Ele responde: "quais cores podem
cair no mesmo step sem mudanca visual perceptivel?", medido em CIELAB
(DeltaE76), que e a metrica perceptual de referencia -- e o que o olho
realmente distingue, ao contrario de comparar hex no RGB.

    python scripts/cluster-primitives.py
    python scripts/cluster-primitives.py --family sage
    python scripts/cluster-primitives.py --json

Criterio de corte (--tolerance, default 2.3 DeltaE): Abaixo de ~2.3 duas
cores sao indistinguiveis lado a lado em texto pequeno; a identidade
Judd/BrownPeskin et al. marca ~2.3 como o piso de "mesma cor". Acima
disso a unificacao passa a ser uma mudanca visual, e isso exige
aprovacao humana -- por isso o script nao aplica nada sozinho.
"""
import re
import os
import sys
import json
import math
import argparse
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOK_RE = re.compile(r'(--mm-([a-z]+)-(\d+)(?:-(\d+))?):\s*(#[0-9a-fA-F]{6})')

# Ordem de apresentacao: neutro primeiro, depois as familias em ordem de
# matiz. E a mesma ordem em que primitive.css emite.
FAM_ORDER = ['ink', 'gold', 'clay', 'brick', 'moss', 'sage',
             'teal', 'azure', 'lilac', 'rose']
FAM_LABEL = {
    'ink': 'Neutros (tinta/papel) — cinzas de matiz residual',
    'gold': 'Dourados — superficie quente, fundo de papel',
    'clay': 'Barro — o acento de acao',
    'brick': 'Tijolo — erro e destrutivo',
    'moss': 'Musgo — verde de dado, fundo esverdeado',
    'sage': 'Sage — verde de dominio, acento frio',
    'teal': 'Ciano — quase inexistente (2 tokens)',
    'azure': 'Azul — informacao e workspace noturno',
    'lilac': 'Lilac — categoria alternativa',
    'rose': 'Rosa — 4 tokens, categoria/status raro',
}


def read_tokens():
    path = os.path.join(ROOT, 'src/styles/tokens/primitive.css')
    txt = open(path, encoding='utf-8').read()
    out = []
    for m in TOK_RE.finditer(txt):
        out.append({'token': m.group(1), 'family': m.group(2),
                    'step': int(m.group(3)),
                    'suffix': int(m.group(4)) if m.group(4) else 1,
                    'hex': m.group(5).lower()})
    return out


def srgb_to_linear(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb_to_lab(hexv):
    """sRGB -> CIELAB (D65). Base da metrica perceptual DeltaE76."""
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    rl, gl, bl = (srgb_to_linear(c) for c in (r, g, b))
    # linear sRGB -> XYZ (D65)
    x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl
    y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl
    z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl
    # XYZ -> Lab (referencia D65)
    xn, yn, zn = 0.95047, 1.00000, 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(a, b):
    la, lb = rgb_to_lab(a), rgb_to_lab(b)
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(la, lb)))


def rel_lum(hexv):
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    return (0.2126 * srgb_to_linear(r) + 0.7152 * srgb_to_linear(g)
            + 0.0722 * srgb_to_linear(b))


def cluster(items, tolerance):
    """Agrupa por DeltaE: cada cor entra no primeiro cluster cuja
    representante esteja dentro da tolerancia (single-link, para nao
    encadear A-B-C onde A-C ja e visivel)."""
    clusters = []
    for it in sorted(items, key=lambda x: (-rel_lum(x['hex']), x['hex'])):
        for c in clusters:
            if delta_e(c['rep'], it['hex']) <= tolerance:
                c['members'].append(it)
                break
        else:
            clusters.append({'rep': it['hex'], 'members': [it],
                             'rep_token': it['token']})
    return clusters


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tolerance', type=float, default=2.3,
                    help='DeltaE maximo para considerar a mesma cor '
                         '(default 2.3, o piso de "indistinguivel")')
    ap.add_argument('--family', help='restringe a uma familia')
    ap.add_argument('--json', action='store_true', dest='as_json')
    args = ap.parse_args()

    toks = read_tokens()
    if args.family:
        toks = [t for t in toks if t['family'] == args.family]
        if not toks:
            print(f'familia desconhecida: {args.family}')
            return 1

    by_fam = collections.defaultdict(list)
    for t in toks:
        by_fam[t['family']].append(t)

    report = {}
    total_in = total_out = 0
    fams = sorted(by_fam, key=lambda f: (FAM_ORDER.index(f)
                                         if f in FAM_ORDER else 99, f))
    for fam in fams:
        items = by_fam[fam]
        clusters = cluster(items, args.tolerance)
        total_in += len(items)
        total_out += len(clusters)
        report[fam] = {
            'label': FAM_LABEL.get(fam, ''),
            'in': len(items),
            'out': len(clusters),
            'clusters': [{'rep': c['rep'],
                          'rep_token': c['rep_token'],
                          'members': [m['token'] for m in c['members']],
                          'hexes': sorted({m['hex'] for m in c['members']}),
                          'max_delta_e': round(max(
                              delta_e(c['rep'], m['hex'])
                              for m in c['members']), 2)}
                         for c in clusters],
        }

    if args.as_json:
        print(json.dumps({'tolerance': args.tolerance, 'families': report},
                         indent=1))
        return 0

    print(f'tolerancia: DeltaE <= {args.tolerance} '
          f'(abaixo disso duas cores sao indistinguiveis)\n')
    print(f'{"familia":8s} {"atual":>6s} {"rampa":>6s} {"economia":>9s} ideracao')
    print('-' * 78)
    for fam in fams:
        r = report[fam]
        save = r['in'] - r['out']
        pct = save / r['in'] * 100 if r['in'] else 0
        print(f"{fam:8s} {r['in']:6d} {r['out']:6d} {save:5d} ({pct:4.1f}%)  "
              f"{r['label']}")
    print('-' * 78)
    pct = (total_in - total_out) / total_in * 100
    print(f"{'TOTAL':8s} {total_in:6d} {total_out:6d} {total_in-total_out:5d} "
          f"({pct:4.1f}%)")
    print(f'\nDe {total_in} primitivas para {total_out} degraus de rampa.')
    print('Nada foi aplicado: consolidacao muda pixels e exige sua OK.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
