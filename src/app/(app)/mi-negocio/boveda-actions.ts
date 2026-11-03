'use server'

/**
 * Acciones de la bóveda de llaves (Configuración → Bóveda de llaves). Ninguna devuelve una llave: la pantalla solo
 * recibe «configurada», los últimos 4, la fecha y el registro. La lógica y las garantías viven en
 * `src/lib/boveda/boveda-servidor.ts`.
 */
import { revalidatePath } from 'next/cache'
import {
  actorBoveda,
  borrarIntegracion,
  guardarLlave,
  leerBoveda,
  probarConexion,
  type ResultadoBoveda,
} from '@/lib/boveda/boveda-servidor'
import type { EntradaAuditoria, EstadoIntegracion } from '@/lib/boveda/integraciones'

const SESION = 'Sesión no válida. Recarga la página.'

export async function getBoveda(): Promise<
  { ok: true; puedeEditar: boolean; integraciones: EstadoIntegracion[]; auditoria: EntradaAuditoria[] } | { ok: false; error: string }
> {
  const actor = await actorBoveda()
  if (!actor) return { ok: false, error: SESION }
  if (!actor.puedeVer) return { ok: false, error: 'Solo el dueño del espacio ve la bóveda de llaves.' }
  try {
    return { ok: true, puedeEditar: actor.esDueno, ...(await leerBoveda(actor.workspaceId)) }
  } catch {
    return { ok: false, error: 'No se pudo leer la bóveda. Intenta de nuevo.' }
  }
}

export async function guardarLlaveAction(integracionId: string, clave: string, valor: string): Promise<ResultadoBoveda> {
  const actor = await actorBoveda()
  if (!actor) return { ok: false, error: SESION }
  const r = await guardarLlave(actor, integracionId, clave, valor)
  if (r.ok) revalidatePath('/mi-negocio')
  return r
}

export async function borrarIntegracionAction(integracionId: string): Promise<ResultadoBoveda> {
  const actor = await actorBoveda()
  if (!actor) return { ok: false, error: SESION }
  const r = await borrarIntegracion(actor, integracionId)
  if (r.ok) revalidatePath('/mi-negocio')
  return r
}

export async function probarConexionAction(integracionId: string) {
  const actor = await actorBoveda()
  if (!actor) return { ok: false as const, error: SESION }
  return probarConexion(actor, integracionId)
}
