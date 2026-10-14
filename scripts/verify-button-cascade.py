"""Gate: nenhuma regra de contexto pode depender so da tag `button`.

O problema
----------
58 seletores de CSS do app usam a tag `button` no seletor, e 20 deles
alem disso declaram `min-height`. Quando um `<button>` cru vira
`<Button>`, o elemento deixa de casar com `button` e passa a herdar o
`button { }` global de `base.css`:

    button { min-height: 46px; border-radius: 999px; }

O botao de 28px da barra de formatação do editor vira 46px.

Por que `:where(button, .ui-button)` e a troca segura
------------------------------------------------------
Trocar a tag por `.ui-button` NAO e neutro em especificidade:

    .anc button                    -> (0,1,1)
    .anc .ui-button                -> (0,2,0)   sobe
    .anc :is(button, .ui-button)   -> (0,2,0)   sobe
    .anc :where(button, .ui-button)-> (0,1,1)   IGUAL

`:where()` tem especificidade zero por especificacao, entao o seletor
resultante e aritmeticamente identico ao original — e passa a casar com
os dois tipos de elemento. E o que o app ja usa de proposito em
`workspace-chrome.css` (`:where(.workspace-shell) button`).

O que este gate verifica
------------------------
1. Nenhuma regra de contexto usa a tag `button` sem `:where()`.
   Permitido: `:where(button, .ui-button)`.
2. base.css e a unica isencao: e o reset global, e ele DEVE usar a
   tag, porque define o padrao que o <Button> substitui (46px, raio
   999px). As regras `button:hover` e `button:disabled` de la fazem
   parte do mesmo reset.

Um seletor com `button` junto de classe (`.favorite-button`) nao conta:
o nome contem a palavra, mas nao e a tag.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Reset global: a unica regra que DEVE usar a tag isolada.
GLOBAL_OK = 'src/styles/base.css'

RE_BODY = re.compile(r'([^{}]+)\{([^{}]*)\}', re.S)
RE_COMMENT = re.compile(r'/\*.*?\*/', re.S)


def seletores_com_tag(sel):
    """Partes do seletor que usam `button` como TAG (nao como nome de
    classe)."""
    out = []
    for parte in sel.split(','):
        p = parte.strip()
        if not p:
            continue
        # remove :where(...) e :is(...) do calculo
        sem_pseudo = re.sub(r':(where|is)\([^)]*\)', '', p)
        # remove as classes: .favorite-button -> nada
        sem_classe = re.sub(r'\.[\w-]+', '', sem_pseudo)
        if re.search(r'(^|[\s>])button($|[\s>:])', sem_classe):
            out.append(p)
    return out


def main():
    css_files = sorted((ROOT / 'src').rglob('*.css'))
    if not css_files:
        print('FALHOU: nenhum .css encontrado em src/')
        return 1

    falhas = []
    for arq in css_files:
        rel = arq.relative_to(ROOT).as_posix()
        texto = arq.read_text(encoding='utf-8')
        for m in RE_BODY.finditer(texto):
            sel = RE_COMMENT.sub('', m.group(1)).strip()
            body = m.group(2)
            if not sel:
                continue
            for p in seletores_com_tag(sel):
                neutro = ':where(' in p
                if neutro:
                    continue
                if rel == GLOBAL_OK:
                    continue        # base.css: o reset global, por
                                      # definicao usa a tag. Ele e a
                                      # regra que define o padrao que o
                                      # <Button> substitui, entao
                                      # depende de continuar casando com
                                      # a tag crua.
                lin = texto[:m.start()].count('\n') + 1
                falhas.append((rel, lin, p, 'min-height' in body))

    for rel, lin, sel, tem_h in falhas:
        marca = ' [declara min-height]' if tem_h else ''
        print(f'  FALHA: {rel}:{lin}  {sel[:70]}{marca}')

    if falhas:
        print(f'\nFALHOU: {len(falhas)} regra(s) dependem da tag `button`.')
        print('Troque por `:where(button, .ui-button)`: especificidade '
              'identica, e passa a casar com <Button>.')
        return 1

    print('OK: nenhuma regra de contexto depende da tag `button` '
          f'({len(css_files)} arquivos .css).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
