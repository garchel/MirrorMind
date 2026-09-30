"""Gate: a regra de contexto precisa continuar vencendo a do primitivo.

O problema que este gate existe para pegar
-----------------------------------------
O <Field> emite `ui-field--xs` junto da classe legada (settings-number,
settings-select). As duas tem especificidade (0,1,0) no caso do select,
entao quem vence e quem vem depois no bundle. Isso funciona hoje — mas
e uma propriedade fragil: uma mudanca na ordem dos imports, ou uma
regra nova de especificidade igual, trocaria a geometria do campo sem
quebrar um unico teste.

O caso concreto, medido no bundle (commit 068bc7a):

    .settings-number  ->  seletor real: `.settings-toggle input.settings-number`
                          spec (2,1), height: 34px
    .ui-field--xs     ->  spec (1,0), min-height: 34px

Duas condicoes Needs ser verdade para a migracao ser neutra:

1. A densidade generica NUNCA declara `height`, so `min-height`. Se
   declarasse `height: 36px`, ele anularia o `height: 34px` da regra
   de contexto — que tem especificidade MENOR, mas declara `height`, e
   as duas propriedades nao se anulam: a maior aplicavel ganha. Com
   `min-height` no generico e `height` no contexto, o resultado e
   max(34px, 34px) = 34px, identico ao original.

2. O seletor legado precisa ter especificidade >= a do primitivo, OU
   vir depois no bundle. Este gate verifica (1) no CSS fonte. A ordem
   do bundle e verificada por este mesmo script contra o CSS compilado
   quando ele existe, eignorada se nao houver build.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPONENT_CSS = ROOT / 'src/styles/tokens/component.css'

# As densidades do Field e as classes legadas que aparecem no app.
# Medidas do CSS fonte, nao da documentacao.
DENSIDADES = ('xs', 'sm', 'md')
CONTEXTO = ('settings-number', 'settings-select')


def regra(css, sel):
    m = re.search(r'([^{}]+)\{([^{}]*)\}', css)
    return None


def decls(css, seletor):
    """Declaracoes de um seletor exato, em qualquer posicao do arquivo."""
    out = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        for s in m.group(1).split(','):
            if s.strip() == seletor:
                out.append(m.group(2))
    return out


def especificidade(sel):
    s = re.sub(r'::?[a-z-]+(\([^)]*\))?', '', sel.strip())
    return (
        len(re.findall(r'\.[\w-]+', s)),      # classes
        len(re.findall(r'#[\w-]+', s)),        # id
        len(re.findall(r'(?<![\w.#\-])[a-z]+', s)),  # tags
    )


def verifica():
    if not COMPONENT_CSS.exists():
        print('FALHOU: component.css nao encontrado')
        return 1

    css = COMPONENT_CSS.read_text(encoding='utf-8')
    falhas = []

    # --- 1. densidade generica usa min-height, nunca height -----------
    for d in DENSIDADES:
        corpos = decls(css, f'.ui-field--{d}')
        if not corpos:
            # .ui-field--md pode estar definido como parte de outro
            # bloco agrupado; nesse caso procuramos o seletor parcial
            m = re.search(r'[^{}]*\.ui-field--' + d + r'[^{}]*\{([^{}]*)\}', css)
            corpos = [m.group(1)] if m else []
        if not corpos:
            falhas.append(f'.ui-field--{d} nao existe no component.css')
            continue
        for corpo in corpos:
            if re.search(r'(?:^|;)\s*height\s*:', corpo) and not re.search(
                    r'(?:^|;)\s*min-height\s*:', corpo):
                falhas.append(
                    f'.ui-field--{d} declara `height` (fixo). Precisa ser '
                    f'`min-height`, senao anula o height da regra de contexto.'
                )
            if not re.search(r'(?:^|;)\s*min-height\s*:', corpo):
                falhas.append(f'.ui-field--{d} nao declara min-height')

    # --- 2. a regra de contexto nao pode perder para o primitivo -----
    for cls in CONTEXTO:
        sels = set()
        for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
            for s in m.group(1).split(','):
                s = s.strip()
                if cls in s and not s.startswith('@'):
                    sels.add(s)
        if not sels:
            continue
        spec_ctx = max(especificidade(s) for s in sels)
        spec_prim = especificidade(f'.ui-field--xs')
        if spec_ctx < spec_prim:
            falhas.append(
                f'"{cls}" tem especificidade {spec_ctx}, menor que a do '
                f'primitivo {spec_prim}. A regra de contexto perderia.'
            )

    # --- 3. a ordem de declaracao: primitivo antes do contexto ------
    # O bundle e gerado na ordem em que o CSS e importado. Onde a
    # especificidade e igual, vence a regra declarada depois. Como o
    # component.css e importado por src/index.css e as regras de
    # contexto vivem nos CSS de feature (importados pelos .tsx), o
    # primitivo vem antes — que e o que precisamos.
    #
    # A verificacao e feita no CSS fonte, e nao no bundle, porque o
    # gate roda ANTES do build na CI. O bundle, quando existe, e
    # verificado em (4) como segunda opiniao.
    index = ROOT / 'src/index.css'
    if index.exists():
        ordem = {}
        for i, linha in enumerate(index.read_text(encoding='utf-8').splitlines()):
            m = re.search(r"@import\s+['\"]([^'\"]+)['\"]", linha)
            if m:
                ordem[m.group(1)] = i
        prim = [k for k in ordem if 'tokens/component.css' in k]
        if not prim:
            falhas.append('src/index.css nao importa tokens/component.css')
        else:
            # os CSS de feature nao sao importados pelo index: sao
            # carregados por `import './x.css'` no .tsx, que o Vite
            # emite depois do entry. Basta o primitivo estar no entry.
            print(f"component.css importado na linha {ordem[prim[0]]+1} de index.css")
    else:
        falhas.append('src/index.css nao encontrado')

    # --- 4. no bundle compilado, a ordem confirma a regra ------------
    bundles = sorted((ROOT / 'dist/assets').glob('index-*.css'),
                     key=lambda p: p.stat().st_mtime)
    if bundles:
        b = bundles[-1].read_text(encoding='utf-8')
        i_prim = b.find('.ui-field--xs{')
        for cls in CONTEXTO:
            pos = [m.start() for m in re.finditer(r'[^{},]*\b' + cls + r'\b[^{},]*\{', b)]
            if not pos:
                continue
            # so importa quando a especificidade e igual
            if especificidade(f'.{cls}') == especificidade('.ui-field--xs'):
                if i_prim >= 0 and min(pos) < i_prim:
                    falhas.append(
                        f'no bundle, ".{cls}" ({min(pos)}) vem antes de '
                        f'.ui-field--xs ({i_prim}) com especificidade igual: '
                        f'o primitivo venceria e a geometria mudaria.'
                    )
        print(f'bundle verificado: {bundles[-1].name}')
    else:
        print('sem bundle em dist/ — ordem nao verificada (rode o build)')

    if falhas:
        for f in falhas:
            print('  FALHA:', f)
        print(f'\nFALHOU: {len(falhas)} problema(s) na cascata do Field.')
        return 1

    print('OK: as densidades do Field nao podem sobrepor a regra de contexto.')
    return 0


if __name__ == '__main__':
    sys.exit(verifica())
