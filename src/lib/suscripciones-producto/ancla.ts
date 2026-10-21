/**
 * El ANCLA de un contrato: de qué cuelga lo que el motor de cobro cobra. Un contrato de servicio
 * (`servicios_contratados`), su plan (`planes_cobro`), sus cobros y sus Términos cuelgan de un NEGOCIO
 * del CRM (Clarity, Analytics, Projects y los 4 CDA de hoy) O de una SUSCRIPCIÓN
 * (`suscripciones_producto`: Valida autogestionada y los productos que vengan). Exactamente uno: la base
 * lo exige con CHECK (migración 20261016100000).
 *
 * Todo el motor emparejaba contrato ↔ plan ↔ cobros por `negocio_id`. Ahora empareja por el ancla, con
 * estas funciones. Puro: sin base ni secretos.
 */

export type Ancla = { tipo: 'negocio'; id: string } | { tipo: 'suscripcion'; id: string }

export type ColumnaAncla = 'negocio_id' | 'suscripcion_id'

/** Las dos columnas, para un `select`. */
export const COLUMNAS_ANCLA = 'negocio_id, suscripcion_id'

export interface FilaConAncla {
  negocio_id?: string | null
  suscripcion_id?: string | null
}

/** El ancla de una fila (contrato, plan, cobro, aceptación). `null` si no tiene ninguna o tiene las dos. */
export function anclaDeFila(f: FilaConAncla | null | undefined): Ancla | null {
  if (!f) return null
  const n = f.negocio_id ?? null
  const s = f.suscripcion_id ?? null
  if (n && !s) return { tipo: 'negocio', id: n }
  if (s && !n) return { tipo: 'suscripcion', id: s }
  return null
}

export function columnaDeAncla(a: Ancla): ColumnaAncla {
  return a.tipo === 'negocio' ? 'negocio_id' : 'suscripcion_id'
}

/** Las dos columnas para un INSERT: la del ancla con su id y la otra en null. */
export function columnasDeAncla(a: Ancla): { negocio_id: string | null; suscripcion_id: string | null } {
  return a.tipo === 'negocio' ? { negocio_id: a.id, suscripcion_id: null } : { negocio_id: null, suscripcion_id: a.id }
}

/** Una llave de texto estable para mapas y conjuntos: `negocio:<id>` o `suscripcion:<id>`. */
export function llaveDeAncla(a: Ancla): string {
  return `${a.tipo}:${a.id}`
}

/** `llaveDeAncla` de una fila, o `null` si no tiene ancla. */
export function llaveDeFila(f: FilaConAncla | null | undefined): string | null {
  const a = anclaDeFila(f)
  return a ? llaveDeAncla(a) : null
}

/** Lo contrario de `llaveDeAncla`. */
export function anclaDeLlave(llave: string): Ancla | null {
  const m = /^(negocio|suscripcion):(.+)$/.exec(llave)
  if (!m) return null
  return m[1] === 'negocio' ? { tipo: 'negocio', id: m[2] } : { tipo: 'suscripcion', id: m[2] }
}

/** Un `.eq(columna, id)` sobre una consulta de PostgREST, por el ancla. */
export function filtrarPorAncla<Q extends { eq: (columna: string, valor: unknown) => Q }>(q: Q, a: Ancla): Q {
  return q.eq(columnaDeAncla(a), a.id)
}

/** Los ids de cada tipo de ancla de una lista, para dos `.in()` (uno por columna). */
export function idsPorTipo(anclas: readonly Ancla[]): { negocios: string[]; suscripciones: string[] } {
  const negocios = new Set<string>()
  const suscripciones = new Set<string>()
  for (const a of anclas) (a.tipo === 'negocio' ? negocios : suscripciones).add(a.id)
  return { negocios: [...negocios], suscripciones: [...suscripciones] }
}
