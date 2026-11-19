// Edge Function: página de retorno do Checkout.
//
// O Stripe precisa de uma URL de sucesso e uma de cancelamento. Em vez de apontar
// para um site que talvez não exista, a própria função serve a página — e ela diz
// a única coisa que importa: **pode fechar esta aba e voltar para o app**, porque
// quem ativa o add-on é o webhook, não o navegador.
//
// `verify_jwt` desligado: quem chega aqui vem do Stripe, sem sessão do Supabase.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PAGINA = (titulo: string, mensagem: string, cor: string) => `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${titulo} — MirrorMind</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-content: center;
        gap: 12px;
        padding: 40px 24px;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        background: #0f1512;
        color: #e8efe9;
        text-align: center;
      }
      .marca { font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.55; }
      h1 { margin: 0; font-size: 26px; font-weight: 600; }
      p { margin: 0; max-width: 44ch; line-height: 1.6; opacity: 0.8; }
      .ponto { width: 10px; height: 10px; border-radius: 999px; background: ${cor}; margin: 0 auto 4px; }
    </style>
  </head>
  <body>
    <div class="ponto"></div>
    <span class="marca">MirrorMind</span>
    <h1>${titulo}</h1>
    <p>${mensagem}</p>
  </body>
</html>`;

Deno.serve((req: Request) => {
  const status = new URL(req.url).searchParams.get("status");

  if (status === "cancelado") {
    return new Response(
      PAGINA(
        "Assinatura não concluída",
        "Nada foi cobrado. Você pode voltar ao app e tentar de novo quando quiser.",
        "#c98b3a",
      ),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  return new Response(
    PAGINA(
      "Assinatura confirmada",
      "Pode fechar esta aba e voltar ao app. A nuvem aparece como ativa assim que o pagamento é confirmado.",
      "#4f9d6b",
    ),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
});
