import 'server-only'

/**
 * La bóveda de llaves de un workspace, del lado del servidor. Todo con service role contra las funciones `boveda_*`
 * (migración 20261026200000), que vuelven a exigir que el actor sea el dueño.
 *
 * Las tres garantías que se le prometen al cliente:
 *   1. Solo el DUEÑO carga, reemplaza o borra (`esDuenoDelWorkspace`: rol owner, sin «Ver como», sin ser platform
 *      admin de MéTRIK). Borrar desconecta de inmediato: la pasarela lee las llaves en cada uso, sin caché.
 *   2. Cada cambio queda en el registro (quién, cuándo, qué clave, acción), sin el valor.
 *   3. Una llave guardada no sale nunca: de aquí solo salen «configurada», los últimos 4 y la fecha. Lo amarra
 *      `boveda-servidor.test.ts`.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { esDuenoDelWorkspace, leerPlatformAdmin } from '@/lib/permissions/dueno-workspace'
import { probarConexionBold, CLAVES_BOLD } from '../../../supabase/functions/_shared/funciones/bold-workspace.ts'
import {
  INTEGRACIONES_BOVEDA,
  integracionBoveda,
  llaveConForma,
  type EntradaAuditoria,
  type EstadoIntegracion,
} from './integraciones'

type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>
}

export interface Actor {
  workspaceId: string
  userId: string
  esDueno: boolean
  /** Puede ver la bóveda (estado y registro, nunca valores): el rol efectivo es owner. */
  puedeVer: boolean
}

export async function actorBoveda(): Promise<Actor | null> {
  const { workspaceId, userId, role, impersonating } = await getWorkspace()
  if (!workspaceId || !userId) return null
  const platformAdmin = await leerPlatformAdmin(createServiceClient(), userId)
  return {
    workspaceId,
    userId,
    esDueno: esDuenoDelWorkspace({ role, impersonating, platformAdmin }),
    puedeVer: role === 'owner',
  }
}

const servicio = () => createServiceClient() as unknown as ClienteRpc

export async function leerBoveda(
  workspaceId: string,
  cliente: ClienteRpc = servicio(),
): Promise<{ integraciones: EstadoIntegracion[]; auditoria: EntradaAuditoria[] }> {
  const [estado, registro] = await Promise.all([
    cliente.rpc('boveda_estado', { p_workspace_id: workspaceId }),
    cliente.rpc('boveda_auditoria_de', { p_workspace_id: workspaceId, p_limite: 50 }),
  ])
  if (estado.error) throw new Error(`boveda_estado: ${estado.error.code ?? 'error'}`)
  if (registro.error) throw new Error(`boveda_auditoria_de: ${registro.error.code ?? 'error'}`)
  const filas = new Map<string, { ultimos4: string | null; actualizadoAt: string | null }>()
  for (const f of (Array.isArray(estado.data) ? estado.data : []) as Array<Record<string, unknown>>) {
    if (typeof f.clave !== 'string') continue
    filas.set(f.clave, {
      ultimos4: typeof f.ultimos4 === 'string' ? f.ultimos4.slice(-4) : null,
      actualizadoAt: typeof f.actualizado_at === 'string' ? f.actualizado_at : null,
    })
  }
  const integraciones = INTEGRACIONES_BOVEDA.map((i) => ({
    id: i.id,
    nombre: i.nombre,
    para: i.para,
    probarConexion: i.probarConexion,
    claves: i.claves.map((c) => {
      const f = filas.get(c.clave)
      return { clave: c.clave, etiqueta: c.etiqueta, configurada: !!f, ultimos4: f?.ultimos4 ?? null, actualizadoAt: f?.actualizadoAt ?? null }
    }),
  }))
  const auditoria = ((Array.isArray(registro.data) ? registro.data : []) as Array<Record<string, unknown>>).map((a) => ({
    clave: String(a.clave ?? ''),
    accion: a.accion as EntradaAuditoria['accion'],
    actor: String(a.actor ?? ''),
    createdAt: String(a.created_at ?? ''),
  }))
  return { integraciones, auditoria }
}

export type ResultadoBoveda = { ok: true } | { ok: false; error: string }

const SIN_PERMISO = 'Solo el dueño del espacio puede cambiar las llaves.'

export async function guardarLlave(
  actor: Actor,
  integracionId: string,
  clave: string,
  valor: string,
  cliente: ClienteRpc = servicio(),
): Promise<ResultadoBoveda> {
  if (!actor.esDueno) return { ok: false, error: SIN_PERMISO }
  const integracion = integracionBoveda(integracionId)
  const def = integracion?.claves.find((c) => c.clave === clave)
  if (!integracion || !def) return { ok: false, error: 'Esa llave no existe.' }
  const limpio = typeof valor === 'string' ? valor.trim() : ''
  if (!llaveConForma(limpio)) return { ok: false, error: 'Pega la llave completa, sin espacios.' }
  const { error } = await cliente.rpc('boveda_guardar', {
    p_workspace_id: actor.workspaceId,
    p_clave: clave,
    p_valor: limpio,
    p_actor: actor.userId,
    p_conservar_anterior: def.conservarAnterior === true,
  })
  if (error) {
    // Ni el valor ni el mensaje de la base (que podría citarlo) salen de aquí.
    console.error(`[boveda] no se guardó ${clave} en ${actor.workspaceId}: ${error.code ?? 'error'}`)
    return { ok: false, error: /boveda_sin_permiso/.test(error.message) ? SIN_PERMISO : 'No se pudo guardar la llave. Intenta de nuevo.' }
  }
  return { ok: true }
}

export async function borrarIntegracion(actor: Actor, integracionId: string, cliente: ClienteRpc = servicio()): Promise<ResultadoBoveda> {
  if (!actor.esDueno) return { ok: false, error: SIN_PERMISO }
  const integracion = integracionBoveda(integracionId)
  if (!integracion) return { ok: false, error: 'Esa integración no existe.' }
  const { error } = await cliente.rpc('boveda_borrar', {
    p_workspace_id: actor.workspaceId,
    p_claves: [...integracion.clavesAlBorrar],
    p_actor: actor.userId,
  })
  if (error) {
    console.error(`[boveda] no se borró ${integracionId} en ${actor.workspaceId}: ${error.code ?? 'error'}`)
    return { ok: false, error: /boveda_sin_permiso/.test(error.message) ? SIN_PERMISO : 'No se pudo borrar. Intenta de nuevo.' }
  }
  return { ok: true }
}

/** «Probar conexión»: solo funciona / no funciona. La llave se lee en el servidor y no sale de él. */
export async function probarConexion(
  actor: Actor,
  integracionId: string,
  deps: { cliente?: ClienteRpc; fetch?: typeof fetch } = {},
): Promise<{ ok: true; funciona: boolean } | { ok: false; error: string }> {
  if (!actor.puedeVer) return { ok: false, error: SIN_PERMISO }
  if (integracionId !== 'bold') return { ok: false, error: 'Esa integración no tiene prueba de conexión.' }
  const cliente = deps.cliente ?? servicio()
  const { data, error } = await cliente.rpc('leer_secretos_workspace', { p_workspace_id: actor.workspaceId })
  if (error) return { ok: false, error: 'No se pudo leer la bóveda. Intenta de nuevo.' }
  const identidad = (data as Record<string, unknown> | null)?.[CLAVES_BOLD.identidad]
  if (typeof identidad !== 'string' || !identidad) return { ok: true, funciona: false }
  return { ok: true, funciona: await probarConexionBold(identidad, deps.fetch ?? fetch) }
}
