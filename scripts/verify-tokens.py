"""Acha tokens usados e nunca definidos (regra morta) e hex que escaparam.

Este e o gate que teria pegado o `--space-4` que eu mesmo introduzi ao
criar component.css: um var() sem definicao NAO da erro no build, a
declaracao simplesmente nao se aplica. Pior dentro de um shorthand
(`font:`, `background:`) um var() indefinido invalida a DECLARACAO
INTEIRA -- tamanho, peso e familia caem, nao so a familia.

    python scripts/verify-tokens.py
"""
import re
import os
import sys
import glob
import argparse
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEF_RE = re.compile(r'^\s*(--[a-z][a-z0-9-]*)\s*:', re.M)
USE_RE = re.compile(r'var\(\s*(--[a-z][a-z0-9-]*)\s*(\,[^)]*?)?\)')
HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')


def css_files():
    out = []
    for pat in ('src/*.css', 'src/**/*.css'):
        out.extend(glob.glob(os.path.join(ROOT, pat), recursive=True))
    return sorted(set(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--strict-hex', action='store_true',
                    help='falha se sobrar hex fora de primitive.css')
    args = ap.parse_args()

    files = css_files()
    defined = {}          # token -> arquivo que define
    local_scoped = {}     # token -> seletor onde e escopado
    uses = collections.Counter()
    use_where = collections.defaultdict(set)
    hexes = collections.defaultdict(list)

    for f in files:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        text = open(f, encoding='utf-8').read()
        # definicoes
        for m in re.finditer(r'([^{}]*)\{([^{}]*)\}', text, re.S):
            sel = re.sub(r'^/\*.*?\*/\s*', '', ' '.join(m.group(1).split()), flags=re.S)
            for t in DEF_RE.findall(m.group(2)):
                defined.setdefault(t, rel)
                if not sel.startswith(':root'):
                    local_scoped.setdefault(t, set()).add(sel[:44] or '(vazio)')
        # usos
        for t in USE_RE.findall(text):
            uses[t] += 1
            use_where[t].add(rel)
        for h in HEX_RE.findall(text):
            hexes[rel].append(h)

    # 1) var() sem definicao -- a regra morta
    #
    # Distingue dois casos que NAO sao a mesma coisa:
    #   var(--x, valor)  -> override opcional com fallback. Legal, o
    #                       fallback cobre. NAO e erro.
    #   var(--x)         -> orfao de verdade. A declaracao nao se aplica,
    #                       e dentro de um shorthand (font:, background:) a
    #                       declaracao INTEIRA e invalidada.
    dead, optional = [], []
    for f in files:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        text = open(f, encoding='utf-8').read()
        for m in USE_RE.finditer(text):
            tok, fallback = m.group(1), m.group(2)
            if tok in defined:
                continue
            (optional if fallback else dead).append((tok, rel))
    uses = collections.Counter()
    for f in files:
        for m in USE_RE.finditer(open(f, encoding='utf-8').read()):
            uses[m.group(1)] += 1
    # 1b) token de componente definido e nunca lido
    #
    # Este nao e erro de sintaxe: o build passa, o navegador ignora o
    # token. E a forma mais silenciosa de o design system divergir do
    # app — a camada 3 cresce descrevendo coisas que ninguem usa.
    #
    # Havia 19 deles (--button-height: 46px, --tab-*, --notice-*). Os
    # de botao carregavam 46px e 32px, que nao existem em nenhuma
    # regra do app; os de tab descreviam uma aba que usa tokens do
    # dominio workspace; os de notice descreviam um aviso inline que o
    # app nao tem (o .error-banner e um toast com tokens proprios).
    #
    # Nao basta contar: um token de componente e definitionally lido
    # pelo proprio component.css (e o .ui-button--xs que consome
    # --button-size-xs-height), entao o gate precisa varrer o CSS
    # inteiro, como ja faz acima.
    comp_tokens = set()
    comp_css = os.path.join(ROOT, 'src/styles/tokens/component.css')
    if os.path.exists(comp_css):
        ctext = open(comp_css, encoding='utf-8').read()
        for m in re.finditer(
                r'^\s*(--(?:button|field|card|chip|panel|notice|tab|ui)-[a-z0-9-]+)\s*:',
                ctext, re.M):
            comp_tokens.add(m.group(1))
    comp_dead = sorted(t for t in comp_tokens if uses.get(t, 0) == 0)
    if comp_dead:
        for t in comp_dead:
            print(f'  [3] token de componente SEM consumidor: {t}')
        print(f'\nFALHOU: {len(comp_dead)} token(s) de componente definido(s) '
              f'e nunca lido(s). Ou o primitivo os usa, ou nao deveria '
              f'estar em component.css.')
        return 1

    # tokens definidos no :root do arquivo, mas usados em um escopo que
    # pode nao alcanca-los, e tokens definidos so localmente e usados fora
    # desse escopo (o vazamento de --tag-* que quase aconteceu)
    leaked = []
    for t, sc in local_scoped.items():
        users = use_where[t] - {defined.get(t, '')}
        if not users:
            continue
        leaked.append((t, sorted(sc), sorted(users)))

    # 2) hex residual
    stray_hex = {k: v for k, v in hexes.items()
                 if not k.endswith('tokens/primitive.css')}

    print(f'arquivos: {len(files)}  tokens definidos: {len(defined)}  '
          f'usos de var(): {sum(uses.values())}')
    print(f'\n[1] var() ORFAO (sem definicao e sem fallback): {len(dead)}')
    seen = collections.Counter()
    for t, rel in dead:
        seen[t] += 1
    for t, n in seen.most_common(20):
        where = [r for tk, r in dead if tk == t][:1]
        print(f'    {t:28s} {n:3d}x  em {where}')
    print(f'\n[1b] var() com fallback (override opcional, OK): {len(optional)} '
          f'em {len({t for t, _ in optional})} tokens')
    print(f'\n[2] token de escopo local usado FORA desse escopo: {len(leaked)}')
    for t, sc, users in leaked[:10]:
        print(f'    {t:26s} escopo {sc[:1]} -> {users[:2]}')
    print(f'\n[3] hex literal fora de primitive.css: {sum(len(v) for v in stray_hex.values())}')
    for k, v in sorted(stray_hex.items(), key=lambda x: -len(x[1]))[:6]:
        print(f'    {len(v):4d}  {k}')

    failed = bool(dead) or (args.strict_hex and stray_hex)
    if failed:
        print('\nFALHOU: regras mortas' + (' ou hex solto' if args.strict_hex else ''))
        return 1
    print('\nOK: nenhum var() orfao.' +
          (' Nenhum hex solto.' if args.strict_hex else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
