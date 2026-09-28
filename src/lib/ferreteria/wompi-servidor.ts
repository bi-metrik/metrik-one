import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { puertoNegociosSistema } from './negocios-puerto'
import { ROLES_EDITORES } from './reglas'
import { repoSupabase } from './repo-supabase'
import { verificarEventoWompi } from './wompi'
import {
  procesarEventoWompi,
  RECLAMABLES_WEBHOOK,
  type AvisoPago,
  type FilaPagoWompi,
  type LinkWompi,
  type RepoPagosWompi,
} from './wompi-pagos'

/**
 * El lado de red y de base del webhook de Wompi de Dimpro, y `atenderWebhookWompi`: todo lo que la
 * ruta `/api/ferreteria/wompi/eventos` tiene que hacer (leer el cuerpo crudo, llamar, responder).
 *
 * Todo con el cliente de SERVICIO (el webhook no tiene sesión) y acotado al espacio de Dimpro: el
 * secreto de eventos es el del comercio de Dimpro, así que un evento bien firmado es de Dimpro.
 */

/** El espacio del comercio de Wompi de Dimpro (el mismo de la migración del módulo). */
export const WORKSPACE_DIMPRO = '67f7af44-b5ac-4d5c-aa9e-44954368447c'

/** Variables de entorno. Se nombran aquí para que buscarlas encuentre un solo lugar. */
export const ENV_WOMPI_DIMPRO = {
  /** Secreto de eventos del comercio de Dimpro (`prod_events_...`). Obligatorio. */
  secretoEventos: 'WOMPI_DIMPRO_EVENTS_SECRET',
  /** Llave privada (`prv_prod_...`). Opcional: solo completa datos del comprador que el evento no trae. */
  llavePrivada: 'WOMPI_DIMPRO_PRIVATE_KEY',
} as const

const API = { prod: 'https://production.wompi.co/v1', test: 'https://sandbox.wompi.co/v1' } as const
const TIEMPO_MAXIMO_MS = 10_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const COLUMNAS =
  'id, workspace_id, transaccion_id, estado_wompi, entorno, payment_link_id, sku, publicacion_id, referencia, metodo_pago, monto, moneda, pagado_at, comprador_nombre, comprador_email, comprador_telefono, comprador_documento, envio, registro, motivo, venta_id, veces_recibido, recibido_at, procesado_at'

function aFila(f: Record<string, unknown>): FilaPagoWompi {
  return { ...(f as unknown as FilaPagoWompi), monto: f.monto == null ? null : Number(f.monto) }
}

export function repoPagosWompi(cliente: SupabaseClient = createServiceClient() as unknown as SupabaseClient): RepoPagosWompi {
  const db = cliente as Db
  return {
    async guardarEvento(nueva) {
      const ins = await db.from('ferreteria_pagos_wompi').insert(nueva).select(COLUMNAS).single()
      if (!ins.error) return { nuevo: true, fila: aFila(ins.data) }
      if (ins.error.code !== '23505') throw new Error(`guardar evento de Wompi: ${ins.error.message}`)
      const previo = await db
        .from('ferreteria_pagos_wompi')
        .select(COLUMNAS)
        .eq('transaccion_id', nueva.transaccion_id)
        .eq('estado_wompi', nueva.estado_wompi)
        .single()
      if (previo.error) throw new Error(`leer evento de Wompi: ${previo.error.message}`)
      const fila = aFila(previo.data)
      await db
        .from('ferreteria_pagos_wompi')
        .update({ veces_recibido: fila.veces_recibido + 1 })
        .eq('id', fila.id)
      return { nuevo: false, fila }
    },

    async reclamar(id, desde = RECLAMABLES_WEBHOOK) {
      const { data, error } = await db
        .from('ferreteria_pagos_wompi')
        .update({ registro: 'procesando' })
        .eq('id', id)
        .in('registro', [...desde])
        .select('id')
      if (error) throw new Error(`reclamar pago de Wompi: ${error.message}`)
      return (data ?? []).length === 1
    },

    async cerrar(id, cierre, ahoraIso) {
      const { error } = await db
        .from('ferreteria_pagos_wompi')
        .update({
          registro: cierre.registro,
          motivo: cierre.motivo?.slice(0, 1000) ?? null,
          procesado_at: ahoraIso,
          ...(cierre.venta_id !== undefined ? { venta_id: cierre.venta_id } : {}),
          ...(cierre.sku !== undefined ? { sku: cierre.sku } : {}),
          ...(cierre.publicacion_id !== undefined ? { publicacion_id: cierre.publicacion_id } : {}),
          ...(cierre.envio !== undefined ? { envio: cierre.envio } : {}),
          ...(cierre.pagado_at !== undefined ? { pagado_at: cierre.pagado_at } : {}),
          ...(cierre.comprador ?? {}),
        })
        .eq('id', id)
      if (error) throw new Error(`cerrar pago de Wompi: ${error.message}`)
    },

    async anotarDatos(id, datos) {
      const { error } = await db
        .from('ferreteria_pagos_wompi')
        .update({
          ...(datos.sku !== undefined ? { sku: datos.sku } : {}),
          ...(datos.publicacion_id !== undefined ? { publicacion_id: datos.publicacion_id } : {}),
          ...(datos.envio !== undefined ? { envio: datos.envio } : {}),
          ...(datos.pagado_at !== undefined ? { pagado_at: datos.pagado_at } : {}),
          ...(datos.comprador ?? {}),
        })
        .eq('id', id)
      if (error) throw new Error(`anotar pago de Wompi: ${error.message}`)
    },

    async pagoPorId(ws, id) {
      const { data, error } = await db.from('ferreteria_pagos_wompi').select(COLUMNAS).eq('workspace_id', ws).eq('id', id).maybeSingle()
      if (error) throw new Error(`leer pago de Wompi: ${error.message}`)
      return data ? aFila(data) : null
    },
  }
}

/** Pagos de Wompi para la pestaña Ferretería: los últimos, y todos los que esperan a alguien. */
export async function leerPagosWompi(ws: string, limite = 60): Promise<FilaPagoWompi[]> {
  const db = createServiceClient() as unknown as Db
  const [recientes, abiertos] = await Promise.all([
    db.from('ferreteria_pagos_wompi').select(COLUMNAS).eq('workspace_id', ws).order('recibido_at', { ascending: false }).limit(limite),
    db
      .from('ferreteria_pagos_wompi')
      .select(COLUMNAS)
      .eq('workspace_id', ws)
      .in('registro', ['pendiente_asignar', 'error', 'recibido', 'procesando'])
      .order('recibido_at', { ascending: false })
      .limit(200),
  ])
  // Sin la tabla (migración sin aplicar) la pestaña sigue: se ve vacío y se dice en el log.
  if (recientes.error || abiertos.error) {
    console.error('[ferreteria/wompi] no se pudieron leer los pagos:', recientes.error?.message ?? abiertos.error?.message)
    return []
  }
  const porId = new Map<string, FilaPagoWompi>()
  for (const f of [...(abiertos.data ?? []), ...(recientes.data ?? [])]) porId.set(f.id, aFila(f))
  return [...porId.values()].sort((a, b) => b.recibido_at.localeCompare(a.recibido_at))
}

/** `GET /v1/payment_links/<id>`: la documentación de Wompi lo da sin autenticación. */
async function leerLink(linkId: string, entorno: 'prod' | 'test'): Promise<LinkWompi> {
  const res = await fetch(`${API[entorno]}/payment_links/${encodeURIComponent(linkId)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  })
  if (res.status === 404) return { existe: false, sku: null }
  if (!res.ok) throw new Error(`Wompi respondió ${res.status}`)
  const cuerpo = (await res.json()) as { data?: { sku?: unknown } }
  const sku = typeof cuerpo.data?.sku === 'string' ? cuerpo.data.sku : null
  return { existe: true, sku }
}

/** `GET /v1/transactions/<id>` con la llave privada. Sin llave, o si falla, null. */
function consultorTransacciones(llave: string | undefined) {
  if (!llave?.trim()) return undefined
  return async (id: string, entorno: 'prod' | 'test'): Promise<unknown | null> => {
    try {
      const res = await fetch(`${API[entorno]}/transactions/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${llave.trim()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      })
      if (!res.ok) return null
      return ((await res.json()) as { data?: unknown }).data ?? null
    } catch {
      return null
    }
  }
}

/**
 * La campana de ONE de quienes editan Ferretería en el espacio (hoy, Dietmar como dueño). Un aviso
 * que no se puede escribir no tumba el registro: se deja en el log, y el pago se ve en la pestaña.
 */
async function avisarEquipo(ws: string, aviso: AvisoPago): Promise<void> {
  const db = createServiceClient() as unknown as Db
  const { data: perfiles, error } = await db
    .from('profiles')
    .select('id')
    .eq('workspace_id', ws)
    .in('role', ROLES_EDITORES as unknown as string[])
  if (error) {
    console.error('[ferreteria/wompi] no se pudo leer a quién avisar:', error.message)
    return
  }
  const filas = ((perfiles ?? []) as { id: string }[]).map((p) => ({
    workspace_id: ws,
    destinatario_id: p.id,
    tipo: 'ferreteria_pago',
    estado: 'pendiente',
    contenido: aviso.texto.slice(0, 500),
    entidad_tipo: null,
    entidad_id: null,
    deep_link: '/ferreteria?pestana=pagos',
    metadata: { pago_wompi_id: aviso.pagoId, aviso: aviso.tipo },
  }))
  if (filas.length === 0) {
    console.error('[ferreteria/wompi] nadie a quién avisar en el espacio', ws)
    return
  }
  const ins = await db.from('notificaciones').insert(filas)
  if (ins.error) console.error('[ferreteria/wompi] no se pudo crear el aviso:', ins.error.message)
}

/**
 * Lo que responde la ruta. Firma mala: 401, sin reintento que valga. Sin secreto configurado: 503
 * (Wompi reintenta, por si se carga dentro de las 24 horas). Una vez verificada la firma, 200 salvo
 * lo que un reintento puede arreglar (base caída, Wompi sin responder al leer el link).
 */
export async function atenderWebhookWompi(
  cuerpoCrudo: string,
  checksumCabecera: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const secreto = process.env[ENV_WOMPI_DIMPRO.secretoEventos]?.trim()
  if (!secreto) {
    console.error(`[ferreteria/wompi] falta ${ENV_WOMPI_DIMPRO.secretoEventos}`)
    return { status: 503, body: { error: 'webhook_no_configurado' } }
  }
  const v = verificarEventoWompi(cuerpoCrudo, secreto, checksumCabecera)
  if (!v.ok) {
    console.warn(`[ferreteria/wompi] evento rechazado: ${v.motivo}`)
    return { status: v.motivo === 'cuerpo_invalido' ? 400 : 401, body: { error: v.motivo } }
  }

  try {
    const repo = repoSupabase()
    const ahora = new Date()
    const salida = await procesarEventoWompi(v.evento, {
      ws: WORKSPACE_DIMPRO,
      repo,
      pagos: repoPagosWompi(),
      moduloActivo: () => repo.moduloActivo(WORKSPACE_DIMPRO),
      leerLink,
      consultarTransaccion: consultorTransacciones(process.env[ENV_WOMPI_DIMPRO.llavePrivada]),
      negocios: () => puertoNegociosSistema(WORKSPACE_DIMPRO),
      avisar: (a) => avisarEquipo(WORKSPACE_DIMPRO, a),
      ahoraIso: ahora.toISOString(),
      hoyISO: todayBogotaISO(ahora),
    })
    if (salida.resultado === 'error' || salida.resultado === 'pendiente_asignar') {
      console.warn(`[ferreteria/wompi] ${salida.resultado}: ${salida.detalle ?? ''}`)
    }
    return { status: salida.http, body: { ok: salida.http === 200, resultado: salida.resultado } }
  } catch (e) {
    console.error('[ferreteria/wompi]', (e as Error).message)
    return { status: 500, body: { error: 'error_interno' } }
  }
}
