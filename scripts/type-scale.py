"""Deriva a escala tipografica a partir dos tamanhos literais em uso.

Hoje nao existe NENHUM token de font-size no projeto: o app usa 29
valores distintos em 532 ocorrencias, a maioria com decimal (12,5px,
11,5px, 10,5px) -- assinatura de ajuste ad-hoc, nao de escala.

Por que NAO agrupar por tamanho
-------------------------------
A primeira versao deste script agrupava por salto relativo entre
vizinhos e produziu 2 degraus: 9px..36px num so. Isso e honesto --
abaixo de ~28px o app usa tamanho de forma continua, sem degraus. Mas
"continuo" nao e o mesmo que "sem escala": a separacao real do design
esta no PAPEL, nao no numero. 9px e um kicker uppercase; 13px e corpo
de painel; 24px e titulo de pagina. Tres niveis, tres papeis, tres
degraus -- mesmo que 13px e 14px fiquem a 1px de distancia.

Por isso este script classifica por (papel, densidade), e so DEPOIS
confere se os papeis ficam em ordem de tamanho. Um papel que aparece
com tamanho quebrado em duas ordens e sinal de que a classificacao
errou, e o script diz qual.

Ele PROPOE. Nao aplica: mudar tamanho de texto move layout, e um pixel
a mais ou a menos em um painel e decisao de quem desenha a tela.

    python scripts/type-scale.py
    python scripts/type-scale.py --json
"""
import re
import os
import sys
import json
import glob
import argparse
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE_RE = re.compile(r'font-size:\s*([0-9.]+)(px|rem)')
SHORTHAND = re.compile(r'\bfont:\s*([^;]+);')
REM_PX = 16.0

# (papel, px maximo, peso tipico, transform). A faixa em px e o que o
# app ja faz na pratica; o papel e o que nomeia o token.
ROLES = [
    # papel        px_min px_max  weight  transform
    ('micro',       0,  10.5,    700,    'uppercase'),   # kicker, carimbo
    ('caption',     0,  12.0,    400,    None),          # auxiliar, chip
    ('small',       0,  13.0,    400,    None),          # metadado, dica
    ('body-sm',     0,  14.5,    400,    None),          # corpo de painel
    ('body-md',     0,  16.0,    400,    None),          # corpo padrao
    ('body-lg',     0,  18.0,    400,    None),          # editor, leitura
    ('lead',        0,  20.0,    600,    None),          # frase de destaque
    ('title-sm',    0,  27.0,    600,    None),          # titulo de secao
    ('title-md',    0,  40.0,    600,    None),          # titulo de pagina
    ('display',     0,  999,     700,    None),          # pontuacao gigante
]


def role_for(px):
    """O papel cujo teto comporta este tamanho (menor teto >= px)."""
    for name, lo, hi, _w, _t in ROLES:
        if px <= hi:
            return name
    return ROLES[-1][0]


def collect():
    found = collections.Counter()
    where = collections.defaultdict(set)
    files = [f for f in glob.glob(os.path.join(ROOT, 'src/**/*.css'),
                                  recursive=True)
             if 'tokens' not in f.replace('\\', '/')]
    for f in files:
        rel = os.path.basename(f)
        text = open(f, encoding='utf-8').read()

        def record(value, unit):
            px = value * REM_PX if unit == 'rem' else value
            key = (round(px, 2), unit)
            found[key] += 1
            where[key].add(rel)

        # font-size: 10.5px
        for m in SIZE_RE.finditer(text):
            record(float(m.group(1)), m.group(2))
        # font: 700 16px/1 var(--sans) -> o tamanho e o primeiro px/rem
        for m in SHORTHAND.finditer(text):
            sz = re.search(r'([0-9.]+)(px|rem)', m.group(1))
            if sz:
                record(float(sz.group(1)), sz.group(2))
    return found, where


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', action='store_true', dest='as_json')
    args = ap.parse_args()

    found, where = collect()
    if not found:
        print('nenhum font-size literal encontrado')
        return 1

    by_role = collections.defaultdict(list)
    for (px, unit), n in found.items():
        by_role[role_for(px)].append((px, unit, n))

    order = [r[0] for r in ROLES]
    total = sum(found.values())

    if args.as_json:
        print(json.dumps({'total_literals': len(found), 'uses': total,
                          'roles': [{
                              'name': role,
                              'members': [f'{p:g}{u}' for p, u, _ in v],
                              'uses': sum(n for _, _, n in v),
                              'min': min(p for p, _, _ in v),
                              'max': max(p for p, _, _ in v),
                          } for role in order
                              if role in by_role]}, indent=1))
        return 0

    print(f'{len(found)} literais distintos, {total} ocorrencias em src/')
    print('classificacao por PAPEL (teto em px), nao por tamanho\n')
    print(f'{"papel":10s} {"faixa":>11s} {"literais":30s} {"usos":>5s}')
    print('-' * 62)
    for role in order:
        if role not in by_role:
            continue
        v = sorted(by_role[role])
        lits = ', '.join(f'{p:g}{u}' for p, u, _ in v)
        if len(lits) > 30:
            lits = lits[:27] + '...'
        print(f'{role:10s} {v[0][0]:5.1f}-{v[-1][0]:5.1f} {lits:30s} '
              f'{sum(n for _, _, n in v):5d}')
    print('-' * 62)
    print(f'{len([r for r in order if r in by_role])} papeis para '
          f'{len(found)} literais')

    # sanidade: os papeis tem que crescer em tamanho
    seq = [(role, min(p for p, _, _ in by_role[role]))
           for role in order if role in by_role]
    inversions = [(a, b) for (a, pa), (b, pb) in zip(seq, seq[1:]) if pb < pa]
    if inversions:
        print(f'\nAVISO: {len(inversions)} inverteram de tamanho -- a '
              f'classificacao por papel precisa de revisao:')
        for a, b in inversions:
            print(f'    {a} -> {b} diminui de tamanho')
    else:
        print('\nSanidade OK: os papeis crescem em tamanho, nao ha '
              'inversao.')

    lonely = [k for k in found if found[k] <= 2]
    if lonely:
        print(f'\n{len(lonely)} literais com <= 2 usos -- quase sempre '
              f'ajuste ad-hoc a padronizar:')
        for k in sorted(lonely, key=lambda k: k[0])[:12]:
            print(f'    {k[0]:g}{k[1]:4s} {found[k]:2d}x  '
                  f'{", ".join(sorted(where[k])[:3])}')
    print('\nNada foi aplicado: mexer em tamanho de texto move layout.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
