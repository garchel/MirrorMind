"""Dark pass da Revisão: para cada regra com cores claras hardcoded, emite
um bloco [data-theme='dark'] com os valores mapeados (padrão noturno do app).
Idempotente: remove blocos gerados anteriormente antes de regerar."""
import re, sys, glob

# mapa light -> dark (padrão noturno de goals/tags/bases)
M = {
    # superfícies creme
    '#fbfaf6': '#2b2721', '#fdfcf8': '#2b2721', '#f2f1ec': 'rgb(232 230 221 / 6%)',
    '#f7f6f1': 'rgb(232 230 221 / 6%)', '#f6f4ee': 'rgb(232 230 221 / 6%)',
    '#f4f2ec': 'rgb(232 230 221 / 6%)', '#f3f1ea': 'rgb(232 230 221 / 6%)',
    '#f2efe6': 'rgb(232 230 221 / 6%)', '#efede6': 'rgb(232 230 221 / 6%)',
    '#f0efe9': 'rgb(232 230 221 / 6%)', '#f7f5ee': 'rgb(232 230 221 / 6%)',
    # campos/raised brancos
    '#fffefa': '#211d18', '#fffdf8': '#211d18', '#fffef9': '#211d18',
    # linhas
    '#d9d7d0': 'rgb(232 230 221 / 16%)', '#e3e1da': 'rgb(232 230 221 / 9%)',
    '#e3e1d9': 'rgb(232 230 221 / 9%)', '#c8c6be': 'rgb(232 230 221 / 24%)',
    '#d3d0c6': 'rgb(232 230 221 / 20%)', '#cfccc2': 'rgb(232 230 221 / 20%)',
    '#ecebe5': 'rgb(232 230 221 / 9%)', '#e6e4de': 'rgb(232 230 221 / 9%)',
    '#e8e6df': 'rgb(232 230 221 / 9%)', '#e6e3d8': 'rgb(232 230 221 / 9%)',
    '#e6e4dc': 'rgb(232 230 221 / 9%)', '#d8d4ca': 'rgb(232 230 221 / 16%)',
    '#d1d0c9': 'rgb(232 230 221 / 16%)', '#d7cfc1': 'rgb(232 230 221 / 16%)',
    # tintas escuras
    '#20201e': '#e8e6dd', '#33332e': '#d6d4cd', '#353531': '#cfccc2',
    '#3c3c37': '#c9c7c0', '#3d3d38': '#c9c7c0', '#4f4f49': '#b8b8ae',
    '#4d4d48': '#b8b8ae', '#2b2b26': '#e8e6dd', '#292925': '#e8e6dd',
    '#4a4470': '#b3abd9', '#5c5490': '#b3abd9', '#5d5c55': '#a09c90',
    '#5f5f59': '#a09c90', '#5d4b25': '#d9b56a', '#4a4470': '#b3abd9',
    # muteds
    '#686862': '#a09c90', '#73736d': '#8f8f85', '#8a8a82': '#a09c90',
    '#8b897f': '#a09c90', '#6f6b5f': '#a09c90', '#6b6a63': '#a09c90',
    '#8a887f': '#a09c90', '#aaa79e': '#8f8f85', '#6f6f66': '#a09c90',
    '#b9b7ae': '#8f8f85', '#8a5a2a': '#e8a06b', '#7a4a12': '#d9b56a', '#8b4a20': '#e8a06b',
    # ---- status pills ----
    # verde
    '#1e7b34': '#5aa07f', '#3f5239': '#7fb894', '#1d4d1d': '#7fb894',
    '#2f6b33': '#7fb894', '#2f6b3a': '#7fb894', '#4f7d48': '#5aa07f',
    '#cde8cf': 'rgb(90 160 127 / 24%)', '#cfe3c4': 'rgb(90 160 127 / 24%)',
    '#8fc98a': 'rgb(90 160 127 / 32%)', '#e6f4ea': 'rgb(90 160 127 / 16%)',
    # âmbar
    '#9a6700': '#d9b56a', '#7a5c10': '#d9b56a', '#5f5f59': '#a09c90',
    '#ffe5a5': 'rgb(233 180 87 / 22%)', '#fdf3e3': 'rgb(233 180 87 / 14%)',
    '#fff7df': 'rgb(233 180 87 / 12%)', '#fdecc8': 'rgb(233 180 87 / 18%)',
    '#d1a23d': '#d9b56a',
    # branco puro (campos/chips) -> campo noturno
    '#fff': '#211d18', '#ffffff': '#211d18',
    # vermelho
    '#8f2c1d': '#d98a6a', '#b3261e': '#d98a6a', '#a12828': '#d98a6a',
    '#7c3f36': '#c96a4e', '#6a352d': '#b05a40', '#8f2c1d': '#d98a6a',
    '#ffc9c2': 'rgb(217 106 78 / 22%)', '#fdeceb': 'rgb(217 106 78 / 14%)',
    '#ffb4c8': 'rgb(217 106 78 / 26%)', '#fff8f5': 'rgb(217 106 78 / 12%)',
    '#fdeceb': 'rgb(217 106 78 / 14%)',
    # azul
    '#1a5f8a': '#79a8ff', '#e8f1f8': 'rgb(121 168 255 / 14%)',
    # lilás
    '#e3e0f2': 'rgb(180 170 230 / 18%)', '#f4f2fb': 'rgb(180 170 230 / 12%)',
    '#e9e6f7': 'rgb(180 170 230 / 14%)', '#cfc9e8': 'rgb(180 170 230 / 30%)',
    '#b9b3dd': 'rgb(180 170 230 / 40%)',
}

MARK_BEGIN = '/* ==== DARK AUTO (review) — gerado por scripts/gen-review-dark.py; edite o gerador, não este bloco ==== */'
MARK_END = '/* ==== /DARK AUTO ==== */'

HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')
HEX_NORM = lambda h: h.lower() if len(h) == 7 else ('#' + ''.join(c*2 for c in h[1:])).lower()

def map_value(val):
    """Mapeia cada hex dentro do valor (inclusive dentro de color-mix/rgba)."""
    def sub(m):
        h = HEX_NORM(m.group(0))
        return M.get(h, m.group(0))
    return HEX_RE.sub(sub, val)

def rule_has_light(sel, body):
    for m in HEX_RE.finditer(body):
        if HEX_NORM(m.group(0)) in M:
            return True
    return False

def transform_rules(text):
    """Devolve lista de (selector, body) de topo (fora de @media) com cor mapeável."""
    out = []
    # remove comentários para parse
    stripped = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', stripped):
        sel, body = m.group(1).strip(), m.group(2)
        if '@' in sel:  # pula media/supports
            continue
        sels = [s.strip() for s in sel.split(',') if s.strip()]
        if not sels: continue
        # seletores com pseudo estado que dependem de tema claro (ex. :hover)
        if rule_has_light(sel, body):
            out.append((sels, body))
    return out

def gen(paths):
    for path in paths:
        text = open(path, encoding='utf-8', newline='').read()
        nl = '\r\n' if '\r\n' in text else '\n'
        # remove bloco gerado anteriormente
        text = re.sub(re.escape(MARK_BEGIN) + r'.*?' + re.escape(MARK_END) + r'\s*', '', text, flags=re.S)
        rules = transform_rules(text)
        chunks = [MARK_BEGIN, '/* Tema escuro (caderno noturno): réplica das regras claras com a',
                  ' * paleta noturna do app (mesmo padrão de goals/tags/bases). */']
        for sels, body in rules:
            dark_body = map_value(body)
            if dark_body == body: continue
            # prefixa seletores
            prefixed = ', '.join('[data-theme=\'dark\'] ' + s for s in sels)
            chunks.append(prefixed + ' {' + dark_body.rstrip().rstrip(';') + ';}')
        chunks.append(MARK_END)
        block = nl.join(chunks) + nl
        open(path, 'w', encoding='utf-8', newline='').write(text.rstrip() + nl + nl + block)
        print(f'{path}: {len(rules)} regras -> bloco dark')

if __name__ == '__main__':
    files = sorted(glob.glob('src/features/review/*.css'))
    gen(files)
