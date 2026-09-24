'use server'

/**
 * Los datos de la pestaña Marketplace: los totales generales del piloto Dimpro x MeTRIK.
 *
 * Aquí solo se LEE. Se trae la materia prima (publicaciones, cambios de estado, mediciones,
 * conversaciones y ventas) y el cálculo lo hace `@/lib/tableros/ferreteria`, puro y probado, en
 * el navegador: el selector de periodo cambia de rango sin volver al servidor. El volumen lo
 * permite (unas decenas de avisos, ~60 mediciones por día).
 *
 * Las lecturas van con el cliente de la SESIÓN (RLS por workspace) y además se acotan por
 * `workspace_id` a mano, igual que la pantalla `/ferreteria`. Las que crecen cada día pasan por
 * `traerTodo`: el techo de 1.000 filas de PostgREST no avisa.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { traerTodo } from '@/lib/supabase/paginar'
import { todayBogotaISO } from '@/lib/dates/bogota'
import type { CambioEstado, DatosPiloto, Publicacion } from '@/lib/tableros/ferreteria'

export interface PilotoMarketplaceData {
  datos: DatosPiloto
  /** `YYYY-MM-DD` de hoy en Bogotá, resuelto en el servidor. */
  hoy: string
}

function lanzar(ctx: string, e: { message: string } | null) {
  if (e) throw new Error(`[tablero ferreteria] ${ctx}: ${e.message}`)
}

/** Día de Bogotá de un instante guardado en UTC. */
const diaBogota = (ts: string) => todayBogotaISO(new Date(ts))

export async function getPilotoMarketplace(): Promise<PilotoMarketplaceData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  if (!(await exigirModulo(REQUISITO.ferreteria)).ok) return null
  const db = supabase as unknown as SupabaseClient
  const ws = workspaceId

  const [pubsR, eventos, mediciones, conversaciones, ventasR] = await Promise.all([
    db.from('ferreteria_publicaciones').select('id, estado, created_at, fecha_publicacion').eq('workspace_id', ws),
    traerTodo<{ publicacion_id: string; valor_anterior: string | null; valor_nuevo: string | null; created_at: string }>(
      (desde, hasta) =>
        db
          .from('ferreteria_eventos')
          .select('publicacion_id, valor_anterior, valor_nuevo, created_at')
          .eq('workspace_id', ws)
          .eq('tipo', 'cambio_estado')
          .eq('campo', 'estado')
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'ferreteria_eventos' },
    ),
    traerTodo<{ publicacion_id: string; fecha: string; clics_acumulados: number }>(
      (desde, hasta) =>
        db
          .from('ferreteria_mediciones')
          .select('publicacion_id, fecha, clics_acumulados')
          .eq('workspace_id', ws)
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'ferreteria_mediciones' },
    ),
    traerTodo<{ fecha: string }>(
      (desde, hasta) =>
        db.from('ferreteria_conversaciones').select('fecha').eq('workspace_id', ws).order('id').range(desde, hasta),
      { etiqueta: 'ferreteria_conversaciones' },
    ),
    db.from('ferreteria_ventas').select('fecha_primer_pago, precio_final, costo_dia, ganancia').eq('workspace_id', ws),
  ])
  lanzar('publicaciones', pubsR.error)
  lanzar('ventas', ventasR.error)

  const cambios: CambioEstado[] = eventos
    .filter((e) => e.valor_nuevo)
    .map((e) => ({
      publicacion_id: e.publicacion_id,
      fecha: diaBogota(e.created_at),
      instante: e.created_at,
      anterior: e.valor_anterior,
      nuevo: e.valor_nuevo as string,
    }))

  // Desde cuándo existe cada aviso: lo más temprano entre su publicación, su alta y su primer
  // evento. Medido: hay eventos de estado anteriores al `created_at` del aviso (se cargó después).
  const primerEvento = new Map<string, string>()
  for (const c of cambios) {
    const f = primerEvento.get(c.publicacion_id)
    if (!f || c.fecha < f) primerEvento.set(c.publicacion_id, c.fecha)
  }
  const publicaciones: Publicacion[] = (
    (pubsR.data ?? []) as { id: string; estado: string; created_at: string; fecha_publicacion: string | null }[]
  ).map((p) => {
    const candidatas = [diaBogota(p.created_at), p.fecha_publicacion?.slice(0, 10), primerEvento.get(p.id)].filter(
      (x): x is string => !!x,
    )
    return { id: p.id, estado: p.estado, desde: candidatas.sort()[0] }
  })

  return {
    hoy: todayBogotaISO(),
    datos: {
      publicaciones,
      cambios,
      mediciones: mediciones.map((m) => ({ ...m, clics_acumulados: Number(m.clics_acumulados) })),
      conversaciones: conversaciones.map((c) => ({ fecha: c.fecha.slice(0, 10) })),
      ventas: (
        (ventasR.data ?? []) as { fecha_primer_pago: string | null; precio_final: number; costo_dia: number; ganancia: number }[]
      ).map((v) => ({
        fecha_primer_pago: v.fecha_primer_pago,
        precio_final: Number(v.precio_final),
        costo_dia: Number(v.costo_dia),
        ganancia: Number(v.ganancia),
      })),
    },
  }
}
