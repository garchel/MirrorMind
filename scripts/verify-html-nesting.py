"""Gate: nenhum elemento de bloco dentro de <p>.

Por que este gate existe
------------------------
A CI do Windows falhava em "Frontend tests" sem relacao com o design
system. A causa era um aviso do React em stderr:

    In HTML, <ul> cannot be a descendant of <p>.
    This will cause a hydration error.

No job Windows o passo roda sob PowerShell, que converte stderr em
erro e sai com codigo 1. Um aviso de HTML invalido derrubava o build,
e o nome do passo nao dizia nada sobre a causa real. O aviso estava em
origin/main, intocado por este trabalho.

HTML nao permite elemento de fluxo de bloco (<ul>, <ol>, <div>,
<table>, <h1>…) dentro de <p> ou <label>: o parser fecha a tag
implicitamente, o que quebra a hydratacao no React 19.

Como este gate descobre a classe de bug
---------------------------------------
Nao basta procurar a string "<ul>": o problema e a ANINHAMENTO, e ele
pode atravessar varias linhas e varios componentes. O scanner aqui:

1. apaga comentarios (trocados por espacos, preservando offset) —
   sem isso, um <ul> mentioned num JSDoc conta como elemento;
2. respeita strings e template literals, porque um "//" dentro de uma
   URL apagaria o resto da linha;
3. para cada <p>, acha o </p> correspondente e ve se ha elemento de
   bloco entre eles.

Um teste so nao pegaria a variacao: em ReviewSessionPage o <ul> estava
dentro de um ternario, a seis linhas do <p>.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Elementos de fluxo de bloco. Inline (span, a, strong, em, code) sao
# permitidos dentro de <p>.
BLOQUEANTES = (
    'ul', 'ol', 'dl', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td',
    'th', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'main',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'form',
    'fieldset', 'figure', 'p',
)

# Tags cujo conteudo nao pode ser elemento de bloco.
#
# <label> NAO entra aqui: a especificacao permite <div> dentro de
# <label> (a restricao e sobre <label> aninhado e sobre outro controle
# de formulario como descendente DIRETO). O ReviewSessionPage tem
# <label><input/><div>...</div></label> numa opcao de radio, que e
# valido e comum. Incluir <label> produzia 9 falsos positivos.
ALVO = ('p',)

RE_ALVO = re.compile(r'<(p)(\s[^>]*?)?/?>', re.I)
RE_FECHA = None  # construido por tag


def strip_comments(text):
    """Mesmo comprimento, comentarios viram espacos."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in '\'"`':
            q = c
            i += 1
            while i < n:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2)
            j = n if j == -1 else j + 2
            for k in range(i, j):
                if out[k] != '\n':
                    out[k] = ' '
            i = j
            continue
        if text.startswith('//', i):
            j = text.find('\n', i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = ' '
            i = j
            continue
        i += 1
    return ''.join(out)


def verifica():
    arquivos = sorted(
        [p for p in (ROOT / 'src').rglob('*.tsx') if '.test.' not in p.name]
    )
    if not arquivos:
        print('FALHOU: nenhum .tsx encontrado em src/')
        return 1

    achados = []
    for arq in arquivos:
        texto = arq.read_text(encoding='utf-8')
        scan = strip_comments(texto)

        for m in RE_ALVO.finditer(scan):
            tag = m.group(1).lower()
            if scan[m.end() - 2:m.end()].strip() == '/':
                continue  # <p /> auto-fechado
            ini = m.end()
            fecha = re.compile(r'</' + tag + r'\s*>', re.I).search(scan, ini)
            if not fecha:
                continue
            corpo = scan[ini:fecha.start()]
            for b in BLOQUEANTES:
                if re.search(r'<' + b + r'[\s/>]', corpo):
                    lin = texto[:m.start()].count('\n') + 1
                    achados.append((arq, lin, tag, b))
                    break

    for arq, lin, tag, b in achados:
        rel = arq.relative_to(ROOT).as_posix()
        print(f'  FALHA: {rel}:{lin}  <{tag}> contem <{b}>')
        print('         HTML nao permite elemento de bloco dentro de '
              f'<{tag}>. Use um <div role="alert"> ou equivalente.')

    if achados:
        print(f'\nFALHOU: {len(achados)} aninhamento(s) de bloco invalido(s).')
        return 1

    print(f'OK: nenhum elemento de bloco dentro de <p> '
          f'({len(arquivos)} arquivos .tsx verificados).')
    return 0



def verifica_classname_dinamico():
    """Nenhuma interpolacao ${...} pode estar dentro de className="...".

    O bug
    -----
    scripts/migrate-buttons.py reescrevia o className de um template
    literal como se fosse string. Em tres botoes do App e do
    EditorHeader, a expressao virou texto:

        className="ui-button ... favorite-button${ativo ? ' is-active' : ''}"

    Isso COMPILA. O typecheck passa, o build passa, o teste passa. E a
    classe `is-active` nunca mais existe: o favorito ativo, o botao do
    indexador e o toggle de ferramentas markdown pararam de acender.
    Um bug de estado que so a inspecao visual pegaria — e que durou
    tres commits antes de ser encontrado.

    A forma correta e o template literal:

        className={`ui-button ... favorite-button${ativo ? ' is-active' : ''}`}

    Este gate e a forma barata de impedir que o migrador (ou um
    find-and-replace) faca isso de novo.
    """
    ruins = []
    for arq in sorted(
            [p for p in (ROOT / 'src').rglob('*.tsx')]):
        texto = arq.read_text(encoding='utf-8')
        for m in re.finditer(r'className="([^"]*)"', texto):
            if '${' in m.group(1):
                lin = texto[:m.start()].count('\n') + 1
                ruins.append((arq, lin, m.group(0)[:90]))
    for arq, lin, txt in ruins:
        print(f'  FALHA: {arq.relative_to(ROOT).as_posix()}:{lin}  {txt}')
    if ruins:
        print(f'\nFALHOU: {len(ruins)} className com ${{}} dentro de string '
              'literal. Use template literal com crase, nao aspas.')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(verifica() or verifica_classname_dinamico())
