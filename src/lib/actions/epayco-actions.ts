'use server'

import { consultarTransaccionEpayco, type EpaycoDesglose } from '@/lib/epayco'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'

// Cast a untyped para tablas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

// ── Types ────────────────────────────────────────────────────────────────────

export interface PagoRegistrado {
  ref_payco: number
  monto_bruto: number
  pagador_nombre: string
  total_descuentos: number
  monto_neto: number
  tipo_cobro: string
  fecha: string
}

/** Negocio donde una referencia ePayco ya fue registrada (cobro existente). */
export interface NegocioExistente {
  negocio_id: string
  codigo: string | null
  nombre: string | null
}

// ── Estados ePayco ────────────────────────────────────────────────────────────
//
// El endpoint APIFY de ePayco (apify.epayco.co) devuelve `status` en español, tal
// como aparece en el dashboard. El ÚNICO estado que se acepta como pago real es
// "Aceptada". Cualquier otro valor (Rechazada, Pendiente, Fallida, Abandonada,
// Cancelada, Reversada, o una referencia inexistente que el endpoint reporte con
// otro estado) NO debe crear un cobro. Mantener la regla como allowlist exacta
// (== 'Aceptada') es conservador: un estado nuevo desconocido se trata como NO
// aprobado, no como aprobado por defecto.
const ESTADO_APROBADO = 'Aceptada'

// ── consultarEpayco ──────────────────────────────────────────────────────────

/**
 * Server action: consulta una transaccion ePayco por ref_payco, valida que la
 * transacción esté APROBADA en ePayco y (opcional) que la referencia no haya sido
 * registrada antes en CUALQUIER negocio del workspace.
 *
 * - Estado inválido (no 'Aceptada') → `{ error: 'epayco_no_aprobada' }` con el
 *   estado real devuelto por ePayco en `detalle`. NUNCA crea cobro.
 * - Referencia ya registrada en el workspace → `{ error: 'referencia_duplicada' }`
 *   con el negocio donde existe. Solo se evalúa cuando `validarDuplicado` es true
 *   (opt-in por bloque/workspace); retrocompatible si no se pasa.
 *
 * El registro (`registrarPagoEpayco`) re-valida ambos en servidor — esta función
 * es para feedback temprano en UI.
 */
export async function consultarEpayco(
  refPayco: string | number,
  validarDuplicado = false,
): Promise<
  | { success: true; data: EpaycoDesglose }
  | { success: false; error: string; code?: 'epayco_no_aprobada' | 'referencia_duplicada'; detalle?: string; negocio_existente?: NegocioExistente }
> {
  try {
    const ref = typeof refPayco === 'string' ? parseInt(refPayco, 10) : refPayco
    if (isNaN(ref) || ref <= 0) {
      return { success: false, error: 'Referencia de pago invalida' }
    }

    const desglose = await consultarTransaccionEpayco(ref)

    // ── Validar estado real en ePayco ──────────────────────────────────────
    if (desglose.estado !== ESTADO_APROBADO) {
      return {
        success: false,
        code: 'epayco_no_aprobada',
        detalle: desglose.estado,
        error: `La transacción está "${desglose.estado}" en ePayco — solo se registran pagos aprobados (Aceptada).`,
      }
    }

    // ── Validar duplicado en el workspace (opt-in) ─────────────────────────
    if (validarDuplicado) {
      const dup = await buscarReferenciaDuplicada(ref)
      if (dup) {
        return {
          success: false,
          code: 'referencia_duplicada',
          negocio_existente: dup,
          error: `Esta referencia ePayco ya fue registrada en el negocio ${dup.codigo ?? dup.negocio_id}.`,
        }
      }
    }

    return { success: true, data: desglose }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error consultando ePayco'
    console.error('[ePayco]', message)
    return { success: false, error: message }
  }
}

// ── buscarReferenciaDuplicada ────────────────────────────────────────────────

/**
 * Busca si una referencia ePayco ya está registrada como cobro en CUALQUIER
 * negocio del workspace actual. Retorna el negocio donde existe, o null.
 *
 * Excluye los cobros marcados como **split deliberado** (`split_json.split_id`):
 * el panel de conciliación (F2) reparte un mismo pago entre varios negocios y
 * crea un cobro con el MISMO `external_ref` en cada uno. Ese reparto es la vía
 * sancionada (caso 1 de Diana) → NO es un duplicado accidental. Sin esta
 * exclusión, F3 bloquearía un split legítimo como si fuera una referencia
 * repetida por error.
 */
async function buscarReferenciaDuplicada(refPayco: number): Promise<NegocioExistente | null> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId) return null

  const { data: cobro } = await db(supabase)
    .from('cobros')
    .select('negocio_id')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', String(refPayco))
    .not('negocio_id', 'is', null)
    // Un cobro que es parte de un split deliberado lleva split_json.split_id ≠ null.
    // `split_json->>split_id IS NULL` deja pasar solo cobros NO-split como dueños
    // legítimos de la referencia. Cobros con split_id no cuentan como duplicado.
    .is('split_json->>split_id', null)
    .limit(1)
    .maybeSingle()

  const negocioId = (cobro as { negocio_id: string | null } | null)?.negocio_id
  if (!negocioId) return null

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, codigo, nombre')
    .eq('id', negocioId)
    .single()

  const n = negocio as { id: string; codigo: string | null; nombre: string | null } | null
  return {
    negocio_id: negocioId,
    codigo: n?.codigo ?? null,
    nombre: n?.nombre ?? null,
  }
}

// ── gastoExiste ──────────────────────────────────────────────────────────────

/**
 * Idempotencia para los gastos de causación ePayco: true si ya existe un gasto
 * con ese `external_ref` en el negocio. Evita duplicar comisión/impuestos al
 * reintentar el registro de un mismo cobro.
 */
async function gastoExiste(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
  externalRef: string,
): Promise<boolean> {
  const { data } = await db(supabase)
    .from('gastos')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .eq('external_ref', externalRef)
    .limit(1)
  return Array.isArray(data) && data.length > 0
}

// ── registrarPagoEpayco ──────────────────────────────────────────────────────

/**
 * Server action: registra un pago ePayco en el bloque del negocio.
 *
 * 1. Crea cobro (idempotente via external_ref)
 * 2. Crea gasto por comision (idempotente via external_ref)
 * 3. Actualiza negocio_bloques.data.pagos + marca bloque completo
 * 4. Revalida la ruta del negocio
 */
export interface RegistrarPagoEpaycoOpts {
  /** Si true, re-valida estado + duplicado en servidor (opt-in por bloque/ws). */
  validarEpayco?: boolean
  /** Justificación para forzar el registro de una referencia duplicada. */
  justificacion?: string
}

export async function registrarPagoEpayco(
  negocioBloqueId: string,
  negocioId: string,
  desglose: EpaycoDesglose,
  tipoCobro: string,
  opts: RegistrarPagoEpaycoOpts = {},
): Promise<
  | { success: true; pagos: PagoRegistrado[] }
  | { success: false; error: string; code?: 'epayco_no_aprobada' | 'referencia_duplicada' | 'justificacion_requerida'; negocio_existente?: NegocioExistente }
> {
  try {
    const { supabase, workspaceId, staffId, error } = await getWorkspace()
    if (error || !workspaceId) {
      return { success: false, error: error ?? 'Sin workspace' }
    }

    // ── 0. Re-validar en servidor cuando la validación está activada ────────
    // El cliente ya pasó por consultarEpayco, pero el desglose llega del cliente
    // → no se puede confiar en él como barrera. Re-consultamos ePayco para el
    // estado real + los montos reales (autoritativos) y revalidamos duplicado
    // workspace-wide.
    let desgloseFinal = desglose
    if (opts.validarEpayco) {
      const fresh = await consultarTransaccionEpayco(desglose.ref_payco)
      if (fresh.estado !== ESTADO_APROBADO) {
        return {
          success: false,
          code: 'epayco_no_aprobada',
          error: `La transacción está "${fresh.estado}" en ePayco — solo se registran pagos aprobados.`,
        }
      }
      // El desglose recién consultado es la fuente de verdad (montos/comisiones),
      // no el que envió el cliente.
      desgloseFinal = fresh

      const dup = await buscarReferenciaDuplicada(desgloseFinal.ref_payco)
      if (dup) {
        const justificacion = (opts.justificacion ?? '').trim()
        if (!justificacion) {
          // Bloqueo con override: el cliente debe reenviar con justificación.
          return {
            success: false,
            code: 'referencia_duplicada',
            negocio_existente: dup,
            error: `Esta referencia ePayco ya fue registrada en el negocio ${dup.codigo ?? dup.negocio_id}. Justifica el registro para continuar.`,
          }
        }
        // Override autorizado → registrar la justificación en el activity log
        // del negocio (visible en el timeline) antes de crear el cobro.
        try {
          await db(supabase).from('activity_log').insert({
            workspace_id: workspaceId,
            entidad_tipo: 'negocio',
            entidad_id: negocioId,
            tipo: 'comentario',
            ...(staffId ? { autor_id: staffId } : {}),
            contenido: `Referencia ePayco ${desgloseFinal.ref_payco} registrada pese a estar duplicada (ya existía en ${dup.codigo ?? dup.negocio_id}). Justificación: ${justificacion.slice(0, 500)}`,
          })
        } catch (logErr) {
          console.error('[ePayco registrar] No se pudo registrar justificación en activity_log:', logErr)
        }
      }
    }

    // ── 1. Leer datos + config del bloque ──────────────────────────────────
    // El join a bloque_configs.config_extra trae el flag opt-in
    // `causar_comision_epayco` (discriminado de costos ePayco, F5). Se lee
    // server-side: ningún workspace sin el flag cambia de comportamiento.
    const { data: bloque } = await db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs:bloque_config_id ( config_extra )')
      .eq('id', negocioBloqueId)
      .single()

    const currentData = (bloque?.data as Record<string, unknown>) ?? {}
    const currentPagos = (currentData.pagos ?? []) as PagoRegistrado[]
    const configExtra = (bloque?.bloque_configs?.config_extra as Record<string, unknown> | null) ?? {}
    const discriminarCostos = configExtra.causar_comision_epayco === true

    // ── 2. Idempotencia en bloque ──────────────────────────────────────────
    if (currentPagos.some(p => p.ref_payco === desgloseFinal.ref_payco)) {
      return { success: true, pagos: currentPagos } // Ya registrado
    }

    // ── 3. Crear cobro (idempotente via external_ref) ──────────────────────
    const { data: existingCobro } = await db(supabase)
      .from('cobros')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .eq('external_ref', String(desgloseFinal.ref_payco))
      .limit(1)

    if (!existingCobro || (existingCobro as unknown[]).length === 0) {
      const cobro = {
        workspace_id: workspaceId,
        negocio_id: negocioId,
        notas: tipoCobro === 'anticipo' ? 'Anticipo' : 'Pago',
        monto: desgloseFinal.monto_bruto,
        tipo_cobro: tipoCobro,
        fecha: todayBogotaISO(),
        external_ref: String(desgloseFinal.ref_payco),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: cobroError } = await (db(supabase) as any).from('cobros').insert(cobro)
      if (cobroError) return { success: false, error: (cobroError as { message: string }).message }
    }

    // ── 4. Causar los costos de ePayco ─────────────────────────────────────
    // ePayco descuenta comisión + IVA + retefuente + reteica y NO los discrimina
    // en su panel. El desglose SÍ llega en `desgloseFinal`. Cómo se causa:
    //
    //  - Modo discriminado (opt-in `causar_comision_epayco`, F5 SOENA):
    //      · 1 gasto categoria='comision' (clasificacion variable) = costo real
    //        → entra a MC. external_ref `epayco-comision-{ref}`.
    //      · 1 gasto categoria='impuestos_recuperables' (clasificacion
    //        no_operativo) por IVA+retefuente+reteica = impuestos a favor /
    //        recuperables. `no_operativo` queda fuera de MC y de EBITDA en
    //        v_pyl_mes / v_mc_negocio → NO contamina el margen. El desglose
    //        fino (iva/retefuente/reteica) se guarda en split_json para
    //        trazabilidad por cobro. Solo se crea si hay impuestos (>0).
    //        external_ref `epayco-impuestos-{ref}`.
    //
    //  - Modo legacy (flag ausente): comportamiento previo intacto — 1 gasto
    //    con el total de descuentos. Otros workspaces sin el flag no cambian.
    if (discriminarCostos) {
      // 4a. Comisión real → costo variable.
      const comisionRef = `epayco-comision-${desgloseFinal.ref_payco}`
      if (desgloseFinal.comision > 0 && !(await gastoExiste(supabase, workspaceId, negocioId, comisionRef))) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db(supabase) as any).from('gastos').insert({
          workspace_id: workspaceId,
          negocio_id: negocioId,
          fecha: todayBogotaISO(),
          monto: desgloseFinal.comision,
          categoria: 'comision',
          clasificacion_costo: 'variable',
          descripcion: `Comisión ePayco — Ref ${desgloseFinal.ref_payco}`,
          tipo: 'operativo',
          deducible: true,
          external_ref: comisionRef,
        })
      }

      // 4b. IVA + retefuente + reteica → "otra bolsa": impuestos recuperables.
      const impuestos = desgloseFinal.iva_comision + desgloseFinal.retefuente + desgloseFinal.reteica
      const impuestosRef = `epayco-impuestos-${desgloseFinal.ref_payco}`
      if (impuestos > 0 && !(await gastoExiste(supabase, workspaceId, negocioId, impuestosRef))) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db(supabase) as any).from('gastos').insert({
          workspace_id: workspaceId,
          negocio_id: negocioId,
          fecha: todayBogotaISO(),
          monto: impuestos,
          categoria: 'impuestos_recuperables',
          clasificacion_costo: 'no_operativo',
          descripcion: `Impuestos ePayco (IVA + retefuente + reteica) — Ref ${desgloseFinal.ref_payco}`,
          tipo: 'no_operativo',
          deducible: false,
          external_ref: impuestosRef,
          split_json: {
            iva_comision: desgloseFinal.iva_comision,
            retefuente: desgloseFinal.retefuente,
            reteica: desgloseFinal.reteica,
            ref_payco: desgloseFinal.ref_payco,
          },
        })
      }
    } else {
      // Modo legacy: un único gasto con el total de descuentos.
      const gastoRef = `epayco-comision-${desgloseFinal.ref_payco}`
      if (!(await gastoExiste(supabase, workspaceId, negocioId, gastoRef))) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db(supabase) as any).from('gastos').insert({
          workspace_id: workspaceId,
          negocio_id: negocioId,
          fecha: todayBogotaISO(),
          monto: desgloseFinal.total_descuentos,
          categoria: 'servicios_profesionales',
          descripcion: `Comision ePayco — Ref ${desgloseFinal.ref_payco}`,
          tipo: 'operativo',
          external_ref: gastoRef,
        })
      }
    }

    // ── 5. Agregar pago al bloque y marcar completo ────────────────────────
    const newPago: PagoRegistrado = {
      ref_payco: desgloseFinal.ref_payco,
      monto_bruto: desgloseFinal.monto_bruto,
      pagador_nombre: desgloseFinal.pagador_nombre,
      total_descuentos: desgloseFinal.total_descuentos,
      monto_neto: desgloseFinal.monto_neto,
      tipo_cobro: tipoCobro,
      fecha: todayBogotaISO(),
    }
    const updatedPagos = [...currentPagos, newPago]
    const updatedData = { ...currentData, pagos: updatedPagos }

    await db(supabase)
      .from('negocio_bloques')
      .update({
        data: updatedData,
        estado: 'completo',
        completado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', negocioBloqueId)

    // ── 6. Revalidar y retornar ────────────────────────────────────────────
    revalidatePath(`/negocios/${negocioId}`)
    return { success: true, pagos: updatedPagos }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error registrando pago ePayco'
    console.error('[ePayco registrar]', message)
    return { success: false, error: message }
  }
}
