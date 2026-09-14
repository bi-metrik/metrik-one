import 'server-only'
import {
  snapshotDePasos,
  describirCambios,
  decidirVersion,
  cierreDeVentana,
  type PasoPlan,
  type VersionVigente,
} from './versionado'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

interface FilaVersion {
  id: string
  numero: number
  creado_por: string | null
  abierta_hasta: string | null
  snapshot: PasoPlan[]
}

/**
 * Corta (o extiende) la versión del cronograma tras un cambio de PLANEACIÓN.
 *
 * Se llama DESPUÉS de escribir el cambio, porque lo que se congela es el plan
 * resultante. Y nunca lanza: si el versionado falla, el cambio del cronograma ya está
 * guardado y perderlo por no poder anotar la versión sería cambiar un problema chico
 * por uno grande. La decisión de si un guardado llega hasta aquí la toma
 * `tocaLaPlaneacion`, no esta función.
 *
 * Los `cambios` que quedan escritos son siempre el diff contra la última versión
 * PUBLICADA (la anterior a la que está abierta), no contra el guardado inmediatamente
 * anterior: quien lee el pie del documento quiere saber qué le movieron desde el
 * cronograma que recibió, no el paso a paso de la edición.
 */
export async function cortarVersionCronograma(
  supabase: Db,
  opciones: { negocioBloqueId: string; workspaceId: string; userId: string | null; ahora?: Date },
): Promise<{ numero: number } | null> {
  const { negocioBloqueId, workspaceId, userId } = opciones
  const ahora = opciones.ahora ?? new Date()

  try {
    const { data: bloque } = await supabase
      .from('negocio_bloques')
      .select('negocio_id')
      .eq('id', negocioBloqueId)
      .maybeSingle()
    const negocioId = (bloque as { negocio_id: string } | null)?.negocio_id
    if (!negocioId) return null

    const [pasosRes, versionesRes] = await Promise.all([
      supabase
        .from('bloque_items')
        .select('id, orden, label, fecha_inicio, fecha_fin, responsable_id')
        .eq('negocio_bloque_id', negocioBloqueId)
        .order('orden', { ascending: true }),
      supabase
        .from('cronograma_versiones')
        .select('id, numero, creado_por, abierta_hasta, snapshot')
        .eq('negocio_bloque_id', negocioBloqueId)
        .order('numero', { ascending: false })
        .limit(2),
    ])

    const actual = snapshotDePasos((pasosRes.data ?? []) as PasoPlan[])
    const versiones = (versionesRes.data ?? []) as FilaVersion[]
    const vigente = versiones[0] ?? null
    const previa = versiones[1] ?? null

    const decision = decidirVersion({
      vigente: vigente as VersionVigente | null,
      autorId: userId,
      ahora,
    })

    // Al acumular, la base del diff es la versión anterior a la abierta: la abierta
    // todavía no salió para ningún lado.
    const base = decision.accion === 'acumular' ? (previa?.snapshot ?? []) : (vigente?.snapshot ?? [])
    const cambios = describirCambios(base, actual)

    if (decision.accion === 'acumular' && vigente) {
      await supabase
        .from('cronograma_versiones')
        .update({ snapshot: actual, cambios, abierta_hasta: cierreDeVentana(ahora) })
        .eq('id', vigente.id)
      return { numero: decision.numero }
    }

    await supabase.from('cronograma_versiones').insert({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      negocio_bloque_id: negocioBloqueId,
      numero: decision.numero,
      snapshot: actual,
      cambios,
      creado_por: userId,
      abierta_hasta: cierreDeVentana(ahora),
    })
    return { numero: decision.numero }
  } catch {
    return null
  }
}
