// ============================================================
// La firma del pedido webhook → app de la entrega única del bloqueo
// ------------------------------------------------------------
// El webhook (Deno) le pide a la app (Next, Vercel) que procese un pedido: la llamada al modelo, la base y
// el PDF (Chromium solo corre en Node). La ruta no tiene sesión, así que el cuerpo va firmado con
// HMAC-SHA256 usando la llave de servicio de Supabase, que ya tienen los dos lados: la llave no viaja y no
// hace falta un secreto nuevo. La firma lleva la hora y vence a los 5 minutos (no se puede reenviar).
// WebCrypto: igual en Deno y en Node.
// ============================================================

export const VIGENCIA_FIRMA_MS = 5 * 60_000

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')

async function hmac(llave: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(llave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto)))
}

/** `t=<ms>,v1=<hex>` sobre `<ms>.<cuerpo>`. */
export async function firmarCuerpo(llave: string, cuerpo: string, ahoraMs: number = Date.now()): Promise<string> {
  return `t=${ahoraMs},v1=${await hmac(llave, `${ahoraMs}.${cuerpo}`)}`
}

export async function firmaValida(llave: string, cuerpo: string, firma: string | null, ahoraMs: number = Date.now()): Promise<boolean> {
  if (!llave || !firma) return false
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(firma.trim())
  if (!m) return false
  const t = Number(m[1])
  if (!Number.isFinite(t) || Math.abs(ahoraMs - t) > VIGENCIA_FIRMA_MS) return false
  const esperada = await hmac(llave, `${t}.${cuerpo}`)
  // Comparación en tiempo constante.
  let dif = esperada.length ^ m[2].length
  for (let i = 0; i < esperada.length; i++) dif |= esperada.charCodeAt(i) ^ (m[2].charCodeAt(i) || 0)
  return dif === 0
}
