import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { consultarLinkBold, llavesBoldDelWorkspace } from '../../../supabase/functions/_shared/funciones/bold-workspace.ts'
import { convertidorFerreteria } from '@/lib/ferreteria/carrito-a-venta-servidor'
import { ROLES_EDITORES } from '@/lib/ferreteria/reglas'
import {
  procesarPagoCarrito,
  type CarritoPagado,
  type ConvertidorCarrito,
  type LineaPagada,
  type PagoCarritoFila,
  type RepoPagosCarrito,
  type SalidaPagoCarrito,
} from './pago-bold'

/**
 * El lado de base y de red de los pagos del carrito de los asistentes (`pago-bold.ts`): las tablas `carritos`,
 * `carrito_lineas` y `carrito_pagos` (migración 20261104210000), la campana del equipo y el aviso al asistente en la
 * Edge Function `chatwoot-agente`. Todo con el cliente de servicio y acotado al workspace del webhook.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Quién vuelve venta cada dominio de carrito (CHECK de `carritos.dominio`). */
const CONVERTIDORES: Record<string, (ws: string) => ConvertidorCarrito> = {
  ferreteria: convertidorFerreteria,
}

const COLUMNAS_PAGO = 'id, carrito_id, referencia, monto, version, estado, motivo'
const COLUMNAS_CARRITO =
  'id, workspace_id, dominio, estado, subtotal, flete, total, zona, ruta, comprador_nombre, comprador_telefono, direccion, chatwoot_cuenta_id, chatwoot_conversacion_id, canal, negocio_id'

function aPago(f: Record<string, unknown>): PagoCarritoFila {
  return { ...(f as unknown as PagoCarritoFila), monto: Number(f.monto), version: Number(f.version) }
}

function aCarrito(f: Record<string, unknown>): CarritoPagado {
  return {
    ...(f as unknown as CarritoPagado),
    subtotal: Number(f.subtotal),
    flete: Number(f.flete ?? 0),
    total: Number(f.total ?? 0),
    chatwoot_cuenta_id: Number(f.chatwoot_cuenta_id),
    chatwoot_conversacion_id: Number(f.chatwoot_conversacion_id),
  }
}

export function repoPagosCarrito(ws: string, cliente: SupabaseClient = createServiceClient() as unknown as SupabaseClient): RepoPagosCarrito & {
  porReferencia(referencia: string): Promise<(PagoCarritoFila & { dominio: string }) | null>
} {
  const db = cliente as Db
  const lanzar = (que: string, error: { message: string } | null) => {
    if (error) throw new Error(`${que}: ${error.message}`)
  }
  return {
    async porReferencia(referencia) {
      const { data, error } = await db
        .from('carrito_pagos')
        .select(`${COLUMNAS_PAGO}, carritos!inner(dominio)`)
        .eq('workspace_id', ws)
        .eq('referencia', referencia)
        .maybeSingle()
      // Sin la tabla (migración sin aplicar) no hay carritos: el pago sigue por el camino de funciones.
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return null
        throw new Error(`leer el link del carrito: ${error.message}`)
      }
      if (!data) return null
      const c = (Array.isArray(data.carritos) ? data.carritos[0] : data.carritos) as { dominio?: string } | null
      return { ...aPago(data), dominio: String(c?.dominio ?? '') }
    },
    async recibido(id) {
      const { data } = await db.from('carrito_pagos').select('veces_recibido').eq('workspace_id', ws).eq('id', id).maybeSingle()
      await db.from('carrito_pagos').update({ veces_recibido: Number(data?.veces_recibido ?? 0) + 1 }).eq('workspace_id', ws).eq('id', id)
    },
    async reclamar(id, ahoraIso, vencidoAntesDe) {
      // Un solo UPDATE condicional: o está libre, o es un `procesando` viejo (un corte). Dos a la vez: gana uno.
      const { data, error } = await db
        .from('carrito_pagos')
        .update({ estado: 'procesando', reclamado_at: ahoraIso })
        .eq('workspace_id', ws)
        .eq('id', id)
        .or(`estado.in.(creado,rechazado,vencido,error),and(estado.eq.procesando,reclamado_at.lt.${vencidoAntesDe})`)
        .select('id')
      lanzar('reclamar el link del carrito', error)
      return (data ?? []).length === 1
    },
    async leerPago(id) {
      const { data, error } = await db.from('carrito_pagos').select(COLUMNAS_PAGO).eq('workspace_id', ws).eq('id', id).maybeSingle()
      lanzar('leer el link del carrito', error)
      return data ? aPago(data) : null
    },
    async carrito(id) {
      const { data, error } = await db.from('carritos').select(COLUMNAS_CARRITO).eq('workspace_id', ws).eq('id', id).maybeSingle()
      lanzar('leer el carrito', error)
      return data ? aCarrito(data) : null
    },
    async lineas(carritoId) {
      const { data, error } = await db
        .from('carrito_lineas')
        .select('id, orden, item_tipo, item_id, codigo, descripcion, cantidad, precio_unitario, venta_id')
        .eq('workspace_id', ws)
        .eq('carrito_id', carritoId)
        .order('orden')
      lanzar('leer los productos del carrito', error)
      return ((data ?? []) as Record<string, unknown>[]).map((l) => ({
        ...(l as unknown as LineaPagada),
        orden: Number(l.orden),
        cantidad: Number(l.cantidad),
        precio_unitario: Number(l.precio_unitario),
        venta_id: (l.venta_id as string | null) ?? null,
      }))
    },
    async anotarVenta(lineaId, ventaId) {
      const { error } = await db.from('carrito_lineas').update({ venta_id: ventaId }).eq('workspace_id', ws).eq('id', lineaId)
      lanzar('anotar la venta en el producto del carrito', error)
    },
    async anotarNegocio(carritoId, negocioId) {
      const { error } = await db.from('carritos').update({ negocio_id: negocioId, updated_at: new Date().toISOString() }).eq('workspace_id', ws).eq('id', carritoId)
      lanzar('anotar el negocio en el carrito', error)
    },
    async cerrar(id, cierre, ahoraIso) {
      const { error } = await db
        .from('carrito_pagos')
        .update({
          estado: cierre.estado,
          motivo: cierre.motivo?.slice(0, 1000) ?? null,
          procesado_at: ahoraIso,
          ...(cierre.monto_recibido !== undefined ? { monto_recibido: cierre.monto_recibido } : {}),
        })
        .eq('workspace_id', ws)
        .eq('id', id)
      lanzar('cerrar el link del carrito', error)
    },
    async marcarCarrito(carritoId, estado, ahoraIso) {
      const { data: actual, error: e1 } = await db.from('carritos').select('congelado_at').eq('workspace_id', ws).eq('id', carritoId).maybeSingle()
      lanzar('leer el carrito', e1)
      const { error } = await db
        .from('carritos')
        .update({
          estado,
          congelado_at: actual?.congelado_at ?? ahoraIso,
          ...(estado === 'pagado' ? { pagado_at: ahoraIso } : { registrado_at: ahoraIso, cerrado_at: ahoraIso }),
          updated_at: ahoraIso,
        })
        .eq('workspace_id', ws)
        .eq('id', carritoId)
      lanzar(`marcar el carrito ${estado}`, error)
    },
    async marcarRechazado(id, ahoraIso) {
      const { error } = await db
        .from('carrito_pagos')
        .update({ estado: 'rechazado', motivo: 'Bold avisó un pago rechazado.', procesado_at: ahoraIso })
        .eq('workspace_id', ws)
        .eq('id', id)
        .in('estado', ['creado', 'error'])
      lanzar('marcar el rechazo del link del carrito', error)
    },
  }
}

/** La campana de quienes editan el módulo en el espacio. No lanza. */
async function avisarEquipo(ws: string, texto: string, pagoId: string): Promise<void> {
  const db = createServiceClient() as unknown as Db
  const { data: perfiles, error } = await db.from('profiles').select('id').eq('workspace_id', ws).in('role', ROLES_EDITORES as unknown as string[])
  if (error || !perfiles?.length) {
    console.error('[carritos/bold] nadie a quién avisar o no se pudo leer:', error?.message ?? ws)
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
      metadata: { carrito_pago_id: pagoId },
    })),
  )
  if (ins.error) console.error('[carritos/bold] no se pudo crear el aviso:', ins.error.message)
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
    if (!res.ok) console.error(`[carritos/bold] el asistente no confirmó el pago ${referencia}: HTTP ${res.status}`)
  } catch (e) {
    console.error(`[carritos/bold] el asistente no confirmó el pago ${referencia}:`, (e as Error).message)
  }
}

/**
 * El despacho del webhook de Bold del workspace: si el `LNK_…` es de un link del carrito de un asistente, lo atiende
 * aquí y devuelve la respuesta; si no (o sin la tabla), `null` y el pago sigue por el camino de funciones (Sabor).
 */
export async function atenderPagoBoldCarrito(
  ws: string,
  referencia: string,
  estado: 'aprobado' | 'fallido',
  monto: number | null,
  moneda: string | null = null,
): Promise<SalidaPagoCarrito | null> {
  const repo = repoPagosCarrito(ws)
  let pago: (PagoCarritoFila & { dominio: string }) | null
  try {
    pago = await repo.porReferencia(referencia)
  } catch (e) {
    // No se pudo saber si es de un carrito: el pago sigue por funciones (un link de Sabor no se queda sin registrar).
    console.error(`[carritos/bold] no se pudo leer el link ${referencia}:`, (e as Error).message)
    return null
  }
  if (!pago) return null
  const convertidor = CONVERTIDORES[pago.dominio]
  if (!convertidor) {
    console.error(`[carritos/bold] el carrito del link ${referencia} es del dominio «${pago.dominio}», sin convertidor`)
    return { status: 500, body: { ok: false, motivo: 'dominio_sin_convertidor' } }
  }
  const ahora = new Date()
  const db = createServiceClient() as unknown as Db
  return procesarPagoCarrito(pago, { estado, monto, moneda }, {
    repo,
    convertidor: convertidor(ws),
    consultarLink: async (ref) => {
      const llaves = await llavesBoldDelWorkspace(db, ws).catch(() => ({ identidad: null }))
      if (!llaves.identidad) return null
      const r = await consultarLinkBold(llaves.identidad, ref)
      return r ? { estado: r.estado, total: r.total } : null
    },
    avisar: (texto, pagoId) => avisarEquipo(ws, texto, pagoId),
    confirmarEnChatwoot: (ref) => confirmarEnChatwoot(ws, ref),
    ahoraIso: ahora.toISOString(),
    hoyISO: todayBogotaISO(ahora),
  }).catch((e): SalidaPagoCarrito => {
    // Es un link de carrito y la base falló antes de tomarlo: 500 para que Bold reintente (nunca a funciones).
    console.error(`[carritos/bold] pago ${referencia} sin procesar:`, (e as Error).message)
    return { status: 500, body: { ok: false, motivo: 'error_interno' } }
  })
}
