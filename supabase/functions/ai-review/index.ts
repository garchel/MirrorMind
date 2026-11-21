// MirrorMind — IA gerenciada pela assinatura (proxy).
//
// Por que isto existe: a chave do provedor não pode ir no cliente (qualquer
// pessoa extrai uma chave embutida e passa a gastar o nosso dinheiro). Aqui ela
// fica em secret da função, o app manda o pedido já no mesmo formato que ele
// usaria com a chave própria, e o servidor decide se a chamada acontece.
//
// Contrato:
//   POST /functions/v1/ai-review
//   Authorization: Bearer <access_token da conta>
//   Idempotency-Key: <uuid>            (retry de rede não cobra duas vezes)
//   { "mode": "call", "request": { ...corpo do provedor, com "model" dentro } }
//   → 200 { "response": <json cru do provedor>, "usage": { ... } }
//
//   { "mode": "status" } → 200 { plan, limits, used }
//
// Quem decide cota é o banco (`reserve_managed_ai`), não esta função: assim a
// regra fica num lugar só e a reserva acontece antes do custo.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_PROMPT_CHARS = 400_000
const PROVIDER_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const DEFAULT_MODEL = 'gemini-3.5-flash'

// Mesma heurística do app (`managedProvider.ts`) e do `usage.rs`: estimativa
// antes do custo, para o teto mensal valer já na reserva.
const INPUT_USD_PER_1M = 0.3
const OUTPUT_USD_PER_1M = 1.5
const ESTIMATED_OUTPUT_TOKENS = 2_000
const CHARS_PER_TOKEN = 4

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function estimateCostUsd(chars: number): number {
  const inputTokens = chars / CHARS_PER_TOKEN
  return (
    (inputTokens / 1_000_000) * INPUT_USD_PER_1M +
    (ESTIMATED_OUTPUT_TOKENS / 1_000_000) * OUTPUT_USD_PER_1M
  )
}

/** Motivo → status HTTP. O app traduz o código; o texto que o usuário lê mora lá. */
function statusForReason(reason: string): number {
  switch (reason) {
    case 'cota_vitalicia':
    case 'cota_mensal':
    case 'cota_diaria':
    case 'cota_minuto':
    case 'teto_custo':
      return 429
    case 'assinatura_inativa':
      return 402
    case 'sem_perfil':
      return 403
    default:
      return 400
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'metodo' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { error: 'configuracao' })
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json(401, { error: 'sem_sessao' })

  // O JWT é verificado contra o próprio GoTrue: conta válida ou nada acontece.
  const asUser = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await asUser.auth.getUser(token)
  if (userError || !userData?.user?.id) return json(401, { error: 'sessao_invalida' })
  const userId = userData.user.id

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json(400, { error: 'json_invalido' })
  }

  if (body.mode === 'status') {
    const { data, error } = await admin.rpc('managed_ai_status', { p_user: userId })
    if (error) return json(500, { error: 'status_indisponivel' })
    return json(200, data ?? {})
  }

  const request = body.request as Record<string, unknown> | undefined
  if (!request || typeof request !== 'object') return json(400, { error: 'pedido_ausente' })

  const serialized = JSON.stringify(request)
  if (serialized.length > MAX_PROMPT_CHARS) return json(413, { error: 'grande_demais' })

  const idempotency =
    req.headers.get('Idempotency-Key')?.trim() ||
    (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '')
  if (!idempotency) return json(400, { error: 'sem_chave_idempotencia' })

  const model = typeof request.model === 'string' ? request.model : DEFAULT_MODEL
  const estimated = estimateCostUsd(serialized.length)

  const { data: reserva, error: reserveError } = await admin.rpc('reserve_managed_ai', {
    p_user: userId,
    p_idempotency: idempotency,
    p_provider: 'gemini',
    p_model: model,
    p_estimated_cost: estimated,
  })
  if (reserveError) return json(500, { error: 'reserva_indisponivel' })

  const reservaObj = (reserva ?? {}) as {
    allowed?: boolean
    reason?: string
    callId?: string
    limit?: number
    used?: number
  }
  if (!reservaObj.allowed) {
    const motivo = reservaObj.reason ?? 'cota'
    return json(statusForReason(motivo), {
      error: motivo,
      limit: reservaObj.limit ?? null,
      used: reservaObj.used ?? null,
    })
  }
  const callId = reservaObj.callId

  const providerKey = Deno.env.get('GEMINI_API_KEY')
  if (!providerKey) {
    if (callId) await admin.rpc('fail_managed_ai', { p_call: callId })
    return json(503, { error: 'nao_configurado' })
  }

  let resposta: Response
  try {
    resposta = await fetch(PROVIDER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': providerKey },
      body: serialized,
    })
  } catch {
    if (callId) await admin.rpc('fail_managed_ai', { p_call: callId })
    return json(502, { error: 'provedor_indisponivel' })
  }

  const texto = await resposta.text()
  if (!resposta.ok) {
    if (callId) await admin.rpc('fail_managed_ai', { p_call: callId })
    // Corpo do provedor não volta para o cliente: pode conter detalhe de conta.
    return json(502, { error: 'provedor_recusou', status: resposta.status })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(texto) as Record<string, unknown>
  } catch {
    if (callId) await admin.rpc('fail_managed_ai', { p_call: callId })
    return json(502, { error: 'resposta_invalida' })
  }

  const uso = (payload.usageMetadata ?? {}) as {
    promptTokenCount?: number
    candidatesTokenCount?: number
  }
  const tokensIn = typeof uso.promptTokenCount === 'number' ? uso.promptTokenCount : null
  const tokensOut = typeof uso.candidatesTokenCount === 'number' ? uso.candidatesTokenCount : null
  const custoReal =
    tokensIn !== null && tokensOut !== null
      ? (tokensIn / 1_000_000) * INPUT_USD_PER_1M + (tokensOut / 1_000_000) * OUTPUT_USD_PER_1M
      : null

  if (callId) {
    await admin.rpc('confirm_managed_ai', {
      p_call: callId,
      p_tokens_in: tokensIn,
      p_tokens_out: tokensOut,
      p_cost_usd: custoReal,
    })
  }

  return json(200, {
    response: payload,
    usage: { tokensIn, tokensOut, costUsd: custoReal ?? estimated },
  })
})
