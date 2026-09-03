"""Fase 6: tokeniza os CSS de review (hex claro -> var(--review-*)) e emite
os tokens (claro+dark) para colar no index.css. Idempotente: apaga blocos
DARK AUTO antigos e não reescreve vars já tokenizadas."""
import re, glob, json

M = {
    # superfícies
    '#fbfaf6': 'surface', '#fdfcf8': 'surface', '#f2f1ec': 'raised',
    '#f7f6f1': 'sunk', '#f6f4ee': 'sunk', '#f4f2ec': 'sunk', '#f3f1ea': 'sunk',
    '#f2efe6': 'sunk', '#efede6': 'sunk', '#f0efe9': 'sunk', '#f7f5ee': 'header',
    '#fffefa': 'field', '#fffdf8': 'field', '#fffef9': 'field', '#fff': 'field',
    # linhas
    '#d9d7d0': 'line', '#e3e1da': 'line-soft', '#e3e1d9': 'line-soft',
    '#c8c6be': 'line-strong', '#d3d0c6': 'line-strong', '#cfccc2': 'line-strong',
    '#ecebe5': 'line-soft', '#e6e4de': 'line-soft', '#e8e6df': 'line-soft',
    '#e6e3d8': 'line-soft', '#e6e4dc': 'line-soft', '#d8d4ca': 'line',
    # tintas
    '#20201e': 'ink', '#33332e': 'ink-soft', '#353531': 'ink-soft',
    '#3c3c37': 'text', '#3d3d38': 'text', '#4f4f49': 'text',
    '#4d4d48': 'text', '#2b2b26': 'ink', '#292925': 'ink',
    '#5f5f59': 'faint', '#5d5c55': 'faint', '#5d4b25': 'warn-strong',
    # muteds
    '#686862': 'muted', '#73736d': 'muted', '#8a8a82': 'faint',
    '#8b897f': 'faint', '#6f6b5f': 'muted', '#6b6a63': 'muted',
    '#8a887f': 'faint', '#aaa79e': 'muted-2', '#b9b7ae': 'muted-2',
    '#8a5a2a': 'accent-soft', '#7a4a12': 'warn-strong', '#8b4a20': 'accent-soft',
    # verdes
    '#1e7b34': 'ok', '#3f5239': 'ok-soft', '#1d4d1d': 'ok-soft',
    '#2f6b33': 'ok', '#2f6b3a': 'ok', '#4f7d48': 'ok',
    '#cde8cf': 'ok-bg', '#cfe3c4': 'ok-bg', '#8fc98a': 'ok-bg-strong',
    '#e6f4ea': 'ok-bg-soft',
    # âmbar
    '#9a6700': 'warn', '#7a5c10': 'warn',
    '#ffe5a5': 'warn-bg', '#fdf3e3': 'warn-bg-soft', '#fff7df': 'warn-bg-soft',
    '#fdecc8': 'warn-bg', '#d1a23d': 'warn',
    # vermelho
    '#8f2c1d': 'bad', '#b3261e': 'bad', '#a12828': 'bad',
    '#7c3f36': 'bad-strong', '#6a352d': 'bad-strong',
    '#ffc9c2': 'bad-bg', '#fdeceb': 'bad-bg-soft', '#ffb4c8': 'bad-bg',
    '#fff8f5': 'bad-bg-soft',
    # azul
    '#1a5f8a': 'info', '#e8f1f8': 'info-bg',
    # lilás
    '#e3e0f2': 'alt-bg', '#f4f2fb': 'alt-bg-soft', '#e9e6f7': 'alt-bg-soft',
    '#cfc9e8': 'alt-line', '#b9b3dd': 'alt-line', '#5c5490': 'alt', '#4a4470': 'alt',
}

BEGIN = '/* ==== DARK AUTO (review)'
END = '/* ==== /DARK AUTO ==== */'

def norm(h):
    return h.lower() if len(h) == 7 else ('#' + ''.join(c*2 for c in h[1:])).lower()

union = {}
for f in sorted(glob.glob('src/features/review/*.css')):
    text = open(f, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in text else '\n'
    text = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\s*', '', text, flags=re.S)
    def sub(m):
        h = norm(m.group(0))
        tok = M.get(h)
        if not tok: return m.group(0)
        union.setdefault(tok, h)
        return f'var(--review-{tok})'
    newtext = re.sub(r'#[0-9a-fA-F]{3,8}\b', sub, text)
    uses = newtext.count('var(--review-')
    if newtext != text:
        open(f, 'w', encoding='utf-8', newline='').write(newtext)
    print(f'{f}: {uses} usos')

print('\n=== TOKENS (colar no index.css) ===')
for tok in sorted(union):
    print(f'--review-{tok}: {union[tok]};')
print(f'\n{len(union)} tokens no union')
