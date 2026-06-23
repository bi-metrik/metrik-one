'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { canEditBloque, type UserContext, type Role, type Area } from '@/lib/permissions/can-edit'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { randomUUID } from 'crypto'
import { consultarTransaccionEpayco } from '@/lib/epayco'

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

/** Fila del panel: un negocio con su diferencia de conciliación. */
export interface FilaConciliacion {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
  etapa_nombre: string | null
  precio: number
  cobrado: number
  diferencia: number // precio - cobrado. >0 saldo pendiente, <0 sobrepago, 0 cuadrado
  /** Referencias ePayco/externas ya registradas en el negocio (para la columna Referencia). */
  referencias: string[]
  conciliado: boolean
  conciliado_at: string | null
  /** Un comercial pidió conciliación de Diana (etiqueta pendiente en activity_log). */
  solicitado: boolean
}

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

// ── getPanelConciliacion ─────────────────────────────────────────────────────

/**
 * Lista los negocios del workspace con su estado de conciliación: precio,
 * cobrado, diferencia, referencias y el check de Diana. El panel los separa en
 * "por conciliar" (diferencia ≠ 0 o sin check) y "conciliados".
 *
 * Solo negocios abiertos (estado 'abierto') con precio > 0 — los cerrados ya no
 * se concilian y los sin precio no aplican.
 */
export async function getPanelConciliacion(): Promise<{
  filas: FilaConciliacion[]
  error?: string
}> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { filas: [], error: ctx.error }
  const { supabase, workspaceId } = ctx

  // Negocios abiertos con precio
  const { data: negociosRaw } = await db(supabase)
    .from('negocios')
    .select(`
      id, codigo, nombre, precio_aprobado, precio_estimado, estado, stage_actual,
      etapas_negocio:etapa_actual_id ( nombre ),
      empresas:empresa_id ( nombre )
    `)
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')

  const negocios = (negociosRaw ?? []) as Array<{
    id: string
    codigo: string | null
    nombre: string | null
    precio_aprobado: number | null
    precio_estimado: number | null
    stage_actual: string | null
    etapas_negocio: { nombre: string | null } | null
    empresas: { nombre: string | null } | null
  }>

  const conPrecio = negocios.filter((n) => (n.precio_aprobado ?? n.precio_estimado ?? 0) > 0)
  const stagePorNegocio = new Map(conPrecio.map((n) => [n.id, n.stage_actual]))
  const ids = conPrecio.map((n) => n.id)
  if (ids.length === 0) return { filas: [] }

  // Cobros de todos esos negocios (batch)
  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('negocio_id, monto, external_ref')
    .eq('workspace_id', workspaceId)
    .in('negocio_id', ids)

  const cobros = (cobrosRaw ?? []) as Array<{ negocio_id: string; monto: number; external_ref: string | null }>
  const cobradoPorNegocio = new Map<string, number>()
  const refsPorNegocio = new Map<string, Set<string>>()
  for (const c of cobros) {
    cobradoPorNegocio.set(c.negocio_id, (cobradoPorNegocio.get(c.negocio_id) ?? 0) + (c.monto ?? 0))
    if (c.external_ref) {
      if (!refsPorNegocio.has(c.negocio_id)) refsPorNegocio.set(c.negocio_id, new Set())
      refsPorNegocio.get(c.negocio_id)!.add(c.external_ref)
    }
  }

  // Estado de conciliación (check de Diana)
  const { data: concRaw } = await db(supabase)
    .from('negocio_conciliacion')
    .select('negocio_id, conciliado, conciliado_at')
    .eq('workspace_id', workspaceId)
    .in('negocio_id', ids)

  const concPorNegocio = new Map<string, { conciliado: boolean; conciliado_at: string | null }>()
  for (const r of ((concRaw ?? []) as Array<{ negocio_id: string; conciliado: boolean; conciliado_at: string | null }>)) {
    concPorNegocio.set(r.negocio_id, { conciliado: r.conciliado, conciliado_at: r.conciliado_at })
  }

  // Etiquetas de "solicitud de conciliación" de comerciales (activity_log). Una
  // etiqueta vale solo si NO tiene una 'conciliacion_atendida' posterior. Resolvemos
  // en JS sobre un solo fetch batch de ambos tipos para estos negocios.
  const { data: tagsRaw } = await db(supabase)
    .from('activity_log')
    .select('entidad_id, tipo, created_at')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', 'negocio')
    .in('entidad_id', ids)
    .in('tipo', ['solicitud_conciliacion', 'conciliacion_atendida'])
    .order('created_at', { ascending: true })

  // último evento por negocio: si es 'solicitud_conciliacion' → etiqueta viva.
  const ultimoTagPorNegocio = new Map<string, string>()
  for (const t of ((tagsRaw ?? []) as Array<{ entidad_id: string; tipo: string; created_at: string }>)) {
    ultimoTagPorNegocio.set(t.entidad_id, t.tipo)
  }
  const solicitadoPorNegocio = new Set<string>()
  for (const [negId, tipo] of ultimoTagPorNegocio) {
    if (tipo === 'solicitud_conciliacion') solicitadoPorNegocio.add(negId)
  }

  const filas: FilaConciliacion[] = conPrecio.map((n) => {
    const precio = n.precio_aprobado ?? n.precio_estimado ?? 0
    const cobrado = cobradoPorNegocio.get(n.id) ?? 0
    const conc = concPorNegocio.get(n.id)
    return {
      negocio_id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      empresa: n.empresas?.nombre ?? null,
      etapa_nombre: n.etapas_negocio?.nombre ?? null,
      precio,
      cobrado,
      diferencia: precio - cobrado,
      referencias: Array.from(refsPorNegocio.get(n.id) ?? []),
      conciliado: conc?.conciliado ?? false,
      conciliado_at: conc?.conciliado_at ?? null,
      solicitado: solicitadoPorNegocio.has(n.id),
    }
  })

  // Acotar a lo que está en la cancha de Diana: negocio en Cobro (escalado), o
  // etiquetado por un comercial, o con sobrepago (diferencia < 0), o ya conciliado
  // (historial). El pipeline temprano con saldo pendiente (diferencia > 0 sin estar
  // en Cobro) es "por cobrar" — del comercial, NO "por conciliar" de Diana.
  const filasRelevantes = filas.filter(
    (f) =>
      stagePorNegocio.get(f.negocio_id) === 'cobro' ||
      f.solicitado ||
      f.diferencia < 0 ||
      f.conciliado,
  )

  // Orden: primero los que faltan (no conciliados o con diferencia), luego conciliados.
  filasRelevantes.sort((a, b) => {
    const aPend = !a.conciliado || a.diferencia !== 0 ? 0 : 1
    const bPend = !b.conciliado || b.diferencia !== 0 ? 0 : 1
    if (aPend !== bPend) return aPend - bPend
    return (a.codigo ?? '').localeCompare(b.codigo ?? '')
  })

  return { filas: filasRelevantes }
}

// ── buscarNegociosParaSplit ──────────────────────────────────────────────────

/**
 * Lista los negocios abiertos con saldo pendiente (diferencia > 0) candidatos a
 * recibir una porción de un pago repartido. Excluye el negocio `excluirId` si se
 * pasa (para no ofrecer el mismo dos veces en el armado del split).
 */
export async function buscarNegociosParaSplit(): Promise<{ negocios: NegocioParaSplit[]; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { negocios: [], error: ctx.error }
  const { filas } = await getPanelConciliacion()
  const negocios: NegocioParaSplit[] = filas
    .filter((f) => f.diferencia > 0)
    .map((f) => ({
      negocio_id: f.negocio_id,
      codigo: f.codigo,
      nombre: f.nombre,
      empresa: f.empresa,
      precio: f.precio,
      cobrado: f.cobrado,
      diferencia: f.diferencia,
    }))
  return { negocios }
}

// ── repartirPago ─────────────────────────────────────────────────────────────

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
 * Reparte UN pago entre VARIOS negocios sin duplicar el monto.
 *
 * Crea un cobro por cada porción, todos con el MISMO `external_ref` (la referencia
 * del pago) pero marcados como split deliberado en `cobros.split_json` con un
 * `split_id` compartido. Así:
 *   - El monto NO se duplica: cada negocio recibe solo su porción (la angustia de
 *     Diana — "que no se tome del discriminado, sino que se duplique" — queda
 *     resuelta).
 *   - F3 (buscarReferenciaDuplicada) reconoce el split_id y NO marca estos cobros
 *     como duplicado accidental de la referencia.
 *
 * Idempotencia: por (external_ref, negocio_id) — reintentar no duplica una porción.
 * Permisos: solo área financiera (Diana) vía ctxFinanciero.
 */
export async function repartirPago(
  input: RepartirPagoInput,
): Promise<{ success: true; split_id: string } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId } = ctx

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
  // Tolerancia de redondeo de 1 peso.
  if (sumaPorciones - montoTotal > 1) {
    return { success: false, error: 'La suma de las porciones excede el monto del pago' }
  }

  // Validar que todos los negocios son del workspace
  const { data: negociosRaw } = await db(supabase)
    .from('negocios')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('id', negocioIds)
  const validos = new Set(((negociosRaw ?? []) as Array<{ id: string }>).map((n) => n.id))
  for (const id of negocioIds) {
    if (!validos.has(id)) return { success: false, error: 'Un negocio del reparto no pertenece al workspace' }
  }

  const splitId = randomUUID()
  const tipoCobro = input.tipo_cobro ?? 'pago'
  const fecha = (input.fecha ?? '').trim() || todayBogotaISO()

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
      notas: `Reparto de pago ${referencia} entre ${porciones.length} negocios`,
      split_json: {
        split_id: splitId,
        split_total: montoTotal,
        split_n: porciones.length,
      },
    })
    if (insErr) {
      return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar una porción' }
    }
  }

  // Cualquier negocio tocado deja de estar conciliado (cambió su cobrado).
  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .in('negocio_id', negocioIds)

  for (const id of negocioIds) revalidatePath(`/negocios/${id}`)
  revalidatePath('/conciliacion')
  return { success: true, split_id: splitId }
}

// ── conciliarNegocio — el check de Diana ─────────────────────────────────────

/**
 * Setea (o quita) el check de conciliación de Diana para un negocio. El gate
 * `conciliacion_diana` exige conciliado=true Y diferencia=0; aquí solo grabamos el
 * check (la diferencia=0 la valida el gate en vivo). Para conciliar, exigimos
 * diferencia=0 también acá — no se puede dar el check con saldo pendiente o
 * sobrepago abierto.
 */
export async function conciliarNegocio(
  negocioId: string,
  conciliado: boolean,
  nota?: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  // Validar diferencia=0 al conciliar (no al des-conciliar)
  if (conciliado) {
    const [negRes, cobrosRes] = await Promise.all([
      db(supabase)
        .from('negocios')
        .select('precio_aprobado, precio_estimado')
        .eq('id', negocioId)
        .eq('workspace_id', workspaceId)
        .single(),
      db(supabase).from('cobros').select('monto').eq('negocio_id', negocioId).eq('workspace_id', workspaceId),
    ])
    const neg = negRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
    if (!neg) return { success: false, error: 'Negocio no encontrado' }
    const precio = neg.precio_aprobado ?? neg.precio_estimado ?? 0
    const cobrado = ((cobrosRes.data ?? []) as Array<{ monto: number }>).reduce((s, c) => s + (c.monto ?? 0), 0)
    const diferencia = precio - cobrado
    if (Math.abs(diferencia) > 1) {
      const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
      return {
        success: false,
        error: `No puedes conciliar con diferencia de ${fmt.format(diferencia)}. Reparte o ajusta el pago hasta que quede en $0.`,
      }
    }
  }

  // Upsert por negocio_id (unique)
  const { error: upErr } = await db(supabase)
    .from('negocio_conciliacion')
    .upsert(
      {
        workspace_id: workspaceId,
        negocio_id: negocioId,
        conciliado,
        conciliado_por: conciliado ? staffId : null,
        conciliado_at: conciliado ? new Date().toISOString() : null,
        nota: nota ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'negocio_id' },
    )
  if (upErr) return { success: false, error: (upErr as { message?: string }).message ?? 'No se pudo guardar la conciliación' }

  // Registrar en activity_log del negocio
  if (staffId) {
    try {
      await db(supabase).from('activity_log').insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'comentario',
        autor_id: staffId,
        contenido: conciliado
          ? `Pago conciliado por el área financiera.${nota ? ` ${nota.slice(0, 300)}` : ''}`
          : 'Conciliación revertida por el área financiera.',
      })
      // Al conciliar, Diana "atiende" cualquier etiqueta de solicitud pendiente:
      // marca 'conciliacion_atendida' → la RPC del badge y el panel dejan de contar
      // la solicitud del comercial para este negocio.
      if (conciliado) {
        await db(supabase).from('activity_log').insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: negocioId,
          tipo: 'conciliacion_atendida',
          autor_id: staffId,
          contenido: 'Solicitud de conciliación atendida.',
        })
      }
    } catch {
      /* no bloquear por el log */
    }
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return { success: true }
}

// ── solicitarConciliacionDiana — la etiqueta del comercial ───────────────────
//
// Un comercial (o cualquiera del equipo del workspace) marca un negocio como
// "necesita conciliación de Diana". MVP: se registra en activity_log con
// tipo 'solicitud_conciliacion'. Eso (a) suma al badge del nav vía la RPC
// count_negocios_por_conciliar y (b) aparece en el panel como "Solicitado por
// comercial". No requiere área financiera — la pide quien NO concilia.
//
// Diana limpia la etiqueta dando el check de conciliación (conciliarNegocio
// registra 'conciliacion_atendida', que cancela la solicitud en la RPC y el panel).
export async function solicitarConciliacionDiana(
  negocioId: string,
  nota?: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: error ?? 'No autenticado' }
  if (!staffId) return { success: false, error: 'Tu usuario no está vinculado al equipo del workspace' }

  // Validar que el negocio es del workspace (evita etiquetar negocios ajenos por URL)
  const { data: neg } = await db(supabase)
    .from('negocios')
    .select('id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!neg) return { success: false, error: 'Negocio no encontrado' }

  const { error: insErr } = await db(supabase).from('activity_log').insert({
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'solicitud_conciliacion',
    autor_id: staffId,
    contenido: `Se solicitó conciliación al área financiera.${nota ? ` ${nota.slice(0, 300)}` : ''}`,
  })
  if (insErr) {
    return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar la solicitud' }
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

/** Una referencia con sobrepago para la pestaña POR CONCILIAR. */
export interface SobrepagoRef {
  external_ref: string
  fuente: string | null
  /** Negocio de origen (donde se cargó el pago con sobrepago). */
  negocio_id: string
  negocio_codigo: string | null
  negocio_nombre: string | null
  precio_negocio: number
  valor_pagado: number
  /** Lo ya repartido a otros negocios + marcado por devolver (valor absoluto). */
  repartido: number
  /** Remanente sin asignar = valor_pagado - precio_negocio - repartido. */
  remanente: number
  conciliado: boolean
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
  split_json: { split_id?: string } | null
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
      }
    })
    const valorPagado = porciones.filter((p) => !p.por_devolver).reduce((s, p) => s + p.monto, 0)
    const negociosImplicados = Array.from(
      new Set(porciones.filter((p) => !p.por_devolver && p.negocio_id).map((p) => p.negocio_id as string)),
    )
    referencias.push({
      external_ref: ref,
      fuente,
      valor_pagado: valorPagado,
      es_split: esSplit,
      porciones,
      negocios_ids: negociosImplicados,
    })
  }

  // Pestaña 1: SOBREPAGOS + por devolver
  const sobrepagos: SobrepagoRef[] = []
  const porDevolver: RefPorcion[] = []
  for (const ref of referencias) {
    for (const p of ref.porciones) {
      if (p.por_devolver) porDevolver.push(p)
    }
  }
  for (const [negId, neg] of negocios) {
    if (neg.estado !== 'abierto') continue
    const cob = cobrado.get(negId) ?? 0
    if (cob > neg.precio + 1) {
      const refsDelNegocio = referencias
        .filter((r) => r.negocios_ids.includes(negId))
        .sort((a, b) => b.valor_pagado - a.valor_pagado)
      const refOwner = refsDelNegocio[0]
      const valorPagado = cob
      let repartido = 0
      if (refOwner) {
        for (const p of refOwner.porciones) {
          if (p.por_devolver) repartido += Math.abs(p.monto)
          else if (p.negocio_id && p.negocio_id !== negId) repartido += p.monto
        }
      }
      const remanente = valorPagado - neg.precio - repartido
      sobrepagos.push({
        external_ref: refOwner?.external_ref ?? '(sin referencia)',
        fuente: refOwner?.fuente ?? null,
        negocio_id: negId,
        negocio_codigo: neg.codigo,
        negocio_nombre: neg.nombre,
        precio_negocio: neg.precio,
        valor_pagado: valorPagado,
        repartido,
        remanente: Math.max(0, remanente),
        conciliado: conciliadoNegocio.get(negId) ?? false,
      })
    }
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

// ── agregarPago — panel base "Agregar pago" (entrada única) ──────────────────

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

export async function agregarPago(
  input: AgregarPagoInput,
): Promise<
  | { success: true }
  | { success: false; error: string; code?: 'epayco_no_aprobada' | 'referencia_duplicada'; negocio_existente?: { codigo: string | null } }
> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx
  return registrarPagoEnNegocio(supabase, workspaceId, staffId, input, 'conciliacion')
}

/**
 * Núcleo de registro de UN pago contra UN negocio. Fuente ÚNICA de la vía de pago:
 * la usan tanto `agregarPago` (panel de conciliación, guard financiera) como
 * `agregarPagoFab` (FAB global, guard por rol — `fab-pago-actions.ts`). NO duplicar
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

    const dup = await refDuplicadaNoSplit(supabase, workspaceId, String(refNum))
    if (dup) {
      const just = (input.justificacion ?? '').trim()
      if (!just) {
        return {
          success: false, code: 'referencia_duplicada', negocio_existente: { codigo: dup.codigo },
          error: `Esta referencia ePayco ya está registrada en ${dup.codigo ?? dup.negocio_id}. Justifica el registro para continuar.`,
        }
      }
      if (staffId) {
        try {
          await db(supabase).from('activity_log').insert({
            workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: negocioId,
            tipo: 'comentario', autor_id: staffId,
            contenido: `Referencia ePayco ${refNum} registrada pese a estar duplicada (ya en ${dup.codigo ?? dup.negocio_id}). Justificación: ${just.slice(0, 500)}`,
          })
        } catch { /* no bloquear */ }
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

// ── repartirSobrepago — reparto INLINE del remanente de una referencia ───────

export interface RepartirSobrepagoInput {
  external_ref: string
  negocio_origen_id: string
  porciones: PorcionSplit[]
  por_devolver?: number
}

export async function repartirSobrepago(
  input: RepartirSobrepagoInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const ref = (input.external_ref ?? '').trim()
  if (!ref) return { success: false, error: 'Referencia inválida' }

  const porciones = (input.porciones ?? []).filter((p) => p && p.negocio_id && Number(p.monto) > 0)
  const porDevolver = Math.max(0, Number(input.por_devolver ?? 0) || 0)
  if (porciones.length === 0 && porDevolver <= 0) {
    return { success: false, error: 'Asigna al menos una porción o un monto por devolver' }
  }
  if (porciones.some((p) => p.negocio_id === input.negocio_origen_id)) {
    return { success: false, error: 'El remanente va a OTROS negocios, no al de origen' }
  }
  if (new Set(porciones.map((p) => p.negocio_id)).size !== porciones.length) {
    return { success: false, error: 'No repitas el mismo negocio en el reparto' }
  }

  const { data: existSplit } = await db(supabase)
    .from('cobros').select('split_json')
    .eq('workspace_id', workspaceId).eq('external_ref', ref)
    .not('split_json', 'is', null).limit(1).maybeSingle()
  const splitId = (existSplit as { split_json: { split_id?: string } | null } | null)?.split_json?.split_id ?? randomUUID()

  const { data: origenCobro } = await db(supabase)
    .from('cobros').select('id, monto, split_json')
    .eq('workspace_id', workspaceId).eq('negocio_id', input.negocio_origen_id).eq('external_ref', ref)
    .limit(1).maybeSingle()
  const origen = origenCobro as { id: string; monto: number; split_json: Record<string, unknown> | null } | null
  if (origen && !origen.split_json?.split_id) {
    await db(supabase).from('cobros')
      .update({ split_json: { ...(origen.split_json ?? {}), split_id: splitId } })
      .eq('id', origen.id)
  }

  const destinoIds = porciones.map((p) => p.negocio_id)
  if (destinoIds.length > 0) {
    const { data: vRaw } = await db(supabase).from('negocios').select('id').eq('workspace_id', workspaceId).in('id', destinoIds)
    const validos = new Set(((vRaw ?? []) as Array<{ id: string }>).map((n) => n.id))
    for (const id of destinoIds) if (!validos.has(id)) return { success: false, error: 'Un negocio del reparto no pertenece al workspace' }
  }

  const fecha = todayBogotaISO()

  for (const p of porciones) {
    const { data: ex } = await db(supabase)
      .from('cobros').select('id')
      .eq('workspace_id', workspaceId).eq('negocio_id', p.negocio_id).eq('external_ref', ref).limit(1)
    if (ex && (ex as unknown[]).length > 0) continue
    const { error: insErr } = await db(supabase).from('cobros').insert({
      workspace_id: workspaceId, negocio_id: p.negocio_id, monto: Number(p.monto),
      tipo_cobro: 'pago', fecha, external_ref: ref, notas: `Reparto del sobrepago de ${ref}`,
      split_json: { split_id: splitId, por_reparto: true },
    })
    if (insErr) return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar una porción' }
  }

  if (porDevolver > 0) {
    const { data: exDev } = await db(supabase)
      .from('cobros').select('id')
      .eq('workspace_id', workspaceId).eq('negocio_id', input.negocio_origen_id)
      .eq('external_ref', ref).eq('tipo_cobro', 'devolucion_pendiente').limit(1)
    if (!exDev || (exDev as unknown[]).length === 0) {
      const { error: insErr } = await db(supabase).from('cobros').insert({
        workspace_id: workspaceId, negocio_id: input.negocio_origen_id, monto: -porDevolver,
        tipo_cobro: 'devolucion_pendiente', fecha, external_ref: ref,
        notas: `Por devolver al cliente — sobrepago de ${ref}`,
        split_json: { split_id: splitId, por_devolver: true },
      })
      if (insErr) return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo marcar la devolución' }
    }
  }

  const tocados = [input.negocio_origen_id, ...destinoIds]
  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId).in('negocio_id', tocados)

  if (staffId) {
    try {
      await db(supabase).from('activity_log').insert({
        workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: input.negocio_origen_id,
        tipo: 'comentario', autor_id: staffId,
        contenido: `Sobrepago de ${ref} repartido${porDevolver > 0 ? ` (${fmtCOP(porDevolver)} por devolver al cliente)` : ''}.`,
      })
    } catch { /* no bloquear */ }
  }

  for (const id of tocados) revalidatePath(`/negocios/${id}`)
  revalidatePath('/conciliacion')
  return { success: true }
}

// ── conciliarReferencia — Conciliar cuando el saldo de la referencia es $0 ────

/**
 * Concilia el negocio de ORIGEN de un sobrepago cuando su saldo quedó en $0 (todo el
 * remanente fue repartido y/o marcado por devolver). Reusa conciliarNegocio (que ya
 * valida diferencia=0 + escribe negocio_conciliacion + activity_log).
 */
export async function conciliarReferencia(
  negocioOrigenId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  return conciliarNegocio(negocioOrigenId, true, 'Referencia conciliada desde el panel de conciliación.')
}

// ── aceptarDuplicado — resuelve una referencia duplicada ─────────────────────

export async function aceptarDuplicado(
  externalRef: string,
): Promise<{ success: true; desvinculados: number } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const ref = (externalRef ?? '').trim()
  if (!ref) return { success: false, error: 'Referencia inválida' }

  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, monto, fuente, split_json, negocios:negocio_id ( codigo, estado, etapa_actual_id, etapas_negocio:etapa_actual_id ( orden ) )')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', ref)
    .not('negocio_id', 'is', null)

  const cobros = ((cobrosRaw ?? []) as Array<{
    id: string; negocio_id: string; monto: number; fuente: string | null
    split_json: { split_id?: string } | null
    negocios: { codigo: string | null; estado: string | null; etapas_negocio: { orden: number | null } | null } | null
  }>).filter((c) => !c.split_json?.split_id && c.negocios?.estado === 'abierto')

  if (cobros.length <= 1) return { success: false, error: 'Esta referencia ya no está duplicada' }

  const maxOrden = Math.max(...cobros.map((c) => c.negocios?.etapas_negocio?.orden ?? -1))
  const enMax = cobros.filter((c) => (c.negocios?.etapas_negocio?.orden ?? -1) === maxOrden)

  let aDesvincular: typeof cobros
  let notificarTodos = false
  if (enMax.length === 1) {
    const ganador = enMax[0].id
    aDesvincular = cobros.filter((c) => c.id !== ganador)
  } else {
    aDesvincular = cobros
    notificarTodos = true
  }

  const monto = cobros[0]?.monto ?? 0
  const fuente = cobros[0]?.fuente ?? null

  for (const c of aDesvincular) {
    await db(supabase).from('cobros').delete().eq('id', c.id)
    if (staffId) {
      try {
        await db(supabase).from('activity_log').insert({
          workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: c.negocio_id,
          tipo: 'solicitud_conciliacion', autor_id: staffId,
          contenido: notificarTodos
            ? `Referencia ${ref} (${fuente ?? 'pago'}, ${fmtCOP(monto)}) estaba duplicada y empatada en etapa — se desvinculó de este negocio. Reasigna el pago al negocio correcto.`
            : `Referencia ${ref} estaba duplicada — se dejó en el negocio en etapa más avanzada y se desvinculó de este. Verifica el pago.`,
        })
      } catch { /* no bloquear */ }
    }
    revalidatePath(`/negocios/${c.negocio_id}`)
  }

  const tocados = aDesvincular.map((c) => c.negocio_id)
  if (tocados.length > 0) {
    await db(supabase)
      .from('negocio_conciliacion')
      .update({ conciliado: false, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).in('negocio_id', tocados)
  }

  revalidatePath('/conciliacion')
  return { success: true, desvinculados: aDesvincular.length }
}
