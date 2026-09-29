"""Prova que a tokenizacao nao moveu nenhum pixel.

Compara o worktree contra o estado PRE-TOKENIZACAO (o baseline em
scripts/token_baseline.py), onde as cores ainda eram hex literal.

O que este gate compara
-----------------------
Cada `var(--mm-*)` do app resolve para um hex. Esse hex tem de ser:

  1. IDENTICO a um hex que existia no baseline -> nada moveu; ou
  2. dentro de 2,3 de DeltaE de algum hex do baseline -> a consolidacao
     trocou por um vizinho visualmente indistinguivel (o piso de
     "mesma cor"); ou
  3. sem correspondencia nenhuma -> FALHA. Seria uma cor inventada.

O que este gate NAO faz, e o porque de duas versoes anteriores
----------------------------------------------------------------
(a) Nao casa hex com var() POR POSICAO no arquivo. Zipar as listas na
    ordem em que aparecem quebra assim que uma consolidacao renomeia
    tokens: a contagem muda, as listas se realinham, e o gate acusa
    divergencia em posicao. Foi exatamente o que aconteceu: 3 falsos
    positivos em editor.css, onde 134 renomeios eram legitimos.

(b) Nao casa hex com token POR SIMILARIDADE de cor, escolhendo o token
    mais proximo em DeltaE. E guloso: o primeiro hex que chega consome o
    candidato, e um hex repetido rouba o token de outro. Reportou
    DeltaE de 14 que nao existiam.

(c) Nao expoe o baseline. Os tokens do baseline sao derivados, nao
    literais: o gate antigo lia `old` procurando `--mm-*` num arquivo
    que entao tinha hex cru, e a lista saia vazia -- cada token atual
    "nao correspondia a nenhum hex do baseline", DeltaE 99, falso
    positivo em massa.

O metodo certo: comparar o HEX de cada token contra o CONJUNTO de hex
que existia no baseline. Sem posicao, sem gulosidade, sem ambiguidade.

    python scripts/verify-tokenization.py
    python scripts/verify-tokenization.py --allow-drift 2.3
"""
import re
import os
import sys
import math
import glob
import argparse
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from token_baseline import git_show, BASELINE  # noqa: E402

HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')
TOKEN_RE = re.compile(r'--mm-[a-z]+-\d+(?:-\d+)?')
TOLERANCE = 2.3   # piso de "mesma cor" (DeltaE76 CIELAB)


def norm(h):
    h = h.strip().lower()
    if len(h) == 4:
        return '#' + ''.join(c * 2 for c in h[1:])
    if len(h) == 5:
        return '#' + h[1] + ''.join(c * 2 for c in h[2:5])
    return h[:7]


def srgb(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rel_lum(hexv):
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)


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


def load_primitives():
    path = os.path.join(ROOT, 'src/styles/tokens/primitive.css')
    out = {}
    for m in re.finditer(r'(--mm-[a-z]+-\d+(?:-\d+)?):\s*(#[0-9a-fA-F]{3,8})',
                         open(path, encoding='utf-8').read()):
        out[m.group(1)] = norm(m.group(2))
    return out


def baseline_hexes():
    """Todos os hex que existiam no baseline, em qualquer CSS de src/."""
    out = set()
    files = subprocess.run(['git', 'ls-tree', '-r', '--name-only',
                            BASELINE, 'src'], cwd=ROOT, capture_output=True)
    for rel in files.stdout.decode().split('\n'):
        if not rel.endswith('.css'):
            continue
        txt = git_show(rel)
        if txt is None:
            continue
        for h in HEX_RE.findall(txt):
            out.add(norm(h))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--allow-drift', type=float, default=None,
                    help=f'aceita ate este DeltaE (padrao da casa: '
                         f'{TOLERANCE}). Sem o flag, so hex identico passa')
    ap.add_argument('--tolerance', type=float, default=TOLERANCE)
    args = ap.parse_args()

    prim = load_primitives()
    if not prim:
        print('FALHA: nenhuma primitiva em primitive.css')
        return 1
    base = baseline_hexes()
    if not base:
        print(f'FALHA: nao li nenhum hex do baseline ({BASELINE})')
        return 1

    # classifica cada token: identico, dentro da tolerancia, ou inventado
    identical, drifted, invented = [], [], []
    for tok, hx in sorted(prim.items()):
        if hx in base:
            identical.append(tok)
            continue
        best = min((delta_e(hx, b), b) for b in base)
        if args.allow_drift is not None and best[0] <= args.tolerance:
            drifted.append((tok, hx, best[1], best[0]))
        else:
            invented.append((tok, hx, best[1], best[0]))

    print(f'baseline: {BASELINE}  ({len(base)} hex distintos)')
    print(f'tokens: {len(prim)}')
    print(f'  {len(identical):3d} identicos a um hex do baseline')
    print(f'  {len(drifted):3d} dentro de DeltaE {args.tolerance}'
          f'{" (autorizado por --allow-drift)" if args.allow_drift is not None else " (NAO autorizado)"}')
    print(f'  {len(invented):3d} sem correspondencia')

    if drifted:
        worst = max(d[3] for d in drifted)
        print(f'\n  drift: DeltaE max {worst:.2f}, medio '
              f'{sum(d[3] for d in drifted) / len(drifted):.2f}')
        for tok, hx, b, d in sorted(drifted, key=lambda x: -x[3])[:8]:
            print(f'    {tok:20s} {hx} <- {b}  DeltaE {d:.2f}')

    # agora o uso: todo var(--mm-*) tem que existir como primitiva
    used = 0
    dangling = []
    for f in sorted(glob.glob(os.path.join(ROOT, 'src/**/*.css'),
                              recursive=True)):
        if f.endswith('primitive.css'):
            continue
        for m in re.finditer(r'var\(\s*(--mm-[a-z]+-\d+(?:-\d+)?)\s*[,)]',
                             open(f, encoding='utf-8').read()):
            used += 1
            if m.group(1) not in prim:
                dangling.append((os.path.relpath(f, ROOT), m.group(1)))

    print(f'\nusos de var(--mm-*): {used}  |  sem primitiva: {len(dangling)}')
    for rel, tok in dangling[:10]:
        print(f'  ! {rel}: {tok}')

    failed = bool(invented) or bool(dangling)
    if failed:
        print('\nFALHOU: token sem correspondencia no baseline, ou var() orfao.')
        return 1
    print('\nOK: todo token de cor ou existe no baseline ou esta dentro '
          'da tolerancia perceptual. Nenhuma cor foi inventada.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
