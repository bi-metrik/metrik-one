import 'server-only'

/**
 * Quién actúa sobre un negocio de viaje y qué puede hacer (Vera C15, §7.4), leído EN EL SERVIDOR.
 * Lo usan las acciones de la confirmación y del riel de cobro: la pantalla solo esconde.
 *
 * Exige `plan_pagos.activo` en la línea (apagado = las acciones se niegan, como hoy) y negocio
 * abierto.
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { configPlanPagos } from './plan-pagos'
import { esAprobador, puedeConfirmarCliente, type QuienConfirma } from './confirmacion'
import { aprobadoresDeLinea } from './estado-servicio'
import { leerNegocioConLinea } from './confirmacion-datos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface ContextoViaje {
  supabase: Db
  workspaceId: string
  userId: string | null
  staffId: string | null
  role: string | null
  configLinea: Record<string, unknown>
  negocio: {
    id: string
    nombre: string | null
    metadata: Record<string, unknown> | null
    contacto_id: string | null
    linea_id: string | null
    etapa_actual_id: string | null
    precio_aprobado: number | null
    estado: string | null
  }
  /** Comercial dueña o dirección: confirmar, cambiar el plan, mandar mensajes, registrar pagos del viajero. */
  puedeConfirmar: boolean
  /** Dirección (owner/admin o `aprobaciones.staff_ids`): aprobar. */
  esDireccion: boolean
  /** Quién actúa, para los permisos que no son confirmar ni aprobar (p. ej. enviar el paquete). */
  quien: QuienConfirma
}

export async function contextoViaje(negocioId: string): Promise<{ ok: true; ctx: ContextoViaje } | { ok: false; error: string }> {
  const { supabase, workspaceId, userId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const base = await leerNegocioConLinea(supabase, workspaceId, negocioId)
  if (!base) return { ok: false, error: 'Negocio no encontrado' }
  if (!configPlanPagos(base.configLinea).activo) return { ok: false, error: 'Esta línea no usa el plan de pagos del viaje.' }
  if (base.negocio.estado && base.negocio.estado !== 'abierto') return { ok: false, error: 'El negocio ya está cerrado.' }
  const aprobadores = aprobadoresDeLinea(base.configLinea)
  let esResponsable = false
  if (staffId) {
    const { data } = await (supabase as Db)
      .from('negocio_responsables')
      .select('staff_id')
      .eq('negocio_id', negocioId)
      .eq('staff_id', staffId)
      .maybeSingle()
    esResponsable = !!data
  }
  const quien = { role, staffId, areas: (areas ?? []) as string[], aprobadores, esResponsable }
  return {
    ok: true,
    ctx: {
      supabase,
      workspaceId,
      userId: userId ?? null,
      staffId: staffId ?? null,
      role: role ?? null,
      configLinea: base.configLinea,
      negocio: base.negocio,
      puedeConfirmar: puedeConfirmarCliente(quien),
      esDireccion: esAprobador(quien),
      quien,
    },
  }
}

/** Nombre y correo de quien actúa (el correo vive en `profiles`, no en `staff`). */
export async function nombreYCorreo(db: Db, staffId: string | null): Promise<{ nombre: string | null; correo: string | null }> {
  if (!staffId) return { nombre: null, correo: null }
  const { data: st } = await db.from('staff').select('full_name, profile_id').eq('id', staffId).maybeSingle()
  const fila = st as { full_name?: string | null; profile_id?: string | null } | null
  let correo: string | null = null
  if (fila?.profile_id) {
    const { data: pr } = await db.from('profiles').select('email').eq('id', fila.profile_id).maybeSingle()
    correo = ((pr as { email?: string | null } | null)?.email ?? '').trim() || null
  }
  return { nombre: (fila?.full_name ?? '').trim() || null, correo }
}
