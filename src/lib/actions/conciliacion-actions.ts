'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { canEditBloque, type UserContext, type Role, type Area } from '@/lib/permissions/can-edit'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { randomUUID } from 'crypto'

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
