/**
 * Siembra `negocios.metadata.seccional` cuando se procesa el RUT.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * La seccional del caso sale del RUT, pero hasta ahora solo se escribía en la rama
 * del auto-init de cita DIAN (`getNegocioDetalle`), que corre únicamente cuando ese
 * bloque aplica Y alguien abre el negocio. Un negocio con el RUT cargado cuya rama no
 * aplica se quedaba con el dato en null, y de ahí cuelgan la casilla 12 del Formato
 * 010, el buzón de la Guía de Devolución y el corte con/sin cita del tablero.
 *
 * No era un residuo que un backfill agotara: el de 2026-08-25 corrió por la mañana y
 * medio día después ya habían aparecido 4 casos nuevos. Por eso la escritura se mueve
 * al momento en que el dato NACE — cuando se extrae o se corrige el RUT— y deja de
 * depender de que una rama concreta del flujo se active.
 *
 * ⚠️ El bloque y el campo NO se hardcodean: salen de la misma config que ya declara
 * dónde vive la seccional (`bloque_configs.config_extra.cita_dian_confirmacion`), la
 * que consumen el auto-init y el backfill. Hardcodear `'rut'` leería cero filas el día
 * que una línea renombre su bloque, en silencio.
 */

import { fijarSeccionalNegocio, type EscrituraSeccional } from './seccional-negocio'

/** Los mismos defaults que aplica el auto-init cuando la config no los declara. */
const RUT_SLUG_DEFAULT = 'rut'
const SECCIONAL_FIELD_DEFAULT = 'direccion_seccional'

export type CitaDianConfig = {
  rut_slug?: string | null
  seccional_field?: string | null
} | null | undefined

/**
 * Si el bloque que se acaba de procesar ES el RUT de alguna de las configs de la
 * línea, devuelve el nombre del campo del que hay que leer la seccional. Si no, null.
 *
 * Una línea puede declarar varias configs de cita (SOENA tiene dos: la del trámite
 * completo y la de solo-IVA) y todas apuntan al mismo RUT. Basta que UNA lo declare.
 */
export function campoSeccionalDelBloque(
  bloqueSlug: string | null | undefined,
  configs: CitaDianConfig[],
): string | null {
  const slug = (bloqueSlug ?? '').trim()
  if (!slug) return null
  for (const c of configs) {
    if (!c) continue
    if ((c.rut_slug ?? RUT_SLUG_DEFAULT) === slug) {
      return c.seccional_field ?? SECCIONAL_FIELD_DEFAULT
    }
  }
  return null
}

type Campos = Record<string, { value?: unknown } | undefined>

/** Saca el texto de la seccional de los campos extraídos, o '' si no hay. */
export function textoSeccionalDeCampos(campos: Campos | null | undefined, campo: string): string {
  return String(campos?.[campo]?.value ?? '').trim()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

/**
 * Escribe la seccional del negocio a partir de los campos recién extraídos del RUT.
 *
 * `pisar: false` a propósito: una seccional ya establecida puede ser una corrección
 * manual hecha en el 010 (que escribe con `pisar: true`), y el dato crudo del
 * documento no puede deshacerla. Sembrar lo que falta sí; reabrir una decisión no.
 *
 * Nunca lanza: es un efecto lateral del guardado de un documento, y un fallo aquí no
 * puede convertir en error una extracción que sí funcionó.
 */
export async function sembrarSeccionalDesdeRut(
  supabase: unknown,
  params: { negocioId: string; bloqueId: string; campos: Campos | null | undefined },
): Promise<EscrituraSeccional | null> {
  const { negocioId, bloqueId, campos } = params
  if (!campos || Object.keys(campos).length === 0) return null

  try {
    const db = supabase as Db

    // Slug del bloque procesado + línea del negocio.
    const { data: bloque } = await db
      .from('negocio_bloques')
      .select('bloque_configs(slug)')
      .eq('id', bloqueId)
      .maybeSingle()
    const bloqueSlug = (bloque as { bloque_configs?: { slug?: string | null } | null } | null)
      ?.bloque_configs?.slug
    if (!bloqueSlug) return null

    const { data: neg } = await db
      .from('negocios')
      .select('linea_id')
      .eq('id', negocioId)
      .maybeSingle()
    const lineaId = (neg as { linea_id?: string | null } | null)?.linea_id
    if (!lineaId) return null

    const { data: etapas } = await db
      .from('etapas_negocio')
      .select('id')
      .eq('linea_id', lineaId)
    const etapaIds = ((etapas ?? []) as Array<{ id: string }>).map(e => e.id)
    if (etapaIds.length === 0) return null

    const { data: configs } = await db
      .from('bloque_configs')
      .select('config_extra')
      .in('etapa_id', etapaIds)
    const citas = ((configs ?? []) as Array<{ config_extra: Record<string, unknown> | null }>)
      .map(c => c.config_extra?.cita_dian_confirmacion as CitaDianConfig)
      .filter(Boolean)

    const campo = campoSeccionalDelBloque(bloqueSlug, citas)
    if (!campo) return null

    const texto = textoSeccionalDeCampos(campos, campo)
    if (!texto) return null

    return await fijarSeccionalNegocio(supabase, { negocioId, entrada: texto })
  } catch (e) {
    console.error('[seccional-desde-documento] no se pudo sembrar la seccional:', e)
    return null
  }
}
