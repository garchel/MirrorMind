"""Gate: botao novo nao nasce com classes escritas a mao.

Por que este gate existe
------------------------
O app tem um primitivo de botao (`components/ui/Button.tsx`) com `variant`
e `size` tipados. Mesmo assim, ~200 botoes do repo ainda escrevem a
combinacao de classes na mao:

    <Button className="ui-button ui-button--secondary ui-button--sm">

Isso nao muda a aparencia (o primitivo emite as mesmas classes), mas tira
a unica coisa que o primitivo garante: uma variante e uma densidade por
botao. Sem essa garantia, a string aceita qualquer combinacao — inclusive
duas variantes no mesmo elemento, que foi como o botao "Revisar" ficou
com `secondary` e `primary` juntos e mediu 34px em vez de 40.

Casos reais que vieram dessa mistura: duas variantes no mesmo botao, o
"?" de ajuda com 32x40 (min-height da densidade `md` vencendo a classe
local), as abas do painel com 54px de altura e dois lugares com o texto
cortado embaixo por `line-height: 1` herdado de `.secondary-button`.

O que este gate faz
-------------------
1. ERRO sempre: duas variantes (`--primary`, `--secondary`, `--danger`,
   `--bare`) na mesma className — impossivel de ser intencional.
2. ERRO para classes manuais que nao estao no baseline. O baseline
   (`scripts/button-class-baseline.json`) guarda as ocorrencias que
   existiam quando o gate entrou, por ASSINATURA (arquivo + linha
   normalizada, sem numero de linha): mover o botao de lugar nao invalida
   o registro, acrescentar um novo invalida.

Como migrar
-----------
Troque a string por props e rode `python scripts/verify-button-classes.py
--update` para tirar a linha do baseline:

    antes:  <Button className="ui-button ui-button--secondary ui-button--sm">
    depois: <Button variant="secondary" size="sm">

Classe EXTRA de contexto (`.graph-icon-button`, `.workspace-page-refresh`)
continua valendo como `className` — ela e geometria da tela, nao variante.
O que o gate proibe e reescrever as classes de variante/densidade.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
BASELINE = ROOT / "scripts" / "button-class-baseline.json"

VARIANTS = ("primary", "secondary", "danger", "bare")

# `className="..."`, `className={"..."}` e `className={`...`}`
CLASSNAME = re.compile(r"className=(?:\{\s*)?[\"'`]([^\"'`]*)", re.S)
VARIANT_CLASS = re.compile(r"ui-button--(" + "|".join(VARIANTS) + r")\b")
MANUAL_CLASS = re.compile(r"ui-button--")

# O proprio primitivo monta a string: e a unica fonte legitima.
ISENTOS = {
    "src/components/ui/Button.tsx",
}


def linha_normalizada(texto: str) -> str:
    return re.sub(r"\s+", " ", texto.strip())


def ocorrencias() -> list[dict[str, str]]:
    achados: list[dict[str, str]] = []
    for caminho in sorted(SRC.rglob("*.tsx")):
        relativo = caminho.relative_to(ROOT).as_posix()
        if relativo in ISENTOS or ".test." in caminho.name:
            continue
        texto = caminho.read_text(encoding="utf-8", errors="ignore")
        for numero, linha in enumerate(texto.split("\n"), 1):
            if "ui-button--" not in linha:
                continue
            tem_classname = CLASSNAME.search(linha) is not None
            if not tem_classname:
                continue
            achados.append({
                "arquivo": relativo,
                "linha": str(numero),
                "assinatura": relativo + "::" + linha_normalizada(linha),
                "texto": linha_normalizada(linha)[:160],
            })
    return achados


def carregar_baseline() -> set[str]:
    if not BASELINE.exists():
        return set()
    dados = json.loads(BASELINE.read_text(encoding="utf-8"))
    return set(dados.get("assinaturas", []))


def gravar_baseline(assinaturas: set[str]) -> None:
    BASELINE.write_text(
        json.dumps({"assinaturas": sorted(assinaturas)}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main(argv: list[str]) -> int:
    atualizar = "--update" in argv
    achados = ocorrencias()

    # 1) Variante dupla no mesmo className: erro duro, sem baseline.
    duplicadas = [
        item for item in achados
        if len(set(VARIANT_CLASS.findall(
            "".join(CLASSNAME.findall(item["texto"])) or item["texto"]
        ))) > 1
    ]

    assinaturas = {item["assinatura"] for item in achados}
    baseline = carregar_baseline()

    if atualizar:
        gravar_baseline(assinaturas)
        print(f"baseline atualizado: {len(assinaturas)} assinaturas em {BASELINE.name}")
        return 0

    novas = sorted(assinaturas - baseline)
    removidas = sorted(baseline - assinaturas)

    if duplicadas:
        print("ERRO: botao com duas variantes no mesmo className (escolha uma):")
        for item in duplicadas:
            print(f"  {item['arquivo']}:{item['linha']}")
            print(f"    {item['texto']}")
        print()

    if novas:
        print(f"ERRO: {len(novas)} botao(oes) novo(s) com classes de variante escritas a mao.")
        print("Use <Button variant=... size=...>; se a migracao for consciente,")
        print("rode com --update.\n")
        for assinatura in novas:
            arquivo, texto = assinatura.split("::", 1)
            print(f"  {arquivo}")
            print(f"    {texto}")
        print()

    if removidas:
        print(f"OK: {len(removidas)} ocorrencia(s) do baseline nao existem mais "
              f"(migradas). Rode com --update para limpar.")

    if duplicadas or novas:
        return 1

    print(f"OK: {len(assinaturas)} botao(oes) manuais no baseline, nenhum novo.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
