"""Migra <button className="secondary-button"> para <Button>.

Por que um script e nao um find-and-replace
-----------------------------------------
A primeira tentativa usou regex em
`<button[^>]*className="secondary-button"[^>]*>` e nao migrou NENHUM dos
5 botoes do SyncConflictsDialog: o className esta em outra linha da
tag de abertura, e o `[^>]*` com o default do re nao atravessa
quebra de linha sem DOTALL. A segunda, com DOTALL,遷 substituiu a
tag de abertura e esqueceu a de fechamento -- quebrando o JSX.

Este migrador, entao, faz o trabalho em tres passos com conferencia
entre eles:

  1. varre o arquivo token a token, casando `<button ...>` e `</button>`
     por profundidade, e identifica quais aberturas sao alvo (tem
     className com uma das tres classes de botao);
  2. reescreve a classe e a etiqueta de abertura, e a de fechamento
     correspondente, SEM tocar em nada entre elas (o conteudo do
     botao -- incluindo outros botoes aninhados -- fica intacto);
  3. roda a conferencia: a contagem de `<Button` tem de casar com a de
     `</Button>`, e a de `<button` com `</button`. Se nao casar,
     aborta sem escrever.

Idempotente: rodar de novo nao encontra alvos e nao faz nada.

    python scripts/migrate-buttons.py --dry-run
    python scripts/migrate-buttons.py --file src/features/x.tsx
    python scripts/migrate-buttons.py            # todos os .tsx
"""
import re
import os
import sys
import glob
import argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# className -> (variante, classe antiga a preservar, densidade)
VARIANTS = {
    'primary-button': ('primary', 'primary-button', 'md'),
    'danger-button': ('danger', 'danger-button', 'sm'),
    'secondary-button': ('secondary', 'secondary-button', 'sm'),
}


def read(path):
    return open(os.path.join(ROOT, path), encoding='utf-8').read()


def write(path, text, nl):
    with open(os.path.join(ROOT, path), 'wb') as fh:
        fh.write(text.encode('utf-8'))


def tag_end(text, start):
    """Offset do '>' que fecha a tag de abertura em `start`.

    Nao pode ser text.find('>'): um atributo com template literal --
    aria-label={`Abrir detalhes ${goal.title}`} -- contem '>' antes do
    fechamento real da tag. O GoalsPage tem um botao assim, e o erro
    fazia o scanner considerar que a tag terminava no '>' da
    interpolacao, lendo o resto como texto e perdendo a conta.

    Anda respeitando: aspas simples/duplas, template literal com
    ${...} aninhado, e comentarios de atributo.
    """
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if c in '\'"':
            q = c
            i += 1
            while i < n:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == q:
                    break
                i += 1
        elif c == '`':
            i += 1
            depth = 0
            while i < n:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == '$' and i + 1 < n and text[i + 1] == '{':
                    depth += 1
                    i += 2
                    continue
                if text[i] == '}' and depth:
                    depth -= 1
                    i += 1
                    continue
                if text[i] == '`' and depth == 0:
                    break
                i += 1
        elif c == '=' and i + 1 < n and text[i + 1] == '>':
            i += 2          # arrow function: o '>' nao fecha a tag
            continue
        elif c == '>':
            return i
        i += 1
    return -1

def find_buttons(text):
    """[(abre_start, abre_end, fecha_start, fecha_end, className)]"""
    out = []
    stack = []
    for m in re.finditer(r'<(button|Button)\b|</(button|Button)>', text):
        tok = m.group(0)
        if tok.startswith('</'):
            if stack:
                open_s, open_e, _cn = stack.pop()
                out.append((open_s, open_e, m.start(), m.end(), _cn))
            continue
        if tok.startswith('<Button'):
            continue          # ja migrado
        # fecha a tag de abertura, podendo estar em outra linha
        end = tag_end(text, m.start())
        if end == -1:
            continue
        tag = text[m.start():end + 1]
        # <button ... /> e auto-fechado: nao empilha. O GoalsPage tem um
        # assim (o overlay do card) e conta-lo como aberto desbalanceava o
        # arquivo inteiro -- o que fez o gate abortar a migracao dele.
        self_closing = tag.rstrip().endswith('/>')
        cm = re.search(r'className=(?:"([^"]*)"|\{`([^`]*)`\})', tag)
        cn = (cm.group(1) or cm.group(2)) if cm else ''
        if self_closing:
            out.append((m.start(), end + 1, end + 1, end + 1, cn))
        else:
            stack.append((m.start(), end + 1, cn))
    return out


def classify(class_name):
    """(variante, densidade) ou None."""
    if not class_name:
        return None
    tokens = class_name.split()
    for t in tokens:
        if t in VARIANTS:
            return VARIANTS[t][0], VARIANTS[t][2]
    return None


def migrate_file(path, dry):
    text = read(path)
    nl = '\r\n' if '\r\n' in text else '\n'
    buttons = find_buttons(text)
    targets = []
    for open_s, open_e, close_s, close_e, cn in buttons:
        got = classify(cn)
        if got:
            targets.append((open_s, open_e, close_s, close_e, cn, got))
    if not targets:
        return 0

    new = text
    for open_s, open_e, close_s, close_e, cn, (variant, size) in reversed(targets):
        # 1) reescreve a classe na tag de abertura
        tag = new[open_s:open_e]
        # mantem as classes de contexto, troca a de variante
        kept = [t for t in cn.split()
                if t not in ('primary-button', 'secondary-button',
                             'danger-button')]
        ui = ['ui-button', f'ui-button--{variant}', f'ui-button--{size}']
        # reemite preservando a ordem relativa das classes de contexto
        rest = ' '.join(kept)
        newcls = ' '.join(ui + ([rest] if rest else []))
        tag = re.sub(r'className=(?:"[^"]*"|\{`[^`]*`\})',
                     f'className="{newcls}"', tag)
        tag = tag.replace('<button', '<Button', 1)
        if close_s == close_e and new[open_e - 2:open_e].rstrip().endswith('/>'):
            # <button ... />: so a abertura existe, nao ha fechamento para
            # reescrever. `<Button ... />` continua valido em JSX.
            new = new[:open_s] + tag + new[open_e:]
        else:
            # 2) fecha correspondente
            closing = new[close_s:close_e].replace('</button>', '</Button>', 1)
            new = new[:open_s] + tag + new[open_e:close_s] + closing + new[close_e:]

    # import
    if 'ui/Button' not in new and "from 'react'" in new:
        rel = os.path.relpath('src/components/ui/Button',
                              os.path.dirname(os.path.join(ROOT, path)))
        rel = rel.replace('\\', '/').replace('.tsx', '')
        if not rel.startswith('.'):
            rel = './' + rel
        m = re.search(r"^import .*?from 'react'.*?$", new, re.M)
        new = new[:m.end()] + f"\nimport {{ Button }} from '{rel}'" + new[m.end():]

    # Conferencia. Nao basta contar '<button' contra '</button>': uma
    # tag auto-fechada (`<button ... />`, o overlay do card no
    # GoalsPage) abre e fecha sozinha, e a conta simples accuse
    # desbalanceamento num arquivo perfeitamente valido. O teste certo e o
    #结构性: percorrer as tags e confirmar que a pilha volta a zero.
    def balanced(src, name):
        depth = 0
        for m in re.finditer(r'<' + name + r'\b|</' + name + r'>', src):
            tok = m.group(0)
            if tok.startswith('</'):
                depth -= 1
            else:
                end = tag_end(src, m.start())
                if end == -1:
                    return False
                if not src[m.start():end + 1].rstrip().endswith('/>'):
                    depth += 1
            if depth < 0:
                return False
        return depth == 0

    if not balanced(new, 'Button') or not balanced(new, 'button'):
        print(f'  ABORTA {path}: tags desbalanceadas apos a migracao')
        return 0
    if not dry:
        write(path, new, nl)
    return len(targets)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', action='append',
                    help='arquivo .tsx especifico (repetivel)')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    if args.file:
        files = args.file
    else:
        files = [os.path.relpath(f, ROOT).replace('\\', '/')
                 for f in glob.glob(os.path.join(ROOT, 'src/**/*.tsx'),
                                    recursive=True)]

    total = touched = 0
    for path in files:
        if not path.endswith('.tsx'):
            continue
        n = migrate_file(path, args.dry_run)
        if n:
            total += n
            touched += 1
            print(f'  {n:3d}  {path}')
    print(f'\n{total} botoes em {touched} arquivos'
          f'{" (dry-run)" if args.dry_run else " migrados"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
