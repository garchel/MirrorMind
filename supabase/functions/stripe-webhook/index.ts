// Edge Function: webhook do Stripe — é o **único** lugar que escreve plano.
//
// `verify_jwt` fica desligado de propósito: o Stripe não manda JWT do Supabase.
// A autenticação aqui é a assinatura do Stripe (`Stripe-Signature`), conferida
// com HMAC-SHA256 sobre `{timestamp}.{corpo}` — Web Crypto faz isso sem
// dependência nenhuma.
//
// Regras que este arquivo protege:
//
// 1. **Idempotência**: o Stripe reentrega eventos. Cada `event.id` é gravado
//    antes de qualquer efeito; reentrega vira 200 sem reprocessar. Sem isso, um
//    `payment_failed` reentregue rebaixa quem já pagou.
// 2. **Nada de plano no cliente**: o app só lê. Um binário distribuído poderia
//    mentir sobre o próprio plano se a escrita dependesse dele.
// 3. **Evento desconhecido não quebra o webhook**: responde 200 e ignora. Um 4xx
//    faria o Stripe retentar para sempre um evento que nunca vamos tratar.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const JANELA_ASSINATURA_SEGUNDOS = 300; // 5 min, como o Stripe recomenda

type StripeEvent = {
  id: string;
  type: string;
  /** Unix seconds do Stripe: é o que decide quem é mais novo. */
  created?: number;
  data: { object: Record<string, unknown> };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function segredoObrigatorio(): string | null {
  return Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? null;
}

/** Compara em tempo constante: assinatura é segredo, não vale vazar por timing. */
function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferenca === 0;
}

async function assinaturaConfere(
  corpoBruto: string,
  cabecalho: string | null,
  segredo: string,
): Promise<boolean> {
  if (!cabecalho) return false;

  const partes = cabecalho.split(",").reduce<Record<string, string[]>>(
    (acc, item) => {
      const [chave, valor] = item.split("=");
      if (!chave || !valor) return acc;
      acc[chave] = [...(acc[chave] ?? []), valor];
      return acc;
    },
    {},
  );

  const carimbo = partes["t"]?.[0];
  const assinaturas = partes["v1"] ?? [];
  if (!carimbo || assinaturas.length === 0) return false;

  const agora = Math.floor(Date.now() / 1000);
  if (Math.abs(agora - Number(carimbo)) > JANELA_ASSINATURA_SEGUNDOS) {
    // Replay de um evento antigo: a janela corta.
    return false;
  }

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    chave,
    new TextEncoder().encode(`${carimbo}.${corpoBruto}`),
  );
  const esperado = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return assinaturas.some((assinatura) => iguaisSeguro(assinatura, esperado));
}

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const base = Deno.env.get("SUPABASE_URL");
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !chave) throw new Error("Serviço sem configuração do banco.");
  return fetch(`${base}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: chave,
      Authorization: `Bearer ${chave}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers ?? {}),
    },
  });
}

/** Para qual objeto o evento fala — a assinatura quando existe. */
function subjectDo(evento: StripeEvent): string | null {
  const objeto = evento.data.object;
  const assinatura = objeto.subscription;
  if (typeof assinatura === "string") return assinatura;
  if (evento.type.startsWith("customer.subscription.")) {
    const id = objeto.id;
    return typeof id === "string" ? id : null;
  }
  const cliente = objeto.customer;
  return typeof cliente === "string" ? cliente : null;
}

/** Grava o evento. `false` = já existia (reentrega).
 *
 * A detecção é pelo **corpo devolvido**, não pelo status: com
 * `resolution=ignore-duplicates` o PostgREST responde 201 mesmo quando ignora o
 * insert. Pedir `return=representation` faz a diferença aparecer — lista vazia
 * quando o evento já estava lá, uma linha quando ele foi criado agora. (Antes eu
 * comparava com 409, que nunca chega, e toda reentrega era reprocessada.)
 */
async function registrarEvento(
  evento: StripeEvent,
  subject: string | null,
): Promise<boolean> {
  const resposta = await rest("/stripe_events", {
    method: "POST",
    headers: {
      Prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify({
      id: evento.id,
      type: evento.type,
      stripe_created: evento.created ?? null,
      subject,
    }),
  });
  if (!resposta.ok && resposta.status !== 409) {
    throw new Error(`não foi possível registrar o evento (${resposta.status})`);
  }
  if (resposta.status === 409) return false;
  const linhas = await resposta.json().catch(() => []);
  return Array.isArray(linhas) && linhas.length > 0;
}

/** Desfaz o registro: usado quando os efeitos falham, para o retry reprocessar. */
async function esquecerEvento(id: string) {
  await rest(`/stripe_events?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Já existe evento mais novo aplicado para este objeto? Então este é velho. */
async function eventoMaisNovoJaAplicado(
  subject: string | null,
  created: number | undefined,
): Promise<boolean> {
  if (!subject || typeof created !== "number") return false;
  const resposta = await rest(
    `/stripe_events?subject=eq.${encodeURIComponent(subject)}&select=stripe_created&order=stripe_created.desc&limit=1`,
    { headers: { Prefer: "return=representation" } },
  );
  if (!resposta.ok) return false;
  const linhas = await resposta.json();
  const maior = Array.isArray(linhas) && linhas[0]?.stripe_created;
  return typeof maior === "number" && maior > created;
}

function iso(unixSegundos: unknown): string | null {
  if (typeof unixSegundos !== "number" || !Number.isFinite(unixSegundos)) {
    return null;
  }
  return new Date(unixSegundos * 1000).toISOString();
}

/** Assinatura viva? `past_due` mantém o acesso enquanto o Stripe tenta cobrar. */
function cloudPlanPara(status: string): "nuvem" | "nenhum" {
  return ["active", "trialing", "past_due"].includes(status) ? "nuvem" : "nenhum";
}

async function atualizarPorUsuario(uid: string, campos: Record<string, unknown>) {
  const resposta = await rest(`/profiles?id=eq.${encodeURIComponent(uid)}`, {
    method: "PATCH",
    body: JSON.stringify(campos),
  });
  if (!resposta.ok) {
    throw new Error(`não foi possível atualizar o perfil (${resposta.status})`);
  }
}

async function atualizarPorAssinatura(
  subscriptionId: string,
  campos: Record<string, unknown>,
) {
  const resposta = await rest(
    `/profiles?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
    { method: "PATCH", body: JSON.stringify(campos) },
  );
  if (!resposta.ok) {
    throw new Error(`não foi possível atualizar a assinatura (${resposta.status})`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const segredo = segredoObrigatorio();
  if (!segredo) {
    // Sem segredo não há como confiar no corpo: recusar é a única resposta honesta.
    return json({ error: "Webhook não configurado neste ambiente." }, 501);
  }

  const corpoBruto = await req.text();
  const confere = await assinaturaConfere(
    corpoBruto,
    req.headers.get("Stripe-Signature"),
    segredo,
  );
  if (!confere) {
    return json({ error: "Assinatura inválida." }, 400);
  }

  let evento: StripeEvent;
  try {
    evento = JSON.parse(corpoBruto);
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  const subject = subjectDo(evento);

  try {
    const novo = await registrarEvento(evento, subject);
    if (!novo) {
      // Reentrega: nada a fazer, e dizer 200 evita retentativa infinita.
      return json({ received: true, duplicate: true });
    }

    if (await eventoMaisNovoJaAplicado(subject, evento.created)) {
      // Evento atrasado: um mais novo já decidiu o estado. Aplicar este
      // devolveria acesso a quem cancelou.
      return json({ received: true, stale: true });
    }

    const objeto = evento.data.object;

    switch (evento.type) {
      case "checkout.session.completed": {
        const uid = (objeto.client_reference_id ??
          (objeto.metadata as Record<string, unknown> | undefined)
            ?.user_id) as string | undefined;
        const assinatura = objeto.subscription as string | undefined;
        const cliente = objeto.customer as string | undefined;

        if (uid) {
          await atualizarPorUsuario(uid, {
            stripe_customer_id: cliente ?? null,
            stripe_subscription_id: assinatura ?? null,
            // O add-on vira ativo aqui; a data do ciclo chega no evento da
            // assinatura (`customer.subscription.updated`), que é o que tem
            // `current_period_end`.
            cloud_plan: "nuvem",
            plan_status: "active",
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const id = objeto.id as string;
        const status = (objeto.status as string) ?? "canceled";
        const cliente = objeto.customer as string | undefined;
        const uid = (objeto.metadata as Record<string, unknown> | undefined)
          ?.user_id as string | undefined;

        const campos = {
          cloud_plan: cloudPlanPara(status),
          plan_status: status === "past_due" ? "past_due" : status === "canceled" ? "canceled" : "active",
          plan_period_end: iso(objeto.current_period_end),
          ...(cliente ? { stripe_customer_id: cliente } : {}),
        };

        if (uid) await atualizarPorUsuario(uid, campos);
        await atualizarPorAssinatura(id, campos);
        break;
      }

      case "customer.subscription.deleted": {
        const id = objeto.id as string;
        const campos = {
          cloud_plan: "nenhum",
          plan_status: "canceled",
          plan_period_end: iso(objeto.current_period_end),
          stripe_subscription_id: null,
        };
        await atualizarPorAssinatura(id, campos);
        const uid = (objeto.metadata as Record<string, unknown> | undefined)
          ?.user_id as string | undefined;
        if (uid) await atualizarPorUsuario(uid, campos);
        break;
      }

      case "invoice.payment_failed": {
        const cliente = objeto.customer as string | undefined;
        if (cliente) {
          const resposta = await rest(
            `/profiles?stripe_customer_id=eq.${encodeURIComponent(cliente)}`,
            { method: "PATCH", body: JSON.stringify({ plan_status: "past_due" }) },
          );
          if (!resposta.ok) {
            throw new Error(`falha ao marcar past_due (${resposta.status})`);
          }
        }
        break;
      }

      default:
        // Evento que não nos interessa: 200 para o Stripe parar de tentar.
        break;
    }

    return json({ received: true });
  } catch (erro) {
    // O evento é registrado antes dos efeitos (para a reentrega concorrente cair
    // como duplicata), mas se os efeitos falharem a linha é removida — senão a
    // reentrega do Stripe viraria "duplicata" e o efeito se perderia em silêncio.
    // Perder dinheiro por um registro otimista seria pior do que reprocessar duas
    // vezes: todas as escritas aqui são `set` de valor calculado, então repetir é
    // seguro.
    console.error("webhook:", erro);
    await esquecerEvento(evento.id).catch(() => undefined);
    return json({ error: String(erro) }, 500);
  }
});
