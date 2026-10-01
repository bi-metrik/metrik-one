'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { leerVersionesTarifa } from '@/lib/propuesta/tarifas-servidor'
import {
  RUTA_BLOQUE_SLUG,
  RUTA_CAMPO,
  validarTarifaNueva,
  type TarifaNueva,
  type TarifaVersion,
} from '@/lib/propuesta/tarifas'

// Quién edita las tarifas: el mismo criterio que los términos de la propuesta (dueño o
// administrador). Por ROL, no por persona ni por cargo: un supervisor aprueba descuentos
// altos, pero fijar la lista de precios es otra decisión.
const ROLES_QUE_EDITAN = ['owner', 'admin']

export interface RutaDisponible {
  valor: string
  nombre: string
}

export interface TarifasServicioVista {
  versiones: Array<TarifaVersion & { creado_por_nombre: string | null }>
  /** Rutas que un negocio puede declarar hoy (opciones de «¿Qué contrató el cliente?»). */
  rutasDisponibles: RutaDisponible[]
  puedeEditar: boolean
  /** Hoy en Bogotá: la vigencia mínima de una versión nueva. */
  hoy: string
}

type Sb = Awaited<ReturnType<typeof getWorkspace>>['supabase']

/** Servicios que una propuesta económica del workspace usa (`auto_propuesta.servicio_id`). */
async function serviciosDePropuesta(supabase: Sb, workspaceId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('bloque_configs')
    .select('config_extra, bloque_definitions!inner(tipo)')
    .eq('workspace_id', workspaceId)
    .eq('bloque_definitions.tipo', 'propuesta_economica')
  const ids = new Set<string>()
  for (const fila of (data ?? []) as Array<{ config_extra: Record<string, unknown> | null }>) {
    const ce = fila.config_extra ?? {}
    if (ce.readonly === true) continue
    const auto = (ce.auto_propuesta ?? null) as { servicio_id?: string } | null
    const id = (ce.servicio_id as string | undefined) ?? auto?.servicio_id
    if (id) ids.add(id)
  }
  return ids
}

/** Ids de los servicios que pueden llevar tarifas por plan y ruta (los usa una propuesta). */
export async function getServiciosConTarifas(): Promise<string[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []
  return [...(await serviciosDePropuesta(supabase, workspaceId))]
}

async function rutasDelWorkspace(supabase: Sb, workspaceId: string): Promise<RutaDisponible[]> {
  const { data } = await supabase
    .from('bloque_configs')
    .select('config_extra')
    .eq('workspace_id', workspaceId)
    .eq('slug', RUTA_BLOQUE_SLUG)
  const rutas: RutaDisponible[] = []
  for (const fila of (data ?? []) as Array<{ config_extra: Record<string, unknown> | null }>) {
    const fields = ((fila.config_extra ?? {}).fields ?? []) as Array<{
      slug?: string
      opciones?: Array<{ value?: string; label?: string }>
    }>
    const campo = fields.find(f => f.slug === RUTA_CAMPO)
    for (const o of campo?.opciones ?? []) {
      if (!o.value || rutas.some(r => r.valor === o.value)) continue
      rutas.push({ valor: o.value, nombre: o.label ?? o.value })
    }
  }
  return rutas
}

export async function getTarifasServicio(
  servicioId: string,
): Promise<{ error: string } | TarifasServicioVista> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: error ?? 'Sin workspace' }

  const { data: servicio } = await supabase
    .from('servicios')
    .select('id')
    .eq('id', servicioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!servicio) return { error: 'Servicio no encontrado' }

  const [versiones, rutasDisponibles] = await Promise.all([
    leerVersionesTarifa(supabase, servicioId),
    rutasDelWorkspace(supabase, workspaceId),
  ])

  const autores = [...new Set(versiones.map(v => v.creado_por).filter((x): x is string => !!x))]
  const nombres = new Map<string, string>()
  if (autores.length > 0) {
    const { data: staff } = await supabase.from('staff').select('id, full_name').in('id', autores)
    for (const s of (staff ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (s.full_name) nombres.set(s.id, s.full_name)
    }
  }

  return {
    versiones: versiones
      .map(v => ({ ...v, creado_por_nombre: v.creado_por ? nombres.get(v.creado_por) ?? null : null }))
      .sort((a, b) => b.version - a.version),
    rutasDisponibles,
    puedeEditar: ROLES_QUE_EDITAN.includes(role ?? ''),
    hoy: todayBogotaISO(),
  }
}

/**
 * Guarda una versión NUEVA de tarifas. Nunca edita una existente (la base lo impide):
 * la anterior queda en el historial y sigue rigiendo los negocios que ya la usaron.
 */
export async function guardarTarifasServicio(
  servicioId: string,
  input: TarifaNueva,
): Promise<{ error: string } | { ok: true; version: number }> {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: error ?? 'Sin workspace' }
  if (!ROLES_QUE_EDITAN.includes(role ?? '')) {
    return { error: 'Solo el dueño o el administrador del workspace pueden cambiar las tarifas' }
  }

  const { data: servicio } = await supabase
    .from('servicios')
    .select('id')
    .eq('id', servicioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!servicio) return { error: 'Servicio no encontrado' }

  const validada = validarTarifaNueva(input, todayBogotaISO())
  if ('error' in validada) return { error: validada.error }
  const t = validada.tarifa

  const previas = await leerVersionesTarifa(supabase, servicioId)
  const version = previas.reduce((m, v) => Math.max(m, v.version), 0) + 1

  // La tabla no concede escritura a `authenticated`: el rol ya se revisó arriba y aquí
  // escribe el servidor, con el workspace fijado por la sesión y no por el navegador.
  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errIns } = await (sb as any)
    .from('servicio_tarifas_versiones')
    .insert({
      workspace_id: workspaceId,
      servicio_id: servicioId,
      version,
      vigente_desde: t.vigente_desde,
      planes: t.planes,
      rutas: t.rutas,
      no_ofrece: t.no_ofrece,
      cap_descuento_pct: t.cap_descuento_pct,
      creado_por: staffId ?? null,
      nota: t.nota ?? null,
    })
  if (errIns) {
    if ((errIns as { code?: string }).code === '23505') {
      return { error: 'Alguien guardó otra versión al mismo tiempo. Recarga y vuelve a intentarlo.' }
    }
    return { error: (errIns as { message: string }).message }
  }

  revalidatePath('/mi-negocio')
  return { ok: true, version }
}
