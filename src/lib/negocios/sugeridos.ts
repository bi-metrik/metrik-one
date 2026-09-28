/**
 * Valores SUGERIDOS en un bloque `datos`: los que escribió el paso de entendimiento de la
 * bandeja de WhatsApp y todavía no confirmó una persona.
 *
 * La marca vive en `negocio_bloques.data._sugeridos[slug] = { fuente, entrega_id, frase, en }`.
 * Es espacio de nombres del servidor (empieza por `_`): el navegador no la escribe
 * (`data-escribible.ts` la conserva). Solo se quita de dos formas:
 *   · la persona CAMBIA el valor (lo reemplazó: ya no es sugerido, es suyo);
 *   · la persona lo CONFIRMA tal cual (`confirmarSugerido`).
 *
 * Lo escribe `supabase/functions/_shared/wa-entendimiento-reglas.ts` (`fusionarSugeridos`).
 */

export const CLAVE_SUGERIDOS = '_sugeridos'

export interface MarcaSugerido {
  fuente: 'whatsapp'
  entrega_id?: string
  /** Las palabras del mensaje que sostienen el valor. */
  frase?: string
  en?: string
}

export function sugeridosDe(data: Record<string, unknown> | null | undefined): Record<string, MarcaSugerido> {
  const m = data?.[CLAVE_SUGERIDOS]
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, MarcaSugerido>) : {}
}

/** Mismo valor para efectos de la marca: sin espacios al borde ni diferencia de mayúsculas. */
function mismo(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim().toLocaleUpperCase('es-CO'))
  return n(a) === n(b)
}

/**
 * Quita la marca de los campos que la persona cambió. Se aplica al guardar, sobre la data ya
 * saneada: `anterior` es lo guardado, `nueva` lo que se va a escribir.
 */
export function soltarSugeridosEditados(
  anterior: Record<string, unknown>,
  nueva: Record<string, unknown>,
): Record<string, unknown> {
  const marcas = sugeridosDe(nueva)
  const slugs = Object.keys(marcas)
  if (slugs.length === 0) return nueva
  const quedan: Record<string, MarcaSugerido> = {}
  for (const s of slugs) if (mismo(anterior[s], nueva[s])) quedan[s] = marcas[s]
  if (Object.keys(quedan).length === slugs.length) return nueva
  const out = { ...nueva }
  if (Object.keys(quedan).length === 0) delete out[CLAVE_SUGERIDOS]
  else out[CLAVE_SUGERIDOS] = quedan
  return out
}

/** La persona confirma el valor sugerido tal cual: se quita la marca, el valor se queda. */
export function confirmarSugeridoEnData(data: Record<string, unknown>, slug: string): Record<string, unknown> {
  const marcas = { ...sugeridosDe(data) }
  if (!(slug in marcas)) return data
  delete marcas[slug]
  const out = { ...data }
  if (Object.keys(marcas).length === 0) delete out[CLAVE_SUGERIDOS]
  else out[CLAVE_SUGERIDOS] = marcas
  return out
}
