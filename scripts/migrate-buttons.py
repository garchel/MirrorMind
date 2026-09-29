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
        else:
            if tok.startswith('<Button'):
                continue          # ja migrado
            # le a className dentro da tag de abertura
            end = text.find('>', m.start())
            tag = text[m.start():end + 1]
            cm = re.search(r'className=(?:"([^"]*)"|\{`([^`]*)`\})', tag)
            cn = (cm.group(1) or cm.group(2)) if cm else ''
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

    # conferencia
    if (new.count('<Button') != new.count('</Button>') or
            new.count('<button') != new.count('</button>')):
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
