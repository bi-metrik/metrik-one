/**
 * Seccional DIAN de un negocio — el único camino que la escribe.
 *
 * `negocios.metadata.seccional` es la fuente única de la seccional del caso. De ella
 * cuelgan tres cosas distintas: la casilla 12 del Formato 010, el buzón y el bloque de
 * pasos de la Guía de Devolución, y el corte con/sin cita del tablero de proceso.
 *
 * ── Por qué existe este módulo ───────────────────────────────────────────────
 *
 * El campo se escribía desde tres caminos y cada uno usaba su propio vocabulario:
 *
 *   - el auto-init al abrir el negocio guardaba el LABEL del catálogo, que para Bogotá
 *     incluye el buzón → "Bogotá — Personas naturales";
 *   - el selector del 010 guardaba la CLAVE DEL PRESET, un vocabulario más corto que
 *     ni siquiera es un catálogo de seccionales → "Otras seccionales";
 *   - los scripts de cargue guardaban el texto del Excel, sin tildes → "Bogota".
 *
 * Ninguno canonizaba, y todo lo que lee el campo compara por texto. Medido en SOENA el
 * 2026-08-10, sobre negocios abiertos: Bogotá partida en tres variantes (90 + 16 + 6
 * casos) y Medellín en dos (11 + 11). El tablero mostraba cinco columnas donde había
 * dos ciudades, y el 010 no encontraba su preset —el match es exacto— así que 107
 * casos se quedaban sin la casilla 12 resuelta, en silencio.
 *
 * Por eso la escritura vive en un solo sitio y SIEMPRE canoniza. Es la misma lección
 * que dejó `responsable-rol.ts` el mismo día: un dato que se lee por un campo tiene que
 * escribirse igual en todos los caminos que lo crean, o uno solo alcanza para romperlo.
 */

import { canonizarSeccional } from '@/lib/dian/seccionales'

type Db = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

function db(client: unknown): Db {
  return client as Db
}

export type EscrituraSeccional = {
  /** El nombre canónico que quedó guardado. `null` = no se escribió nada. */
  guardado: string | null
  /** Lo que había antes, tal cual estaba. */
  previo: string | null
  /**
   * Por qué no se escribió, cuando `guardado` es null:
   *  - `no_reconocida`: el texto no corresponde a ninguna seccional del catálogo.
   *    Pasa con "Otras seccionales", que es una clave de preset del 010 y no una
   *    seccional: guardarla borraría de qué ciudad es el caso.
   *  - `ya_tenia`: ya había una y no se pidió pisarla.
   */
  motivo: 'no_reconocida' | 'ya_tenia' | null
  error: string | null
}

/**
 * Escribe la seccional de un negocio, canonizada.
 *
 * `pisar: false` (el default) es para las siembras automáticas: no tocan una seccional
 * ya establecida, porque puede ser una corrección manual del operador. `pisar: true` es
 * para esa corrección manual.
 *
 * Un texto que no se reconoce NO se guarda y NO degrada lo que ya había. Antes se
 * escribía cualquier cosa que llegara, y así entraron al dato las claves de preset.
 */
export async function fijarSeccionalNegocio(
  supabase: unknown,
  params: { negocioId: string; entrada: string | null | undefined; pisar?: boolean },
): Promise<EscrituraSeccional> {
  const { negocioId, entrada, pisar = false } = params

  const { data: neg } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .maybeSingle()

  const metadata = ((neg as { metadata: Record<string, unknown> | null } | null)?.metadata ?? {}) as Record<string, unknown>
  const previo = ((metadata.seccional as string | undefined)?.trim() || null)

  const canonico = canonizarSeccional(entrada)
  if (!canonico) return { guardado: null, previo, motivo: 'no_reconocida', error: null }
  if (previo && !pisar) return { guardado: null, previo, motivo: 'ya_tenia', error: null }
  if (previo === canonico) return { guardado: canonico, previo, motivo: null, error: null }

  const { error } = await db(supabase)
    .from('negocios')
    .update({ metadata: { ...metadata, seccional: canonico } })
    .eq('id', negocioId)

  return {
    guardado: error ? null : canonico,
    previo,
    motivo: null,
    error: (error as { message: string } | null)?.message ?? null,
  }
}
