/**
 * A quién le llega el correo de un hito de plazo.
 *
 * Antes era uno solo por línea (`alertas_plazo.areas`). SOENA (SOE-001, 2026-10-07) pidió
 * que el aviso de los 45 días hábiles sin acto administrativo ESCALE a la supervisora de
 * operaciones, no solo al área. El motor reparte por área y no por umbral, así que cada hito
 * puede declarar sus propios destinatarios:
 *
 *   { "slug": "acto_45", ..., "destinatarios": { "areas": ["operaciones"], "staff_ids": ["<id>"] } }
 *
 * Reglas:
 *  - Sin `destinatarios` en el hito → las `areas` de la línea, como siempre.
 *  - `destinatarios.areas` reemplaza a las de la línea; si no la trae, se heredan. Así
 *    "escalar a X" es solo agregar `staff_ids` sin repetir las áreas.
 *  - `staff_ids` se SUMA a las áreas: la persona recibe el correo aunque mañana cambie de
 *    área. Quien no esté activo no recibe nada (eso lo resuelve quien busca los correos).
 *
 * Puro y sin Deno: lo usa la edge function `alertas-plazo` y lo prueba vitest.
 */

export type DestinatariosHito = {
  areas: string[]
  staffIds: string[]
}

type HitoConfig = {
  slug?: unknown
  destinatarios?: { areas?: unknown; staff_ids?: unknown } | null
}

export type AlertasPlazoConfig = {
  areas?: unknown
  hitos?: unknown
} | null | undefined

function textos(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))]
}

export function destinatariosDelHito(config: AlertasPlazoConfig, hitoSlug: string): DestinatariosHito {
  const areasLinea = textos(config?.areas) ?? []
  const hitos = Array.isArray(config?.hitos) ? (config?.hitos as HitoConfig[]) : []
  const hito = hitos.find((h) => h && typeof h === 'object' && h.slug === hitoSlug)
  const d = hito?.destinatarios

  if (!d || typeof d !== 'object') return { areas: areasLinea, staffIds: [] }

  return {
    areas: textos(d.areas) ?? areasLinea,
    staffIds: textos(d.staff_ids) ?? [],
  }
}
