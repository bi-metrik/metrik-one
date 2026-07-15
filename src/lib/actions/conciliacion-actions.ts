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
  saldoEsperadoPorModalidad as saldoEsperadoPuro,
  type ModeloDinero,
} from '@/lib/upme/modelo-dinero'
import {
  componerDosBolsas,
  tienePlataPorLiquidar,
  sugerirDestinoPasante,
  TIPO_PENALIDAD,
  type CobroLiquidacion,
  type DosBolsas,
} from '@/lib/upme/liquidacion-cancelados'

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
  /**
   * Saldo ESPERADO según la modalidad del negocio. En 50/50 (plan 1), mientras no
   * llegue el 2º pago, se espera un saldo = 50% del honorario (NO es descuadre). En
   * único (plan 2) o sin modalidad, saldo_esperado = 0. Deriva de la propuesta.
   */
  saldo_esperado: number
  /**
   * Descuadre REAL = diferencia − saldo_esperado. 0 = todo cuadra (incluido el
   * pendiente esperado de 50/50). ≠0 = requiere atención (sobrepago o faltante real).
   * El panel debe interpretar ESTE valor, no `diferencia`, para no marcar en falso
   * el 50% pendiente esperado de un negocio 50/50.
   */
  descuadre: number
  modalidad: 1 | 2 | null // 1 = 50/50, 2 = único, null = sin propuesta con modalidad
  /** Referencias ePayco/externas ya registradas en el negocio (para la columna Referencia). */
  referencias: string[]
  conciliado: boolean
  conciliado_at: string | null
  /** Un comercial pidió conciliación de Diana (etiqueta pendiente en activity_log). */
  solicitado: boolean
}

/**
 * Saldo esperado (pendiente legítimo) según la modalidad. En 50/50 el 2º 50% del
 * honorario está pendiente por diseño hasta el pago de éxito → ese saldo NO es
 * descuadre. La tarifa (pasante) va completa por adelantado, así que no cuenta
 * como pendiente esperado. Pura (no exportada: este archivo es 'use server').
 */
function saldoEsperadoPorModalidad(modelo: ModeloDineroNegocio | null): number {
  return saldoEsperadoPuro(modelo as ModeloDinero | null)
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

  // Modelo de dinero (tarifa + modalidad) por negocio, leído de sus bloques
  // propuesta_economica aprobados. Sirve para el saldo ESPERADO por modalidad
  // (50/50 → el 2º 50% del honorario es pendiente legítimo, no descuadre).
  const { data: propuestasRaw } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id, data, bloque_configs!inner(bloque_definitions!inner(tipo))')
    .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica')
    .in('negocio_id', ids)
  const modeloPorNegocio = new Map<string, ModeloDineroNegocio>()
  for (const p of ((propuestasRaw ?? []) as Array<{ negocio_id: string; data: Record<string, unknown> | null }>)) {
    const d = p.data
    if (!d) continue
    const plan = (d.aprobado_plan === 1 || d.aprobado_plan === 2) ? (d.aprobado_plan as 1 | 2) : null
    const tarifa = Number(d.aprobado_tarifa_upme ?? d.tarifa_upme ?? 0)
    const honorario = d.aprobado_honorario != null ? Number(d.aprobado_honorario) : null
    // Guardar aun sin tarifa: la modalidad importa para el saldo esperado.
    if (plan == null && !(tarifa > 0)) continue
    modeloPorNegocio.set(p.negocio_id, {
      tarifa_upme: Number.isFinite(tarifa) ? tarifa : 0,
      aprobado_plan: plan,
      aprobado_honorario: honorario,
    })
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
    const modelo = modeloPorNegocio.get(n.id) ?? null
    const diferencia = precio - cobrado
    const saldoEsperado = saldoEsperadoPorModalidad(modelo)
    return {
      negocio_id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      empresa: n.empresas?.nombre ?? null,
      etapa_nombre: n.etapas_negocio?.nombre ?? null,
      precio,
      cobrado,
      diferencia,
      saldo_esperado: saldoEsperado,
      // Descuadre real = lo que falta MÁS ALLÁ de lo esperado por modalidad.
      descuadre: diferencia - saldoEsperado,
      modalidad: modelo?.aprobado_plan ?? null,
      referencias: Array.from(refsPorNegocio.get(n.id) ?? []),
      conciliado: conc?.conciliado ?? false,
      conciliado_at: conc?.conciliado_at ?? null,
      solicitado: solicitadoPorNegocio.has(n.id),
    }
  })

  // Acotar a lo que está en la cancha de Diana: negocio en Cobro (escalado), o
  // etiquetado por un comercial, o con sobrepago REAL (descuadre < 0), o ya
  // conciliado (historial). El pipeline temprano con pendiente esperado (50% de
  // 50/50, o saldo por cobrar sin estar en Cobro) NO es "por conciliar" de Diana.
  // Usamos `descuadre` (no `diferencia`) para no marcar en falso el 50% esperado.
  const filasRelevantes = filas.filter(
    (f) =>
      stagePorNegocio.get(f.negocio_id) === 'cobro' ||
      f.solicitado ||
      f.descuadre < 0 ||
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
 * Reparte UN pago entre VARIOS negocios (vía de la FINANCIERA). Wrapper de
 * `repartirPagoCore` con guard financiera + `origen='financiera'`.
 * Permisos: solo área financiera (Diana) vía ctxFinanciero.
 */
export async function repartirPago(
  input: RepartirPagoInput,
): Promise<{ success: true; split_id: string } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  return repartirPagoCore(ctx.supabase, ctx.workspaceId, ctx.staffId, input, 'financiera')
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
  // Regla 2 — negocios cancelados/perdidos con plata por liquidar (SOENA opt-in).
  canceladosPorLiquidar: CanceladoPorLiquidar[]
  // Pestaña 5 — métricas
  metricas: {
    referencias_cargadas: number
    por_conciliar: number
    en_saldo: number
    duplicados: number
    conciliados: number
    cancelados_por_liquidar: number
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

  // Regla 2: negocios cancelados/perdidos con plata por liquidar (SOENA opt-in).
  const { filas: canceladosPorLiquidar } = await getCanceladosPorLiquidar()

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
      canceladosPorLiquidar,
      metricas: {
        referencias_cargadas: referencias.length,
        por_conciliar: sobrepagos.filter((s) => !s.conciliado).length,
        en_saldo: saldos.length,
        duplicados: duplicados.length,
        conciliados: conciliadosList.length,
        cancelados_por_liquidar: canceladosPorLiquidar.length,
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

export interface CrearCobrosSoenaInput {
  negocio_id: string
  referencia: string
  monto: number
  fuente?: string          // 'epayco' | 'davivienda' | texto libre (default 'epayco')
  fecha?: string
}

/**
 * Reparte UN pago de un negocio SOENA con tarifa en DOS cobros con `split_id`
 * compartido dentro del MISMO negocio:
 *   - Pasante: tipo_cobro='pasante', monto = min(pago, tarifa_upme) — la tarifa se
 *     cubre PRIMERO (recaudo a favor de terceros, se excluye del ingreso).
 *   - Honorario: monto = pago − monto_pasante. tipo_cobro según la modalidad
 *     (anticipo en 50/50, saldo/pago en único).
 *
 * SIN BARRERAS: si el pago no calza exacto con el anticipo esperado, NO se rechaza;
 * se parte lo que entró y la diferencia la maneja la conciliación (consistente con
 * "nada bloquea"). Idempotente por (external_ref, negocio_id, tipo_cobro) dentro del
 * split. OPT-IN: solo actúa si el negocio tiene propuesta aprobada con tarifa.
 *
 * Devuelve `applied:false` cuando el negocio no tiene tarifa (el caller debe usar el
 * flujo de un solo cobro).
 */
export async function crearCobrosDesdePagoSoena(
  input: CrearCobrosSoenaInput,
): Promise<
  | { success: true; applied: true; split_id: string; monto_pasante: number; monto_honorario: number }
  | { success: true; applied: false }
  | { success: false; error: string }
> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId } = ctx

  const negocioId = input.negocio_id
  if (!negocioId) return { success: false, error: 'Elige el negocio al que se asigna el pago' }
  const referencia = (input.referencia ?? '').trim()
  if (!referencia) return { success: false, error: 'La referencia del pago es obligatoria' }
  const monto = Number(input.monto)
  if (!Number.isFinite(monto) || monto <= 0) return { success: false, error: 'El monto debe ser mayor a cero' }

  const { data: neg } = await db(supabase)
    .from('negocios').select('id').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle()
  if (!neg) return { success: false, error: 'Negocio no encontrado' }

  const modelo = await leerModeloDineroNegocio(supabase, negocioId)
  if (!modelo) return { success: true, applied: false }

  return crearCobrosSoenaCore(supabase, workspaceId, negocioId, referencia, monto, modelo, input)
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

// ── setPorcionReferencia — asignar/editar/quitar la porción de un negocio ─────

export interface SetPorcionInput {
  external_ref: string
  /** Negocio cuya porción del pago se fija (origen o destino). */
  negocio_id: string
  /** Monto del pago a dejar en ese negocio. 0 = quitar (si no es el origen). */
  monto: number
}

/**
 * Fija cuánto del pago de una referencia queda cargado a un negocio. Modelo de
 * TRANSFERENCIA editable, sin duplicar el dinero:
 *
 *   - La primera acción "materializa" el sobrepago: persiste el valor total del pago
 *     (`split_json.ref_total`) en el cobro de origen y baja ese cobro al precio del
 *     negocio de origen, liberando el excedente como remanente.
 *   - Asignar a un negocio destino crea/ajusta su cobro (mismo `external_ref` +
 *     `split_id`, marcado `por_reparto`). Editar el origen ajusta su propio cobro.
 *   - Nunca deja asignar más que el valor pagado: la suma de porciones ≤ ref_total.
 *
 * Permisos: solo área financiera (Diana) vía ctxFinanciero.
 */
export async function setPorcionReferencia(
  input: SetPorcionInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId } = ctx

  const ref = (input.external_ref ?? '').trim()
  if (!ref) return { success: false, error: 'Referencia inválida' }
  const target = input.negocio_id
  if (!target) return { success: false, error: 'Elige el negocio' }
  const monto = Math.round(Number(input.monto) || 0)
  if (monto < 0) return { success: false, error: 'El monto no puede ser negativo' }

  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, monto, tipo_cobro, split_json, negocios:negocio_id ( precio_aprobado, precio_estimado )')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', ref)
  const all = (cobrosRaw ?? []) as Array<{
    id: string; negocio_id: string | null; monto: number; tipo_cobro: string | null
    split_json: { split_id?: string; por_reparto?: boolean; ref_total?: number } | null
    negocios: { precio_aprobado: number | null; precio_estimado: number | null } | null
  }>
  const rows = all.filter((c) => c.tipo_cobro !== 'devolucion_pendiente')
  if (rows.length === 0) return { success: false, error: 'No hay un pago con esa referencia' }

  // Origen = cobro NO reparto (el pago original). Si hay varios, el de mayor monto.
  const origen = rows.filter((c) => c.split_json?.por_reparto !== true).sort((a, b) => b.monto - a.monto)[0]
  if (!origen?.negocio_id) return { success: false, error: 'No se pudo identificar el negocio de origen del pago' }
  const precioOrigen = origen.negocios?.precio_aprobado ?? origen.negocios?.precio_estimado ?? 0

  const splitId =
    origen.split_json?.split_id ??
    rows.find((c) => c.split_json?.split_id)?.split_json?.split_id ??
    randomUUID()
  const materializado = origen.split_json?.ref_total != null
  const refTotal = materializado ? (origen.split_json!.ref_total as number) : origen.monto

  // Materializar en la primera acción: fija ref_total y baja el origen a su precio.
  if (!materializado) {
    const nuevoMontoOrigen = Math.min(precioOrigen, refTotal)
    await db(supabase).from('cobros')
      .update({ monto: nuevoMontoOrigen, split_json: { ...(origen.split_json ?? {}), split_id: splitId, ref_total: refTotal } })
      .eq('id', origen.id)
    origen.monto = nuevoMontoOrigen
  }

  // Por devolver de la referencia (cobros negativos en el origen).
  const devuelto = all
    .filter((c) => c.tipo_cobro === 'devolucion_pendiente')
    .reduce((s, c) => s + Math.abs(c.monto), 0)

  // Tope: lo que ya está en otros negocios + lo por devolver no puede superar el pago.
  const sumOtros = rows.filter((c) => c.negocio_id !== target).reduce((s, c) => s + c.monto, 0)
  const maxTarget = refTotal - sumOtros - devuelto
  if (monto > maxTarget + 1) {
    return { success: false, error: `No puedes asignar más que el remanente disponible (${fmtCOP(Math.max(0, maxTarget))}).` }
  }

  const esOrigen = target === origen.negocio_id
  const existing = rows.find((c) => c.negocio_id === target)

  if (esOrigen) {
    await db(supabase).from('cobros').update({ monto: Math.max(0, monto) }).eq('id', origen.id)
  } else if (existing) {
    if (monto <= 0) {
      await db(supabase).from('cobros').delete().eq('id', existing.id)
    } else {
      await db(supabase).from('cobros')
        .update({ monto, split_json: { ...(existing.split_json ?? {}), split_id: splitId, por_reparto: true, ref_total: refTotal } })
        .eq('id', existing.id)
    }
  } else if (monto > 0) {
    const { data: negOk } = await db(supabase)
      .from('negocios').select('id').eq('id', target).eq('workspace_id', workspaceId).maybeSingle()
    if (!negOk) return { success: false, error: 'El negocio no pertenece al workspace' }
    const { error: insErr } = await db(supabase).from('cobros').insert({
      workspace_id: workspaceId, negocio_id: target, monto,
      tipo_cobro: 'pago', fecha: todayBogotaISO(), external_ref: ref,
      split_json: { split_id: splitId, por_reparto: true, ref_total: refTotal },
      notas: `Asignación del pago ${ref}`,
    })
    if (insErr) return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo asignar el pago' }
  }

  const tocados = Array.from(new Set([origen.negocio_id, target].filter(Boolean))) as string[]
  await db(supabase).from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId).in('negocio_id', tocados)

  for (const id of tocados) revalidatePath(`/negocios/${id}`)
  revalidatePath('/conciliacion')
  return { success: true }
}

// ── conciliarReferencia — Conciliar cuando el remanente de la referencia es $0 ─

/**
 * Concilia una referencia cuando todo su pago quedó repartido (remanente = $0).
 * Valida sobre la REFERENCIA (no sobre la diferencia del negocio de origen, que
 * puede quedar con saldo cuando el pago fue un anticipo parcial). Marca el check
 * de conciliación en el negocio de origen → la referencia sale de "Por conciliar".
 */
export async function conciliarReferencia(
  externalRef: string,
  negocioOrigenId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const ref = (externalRef ?? '').trim()
  if (!ref) return { success: false, error: 'Referencia inválida' }

  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, monto, tipo_cobro, split_json, negocios:negocio_id ( precio_aprobado, precio_estimado )')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', ref)
  const all = (cobrosRaw ?? []) as Array<{
    negocio_id: string | null; monto: number; tipo_cobro: string | null
    split_json: { por_reparto?: boolean; ref_total?: number } | null
  }>
  const pos = all.filter((c) => c.tipo_cobro !== 'devolucion_pendiente')
  if (pos.length === 0) return { success: false, error: 'No hay un pago con esa referencia' }

  const origen = pos.filter((c) => c.split_json?.por_reparto !== true).sort((a, b) => b.monto - a.monto)[0]
  const refTotal = origen?.split_json?.ref_total ?? origen?.monto ?? 0
  const asignado = pos.reduce((s, c) => s + c.monto, 0)
  const devuelto = all.filter((c) => c.tipo_cobro === 'devolucion_pendiente').reduce((s, c) => s + Math.abs(c.monto), 0)
  const remanente = refTotal - asignado - devuelto
  if (remanente > 1) {
    return { success: false, error: `Asigna todo el pago antes de conciliar — faltan ${fmtCOP(remanente)} por repartir.` }
  }

  await db(supabase).from('negocio_conciliacion').upsert(
    {
      workspace_id: workspaceId, negocio_id: negocioOrigenId, conciliado: true,
      conciliado_por: staffId, conciliado_at: new Date().toISOString(),
      nota: `Referencia ${ref} conciliada (pago repartido).`, updated_at: new Date().toISOString(),
    },
    { onConflict: 'negocio_id' },
  )

  if (staffId) {
    try {
      await db(supabase).from('activity_log').insert({
        workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: negocioOrigenId,
        tipo: 'comentario', autor_id: staffId,
        contenido: `Referencia ${ref} conciliada por el área financiera (${fmtCOP(refTotal)} repartidos).`,
      })
    } catch { /* no bloquear */ }
  }

  revalidatePath(`/negocios/${negocioOrigenId}`)
  revalidatePath('/conciliacion')
  return { success: true }
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

// ═══════════════════════════════════════════════════════════════════════════════
// REGLA 2 SOENA — liquidación de negocios CANCELADOS con plata recibida
// ═══════════════════════════════════════════════════════════════════════════════
//
// Cuando un negocio SOENA se CANCELA/PIERDE con dinero ya recaudado, esa plata sube
// al panel de conciliación para que el área financiera (Diana) la liquide CASO A CASO.
// El sistema SURTE (lista los cancelados con plata + desglose de las dos bolsas),
// REGISTRA y APLICA la acción que elija financiera; NO auto-decide devolución vs
// penalidad (esa regla depende del contrato SOENA↔cliente).
//
// La lógica pura de las dos bolsas vive en `@/lib/upme/liquidacion-cancelados` (testable
// sin DB). Aquí va solo la parte que toca DB: detección, proxy de desembolso del pasante,
// y las acciones de financiera (reusando cobros negativos `devolucion_pendiente` + el
// nuevo `penalidad`, todo en activity_log).
//
// OPT-IN: solo negocios del workspace cuyo módulo `conciliacion` está activo (SOENA).
// El gate del panel (`page.tsx`) ya exige `modules.conciliacion`; aquí, además, cada
// action re-valida el área financiera vía ctxFinanciero.

/** Fila del panel "Cancelados por liquidar": un negocio cancelado con plata recibida. */
export interface CanceladoPorLiquidar {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
  /** 'cancelado' | 'perdido' — el motivo de cierre. */
  estado: string | null
  cierre_motivo: string | null
  razon_cierre: string | null
  /** Las dos bolsas (honorario recaudado-no-reconocido + pasante en custodia). */
  bolsas: DosBolsas
  /**
   * ¿El pasante ya se desembolsó a la UPME? Proxy DB-derivable: el negocio alcanzó
   * (históricamente) la etapa "Pago UPME" (stage=cobro más temprana de su línea) o una
   * posterior. Es una SUGERENCIA — financiera confirma la acción.
   */
  pasante_desembolsado: boolean
  /** Sugerencia del sistema para el pasante ('devolver' | 'cerrar_contra_desembolso'). */
  sugerencia_pasante: 'devolver' | 'cerrar_contra_desembolso'
  /** ¿Ya se resolvió el pasante (devuelto o cerrado contra desembolso)? */
  pasante_resuelto: boolean
}

/**
 * Deriva, para un conjunto de negocios, si históricamente alcanzaron la etapa
 * "Pago UPME" (o posterior) — proxy de que la tarifa YA se desembolsó a la UPME.
 *
 * "Pago UPME" = la etapa `stage='cobro'` de MENOR orden en la línea del negocio (la
 * temprana, desembolso a UPME; la otra cobro-stage es la conciliación tardía con el
 * cliente — ver decisión SOENA 2026-07-08). Como el cierre sobreescribió
 * `etapa_actual_id`, la etapa MÁXIMA alcanzada se reconstruye de `activity_log`
 * (tipo='cambio_etapa', valor_nuevo/valor_anterior = ids de etapa).
 *
 * Devuelve un Set con los negocio_id que SÍ pasaron el gate del comprobante.
 */
async function negociosConPasanteDesembolsado(
  supabase: unknown,
  workspaceId: string,
  negocios: Array<{ id: string; linea_id: string | null; etapa_actual_id: string | null }>,
): Promise<Set<string>> {
  const desembolsados = new Set<string>()
  if (negocios.length === 0) return desembolsados

  // 1. orden de "Pago UPME" por línea = MIN(orden) de etapas stage='cobro'.
  const lineaIds = Array.from(new Set(negocios.map((n) => n.linea_id).filter((x): x is string => !!x)))
  if (lineaIds.length === 0) return desembolsados
  const { data: etapasRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('id, linea_id, orden, stage')
    .in('linea_id', lineaIds)
  const etapas = (etapasRaw ?? []) as Array<{ id: string; linea_id: string; orden: number | null; stage: string | null }>

  // orden de la etapa "Pago UPME" por línea
  const ordenPagoUpmePorLinea = new Map<string, number>()
  // orden por etapa_id (para mapear los ids del activity_log a un orden)
  const ordenPorEtapaId = new Map<string, { linea_id: string; orden: number }>()
  for (const e of etapas) {
    if (e.orden == null) continue
    ordenPorEtapaId.set(e.id, { linea_id: e.linea_id, orden: e.orden })
    if (e.stage === 'cobro') {
      const prev = ordenPagoUpmePorLinea.get(e.linea_id)
      if (prev == null || e.orden < prev) ordenPagoUpmePorLinea.set(e.linea_id, e.orden)
    }
  }

  // 2. Máximo orden alcanzado por negocio, de activity_log (cambio_etapa).
  const negocioIds = negocios.map((n) => n.id)
  const { data: logRaw } = await db(supabase)
    .from('activity_log')
    .select('entidad_id, valor_anterior, valor_nuevo')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', 'negocio')
    .eq('tipo', 'cambio_etapa')
    .in('entidad_id', negocioIds)
  const maxOrdenPorNegocio = new Map<string, number>()
  const acumularOrden = (negId: string, etapaId: string | null | undefined) => {
    if (!etapaId) return
    const info = ordenPorEtapaId.get(etapaId)
    if (!info) return
    const prev = maxOrdenPorNegocio.get(negId) ?? -Infinity
    if (info.orden > prev) maxOrdenPorNegocio.set(negId, info.orden)
  }
  for (const row of ((logRaw ?? []) as Array<{ entidad_id: string; valor_anterior: string | null; valor_nuevo: string | null }>)) {
    acumularOrden(row.entidad_id, row.valor_anterior)
    acumularOrden(row.entidad_id, row.valor_nuevo)
  }
  // Fallback: la etapa_actual (aunque sea la de cierre) también aporta orden alcanzado.
  for (const n of negocios) acumularOrden(n.id, n.etapa_actual_id)

  // 3. Desembolsado si el máximo orden alcanzado >= orden de "Pago UPME" de su línea.
  for (const n of negocios) {
    if (!n.linea_id) continue
    const ordenUpme = ordenPagoUpmePorLinea.get(n.linea_id)
    if (ordenUpme == null) continue // línea sin etapa Pago UPME → no se puede afirmar
    const maxOrden = maxOrdenPorNegocio.get(n.id)
    if (maxOrden != null && maxOrden >= ordenUpme) desembolsados.add(n.id)
  }
  return desembolsados
}

/**
 * Lista los negocios CANCELADOS/PERDIDOS del workspace que aún tienen plata por
 * liquidar (honorario recaudado-no-reconocido y/o pasante en custodia sin resolver),
 * con el desglose de las dos bolsas y la sugerencia de destino del pasante.
 *
 * Detección: `estado IN ('cancelado','perdido')`. (`perdido` normalmente tiene 0 cobros
 * porque `cerrarNegocioPerdido` lo exige, pero se incluye por defensa: si por vía legacy
 * un perdido tuviera plata, también debe liquidarse.) Solo entran los que `tienePlataPorLiquidar`.
 */
export async function getCanceladosPorLiquidar(): Promise<{
  filas: CanceladoPorLiquidar[]
  error?: string
}> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { filas: [], error: ctx.error }
  const { supabase, workspaceId } = ctx

  const { data: negociosRaw } = await db(supabase)
    .from('negocios')
    .select(`
      id, codigo, nombre, estado, cierre_motivo, razon_cierre, linea_id, etapa_actual_id,
      empresas:empresa_id ( nombre )
    `)
    .eq('workspace_id', workspaceId)
    .in('estado', ['cancelado', 'perdido'])

  const negocios = (negociosRaw ?? []) as Array<{
    id: string
    codigo: string | null
    nombre: string | null
    estado: string | null
    cierre_motivo: string | null
    razon_cierre: string | null
    linea_id: string | null
    etapa_actual_id: string | null
    empresas: { nombre: string | null } | null
  }>
  if (negocios.length === 0) return { filas: [] }

  const ids = negocios.map((n) => n.id)
  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, monto, tipo_cobro')
    .eq('workspace_id', workspaceId)
    .in('negocio_id', ids)
  const cobrosPorNegocio = new Map<string, CobroLiquidacion[]>()
  for (const c of ((cobrosRaw ?? []) as Array<{ id: string; negocio_id: string; monto: number; tipo_cobro: string | null }>)) {
    if (!cobrosPorNegocio.has(c.negocio_id)) cobrosPorNegocio.set(c.negocio_id, [])
    cobrosPorNegocio.get(c.negocio_id)!.push({ id: c.id, monto: c.monto, tipo_cobro: c.tipo_cobro })
  }

  const desembolsados = await negociosConPasanteDesembolsado(supabase, workspaceId, negocios)

  // Negocios cuyo pasante ya se resolvió: dejan una etiqueta en activity_log al aplicar
  // la acción ('pasante_cerrado_desembolso' o 'pasante_devuelto' en valor_nuevo).
  const { data: pasanteTagRaw } = await db(supabase)
    .from('activity_log')
    .select('entidad_id, valor_nuevo')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', 'negocio')
    .in('entidad_id', ids)
    .in('valor_nuevo', ['pasante_cerrado_desembolso', 'pasante_devuelto'])
  const pasanteResueltoPorTag = new Set(
    ((pasanteTagRaw ?? []) as Array<{ entidad_id: string }>).map((r) => r.entidad_id),
  )

  const filas: CanceladoPorLiquidar[] = []
  for (const n of negocios) {
    const cobros = cobrosPorNegocio.get(n.id) ?? []
    const bolsas = componerDosBolsas(cobros)
    const pasanteDesembolsado = desembolsados.has(n.id)
    // El pasante se considera RESUELTO si no hay pasante en custodia, o si ya se aplicó
    // una acción de pasante (cerrado contra desembolso / devuelto) marcada en activity_log.
    const pasanteResuelto =
      bolsas.pasante_recaudado === 0 || pasanteResueltoPorTag.has(n.id)
    if (!tienePlataPorLiquidar(bolsas, pasanteResuelto)) continue
    filas.push({
      negocio_id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      empresa: n.empresas?.nombre ?? null,
      estado: n.estado,
      cierre_motivo: n.cierre_motivo,
      razon_cierre: n.razon_cierre,
      bolsas,
      pasante_desembolsado: pasanteDesembolsado,
      sugerencia_pasante: sugerirDestinoPasante(pasanteDesembolsado),
      pasante_resuelto: pasanteResuelto,
    })
  }

  filas.sort((a, b) => (a.codigo ?? '').localeCompare(b.codigo ?? ''))
  return { filas }
}

// ── Acciones de financiera sobre un cancelado ─────────────────────────────────

export interface LiquidarHonorarioInput {
  negocio_id: string
  /** Monto a DEVOLVER al cliente (cobro negativo `devolucion_pendiente`). 0 = nada. */
  devolver: number
  /** Monto a RETENER como penalidad (cobro `penalidad`, categoría propia). 0 = nada. */
  penalidad: number
  /** Motivo obligatorio (queda en activity_log + notas del cobro). */
  motivo: string
}

/**
 * Aplica la decisión de financiera sobre el HONORARIO recaudado-no-reconocido de un
 * negocio cancelado: devolver (total/parcial), retener como penalidad, o mixto.
 *
 *   - `devolver` → cobro NEGATIVO `tipo_cobro='devolucion_pendiente'` (patrón existente).
 *     Asiento: DB Anticipos de clientes / CR Caja.
 *   - `penalidad` → cobro `tipo_cobro='penalidad'` (categoría PROPIA, NO ingreso por
 *     servicios). 🔴 El tratamiento fiscal (renta/IVA/nota) lo escala Felipe — aquí solo
 *     se deja el registro claro y marcado.
 *
 * NO auto-decide: financiera elige los montos. La suma devolver+penalidad no puede
 * exceder el honorario pendiente por liquidar. Idempotencia suave: no re-inserta si la
 * misma ref sintética ya existe.
 */
export async function liquidarHonorarioCancelado(
  input: LiquidarHonorarioInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const negocioId = input.negocio_id
  if (!negocioId) return { success: false, error: 'Elige el negocio' }
  const devolver = Math.max(0, Math.round(Number(input.devolver) || 0))
  const penalidad = Math.max(0, Math.round(Number(input.penalidad) || 0))
  const motivo = (input.motivo ?? '').trim()
  if (devolver <= 0 && penalidad <= 0) {
    return { success: false, error: 'Indica un monto a devolver y/o a retener como penalidad' }
  }
  if (!motivo) return { success: false, error: 'El motivo es obligatorio' }

  // Negocio del workspace y cancelado/perdido.
  const { data: neg } = await db(supabase)
    .from('negocios').select('id, estado').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle()
  const negocio = neg as { id: string; estado: string | null } | null
  if (!negocio) return { success: false, error: 'Negocio no encontrado' }
  if (negocio.estado !== 'cancelado' && negocio.estado !== 'perdido') {
    return { success: false, error: 'Solo se liquida un negocio cancelado o perdido' }
  }

  // Recalcular las bolsas (server es autoridad — no confiar en el cliente).
  const { data: cobrosRaw } = await db(supabase)
    .from('cobros').select('id, monto, tipo_cobro')
    .eq('workspace_id', workspaceId).eq('negocio_id', negocioId)
  const cobros = ((cobrosRaw ?? []) as Array<{ id: string; monto: number; tipo_cobro: string | null }>)
    .map((c) => ({ id: c.id, monto: c.monto, tipo_cobro: c.tipo_cobro }))
  const bolsas = componerDosBolsas(cobros)
  if (devolver + penalidad > bolsas.honorario_por_liquidar + 1) {
    return {
      success: false,
      error: `La suma (${fmtCOP(devolver + penalidad)}) excede el honorario por liquidar (${fmtCOP(bolsas.honorario_por_liquidar)}).`,
    }
  }

  const fecha = todayBogotaISO()
  const filas: Array<Record<string, unknown>> = []
  if (devolver > 0) {
    const ref = `LIQ-DEV-${negocioId.slice(0, 8)}`
    const { data: ex } = await db(supabase).from('cobros').select('id')
      .eq('workspace_id', workspaceId).eq('negocio_id', negocioId)
      .eq('external_ref', ref).eq('tipo_cobro', 'devolucion_pendiente').limit(1)
    if (!ex || (ex as unknown[]).length === 0) {
      filas.push({
        workspace_id: workspaceId, negocio_id: negocioId, monto: -devolver,
        tipo_cobro: 'devolucion_pendiente', fecha, external_ref: ref,
        notas: `Devolución al cliente (negocio cancelado). ${motivo.slice(0, 300)}`,
        split_json: { liquidacion_cancelado: true, bolsa: 'honorario', accion: 'devolver' },
      })
    }
  }
  if (penalidad > 0) {
    const ref = `LIQ-PEN-${negocioId.slice(0, 8)}`
    const { data: ex } = await db(supabase).from('cobros').select('id')
      .eq('workspace_id', workspaceId).eq('negocio_id', negocioId)
      .eq('external_ref', ref).eq('tipo_cobro', TIPO_PENALIDAD).limit(1)
    if (!ex || (ex as unknown[]).length === 0) {
      filas.push({
        workspace_id: workspaceId, negocio_id: negocioId, monto: penalidad,
        tipo_cobro: TIPO_PENALIDAD, fecha, external_ref: ref,
        notas: `Penalidad retenida (indemnización, NO ingreso por servicios — pendiente tratamiento fiscal Felipe). ${motivo.slice(0, 300)}`,
        split_json: { liquidacion_cancelado: true, bolsa: 'honorario', accion: 'penalidad', pendiente_felipe: true },
      })
    }
  }

  if (filas.length > 0) {
    const { error: insErr } = await db(supabase).from('cobros').insert(filas)
    if (insErr) return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar la liquidación' }
  }

  if (staffId) {
    try {
      await db(supabase).from('activity_log').insert({
        workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: negocioId,
        tipo: 'comentario', autor_id: staffId,
        contenido:
          `Liquidación de honorario (negocio cancelado): ` +
          [
            devolver > 0 ? `devolver ${fmtCOP(devolver)}` : null,
            penalidad > 0 ? `retener ${fmtCOP(penalidad)} como penalidad (marcada para Felipe)` : null,
          ].filter(Boolean).join(' + ') +
          `. Motivo: ${motivo.slice(0, 300)}`,
      })
    } catch { /* no bloquear por el log */ }
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return { success: true }
}

export interface LiquidarPasanteInput {
  negocio_id: string
  /** 'devolver' | 'cerrar_contra_desembolso'. La confirma financiera (el sistema sugiere). */
  accion: 'devolver' | 'cerrar_contra_desembolso'
  motivo?: string
}

/**
 * Aplica la decisión de financiera sobre el PASANTE UPME en custodia de un negocio
 * cancelado:
 *   - 'devolver' → cobro NEGATIVO `devolucion_pendiente` por el pasante recaudado (el
 *     trámite no se hizo; es plata del cliente). Nunca fue ingreso de SOENA.
 *   - 'cerrar_contra_desembolso' → NO se devuelve (SOENA ya cumplió el mandato ante la
 *     UPME). Solo se deja constancia en activity_log; el pasante ya está excluido del
 *     ingreso por su `tipo_cobro='pasante'`, así que no hace falta tocar el cobro.
 *
 * El sistema PRE-SUGIERE según el gate del comprobante (getCanceladosPorLiquidar), pero
 * financiera confirma. NO auto-ejecuta.
 */
export async function liquidarPasanteCancelado(
  input: LiquidarPasanteInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const negocioId = input.negocio_id
  if (!negocioId) return { success: false, error: 'Elige el negocio' }
  if (input.accion !== 'devolver' && input.accion !== 'cerrar_contra_desembolso') {
    return { success: false, error: 'Acción inválida' }
  }
  const motivo = (input.motivo ?? '').trim()

  const { data: neg } = await db(supabase)
    .from('negocios').select('id, estado').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle()
  const negocio = neg as { id: string; estado: string | null } | null
  if (!negocio) return { success: false, error: 'Negocio no encontrado' }
  if (negocio.estado !== 'cancelado' && negocio.estado !== 'perdido') {
    return { success: false, error: 'Solo se liquida un negocio cancelado o perdido' }
  }

  const { data: cobrosRaw } = await db(supabase)
    .from('cobros').select('id, monto, tipo_cobro')
    .eq('workspace_id', workspaceId).eq('negocio_id', negocioId)
  const cobros = ((cobrosRaw ?? []) as Array<{ id: string; monto: number; tipo_cobro: string | null }>)
  const bolsas = componerDosBolsas(cobros)
  if (bolsas.pasante_recaudado <= 0) {
    return { success: false, error: 'Este negocio no tiene pasante UPME en custodia' }
  }

  const fecha = todayBogotaISO()
  if (input.accion === 'devolver') {
    const ref = `LIQ-PAS-DEV-${negocioId.slice(0, 8)}`
    const { data: ex } = await db(supabase).from('cobros').select('id')
      .eq('workspace_id', workspaceId).eq('negocio_id', negocioId)
      .eq('external_ref', ref).eq('tipo_cobro', 'devolucion_pendiente').limit(1)
    if (!ex || (ex as unknown[]).length === 0) {
      const { error: insErr } = await db(supabase).from('cobros').insert({
        workspace_id: workspaceId, negocio_id: negocioId, monto: -bolsas.pasante_recaudado,
        tipo_cobro: 'devolucion_pendiente', fecha, external_ref: ref,
        notas: `Devolución del pasante UPME (trámite no realizado). ${motivo.slice(0, 300)}`,
        split_json: { liquidacion_cancelado: true, bolsa: 'pasante', accion: 'devolver' },
      })
      if (insErr) return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar la devolución del pasante' }
    }
  }

  if (staffId) {
    try {
      await db(supabase).from('activity_log').insert({
        workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: negocioId,
        tipo: 'comentario', autor_id: staffId,
        contenido: input.accion === 'devolver'
          ? `Pasante UPME (${fmtCOP(bolsas.pasante_recaudado)}) marcado por devolver al cliente (trámite no realizado).${motivo ? ` ${motivo.slice(0, 300)}` : ''}`
          : `Pasante UPME (${fmtCOP(bolsas.pasante_recaudado)}) cerrado contra el desembolso a la UPME (mandato cumplido; no se devuelve).${motivo ? ` ${motivo.slice(0, 300)}` : ''}`,
        // etiqueta estable para que getCanceladosPorLiquidar sepa que el pasante ya se cerró
        valor_nuevo: input.accion === 'cerrar_contra_desembolso' ? 'pasante_cerrado_desembolso' : 'pasante_devuelto',
      })
    } catch { /* no bloquear por el log */ }
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return { success: true }
}
