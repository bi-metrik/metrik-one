'use server'

// Bandeja de solicitudes de llamada que deja el bot de WhatsApp.
//
// Las filas las INSERTA la edge function con service_role; desde la app solo
// se leen y se trabajan (tomar / resolver / descartar). Por eso `cs_escalamientos`
// tiene policy y grant de select+update para `authenticated`, pero no de insert:
// nadie crea una solicitud a mano, siempre nace de una conversación real.

import { revalidatePath } from 'next/cache'
import { getWorkspace } from './get-workspace'

export type EstadoSolicitud = 'pendiente' | 'tomado' | 'resuelto' | 'descartado'

export interface TurnoConversacion {
  role: 'user' | 'model'
  text: string
}

export interface SolicitudLlamada {
  id: string
  phone: string
  clienteNombre: string | null
  motivo: string
  franja: string | null
  resumen: string | null
  conversacion: TurnoConversacion[]
  estado: EstadoSolicitud
  creadaEn: string
  tomadaPor: string | null
  tomadaEn: string | null
  resueltaEn: string | null
  notaCierre: string | null
  // Contexto del caso, para que el agente no tenga que buscarlo aparte.
  casoCodigo: string | null
  casoId: string | null
  contactoId: string | null
}

// Roles que trabajan la bandeja. `read_only` y `contador` no: esto es
// operación, no consulta.
const ROLES_BANDEJA = ['owner', 'admin', 'supervisor', 'operator']

/**
 * `cs_escalamientos` todavía no está en `database.ts` generado. Mismo patrón
 * acotado que usa el módulo de calidad: un solo cast aquí, en vez de dispersar
 * `as any` por el archivo.
 *
 * DEUDA: al regenerar los tipos, borrar esto y consultar el cliente directo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sinTipar = (cliente: unknown) => cliente as any

export async function getSolicitudes(): Promise<
  { data: SolicitudLlamada[]; error: null } | { data: null; error: string }
> {
  const ws = await getWorkspace()
  if (!ws.workspaceId || !ws.role) return { data: null, error: 'Sin sesión' }
  if (!ROLES_BANDEJA.includes(ws.role)) return { data: null, error: 'Sin permiso' }

  const { data, error } = await sinTipar(ws.supabase)
    .from('cs_escalamientos')
    .select(`
      id, phone, cliente_nombre, motivo, franja, resumen, conversacion,
      estado, created_at, tomado_at, resuelto_at, nota_cierre, contacto_id,
      negocio_id,
      staff:tomado_por ( full_name ),
      negocio:negocio_id ( codigo )
    `)
    .eq('workspace_id', ws.workspaceId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return { data: null, error: error.message }

  // deno-lint-ignore no-explicit-any
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const filas = (data ?? []).map((r: any) => ({
    id: r.id,
    phone: r.phone,
    clienteNombre: r.cliente_nombre,
    motivo: r.motivo,
    franja: r.franja,
    resumen: r.resumen,
    conversacion: Array.isArray(r.conversacion) ? r.conversacion : [],
    estado: r.estado as EstadoSolicitud,
    creadaEn: r.created_at,
    tomadaPor: r.staff?.full_name ?? null,
    tomadaEn: r.tomado_at,
    resueltaEn: r.resuelto_at,
    notaCierre: r.nota_cierre,
    casoCodigo: r.negocio?.codigo ?? null,
    casoId: r.negocio_id,
    contactoId: r.contacto_id,
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { data: filas, error: null }
}

/** El agente se asigna la solicitud antes de llamar, para que dos no llamen al mismo cliente. */
export async function tomarSolicitud(id: string): Promise<{ ok: boolean; error?: string }> {
  const ws = await getWorkspace()
  if (!ws.workspaceId || !ws.role) return { ok: false, error: 'Sin sesión' }
  if (!ROLES_BANDEJA.includes(ws.role)) return { ok: false, error: 'Sin permiso' }

  // El filtro por estado es la barrera contra dos agentes tomando a la vez:
  // el segundo no encuentra fila que actualizar.
  const { data, error } = await sinTipar(ws.supabase)
    .from('cs_escalamientos')
    .update({ estado: 'tomado', tomado_por: ws.staffId, tomado_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', ws.workspaceId)
    .eq('estado', 'pendiente')
    .select('id')

  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) {
    return { ok: false, error: 'Alguien más tomó esta solicitud' }
  }
  revalidatePath('/solicitudes')
  return { ok: true }
}

export async function cerrarSolicitud(
  id: string,
  desenlace: 'resuelto' | 'descartado',
  nota?: string,
): Promise<{ ok: boolean; error?: string }> {
  const ws = await getWorkspace()
  if (!ws.workspaceId || !ws.role) return { ok: false, error: 'Sin sesión' }
  if (!ROLES_BANDEJA.includes(ws.role)) return { ok: false, error: 'Sin permiso' }

  const { error } = await sinTipar(ws.supabase)
    .from('cs_escalamientos')
    .update({
      estado: desenlace,
      resuelto_at: new Date().toISOString(),
      nota_cierre: nota?.trim() || null,
    })
    .eq('id', id)
    .eq('workspace_id', ws.workspaceId)
    .in('estado', ['pendiente', 'tomado'])

  if (error) return { ok: false, error: error.message }
  revalidatePath('/solicitudes')
  return { ok: true }
}
