// ============================================================
// La firma del pedido webhook → app de la entrega única del bloqueo
// ------------------------------------------------------------
// El webhook (Deno) le pide a la app (Next, Vercel) que procese un pedido: la llamada al modelo, la base y
// el PDF (Chromium solo corre en Node). La ruta no tiene sesión, así que el cuerpo va firmado con
// HMAC-SHA256 usando un secreto PROPIO, `ENTREGA_BLOQUEO_SECRETO`, cargado igual en los secretos de Supabase y
// en las variables de Vercel. La firma lleva la hora y vence a los 5 minutos (no se puede reenviar).
//
// Por qué no la llave de servicio (como nació, PR #1423): el 2026-11-05 Supabase cambió la
// `SUPABASE_SERVICE_ROLE_KEY` que ven las Edge Functions y dejó de ser la misma cadena que tiene Vercel
// (digest distinto); la primera prueba real (2026-11-06) respondió 401. Un secreto propio no depende de eso.
// WebCrypto: igual en Deno y en Node.
// ============================================================

export const VIGENCIA_FIRMA_MS = 5 * 60_000

/** El nombre de la variable del secreto, igual en los dos lados. */
export const VARIABLE_SECRETO = 'ENTREGA_BLOQUEO_SECRETO'

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')

async function hmac(llave: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(llave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto)))
}

/** `t=<ms>,v1=<hex>` sobre `<ms>.<cuerpo>`. */
export async function firmarCuerpo(llave: string, cuerpo: string, ahoraMs: number = Date.now()): Promise<string> {
  return `t=${ahoraMs},v1=${await hmac(llave, `${ahoraMs}.${cuerpo}`)}`
}

/** Por qué se rechaza una firma, para el registro (nunca lleva el secreto ni la firma). */
export type MotivoRechazo = 'sin_secreto' | 'sin_firma' | 'formato' | 'vencida' | 'no_coincide'

/** `null` si la firma vale; si no, el motivo. */
export async function motivoRechazo(llave: string, cuerpo: string, firma: string | null, ahoraMs: number = Date.now()): Promise<MotivoRechazo | null> {
  if (!llave) return 'sin_secreto'
  if (!firma) return 'sin_firma'
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(firma.trim())
  if (!m) return 'formato'
  const t = Number(m[1])
  if (!Number.isFinite(t) || Math.abs(ahoraMs - t) > VIGENCIA_FIRMA_MS) return 'vencida'
  const esperada = await hmac(llave, `${t}.${cuerpo}`)
  // Comparación en tiempo constante.
  let dif = esperada.length ^ m[2].length
  for (let i = 0; i < esperada.length; i++) dif |= esperada.charCodeAt(i) ^ (m[2].charCodeAt(i) || 0)
  return dif === 0 ? null : 'no_coincide'
}

export async function firmaValida(llave: string, cuerpo: string, firma: string | null, ahoraMs: number = Date.now()): Promise<boolean> {
  return (await motivoRechazo(llave, cuerpo, firma, ahoraMs)) === null
}
