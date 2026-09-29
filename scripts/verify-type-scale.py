"""Prova que a escala tipografica nao mudou nenhum tamanho sem decisao.

Funcao --check-size do verify-tokenization. Existe porque a cor tem
gate e o tamanho nao tinha: aplicar a escala trocava texto sem que
nada provasse o resultado.

O que este script FAZ (e o que o anterior fez errado):

  - conta tamanhos de forma IDENTICA nos dois lados. A primeira versao
    contava `font-size: Npx` e `font: Npx/...` no baseline, mas so
    `font-size:` e `var(--font-size-*)` no estado novo -- depois da
    substituicao o shorthand nao tem mais numero, entao a contagem
    batia errado e acusava 31 divergencias que nao existiam.

  - Casa token a token. Cada tamanho vira (origem, destino):
      ('12.5px', '--font-size-small')  -- troca deliberada
      ('12px',  '12px')                -- literal preservado
      ('12px',  '--font-size-caption') -- o 12px JA era o valor escolhido

  - So acusa o que nao pode acontecer: literal que mudou de valor sem
    ser um dos deliberados, token que aponta para papel errado, token
    sem definicao, ou contagem que nao bate.

    python scripts/verify-type-scale.py
    python scripts/verify-type-scale.py --verbose
"""
import re
import os
import sys
import glob
import argparse
import subprocess
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REM_PX = 16.0

# Valores escolhidos por decisao do usuario (2026-09-29). A troca de um
# literal para OUTRO valor so e aceitavel quando o papel alvo tem um
# destes valores E a diferenca esta na lista de transicoes aceitas.
CHOSEN = {'micro': 10, 'caption': 12, 'small': 13, 'body-sm': 14,
          'body-md': 16, 'body-lg': 18, 'lead': 20, 'title-sm': 24,
          'title-md': 32, 'display': 84}

# Transicoes deliberadas: papel -> {literal que colapsa para ele}.
# small=13px absorve 12,5 e 12,16/12,48rem; caption=12px absorve 11 e
# 11,5. Todas as outras trocas sao proibidas sem novo aval.
ACCEPTED = {
    'small': {12.5, 12.16, 12.48},
    'caption': {11.0, 11.5},
    'body-sm': {13.5, 13.12},
    'micro': {10.5, 9.5, 9.0},
    'body-md': {15.0},
    'body-lg': {17.0},
    'lead': {19.0, 19.2},
    'title-sm': {25.6},
}

FONT_SIZE = re.compile(r'font-size:\s*([0-9.]+)(px|rem)')
SHORTHAND = re.compile(r'(?<![\w-])font:\s*([^;{}]+)')
SIZE_TOKEN = re.compile(r'var\(\s*(--font-size-[a-z-]+)\s*\)')


def at(rel):
    r = subprocess.run(['git', 'show', f'93a8a75^:{rel}'],
                       cwd=ROOT, capture_output=True)
    return r.stdout.decode('utf-8', 'replace') if r.returncode == 0 else None


def load_tokens():
    out = {}
    txt = open(os.path.join(ROOT, 'src/styles/tokens/semantic.css'),
               encoding='utf-8').read()
    for m in re.finditer(r'(--font-size-[a-z-]+):\s*([0-9.]+)px', txt):
        out[m.group(1)] = float(m.group(2))
    return out


def scan(text):
    """[(origem, destino)] na ordem em que aparecem no arquivo.

    origem: float em px, ou None quando ja era token
    destino: float em px, ou '--font-size-x'
    """
    out = []
    events = []
    # Percorre as DECLARACOES na ordem do arquivo. O erro da primeira
    # versao foi contar por regex separada e depois ordenar por posicao:
    # dois padroes sobrepostos (uma regra com font-size E um shorthand
    # em outra) sao contados uma vez cada, mas um shorthand cujo tamanho
    # ja virou token precisa continuar contando -- e ele nao casa em
    # FONT_SIZE nem em SHORTHAND sem numero.
    for m in re.finditer(r'(?<![-\w])(font-size|font)\s*:\s*([^;{}]+)', text):
        kind, body = m.group(1), m.group(2)
        if kind == 'font' and body.strip() == 'inherit':
            continue
        tok = SIZE_TOKEN.search(body)
        lit = re.search(r'([0-9.]+)(px|rem)', body)
        if kind == 'font' and not tok and not lit:
            continue                      # font: <family> sem tamanho
        if tok:
            events.append((m.start(), None, tok.group(1)))
        elif lit:
            v, u = float(lit.group(1)), lit.group(2)
            events.append((m.start(), v * REM_PX if u == 'rem' else v, None))
    events.sort(key=lambda e: e[0])
    for _s, second, third in events:
        out.append((second, third))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    tokens = load_tokens()
    if not tokens:
        print('FALHA: nenhum token --font-size-* em semantic.css')
        return 1

    for name, want in CHOSEN.items():
        got = tokens.get(f'--font-size-{name}')
        if got != want:
            print(f'FALHA: --font-size-{name} = {got}, decisao foi {want}px')
            return 1

    files = [f for f in glob.glob(os.path.join(ROOT, 'src/**/*.css'),
                                  recursive=True)
             if 'tokens' not in f.replace('\\', '/')]

    checked = bad = 0
    swaps = collections.Counter()
    problems = []
    for f in files:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        old = at(rel)
        if old is None:
            continue
        before = scan(old)
        after = scan(open(f, encoding='utf-8').read())

        if len(before) != len(after):
            bad += 1
            problems.append(f'{rel}: contagem {len(before)} -> {len(after)}')
            continue

        for (o_px, o_tok), (n_px, n_tok) in zip(before, after):
            checked += 1
            # baseline ja era token: nao deveria acontecer
            if o_tok is not None:
                continue
            # destino agora e token
            if n_tok is not None:
                role = n_tok.replace('--font-size-', '')
                val = tokens.get(n_tok)
                if val is None:
                    bad += 1
                    problems.append(f'{rel}: {n_tok} sem definicao')
                    continue
                if abs(val - o_px) < 0.01:
                    continue                    # literal ja era o escolhido
                allowed = ACCEPTED.get(role, set())
                if any(abs(o_px - a) < 0.01 for a in allowed):
                    swaps[(o_px, n_tok)] += 1
                    continue
                bad += 1
                problems.append(f'{rel}: {o_px:g}px -> {n_tok} ({val}px) '
                                f'nao e transicao aprovada')
                continue
            # os dois literais: tem de ser identico
            if o_px is not None and n_px is not None and \
                    abs(o_px - n_px) > 0.01:
                bad += 1
                problems.append(f'{rel}: literal {o_px:g}px virou {n_px:g}px')

    print(f'{len(files)} arquivos | {checked} tamanhos casados token a token')
    print(f'trocas deliberadas: {sum(swaps.values())} '
          f'({len(swaps)} transicoes)')
    for (frm, to), n in sorted(swaps.items(), key=lambda x: -x[1]):
        print(f'    {frm:7.2f}px -> {to:22s} {n:4d}x')
    print(f'divergencias: {bad}')

    if args.verbose:
        for p in problems[:20]:
            print('  !', p)
    if bad:
        print('\nFALHOU: tamanho mudou fora das transicoes aprovadas.')
        return 1
    print('\nOK: todo tamanho ou foi preservado, ou e uma transicao '
          'decidida.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
