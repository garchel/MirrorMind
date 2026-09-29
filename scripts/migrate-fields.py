"""Migra <input|select|textarea className="..."> para <Field>.

Sucesssor de migrate-buttons.py, com o mesmo scanner de tag — o
`text.find('>')` original quebrava em aria-label={`... ${x}`} e em
arrow function (=> tem um '>' que nao fecha tag), e a conferencia
precisa percorre a pilha de tags em vez de contar '<input' contra
'</input>'.

Duas diferencas em relacao ao migrador de botoes:

1. Tags podem ser auto-fechadas (<input ... />). O campo mais comum do
   app — 107 <input>, a maioria sem children — e auto-fechado. O
   scanner trata `/>` como abre-e-fecha.

2. O <select> tem children (<option>), que ficam dentro do par de tags.
   O fechamento procurado precisa ser o do proprio elemento, nao o de
   um filho.

Por que a migracao e segura
----------------------------
O <Field> emite a classe antiga junto das novas (`ui-field
ui-field--sm settings-number`). A regra antiga tem 1 classe, a nova
tambem — o desempate vai para a ordem no arquivo, e o
src/styles/tokens/component.css e importado depois de
src/styles/base.css, entao o componente ganha apenas nos campos que
base.css nao estiliza. Os que base.css estiliza (padding, borda,
min-height) a regra antiga ja define com o mesmo valor, medido do CSS
real. Nenhuma propriedade muda.
"""

import re
import sys
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# reaproveita o scanner ja validado do migrador de botoes
_spec = importlib.util.spec_from_file_location('mb', HERE / 'migrate-buttons.py')
_mb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mb)
tag_end = _mb.tag_end

TAGS = ('input', 'select', 'textarea')

# campos cujo visual NAO pode ser tocado: sao repositorios com estilos
# proprios completos (frontmatter usa grid, postit e sobreposto).
SKIP_CLASSES = {
    'frontmatter-panel-key',
    'frontmatter-panel-value',
    'postit-popover-input',
}


def cx(*parts):
    return ' '.join(p for p in parts if p)


def strip_comments(text):
    """Texto sem comentarios, com o mesmo comprimento (posicoes valem).

    O scanner achou um <select> dentro de um comentario JSDoc em
    GoalsPage.tsx e tentou procurar o </select> que nao existe ali. Como
    o migrador reescreve por offset, nao pode simplesmente remover o
    comentario — trocada cada letra por espaco, o offset de todo o
    resto permanece valido.

    Dois armadilhas que os testes nao pegaram e o app tem:

    1. `//` dentro de string. ReviewAiSettings tem
       placeholder="https://api.openai.com/v1" — sem o rastreio de
       aspas, o `//` apagava o resto da linha e o tag_end nunca
       achava o '>' de fechamento.
    2. `<input />` tem `/>` e nao e comentario; o tratador de aspas
       tambem precisa parar em aspas de atributo JSX.
    """
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in '\'"`':
            # consome a string inteira sem tocar em nada
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


def legacy_sets_height(cls):
    """A regra .<cls> no CSS do app ja fixa a altura?

    Sim  -> o Field nao deve emitir size, senao o min-height generico
            (34/36/48px) muda um campo que o app mediu em outro valor.
    Nao  -> emite size="xs" (34px, a altura mais comum do app).
    """
    for css in (ROOT / 'src').rglob('*.css'):
        text = css.read_text(encoding='utf-8')
        m = re.search(r'\.' + re.escape(cls) + r'\s*\{([^}]*)\}', text)
        if m:
            return bool(re.search(r'(?:^|;)\s*(?:min-)?height\s*:', m.group(1)))
    return False


def find_fields(text):
    """(ini, fim_de_abertura, fim_do_elemento) de cada campo."""
    out = []
    # os offsets sao lidos do texto SEM comentarios, mas as fatias vem
    # do texto original — os dois tem o mesmo comprimento.
    scan = strip_comments(text)
    for m in re.finditer(r'<(input|select|textarea)\b', scan):
        end = tag_end(scan, m.start())
        if end == -1:
            raise ValueError(f'tag sem fechamento em {m.start()}')
        head = scan[m.start():end + 1]
        if head.rstrip().endswith('/>'):
            out.append((m.start(), end, end + 1, m.group(1)))
            continue
        # fecha </input> | </select> | </textarea> correspondente. O
        # padrao e montado com re.escape porque o nome da tag vem do
        # achado — e um backreference (\1) nao serviria aqui, ja que o
        # grupo nao existe neste regex.
        name = m.group(1)
        close = re.compile(r'</' + re.escape(name) + r'\s*>', re.I)
        # procura no texto sem comentarios: um </select> dentro de um
        # comentario de outro componente nao fecha este select.
        cm = close.search(scan, end)
        if not cm:
            raise ValueError(f'sem </{name}> para {m.start()}')
        out.append((m.start(), end, cm.end(), m.group(1)))
    return out


def migrate_file(path, dry):
    raw = path.read_bytes()
    text = raw.decode('utf-8')
    n = 0

    # de tras para frente, para nao invalidar os offsets seguintes
    for ini, open_end, elem_end, tag in reversed(find_fields(text)):
        head = text[ini:open_end + 1]
        cm = re.search(r'className=(?:"([^"]*)"|\{`([^`]*)`\})', head, re.S)
        if not cm:
            continue
        cls = (cm.group(1) or cm.group(2) or '').strip()
        if not cls or cls in SKIP_CLASSES:
            continue

        # A densidade nao pode ser inventada. Quando a classe legada
        # ja declara height/min-height explicito — .settings-number tem
        # `height: 34px` — emitir size="sm" (min-height: 36px) mudaria
        # o campo em 2px. Nesses casos o migrador NAO emite size: a
        # regra antiga manda, que e o comportamento original.
        #
        # A verificacao e feita contra o CSS do app, nao contra uma
        # lista escrita a mao. Se a classe nao definir altura, o Field
        # usa o proprio xs=34px, que e a altura mais comum.
        self_closing = head.rstrip().endswith('/>')

        # reconstroi a abertura: troca a tag e acrescenta o `as`/size
        new_head = head
        if tag != 'input':
            new_head = new_head.replace(f'<{tag}', f'<Field as="{tag}"', 1)
        else:
            # input e o padrao do Field, mas a tag precisa mudar de
            # nome: sem isso o `size="sm"` colide com o `size?: number`
            # nativo do HTML e o typecheck acusa.
            new_head = new_head.replace('<input', '<Field', 1)
        if not legacy_sets_height(cls):
            # so quando a regra antiga nao fixa a altura
            new_head = new_head.replace(
                'className=', 'size="xs"\n            className=', 1)

        replacement = new_head
        if not self_closing:
            replacement += text[open_end + 1:elem_end].replace(
                f'</{tag}>', '</Field>', 1)

        text = text[:ini] + replacement + text[elem_end:]
        n += 1

    if not n or dry:
        return n

    # import
    if 'ui/Field' not in text:
        rel = os.path.relpath(ROOT / 'src/components/ui/Field', path.parent)
        rel = rel.replace('\\', '/')
        lines = text.split('\n')
        last = 0
        for i, l in enumerate(lines):
            if l.startswith('import'):
                last = i + 1
        lines.insert(last, f"import {{ Field }} from '{rel}'")
        text = '\n'.join(lines)

    # conferencia estrutural
    def balanced(src, name):
        depth = 0
        for m in re.finditer(r'<' + name + r'\b|</' + name + r'>', src):
            if m.group(0).startswith('</'):
                depth -= 1
            else:
                e = tag_end(src, m.start())
                if e == -1:
                    return False
                if not src[m.start():e + 1].rstrip().endswith('/>'):
                    depth += 1
            if depth < 0:
                return False
        return depth == 0

    if not balanced(text, 'Field'):
        print(f'  ABORTA {path}: <Field> desbalanceado')
        return 0

    # preserva EOL original
    eol = '\r\n' if b'\r\n' in raw else '\n'
    if eol == '\r\n':
        text = text.replace('\n', '\r\n')
    path.write_bytes(text.encode('utf-8'))
    return n


import os  # noqa: E402  (usado no calculo do caminho relativo)


def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args
    files = [a for a in args if not a.startswith('--')]
    if files:
        targets = [Path(f) for f in files]
    else:
        targets = sorted(ROOT.glob('src/**/*.tsx'))
        targets = [t for t in targets if not t.name.endswith('.test.tsx')]
        # o proprio Field.tsx ja e o componente: migra-lo produziria
        # <Field> dentro de <Field>.
        targets = [t for t in targets if t.name != 'Field.tsx']

    total = 0
    for t in targets:
        try:
            n = migrate_file(t, dry)
        except (ValueError, UnicodeDecodeError) as e:
            print(f'  ABORTA {t.name}: {e}')
            continue
        if n:
            total += n
            print(f'{n:4d}  {t.relative_to(ROOT).as_posix()}')
    print(f'\n{total} campos migrados' + (' (dry-run)' if dry else ''))


if __name__ == '__main__':
    main()
