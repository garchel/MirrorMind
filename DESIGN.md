---
version: alpha
name: MirrorMind
description: Caderno noturno. Uma ferramenta de escrita local-first em papel quente e tinta de ardósia, com acentos quentes para ação e verdes frios para domínio.
colors:
  primary: "#1c2427"
  secondary: "#7e7466"
  tertiary: "#c46a2b"
  neutral: "#f8f6f0"
typography:
  body-md:
    fontFamily: Segoe UI
    fontSize: 1rem
    lineHeight: 1.5
  body-sm:
    fontFamily: Segoe UI
    fontSize: 0.875rem
    lineHeight: 1.5
  body-mono:
    fontFamily: Cascadia Code
    fontSize: 0.9375rem
    lineHeight: 1.6
  h1:
    fontFamily: Segoe UI
    fontSize: 3rem
    fontWeight: 600
    lineHeight: 0.94
    letterSpacing: "-0.05em"
  h2:
    fontFamily: Segoe UI
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.02
  h3:
    fontFamily: Segoe UI
    fontSize: 1.2rem
    fontWeight: 600
    lineHeight: 1.2
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  2xl: 24px
spacing:
  hair: 2px
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px
  10: 40px
  12: 48px
  16: 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#f7f2e7"
    rounded: "{rounded.md}"
    padding: 18
  button-secondary:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 18
  button-danger:
    backgroundColor: "#b3261e"
    textColor: "#fffdf8"
    rounded: "{rounded.md}"
    padding: 18
  field:
    backgroundColor: "#fffdf8"
    textColor: "{colors.primary}"
    rounded: "{rounded.xl}"
    padding: 14
  card:
    backgroundColor: "{colors.neutral}"
    textColor: "#4f4f49"
    rounded: "{rounded.xl}"
    padding: 18
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    rounded: "999px"
    padding: 3
  notice-error:
    backgroundColor: "#fdeceb"
    textColor: "#b3261e"
    rounded: "{rounded.xl}"
    padding: 16
---

# MirrorMind

## Overview

Caderno noturno: um app de escrita local-first onde a nota é um arquivo
`.md` num vault, sem servidor no caminho crítico. A linguagem visual é de
**papel** — fundo quente, tinta de ardósia, quase nenhum cinza puro — com um
laranja de barro (`tertiary`) reservado a ação e um verde-folha para o
domínio de domínio (revisão, metas, tags, bases).

A regra que governa tudo: **o app tem duas temperaturas de fundo.** A
Revisão e as páginas de dados rodam sobre papel quente (`#fbfaf6`); o
chrome do workspace (rail, abas, sidebar) roda sobre papel neutro frio
(`#1e1b21` no escuro). São os dois deliberadamente distintos — unificá-los
foi testado e rejeitado por diferença de contraste medido.

## Colors

- **Primary (`#1c2427`)** — ardósia profunda. Tinta de título, valor de
  campo e o fundo do botão primário. No tema escuro vira papel (`#e8e6dd`):
  as pontas trocam de lugar, os nomes não.
- **Tertiary (`#c46a2b`)** — barro. A **única** cor que significa
  "ação primária" ou "acento". Se dois elementos disputam atenção,
  o segundo não usa terracota: ele usa um slot de status.
- **Verde (`#2e6b4f`)** — a família de domínio. Sucesso, metas
  concluídas, tag válida, acento de dado. O app tem **40 matizes de
  verde** em uso; eles estão tokenizados um a um, mas consolidá-los é
  decisão visual pendente (ver `docs/design-system.md`).
- **Semânticos** — `--status-{ok,warn,bad,info,alt}`. Cada um tem 4
  slots: `ink` (texto), `ink-soft`, `bg` (realce cheio), `bg-soft`
  (lavagem). Só o `bg-soft` aceita texto por cima.

### Regra de acento

Um elemento **não** usa cor para ser notado. Ordem de tentativa:
1. peso ou tamanho de tinta (`--text-h` sobre `--text-muted`);
2. **superfície** (o estado ativo de uma aba é o fundo do editor
   aparecendo atrás dela, não uma cor);
3. status, apenas se o elemento for de fato um status.

## Typography

Duas famílias, sem terceira: `--sans` (Segoe UI) para tudo,
`--mono` (Cascadia Code) para código e para valores numéricos que
precisam alinhar em coluna (saldo, contador, timestamp). O editor
sobrescreve via `--editor-font-family` / `--editor-font-size`, porque
o usuário escolhe a fonte da própria nota.

Escala real em uso: 10px (kicker, `letter-spacing: 0.12em`, uppercase) /
11px (chip) / 12px / 13px / 15px (editor) / 18px (corpo) / 1.2rem (h3) /
2rem (h2) / clamp 3.1–5.2rem (h1).

## Layout

Escala 4pt. `--space-1` (4px) a `--space-16` (64px), mais três
micro-ajustes derivados da medição do app: `--space-hair` (2px, o anel de
um badge), `--space-tight` (6px) e `--space-loose` (14px). 59% dos
espaçamentos do app cai **fora** da grade de 4pt — a escala existe para
corrigir isso, não para descrever o que já estava ali.

Raios: 6 valores (`4/6/8/12/16/24px`). Pílula (`999px`) e círculo (`50%`)
são **formas**, não escala, e continuam literais.

## Components

- **Botão primário** — tinta cheia, **um por tela**. Se duas ações
  disputam atenção, uma é secundária.
- **Botão secundário** — o padrão do app (103 dos 117 botões). Contorno
  sobre a superfície.
- **Botão de perigo** — ação destrutiva, nunca a única ação da tela.
- **Aba ativa** — muda de *fundo*, não de tinta.
- **Chip** — rótulo inline. Opacidade 0.62 em repouso, 1 no hover;
  não compete com o conteúdo.

## Do's and Don'ts

- **Do** use `--status-*-bg-soft` para um aviso com texto por cima.
- **Do** mantenha `background` e `color` declarados juntos no mesmo
  seletor, em token canônico — nunca herde metade de uma regra global.
- **Don't** escreva um hex literal em qualquer lugar fora de
  `styles/tokens/primitive.css`. `npm run tokens:verify` falha se houver.
- **Don't** promova um token de página (`.goals-page`, `--tag-*`) para
  `:root`: vaza a cor para fora da página **e perde o tema**. Existe um
  verificador só para pegar isso (`verify-domain-tokens.py`).
- **Don't** resolva `--` divergência fundindo dois tokens "parecidos".
  6 dos 34 tokens `--review-*` divergiam do núcleo; ganharam nome
  próprio em vez de sobrescrever. Ver `verify-semantics.py`.
- **Don't** resolva contraste por `!important` — suba especificidade.
