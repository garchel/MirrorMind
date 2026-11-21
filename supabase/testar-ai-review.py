"""Testa a função `ai-review` de verdade, com a conta de teste B."""
import json
import pathlib
import re
import urllib.error
import urllib.request

REPO = pathlib.Path("C:/Users/paulo/OneDrive/Documentos/MirrorMind")


def ler_env(caminho: pathlib.Path) -> dict[str, str]:
    dados = caminho.read_bytes()
    for codificacao in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            texto = dados.decode(codificacao)
            break
        except UnicodeDecodeError:
            continue
    valores = {}
    for linha in texto.splitlines():
        linha = linha.strip().replace("\r", "")
        if "=" in linha and not linha.startswith("#"):
            chave, _, valor = linha.partition("=")
            valores[chave.strip()] = valor.strip().strip('"').strip("'")
    return valores


env = ler_env(REPO / ".env")
url = env["VITE_SUPABASE_URL"].rstrip("/")
apikey = env["VITE_SUPABASE_PUBLISHABLE_KEY"]

conta = pathlib.Path("C:/Users/paulo/AppData/Local/mirrormind-contas-de-teste.txt").read_text(encoding="utf-8")
email = re.search(r"2\)\s*(\S+@\S+)", conta).group(1)
senha = re.search(r"senha:\s*(\S+)", conta).group(1)


def post(caminho: str, corpo, cabecalhos: dict[str, str] | None = None, base: str = "") -> tuple[int, dict]:
    requisicao = urllib.request.Request(
        (base or url) + caminho,
        data=json.dumps(corpo).encode("utf-8"),
        headers={"apikey": apikey, "Content-Type": "application/json", **(cabecalhos or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(requisicao, timeout=45) as resposta:
            return resposta.status, json.loads(resposta.read() or b"{}")
    except urllib.error.HTTPError as erro:
        corpo_erro = erro.read()
        try:
            return erro.code, json.loads(corpo_erro or b"{}")
        except Exception:
            return erro.code, {"raw": corpo_erro[:200].decode("utf-8", "replace")}


# 1. token da conta B
status, sessao = post("/auth/v1/token?grant_type=password", {"email": email, "password": senha})
token = sessao.get("access_token", "")
print("login B:", status, "| token:", bool(token))
funcao = url + "/functions/v1/ai-review"

# 2. sem token
print("sem token:", post("", {"mode": "status"}, {}, base=funcao))

# 3. token inválido
print("token invalido:", post("", {"mode": "status"}, {"Authorization": "Bearer nao-e-token"}, base=funcao))

# 4. status real
print("status B:", post("", {"mode": "status"}, {"Authorization": f"Bearer {token}"}, base=funcao))

# 5. chamada (sem GEMINI_API_KEY no servidor deve dar 503 e marcar a reserva como falha)
pedido = {
    "mode": "call",
    "request": {"model": "gemini-3.5-flash", "input": "teste", "response_format": {"type": "text"}},
}
print("chamada:", post("", pedido, {"Authorization": f"Bearer {token}", "Idempotency-Key": "teste-funcao-1"}, base=funcao))

# 6. sem chave de idempotência
# (etapas de borda já medidas)
print("sem idempotencia:", post("", pedido, {"Authorization": f"Bearer {token}"}, base=funcao))

# 7. pedido ausente
print("pedido ausente:", post("", {"mode": "call"}, {"Authorization": f"Bearer {token}", "Idempotency-Key": "teste-funcao-2"}, base=funcao))
