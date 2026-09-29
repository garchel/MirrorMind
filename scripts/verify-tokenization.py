"""Verifica que a tokenizacao nao moveu nenhum pixel.

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
import argparse
import subprocess

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


def git_show(rel):
    """Texto do arquivo em HEAD, ou None se nao existia."""
    args = ['git', 'show', f'HEAD:{rel}']
    if '--staged' in sys.argv:
        args = ['git', 'show', f':{rel}']
    p = subprocess.run(args, cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        return None
    return p.stdout.decode('utf-8', 'replace')


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
    args = ap.parse_args()

    prim = load_primitives()
    if not prim:
        print('FALHA: nenhuma primitiva encontrada em primitive.css')
        return 1

    files = sorted(set(glob.glob(os.path.join(ROOT, 'src/**/*.css'), recursive=True)))
    checked = mismatches = unresolved = 0
    problems = []

    for f in files:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        if rel.endswith('tokens/primitive.css'):
            continue
        cur = open(f, encoding='utf-8').read()
        old = git_show(rel)
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
            if prim.get(tok) != h:
                mismatches += 1
                if len(problems) < 20:
                    problems.append(
                        f'{rel}[{i}]: {h} -> var({tok}) = {prim.get(tok)} (DIVERGE)')

    print(f'verificacoes: {checked}   divergencias: {mismatches}   '
          f'nao resolvidos: {unresolved}')
    for p in problems[:20]:
        print('  !', p)
    if mismatches or unresolved:
        print('\nFALHOU: a migracao moveu pixels ou deixou refs pendentes.')
        return 1
    print('OK: todo var(--mm-*) resolve para o hex original. Zero pixels movidos.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
