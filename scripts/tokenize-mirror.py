"""Tokeniza o CSS do MirrorMind: hex literais -> var(--mm-*).

Fase 1 (primitivas): deriva o nome de cada hex a partir da luminancia
relativa WCAG dentro da familia de matiz, emite src/styles/tokens/primitive.css
e reescreve os arquivos de src/ trocando o literal pelo var().

Idempotente: rodar duas vezes nao muda nada (o hex ja virou var()).
Perda zero: cada hex vira um token de valor IDENTICO, entao nenhum pixel
muda -- a consolidacao das paletas duplicadas e um passo visual separado.

Uso:
    python scripts/tokenize-mirror.py            # mapeia + reescreve
    python scripts/tokenize-mirror.py --dry-run  # so o relatorio
"""
import re
import os
import sys
import json
import glob
import argparse
import colorsys
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Familia de matiz por faixa. 'ink' cobre os neutros (saturacao < 14) e por
# isso e testado antes: um cinza-esverdeado de matiz 150 e ink, nao sage.
FAMILIES = [
    ('ink', None),      # neutro: sat < NEUTRAL_SAT
    ('brick', (0, 15)),
    ('clay', (15, 45)),
    ('gold', (45, 70)),
    ('moss', (70, 125)),
    ('sage', (125, 165)),
    ('teal', (165, 195)),
    ('azure', (195, 235)),
    ('lilac', (235, 290)),
    ('rose', (290, 360)),
]
NEUTRAL_SAT = 14
# Ordem de emissao: neutro primeiro, depois as familias em ordem de matiz.
FAM_ORDER = ['ink', 'gold', 'clay', 'brick', 'moss', 'sage',
             'teal', 'azure', 'lilac', 'rose']

# Steps derivados da luminancia relativa: 50 = mais claro, 950 = mais escuro.
SCALE = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500,
         550, 600, 650, 700, 750, 800, 850, 900, 950]

# Contexto de declaracao: hex em 'color'/'background' e pintando a superficie,
# em 'border-color', ou virando alpha de um rgb(). Isso decide se o token
# primitivo pode ser compartilhado ou precisa de um canal alpha proprio.
HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')


def norm_hex(h):
    """#abc/#abcd -> #aabbcc/#aabbccdd. 8 digitos sao preservados."""
    h = h.lower()
    if len(h) == 4:
        return '#' + ''.join(c * 2 for c in h[1:])
    if len(h) == 5:
        return '#' + h[1] + ''.join(c * 2 for c in h[2:5])
    return h


def to_rgb(h):
    h = norm_hex(h)
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def hls(h):
    r, g, b = [v / 255 for v in to_rgb(h)]
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    return hh * 360, ss * 100, ll * 100


def rel_lum(h):
    """Luminancia relativa WCAG (0 = preto, 1 = branco)."""
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = to_rgb(h)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def family_of(h):
    x, s, _ = hls(h)
    if s < NEUTRAL_SAT:
        return 'ink'
    for name, rng in FAMILIES:
        if rng and rng[0] <= x < rng[1]:
            return name
    return 'rose'


def step_of(h):
    """Step do ponto mais proximo da luminancia, em escala 50..950."""
    l = rel_lum(h)
    return min(SCALE, key=lambda st: abs((st - 50) / 900 - (1 - l)))


def build_names(usage):
    """hex -> --mm-<familia>-<step>[-N]. Ordem determinista e monotona."""
    buckets = collections.defaultdict(list)
    for h, count in usage.items():
        buckets[(family_of(h), step_of(h))].append(h)
    name = {}
    for (fam, step), hexes in sorted(buckets.items()):
        for j, h in enumerate(sorted(hexes)):
            token = f'--mm-{fam}-{step}' if j == 0 else f'--mm-{fam}-{step}-{j + 1}'
            name[h] = token
    return name


def sort_key(nm):
    m = re.match(r'--mm-([a-z]+)-(\d+)', nm)
    fam, step = m.group(1), int(m.group(2))
    return (FAM_ORDER.index(fam) if fam in FAM_ORDER else 99, step, nm)


def css_files():
    out = []
    for pat in ('src/*.css', 'src/**/*.css'):
        out.extend(glob.glob(os.path.join(ROOT, pat), recursive=True))
    return sorted(set(out))


def collect_usage(files):
    usage = collections.Counter()
    for f in files:
        text = open(f, encoding='utf-8').read()
        for m in HEX_RE.findall(text):
            usage[norm_hex(m)] += 1
    return usage


def emit_primitive(name, usage, out_path):
    lines = [f'  {name[h]}: {h};' for h in sorted(name, key=lambda x: sort_key(name[x]))]
    header = f"""/* ==================================================================
 * CAMADA 1 — PRIMITIVAS
 * Gerado por scripts/tokenize-mirror.py. NAO editar a mao.
 *
 * O step deriva da luminancia relativa WCAG (50 = mais claro, 950 = mais
 * escuro) dentro da familia de matiz; o sufixo -N desempata hex distintos
 * que caem no mesmo step. Nenhum valor tem significado semantico -- quem
 * decide o uso e a camada 2 (semantic.css).
 *
 * {len(name)} primitivas de cor em {len(usage)} hex distintos de src/**.
 *
 * A escala de espacamento NAO esta aqui: e medida, nao cor, e ja tinha
 * dono (--radius-*, --sans, --mono vivem no :root de index.css). A escala
 * de espaco derivou da medicao real do app -- ver emit_spacing().
 * ================================================================== */
:root {{
"""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(header + '\n'.join(lines) + '\n}\n')
    return len(lines)


def rewrite(files, name, dry_run):
    """Troca o hex pelo var() sem mexer em nada mais."""
    changed, total = [], 0
    for f in files:
        text = open(f, encoding='utf-8', newline='').read()
        nl = '\r\n' if '\r\n' in text else '\n'
        # nao tokenizar o proprio arquivo de tokens
        if os.path.basename(f) in ('primitive.css', 'semantic.css', 'component.css'):
            continue
        body = text.replace('\r\n', '\n')
        hits = 0

        def sub(m):
            nonlocal hits
            h = norm_hex(m.group(0))
            tok = name.get(h)
            if tok is None:
                return m.group(0)
            hits += 1
            return f'var({tok})'

        new = HEX_RE.sub(sub, body)
        if hits and not dry_run:
            with open(f, 'w', encoding='utf-8', newline=nl) as fh:
                fh.write(new)
        if hits:
            changed.append((os.path.relpath(f, ROOT), hits))
            total += hits
    return changed, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true',
                    help='so o relatorio, nao escreve nada')
    args = ap.parse_args()

    files = css_files()
    usage = collect_usage(files)
    name = build_names(usage)
    out = os.path.join(ROOT, 'src/styles/tokens/primitive.css')

    n = len(name)
    print(f'hex distintos: {n}  usos: {sum(usage.values())}  arquivos: {len(files)}')

    if not args.dry_run:
        emit_primitive(name, usage, out)
        print(f'primitivas emitidas: {n} -> {os.path.relpath(out, ROOT)}')

    changed, total = rewrite(files, name, args.dry_run)
    print(f'\nhex trocados por var(): {total}'
          f'{" (dry-run)" if args.dry_run else ""}')
    for f, h in sorted(changed, key=lambda x: -x[1])[:12]:
        print(f'  {h:4d}  {f}')
    if len(changed) > 12:
        print(f'  ... e mais {len(changed) - 12} arquivos')


if __name__ == '__main__':
    main()
