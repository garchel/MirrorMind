// Edge Function: cria a sessão de Checkout do Stripe para o add-on de nuvem.
//
// Por que no servidor: a chave secreta do Stripe nunca pode chegar ao app — um
// binário distribuído é um arquivo que qualquer um abre. Aqui a chave vive em
// variável de ambiente da função.
//
// Contrato:
//   POST { kind: "cloud_month" | "cloud_year" }
//   200  { url }            → abrir no navegador
//   401  não autenticado
//   501  Stripe não configurado neste ambiente (falta STRIPE_SECRET_KEY)
//   502  o Stripe recusou (a mensagem vem do Stripe)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const STRIPE_API = "https://api.stripe.com/v1";

type Kind = "cloud_month" | "cloud_year";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", Connection: "keep-alive" },
  });
}

/** `sub` do JWT já verificado pela plataforma (verify_jwt: true). */
function userId(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
}

function priceFor(kind: Kind): string | null {
  const mensal = Deno.env.get("STRIPE_PRICE_CLOUD_MONTH");
  const anual = Deno.env.get("STRIPE_PRICE_CLOUD_YEAR");
  return kind === "cloud_month" ? (mensal ?? null) : (anual ?? null);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Use POST." }, 405);
  }

  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) {
    // Erro explícito em vez de 500 opaco: sem a chave, o checkout não existe e o
    // app mostra isso ao usuário em vez de fingir que tentou.
    return json(
      { error: "O checkout ainda não está configurado neste ambiente." },
      501,
    );
  }

  const uid = userId(req.headers.get("Authorization"));
  if (!uid) {
    return json({ error: "Entre na sua conta para assinar." }, 401);
  }

  let kind: Kind = "cloud_month";
  try {
    const corpo = await req.json();
    if (corpo?.kind === "cloud_year") kind = "cloud_year";
    else if (corpo?.kind !== undefined && corpo.kind !== "cloud_month") {
      return json({ error: "Plano desconhecido." }, 400);
    }
  } catch {
    // corpo vazio: mensal é o padrão razoável
  }

  const price = priceFor(kind);
  if (!price) {
    return json({ error: "Preço não configurado no servidor." }, 501);
  }

  const voltar = Deno.env.get("CHECKOUT_RETURN_URL") ??
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/checkout-return`;

  const formulario = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: uid,
    "metadata[user_id]": uid,
    "metadata[kind]": kind,
    "subscription_data[metadata][user_id]": uid,
    "subscription_data[metadata][kind]": kind,
    success_url: `${voltar}?status=ok`,
    cancel_url: `${voltar}?status=cancelado`,
    allow_promotion_codes: "true",
  });

  const resposta = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formulario,
  });

  const dados = await resposta.json();
  if (!resposta.ok) {
    return json(
      { error: dados?.error?.message ?? "O Stripe recusou a cobrança." },
      502,
    );
  }

  return json({ url: dados.url });
});
