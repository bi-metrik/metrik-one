'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { canEditBloque, type UserContext, type Role, type Area } from '@/lib/permissions/can-edit'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { randomUUID } from 'crypto'
import { consultarTransaccionEpayco } from '@/lib/epayco'
import { ctxFabPago } from '@/lib/actions/fab-pago-actions'
import {
  repartirPagoTarifaHonorario,
  tipoCobroHonorario,
  type ModeloDinero,
} from '@/lib/upme/modelo-dinero'

// Cast a untyped para tablas/columnas nuevas no en database.ts
// (negocio_conciliacion, cobros.split_json).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

// ── Permiso: solo área financiera (Diana) concilia ──────────────────────────────
//
// La conciliación es del stage 'cobro' → área 'financiera'. Reusamos la función
// central canEditBloque({ stage: 'cobro' }): owner/admin sin área pasan; con área,
// solo quien tenga 'financiera' (o 'direccion', que la expande). operator exige ser
// responsable — pero la conciliación es cross-negocio, así que un operator NO
// concilia (no es responsable de "todos" los negocios). read_only/contador: nunca.
async function ctxFinanciero(): Promise<
  | { ok: true; supabase: unknown; workspaceId: string; staffId: string | null; user: UserContext }
  | { ok: false; error: string }
> {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  // canEditBloque del stage 'cobro' con responsables vacío: owner/admin/supervisor
  // con área financiera (o sin área) pasan; operator queda fuera (no es responsable
  // del set cross-negocio); read_only/contador fuera.
  if (!canEditBloque(user, { stage: 'cobro' }, [])) {
    return { ok: false, error: 'Solo el área financiera puede conciliar pagos' }
  }
  return { ok: true, supabase, workspaceId, staffId, user }
}

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Un negocio elegible para recibir una porción de un pago repartido. */
export interface NegocioParaSplit {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
  precio: number
  cobrado: number
  diferencia: number
}

// ── repartirPagoCore + repartirPagoComercial (reparto del comercial) ─────────

export interface PorcionSplit {
  negocio_id: string
  monto: number
}

export interface RepartirPagoInput {
  /** Referencia del pago (ePayco ref_payco o referencia externa). Va a external_ref. */
  referencia: string
  /** Monto bruto total del pago recibido (suma de las porciones debe coincidir). */
  monto_total: number
  /** Porciones por negocio. La suma NO puede exceder monto_total. */
  porciones: PorcionSplit[]
  /** 'pago' | 'externo' | 'anticipo' | 'saldo'. Default 'pago'. */
  tipo_cobro?: string
  fecha?: string
}

/**
 * NÚCLEO del reparto de UN pago entre VARIOS negocios sin duplicar el monto — la
 * fuente ÚNICA de la escritura del split. La usan tanto `repartirPago` (financiera,
 * `origen='financiera'`) como `repartirPagoComercial` (comercial, `origen='comercial'`).
 * NO duplicar esta lógica en otra vía. El guard de permisos lo aplica el CALLER.
 *
 * Crea un cobro por cada porción, todos con el MISMO `external_ref` (la referencia
 * del pago) pero marcados como split deliberado en `cobros.split_json` con un
 * `split_id` compartido. Así:
 *   - El monto NO se duplica: cada negocio recibe solo su porción.
 *   - `refDuplicadaNoSplit` reconoce el split_id y NO marca estos cobros como
 *     duplicado accidental de la referencia.
 *
 * Cuando `origen='comercial'` marca además `split_json.origen='comercial'` +
 * `propuesto_por=staffId` (trazabilidad: la financiera lo VALIDA y concilia; no se
 * auto-concilia el reparto del comercial). `conciliado` NO se toca acá (control de
 * dos personas).
 *
 * REGLAS DURAS del reparto del comercial (aplicadas SIEMPRE que se pase
 * `validarNegociosAbiertos`):
 *   - Todos los negocios destino existen, son del workspace y `estado='abierto'`.
 *   - No se reparte hacia negocios inexistentes ni cerrados.
 *   - Bloqueo de duplicado: si la referencia ya existe como cobro NO-split en otro
 *     negocio, se rechaza. Si ya tiene porciones split, se pide ajustar vía eliminar
 *     + re-repartir (MVP: el reparto se declara una vez, atómico).
 *
 * Parcial permitido: la suma de porciones ≤ monto_total (tolerancia 1 peso) — deja
 * saldo sin asignar. Idempotencia: por (external_ref, negocio_id).
 */
async function repartirPagoCore(
  supabase: unknown,
  workspaceId: string,
  staffId: string | null,
  input: RepartirPagoInput,
  origen: 'financiera' | 'comercial',
  opts?: { validarNegociosAbiertos?: boolean; bloquearReferenciaExistente?: boolean },
): Promise<{ success: true; split_id: string } | { success: false; error: string }> {
  const referencia = (input.referencia ?? '').trim()
  if (!referencia) return { success: false, error: 'La referencia del pago es obligatoria' }

  const montoTotal = Number(input.monto_total)
  if (!Number.isFinite(montoTotal) || montoTotal <= 0) {
    return { success: false, error: 'El monto total del pago debe ser mayor a cero' }
  }

  const porciones = (input.porciones ?? []).filter((p) => p && p.negocio_id && Number(p.monto) > 0)
  if (porciones.length < 1) return { success: false, error: 'Agrega al menos una porción con monto' }

  // Validar negocios distintos
  const negocioIds = porciones.map((p) => p.negocio_id)
  if (new Set(negocioIds).size !== negocioIds.length) {
    return { success: false, error: 'No repitas el mismo negocio en el reparto' }
  }

  const sumaPorciones = porciones.reduce((s, p) => s + Number(p.monto), 0)
  // Parcial permitido: la suma NO puede EXCEDER el total (tolerancia de 1 peso).
  if (sumaPorciones - montoTotal > 1) {
    return { success: false, error: 'La suma de las porciones excede el monto del pago' }
  }

  // Validar que todos los negocios son del workspace. Regla dura del comercial:
  // además, todos deben estar 'abierto' (no se reparte hacia inexistentes/cerrados).
  const { data: negociosRaw } = await db(supabase)
    .from('negocios')
    .select('id, estado, codigo')
    .eq('workspace_id', workspaceId)
    .in('id', negocioIds)
  const negociosPorId = new Map(
    ((negociosRaw ?? []) as Array<{ id: string; estado: string | null; codigo: string | null }>).map((n) => [n.id, n]),
  )
  for (const id of negocioIds) {
    const neg = negociosPorId.get(id)
    if (!neg) return { success: false, error: 'Un negocio del reparto no pertenece al workspace' }
    if (opts?.validarNegociosAbiertos && neg.estado !== 'abierto') {
      return { success: false, error: `El negocio ${neg.codigo ?? id} no está abierto — no se puede repartir un pago hacia él.` }
    }
  }

  // Bloqueo de duplicado (reparto del comercial): la referencia no puede existir ya
  // como cobro NO-split en otro negocio (sería duplicar un pago). Si ya está como
  // split, se pide ajustar vía eliminar + re-repartir (el reparto es atómico, MVP).
  if (opts?.bloquearReferenciaExistente) {
    const dup = await refDuplicadaNoSplit(supabase, workspaceId, referencia)
    if (dup && !negocioIds.includes(dup.negocio_id)) {
      return {
        success: false,
        error: `La referencia ${referencia} ya está registrada como pago en ${dup.codigo ?? dup.negocio_id}. No se puede repartir una referencia que ya existe suelta — elimínala primero o pide al área financiera que la distribuya.`,
      }
    }
    const { data: yaSplit } = await db(supabase)
      .from('cobros')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('external_ref', referencia)
      .not('split_json->>split_id', 'is', null)
      .limit(1)
    if (yaSplit && (yaSplit as unknown[]).length > 0) {
      return {
        success: false,
        error: `La referencia ${referencia} ya tiene un reparto. Para cambiarlo, elimina las porciones existentes y vuelve a repartir.`,
      }
    }
  }

  const splitId = randomUUID()
  const tipoCobro = input.tipo_cobro ?? 'pago'
  const fecha = (input.fecha ?? '').trim() || todayBogotaISO()
  const splitBase: Record<string, unknown> = {
    split_id: splitId,
    split_total: montoTotal,
    split_n: porciones.length,
  }
  if (origen === 'comercial') {
    splitBase.origen = 'comercial'
    splitBase.propuesto_por = staffId
  }
  const nota =
    origen === 'comercial'
      ? `Reparto de pago propuesto por el comercial — Ref ${referencia} entre ${porciones.length} negocios`
      : `Reparto de pago ${referencia} entre ${porciones.length} negocios`

  for (const p of porciones) {
    // Idempotencia: ¿ya hay un cobro con esta referencia en este negocio?
    const { data: existing } = await db(supabase)
      .from('cobros')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', p.negocio_id)
      .eq('external_ref', referencia)
      .limit(1)
    if (existing && (existing as unknown[]).length > 0) continue

    const { error: insErr } = await db(supabase).from('cobros').insert({
      workspace_id: workspaceId,
      negocio_id: p.negocio_id,
      monto: Number(p.monto),
      tipo_cobro: tipoCobro,
      fecha,
      external_ref: referencia,
      notas: nota,
      split_json: { ...splitBase },
    })
    if (insErr) {
      return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar una porción' }
    }
  }

  // Cualquier negocio tocado deja de estar conciliado (cambió su cobrado). El check
  // de conciliación lo pone SIEMPRE la financiera (control de dos personas) — el
  // reparto del comercial es solo una PROPUESTA hasta que ella lo valide.
  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .in('negocio_id', negocioIds)

  // Trazabilidad del reparto propuesto por el comercial en cada negocio destino.
  if (origen === 'comercial' && staffId) {
    for (const id of negocioIds) {
      try {
        await db(supabase).from('activity_log').insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: id,
          tipo: 'comentario',
          autor_id: staffId,
          contenido: `Reparto de pago propuesto por el comercial — Ref ${referencia}. Pendiente de confirmar por el área financiera.`,
        })
      } catch { /* no bloquear por el log */ }
    }
  }

  for (const id of negocioIds) revalidatePath(`/negocios/${id}`)
  revalidatePath('/conciliacion')
  return { success: true, split_id: splitId }
}

/**
 * Reparte UN pago entre VARIOS negocios (vía del COMERCIAL). El comercial PROPONE el
 * reparto; la financiera lo VALIDA y concilia (control de dos personas). Wrapper de
 * `repartirPagoCore` con guard COMERCIAL (`ctxFabPago`) + `origen='comercial'` +
 * reglas duras (negocios abiertos, sin duplicar la referencia).
 *
 * ePayco: valida que la referencia esté 'Aceptada' y que el total ≤ monto_bruto real
 * (techo de plata) vía `consultarTransaccionEpayco`. Manual: el comercial declara el
 * total (sin re-consulta externa).
 */
export async function repartirPagoComercial(
  input: RepartirPagoInput & { fuente?: 'epayco' | 'manual' },
): Promise<{ success: true; split_id: string } | { success: false; error: string }> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const referencia = (input.referencia ?? '').trim()
  if (!referencia) return { success: false, error: 'La referencia del pago es obligatoria' }

  let montoTotal = Number(input.monto_total)
  const esEpayco = (input.fuente ?? 'manual') === 'epayco'

  if (esEpayco) {
    const refNum = parseInt(referencia, 10)
    if (isNaN(refNum) || refNum <= 0) return { success: false, error: 'Referencia ePayco inválida' }
    let desglose
    try {
      desglose = await consultarTransaccionEpayco(refNum)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Error consultando ePayco' }
    }
    if (desglose.estado !== ESTADO_APROBADO_EPAYCO) {
      return {
        success: false,
        error: `La transacción está "${desglose.estado}" en ePayco — solo se registran pagos aprobados (Aceptada).`,
      }
    }
    // Techo de plata real: no se puede repartir más de lo que entró por ePayco.
    if (!Number.isFinite(montoTotal) || montoTotal <= 0) montoTotal = desglose.monto_bruto
    if (montoTotal - desglose.monto_bruto > 1) {
      return {
        success: false,
        error: `El total a repartir (${fmtCOP(montoTotal)}) supera el pago real de ePayco (${fmtCOP(desglose.monto_bruto)}).`,
      }
    }
    montoTotal = Math.min(montoTotal, desglose.monto_bruto)
  }

  return repartirPagoCore(
    supabase,
    workspaceId,
    staffId,
    { ...input, referencia, monto_total: montoTotal },
    'comercial',
    { validarNegociosAbiertos: true, bloquearReferenciaExistente: true },
  )
}

/**
 * Elimina UNA porción de un pago (un cobro de un split) PROPUESTA por el comercial.
 * Guard COMERCIAL (`ctxFabPago`). Gate: solo si el negocio del cobro está en
 * `stage_actual='venta'` Y su conciliación NO está confirmada (`negocio_conciliacion.
 * conciliado` != true). Fuera de eso, bloqueado con mensaje que distingue el motivo.
 *
 * Al eliminar: borra el cobro, setea `negocio_conciliacion.conciliado=false`
 * (defensivo), registra en activity_log y revalida. Esto deja la referencia con saldo
 * sin asignar (porciones restantes < total).
 */
export async function eliminarPorcionPago(
  cobroId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  if (!cobroId) return { success: false, error: 'Porción inválida' }

  // Cargar el cobro + su negocio (stage) en el workspace.
  const { data: cobroRaw } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, external_ref, monto, negocios:negocio_id ( id, stage_actual, codigo )')
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const cobro = cobroRaw as {
    id: string
    negocio_id: string | null
    external_ref: string | null
    monto: number
    negocios: { id: string; stage_actual: string | null; codigo: string | null } | null
  } | null
  if (!cobro || !cobro.negocio_id || !cobro.negocios) {
    return { success: false, error: 'Porción no encontrada' }
  }

  const negocioId = cobro.negocio_id
  const stage = cobro.negocios.stage_actual

  // Gate 1: negocio en venta.
  if (stage !== 'venta') {
    return {
      success: false,
      error: 'Solo puedes eliminar una porción mientras el negocio está en venta. Este negocio ya avanzó — pide al área financiera que la ajuste.',
    }
  }

  // Gate 2: la conciliación de este negocio NO está confirmada por la financiera.
  const { data: concRaw } = await db(supabase)
    .from('negocio_conciliacion')
    .select('conciliado')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .maybeSingle()
  const conciliado = (concRaw as { conciliado?: boolean } | null)?.conciliado === true
  if (conciliado) {
    return {
      success: false,
      error: 'Esta porción ya fue conciliada por el área financiera. No se puede eliminar — pídele que la ajuste.',
    }
  }

  // Borrar la porción.
  const { error: delErr } = await db(supabase).from('cobros').delete().eq('id', cobroId).eq('workspace_id', workspaceId)
  if (delErr) return { success: false, error: (delErr as { message?: string }).message ?? 'No se pudo eliminar la porción' }

  // Defensivo: el negocio deja de estar conciliado (cambió su cobrado).
  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)

  if (staffId && cobro.external_ref) {
    try {
      await db(supabase).from('activity_log').insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'comentario',
        autor_id: staffId,
        contenido: `Porción de pago eliminada por el comercial — libera la referencia ${cobro.external_ref}.`,
      })
    } catch { /* no bloquear por el log */ }
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return { success: true }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONCILIACIÓN v2 — modelo por REFERENCIA de pago + 5 pestañas
// ═══════════════════════════════════════════════════════════════════════════════

const ESTADO_APROBADO_EPAYCO = 'Aceptada'

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

/** Una porción de una referencia: el cobro que la liga a un negocio (o devolución). */
export interface RefPorcion {
  cobro_id: string
  negocio_id: string | null
  negocio_codigo: string | null
  negocio_nombre: string | null
  etapa_nombre: string | null
  etapa_orden: number | null
  monto: number
  /** true si es un remanente marcado "por devolver al cliente". */
  por_devolver: boolean
  /** true si este cobro nació de repartir un sobrepago (no es el pago original). */
  es_reparto: boolean
  /** Valor total del pago de la referencia, persistido en el cobro de origen. */
  ref_total: number | null
}

/** Una referencia de pago cargada al workspace, con sus porciones. */
export interface ReferenciaPago {
  external_ref: string
  /** Fuente del pago: 'epayco' | 'davivienda' | <texto>. */
  fuente: string | null
  /** Monto total reconocido de la referencia (suma de porciones positivas no-devolución). */
  valor_pagado: number
  /** ¿Es un split deliberado (un pago repartido entre varios negocios)? */
  es_split: boolean
  /**
   * true si el reparto fue PROPUESTO por el comercial (split_json.origen==='comercial').
   * La financiera aún no lo ha confirmado (control de dos personas): se muestra como
   * "Propuesto por el comercial — pendiente de confirmar".
   */
  propuesto_por_comercial: boolean
  /** true si algún negocio de la referencia ya tiene el check de conciliación. */
  algun_conciliado: boolean
  /**
   * Total declarado del pago (split_json.split_total) cuando es un reparto. Para un
   * reparto del comercial parcial, puede ser mayor que `valor_pagado` (lo asignado).
   * null si no se declaró (referencias no-split).
   */
  total_declarado: number | null
  /** Saldo sin asignar = total_declarado − valor_pagado (nunca negativo). 0 si no aplica. */
  sin_asignar: number
  porciones: RefPorcion[]
  /** Negocios distintos (no-devolución) a los que está cargada. */
  negocios_ids: string[]
}

/** Negocio con su estado de pagos (para Saldos / búsqueda). */
export interface NegocioSaldo {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
  etapa_nombre: string | null
  responsable: string | null
  precio: number
  cobrado: number
  saldo: number // precio - cobrado. > 0 = falta por cobrar
  referencias: { external_ref: string; fuente: string | null; monto: number; fecha: string | null }[]
  conciliado: boolean
}

/** Un negocio al que se le asignó una porción del pago de una referencia. */
export interface AsignacionRef {
  negocio_id: string | null
  codigo: string | null
  nombre: string | null
  /** Monto del pago asignado a este negocio. */
  monto: number
  /** true si es el negocio donde cayó el pago originalmente. */
  es_origen: boolean
  /** Saldo del negocio (precio - cobrado). >0 = aún le falta por cobrar. */
  saldo: number
}

/** Una referencia con sobrepago para la pestaña POR CONCILIAR. */
export interface SobrepagoRef {
  external_ref: string
  fuente: string | null
  /** Negocio de origen (donde se cargó el pago con sobrepago). */
  negocio_id: string
  negocio_codigo: string | null
  negocio_nombre: string | null
  /** Precio del negocio de origen (informativo). */
  precio_negocio: number
  /** Valor total del pago de la referencia (constante). */
  valor_pagado: number
  /** Suma de lo asignado a negocios. */
  asignado: number
  /** Lo marcado por devolver al cliente (valor absoluto). */
  por_devolver_monto: number
  /** Remanente sin asignar = valor_pagado - asignado - por_devolver. Conciliar requiere 0. */
  remanente: number
  conciliado: boolean
  /** Negocios a los que está repartido el pago (incluye el de origen). */
  asignaciones: AsignacionRef[]
}

/** Una referencia duplicada (cargada en varios negocios) para la pestaña DUPLICADOS. */
export interface DuplicadoRef {
  external_ref: string
  fuente: string | null
  valor_pagado: number
  negocios: {
    negocio_id: string
    codigo: string | null
    nombre: string | null
    etapa_nombre: string | null
    etapa_orden: number | null
  }[]
  /** true si todos empatan en la etapa más avanzada (→ desvincular ambos al aceptar). */
  empate: boolean
}

export interface ConciliacionV2 {
  // Pestaña 1
  sobrepagos: SobrepagoRef[]
  porDevolver: RefPorcion[]
  // Pestaña 2
  saldos: NegocioSaldo[]
  // Pestaña 3
  duplicados: DuplicadoRef[]
  // Pestaña 4
  conciliados: NegocioSaldo[]
  // Negocios disponibles para asignar (saldo > 0) — usado por el reparto inline
  negociosConSaldo: NegocioParaSplit[]
  // Pestaña 5 — Vista general: registro de TODAS las referencias de pago
  // con su desglose por negocio (cuánto de cada pago quedó cargado a cada uno).
  referencias: ReferenciaPago[]
  // Pestaña 5 — métricas
  metricas: {
    referencias_cargadas: number
    por_conciliar: number
    en_saldo: number
    duplicados: number
    conciliados: number
  }
}

// ── Helpers internos de carga ────────────────────────────────────────────────

interface NegocioRow {
  id: string
  codigo: string | null
  nombre: string | null
  precio: number
  estado: string | null
  stage_actual: string | null
  etapa_nombre: string | null
  etapa_orden: number | null
  empresa: string | null
}

interface CobroRow {
  id: string
  negocio_id: string | null
  monto: number
  tipo_cobro: string | null
  external_ref: string | null
  fuente: string | null
  fecha: string | null
  split_json: { split_id?: string; por_reparto?: boolean; ref_total?: number; por_devolver?: boolean; origen?: string; split_total?: number } | null
}

async function cargarNegociosYCobros(
  supabase: unknown,
  workspaceId: string,
): Promise<{ negocios: Map<string, NegocioRow>; cobros: CobroRow[] }> {
  const { data: negociosRaw } = await db(supabase)
    .from('negocios')
    .select(`
      id, codigo, nombre, precio_aprobado, precio_estimado, estado, stage_actual,
      etapas_negocio:etapa_actual_id ( nombre, orden ),
      empresas:empresa_id ( nombre )
    `)
    .eq('workspace_id', workspaceId)

  const negocios = new Map<string, NegocioRow>()
  for (const n of ((negociosRaw ?? []) as Array<{
    id: string; codigo: string | null; nombre: string | null
    precio_aprobado: number | null; precio_estimado: number | null
    estado: string | null; stage_actual: string | null
    etapas_negocio: { nombre: string | null; orden: number | null } | null
    empresas: { nombre: string | null } | null
  }>)) {
    negocios.set(n.id, {
      id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      precio: n.precio_aprobado ?? n.precio_estimado ?? 0,
      estado: n.estado,
      stage_actual: n.stage_actual,
      etapa_nombre: n.etapas_negocio?.nombre ?? null,
      etapa_orden: n.etapas_negocio?.orden ?? null,
      empresa: n.empresas?.nombre ?? null,
    })
  }

  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, monto, tipo_cobro, external_ref, fuente, fecha, split_json')
    .eq('workspace_id', workspaceId)

  return { negocios, cobros: (cobrosRaw ?? []) as CobroRow[] }
}

/** cobrado financiero por negocio (excluye devoluciones pendientes). */
function cobradoFinanciero(cobros: CobroRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of cobros) {
    if (!c.negocio_id) continue
    if (c.tipo_cobro === 'devolucion_pendiente') continue
    m.set(c.negocio_id, (m.get(c.negocio_id) ?? 0) + (c.monto ?? 0))
  }
  return m
}

/** Infiere la fuente de un cobro cuando la columna fuente es NULL (retrocompat). */
function inferirFuente(c: CobroRow): string | null {
  if (c.fuente) return c.fuente
  if (c.tipo_cobro === 'externo') return 'externo'
  if (c.external_ref && /^\d+$/.test(c.external_ref)) return 'epayco'
  return null
}

// ── getConciliacionV2 — fuente única del panel rediseñado ────────────────────

export async function getConciliacionV2(): Promise<{ data: ConciliacionV2 | null; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { data: null, error: ctx.error }
  const { supabase, workspaceId } = ctx

  const { negocios, cobros } = await cargarNegociosYCobros(supabase, workspaceId)
  const cobrado = cobradoFinanciero(cobros)

  const negocioIds = Array.from(negocios.keys())
  const responsablePorNegocio = new Map<string, string>()
  if (negocioIds.length > 0) {
    const { data: respRaw } = await db(supabase)
      .from('negocio_responsables')
      .select('negocio_id, staff:staff_id ( full_name )')
      .in('negocio_id', negocioIds)
    for (const r of ((respRaw ?? []) as Array<{ negocio_id: string; staff: { full_name: string | null } | null }>)) {
      if (!responsablePorNegocio.has(r.negocio_id) && r.staff?.full_name) {
        responsablePorNegocio.set(r.negocio_id, r.staff.full_name)
      }
    }
  }

  const { data: concRaw } = await db(supabase)
    .from('negocio_conciliacion')
    .select('negocio_id, conciliado')
    .eq('workspace_id', workspaceId)
  const conciliadoNegocio = new Map<string, boolean>()
  for (const r of ((concRaw ?? []) as Array<{ negocio_id: string; conciliado: boolean }>)) {
    conciliadoNegocio.set(r.negocio_id, r.conciliado)
  }

  // Agrupar cobros por external_ref → referencias
  const refMap = new Map<string, CobroRow[]>()
  for (const c of cobros) {
    if (!c.external_ref) continue
    if (!refMap.has(c.external_ref)) refMap.set(c.external_ref, [])
    refMap.get(c.external_ref)!.push(c)
  }

  const referencias: ReferenciaPago[] = []
  for (const [ref, rows] of refMap) {
    const esSplit = rows.some((r) => r.split_json?.split_id)
    const fuente = inferirFuente(rows[0])
    const porciones: RefPorcion[] = rows.map((r) => {
      const neg = r.negocio_id ? negocios.get(r.negocio_id) : null
      return {
        cobro_id: r.id,
        negocio_id: r.negocio_id,
        negocio_codigo: neg?.codigo ?? null,
        negocio_nombre: neg?.nombre ?? null,
        etapa_nombre: neg?.etapa_nombre ?? null,
        etapa_orden: neg?.etapa_orden ?? null,
        monto: r.monto ?? 0,
        por_devolver: r.tipo_cobro === 'devolucion_pendiente',
        es_reparto: r.split_json?.por_reparto === true,
        ref_total: r.split_json?.ref_total ?? null,
      }
    })
    const valorPagado = porciones.filter((p) => !p.por_devolver).reduce((s, p) => s + p.monto, 0)
    const negociosImplicados = Array.from(
      new Set(porciones.filter((p) => !p.por_devolver && p.negocio_id).map((p) => p.negocio_id as string)),
    )
    const propuestoPorComercial = rows.some((r) => r.split_json?.origen === 'comercial')
    const algunConciliado = negociosImplicados.some((id) => conciliadoNegocio.get(id) === true)
    // Total declarado del reparto (si lo hay): el mayor split_total entre las porciones.
    const totalDeclarado = rows.reduce<number | null>((max, r) => {
      const st = r.split_json?.split_total
      if (typeof st === 'number' && st > 0) return max == null ? st : Math.max(max, st)
      return max
    }, null)
    const sinAsignar = totalDeclarado != null ? Math.max(0, totalDeclarado - valorPagado) : 0
    referencias.push({
      external_ref: ref,
      fuente,
      valor_pagado: valorPagado,
      es_split: esSplit,
      propuesto_por_comercial: propuestoPorComercial,
      algun_conciliado: algunConciliado,
      total_declarado: totalDeclarado,
      sin_asignar: sinAsignar,
      porciones,
      negocios_ids: negociosImplicados,
    })
  }

  // Pestaña 1: SOBREPAGOS (por referencia) + por devolver (global)
  //
  // Una referencia es un sobrepago cuando su pago total supera el precio del
  // negocio donde cayó (el "origen"). El pago se reparte como porciones editables
  // entre varios negocios (anticipos parciales): el remanente = valor pagado -
  // asignado - por devolver, y baja a medida que se asigna. Se concilia en $0.
  const sobrepagos: SobrepagoRef[] = []
  const porDevolver: RefPorcion[] = []
  for (const ref of referencias) {
    for (const p of ref.porciones) if (p.por_devolver) porDevolver.push(p)

    const pos = ref.porciones.filter((p) => !p.por_devolver && p.negocio_id)
    if (pos.length === 0) continue
    // El origen es la única porción que NO nació de un reparto (el pago original).
    const nonReparto = pos.filter((p) => !p.es_reparto)
    if (nonReparto.length !== 1) continue
    const origin = nonReparto[0]
    const negOrigin = origin.negocio_id ? negocios.get(origin.negocio_id) : null
    if (!negOrigin || negOrigin.estado !== 'abierto') continue
    const precioOrigen = negOrigin.precio

    // ref_total: persistido en el cobro de origen una vez se materializa el reparto.
    // Mientras está "fresco", el cobro de origen aún contiene todo el pago.
    const materializado = origin.ref_total != null
    const refTotal = materializado ? (origin.ref_total as number) : origin.monto
    if (refTotal <= precioOrigen + 1) continue // no hay sobrepago

    const conc = origin.negocio_id ? (conciliadoNegocio.get(origin.negocio_id) ?? false) : false
    if (conc) continue // ya conciliado → sale de la pestaña

    const devuelto = ref.porciones
      .filter((p) => p.por_devolver)
      .reduce((s, p) => s + Math.abs(p.monto), 0)

    const asignaciones: AsignacionRef[] = []
    if (materializado) {
      for (const p of pos) {
        const neg = p.negocio_id ? negocios.get(p.negocio_id) : null
        const cob = cobrado.get(p.negocio_id ?? '') ?? 0
        asignaciones.push({
          negocio_id: p.negocio_id,
          codigo: p.negocio_codigo,
          nombre: p.negocio_nombre,
          monto: p.monto,
          es_origen: p.negocio_id === origin.negocio_id,
          saldo: neg ? neg.precio - cob : 0,
        })
      }
    } else {
      // Fresco: por defecto el origen retiene su precio; el resto es remanente.
      const cobOrig = cobrado.get(origin.negocio_id ?? '') ?? 0
      asignaciones.push({
        negocio_id: origin.negocio_id,
        codigo: origin.negocio_codigo,
        nombre: origin.negocio_nombre,
        monto: Math.min(precioOrigen, refTotal),
        es_origen: true,
        saldo: negOrigin.precio - cobOrig,
      })
    }

    const asignado = asignaciones.reduce((s, a) => s + a.monto, 0)
    const remanente = Math.max(0, refTotal - asignado - devuelto)

    sobrepagos.push({
      external_ref: ref.external_ref,
      fuente: ref.fuente,
      negocio_id: origin.negocio_id as string,
      negocio_codigo: origin.negocio_codigo,
      negocio_nombre: origin.negocio_nombre,
      precio_negocio: precioOrigen,
      valor_pagado: refTotal,
      asignado,
      por_devolver_monto: devuelto,
      remanente,
      conciliado: conc,
      asignaciones,
    })
  }

  // Pestaña 2: SALDOS + Pestaña 4: CONCILIADOS (saldo 0)
  const saldos: NegocioSaldo[] = []
  const conciliadosList: NegocioSaldo[] = []
  for (const [negId, neg] of negocios) {
    if (neg.estado !== 'abierto') continue
    const cob = cobrado.get(negId) ?? 0
    const saldo = neg.precio - cob
    const refsDelNegocio = referencias
      .filter((r) => r.porciones.some((p) => p.negocio_id === negId))
      .map((r) => {
        const porcion = r.porciones.find((p) => p.negocio_id === negId)
        const cobro = cobros.find((c) => c.id === porcion?.cobro_id)
        return {
          external_ref: r.external_ref,
          fuente: r.fuente,
          monto: porcion?.por_devolver ? 0 : (porcion?.monto ?? 0),
          fecha: cobro?.fecha ?? null,
        }
      })
    const fila: NegocioSaldo = {
      negocio_id: negId,
      codigo: neg.codigo,
      nombre: neg.nombre,
      empresa: neg.empresa,
      etapa_nombre: neg.etapa_nombre,
      responsable: responsablePorNegocio.get(negId) ?? null,
      precio: neg.precio,
      cobrado: cob,
      saldo,
      referencias: refsDelNegocio,
      conciliado: conciliadoNegocio.get(negId) ?? false,
    }
    if (Math.abs(saldo) <= 1) conciliadosList.push(fila)
    else saldos.push(fila)
  }
  saldos.sort((a, b) => b.saldo - a.saldo)

  // Pestaña 3: DUPLICADOS
  const duplicados: DuplicadoRef[] = []
  for (const ref of referencias) {
    if (ref.es_split) continue
    const negs = ref.negocios_ids
      .map((id) => negocios.get(id))
      .filter((n): n is NegocioRow => !!n && n.estado === 'abierto')
    if (negs.length <= 1) continue
    const maxOrden = Math.max(...negs.map((n) => n.etapa_orden ?? -1))
    const enMax = negs.filter((n) => (n.etapa_orden ?? -1) === maxOrden)
    duplicados.push({
      external_ref: ref.external_ref,
      fuente: ref.fuente,
      valor_pagado: ref.valor_pagado,
      negocios: negs.map((n) => ({
        negocio_id: n.id,
        codigo: n.codigo,
        nombre: n.nombre,
        etapa_nombre: n.etapa_nombre,
        etapa_orden: n.etapa_orden,
      })),
      empate: enMax.length > 1,
    })
  }

  const negociosConSaldo: NegocioParaSplit[] = saldos
    .filter((s) => s.saldo > 0)
    .map((s) => ({
      negocio_id: s.negocio_id,
      codigo: s.codigo,
      nombre: s.nombre,
      empresa: s.empresa,
      precio: s.precio,
      cobrado: s.cobrado,
      diferencia: s.saldo,
    }))

  return {
    data: {
      sobrepagos: sobrepagos.sort((a, b) => Number(a.conciliado) - Number(b.conciliado)),
      porDevolver,
      saldos,
      duplicados,
      conciliados: conciliadosList.sort((a, b) => (a.codigo ?? '').localeCompare(b.codigo ?? '')),
      negociosConSaldo,
      // Registro general: referencias con más de un negocio primero (lo que
      // importa para "cuánto quedó en cada negocio"), luego por valor desc.
      referencias: referencias.sort((a, b) => {
        const am = a.negocios_ids.length > 1 ? 0 : 1
        const bm = b.negocios_ids.length > 1 ? 0 : 1
        if (am !== bm) return am - bm
        return b.valor_pagado - a.valor_pagado
      }),
      metricas: {
        referencias_cargadas: referencias.length,
        por_conciliar: sobrepagos.filter((s) => !s.conciliado).length,
        en_saldo: saldos.length,
        duplicados: duplicados.length,
        conciliados: conciliadosList.length,
      },
    },
  }
}

// ── registrarPagoEnNegocio — vía ÚNICA de registro de pago ───────────────────

export interface AgregarPagoInput {
  negocio_id: string
  fuente: 'epayco' | 'davivienda' | 'otra'
  fuente_nombre?: string
  referencia: string
  monto?: number
  fecha?: string
  justificacion?: string
  tipo_cobro?: string
}

/**
 * Núcleo de registro de UN pago contra UN negocio. Fuente ÚNICA de la vía de pago:
 * la usa `agregarPagoFab` (FAB global, guard por rol — `fab-pago-actions.ts`). El
 * reparto/registro del comercial desde el bloque de pagos entra por
 * `repartirPagoComercial`, que a su vez usa `repartirPagoCore`. NO duplicar
 * esta lógica en otra vía: todas las barreras (validación ePayco real con override
 * justificado, duplicado no-split, saldo del negocio vía cobros, des-conciliar al
 * cambiar el cobrado) viven aquí.
 *
 * El guard de permisos lo aplica el CALLER antes de invocar esta función. `origen`
 * solo etiqueta el activity_log para trazabilidad ('conciliacion' | 'fab') — cuando
 * es 'fab' deja además un registro explícito de que el pago entró por el FAB global
 * (un comercial pudo registrar un pago sobre un negocio fuera de su etapa/área).
 */
export async function registrarPagoEnNegocio(
  supabase: unknown,
  workspaceId: string,
  staffId: string | null,
  input: AgregarPagoInput,
  origen: 'conciliacion' | 'fab' = 'conciliacion',
): Promise<
  | { success: true }
  | { success: false; error: string; code?: 'epayco_no_aprobada' | 'referencia_duplicada'; negocio_existente?: { codigo: string | null } }
> {
  const negocioId = input.negocio_id
  if (!negocioId) return { success: false, error: 'Elige el negocio al que se asigna el pago' }

  const { data: neg } = await db(supabase)
    .from('negocios').select('id').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle()
  if (!neg) return { success: false, error: 'Negocio no encontrado' }

  // Traza de origen FAB (autor = staff real). Va ADEMÁS del cobro creado abajo:
  // deja constancia de "un comercial registró un pago vía FAB sobre un negocio fuera
  // de su etapa". Solo cuando el insert del cobro tuvo éxito (se llama al final).
  const logFabOrigen = async (refTxt: string) => {
    if (origen !== 'fab' || !staffId) return
    try {
      await db(supabase).from('activity_log').insert({
        workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: negocioId,
        tipo: 'comentario', autor_id: staffId,
        contenido: `Pago registrado desde el FAB global (origen: fab) — Ref ${refTxt}, fuente ${input.fuente === 'otra' ? (input.fuente_nombre ?? 'otra') : input.fuente}.`,
      })
    } catch { /* no bloquear por el log */ }
  }

  const referencia = (input.referencia ?? '').trim()
  if (!referencia) return { success: false, error: 'La referencia del pago es obligatoria' }
  const fecha = (input.fecha ?? '').trim() || todayBogotaISO()

  if (input.fuente === 'epayco') {
    const refNum = parseInt(referencia, 10)
    if (isNaN(refNum) || refNum <= 0) return { success: false, error: 'Referencia ePayco inválida' }

    let desglose
    try {
      desglose = await consultarTransaccionEpayco(refNum)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Error consultando ePayco' }
    }
    if (desglose.estado !== ESTADO_APROBADO_EPAYCO) {
      return {
        success: false, code: 'epayco_no_aprobada',
        error: `La transacción está "${desglose.estado}" en ePayco — solo se registran pagos aprobados (Aceptada).`,
      }
    }

    // Bloqueo DURO de duplicado (sin override): la referencia es un solo pago.
    // Si ya existe en OTRO negocio, no se carga; el área financiera la distribuye.
    const dup = await refDuplicadaNoSplit(supabase, workspaceId, String(refNum))
    if (dup && dup.negocio_id !== negocioId) {
      return {
        success: false,
        error: `Esta referencia ePayco ya está registrada en ${dup.codigo ?? dup.negocio_id}. No se puede cargar duplicada — pide al área financiera que distribuya ese pago entre los negocios.`,
      }
    }

    const { data: existing } = await db(supabase)
      .from('cobros').select('id')
      .eq('workspace_id', workspaceId).eq('negocio_id', negocioId).eq('external_ref', String(refNum)).limit(1)
    if (existing && (existing as unknown[]).length > 0) return { success: true }

    const { error: insErr } = await db(supabase).from('cobros').insert({
      workspace_id: workspaceId, negocio_id: negocioId, monto: desglose.monto_bruto,
      tipo_cobro: input.tipo_cobro ?? 'pago', fecha, external_ref: String(refNum),
      fuente: 'epayco', notas: `Pago ePayco — Ref ${refNum}`,
    })
    if (insErr) return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar el pago' }
    await logFabOrigen(String(refNum))
  } else {
    const monto = Number(input.monto)
    if (!Number.isFinite(monto) || monto <= 0) return { success: false, error: 'El monto debe ser mayor a cero' }

    const fuenteValor = input.fuente === 'davivienda' ? 'davivienda' : (input.fuente_nombre ?? '').trim()
    if (input.fuente === 'otra' && !fuenteValor) return { success: false, error: 'Indica el nombre de la fuente del pago' }
    const externalRef = referencia

    // Bloqueo DURO de duplicado también para pagos manuales (Davivienda/otra).
    const dupManual = await refDuplicadaNoSplit(supabase, workspaceId, externalRef)
    if (dupManual && dupManual.negocio_id !== negocioId) {
      return {
        success: false,
        error: `Esta referencia ya está registrada en ${dupManual.codigo ?? dupManual.negocio_id}. No se puede cargar duplicada — pide al área financiera que distribuya ese pago entre los negocios.`,
      }
    }

    const { data: existing } = await db(supabase)
      .from('cobros').select('id')
      .eq('workspace_id', workspaceId).eq('negocio_id', negocioId).eq('external_ref', externalRef).limit(1)
    if (existing && (existing as unknown[]).length > 0) return { success: true }

    const { error: insErr } = await db(supabase).from('cobros').insert({
      workspace_id: workspaceId, negocio_id: negocioId, monto,
      tipo_cobro: input.tipo_cobro ?? 'externo', fecha, external_ref: externalRef,
      fuente: fuenteValor, notas: `Pago ${fuenteValor} — Ref ${referencia}`,
    })
    if (insErr) return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar el pago' }
    await logFabOrigen(referencia)
  }

  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId).eq('negocio_id', negocioId)

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return { success: true }
}

async function refDuplicadaNoSplit(
  supabase: unknown,
  workspaceId: string,
  externalRef: string,
): Promise<{ negocio_id: string; codigo: string | null } | null> {
  const { data } = await db(supabase)
    .from('cobros')
    .select('negocio_id, split_json, negocios:negocio_id ( codigo )')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', externalRef)
    .not('negocio_id', 'is', null)
    .is('split_json->>split_id', null)
    .limit(1)
    .maybeSingle()
  const row = data as { negocio_id: string; negocios: { codigo: string | null } | null } | null
  if (!row?.negocio_id) return null
  return { negocio_id: row.negocio_id, codigo: row.negocios?.codigo ?? null }
}

// ── Modelo de dinero SOENA: reparto de UN pago en 2 cobros (pasante + honorario) ──
//
// El cliente paga en UN pago ePayco dos componentes: honorario de SOENA + tarifa
// UPME (pasante — SOENA solo recauda y desembolsa). Este helper lee, del bloque
// `propuesta_economica` aprobado del negocio, la tarifa (pasante) congelada y la
// modalidad (aprobado_plan: 1 = 50/50, 2 = único). OPT-IN: si el negocio no tiene
// propuesta aprobada con tarifa, devuelve null → el caller usa el flujo de 1 cobro.

/** Info del modelo de dinero de un negocio, leída de su propuesta aprobada. */
export type ModeloDineroNegocio = ModeloDinero

export async function leerModeloDineroNegocio(
  supabase: unknown,
  negocioId: string,
): Promise<ModeloDineroNegocio | null> {
  // Busca el bloque propuesta_economica del negocio (por tipo de su definición).
  const { data } = await db(supabase)
    .from('negocio_bloques')
    .select('data, estado, bloque_configs!inner(bloque_definitions!inner(tipo))')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica')
    .limit(1)
    .maybeSingle()
  const row = data as { data: Record<string, unknown> | null } | null
  if (!row?.data) return null
  const d = row.data
  const tarifa = Number(d.aprobado_tarifa_upme ?? d.tarifa_upme ?? 0)
  const plan = (d.aprobado_plan === 1 || d.aprobado_plan === 2) ? (d.aprobado_plan as 1 | 2) : null
  const honorario = d.aprobado_honorario != null ? Number(d.aprobado_honorario) : null
  if (!Number.isFinite(tarifa) || tarifa <= 0) {
    // Sin tarifa (pasante) → este negocio no usa el reparto en 2 cobros.
    return null
  }
  return { tarifa_upme: tarifa, aprobado_plan: plan, aprobado_honorario: honorario }
}

/**
 * Núcleo del reparto (sin guard) — reutilizable desde el auto-cobro de anticipo
 * (que corre con `getWorkspace` en negocio-v2-actions) y desde el panel financiero.
 * El guard lo aplica el caller.
 */
export async function crearCobrosSoenaCore(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
  referencia: string,
  monto: number,
  modelo: ModeloDineroNegocio,
  opts?: { fuente?: string; fecha?: string },
): Promise<
  | { success: true; applied: true; split_id: string; monto_pasante: number; monto_honorario: number }
  | { success: false; error: string }
> {
  const fecha = (opts?.fecha ?? '').trim() || todayBogotaISO()
  const fuente = (opts?.fuente ?? 'epayco').trim() || 'epayco'

  // La tarifa (pasante) se cubre PRIMERO; el resto es honorario (helper puro).
  const { monto_pasante: montoPasante, monto_honorario: montoHonorario } =
    repartirPagoTarifaHonorario(monto, modelo.tarifa_upme)
  const tipoHonorario = tipoCobroHonorario(modelo.aprobado_plan)

  // Idempotencia: buscar cobros ya existentes de esta referencia en este negocio,
  // por tipo. Si ya existe el pasante y/o el honorario, no re-insertar.
  const { data: existentes } = await db(supabase)
    .from('cobros')
    .select('id, tipo_cobro')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .eq('external_ref', referencia)
  const yaTipos = new Set(
    ((existentes ?? []) as Array<{ tipo_cobro: string | null }>).map((c) => c.tipo_cobro),
  )

  // split_id: reusar el de un cobro existente de esta ref si lo hay; si no, nuevo.
  let splitId: string = randomUUID()
  const { data: existSplit } = await db(supabase)
    .from('cobros')
    .select('split_json')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .eq('external_ref', referencia)
    .not('split_json', 'is', null)
    .limit(1)
    .maybeSingle()
  const prevSplit = (existSplit as { split_json: { split_id?: string } | null } | null)?.split_json?.split_id
  if (prevSplit) splitId = prevSplit

  const filas: Array<Record<string, unknown>> = []
  if (montoPasante > 0 && !yaTipos.has('pasante')) {
    filas.push({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      monto: montoPasante,
      tipo_cobro: 'pasante',
      fecha,
      external_ref: referencia,
      fuente,
      notas: `Tarifa UPME (pasante) — Ref ${referencia}`,
      split_json: { split_id: splitId, split_total: monto, split_n: 2, componente: 'pasante' },
    })
  }
  if (montoHonorario > 0 && !yaTipos.has(tipoHonorario)) {
    filas.push({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      monto: montoHonorario,
      tipo_cobro: tipoHonorario,
      fecha,
      external_ref: referencia,
      fuente,
      notas: `Honorario SOENA — Ref ${referencia}`,
      split_json: { split_id: splitId, split_total: monto, split_n: 2, componente: 'honorario' },
    })
  }

  if (filas.length > 0) {
    const { error: insErr } = await db(supabase).from('cobros').insert(filas)
    if (insErr) return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar el reparto' }
  }

  // Cambió el cobrado → des-conciliar.
  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId).eq('negocio_id', negocioId)

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return { success: true, applied: true, split_id: splitId, monto_pasante: montoPasante, monto_honorario: montoHonorario }
}

// ── aceptarRepartoComercial — la financiera confirma el reparto del comercial ─

/**
 * ACEPTA (concilia) un reparto/pago PROPUESTO por el comercial para una referencia.
 * Marca el check de conciliación en TODOS los negocios que reciben una porción
 * `origen='comercial'` de esa referencia. Cada negocio cuadra su propia parte del
 * pago — la financiera valida que el dinero real corresponde y da el visto bueno.
 *
 * Permisos: solo área financiera (Diana) vía ctxFinanciero.
 */
export async function aceptarRepartoComercial(
  externalRef: string,
): Promise<{ success: true; conciliados: number } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const ref = (externalRef ?? '').trim()
  if (!ref) return { success: false, error: 'Referencia inválida' }

  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('negocio_id, split_json')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', ref)
  const negociosTocados = Array.from(new Set(
    ((cobrosRaw ?? []) as Array<{ negocio_id: string | null; split_json: { origen?: string } | null }>)
      .filter((c) => c.split_json?.origen === 'comercial' && c.negocio_id)
      .map((c) => c.negocio_id as string),
  ))

  if (negociosTocados.length === 0) {
    return { success: false, error: 'No hay un reparto propuesto por el comercial para esta referencia.' }
  }

  const nowIso = new Date().toISOString()
  for (const id of negociosTocados) {
    const { error: upErr } = await db(supabase).from('negocio_conciliacion').upsert(
      {
        workspace_id: workspaceId,
        negocio_id: id,
        conciliado: true,
        conciliado_por: staffId,
        conciliado_at: nowIso,
        nota: `Reparto de la referencia ${ref} aceptado por el área financiera.`,
        updated_at: nowIso,
      },
      { onConflict: 'negocio_id' },
    )
    if (upErr) return { success: false, error: (upErr as { message?: string }).message ?? 'No se pudo aceptar el reparto' }

    if (staffId) {
      try {
        await db(supabase).from('activity_log').insert({
          workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: id,
          tipo: 'comentario', autor_id: staffId,
          contenido: `Pago conciliado por el área financiera (referencia ${ref}).`,
        })
      } catch { /* no bloquear por el log */ }
    }
  }

  for (const id of negociosTocados) revalidatePath(`/negocios/${id}`)
  revalidatePath('/conciliacion')
  return { success: true, conciliados: negociosTocados.length }
}

// ── rechazarRepartoComercial — la financiera devuelve el reparto al comercial ─

/**
 * RECHAZA un reparto/pago PROPUESTO por el comercial (`split_json.origen='comercial'`)
 * para una referencia. Borra SOLO las porciones del comercial de esa referencia,
 * des-concilia los negocios tocados y deja constancia en el activity_log de cada uno
 * (con la nota opcional de la financiera). Devuelve el trabajo al comercial: la
 * referencia queda liberada para que él la vuelva a registrar/repartir bien.
 *
 * NO toca cobros que no sean del reparto comercial (ePayco directo, pasante/honorario
 * del auto-cobro, etc.). Permisos: solo área financiera (Diana) vía ctxFinanciero.
 */
export async function rechazarRepartoComercial(
  externalRef: string,
  nota?: string,
): Promise<{ success: true; eliminados: number } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const ref = (externalRef ?? '').trim()
  if (!ref) return { success: false, error: 'Referencia inválida' }

  // Cargar los cobros de esta referencia propuestos por el comercial.
  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, split_json')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', ref)
  const comercial = ((cobrosRaw ?? []) as Array<{
    id: string
    negocio_id: string | null
    split_json: { origen?: string } | null
  }>).filter((c) => c.split_json?.origen === 'comercial' && c.negocio_id)

  if (comercial.length === 0) {
    return { success: false, error: 'No hay un reparto propuesto por el comercial para esta referencia.' }
  }

  const negociosTocados = Array.from(new Set(comercial.map((c) => c.negocio_id as string)))

  for (const c of comercial) {
    const { error: delErr } = await db(supabase).from('cobros').delete().eq('id', c.id).eq('workspace_id', workspaceId)
    if (delErr) return { success: false, error: (delErr as { message?: string }).message ?? 'No se pudo rechazar el reparto' }
  }

  // Cambió el cobrado → des-conciliar los negocios tocados (defensivo).
  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .in('negocio_id', negociosTocados)

  // Constancia en el timeline de cada negocio → el comercial ve el rechazo + la nota.
  if (staffId) {
    const notaTxt = (nota ?? '').trim().slice(0, 300)
    for (const id of negociosTocados) {
      try {
        await db(supabase).from('activity_log').insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: id,
          tipo: 'comentario',
          autor_id: staffId,
          contenido: `El área financiera rechazó el reparto propuesto para la referencia ${ref}.${notaTxt ? ` Nota: ${notaTxt}` : ' Vuelve a registrarlo.'}`,
        })
      } catch { /* no bloquear por el log */ }
    }
  }

  for (const id of negociosTocados) revalidatePath(`/negocios/${id}`)
  revalidatePath('/conciliacion')
  return { success: true, eliminados: comercial.length }
}
