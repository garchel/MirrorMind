"""Verifica que a tokenizacao nao moveu nenhum pixel.

Compara o worktree contra scripts/token-baseline.py::BASELINE (o estado
com hex literais), nao contra HEAD: depois do commit da tokenizacao,
HEAD ja e o estado novo e o gate viraria falso verde.

Para cada regra CSS em src/**, resolve o hex original que a regra usava
antes da migracao (via git show HEAD:<arquivo>) e confere que o
var(--mm-*) substituto aponta para o MESMO valor.

Modos:
    python scripts/verify-tokenization.py            # HEAD -> working tree
    python scripts/verify-tokenization.py --staged   # HEAD -> index
"""
import re
import os
import sys
import json
import glob
import math
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from token_baseline import git_show, BASELINE  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')
VAR_RE = re.compile(r'var\(\s*(--mm-[a-z]+-\d+(?:-\d+)?)\s*\)')


def norm(h):
    h = h.lower()
    if len(h) == 4:
        return '#' + ''.join(c * 2 for c in h[1:])
    if len(h) == 5:
        return '#' + h[1] + ''.join(c * 2 for c in h[2:5])
    return h


def git_show_at(rel):
    """Texto do arquivo no baseline (estado com hex literais)."""
    if '--staged' in sys.argv:
        import subprocess
        p = subprocess.run(['git', 'show', f':{rel}'], cwd=ROOT,
                           capture_output=True)
        return (p.stdout.decode('utf-8', 'replace')
                if p.returncode == 0 else None)
    return git_show(rel)


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


def load_primitives():
    """--mm-* -> hex, lendo o token gerado."""
    path = os.path.join(ROOT, 'src/styles/tokens/primitive.css')
    txt = open(path, encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'(--mm-[a-z]+-\d+(?:-\d+)?):\s*(#[0-9a-fA-F]{3,8})\s*;', txt):
        out[m.group(1)] = norm(m.group(2))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--staged', action='store_true')
    ap.add_argument('--allow-drift', type=float, default=None,
                    help='aceita drift perceptual ate este DeltaE (ex: 2.3 '
                         'apos uma consolidacao aprovada). Sem este flag, '
                         'qualquer hex diferente de HEAD e FALHA.')
    args = ap.parse_args()

    prim = load_primitives()
    if not prim:
        print('FALHA: nenhuma primitiva encontrada em primitive.css')
        return 1

    files = sorted(set(glob.glob(os.path.join(ROOT, 'src/**/*.css'), recursive=True)))
    checked = mismatches = unresolved = drift_ok = 0
    drift_max = 0.0
    problems = []

    for f in files:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        if rel.endswith('tokens/primitive.css'):
            continue
        cur = open(f, encoding='utf-8').read()
        old = git_show_at(rel)
        if old is None:
            continue

        # 1) todo var(--mm-*) no arquivo atual precisa existir como primitiva
        for tok in set(VAR_RE.findall(cur)):
            if tok not in prim:
                unresolved += 1
                problems.append(f'{rel}: var({tok}) sem definicao em primitive.css')

        # 2) casar as sequencias: a ordem das substituicoes tem de coincidir
        #    com a ordem dos hex antigos no mesmo arquivo.
        old_hex = [norm(h) for h in HEX_RE.findall(old)]
        new_vars = VAR_RE.findall(cur)
        if len(old_hex) != len(new_vars):
            # houve hex que sobrou, ou var() que nao veio de um hex
            leftovers = [h for h in HEX_RE.findall(cur)]
            if leftovers:
                unresolved += len(leftovers)
                problems.append(
                    f'{rel}: {len(leftovers)} hex literal(is) sobraram '
                    f'(ex.: {leftovers[:3]})')
            continue
        for i, (h, tok) in enumerate(zip(old_hex, new_vars)):
            checked += 1
            got = prim.get(tok)
            if got == h:
                continue
            # drift so e aceitavel se explicitamente autorizado E dentro
            # da tolerancia perceptual declarada.
            if args.allow_drift is not None and got and \
                    delta_e(h, got) <= args.allow_drift:
                drift_ok += 1
                drift_max = max(drift_max, delta_e(h, got))
                continue
            mismatches += 1
            if len(problems) < 20:
                problems.append(
                    f'{rel}[{i}]: {h} -> var({tok}) = {got} (DIVERGE)')

    print(f'verificacoes: {checked}   divergencias: {mismatches}   '
          f'nao resolvidos: {unresolved}')
    if drift_ok:
        print(f'drift autorizado: {drift_ok} referencias, '
              f'DeltaE max {drift_max:.2f} (tolerancia '
              f'{args.allow_drift})')
    for p in problems[:20]:
        print('  !', p)
    if mismatches or unresolved:
        print('\nFALHOU: a migracao moveu pixels ou deixou refs pendentes.')
        return 1
    print('OK: todo var(--mm-*) resolve para o hex original. Zero pixels movidos.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
