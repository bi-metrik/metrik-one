'use server'

/**
 * Calendario de temporadas de la agencia (Mauricio, 2026-10-19): alta, media y baja por fechas y
 * por año, en Configuración. Sirve para elegir la tarifa de un hotel cuando su tarifario no trae
 * fechas. Solo en espacios con propuesta de viaje (como «Proveedores»); lo editan dueño y
 * administrador.
 */
import { getWorkspace } from '@/lib/actions/get-workspace'
import { tienePropuestaHtml } from '@/lib/pdf/motor-html'
import { copiarAnio, revisarRango, type RangoTemporada, type Temporada } from '@/lib/temporadas/calendario'

const ROLES_QUE_EDITAN = new Set(['owner', 'admin'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MENSAJE_SIN_MIGRACION = 'El calendario de temporadas todavía no está disponible: falta aplicar la migración de la base.'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string }

function sinTabla(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205' || /temporadas_agencia/.test(e.message ?? ''))
}

async function contexto(escribir: boolean) {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: String(error ?? 'No autenticado') }
  if (escribir && !ROLES_QUE_EDITAN.has(role ?? '')) return { error: 'Solo el dueño o un administrador cambian el calendario de temporadas.' }
  const db = supabase as Cliente
  const { data: ws } = await db.from('workspaces').select('cotizacion_template_slug').eq('id', workspaceId).maybeSingle()
  if (!tienePropuestaHtml((ws as { cotizacion_template_slug?: string | null } | null)?.cotizacion_template_slug)) {
    return { error: 'El calendario de temporadas es de la propuesta de viaje, que este espacio no tiene.' }
  }
  return { db, workspaceId: workspaceId as string, staffId: (staffId as string | null) ?? null, editable: ROLES_QUE_EDITAN.has(role ?? '') }
}

interface FilaRango {
  id: string
  anio: number
  temporada: Temporada
  desde: string
  hasta: string
  nombre: string | null
}

const COLUMNAS = 'id, anio, temporada, desde, hasta, nombre'

export type LecturaTemporadas = Resultado<{ rangos: RangoTemporada[]; editable: boolean }>

/** Todos los rangos del espacio (pocos: unos 10 por año). */
export async function leerTemporadas(): Promise<LecturaTemporadas> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const { data, error } = await ctx.db.from('temporadas_agencia').select(COLUMNAS).eq('workspace_id', ctx.workspaceId).order('desde').limit(2000)
  if (error) return { ok: false, error: sinTabla(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo leer el calendario.' }
  return { ok: true, editable: ctx.editable, rangos: ((data ?? []) as FilaRango[]).map((r) => ({ ...r, anio: Number(r.anio) })) }
}

/** Crea un rango (`id` nulo) o lo corrige. */
export async function guardarRango(id: string | null, entrada: unknown): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const r = revisarRango(entrada)
  if (!r.ok) return r
  const datos = { anio: r.rango.anio, temporada: r.rango.temporada, desde: r.rango.desde, hasta: r.rango.hasta, nombre: r.rango.nombre }
  if (id) {
    if (!UUID.test(id)) return { ok: false, error: 'Ese rango ya no está. Recarga.' }
    const { error } = await ctx.db
      .from('temporadas_agencia')
      .update({ ...datos, updated_at: new Date().toISOString() })
      .eq('workspace_id', ctx.workspaceId)
      .eq('id', id)
    return error ? { ok: false, error: sinTabla(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar. Vuelve a intentarlo.' } : { ok: true }
  }
  const { error } = await ctx.db.from('temporadas_agencia').insert({ ...datos, workspace_id: ctx.workspaceId, created_by: ctx.staffId })
  return error ? { ok: false, error: sinTabla(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar. Vuelve a intentarlo.' } : { ok: true }
}

export async function borrarRango(id: string): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: true }
  const { error } = await ctx.db.from('temporadas_agencia').delete().eq('workspace_id', ctx.workspaceId).eq('id', id)
  return error ? { ok: false, error: 'No se pudo quitar. Vuelve a intentarlo.' } : { ok: true }
}

/**
 * «Copiar del año anterior»: los rangos de `destino − 1` pasan a `destino` (Semana Santa se
 * recalcula con la Pascua del año nuevo). Solo si el año destino está vacío: copiar encima
 * duplicaría rangos.
 */
export async function copiarAnioAnterior(destino: number): Promise<Resultado<{ copiados: number; recalculados: number }>> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!Number.isInteger(destino) || destino < 2021 || destino > 2100) return { ok: false, error: 'El año no es válido.' }
  const { data, error } = await ctx.db.from('temporadas_agencia').select(COLUMNAS).eq('workspace_id', ctx.workspaceId).in('anio', [destino - 1, destino])
  if (error) return { ok: false, error: sinTabla(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo leer el calendario.' }
  const filas = ((data ?? []) as FilaRango[]).map((r) => ({ ...r, anio: Number(r.anio) }))
  if (filas.some((r) => r.anio === destino)) return { ok: false, error: `${destino} ya tiene rangos: bórralos antes de copiar, o edítalos.` }
  const copia = copiarAnio(filas, destino - 1, destino)
  if (copia.length === 0) return { ok: false, error: `${destino - 1} no tiene rangos que copiar.` }
  const { error: e } = await ctx.db
    .from('temporadas_agencia')
    .insert(copia.map((r) => ({ workspace_id: ctx.workspaceId, anio: r.anio, temporada: r.temporada, desde: r.desde, hasta: r.hasta, nombre: r.nombre, created_by: ctx.staffId })))
  if (e) return { ok: false, error: 'No se pudo copiar. Vuelve a intentarlo.' }
  return { ok: true, copiados: copia.length, recalculados: copia.filter((r) => r.recalculado).length }
}
