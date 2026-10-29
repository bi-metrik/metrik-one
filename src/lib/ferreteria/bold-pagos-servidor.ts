import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { procesarPagoBold, type LinkBoldFila, type RepoLinksBold, type SalidaPagoBold } from './bold-pagos'
import { puertoNegociosSistema } from './negocios-puerto'
import { ROLES_EDITORES } from './reglas'
import { repoSupabase } from './repo-supabase'

/**
 * El lado de base y de red de los pagos de Bold del asistente de ventas (`bold-pagos.ts`): la tabla
 * `ferreteria_links_bold` (migración 20261029150000), la conversación de origen, la campana del equipo y el aviso al
 * asistente en la Edge Function `chatwoot-agente`. Todo con el cliente de servicio y acotado al workspace del webhook.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const COLUMNAS =
  'id, workspace_id, referencia, publicacion_id, cantidad, precio_unitario, flete, monto, zona, ruta, comprador_nombre, comprador_telefono, direccion, chatwoot_cuenta_id, chatwoot_conversacion_id, canal, registro, venta_id, veces_recibido'

function aFila(f: Record<string, unknown>): LinkBoldFila {
  return {
    ...(f as unknown as LinkBoldFila),
    cantidad: Number(f.cantidad),
    precio_unitario: Number(f.precio_unitario),
    flete: Number(f.flete),
    monto: Number(f.monto),
  }
}

/** El canal de Chatwoot como canal de una conversación de Ferretería (Messenger llega como `otro`). */
export function canalConversacion(canal: string): 'messenger' | 'whatsapp' | 'instagram' {
  return canal === 'instagram' ? 'instagram' : canal === 'whatsapp' ? 'whatsapp' : 'messenger'
}

export function repoLinksBold(ws: string, cliente: SupabaseClient = createServiceClient() as unknown as SupabaseClient): RepoLinksBold & {
  porReferencia(referencia: string): Promise<LinkBoldFila | null>
} {
  const db = cliente as Db
  return {
    async porReferencia(referencia) {
      const { data, error } = await db.from('ferreteria_links_bold').select(COLUMNAS).eq('workspace_id', ws).eq('referencia', referencia).maybeSingle()
      // Sin la tabla (migración sin aplicar) no hay links del asistente: el pago sigue por el camino de funciones.
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return null
        throw new Error(`leer link de Bold: ${error.message}`)
      }
      return data ? aFila(data) : null
    },
    async recibido(id) {
      const { data } = await db.from('ferreteria_links_bold').select('veces_recibido').eq('id', id).maybeSingle()
      await db.from('ferreteria_links_bold').update({ veces_recibido: Number(data?.veces_recibido ?? 0) + 1 }).eq('id', id)
    },
    async reclamar(id) {
      const { data, error } = await db
        .from('ferreteria_links_bold')
        .update({ registro: 'procesando' })
        .eq('id', id)
        .in('registro', ['creado', 'rechazado', 'error'])
        .select('id')
      if (error) throw new Error(`reclamar link de Bold: ${error.message}`)
      return (data ?? []).length === 1
    },
    async cerrar(id, cierre, ahoraIso) {
      const { error } = await db
        .from('ferreteria_links_bold')
        .update({
          registro: cierre.registro,
          motivo: cierre.motivo?.slice(0, 1000) ?? null,
          procesado_at: ahoraIso,
          ...(cierre.venta_id !== undefined ? { venta_id: cierre.venta_id } : {}),
          ...(cierre.monto_recibido !== undefined ? { monto_recibido: cierre.monto_recibido } : {}),
        })
        .eq('id', id)
      if (error) throw new Error(`cerrar link de Bold: ${error.message}`)
    },
    async conversacion(fila, hoyISO) {
      const clave = `chatwoot:${fila.chatwoot_cuenta_id}:${fila.chatwoot_conversacion_id}`
      const { data, error } = await db
        .from('ferreteria_conversaciones')
        .upsert(
          {
            workspace_id: ws,
            publicacion_id: fila.publicacion_id,
            fecha: hoyISO,
            // Solo el nombre visible (minimización: el celular y la dirección quedan en el link, server-only).
            interesado: fila.comprador_nombre.slice(0, 120),
            canal: canalConversacion(fila.canal),
            resultado: 'vendio',
            clave,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,clave' },
        )
        .select('id, publicacion_id')
        .single()
      // La conversación es contexto, no condición: sin ella la venta sale igual (sin conversación de origen).
      if (error || !data || data.publicacion_id !== fila.publicacion_id) {
        if (error) console.error('[ferreteria/bold] no se pudo guardar la conversación de origen:', error.message)
        return null
      }
      return String(data.id)
    },
  }
}

/** La campana de quienes editan Ferretería en el espacio (como los pagos de Wompi). No lanza. */
async function avisarEquipo(ws: string, texto: string, linkId: string): Promise<void> {
  const db = createServiceClient() as unknown as Db
  const { data: perfiles, error } = await db.from('profiles').select('id').eq('workspace_id', ws).in('role', ROLES_EDITORES as unknown as string[])
  if (error || !perfiles?.length) {
    console.error('[ferreteria/bold] nadie a quién avisar o no se pudo leer:', error?.message ?? ws)
    return
  }
  const ins = await db.from('notificaciones').insert(
    (perfiles as { id: string }[]).map((p) => ({
      workspace_id: ws,
      destinatario_id: p.id,
      tipo: 'ferreteria_pago',
      estado: 'pendiente',
      contenido: texto.slice(0, 500),
      entidad_tipo: null,
      entidad_id: null,
      deep_link: '/ferreteria',
      metadata: { link_bold_id: linkId },
    })),
  )
  if (ins.error) console.error('[ferreteria/bold] no se pudo crear el aviso:', ins.error.message)
}

/**
 * Le avisa al asistente (Edge Function) que el pago quedó: confirma al cliente y pasa a persona con `despachar`. A
 * mejor esfuerzo: si falla, la venta ya está y el equipo tiene la campana; el cliente lo confirma con «ya pagué».
 */
async function confirmarEnChatwoot(ws: string, referencia: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !llave) return
  try {
    const db = createServiceClient() as unknown as Db
    const { data } = await db.from('workspaces').select('slug').eq('id', ws).maybeSingle()
    if (!data?.slug) return
    const url = `${base}/functions/v1/chatwoot-agente?ws=${encodeURIComponent(data.slug)}&pago=${encodeURIComponent(referencia)}`
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${llave}` }, signal: AbortSignal.timeout(8_000) })
    if (!res.ok) console.error(`[ferreteria/bold] el asistente no confirmó el pago ${referencia}: HTTP ${res.status}`)
  } catch (e) {
    console.error(`[ferreteria/bold] el asistente no confirmó el pago ${referencia}:`, (e as Error).message)
  }
}

/**
 * El despacho del webhook de Bold del workspace: si el `LNK_…` es de un link del asistente de ventas, lo atiende aquí
 * y devuelve la respuesta; si no (o sin la tabla), `null` y el pago sigue por el camino de funciones (Sabor).
 */
export async function atenderPagoBoldFerreteria(
  ws: string,
  referencia: string,
  estado: 'aprobado' | 'fallido',
  monto: number | null,
): Promise<SalidaPagoBold | null> {
  const links = repoLinksBold(ws)
  const fila = await links.porReferencia(referencia)
  if (!fila) return null
  const ahora = new Date()
  return procesarPagoBold(fila, { estado, monto }, {
    ws,
    repo: repoSupabase(),
    links,
    negocios: () => puertoNegociosSistema(ws, 'Bold'),
    avisar: (texto, linkId) => avisarEquipo(ws, texto, linkId),
    confirmarEnChatwoot: (ref) => confirmarEnChatwoot(ws, ref),
    ahoraIso: ahora.toISOString(),
    hoyISO: todayBogotaISO(ahora),
  })
}
