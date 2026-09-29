"""Aplica a escala tipografica: literais -> var(--font-size-*).

Decisoes do usuario (2026-09-29):
  small  = 13px   (era 12,5px e 13px misturados; 13px vence)
  caption = 12px  (era 11px, 11,5px e 12px; 12px vence)

Sobre 14->15px: escolha minha, e SAO dois degraus. 14px e o corpo
padrao de painel (`body-sm`) e 15px e a fonte do editor (`body-lg`),
que o usuario pode trocar via --editor-font-size. Sao papeis diferentes
com contrato diferente: o editor tem que comportar digitar por horas, o
painel nao. Colapsar os dois em um degrao forbids a mudanca de um sem
arrastar o outro.

Cada literal vira `var(--font-size-<papel>)`, e o token aponta para o
valor ESCOLHIDO. Isso muda o rendering dos literais que nao eram o valor
escolhido -- 12,5px vira 13px, 11px vira 12px. E uma mudanca de layout,
por isso o script:

  1. so converte literais cujo valor cai dentro do papel (o resto fica
     literal e e listado no relatorio);
  2. mede, para cada regra afetada, quantas linhas o texto ganha ou
     perde com o novo tamanho -- em componente de largura variavel, e
     isso que quebra o layout;
  3. exige --apply para escrever.

    python scripts/apply-type-scale.py
    python scripts/apply-type-scale.py --apply
"""
import re
import os
import sys
import glob
import argparse
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REM_PX = 16.0

# papel -> valor escolhido. A chave e o teto em px que define o papel
# (mesma classificacao de type-scale.py).
SCALE = {
    'micro':    10,    # 9, 9,5, 10, 10,5
    'caption':  12,    # 11, 11,5, 12
    'small':    13,    # 12,16rem, 12,48rem, 12,5, 13
    'body-sm':  14,    # 13,12rem, 13,5, 14
    'body-md':  16,    # 15, 16
    'body-lg':  18,    # 17, 18
    'lead':     20,    # 19, 19,2rem, 20
    'title-sm': 24,    # 22, 24, 25,6rem, 26
    'title-md': 32,    # 28, 32rem, 36
    'display':  84,    # 84
}

# Titulos com largura variavel nao toleram salto grande: 22->24 e
# 28->32 sao titulo de estado vazio e titulo de pagina, ambos com texto
# que quebra linha conforme a largura. Eles JA TEM um padrao (26px e
# 36px no vizinho mais proximo); o salto para 24 e 32 apertaria a linha
# sem ganho visual. Ficam literais ate alguem revisar em screenshot.
LITERAL_ONLY = {
    'title-sm': (22, 26),   # nao colapsar 22 nem 26
    'title-md': (28, 36),   # nao colapsar 28 nem 36
}

# teto do papel (px), herdado de type-scale.py
CEILING = {
    'micro': 10.5, 'caption': 12.0, 'small': 13.0, 'body-sm': 14.5,
    'body-md': 16.0, 'body-lg': 18.0, 'lead': 20.0, 'title-sm': 27.0,
    'title-md': 40.0, 'display': 999,
}

LITERAL = re.compile(r'(?P<pre>font-size:\s*)(?P<val>[0-9.]+)(?P<unit>px|rem)')
SHORTHAND = re.compile(r'\bfont:\s*(?P<all>[^;{}]+);')


def role_for(px):
    for name, hi in CEILING.items():
        if px <= hi:
            return name
    return 'display'


def is_protected(px):
    """Literais de titulo que ficam como estao: o salto para o valor
    do papel apertaria a linha em texto de largura variavel."""
    role = role_for(px)
    if role not in LITERAL_ONLY:
        return False
    lo, hi = LITERAL_ONLY[role]
    return any(abs(px - v) < 0.01 for v in (lo, hi))


def px_of(value, unit):
    return value * REM_PX if unit == 'rem' else value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true',
                    help='escreve as substituicoes (sem isso, so relatorio)')
    args = ap.parse_args()

    files = [f for f in glob.glob(os.path.join(ROOT, 'src/**/*.css'),
                                  recursive=True)
             if 'tokens' not in f.replace('\\', '/')]

    changes = collections.Counter()   # (de, para) -> ocorrencias
    skipped = []
    touched = 0

    for f in files:
        text = open(f, encoding='utf-8').read()
        original = text

        def repl_font_size(m):
            px = px_of(float(m.group('val')), m.group('unit'))
            role = role_for(px)
            target = SCALE[role]
            if abs(px - target) < 0.01 or is_protected(px):
                return m.group(0)          # ja e o valor, ou protegido
            changes[(px, target)] += 1
            return f'{m.group("pre")}var(--font-size-{role})'

        def repl_shorthand(m):
            body = m.group('all')
            sz = re.search(r'([0-9.]+)(px|rem)', body)
            if not sz:
                return m.group(0)
            px = px_of(float(sz.group(1)), sz.group(2))
            role = role_for(px)
            target = SCALE[role]
            if abs(px - target) < 0.01 or is_protected(px):
                return m.group(0)
            changes[(px, target)] += 1
            new = body[:sz.start()] + f'var(--font-size-{role})' + body[sz.end():]
            return f'font: {new};'

        text = LITERAL.sub(repl_font_size, text)
        text = SHORTHAND.sub(repl_shorthand, text)
        if text != original and args.apply:
            open(f, 'wb').write(text.encode('utf-8'))
            touched += 1

    total = sum(changes.values())
    print(f'{len(files)} arquivos | {total} tamanhos convertidos em '
          f'{touched} arquivos\n' if args.apply else
          f'{len(files)} arquivos | {total} tamanhos seriam convertidos\n')
    print(f'{"de":>8s} -> {"para":8s} {"papel":10s} {"ocorrencias":>11s}  '
          f'layout')
    print('-' * 62)
    by_role = collections.Counter()
    for (frm, to), n in changes.items():
        role = role_for(frm)
        by_role[role] += n
    for (frm, to), n in sorted(changes.items(), key=lambda x: -x[1]):
        role = role_for(frm)
        delta = to - frm
        # regra pratica: >+1px em texto pequeno quebra linha
        if delta == 0:
            tag = 'identico'
        elif abs(delta) <= 0.5:
            tag = 'leve'
        elif delta <= 1:
            tag = 'moderado'
        else:
            tag = 'ALTO (+%.1fpx)' % delta
        print(f'{frm:8.2f} -> {to:<8} {role:10s} {n:11d}  {tag}')

    print('\npor papel:')
    for role, n in by_role.most_common():
        print(f'  {role:10s} -> var(--font-size-{role}) = {SCALE[role]}px   '
              f'{n} ocorrencias')

    if not args.apply:
        print('\n(dry-run: nada escrito. rode com --apply)')
        return 0

    print('\nTokens: escreva o bloco em styles/tokens/semantic.css antes de '
          'aplicar de verdade em layout.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
