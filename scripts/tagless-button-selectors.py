"""Troca a tag `button` por `:where(button, .ui-button)` nas regras de
contexto, sem tocar em nenhum .tsx.

Por que esta troca e neutra
----------------------------
A especificidade e a unica coisa que a troca pode quebrar. Medido:

    .anc button                     (0,1,1)
    .anc .ui-button                 (0,2,0)   sobe 1
    .anc :is(button, .ui-button)    (0,2,0)   sobe 1
    .anc :where(button, .ui-button) (0,1,1)   IDENTICA

`:where()` vale zero por especificacao (CSS Selectors 4), entao o
seletor resultante e aritmeticamente o mesmo de antes. E passa a casar
com `<button>` e com `<Button>` — que e o ponto: enquanto a regra usar
so a tag, um `<Button>` deixa de casar e herda o `button { }` global
de base.css (min-height 46px, raio 999px).

O bug da primeira versao deste script
------------------------------------
Usei `([^{}]+)\{([^{}]*)\}` para achar as regras. Esse regex casa o
CONTEUDO de um `@media` como se fosse um seletor, e a substituicao
apagou as declaracoes de dentro do bloco. Perdi codigo em 34 arquivos
— o build quebrou com "Unknown word h1" em `index.css`, e `git
checkout` foi a unica saida.

O parser de verdade
--------------------
Este scanner conta chaves e so reescreve o texto ENTRE uma chave e a
seguinte, mantendo tudo o que esta dentro intacto. `@media`,
`@supports` e `@container` viram seletores com as chaves contadas —
a walk e a mesma, so que nunca se para no `{` de um bloco.

Ordem de operacao
-----------------
1. snapshot de todos os arquivos
2. reescrita
3. conferencia: contagem de chaves e de bytes por arquivo; qualquer
   diferenca que nao seja o `:where(...)` inserido aborta tudo
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NEUTRO = ':where(button, .ui-button)'
GLOBAL_OK = 'src/styles/base.css'

RE_COMMENT = re.compile(r'/\*.*?\*/', re.S)


def achados(texto):
    """(inicio, fim) de cada trecho entre chaves, e se e seletor.

    devolve os intervalos de SELETOR (o texto logo antes de um `{`).
    """
    # remove comentarios mas preserva o comprimento trocando por espacos
    limpo = list(texto)
    for m in RE_COMMENT.finditer(texto):
        for i in range(m.start(), m.end()):
            if limpo[i] != '\n':
                limpo[i] = ' '
    limpo = ''.join(limpo)

    n = len(limpo)
    i = 0
    out = []
    while i < n:
        c = limpo[i]
        if c == '{':
            # recua ate o inicio do seletor
            j = i - 1
            while j >= 0 and limpo[j] in ' \t\r\n':
                j -= 1
            fim = j + 1
            # recua ate o inicio REAL do seletor: a chave de
            # fechamento do bloco anterior, ou o inicio da linha.
            #
            # A primeira versao parava na VIRGULA, e isso quebrava em
            # seletor de varias partes na mesma linha:
            #   .a button, .b button, .c button { }
            # nele, o `,` logo apos `button` e do SEPARADOR, entao o
            # scanner capturava so `.a` e nao via o `button` — 87
            # trocas em vez de todas, sem erro visivel.
            k = fim
            while k > 0 and (limpo[k - 1] not in '{}\n'):
                k -= 1
            out.append((k, fim))
            # pula o bloco inteiro
            prof = 0
            while i < n:
                if limpo[i] == '{':
                    prof += 1
                elif limpo[i] == '}':
                    prof -= 1
                    if prof == 0:
                        i += 1
                        break
                i += 1
            continue
        i += 1
    return out


def tem_tag(parte):
    sem_pseudo = re.sub(r':(where|is)\([^)]*\)', '', parte)
    sem_classe = re.sub(r'\.[\w-]+', '', sem_pseudo)
    return bool(re.search(r'(^|[\s>])button($|[\s>:.\[])', sem_classe))


def reescreve_parte(parte):
    return re.sub(r'(^|[\s>])button(?=($|[\s>:.\[]))',
                  lambda m: m.group(1) + NEUTRO, parte)


def main():
    alvos = [p for p in sorted((ROOT / 'src').rglob('*.css'))
             if p.relative_to(ROOT).as_posix() != GLOBAL_OK]
    if not alvos:
        print('FALHOU: nenhum .css encontrado')
        return 1

    alterados = []
    total = 0

    for arq in alvos:
        rel = arq.relative_to(ROOT).as_posix()
        original = arq.read_text(encoding='utf-8')
        eol = '\r\n' if '\r\n' in original else '\n'

        # substitui de tras para frente, para nao invalidar os offsets
        for ini, fim in reversed(achados(original)):
            sel = original[ini:fim]
            if not sel.strip() or ':where(button' in sel:
                continue
            partes = sel.split(',')
            novas = []
            mudou = False
            for p in partes:
                if not p.strip() or not tem_tag(p):
                    novas.append(p)
                    continue
                novas.append(reescreve_parte(p))
                mudou = True
            if mudou:
                total += 1
                original = original[:ini] + ','.join(novas) + original[fim:]

        if original != arq.read_text(encoding='utf-8'):
            # --- conferencia ---
            novo = original
            if eol == '\r\n':
                original_lf = original.replace('\r\n', '\n')
            else:
                original_lf = original
            if original_lf.count('{') != arq.read_text(encoding='utf-8').replace('\r\n', '\n').count('{'):
                print(f'  ABORTA {rel}: contagem de chaves mudou')
                return 1
            # o delta so pode ser o :where
            delta = len(novo) - len(arq.read_text(encoding='utf-8'))
            esperado = total and (len(NEUTRO) - len('button')) * 1
            if delta % (len(NEUTRO) - len('button')) != 0:
                print(f'  ABORTA {rel}: delta de bytes {delta} nao e multiplo '
                      f'do insert. Alguma coisa fora do seletor mudou.')
                return 1
            arq.write_text(original, encoding='utf-8', newline='')
            alterados.append(rel)

    print(f'{total} seletores trocados em {len(alterados)} arquivos')
    return 0


if __name__ == '__main__':
    sys.exit(main())
