/**
 * La ranura contra la base: crearla, encontrar la de un grupo, renombrarla, copiarla y
 * retirarla cuando se queda sin opciones. Lo puro vive en `ranuras-cotizacion.ts`.
 *
 * ## Tolerante a la migración pendiente, y por qué
 *
 * El código se despliega ANTES que `20260923233000_cotizacion_ranuras_y_captura.sql`. Mientras
 * la tabla no exista, todo aquí devuelve «no hay ranura» y quien llama sigue como hoy:
 * escribe `items.grupo` y nada más. Nada de esto puede tumbar una escritura que ya sirvió —
 * crear una línea, renombrar una columna— porque la ranura es la entidad que la pantalla
 * nombra, no lo que decide el total (eso sigue siendo el grupo).
 *
 * ⚠️ Toda lectura de `items` va con `select('*')`: nombrar `ranura_id` devolvería un 400
 * mientras la columna no exista, y el editor dejaría de abrir.
 */

import { normalizarGrupo } from './itinerarios'
import { formaDesdeGrupo, type FormaDeRanura, type TipoRanura, esTipoRanura } from './ranuras-cotizacion'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

export interface RanuraGuardada {
  id: string
  cotizacion_id: string
  tipo: TipoRanura
  nombre: string | null
  numero: number | null
  orden: number
}

/**
 * ¿El error es que la tabla o la columna todavía no existen? Es el único error que se
 * traga: cualquier otro se reporta, porque ahí sí hay algo roto.
 */
export function faltaLaMigracionDeRanuras(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code ?? '')) return true
  const m = (error.message ?? '').toLowerCase()
  return m.includes('cotizacion_ranuras') || m.includes('ranura_id')
}

function aRanura(fila: Record<string, unknown>): RanuraGuardada | null {
  if (!esTipoRanura(fila.tipo)) return null
  return {
    id: fila.id as string,
    cotizacion_id: fila.cotizacion_id as string,
    tipo: fila.tipo,
    nombre: (fila.nombre ?? null) as string | null,
    numero: typeof fila.numero === 'number' ? fila.numero : null,
    orden: typeof fila.orden === 'number' ? fila.orden : 0,
  }
}

/** Las ranuras de una cotización, en orden. `null` = la tabla no existe todavía. */
async function leerRanurasDeCotizacionSin(
  supabase: Supabase,
  cotizacionId: string,
): Promise<RanuraGuardada[] | null> {
  const { data, error } = await supabase
    .from('cotizacion_ranuras')
    .select('*')
    .eq('cotizacion_id', cotizacionId)
    .order('orden')
  if (error) {
    if (!faltaLaMigracionDeRanuras(error)) console.error('[ranuras] no se pudieron leer:', error.message)
    return null
  }
  return ((data ?? []) as Record<string, unknown>[]).map(aRanura).filter((r): r is RanuraGuardada => r !== null)
}

/**
 * Crea la fila de una ranura. `null` = no se pudo (tabla ausente o error), y quien llama
 * sigue sin ella: la línea queda agrupada por su `grupo`, como antes.
 */
async function crearRanuraSin(
  supabase: Supabase,
  args: { workspaceId: string; cotizacionId: string; forma: FormaDeRanura },
): Promise<string | null> {
  const existentes = await leerRanurasDeCotizacion(supabase, args.cotizacionId)
  if (existentes === null) return null
  const orden = existentes.reduce((m, r) => Math.max(m, r.orden), 0) + 1
  const { data, error } = await supabase
    .from('cotizacion_ranuras')
    .insert({
      workspace_id: args.workspaceId,
      cotizacion_id: args.cotizacionId,
      tipo: args.forma.tipo,
      nombre: args.forma.nombre,
      numero: args.forma.numero,
      orden,
    })
    .select('id')
    .single()
  if (error || !data) {
    if (!faltaLaMigracionDeRanuras(error)) console.error('[ranuras] no se pudo crear:', error?.message)
    return null
  }
  return (data as { id: string }).id
}

/**
 * La ranura de un grupo dentro de una cotización: la de las líneas que ya lo llevan, o una
 * nueva si nadie lo lleva todavía. `null` si el grupo no es una ranura del catálogo, o si la
 * tabla no existe.
 *
 * ⚠️ Se reconoce por las LÍNEAS que ya tienen ese grupo, no comparando el nombre de la
 * ranura: el grupo es la clave con la que el motor agrupa, y dos caminos distintos para la
 * misma pregunta se desincronizan. `excluirItemId` es la línea que se está moviendo, que
 * ya lleva el grupo nuevo pero todavía cuelga de su ranura vieja.
 */
async function ranuraDelGrupoSin(
  supabase: Supabase,
  args: { workspaceId: string; cotizacionId: string; grupo: string | null | undefined; excluirItemId?: string },
): Promise<string | null> {
  const grupo = normalizarGrupo(args.grupo)
  const forma = formaDesdeGrupo(grupo)
  if (!grupo || !forma) return null

  const { data: filas, error } = await supabase
    .from('items')
    .select('*')
    .eq('cotizacion_id', args.cotizacionId)
  if (error) {
    console.error('[ranuras] no se pudieron leer las líneas:', error.message)
    return null
  }
  const delGrupo = ((filas ?? []) as Record<string, unknown>[]).filter(f =>
    f.id !== args.excluirItemId && normalizarGrupo(f.grupo as string | null) === grupo,
  )
  const hermana = delGrupo.find(f => typeof f.ranura_id === 'string')
  if (hermana) return hermana.ranura_id as string

  const nueva = await crearRanura(supabase, { workspaceId: args.workspaceId, cotizacionId: args.cotizacionId, forma })
  // Las líneas que ya llevaban ese grupo sin ranura (anteriores a la migración, o creadas
  // mientras la tabla no existía) son hermanas de la nueva: se cuelgan de ella en la misma
  // pasada. Si no, la ranura nacería con una sola de las opciones que el total ya compara.
  const huerfanas = delGrupo.filter(f => !f.ranura_id).map(f => f.id as string)
  if (nueva && huerfanas.length > 0) {
    const { error: errHuerfanas } = await supabase.from('items').update({ ranura_id: nueva }).in('id', huerfanas)
    if (errHuerfanas && !faltaLaMigracionDeRanuras(errHuerfanas)) {
      console.error('[ranuras] no se pudieron colgar las hermanas:', errHuerfanas.message)
    }
  }
  return nueva
}

/**
 * Cuelga la línea de su ranura. No lanza: si la columna no existe, la línea sigue colgando
 * de su grupo, que es lo que decide el total.
 */
async function asignarRanuraSin(supabase: Supabase, itemId: string, ranuraId: string | null): Promise<void> {
  const { error } = await supabase.from('items').update({ ranura_id: ranuraId }).eq('id', itemId)
  if (error && !faltaLaMigracionDeRanuras(error)) {
    console.error('[ranuras] no se pudo colgar la línea de su ranura:', error.message)
  }
}

/**
 * Borra la ranura si ya no le queda ninguna opción. Una ranura vacía se pintaría como un
 * bloque sin nada adentro, y no es algo que el cliente vaya a comprar.
 */
async function retirarRanuraSiQuedoVaciaSin(supabase: Supabase, ranuraId: string | null | undefined): Promise<void> {
  if (!ranuraId) return
  const { data, error } = await supabase.from('items').select('id').eq('ranura_id', ranuraId).limit(1)
  if (error) {
    if (!faltaLaMigracionDeRanuras(error)) console.error('[ranuras] no se pudo revisar la ranura:', error.message)
    return
  }
  if ((data ?? []).length > 0) return
  const { error: errDel } = await supabase.from('cotizacion_ranuras').delete().eq('id', ranuraId)
  if (errDel && !faltaLaMigracionDeRanuras(errDel)) console.error('[ranuras] no se pudo retirar:', errDel.message)
}

/**
 * Deja la fila de la ranura con el nombre de su grupo nuevo (el renombre de la columna). El
 * grupo ya se escribió en las líneas; esto solo mantiene la entidad al día.
 */
async function renombrarRanurasDeLineasSin(
  supabase: Supabase,
  lineas: readonly Record<string, unknown>[],
  grupoNuevo: string,
): Promise<void> {
  const forma = formaDesdeGrupo(grupoNuevo)
  const ids = [...new Set(lineas.map(l => l.ranura_id).filter((id): id is string => typeof id === 'string'))]
  if (!forma || ids.length === 0) return
  const { error } = await supabase
    .from('cotizacion_ranuras')
    .update({ nombre: forma.nombre, numero: forma.numero })
    .in('id', ids)
  if (error && !faltaLaMigracionDeRanuras(error)) console.error('[ranuras] no se pudo renombrar:', error.message)
}

/**
 * Copia las ranuras de una cotización en otra y devuelve el mapa original → copia. `null` =
 * la tabla no existe (no hay nada que copiar). Un error a medias se devuelve como texto: una
 * copia a medias es peor que ninguna.
 */
async function copiarRanurasSin(
  supabase: Supabase,
  args: { workspaceId: string; originalId: string; nuevaId: string },
): Promise<{ mapa: Map<string, string> } | { error: string } | null> {
  const ranuras = await leerRanurasDeCotizacion(supabase, args.originalId)
  if (ranuras === null) return null
  const mapa = new Map<string, string>()
  for (const r of ranuras) {
    const { data, error } = await supabase
      .from('cotizacion_ranuras')
      .insert({
        workspace_id: args.workspaceId,
        cotizacion_id: args.nuevaId,
        tipo: r.tipo,
        nombre: r.nombre,
        numero: r.numero,
        orden: r.orden,
      })
      .select('id')
      .single()
    if (error || !data) return { error: error?.message ?? 'No se pudo copiar una ranura' }
    mapa.set(r.id, (data as { id: string }).id)
  }
  return { mapa }
}

// ── Las puertas: nada de esto puede tumbar a quien llama ─────────────────────
//
// La ranura es la entidad que la pantalla nombra; lo que decide el total es el grupo, que
// quien llama ya escribió. Un fallo inesperado aquí (un doble de pruebas que no implementa
// `insert`, una red que se cae) se reporta y se sigue como si la tabla no existiera.

function seguro<A extends unknown[], R>(nombre: string, fn: (...a: A) => Promise<R>, siFalla: R) {
  return async (...a: A): Promise<R> => {
    try {
      return await fn(...a)
    } catch (e) {
      console.error(`[ranuras] ${nombre} falló:`, e instanceof Error ? e.message : String(e))
      return siFalla
    }
  }
}

/** Las ranuras de una cotización, en orden. `null` = la tabla no existe todavía. */
export const leerRanurasDeCotizacion = seguro('leer', leerRanurasDeCotizacionSin, null)
/** Crea la fila de una ranura. `null` = no se pudo. */
export const crearRanura = seguro('crear', crearRanuraSin, null)
/** La ranura de un grupo: la de sus líneas, o una nueva. `null` = no aplica o no se pudo. */
export const ranuraDelGrupo = seguro('resolver', ranuraDelGrupoSin, null)
/** Cuelga la línea de su ranura. */
export const asignarRanura = seguro('asignar', asignarRanuraSin, undefined)
/** Borra la ranura si ya no le queda ninguna opción. */
export const retirarRanuraSiQuedoVacia = seguro('retirar', retirarRanuraSiQuedoVaciaSin, undefined)
/** Deja la fila de la ranura con el nombre de su grupo nuevo. */
export const renombrarRanurasDeLineas = seguro('renombrar', renombrarRanurasDeLineasSin, undefined)
/**
 * Copia las ranuras de una cotización en otra. Aquí un fallo SÍ se devuelve como error: una
 * copia a medias es peor que ninguna, y quien duplica borra la copia entera.
 */
export async function copiarRanuras(
  supabase: Supabase,
  args: { workspaceId: string; originalId: string; nuevaId: string },
): Promise<{ mapa: Map<string, string> } | { error: string } | null> {
  try {
    return await copiarRanurasSin(supabase, args)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
