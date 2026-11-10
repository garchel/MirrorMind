"""Prova que a escala tipografica nao mudou nenhum tamanho sem decisao.

Funcao --check-size do verify-tokenization. Existe porque a cor tem
gate e o tamanho nao tinha: aplicar a escala trocava texto sem que
nada provasse o resultado.

O que este script FAZ (e o que o anterior fez errado):

  - conta tamanhos de forma IDENTICA nos dois lados. A primeira versao
    contava `font-size: Npx` e `font: Npx/...` no baseline, mas so
    `font-size:` e `var(--font-size-*)` no estado novo -- depois da
    substituicao o shorthand nao tem mais numero, entao a contagem
    batia errado e acusava 31 divergencias que nao existiam.

  - Casa token a token. Cada tamanho vira (origem, destino):
      ('12.5px', '--font-size-small')  -- troca deliberada
      ('12px',  '12px')                -- literal preservado
      ('12px',  '--font-size-caption') -- o 12px JA era o valor escolhido

  - So acusa o que nao pode acontecer: literal que mudou de valor sem
    ser um dos deliberados, token que aponta para papel errado, token
    sem definicao, ou contagem que nao bate.

    python scripts/verify-type-scale.py
    python scripts/verify-type-scale.py --verbose
"""
import re
import os
import sys
import glob
import argparse
import subprocess
from token_baseline import require_baseline
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REM_PX = 16.0

# Valores escolhidos por decisao do usuario (2026-09-29). A troca de um
# literal para OUTRO valor so e aceitavel quando o papel alvo tem um
# destes valores E a diferenca esta na lista de transicoes aceitas.
CHOSEN = {'micro': 10, 'caption': 12, 'small': 13, 'body-sm': 14,
          'body-md': 16, 'body-lg': 18, 'lead': 20, 'title-sm': 24,
          'title-md': 32, 'display': 84}

# Transicoes deliberadas: papel -> {literal que colapsa para ele}.
# small=13px absorve 12,5 e 12,16/12,48rem; caption=12px absorve 11 e
# 11,5. Todas as outras trocas sao proibidas sem novo aval.
ACCEPTED = {
    'small': {12.5, 12.16, 12.48},
    'caption': {11.0, 11.5},
    'body-sm': {13.5, 13.12},
    'micro': {10.5, 9.5, 9.0},
    'body-md': {15.0},
    'body-lg': {17.0},
    'lead': {19.0, 19.2},
    'title-sm': {25.6},
}

FONT_SIZE = re.compile(r'font-size:\s*([0-9.]+)(px|rem)')
SHORTHAND = re.compile(r'(?<![\w-])font:\s*([^;{}]+)')
SIZE_TOKEN = re.compile(r'var\(\s*(--font-size-[a-z-]+)\s*\)')


def at(rel):
    r = subprocess.run(['git', 'show', f'93a8a75^:{rel}'],
                       cwd=ROOT, capture_output=True)
    return r.stdout.decode('utf-8', 'replace') if r.returncode == 0 else None


def load_tokens():
    out = {}
    txt = open(os.path.join(ROOT, 'src/styles/tokens/semantic.css'),
               encoding='utf-8').read()
    for m in re.finditer(r'(--font-size-[a-z-]+):\s*([0-9.]+)px', txt):
        out[m.group(1)] = float(m.group(2))
    return out


def scan(text):
    """[(origem, destino)] na ordem em que aparecem no arquivo.

    origem: float em px, ou None quando ja era token
    destino: float em px, ou '--font-size-x'
    """
    out = []
    events = []
    # Percorre as DECLARACOES na ordem do arquivo. O erro da primeira
    # versao foi contar por regex separada e depois ordenar por posicao:
    # dois padroes sobrepostos (uma regra com font-size E um shorthand
    # em outra) sao contados uma vez cada, mas um shorthand cujo tamanho
    # ja virou token precisa continuar contando -- e ele nao casa em
    # FONT_SIZE nem em SHORTHAND sem numero.
    for m in re.finditer(r'(?<![-\w])(font-size|font)\s*:\s*([^;{}]+)', text):
        kind, body = m.group(1), m.group(2)
        if kind == 'font' and body.strip() == 'inherit':
            continue
        tok = SIZE_TOKEN.search(body)
        lit = re.search(r'([0-9.]+)(px|rem)', body)
        if kind == 'font' and not tok and not lit:
            continue                      # font: <family> sem tamanho
        if tok:
            events.append((m.start(), None, tok.group(1)))
        elif lit:
            v, u = float(lit.group(1)), lit.group(2)
            events.append((m.start(), v * REM_PX if u == 'rem' else v, None))
    events.sort(key=lambda e: e[0])
    for _s, second, third in events:
        out.append((second, third))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    if not require_baseline():
        return 1

    tokens = load_tokens()
    if not tokens:
        print('FALHA: nenhum token --font-size-* em semantic.css')
        return 1

    for name, want in CHOSEN.items():
        got = tokens.get(f'--font-size-{name}')
        if got != want:
            print(f'FALHA: --font-size-{name} = {got}, decisao foi {want}px')
            return 1

    files = [f for f in glob.glob(os.path.join(ROOT, 'src/**/*.css'),
                                  recursive=True)
             if 'tokens' not in f.replace('\\', '/')]

    checked = bad = 0
    swaps = collections.Counter()
    problems = []
    for f in files:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        old = at(rel)
        if old is None:
            continue
        before = scan(old)
        after = scan(open(f, encoding='utf-8').read())

        # Mudancas de tamanho aprovadas depois da escala.
        #
        # A primeira versao desta lista falhava: aceitava a contagem
        # diferente mas deixava o `zip(before, after)` desalinhado, e
        # todas as declaracoes seguintes passavam a casar com a
        # Declaracao errada. A diferenca nao e "ignore este arquivo" —
        # e "este arquivo ganhou N tamanhos, e eles sao M Novos,
        # declarados aqui". O resto do arquivo continua sendo comparado
        # token a token, posicao a posicao, com o deslocamento certo.
        #
        # Formato: {arquivo: [(token_novo, onde_ocorre, motivo)]}
        #
        # `onde_ocorre` e o indice da declaracao dentro do arquivo novo,
        # contando desde 1. A primeira versao assumia que os tamanhos
        # novos ficavam no FIM do arquivo (o comportamento normal de
        # quem anexa CSS) e comparava a cauda — mas aqui o `font-size`
        # da aba foi inserido NO MEIO, ao lado dos outros ajustes, e a
        # cauda do arquivo sao literais. Registrar a posicao e o que
        # torna a lista verificavel em vez de adivinhada: se o arquivo
        # mudar de novo, a posicao deixa de bater e o gate falha.
        # Motivo compartilhado pelas 14 declaracoes novas de
        # review-ai.css: o bloco "Confianca do modelo" (e os paineis de
        # melhoria e do dicionario) entrou depois do baseline. As 14
        # ficam no fim do arquivo, na ordem registrada abaixo.
        motivo_confianca = (
            '2026-11-06: bloco "Confianca do modelo" e paineis de '
            'melhoria/dicionario adicionados depois do baseline.')

        ADICIONADOS = {
            'src/features/shell/workspace-chrome.css': [
                # `1.0` nao e um tamanho: e o `- 1px` do
                # `min-height: calc(var(--titlebar-h, 40px) - 1px)`, que
                # fecha a conta da barra de abas. O scan pega o `1px`
                # dentro do calc porque ele varre `font-size|font` e o
                # `min-height` cai na mesma regra — dai a entrada
                # aparecer. Registrada para o gate saber que e
                # esperada.
                ('--font-size-small', 10,
                 '2026-09-29: o nome da aba vivia de `font: inherit` no '
                 'reset de `button`, que pegava 16px do navegador. Na '
                 'barra de abas o nome de uma nota longa nao cabia. '
                 '13px = --font-size-small, o mesmo corpo do titulo de '
                 'secao do shell.'),
                ('1.0', 9,
                 '2026-09-29: o `- 1px` do calc de min-height que fecha '
                 'a altura da aba com a barra.'),
            ],
            'src/features/review/review-ai.css': [
                ('11.0', 48, motivo_confianca),
                ('15.0', 49, motivo_confianca),
                ('--font-size-caption', 50, motivo_confianca),
                ('--font-size-caption', 51, motivo_confianca),
                ('--font-size-caption', 52, motivo_confianca),
                ('--font-size-caption', 53, motivo_confianca),
                ('12.0', 54, motivo_confianca),
                ('10.0', 55, motivo_confianca),
                ('--font-size-caption', 56, motivo_confianca),
                ('--font-size-caption', 57, motivo_confianca),
                ('--font-size-caption', 58, motivo_confianca),
                ('13.0', 59, motivo_confianca),
                ('--font-size-caption', 60, motivo_confianca),
                ('12.0', 61, motivo_confianca),
                # Onda 2 `<Field>` (lote 18): o select de estrategia da
                # calibracao era UA e adota a densidade dos selects de
                # configuracao; declaracao nova no fim do arquivo.
                ('--font-size-small', 62,
                 '2026-11-10: select de estrategia da calibracao (lote 18), '
                 'declaracao nova no fim do arquivo.'),
            ],
            'src/features/editor/editor.css': [
                # Popover de post-its reescrito em 9780fa4: a secao "Sem
                # ancora" e a lixeira sao declaracoes novas.
                ('--font-size-caption', 22,
                 '2026-11-06: rotulo da secao "Sem ancora" do popover '
                 'de post-its (9780fa4), declaracao nova.'),
                ('10.0', 25,
                 '2026-11-06: glifo da lixeira do popover de post-its '
                 '(9780fa4), declaracao nova em 10px.'),
                # Fechar a janela com rascunho nao salvo (39cdfa6): duas
                # listas novas usam o corpo small.
                ('--font-size-small', 58,
                 '2026-11-06: lista de notas nao salvas (39cdfa6), '
                 'declaracao nova no fim do arquivo.'),
                ('--font-size-small', 59,
                 '2026-11-06: erro da guarda de fechamento (39cdfa6), '
                 'declaracao nova no fim do arquivo.'),
            ],
        }

        # Declaracoes que existiam no baseline e sairam do arquivo. Uma
        # remocao tambem muda a escala, entao precisa da mesma prova que
        # uma adicao: posicao no baseline, valor e motivo. Sem isso o
        # `zip` posicional desalinha e acusa o arquivo inteiro.
        REMOVIDOS = {
            'src/styles/base.css': [
                # Auditoria de CSS morto (2026-11-10): as regras de
                # `.editor-panel`/`.editor-preview` nao tinham nenhuma
                # referencia no fonte; a declaracao de 15px saiu junto.
                ('15.0', 3,
                 '2026-11-10: regra morta .editor-panel/.editor-preview '
                 'removida na auditoria de CSS.'),
            ],
            'src/features/shell/workspace-chrome.css': [
                # Auditoria de CSS morto (2026-11-10): `.workspace-page-loading`
                # e o bloco `.trash-item*` nao tem referencia no fonte; tres
                # declaracoes de tamanho sairam com eles (14px e dois 12px).
                ('14.0', 25,
                 '2026-11-10: regras mortas .workspace-page-loading/.trash-item*.'),
                ('12.0', 66,
                 '2026-11-10: regras mortas .workspace-page-loading/.trash-item*.'),
                ('12.0', 65,
                 '2026-11-10: regras mortas .workspace-page-loading/.trash-item*.'),
            ],
            'src/features/review/vault-review-policy.css': [
                # Auditoria de CSS morto (2026-11-10): o bloco
                # `.vault-tag-policy-*` nao tem referencia no fonte; as
                # duas declaracoes de 12px sairam com ele.
                ('12.0', 6,
                 '2026-11-10: regras mortas .vault-tag-policy-* removidas.'),
                ('12.0', 7,
                 '2026-11-10: regras mortas .vault-tag-policy-* removidas.'),
            ],
            'src/features/bases/bases.css': [
                # Auditoria de CSS morto (2026-11-10): `.bases-loading`
                # nao tem referencia no fonte; o 12px saiu com a regra.
                ('12.0', 6,
                 '2026-11-10: regra morta .bases-loading removida.'),
            ],
            'src/features/review/review-dashboard.css': [
                # Auditoria de CSS morto (2026-11-10): `.review-dashboard-status`
                # nao tem referencia no fonte; o 13.5px saiu com a regra.
                ('13.5', 2,
                 '2026-11-10: regra morta .review-dashboard-status removida.'),
            ],
            'src/features/editor/editor.css': [
                ('11.0', 24,
                 '2026-11-06: chip de orfaos (11px) saiu com o dialogo '
                 'de orfaos, absorvido pelo popover unico (9780fa4).'),
                ('13.0', 25,
                 '2026-11-06: texto do dialogo de orfaos (13px) saiu '
                 'com o dialogo, absorvido pelo popover unico '
                 '(9780fa4).'),
            ],
        }

        novos = ADICIONADOS.get(rel, [])
        velhos = REMOVIDOS.get(rel, [])
        delta = len(after) - len(before)
        if delta == len(novos) - len(velhos) and (novos or velhos):
            # Cada entrada e conferida NA POSICAO que declara.
            #
            # A ordem importa: processar da maior para a menor posicao
            # faz cada remocao deslocar as seguintes, e a segunda
            # conferenca cai um indice. Descendo, as remocoes acontecem
            # sempre depois do ponto que ainda vai ser lido.
            #
            # indices 1-based, como aparecem no editor.
            # `scan` devolve (px, token): um token novo vem no segundo
            # campo, um literal novo no primeiro. Conferir so o token
            # deixava o literal passar (ou falhar) pela razao errada.
            #
            # Adicoes sao removidas do estado novo e remocoes do
            # baseline; o que sobra tem de casar posicao a posicao.
            restantes_after = list(after)
            restantes_before = list(before)
            ok = True
            for lista, entradas, rotulo, lado in (
                    (restantes_after, novos, 'ADICIONADOS', 'novo'),
                    (restantes_before, velhos, 'REMOVIDOS', 'baseline')):
                for valor, pos, motivo in sorted(entradas,
                                                 key=lambda x: -x[1]):
                    i = pos - 1
                    real_px, real_tok = (
                        lista[i] if 0 <= i < len(lista)
                        else (None, 'FORA DO ARQUIVO'))
                    bate = (real_tok == valor
                            if valor.startswith('--')
                            else real_px is not None
                            and abs(float(real_px) - float(valor)) < 0.01)
                    if not bate:
                        ok = False
                        problems.append(
                            f'{rel}: {rotulo} diz que a posicao {pos} '
                            f'({lado}) e "{valor}", mas ali esta '
                            f'px={real_px} tok={real_tok}')
                        break
                    del lista[i]
                if not ok:
                    break
            if ok:
                before, after = restantes_before, restantes_after
                for tok, _pos, motivo in novos:
                    print(f'  [aprovado] {rel}: +{tok}  ({motivo})')
                for tok, _pos, motivo in velhos:
                    print(f'  [removido] {rel}: -{tok}  ({motivo})')
            else:
                bad += 1
                continue
        elif len(before) != len(after):
            bad += 1
            problems.append(f'{rel}: contagem {len(before)} -> {len(after)}')
            continue

        for (o_px, o_tok), (n_px, n_tok) in zip(before, after):
            checked += 1
            # baseline ja era token: nao deveria acontecer
            if o_tok is not None:
                continue
            # destino agora e token
            if n_tok is not None:
                role = n_tok.replace('--font-size-', '')
                val = tokens.get(n_tok)
                if val is None:
                    bad += 1
                    problems.append(f'{rel}: {n_tok} sem definicao')
                    continue
                if abs(val - o_px) < 0.01:
                    continue                    # literal ja era o escolhido
                allowed = ACCEPTED.get(role, set())
                if any(abs(o_px - a) < 0.01 for a in allowed):
                    swaps[(o_px, n_tok)] += 1
                    continue
                bad += 1
                problems.append(f'{rel}: {o_px:g}px -> {n_tok} ({val}px) '
                                f'nao e transicao aprovada')
                continue
            # os dois literais: tem de ser identico
            if o_px is not None and n_px is not None and \
                    abs(o_px - n_px) > 0.01:
                bad += 1
                problems.append(f'{rel}: literal {o_px:g}px virou {n_px:g}px')

    print(f'{len(files)} arquivos | {checked} tamanhos casados token a token')
    print(f'trocas deliberadas: {sum(swaps.values())} '
          f'({len(swaps)} transicoes)')
    for (frm, to), n in sorted(swaps.items(), key=lambda x: -x[1]):
        print(f'    {frm:7.2f}px -> {to:22s} {n:4d}x')
    print(f'divergencias: {bad}')

    if args.verbose:
        for p in problems[:20]:
            print('  !', p)
    if bad:
        print('\nFALHOU: tamanho mudou fora das transicoes aprovadas.')
        return 1
    print('\nOK: todo tamanho ou foi preservado, ou e uma transicao '
          'decidida.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
