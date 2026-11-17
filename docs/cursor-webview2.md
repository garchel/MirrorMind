# Cursor invisível no WebView2 (Windows)

## Sintoma

O ponteiro perde o contorno preto e fica invisível sobre o papel claro do app.
Acontece de forma mais visível ao **apertar e arrastar um nó no grafo 2D** (a mão
fecha: `grab` → `grabbing`), e em outros momentos que trocam a forma do cursor.

## Causa

Não é CSS do app. O Windows 11 compõe a tela em **planos** (MPO — *Multi-Plane
Overlay*) e o cursor é um plano separado, desenhado por cima com transparência.
Quando duas coisas coincidem no mesmo quadro:

1. o WebView2 promove uma **camada nova** (abrir popover, montar o canvas,
   recalcular um `backdrop-filter`); e
2. a **forma do cursor muda**,

o plano do cursor é atualizado pela metade: a forma nova chega, a máscara de
transparência fica velha. O preenchimento branco aparece, o contorno preto não.

## O que foi testado (e o resultado)

| tentativa | resultado |
|---|---|
| `color-scheme: light` no `:root` | já existia; garante a variante preta, **não** resolve o plano errado |
| cursor de texto em SVG (`--text-cursor`) | resolve o I-beam; a forma do cursor deixa de vir do bitmap do SO |
| repintura do cursor (`nudgeCursor`) em qualquer troca de forma + `pointerdown` | **não resolve**: reenviar a forma não conserta o plano |
| remover `backdrop-filter` dos overlays do grafo | reduz a frequência (a camada nova deixa de ser recriada a cada quadro), mas sozinho **não resolve** |
| cursores de mão redesenhados em SVG | resolve, mas o produto **não quer** cursores customizados |
| `--disable-gpu` (tudo na CPU) | **resolve** — caminho de desenho sem planos |
| **`--disable-gpu-compositing`** (adotado) | **resolve**, mantendo a rasterização do canvas na GPU |

## A decisão

`src-tauri/tauri.conf.json`, na janela principal:

```json
"additionalBrowserArgs": "--disable-gpu-compositing --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
```

- `--disable-gpu-compositing` tira do driver **apenas a montagem de camadas**; o
  canvas continua acelerado. É o meio-termo entre o bug e rasterizar tudo na CPU.
- Os três `--disable-features=...` são os **padrões do Tauri**: a opção
  `additionalBrowserArgs` **substitui** a lista, então precisam continuar ali.
- A flag vale em `dev` e no build de produção (é configuração da janela, lida na
  criação do WebView).

## Se voltar

Trocar `--disable-gpu-compositing` por `--disable-gpu`. É o modo comprovado; o
custo é a rasterização do grafo inteiro na CPU.

**Não remova a flag** por achar que ela "não faz nada": o efeito é invisível no
código e imediato no ponteiro. Há teste de regressão apenas para a repintura
(`src/lib/cursorRepaint.test.ts`); o comportamento do plano de composição não é
testável fora do Windows real — a verificação é manual, arrastando um nó no grafo.

## Custo

Não medido em fps. O que muda é a composição (CPU) do que a GPU já rasterizou; em
tela de app de notas o custo esperado é baixo, mas isso é expectativa, não
medição — se aparecer queda de quadro no grafo, meça antes de reverter a flag.
