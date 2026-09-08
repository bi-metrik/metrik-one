'use server'

/**
 * Control de recibos de caja: qué plata que entró tiene su recibo y cuál no.
 *
 * ── Por qué vive aparte de facturación ──────────────────────────────────────
 *
 * Decisión de Mauricio (2026-09-07). Hasta hoy el recibo se emitía desde la cola de
 * facturación, y eso obligaba a que un pago apareciera donde se decide facturar. Son
 * dos controles distintos: la factura se emite por el honorario pactado, el recibo
 * acusa la plata que entregó el cliente, y ninguno depende del otro. Un caso ya
 * facturado seguía necesitando el recibo de sus pagos, así que quien buscaba pagos sin
 * acusar tenía que entrar por la pestaña "Ya facturados", que es exactamente el sitio
 * donde nadie los busca.
 *
 * Este control responde una sola pregunta: **de la plata que entró, cuál está acusada.**
 *
 * ── Los tres estados de un pago ─────────────────────────────────────────────
 *
 *  - `con_recibo`  — tiene `siigo_recibo`. Trae número y enlace al PDF.
 *  - `no_aplica`   — marcado con `recibo_no_aplica`. Es el corte histórico del
 *                    2026-09-07: los pagos de negocios ya facturados no llevan recibo
 *                    retroactivo. Se muestran, no se esconden: un pendiente que
 *                    desaparece sin dejar rastro es un pendiente que nadie audita.
 *  - `pendiente`   — el resto. Es la única lista sobre la que hay que actuar.
 *
 * Un cobro anulado no aparece: no documenta plata recibida.
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { canEditBloque, type Area, type Role, type UserContext } from '@/lib/permissions/can-edit'
import { traerTodo } from '@/lib/supabase/paginar'

export type EstadoRecibo = 'con_recibo' | 'no_aplica' | 'pendiente'

export interface PagoConRecibo {
  cobro_id: string
  negocio_id: string
  negocio_codigo: string | null
  cliente: string | null
  correo: string | null
  monto: number
  fecha: string | null
  concepto: string | null
  estado: EstadoRecibo
  /** Número del recibo en Siigo. Solo en `con_recibo`. */
  recibo_numero: string | null
  /** Enlace al PDF archivado en Drive. Solo en `con_recibo`, y puede faltar. */
  recibo_url: string | null
  /** Por qué no lleva recibo. Solo en `no_aplica`. */
  no_aplica_motivo: string | null
  /** El negocio ya tiene factura. Se muestra como contexto, NO decide el estado. */
  facturado: boolean
  /** Le falta algo para poder emitir: sin esto, el botón miente. */
  faltantes: string[]
}

/**
 * ⚠️ El concepto del pago vive en `cobros.notas`. No hay columna `concepto`.
 *
 * Pedirla hacía fallar la consulta entera, y como la pestaña solo se dibujaba cuando el
 * control venía lleno, el control desaparecía sin decir nada (2026-09-07). Los dobles de
 * las pruebas no validan nombres de columna, así que esto solo lo ve producción o
 * alguien mirando el esquema.
 */
export interface ControlRecibos {
  pagos: PagoConRecibo[]
  totales: {
    pendientes: number
    con_recibo: number
    no_aplica: number
    valor_pendiente: number
    /** Pendientes a los que NO les falta ningún dato para emitir. */
    emitibles: number
  }
}

/** Mismo criterio de área que facturación: el recaudo es del área financiera. */
async function ctxFinanciero(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: string }
> {
  const { workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  if (!canEditBloque(user, { stage: 'cobro' }, [])) {
    return { ok: false, error: 'Solo el área financiera puede ver el control de recibos' }
  }
  return { ok: true, workspaceId }
}

export async function getControlRecibos(): Promise<{ data: ControlRecibos | null; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { data: null, error: ctx.error }
  try {
    return { data: await armarControl(ctx.workspaceId) }
  } catch (e) {
    // Igual que la cola de facturación: una lista recortada tiene el mismo aspecto que
    // una lista entera, y aquí decide si se emite un documento contable. Se prefiere
    // una pantalla que dice que falló.
    return { data: null, error: (e as Error).message }
  }
}

async function armarControl(workspaceId: string): Promise<ControlRecibos> {
  const svc = createServiceClient()

  type FilaCobro = {
    id: string
    negocio_id: string | null
    monto: number | null
    fecha: string | null
    notas: string | null
    siigo_recibo: { numero?: string; archivo_url?: string | null } | null
    recibo_no_aplica: { motivo?: string } | null
  }

  const cobros = await traerTodo<FilaCobro>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('cobros')
      .select('id, negocio_id, monto, fecha, notas, siigo_recibo, recibo_no_aplica')
      .eq('workspace_id', workspaceId)
      .is('anulado_at', null)
      .not('fecha', 'is', null)
      .order('id')
      .range(d, h),
    { etiqueta: 'recibos/cobros' },
  )

  const negocioIds = [...new Set(cobros.map(c => c.negocio_id).filter((v): v is string => !!v))]
  if (negocioIds.length === 0) {
    return { pagos: [], totales: { pendientes: 0, con_recibo: 0, no_aplica: 0, valor_pendiente: 0, emitibles: 0 } }
  }

  type FilaNegocio = {
    id: string
    codigo: string | null
    nombre: string | null
    contacto_id: string | null
    carpeta_url: string | null
    metadata: Record<string, unknown> | null
  }

  const negocios = await traerTodo<FilaNegocio>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('negocios')
      .select('id, codigo, nombre, contacto_id, carpeta_url, metadata')
      .in('id', negocioIds)
      .order('id')
      .range(d, h),
    { etiqueta: 'recibos/negocios' },
  )
  const porId = new Map(negocios.map(n => [n.id, n]))

  const contactoIds = [...new Set(negocios.map(n => n.contacto_id).filter((v): v is string => !!v))]
  const contactos = contactoIds.length === 0 ? [] : await traerTodo<{ id: string; nombre: string | null; email: string | null }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('contactos').select('id, nombre, email').in('id', contactoIds).order('id').range(d, h),
    { etiqueta: 'recibos/contactos' },
  )
  const contactoPorId = new Map(contactos.map(c => [c.id, c]))

  const pagos: PagoConRecibo[] = cobros.map(c => {
    const neg = c.negocio_id ? porId.get(c.negocio_id) : undefined
    const meta = (neg?.metadata ?? {}) as Record<string, Record<string, unknown> | undefined>
    const contacto = neg?.contacto_id ? contactoPorId.get(neg.contacto_id) : undefined

    const estado: EstadoRecibo = c.siigo_recibo?.numero
      ? 'con_recibo'
      : c.recibo_no_aplica
        ? 'no_aplica'
        : 'pendiente'

    // Lo que impediría emitir. Se calcula siempre para que la lista diga por qué un
    // pendiente no se puede resolver hoy, en vez de dejar que falle al oprimir.
    const faltantes: string[] = []
    if (estado === 'pendiente') {
      if (!meta.siigo_cliente?.siigo_id) faltantes.push('tercero en Siigo')
      if (!neg?.carpeta_url) faltantes.push('carpeta del negocio')
      if (!contacto?.email) faltantes.push('correo del cliente')
    }

    return {
      cobro_id: c.id,
      negocio_id: c.negocio_id ?? '',
      negocio_codigo: neg?.codigo ?? null,
      cliente: contacto?.nombre ?? neg?.nombre ?? null,
      correo: contacto?.email ?? null,
      monto: Number(c.monto ?? 0),
      fecha: c.fecha,
      concepto: c.notas,
      estado,
      recibo_numero: c.siigo_recibo?.numero ?? null,
      recibo_url: c.siigo_recibo?.archivo_url ?? null,
      no_aplica_motivo: (c.recibo_no_aplica?.motivo as string | undefined) ?? null,
      facturado: !!meta.siigo_factura?.numero,
      faltantes,
    }
  })

  // Lo más reciente primero: es donde está el trabajo que todavía se puede resolver.
  pagos.sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))

  const pendientes = pagos.filter(p => p.estado === 'pendiente')
  return {
    pagos,
    totales: {
      pendientes: pendientes.length,
      con_recibo: pagos.filter(p => p.estado === 'con_recibo').length,
      no_aplica: pagos.filter(p => p.estado === 'no_aplica').length,
      valor_pendiente: pendientes.reduce((s, p) => s + p.monto, 0),
      emitibles: pendientes.filter(p => p.faltantes.length === 0).length,
    },
  }
}
