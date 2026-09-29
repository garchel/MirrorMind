"""Migra os aliases --review-* para os tokens semanticos de destino.

Por que isso e prioritario
--------------------------
A fusao da familia --review-* (commit 93a8a75) ja tinha feito o trabalho
dificil: 34 tokens se transformaram em alias que apontam para a camada
semantica, com o valor verificado nos dois temas. Mas o APP nunca
migrou: 380 referencias ainda dizem `var(--review-muted)`, e so 26 usam
os tokens novos. Ou seja, a camada 2 existe e esta correta -- e o
codigo nao a consome.

Resultado: 37 tokens semanticos (--status-*, --text-*, --surface-*,
--line-*) estao definidos e nunca usados. Nenhum token esta morto por
erro; estao mortos por adiamento.

Este script reescreve os 380 usos para o token de destino. Nao move
pixel: o alias ja resolve para o mesmo valor (verify-semantics.py
comprova isso contra o baseline, nos dois temas). Depois ele remove o
bloco de compatibilidade, que so existia para segurar a ponte.

Idempotente. Nao mexe em nada fora de src/**/*.css.

    python scripts/migrate-review-alias.py --dry-run
    python scripts/migrate-review-alias.py
"""
import re
import os
import sys
import glob
import argparse
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEMANTIC = os.path.join(ROOT, 'src/styles/tokens/semantic.css')

# Inicio e fim do bloco de compatibilidade, pelos marcadores.
BEGIN = 'COMPATIBILIDADE'
END_MARK = '--review-alt-line: var(--status-alt-line);'


def load_map():
    """--review-* -> --status-* (lido do bloco de compatibilidade)."""
    txt = open(SEMANTIC, encoding='utf-8').read()
    i = txt.find(BEGIN)
    if i == -1:
        print('FALHA: bloco de compatibilidade nao encontrado em semantic.css')
        return {}
    head = txt.rfind('/*', 0, i)
    body = txt[head:]
    out = {}
    for m in re.finditer(r'^\s*(--review-[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\);',
                         body, re.M):
        out[m.group(1)] = m.group(2)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--keep-alias', action='store_true',
                    help='reescreve os usos mas mantem o bloco de '
                         'compatibilidade (para rollback facil)')
    args = ap.parse_args()

    mp = load_map()
    if not mp:
        return 1
    # so o primeiro tema define o mapa duas vezes; take unique
    mp = {k: v for k, v in mp.items()}

    files = [f for f in glob.glob(os.path.join(ROOT, 'src/**/*.css'),
                                  recursive=True)
             if 'tokens' not in f.replace('\\', '/')]

    counts = collections.Counter()
    touched = 0
    for f in files:
        raw = open(f, 'rb').read()
        text = raw.decode('utf-8')
        original = text
        n = 0
        # ordena por comprimento: --review-line-soft antes de --review-line
        for old in sorted(mp, key=len, reverse=True):
            new = mp[old]
            text, k = re.subn(r'var\(\s*' + re.escape(old) + r'\s*([,)])',
                              lambda m: f'var({new}' + m.group(1), text)
            n += k
            if k:
                counts[old] += k
        if n and not args.dry_run:
            open(f, 'wb').write(text.encode('utf-8'))
            touched += 1
        elif n:
            touched += 1

    total = sum(counts.values())
    print(f'{len(files)} arquivos | {total} referencias migradas em '
          f'{touched} arquivos' + (' (dry-run)' if args.dry_run else ''))
    for old, n in counts.most_common():
        print(f'    {old:24s} -> {mp[old]:22s} {n:4d}x')

    if args.dry_run:
        print('\n(dry-run: nada escrito)')
        return 0

    # remove o bloco de compatibilidade
    if not args.keep_alias:
        raw = open(SEMANTIC, 'rb').read()
        txt = raw.decode('utf-8')
        i = txt.find(BEGIN)
        if i != -1:
            head = txt.rfind('/*', 0, i)
            # o bloco vai ate a ultima declaracao de alias; acha o
            # fecha do ultimo ":root[data-theme='dark'] {" que a contem
            last = txt.rfind(END_MARK, i)
            if last != -1:
                # fecha do bloco escuro que contem o ultimo alias
                blk = txt.rfind(':root[data-theme', head, last)
                close = txt.find('\n}', last)
                end = (close + 2) if close != -1 else len(txt)
                # garante que fechamos o bloco certo
                if blk != -1:
                    depth, p = 1, txt.find('{', blk) + 1
                    while p < len(txt) and depth:
                        if txt[p] == '{':
                            depth += 1
                        elif txt[p] == '}':
                            depth -= 1
                        p += 1
                    end = p
                txt = txt[:head].rstrip('\r\n') + '\r\n' + txt[end:].lstrip('\r\n')
                open(SEMANTIC, 'wb').write(txt.encode('utf-8'))
                left = len(re.findall(r'--review-[a-z0-9-]+:', txt))
                print(f'\nsemantic.css: bloco de compatibilidade removido'
                      f' ({left} alias restantes no arquivo)')

    print('\nRode `npm run tokens:verify` — verify-tokens deve reportar '
          'zero var() orfao, e nenhum alias deve sobrar em uso.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
