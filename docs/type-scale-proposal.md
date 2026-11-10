# Escala tipográfica — aplicada (histórico da proposta)

> **Estado em 2026-11-10: aplicada.** A escala abaixo virou os 10 papeis
> `--font-size-*` em `semantic.css` e foi aplicada em `404f35c` (224
> tamanhos em 33 arquivos). As duas decisoes que faltavam foram tomadas:
> `small = 13px` e `caption = 12px`; 22px e 28px ficaram literais de
> proposito (+2/+4px em titulo de largura variavel aperta a linha, e
> nenhum gate mede layout). O gate `py -3 scripts/verify-type-scale.py`
> passou a cobrir tamanho (o `verify-tokenization` so cobre cor). O texto
> abaixo e o registro de como a proposta foi feita e por que ela esperou.

Na medicao original (antes de `404f35c`), o projeto **nao tinha nenhum
token de `font-size`**. Os 29 literais distintos abaixo foram medidos por
`scripts/type-scale.py`.

## Por que classifyi por papel, não por tamanho

A primeira versão do script agrupava por salto relativo entre vizinhos e
produziu **2 degraus**: `9px..36px` num só. Isso é honesto — abaixo de
~28px o app usa tamanho de forma contínua, sem degraus — mas "contínuo"
não é o mesmo que "sem escala".

A separação real do design está no **papel**, não no número:

- 9px é um kicker uppercase, tracking 0,12em
- 13px é corpo de painel denso
- 24px é título de página

Três níveis, três papéis — mesmo que 13px e 14px fiquem a 1px de
distância. Um degrau tipográfico é uma **função na hierarquia**, não um
incremento de pixel. Por isso o script classifica por papel e depois
confere se os papéis crescem em tamanho (sanidade: passa, sem inversão).

## A escala proposta

| papel | faixa hoje | literais | usos |
|---|---|---|---|
| `micro` | 9–10,5px | 9px, 9,5px, 10px, 10,5px | 50 |
| `caption` | 11–12px | 11px, 11,5px, 12px | 280 |
| `small` | 12,2–13px | 12,16rem, 12,48rem, 12,5px, 13px | 125 |
| `body-sm` | 13,1–14px | 13,12rem, 13,5px, 14px | 32 |
| `body-md` | 15–16px | 15px, 16px | 16 |
| `body-lg` | 17–18px | 17px, 18px | 12 |
| `lead` | 19–20px | 19px, 19,2rem, 20px | 4 |
| `title-sm` | 22–26px | 22px, 24px, 25,6rem, 26px | 9 |
| `title-md` | 28–36px | 28px, 32rem, 36px | 3 |
| `display` | 84px | 84px | 1 |

29 literais → 10 papéis, 532 ocorrências. Nomes por função
(`--font-size-caption`), não por número (`--font-size-12`): o nome por
função sobrevive a uma revisão de densidade.

## Por que a aplicação esperou

A troca é mecânica e **não move pixel** — `12.5px` vira
`var(--font-size-small)` apontando para `12.5px`. O que impedia era outro:

1. **O gate não prova isso.** `verify-tokenization` só conhece cor. Não
   tenho como demonstrar equivalência de tamanho automaticamente.
2. **O risco é layout, não cor.** 280 das 532 ocorrências são 11–12px em
   componentes de largura variável. Errar um degrau cabe um painel e
   quebra a tela inteira — e quebra **layout**, que nenhum gate atual
   mede.
3. **14 literais têm ≤ 2 usos** (`9px`, `12.16rem`, `13.12rem`…). São
   ajuste ad-hoc. Antes de tokenizar, alguém precisa decidir: eles
   entram em algum papel, ou somem?

## As decisoes que destravaram

As tres perguntas abaixo foram respondidas antes da aplicacao: `small`
ficou **13px** (o corpo padrao de painel), `caption` ficou **12px** (o
degrau mais usado do app) e `body-sm`/`body-md` ficaram **14/16px**.

- `small` estava partido entre `12,5px` e `13px` (125 usos). O corpo
  padrao de painel e 13px.
- `caption` eram 280 usos entre 11 e 12px; o escolhido foi 12px.
- `body-sm` vs `body-md` (14px vs 15px) viraram 14 e 16 — o degrau de
  1px era ruido.

Dado isso, a aplicacao foi feita em um commit com os gates rodando, e o
`verify-type-scale` foi criado para cobrir tamanho (com adicoes e
remocoes registradas por posicao, valor e motivo).

## Comando

```bash
py -3 scripts/type-scale.py          # tabela e sanidade
py -3 scripts/type-scale.py --json   # para processar
py -3 scripts/verify-type-scale.py   # gate (tamanho token a token)
```
