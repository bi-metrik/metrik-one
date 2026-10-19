'use server'

import { accionIdempotente } from '@/lib/idempotencia/accion'
import { MENSAJE_EN_CURSO } from '@/lib/idempotencia/clave'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { canEditBloque, type UserContext, type Role, type Area } from '@/lib/permissions/can-edit'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { randomUUID } from 'crypto'
import { consultarTransaccionEpayco } from '@/lib/epayco'
import { workspaceCobraPorEpayco } from '@/lib/actions/fab-pago-actions'
import { ctxFabPago } from '@/lib/actions/fab-pago-actions'
import { escalonesDelNegocio, imputarPago } from '@/lib/upme/imputacion-pago'
import {
  tipoCobroHonorario,
  niegaCertificacionUpme,
  tarifaConfirmadaPorNegocio,
  valorARecaudarCartera,
  valorARecaudar,
  saldoConciliacion,
  esCeroDeliberado,
  type FilaBloqueTarifa,
  type ModeloDinero,
  type PropuestaBloqueData,
} from '@/lib/upme/modelo-dinero'
import { TOLERANCIA_SALDO_COP, saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'
import { diasDesde, compararPorAntiguedad } from '@/lib/negocios/antiguedad'
import {
  sumarRecaudoConfirmado,
  recaudoPendienteDeConfirmar,
  esPorcionPendienteDeConfirmar,
  porcionConfirmadaPorFinanciera,
  type CobroParaRecaudo,
} from '@/lib/negocios/recaudo-confirmado'
import { calcularTarifaUpmePorAnio } from '@/lib/upme/tarifa'
import { valorSinIvaDeFactura } from '@/lib/upme/valor-factura'
import { planearRedistribucion, requiereSplitId } from '@/lib/cobros/redistribucion'
import { filtroBusquedaNegocio } from '@/lib/cobros/busqueda-negocio'
import { evaluarAnulabilidad } from '@/lib/cobros/anulabilidad'
import { porcionesPorConfirmar as contarPorcionesPorConfirmar } from '@/lib/cobros/confirmacion-por-referencia'
import { esCobroAnulado, montoRegistrado } from '@/lib/cobros/anulacion'
import {
  guardarAviso,
  resolverAviso,
  etapasRecorridas,
  ejecutarRetroceso,
  proponerRetrocesoFinanciero,
} from '@/lib/correcciones/retroceso'
import { avisoRecaudoNecesario } from '@/lib/negocios/retroceso-financiero'
import type {
  CausaRetrocesoFinanciero,
  PropuestaRetroceso,
} from '@/lib/negocios/retroceso-financiero'
import { recalcularNegocioPorCambioDeRecaudo, cambiarEtapaNegocio } from '@/app/(app)/negocios/negocio-v2-actions'
import { avisarSobrepagoSiCorresponde } from '@/lib/cobros/aviso-sobrepago-servidor'
import { abonarEnSegundoPlano } from '@/lib/siigo/segundo-plano'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { negocioCerrado, MENSAJE_NEGOCIO_CERRADO } from '@/lib/negocios/motivo-cierre'
import { negociosDePruebaOcultos, sinOcultos } from '@/lib/negocios/negocios-de-prueba'
import {
  deudaParaReparto,
  describirPorciones,
  estadoDelReparto,
  mensajeErrorReparto,
  motivosParaNoEnviar,
  type CobroParaDeuda,
  type PorcionGuardada,
} from '@/lib/cobros/reparto-comercial'

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
  | {
      ok: true
      supabase: unknown
      workspaceId: string
      /** profiles.id. Es el que va a `cobros.created_by` y `cobros.anulado_por`. */
      userId: string | null
      /** staff.id. Es el que va a `activity_log.autor_id`. Son tablas distintas. */
      staffId: string | null
      user: UserContext
    }
  | { ok: false; error: string }
> {
  const { supabase, workspaceId, userId, staffId, role, areas, error } = await getWorkspace()
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
  return { ok: true, supabase, workspaceId, userId: userId ?? null, staffId, user }
}

/**
 * ¿La sesión actual pertenece al área financiera? Mismo criterio que `ctxFinanciero`
 * (canEditBloque del stage 'cobro'), pero resuelto SIEMPRE desde la sesión — no desde
 * el contexto que ya trae el caller. Se usa para blindar el registro de pagos que NO
 * entraron por ePayco dentro de la vía única de escritura, para que ninguna ruta de
 * entrada (FAB, panel, acción futura) pueda saltárselo por olvido.
 */
async function esAreaFinanciera(): Promise<boolean> {
  const { workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return false
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  return canEditBloque(user, { stage: 'cobro' }, [])
}

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Un negocio elegible para recibir una porción de un pago repartido. */
export interface NegocioParaSplit {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
  /** Valor a recaudar (honorario + tarifa UPME): la base de `diferencia`. */
  precio: number
  cobrado: number
  diferencia: number
}

// ── Reparto del comercial: enviar, corregir y estado ─────────────────────────
//
// Rediseño del 2026-10-19 (Mauricio, con Hana y Noor). Medido en SOENA: desde el 23-sep la
// financiera rehízo 4 repartos del comercial, porque no repartió o repartió en partes
// iguales cuando cada negocio debía distinto. Las reglas puras viven en
// `lib/cobros/reparto-comercial.ts`; la escritura, en la función de base
// `guardar_reparto_comercial` (migración 20261019120000), que hace todo en UNA transacción.
//
// El ciclo:
//   1. El comercial elige los negocios; cada fila se llena con lo que ese negocio debe
//      (`prepararRepartoComercial`). Si no cuadra con el pago, no se envía.
//   2. «Enviar a financiera» → resumen → «Confirmar envío». Antes de confirmar no se crea
//      ningún cobro: la pantalla no llama al servidor hasta ese clic.
//   3. Enviado y sin aprobar: el comercial lo corrige con `editarRepartoComercial`, que
//      reemplaza TODAS las porciones vigentes de la referencia en la misma transacción.
//   4. Aprobado (alguna porción con `confirmado_at`, o su negocio conciliado): la base
//      rechaza la edición aunque se llame la acción directo. La financiera sigue con
//      Redistribuir.
//   5. Rechazado: la financiera borra las porciones y el comercial recibe la nota en una
//      notificación (`rechazarRepartoComercial`).

export interface PorcionSplit {
  negocio_id: string
  monto: number
}

export interface RepartirPagoInput {
  /** Referencia del pago (ePayco ref_payco o referencia externa). Va a external_ref. */
  referencia: string
  /** Total del pago. Con ePayco y 0, se toma del pago real. Las porciones deben sumarlo. */
  monto_total: number
  porciones: PorcionSplit[]
  fecha?: string
  fuente?: 'epayco' | 'manual'
  /**
   * Con fuente manual: de dónde vino la plata (Davivienda, Nequi, efectivo…). Hasta el
   * 2026-10-19 el modal lo exigía y no lo enviaba: la porción quedaba sin fuente.
   */
  fuente_nombre?: string
}

type ResultadoReparto = { success: true; split_id: string } | { success: false; error: string }

async function guardarRepartoComercialSinClave(
  input: RepartirPagoInput,
  modo: 'nuevo' | 'editar',
): Promise<ResultadoReparto> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const referencia = (input.referencia ?? '').trim()
  if (!referencia) return { success: false, error: 'La referencia del pago es obligatoria' }

  let montoTotal = Number(input.monto_total)
  const esEpayco = (input.fuente ?? 'manual') === 'epayco'
  let fuente: string

  if (esEpayco) {
    // La cuenta de ePayco es GLOBAL (la de SOENA): solo la consulta un workspace que cobra
    // por la pasarela. Sin esto, cualquier workspace con el FAB de pago recorría referencias
    // y, por el techo de plata de abajo, leía cuánto pagó cada cliente de SOENA.
    if (!(await workspaceCobraPorEpayco(supabase, workspaceId))) {
      return { success: false, error: MENSAJE_SIN_EPAYCO }
    }
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
    fuente = 'epayco'
  } else {
    const nombre = (input.fuente_nombre ?? '').trim()
    if (!nombre) return { success: false, error: 'Indica de dónde vino el pago (banco, Nequi, efectivo…)' }
    if (!Number.isFinite(montoTotal) || montoTotal <= 0) {
      return { success: false, error: 'Ingresa el total del pago' }
    }
    fuente = nombre.slice(0, 60)
  }

  const porciones = (input.porciones ?? [])
    .filter((p) => p && p.negocio_id)
    .map((p) => ({ negocio_id: p.negocio_id, monto: Math.round(Number(p.monto) || 0) }))
  // Mismas reglas que la pantalla: si no cuadra, no se envía. La base lo vuelve a exigir.
  const motivos = motivosParaNoEnviar(montoTotal, porciones.map((p) => ({ ...p, debe: null })))
  if (motivos.length > 0) return { success: false, error: motivos[0] }

  const { data, error } = await db(supabase).rpc('guardar_reparto_comercial', {
    p_referencia: referencia,
    p_split_total: montoTotal,
    p_porciones: porciones,
    p_fecha: (input.fecha ?? '').trim() || null,
    p_fuente: fuente,
    p_modo: modo,
  })
  if (error) {
    const e = error as { code?: string; message?: string }
    return { success: false, error: mensajeErrorReparto(`${e.code ?? ''} ${e.message ?? ''}`.trim(), referencia) }
  }
  const guardado = (data ?? {}) as { split_id?: string; antes?: PorcionGuardada[]; despues?: PorcionGuardada[] }
  const antes = guardado.antes ?? []
  const despues = guardado.despues ?? []
  const negocioIds = Array.from(new Set([...antes, ...despues].map((p) => p.negocio_id)))

  // El antes y el después en el historial de cada negocio tocado: es lo único que queda de
  // la versión reemplazada, porque sus cobros ya no existen.
  const total = fmtCOP(montoTotal)
  for (const id of negocioIds) {
    await registrarActividad(db(supabase), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: id,
      tipo: 'cambio_sistema',
      autor_id: staffId,
      campo_modificado: CAMPO_REPARTO_COMERCIAL,
      valor_anterior: modo === 'editar' ? `${referencia} · ${describirPorciones(antes)}` : null,
      valor_nuevo: `${referencia} · ${describirPorciones(despues)}`,
      contenido: modo === 'editar'
        ? `Reparto corregido por el comercial (ref ${referencia}, total ${total}). Antes: ${describirPorciones(antes)}. Ahora: ${describirPorciones(despues)}. Pendiente de aprobar por el área financiera.`
        : `Reparto enviado al área financiera (ref ${referencia}, total ${total}): ${describirPorciones(despues)}.`,
    }, modo === 'editar' ? 'editarRepartoComercial' : 'repartirPagoComercial')
  }

  // El pendiente es del EQUIPO financiero. Una corrección cierra el aviso anterior y abre
  // uno nuevo, para que vuelva a sonar aunque el primero siguiera sin leer.
  if (modo === 'editar') {
    await resolverPendienteConciliacion(supabase, workspaceId, referencia)
    await avisarConciliacionPendiente(supabase, workspaceId, referencia, montoTotal, {
      contenido: `Reparto corregido por el comercial para la referencia ${referencia} (${total}): ${describirPorciones(despues)} — pendiente de conciliar.`,
    })
  } else {
    await avisarConciliacionPendiente(supabase, workspaceId, referencia, montoTotal)
  }

  // Las porciones del comercial esperan a la financiera para abonarse (`porQueNoSeAbona`).
  // Corre DESPUÉS de responder (`segundo-plano.ts`).
  await abonarEnSegundoPlano(workspaceId, negocioIds)

  for (const id of negocioIds) revalidatePath(`/negocios/${id}`)
  revalidatePath('/conciliacion')
  return { success: true, split_id: guardado.split_id ?? '' }
}

/** Marca del historial que deja el comercial al enviar o corregir un reparto. */
const CAMPO_REPARTO_COMERCIAL = 'reparto_comercial'
/** Marca del historial que deja la financiera al rechazar. La lee `estadoRepartosDelNegocio`. */
const CAMPO_REPARTO_RECHAZADO = 'reparto_comercial_rechazado'

// ── Lo que debe cada negocio, para prellenar el reparto ──────────────────────

/** Un negocio que puede recibir una porción, con lo que debe hoy. */
export interface NegocioParaReparto {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
  /** Lo que debe hoy (`deudaParaReparto`). null = negocio sin cifrar: no hay con qué medir. */
  debe: number | null
}

async function deudasDeNegocios(
  supabase: unknown,
  workspaceId: string,
  negocioIds: string[],
  excluirRef: string | null,
): Promise<Map<string, NegocioParaReparto>> {
  const out = new Map<string, NegocioParaReparto>()
  if (negocioIds.length === 0) return out
  const [negRes, cobrosRes] = await Promise.all([
    db(supabase)
      .from('negocios')
      .select('id, codigo, nombre, precio_aprobado, precio_estimado, empresas:empresa_id ( nombre )')
      .eq('workspace_id', workspaceId)
      .in('id', negocioIds),
    db(supabase)
      .from('cobros')
      .select('negocio_id, monto, fecha, retencion_iva, anulado_at, external_ref, tipo_cobro')
      .eq('workspace_id', workspaceId)
      .in('negocio_id', negocioIds),
  ])
  const cobros = (cobrosRes.data ?? []) as Array<CobroParaDeuda & { negocio_id: string }>
  const filas = (negRes.data ?? []) as Array<{
    id: string; codigo: string | null; nombre: string | null
    precio_aprobado: number | null; precio_estimado: number | null
    empresas: { nombre: string | null } | null
  }>
  await Promise.all(filas.map(async (n) => {
    const honorario = Number(n.precio_aprobado ?? n.precio_estimado ?? 0)
    const modelo = await leerModeloDineroCompleto(supabase, n.id)
    const cifrado = valorARecaudar(honorario, modelo) > 0
    out.set(n.id, {
      negocio_id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      empresa: n.empresas?.nombre ?? null,
      debe: cifrado
        ? deudaParaReparto({ honorario, modelo, cobros: cobros.filter((c) => c.negocio_id === n.id), excluirRef })
        : null,
    })
  }))
  return out
}

/**
 * Lo que el modal necesita para prellenar: la deuda de los negocios pedidos y, si hay un
 * negocio de origen, los demás negocios abiertos del mismo cliente (contacto o empresa)
 * que tienen saldo, para ofrecerlos primero.
 *
 * `referencia`: al corregir un reparto, sus propias porciones no cuentan como pagadas.
 */
export async function prepararRepartoComercial(input: {
  negocioIds: string[]
  negocioOrigenId?: string | null
  referencia?: string | null
}): Promise<
  | { ok: true; negocios: NegocioParaReparto[]; sugeridos: NegocioParaReparto[] }
  | { ok: false; error: string }
> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { supabase, workspaceId } = ctx
  const ref = (input.referencia ?? '').trim() || null

  let delMismoCliente: string[] = []
  const origen = input.negocioOrigenId ?? null
  if (origen) {
    const { data: o } = await db(supabase)
      .from('negocios')
      .select('contacto_id, empresa_id')
      .eq('id', origen)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    const filtros: string[] = []
    const fila = o as { contacto_id: string | null; empresa_id: string | null } | null
    if (fila?.contacto_id) filtros.push(`contacto_id.eq.${fila.contacto_id}`)
    if (fila?.empresa_id) filtros.push(`empresa_id.eq.${fila.empresa_id}`)
    if (filtros.length > 0) {
      const { data: hermanos } = await db(supabase)
        .from('negocios')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('estado', 'abierto')
        .neq('id', origen)
        .or(filtros.join(','))
        .limit(10)
      delMismoCliente = ((hermanos ?? []) as Array<{ id: string }>).map((h) => h.id)
    }
  }

  const pedidos = Array.from(new Set(input.negocioIds.filter(Boolean)))
  const deudas = await deudasDeNegocios(supabase, workspaceId, Array.from(new Set([...pedidos, ...delMismoCliente])), ref)
  return {
    ok: true,
    negocios: pedidos.map((id) => deudas.get(id)).filter((n): n is NegocioParaReparto => !!n),
    sugeridos: delMismoCliente
      .filter((id) => !pedidos.includes(id))
      .map((id) => deudas.get(id))
      .filter((n): n is NegocioParaReparto => !!n && (n.debe ?? 0) > TOLERANCIA_SALDO_COP),
  }
}

// ── Estado del reparto en el bloque del negocio ──────────────────────────────

/** Un reparto del comercial visto desde uno de sus negocios. */
export interface RepartoDelNegocio {
  referencia: string
  estado: 'enviado' | 'aprobado' | 'rechazado'
  /** Total declarado del pago. */
  total: number
  fuente: string | null
  fecha: string | null
  porciones: Array<{ negocio_id: string; codigo: string | null; monto: number }>
  /** Nota de la financiera al rechazar. */
  nota: string | null
}

/**
 * Los repartos del comercial que tocan este negocio: enviados (se pueden editar),
 * aprobados (ya no) y rechazados (con la nota de la financiera, hasta que se vuelva a
 * repartir esa referencia). Mismo guard que repartir: quien no puede repartir no ve el
 * botón de editar, así que tampoco necesita esto.
 */
export async function estadoRepartosDelNegocio(negocioId: string): Promise<RepartoDelNegocio[]> {
  const ctx = await ctxFabPago()
  if (!ctx.ok) return []
  const { supabase, workspaceId } = ctx

  const { data: propias } = await db(supabase)
    .from('cobros')
    .select('external_ref')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .eq('split_json->>origen', 'comercial')
    .is('anulado_at', null)
  const refs = Array.from(new Set(((propias ?? []) as Array<{ external_ref: string | null }>)
    .map((c) => c.external_ref).filter((r): r is string => !!r)))

  const out: RepartoDelNegocio[] = []
  if (refs.length > 0) {
    const { data: porcionesRaw } = await db(supabase)
      .from('cobros')
      .select('negocio_id, monto, fecha, fuente, external_ref, split_json, negocios:negocio_id ( codigo )')
      .eq('workspace_id', workspaceId)
      .in('external_ref', refs)
      .eq('split_json->>origen', 'comercial')
      .is('anulado_at', null)
    const porciones = (porcionesRaw ?? []) as Array<{
      negocio_id: string; monto: number; fecha: string | null; fuente: string | null; external_ref: string
      split_json: { origen?: string; confirmado_at?: string | null; split_total?: number } | null
      negocios: { codigo: string | null } | null
    }>
    const ids = Array.from(new Set(porciones.map((p) => p.negocio_id)))
    const { data: concRaw } = await db(supabase)
      .from('negocio_conciliacion')
      .select('negocio_id, conciliado')
      .eq('workspace_id', workspaceId)
      .in('negocio_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
    const conciliado = new Map(((concRaw ?? []) as Array<{ negocio_id: string; conciliado: boolean }>)
      .map((r) => [r.negocio_id, r.conciliado === true]))
    for (const ref of refs) {
      const deRef = porciones.filter((p) => p.external_ref === ref)
      if (deRef.length === 0) continue
      out.push({
        referencia: ref,
        estado: estadoDelReparto(deRef as unknown as Array<CobroParaRecaudo & { negocio_id: string }>, conciliado),
        total: Number(deRef[0].split_json?.split_total ?? deRef.reduce((s, p) => s + Number(p.monto), 0)),
        fuente: deRef[0].fuente,
        fecha: deRef[0].fecha,
        porciones: deRef.map((p) => ({ negocio_id: p.negocio_id, codigo: p.negocios?.codigo ?? null, monto: Number(p.monto) })),
        nota: null,
      })
    }
  }

  // Rechazos: la financiera borró las porciones, así que lo único que queda es su marca
  // en el historial. Se muestra el último de cada referencia que no se haya vuelto a
  // repartir después.
  const { data: rechazosRaw } = await db(supabase)
    .from('activity_log')
    .select('valor_anterior, valor_nuevo, created_at')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', 'negocio')
    .eq('entidad_id', negocioId)
    .eq('campo_modificado', CAMPO_REPARTO_RECHAZADO)
    .order('created_at', { ascending: false })
    .limit(10)
  const rechazos = ((rechazosRaw ?? []) as Array<{ valor_anterior: string | null; valor_nuevo: string | null; created_at: string }>)
  const refsRechazadas = Array.from(new Set(rechazos.map((r) => (r.valor_anterior ?? '').trim()).filter(Boolean)))
  // Una referencia rechazada que ya volvió a registrarse (por el comercial o la financiera)
  // dejó de ser un rechazo pendiente.
  const vivas = new Set<string>()
  if (refsRechazadas.length > 0) {
    const { data: vivasRaw } = await db(supabase)
      .from('cobros')
      .select('external_ref')
      .eq('workspace_id', workspaceId)
      .in('external_ref', refsRechazadas)
      .is('anulado_at', null)
    for (const c of ((vivasRaw ?? []) as Array<{ external_ref: string | null }>)) if (c.external_ref) vivas.add(c.external_ref)
  }
  const vistos = new Set([...out.map((r) => r.referencia), ...vivas])
  for (const r of rechazos) {
    const ref = (r.valor_anterior ?? '').trim()
    if (!ref || vistos.has(ref)) continue
    vistos.add(ref)
    out.push({ referencia: ref, estado: 'rechazado', total: 0, fuente: null, fecha: null, porciones: [], nota: r.valor_nuevo })
  }
  return out
}

/** Clave del pendiente de equipo: un aviso por referencia de pago. */
function claveConciliacion(referencia: string) {
  return `conciliacion:${referencia}`
}

/** Le avisa al área financiera que hay un reparto esperando su decisión. */
async function avisarConciliacionPendiente(
  supabase: unknown,
  workspaceId: string,
  referencia: string,
  monto: number,
  opts?: { contenido?: string },
) {
  try {
    await db(supabase).rpc('crear_notificacion_equipo', {
      p_workspace_id: workspaceId,
      p_area: 'financiera',
      p_tipo: 'conciliacion_solicitada',
      p_contenido: opts?.contenido ?? `Reparto propuesto para la referencia ${referencia} (${monto.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}) — pendiente de conciliar.`,
      p_grupo_clave: claveConciliacion(referencia),
      p_entidad_tipo: null,
      p_entidad_id: null,
      p_deep_link: '/conciliacion',
      p_metadata: { referencia, monto },
      p_excluir_profile_id: null,
    })
  } catch {
    // El reparto ya se registró: un fallo del aviso no lo revierte.
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONCILIACIÓN v2 — modelo por REFERENCIA de pago + 5 pestañas
// ═══════════════════════════════════════════════════════════════════════════════

const ESTADO_APROBADO_EPAYCO = 'Aceptada'

/** Sin `export`: un archivo `'use server'` que exporta una constante pierde todos sus exports. */
const MENSAJE_SIN_EPAYCO = 'Este espacio no cobra por ePayco: registra el pago con su fuente real.'

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
  /** Ya esta anulada. Su `monto` es 0; lo que registro vive en `monto_registrado`. */
  anulado: boolean
  /** Lo que la porcion registro, este anulada o no. Es lo que va en pantalla. */
  monto_registrado: number
  anulacion_motivo: string | null
  /** ¿La financiera puede anularla desde aqui? Lo decide `evaluarAnulabilidad`. */
  anulable: boolean
  /** Si no es anulable, por que. Texto listo para mostrar. */
  bloqueo_anulacion: string | null
  /**
   * Porción propuesta por el comercial que TODAVÍA espera el visto bueno de la
   * financiera. Lo decide `esPorcionPendienteDeConfirmar`, el mismo criterio con el que
   * el motor de saldos decide si esta plata cuenta: la pantalla no puede ofrecer una
   * acción sobre algo que el motor ya dio por resuelto, ni callar lo que sigue abierto.
   */
  pendiente_de_confirmar: boolean
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
  /**
   * true si algún negocio de la referencia tiene el check de conciliación. Es estado por
   * NEGOCIO, así que **no decide si la referencia sigue accionable** — solo acompaña al
   * badge cuando ya no queda nada pendiente. Ver `porciones_por_confirmar`.
   */
  algun_conciliado: boolean
  /**
   * Cuántas porciones de esta referencia siguen esperando el visto bueno de la
   * financiera.
   *
   * ⚠️⚠️ Es lo que decide si la referencia aparece en "Por confirmar", y reemplaza a
   * `!algun_conciliado` en esa decisión. Con el criterio viejo, una referencia repartida
   * entre dos negocios desaparecía entera de la pestaña en cuanto UNO de los dos quedaba
   * conciliado: la porción del otro no tenía desde dónde aceptarse, y nadie podía
   * devolverle su plata al negocio. Pasó en SOENA con la referencia 385563083
   * (V0497/V0498, 15-sep-2026) y hubo que restituir el check por SQL.
   */
  porciones_por_confirmar: number
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
  /** Honorario de SOENA (`precio_aprobado`). Es el ingreso, NO lo que paga el cliente. */
  precio: number
  /** Tarifa UPME confirmada (plata de terceros que SOENA recauda). 0 si no aplica. */
  tarifa_upme: number
  /** Lo que el cliente le paga a SOENA = honorario + tarifa. La vara del SOBRANTE. */
  valor_a_recaudar: number
  cobrado: number
  /**
   * `> 0` le falta plata a SOENA, `< 0` le sobra. Asimétrico a propósito: lo que falta
   * se mide contra el honorario y lo que sobra contra el valor a recaudar. Ver
   * `saldoConciliacion`.
   */
  saldo: number
  referencias: { external_ref: string; fuente: string | null; monto: number; fecha: string | null }[]
  conciliado: boolean
  /**
   * Recaudo que ya está registrado pero espera el visto bueno del área financiera.
   * `0` cuando no hay nada pendiente.
   *
   * No suma al saldo (el motor tampoco lo cuenta), pero se muestra para que el bloqueo
   * tenga nombre: "faltan $X" sobre plata que ya entró manda a buscar lo que no se ha
   * perdido. Lo que falta es la confirmación, y eso sí es accionable.
   */
  pendiente_de_confirmar: number
  /**
   * Días cumplidos desde que se CREÓ el negocio, para que la financiera vea de un
   * vistazo cuánto lleva esperando un faltante.
   *
   * ⚠️ Es la antigüedad del NEGOCIO, no la de la deuda. Un negocio puede pasar días en
   * Validación antes de que se apruebe la propuesta, y hasta ese momento no hay nada
   * que cobrar: en esos casos este número exagera la mora. Medido en SOENA el
   * 2026-08-06, la brecha máxima entre ambas era de 4 días (V0124: 9 días de negocio,
   * 5 de obligación), así que hoy sirve como aproximación. Si algún día se necesita la
   * mora real, la fuente es la fecha de aprobación de la propuesta, no `created_at`.
   *
   * Se calcula en el SERVIDOR: hacerlo al pintar mete un `Date.now()` en el render y
   * eso ya rompió antes en este repo (`contactos-list`).
   */
  dias_desde_creacion: number | null
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
  /** Saldo del negocio (ver `saldoConciliacion`). >0 = aún le falta por cobrar. */
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
  /** Valor a recaudar del negocio de origen: honorario + tarifa UPME (informativo). */
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
  /** Honorario de SOENA (`precio_aprobado`) — el INGRESO. NO es lo que paga el cliente. */
  precio: number
  /** Tarifa UPME confirmada (pasante). 0 si no está confirmada o no se contrató. */
  tarifa: number
  /**
   * Tarifa que efectivamente entra al valor a recaudar (0 cuando todavía no es
   * cartera). Es la que se le pasa al modelo de dinero al medir el saldo.
   */
  tarifa_cartera: number
  /**
   * Lo que el cliente le paga a SOENA = honorario + tarifa. Es la vara contra la que
   * se mide TODO en este panel: el saldo, el sobrepago y el "conciliado".
   */
  valor_a_recaudar: number
  estado: string | null
  stage_actual: string | null
  etapa_nombre: string | null
  etapa_orden: number | null
  empresa: string | null
  /** Antigüedad del negocio en días cumplidos. Ver `NegocioSaldo.dias_desde_creacion`. */
  dias_desde_creacion: number | null
}

interface CobroRow {
  id: string
  negocio_id: string | null
  monto: number
  tipo_cobro: string | null
  external_ref: string | null
  fuente: string | null
  fecha: string | null
  /** Marca las cuotas de un plan de cobro. Lo lee `evaluarAnulabilidad`. */
  plan_cobro_id: string | null
  /** En una fila anulada `monto` vale 0: el valor que tenia vive en `monto_anulado`. */
  anulado_at: string | null
  monto_anulado: number | null
  anulacion_motivo: string | null
  split_json: {
    split_id?: string
    por_reparto?: boolean
    ref_total?: number
    por_devolver?: boolean
    origen?: string
    split_total?: number
    /** Marca de aceptación de ESTA porción por el área financiera. Ver `recaudo-confirmado.ts`. */
    confirmado_at?: string | null
    confirmado_por?: string | null
  } | null
}

/**
 * Tarifa UPME confirmada de MUCHOS negocios, en dos consultas por lote.
 *
 * El resolvedor por negocio (`leerModeloDineroCompleto`) hace 3-4 consultas cada vez:
 * llamarlo dentro del bucle del panel serían ~900 consultas por carga con los 235
 * negocios abiertos de SOENA. Aquí se traen las filas de una y la decisión la aplica
 * `tarifaConfirmadaPorNegocio`, que es la MISMA regla extraída pura (probada en
 * `tarifa-lote.test.ts`).
 *
 * Se filtra por `config_extra.tarifa_confirmacion.enabled`, no por el slug del bloque:
 * ese es el contrato genérico del producto — un workspace puede nombrar su bloque como
 * quiera. Un workspace sin ese bloque devuelve el mapa vacío y todo queda como antes.
 */
async function cargarTarifasConfirmadas(
  supabase: unknown,
  negocioIds: string[],
): Promise<Map<string, number>> {
  if (negocioIds.length === 0) return new Map()

  const [confRes, certRes] = await Promise.all([
    db(supabase)
      .from('negocio_bloques')
      .select('negocio_id, data, bloque_configs!inner(config_extra)')
      .in('negocio_id', negocioIds)
      .eq('bloque_configs.config_extra->tarifa_confirmacion->>enabled', 'true'),
    db(supabase)
      .from('negocio_bloques')
      .select('negocio_id, data, bloque_configs!inner(slug)')
      .in('negocio_id', negocioIds)
      .eq('bloque_configs.slug', 'servicio_contratado'),
  ])

  return tarifaConfirmadaPorNegocio(
    (confRes.data ?? []) as FilaBloqueTarifa[],
    (certRes.data ?? []) as FilaBloqueTarifa[],
  )
}

/**
 * Bloques de propuesta económica de MUCHOS negocios, en una consulta por lote. Los
 * consume `esCeroDeliberado`: una propuesta APROBADA cuyo honorario final es 0 sigue
 * siendo una propuesta aprobada, y distinguir ese caso del "aún sin cotizar" es lo que
 * evita esconderle la cartera a un negocio que sí cerró.
 */
async function cargarPropuestasEconomicas(
  supabase: unknown,
  negocioIds: string[],
): Promise<Map<string, PropuestaBloqueData[]>> {
  const out = new Map<string, PropuestaBloqueData[]>()
  if (negocioIds.length === 0) return out

  const { data } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id, data, bloque_configs!inner(bloque_definitions!inner(tipo))')
    .in('negocio_id', negocioIds)
    .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica')

  for (const fila of ((data ?? []) as Array<{ negocio_id: string; data: Record<string, unknown> | null }>)) {
    if (!fila?.negocio_id) continue
    const lista = out.get(fila.negocio_id)
    if (lista) lista.push({ data: fila.data })
    else out.set(fila.negocio_id, [{ data: fila.data }])
  }
  return out
}

async function cargarNegociosYCobros(
  supabase: unknown,
  workspaceId: string,
  staffId: string | null,
): Promise<{
  negocios: Map<string, NegocioRow>
  cobros: CobroRow[]
  cobrado: Map<string, number>
  /** Recaudo registrado que espera el visto bueno de la financiera, por negocio. */
  pendienteConfirmar: Map<string, number>
}> {
  const { data: negociosRaw } = await db(supabase)
    .from('negocios')
    .select(`
      id, codigo, nombre, precio_aprobado, precio_estimado, estado, stage_actual, created_at,
      etapas_negocio:etapa_actual_id ( nombre, orden ),
      empresas:empresa_id ( nombre )
    `)
    .eq('workspace_id', workspaceId)

  // El viaje de prueba (metadata.es_prueba, F8-1) no entra al panel ni a sus totales para quien
  // no lo lleva ni lo aprueba: ni sus negocios ni sus pagos.
  const ocultosPrueba = await negociosDePruebaOcultos(db(supabase), workspaceId, staffId)
  const filas = sinOcultos((negociosRaw ?? []) as Array<{
    id: string; codigo: string | null; nombre: string | null
    precio_aprobado: number | null; precio_estimado: number | null
    estado: string | null; stage_actual: string | null; created_at: string | null
    etapas_negocio: { nombre: string | null; orden: number | null } | null
    empresas: { nombre: string | null } | null
  }>, ocultosPrueba, (n) => n.id)
  const ids = filas.map((n) => n.id)

  // Una sola marca de tiempo para TODAS las filas de la respuesta: si cada negocio
  // llamara a `Date.now()` por su cuenta, dos casos creados en el mismo instante
  // podrían salir con antigüedades distintas al cruzar la medianoche a mitad del
  // recorrido. Es barato hacerlo bien y caro explicarlo después.
  const ahora = Date.now()

  // Los cobros se cargan ANTES de armar el mapa: el recaudo es una de las señales que
  // deciden si la tarifa de un negocio es cartera (ver `tarifaEsCartera`).
  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, monto, tipo_cobro, plan_cobro_id, external_ref, fuente, fecha, split_json, anulado_at, monto_anulado, anulacion_motivo')
    .eq('workspace_id', workspaceId)
  const cobros = sinOcultos((cobrosRaw ?? []) as CobroRow[], ocultosPrueba, (c) => c.negocio_id)

  // El check de la financiera se necesita ANTES de sumar: es lo que decide si una porción
  // propuesta por el comercial cuenta como recaudo. Se lee aquí, y no más abajo donde ya
  // se leía para otra cosa, porque el orden importa — sumar primero y corregir después
  // dejaría el saldo mal en todo lo que se calcula en medio.
  const { data: concRaw } = await db(supabase)
    .from('negocio_conciliacion')
    .select('negocio_id, conciliado')
    .eq('workspace_id', workspaceId)
  const conciliadoPorNegocio = new Map<string, boolean>()
  for (const r of ((concRaw ?? []) as Array<{ negocio_id: string; conciliado: boolean }>)) {
    conciliadoPorNegocio.set(r.negocio_id, r.conciliado)
  }

  const cobrado = cobradoFinanciero(cobros, conciliadoPorNegocio)
  const pendienteConfirmar = pendienteDeConfirmarPorNegocio(cobros, conciliadoPorNegocio)

  const [tarifas, propuestas] = await Promise.all([
    cargarTarifasConfirmadas(supabase, ids),
    cargarPropuestasEconomicas(supabase, ids),
  ])

  const negocios = new Map<string, NegocioRow>()
  for (const n of filas) {
    const honorario = n.precio_aprobado ?? n.precio_estimado ?? 0
    const tarifa = tarifas.get(n.id) ?? 0
    // Mismo modelo de dinero que el gate de handoff y el saldo del bloque de Cobros,
    // pero preguntando por CARTERA: la tarifa de un negocio sin monto aprobado y sin
    // un peso recaudado todavía no es plata que alguien deba cobrar.
    const valorARecaudarDelNegocio = valorARecaudarCartera(
      honorario,
      { tarifa_upme: tarifa, aprobado_plan: null, aprobado_honorario: null },
      {
        recaudado: cobrado.get(n.id) ?? 0,
        ceroDeliberado: esCeroDeliberado(propuestas.get(n.id) ?? [], n.precio_aprobado),
        honorarioAprobado: n.precio_aprobado,
      },
    )
    negocios.set(n.id, {
      id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      precio: honorario,
      tarifa,
      tarifa_cartera: Math.max(0, valorARecaudarDelNegocio - honorario),
      valor_a_recaudar: valorARecaudarDelNegocio,
      estado: n.estado,
      stage_actual: n.stage_actual,
      etapa_nombre: n.etapas_negocio?.nombre ?? null,
      etapa_orden: n.etapas_negocio?.orden ?? null,
      empresa: n.empresas?.nombre ?? null,
      dias_desde_creacion: diasDesde(n.created_at, ahora),
    })
  }

  return { negocios, cobros, cobrado, pendienteConfirmar }
}

/**
 * Saldo del negocio tal como lo muestra el panel: `> 0` le falta plata a SOENA, `< 0`
 * le sobra. Delega en `saldoConciliacion`, que es la asimetría del producto (falta
 * contra el honorario, sobra contra el valor a recaudar). Existe para que las tres
 * listas del panel no vuelvan a tener cada una su propia resta.
 */
function saldoDelNegocio(neg: NegocioRow | null | undefined, cobrado: number): number {
  if (!neg) return 0
  return saldoConciliacion(
    neg.precio,
    { tarifa_upme: neg.tarifa_cartera, aprobado_plan: null, aprobado_honorario: null },
    cobrado,
  )
}

/** cobrado financiero por negocio (excluye devoluciones pendientes). */
function cobradoFinanciero(
  cobros: CobroRow[],
  conciliadoPorNegocio: Map<string, boolean>,
): Map<string, number> {
  const porNegocio = new Map<string, CobroRow[]>()
  for (const c of cobros) {
    if (!c.negocio_id) continue
    const lista = porNegocio.get(c.negocio_id)
    if (lista) lista.push(c)
    else porNegocio.set(c.negocio_id, [c])
  }

  const m = new Map<string, number>()
  for (const [negocioId, lista] of porNegocio) {
    // MISMA regla que el motor de avance (`sumarRecaudoConfirmado`): una porción que el
    // comercial propuso y la financiera no ha confirmado NO cuenta como recaudo. Antes el
    // panel sumaba todo y el motor no, así que las dos superficies se contradecían sobre
    // el mismo negocio: la pantalla decía "Pagado" y el gate lo retenía por esa misma
    // plata. Medido en V0256 el 2026-08-08: panel $0 contra motor $510.000.
    m.set(
      negocioId,
      sumarRecaudoConfirmado(lista, conciliadoPorNegocio.get(negocioId) ?? false, {
        excluirTipos: ['devolucion_pendiente'],
      }),
    )
  }
  return m
}

/**
 * Plata registrada que espera el visto bueno del área financiera, por negocio.
 *
 * Es exactamente lo que `cobradoFinanciero` dejó por fuera, y existe para NOMBRARLO en
 * pantalla. Sin este dato el panel diría "faltan $X" sobre un negocio cuya plata ya está
 * registrada, y mandaría a la financiera a buscar algo que no se ha perdido: lo que falta
 * es su propia confirmación.
 */
function pendienteDeConfirmarPorNegocio(
  cobros: CobroRow[],
  conciliadoPorNegocio: Map<string, boolean>,
): Map<string, number> {
  const porNegocio = new Map<string, CobroRow[]>()
  for (const c of cobros) {
    if (!c.negocio_id) continue
    const lista = porNegocio.get(c.negocio_id)
    if (lista) lista.push(c)
    else porNegocio.set(c.negocio_id, [c])
  }

  const m = new Map<string, number>()
  for (const [negocioId, lista] of porNegocio) {
    const pendiente = recaudoPendienteDeConfirmar(
      lista,
      conciliadoPorNegocio.get(negocioId) ?? false,
      { excluirTipos: ['devolucion_pendiente'] },
    )
    if (pendiente > 0) m.set(negocioId, pendiente)
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

/**
 * Ids de los cobros que respaldan una cuenta de cobro emitida y NO anulada.
 *
 * El vinculo vive en `cuentas_cobro_emitidas.cobros_ids` (un array), no en
 * `cobros.factura_id`, que esta en 0 de 189 filas. Se resuelve en una consulta para todo
 * el panel. Si la consulta falla se devuelve `null`, y el panel trata TODO como
 * respaldado: no poder comprobar el soporte no es permiso para anular.
 */
async function cobrosConCuentaDeCobroViva(
  supabase: unknown,
  workspaceId: string,
): Promise<{ tiene: (cobroId: string) => boolean }> {
  const ids = new Set<string>()
  const { data, error } = await db(supabase)
    .from('cuentas_cobro_emitidas')
    .select('cobros_ids, estado')
    .eq('workspace_id', workspaceId)
  // No poder comprobar el soporte no es permiso para anular: si la consulta falla, TODO
  // queda como respaldado. Ver `parametro-pendiente-no-se-elige-comodo`.
  if (error) return { tiene: () => true }
  for (const cc of ((data ?? []) as Array<{ cobros_ids: string[] | null; estado: string | null }>)) {
    // Una cuenta con estado NULL retiene igual: el descarte es solo para las anuladas.
    if (cc.estado === 'anulada') continue
    for (const id of cc.cobros_ids ?? []) ids.add(id)
  }
  return { tiene: (cobroId: string) => ids.has(cobroId) }
}

export async function getConciliacionV2(): Promise<{ data: ConciliacionV2 | null; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { data: null, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const { negocios, cobros, cobrado, pendienteConfirmar } = await cargarNegociosYCobros(supabase, workspaceId, staffId ?? null)

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

  // Que cobros respaldan una cuenta de cobro EMITIDA y no anulada. Se lee una vez para
  // todo el panel: por cobro serian tantas consultas como porciones en pantalla.
  const enCuentaCobro = await cobrosConCuentaDeCobroViva(supabase, workspaceId)

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
      const veredicto = evaluarAnulabilidad(r, { enCuentaCobroEmitida: enCuentaCobro.tiene(r.id) })
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
        anulado: esCobroAnulado(r),
        monto_registrado: montoRegistrado(r),
        anulacion_motivo: r.anulacion_motivo,
        anulable: veredicto.anulable,
        bloqueo_anulacion: veredicto.anulable ? null : veredicto.error,
        pendiente_de_confirmar: esPorcionPendienteDeConfirmar(
          r,
          r.negocio_id ? (conciliadoNegocio.get(r.negocio_id) ?? false) : false,
        ),
      }
    })
    const valorPagado = porciones.filter((p) => !p.por_devolver).reduce((s, p) => s + p.monto, 0)
    const negociosImplicados = Array.from(
      new Set(porciones.filter((p) => !p.por_devolver && p.negocio_id).map((p) => p.negocio_id as string)),
    )
    const propuestoPorComercial = rows.some((r) => r.split_json?.origen === 'comercial')
    const algunConciliado = negociosImplicados.some((id) => conciliadoNegocio.get(id) === true)
    // El conteo sale del MISMO módulo que la pantalla usa para filtrar la bandeja.
    const porcionesPorConfirmar = contarPorcionesPorConfirmar(
      rows.map((r) => ({
        cobro: r as unknown as CobroParaRecaudo,
        negocioConciliado: r.negocio_id ? (conciliadoNegocio.get(r.negocio_id) ?? false) : false,
        anulada: esCobroAnulado(r),
      })),
    )
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
      porciones_por_confirmar: porcionesPorConfirmar,
      total_declarado: totalDeclarado,
      sin_asignar: sinAsignar,
      porciones,
      negocios_ids: negociosImplicados,
    })
  }

  // Pestaña 1: SOBREPAGOS (por referencia) + por devolver (global)
  //
  // Una referencia es un sobrepago cuando su pago total supera el VALOR A RECAUDAR
  // del negocio donde cayó (el "origen") = honorario + tarifa UPME. El pago se reparte
  // como porciones editables entre negocios (anticipos parciales): el remanente = pagado -
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
    // Lo que el cliente le debe a SOENA es honorario + tarifa UPME, y las paga en UN
    // recaudo. Comparar contra el honorario a secas convertía a TODO cliente que paga
    // completo en un sobrepago del tamaño exacto de la tarifa.
    const precioOrigen = negOrigin.valor_a_recaudar

    // ref_total: persistido en el cobro de origen una vez se materializa el reparto.
    // Mientras está "fresco", el cobro de origen aún contiene todo el pago.
    const materializado = origin.ref_total != null
    const refTotal = materializado ? (origin.ref_total as number) : origin.monto
    // Mismo piso de materialidad que el resto del sistema (ver `tolerancia-saldo.ts`):
    // un residuo de redondeo no es plata de más que haya que repartir.
    if (refTotal - precioOrigen <= TOLERANCIA_SALDO_COP) continue // no hay sobrepago

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
          saldo: saldoDelNegocio(neg, cob),
        })
      }
    } else {
      // Fresco: por defecto el origen retiene su valor a recaudar; el resto es remanente.
      const cobOrig = cobrado.get(origin.negocio_id ?? '') ?? 0
      asignaciones.push({
        negocio_id: origin.negocio_id,
        codigo: origin.negocio_codigo,
        nombre: origin.negocio_nombre,
        monto: Math.min(precioOrigen, refTotal),
        es_origen: true,
        saldo: saldoDelNegocio(negOrigin, cobOrig),
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
    // El panel usa la MISMA asimetría que el resto del producto (ver
    // `saldoConciliacion`): FALTA contra el honorario, SOBRA contra el valor a recaudar.
    //
    // Medirlo simétrico contra honorario + tarifa, como quedó en #214, llenaba la lista
    // de deudores falsos: el cliente que le paga la tarifa DIRECTO a la UPME aparecía
    // debiendo justo el valor de la tarifa. Medido el 2026-08-06 sobre los 33 faltantes
    // de producción: 25 tenían un faltante idéntico a la tarifa y NINGUNO debía
    // honorario. El sobrepago sí se mide contra el valor a recaudar, y eso no cambia.
    const saldo = saldoDelNegocio(neg, cob)
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
      tarifa_upme: neg.tarifa,
      valor_a_recaudar: neg.valor_a_recaudar,
      cobrado: cob,
      saldo,
      referencias: refsDelNegocio,
      conciliado: conciliadoNegocio.get(negId) ?? false,
      pendiente_de_confirmar: pendienteConfirmar.get(negId) ?? 0,
      dias_desde_creacion: neg.dias_desde_creacion,
    }
    if (saldoCuadrado(saldo)) conciliadosList.push(fila)
    else saldos.push(fila)
  }
  // Primero lo más viejo; el monto solo desempata. El criterio vive en
  // `compararPorAntiguedad`, no acá: ordenar por monto no ordenaba nada porque 86 de los
  // 119 faltantes de SOENA caen en dos grupos de valor idéntico. Ver el módulo.
  saldos.sort(compararPorAntiguedad)

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
      // Valor a recaudar, para que `precio - cobrado` cuadre con `diferencia`.
      precio: s.valor_a_recaudar,
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
  /**
   * Soporte del pago, ya archivado por el caller (Storage + carpeta del negocio en
   * Drive). Viaja en el mismo INSERT que el cobro: un cobro sin su respaldo, aunque sea
   * por un instante, es exactamente el estado que el soporte obligatorio quiere evitar.
   */
  soporte?: Record<string, unknown> | null
  /** Marca de reparto deliberado (`split_id` + `split_total`) cuando el caller la declara. */
  split_json?: Record<string, unknown>
  /**
   * Salta el bloqueo duro por referencia ya usada en otro negocio.
   *
   * NO es un permiso para duplicar: es para el caller que aplica el control CORRECTO
   * sobre esa referencia, que es el de MONTO (la suma registrada no puede superar el
   * pago original — `lib/cobros/sobreasignacion.ts`). Repetir una referencia entre
   * negocios es legitimo cuando un pago se reparte, y hay casos reales asi en
   * produccion; el bloqueo por unicidad los rompe.
   *
   * Quien la pase debe haber evaluado la sobre-asignacion ANTES y declarar el reparto
   * con `split_json`.
   */
  permitirRefCompartida?: boolean
}

/**
 * Núcleo de registro de UN pago contra UN negocio. Fuente ÚNICA de la vía de pago:
 * la usa `agregarPagoFab` (FAB global, guard por rol — `fab-pago-actions.ts`). El
 * reparto/registro del comercial desde el bloque de pagos entra por
 * `repartirPagoComercial` / `editarRepartoComercial` (función de base
 * `guardar_reparto_comercial`). NO duplicar
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

  // Un pago que NO entra por ePayco es un registro EXCEPCIONAL y solo lo hace el
  // área financiera. El comercial sigue registrando sus pagos ePayco como siempre
  // (esa rama no cambia). El chequeo vive aquí, en la vía única de escritura, y se
  // resuelve desde la sesión: así ningún caller puede saltárselo.
  //
  // La regla solo tiene sentido donde existe la pasarela. En un workspace que cobra
  // por transferencia y consignación, TODO pago es "fuera de ePayco": aplicarla ahí
  // no protege nada, apaga el módulo entero. Quién puede registrar un pago en ese
  // caso lo decide `rolHabilitadoParaPagoFab`, que es el guard de ese camino.
  if (
    input.fuente !== 'epayco' &&
    (await workspaceCobraPorEpayco(supabase, workspaceId)) &&
    !(await esAreaFinanciera())
  ) {
    return {
      success: false,
      error: 'Solo el área financiera puede registrar pagos que no entraron por ePayco.',
    }
  }

  const { data: neg } = await db(supabase)
    .from('negocios').select('id, estado').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle()
  if (!neg) return { success: false, error: 'Negocio no encontrado' }
  // Un negocio cerrado no recibe plata. El corte va en la VIA UNICA de escritura
  // (panel de conciliacion y FAB entran los dos por aqui), no en cada pantalla:
  // asi ninguna ruta de entrada futura se lo puede saltar por olvido. Mismo motivo
  // por el que `esAreaFinanciera` vive aqui y no en el caller.
  //
  // El estado sale de la MISMA consulta que ya validaba que el negocio existe y es
  // del workspace: no cuesta un viaje mas.
  if (negocioCerrado((neg as { estado: string | null }).estado)) {
    return { success: false, error: MENSAJE_NEGOCIO_CERRADO }
  }

  // Traza de origen FAB (autor = staff real). Va ADEMÁS del cobro creado abajo:
  // deja constancia de "un comercial registró un pago vía FAB sobre un negocio fuera
  // de su etapa". Solo cuando el insert del cobro tuvo éxito (se llama al final).
  const logFabOrigen = async (refTxt: string) => {
    if (origen !== 'fab' || !staffId) return
    try {
      await registrarActividad(db(supabase), {
        workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: negocioId,
        tipo: 'comentario', autor_id: staffId,
        contenido: `Pago registrado desde el FAB global (origen: fab) — Ref ${refTxt}, fuente ${input.fuente === 'otra' ? (input.fuente_nombre ?? 'otra') : input.fuente}.`,
      }, 'registrarPagoEnNegocio')
    } catch { /* no bloquear por el log */ }
  }

  const referencia = (input.referencia ?? '').trim()
  if (!referencia) return { success: false, error: 'La referencia del pago es obligatoria' }
  const fecha = (input.fecha ?? '').trim() || todayBogotaISO()

  if (input.fuente === 'epayco') {
    // Misma barrera que en `repartirPagoComercial`: la cuenta de ePayco es la de SOENA. Sin
    // ella, un workspace Clarity sin pasarela (Termotech) registraba en SU negocio un pago
    // ePayco aprobado de otro cliente.
    if (!(await workspaceCobraPorEpayco(supabase, workspaceId))) {
      return { success: false, error: MENSAJE_SIN_EPAYCO }
    }
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

    // Un cobro ANULADO no bloquea el re-registro (ver `lib/cobros/anulacion.ts`).
    const { data: existing } = await db(supabase)
      .from('cobros').select('id')
      .eq('workspace_id', workspaceId).eq('negocio_id', negocioId).eq('external_ref', String(refNum))
      .is('anulado_at', null)
      .limit(1)
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

    // Bloqueo DURO de duplicado también para pagos manuales (Davivienda/otra), SALVO
    // que el caller ya haya aplicado el control de monto (ver `permitirRefCompartida`).
    if (!input.permitirRefCompartida) {
      const dupManual = await refDuplicadaNoSplit(supabase, workspaceId, externalRef)
      if (dupManual && dupManual.negocio_id !== negocioId) {
        return {
          success: false,
          error: `Esta referencia ya está registrada en ${dupManual.codigo ?? dupManual.negocio_id}. No se puede cargar duplicada — pide al área financiera que distribuya ese pago entre los negocios.`,
        }
      }
    }

    // Idempotencia: un cobro ANULADO no cuenta como "ya existe". Si contara, anular un
    // pago mal cargado dejaría el negocio sin poder volver a registrarlo con la misma
    // referencia — que es justo el camino que la anulación abre (el monto no se edita:
    // se anula y se vuelve a registrar). Ver `lib/cobros/anulacion.ts`.
    const { data: existing } = await db(supabase)
      .from('cobros').select('id')
      .eq('workspace_id', workspaceId).eq('negocio_id', negocioId).eq('external_ref', externalRef)
      .is('anulado_at', null)
      .limit(1)
    if (existing && (existing as unknown[]).length > 0) return { success: true }

    const { error: insErr } = await db(supabase).from('cobros').insert({
      workspace_id: workspaceId, negocio_id: negocioId, monto,
      tipo_cobro: input.tipo_cobro ?? 'externo', fecha, external_ref: externalRef,
      fuente: fuenteValor, notas: `Pago ${fuenteValor} — Ref ${referencia}`,
      ...(input.soporte ? { soporte: input.soporte } : {}),
      ...(input.split_json ? { split_json: input.split_json } : {}),
    })
    if (insErr) return { success: false, error: (insErr as { message?: string }).message ?? 'No se pudo registrar el pago' }
    await logFabOrigen(referencia)
  }

  // Entró plata nueva: la foto que la financiera dio por buena cambió, así que el negocio
  // vuelve a la cola de revisión. **Esto NO desconfirma ningún reparto**: la aceptación
  // de una referencia vive en su porción (`split_json.confirmado_at`) y este `update` no
  // la toca. Ese era justo el defecto — un pago de septiembre borraba el visto bueno que
  // la financiera le había dado en otra referencia, y el gate de saldo volvía a exigir
  // plata que ya estaba aceptada (SOENA V0498). Ver `lib/negocios/recaudo-confirmado.ts`.
  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId).eq('negocio_id', negocioId)

  // Si este pago dejó el negocio con plata de más, se le avisa a la financiera (opt-in
  // `aviso_sobrepago`). Por aquí entran el FAB y el pago fuera de ePayco de Tesorería.
  await avisarSobrepagoSiCorresponde(workspaceId, negocioId)

  // Si el negocio ya tiene factura, el honorario de este pago se le abona solo (brief del
  // 2026-09-22: el abono es 100 % automático y no depende de `recibo_automatico`). Nunca
  // devuelve error: el pago ya quedó registrado, que es lo que la persona pidió. Corre
  // DESPUÉS de responder: la persona no espera a Siigo (`segundo-plano.ts`).
  await abonarEnSegundoPlano(workspaceId, [negocioId])

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return { success: true }
}

async function refDuplicadaNoSplit(
  supabase: unknown,
  workspaceId: string,
  externalRef: string,
): Promise<{ negocio_id: string; codigo: string | null } | null> {
  // `anulado_at is null`: el duplicado se detecta por PRESENCIA de la referencia, no por
  // su monto, así que el cero de la anulación no basta acá. Ver `lib/cobros/anulacion.ts`.
  const { data } = await db(supabase)
    .from('cobros')
    .select('negocio_id, split_json, negocios:negocio_id ( codigo )')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', externalRef)
    .not('negocio_id', 'is', null)
    .is('anulado_at', null)
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

/** Info del modelo de dinero de un negocio: honorario/plan (propuesta) + tarifa confirmada. */
export type ModeloDineroNegocio = ModeloDinero

/**
 * Modelo de dinero COMPLETO de un negocio — FUENTE ÚNICA compartida por el saldo de
 * Cobros (getNegocioDetalle), el gate de handoff y (vía wrapper) el reparto. Evita la
 * divergencia gate⟺render: todos construyen el modelo igual.
 *
 * - honorario + plan: de la propuesta aprobada (precio_aprobado = honorario).
 * - `tarifa_upme`: tarifa (pasante) CONFIRMADA en el bloque "Confirmar tarifa UPME"
 *   (Validación, config_extra.tarifa_confirmacion). Solo con el toggle marcado; 0 si no.
 * - `tarifa_upme_ref`: referencia calculada (Art. 13), con fallback a la Factura para
 *   negocios legacy. Solo display; NO la leen gates ni reparto.
 *
 * Devuelve null solo si el negocio no tiene ni propuesta ni tarifa (nada que modelar).
 */
export async function leerModeloDineroCompleto(
  supabase: unknown,
  negocioId: string,
): Promise<ModeloDinero | null> {
  // Honorario + plan de la propuesta aprobada (el bloque con plan gana).
  const { data: prop } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(bloque_definitions!inner(tipo))')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica')
  let plan: 1 | 2 | null = null
  let honorario: number | null = null
  for (const pb of ((prop ?? []) as Array<{ data: Record<string, unknown> | null }>)) {
    const d = pb.data
    if (!d) continue
    const p = (d.aprobado_plan === 1 || d.aprobado_plan === 2) ? (d.aprobado_plan as 1 | 2) : null
    const h = d.aprobado_honorario != null ? Number(d.aprobado_honorario) : null
    if (p == null && h == null) continue
    plan = p
    honorario = h != null && Number.isFinite(h) ? h : null
    if (p != null) break
  }

  // Tarifa confirmada + referencia desde el bloque de confirmación (Validación).
  let tarifaConfirmada = 0
  let tarifaRef = 0
  const { data: tarifaBloques } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(config_extra)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.config_extra->tarifa_confirmacion->>enabled', 'true')
  for (const tb of ((tarifaBloques ?? []) as Array<{ data: Record<string, unknown> | null }>)) {
    const d = (tb.data ?? {}) as Record<string, unknown>
    const ref = Number(d.tarifa_upme_ref ?? 0)
    if (Number.isFinite(ref) && ref > 0) tarifaRef = ref
    if (d.tarifa_confirmada === true) {
      const conf = Number(d.tarifa_upme_confirmada ?? 0)
      if (Number.isFinite(conf) && conf > 0) { tarifaConfirmada = conf; break }
    }
  }
  // Fallback de display: negocios legacy sin bloque de confirmación → computa la
  // referencia desde la Factura para no dejar la tarifa invisible en Cobros.
  if (!(tarifaRef > 0)) {
    const { data: facturaBloques } = await db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug)')
      .eq('negocio_id', negocioId)
      .eq('bloque_configs.slug', 'factura_venta_vehiculo')
    // Misma lectura que la inicialización del bloque de confirmación: el punto de
    // miles se lee como miles («350.906» son 350.906 pesos, no 350,906).
    const valorSinIva = valorSinIvaDeFactura(
      (facturaBloques ?? []) as Array<{ data: Record<string, unknown> | null }>,
    )
    if (valorSinIva > 0) tarifaRef = calcularTarifaUpmePorAnio(valorSinIva)
  }

  // Si el negocio NO contrató la certificación UPME, no hay tarifa que pasar al
  // cliente: se vendió solo la gestión de devolución de IVA. La tarifa se computa
  // temprano (en Validación, desde la Factura) y la decisión comercial llega
  // después, así que sin este corte el negocio arrastraría un valor que no le
  // corresponde. Y como este es el único lugar donde se arma el ModeloDinero, basta
  // anularla aquí para que queden bien el gate de handoff, el saldo de Cobros y el
  // reparto pasante/honorario.
  //
  // La regla NO se reimplementa: es `niegaCertificacionUpme`, la misma que usan el
  // recaudo, la propuesta y la conciliación. Estaba duplicada a mano aquí, y una copia
  // es justo lo que permite que dos lugares respondan distinto a la misma pregunta.
  const { data: servicioBloques } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(slug)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', 'servicio_contratado')
  const sinCertificacionUpme = ((servicioBloques ?? []) as Array<{ data: Record<string, unknown> | null }>)
    .some(sb => niegaCertificacionUpme(sb.data))
  if (sinCertificacionUpme) {
    tarifaConfirmada = 0
    tarifaRef = 0
  }

  if (plan == null && honorario == null && !(tarifaConfirmada > 0) && !(tarifaRef > 0)) return null
  const modelo: ModeloDinero = { tarifa_upme: tarifaConfirmada, aprobado_plan: plan, aprobado_honorario: honorario }
  if (tarifaRef > 0) modelo.tarifa_upme_ref = tarifaRef
  return modelo
}

/**
 * Modelo para el REPARTO pasante/honorario: como `leerModeloDineroCompleto` pero
 * devuelve null cuando NO hay tarifa confirmada → el negocio no usa el reparto en 2
 * cobros (no hay pasante; se registra un solo cobro de honorario).
 */
export async function leerModeloDineroNegocio(
  supabase: unknown,
  negocioId: string,
): Promise<ModeloDineroNegocio | null> {
  const modelo = await leerModeloDineroCompleto(supabase, negocioId)
  if (!modelo || !(modelo.tarifa_upme > 0)) return null
  return modelo
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

  // ── Como se parte este pago ──
  // HONORARIO PRIMERO, despues la tarifa (decision de Mauricio, 2026-08-18: "sin eso
  // no detona lo demas"). Antes era al reves, y esa era la segunda regla de imputacion
  // del sistema: la vista del P&L (`v_cobro_valor`) siempre imputo por escalones
  // honorario, tarifa, honorario. Ahora hay una sola, en `lib/upme/imputacion-pago.ts`.
  //
  // `consumidoAntes` es lo que el negocio ya recaudo: sin eso, un segundo pago volveria
  // a llenar el anticipo que ya estaba cubierto y llamaria honorario a plata que es
  // tarifa.
  const { data: previosRaw } = await db(supabase)
    .from('cobros')
    .select('monto, external_ref')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .not('fecha', 'is', null)
  const consumidoAntes = ((previosRaw ?? []) as Array<{ monto: number | null; external_ref: string | null }>)
    // Los de ESTA referencia no cuentan: son este mismo pago, ya partido en una
    // corrida anterior. Contarlos desplazaria la imputacion en cada reintento.
    .filter((c) => c.external_ref !== referencia)
    .reduce((sum, c) => sum + Number(c.monto ?? 0), 0)

  const imputacion = imputarPago({
    pago: monto,
    consumidoAntes,
    escalones: escalonesDelNegocio(
      modelo.aprobado_honorario ?? 0,
      modelo.tarifa_upme,
      modelo.aprobado_plan,
    ),
  })
  const montoPasante = imputacion.pasante
  const montoHonorario = imputacion.honorario
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

  // Cambió el cobrado → des-conciliar. Igual que en `registrarPagoEnNegocio`: devuelve el
  // negocio a la cola de revisión de la financiera, sin desconfirmar las porciones que
  // ella ya aceptó (esas llevan su marca en `split_json.confirmado_at`).
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
 *
 * La aceptación se estampa en la PORCIÓN (`cobros.split_json.confirmado_at`), no solo en
 * el negocio: un check confirma ESTA referencia, y ningún hecho posterior del negocio
 * —un pago nuevo, otro reparto— puede invalidarlo. El flag por negocio se sigue
 * poniendo, porque es el que gobierna las pestañas del panel, pero ya no carga con la
 * confirmación de nadie. Ver `lib/negocios/recaudo-confirmado.ts`.
 *
 * Solo toca lo que está PENDIENTE: una porción ya confirmada no se vuelve a estampar y
 * su negocio no se vuelve a conciliar. Sin ese corte, aceptar la porción que falta
 * re-conciliaría de paso a un negocio cuya situación de plata cambió después —
 * borrándole a la financiera un sobrepago que sí tiene que mirar.
 *
 * Permisos: solo área financiera (Diana) vía ctxFinanciero.
 */
async function aceptarRepartoComercialSinClave(
  externalRef: string,
): Promise<{ success: true; conciliados: number } | { success: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const ref = (externalRef ?? '').trim()
  if (!ref) return { success: false, error: 'Referencia inválida' }

  const { data: cobrosRaw } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, split_json, anulado_at')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', ref)
  const comercial = ((cobrosRaw ?? []) as Array<{
    id: string
    negocio_id: string | null
    split_json: Record<string, unknown> | null
    anulado_at: string | null
  }>).filter((c) => (c.split_json as { origen?: string } | null)?.origen === 'comercial' && c.negocio_id && !c.anulado_at)

  if (comercial.length === 0) {
    return { success: false, error: 'No hay un reparto propuesto por el comercial para esta referencia.' }
  }

  // El estado por negocio vale como confirmación heredada: las porciones aceptadas antes
  // de que existiera la marca en el cobro no tienen otra evidencia.
  const negociosDeLaRef = Array.from(new Set(comercial.map((c) => c.negocio_id as string)))
  const { data: concRaw } = await db(supabase)
    .from('negocio_conciliacion')
    .select('negocio_id, conciliado')
    .eq('workspace_id', workspaceId)
    .in('negocio_id', negociosDeLaRef)
  const conciliadoPrevio = new Map<string, boolean>()
  for (const r of ((concRaw ?? []) as Array<{ negocio_id: string; conciliado: boolean }>)) {
    conciliadoPrevio.set(r.negocio_id, r.conciliado)
  }

  const pendientes = comercial.filter((c) =>
    esPorcionPendienteDeConfirmar(
      c as unknown as CobroParaRecaudo,
      conciliadoPrevio.get(c.negocio_id as string) ?? false,
    ),
  )
  if (pendientes.length === 0) {
    return { success: false, error: 'Este reparto ya está confirmado: no queda ninguna porción por aceptar.' }
  }

  const negociosTocados = Array.from(new Set(pendientes.map((c) => c.negocio_id as string)))
  const nowIso = new Date().toISOString()

  // La marca va en la porción PRIMERO: si algo falla después, la plata ya quedó
  // confirmada y el motor de saldos la cuenta — el orden inverso deja al negocio
  // conciliado con porciones que nadie estampó.
  //
  // ⚠️ `split_json` se RELEE justo antes de escribir, no se arma sobre la copia de
  // arriba: es un jsonb acumulador (split_id, split_total, origen, propuesto_por) y un
  // `{...copia vieja}` pierde cualquier escritura intermedia sin hacer ruido. Misma
  // lección que `guardarMarcaEnMetadata` (PR #500).
  for (const c of pendientes) {
    const { data: fresco } = await db(supabase)
      .from('cobros')
      .select('split_json')
      .eq('id', c.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    const splitVigente = ((fresco as { split_json: Record<string, unknown> | null } | null)?.split_json) ?? c.split_json ?? {}
    const { error: marcaErr } = await db(supabase)
      .from('cobros')
      .update({ split_json: { ...splitVigente, confirmado_at: nowIso, confirmado_por: staffId } })
      .eq('id', c.id)
      .eq('workspace_id', workspaceId)
    if (marcaErr) {
      return { success: false, error: (marcaErr as { message?: string }).message ?? 'No se pudo confirmar una porción del reparto' }
    }
  }

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
        await registrarActividad(db(supabase), {
          workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: id,
          tipo: 'comentario', autor_id: staffId,
          contenido: `Pago conciliado por el área financiera (referencia ${ref}).`,
        }, 'aceptarRepartoComercial')
      } catch { /* no bloquear por el log */ }
    }
  }

  // Lo resolvió una de las dos -> el pendiente desaparece de la campana de
  // TODA el área financiera, no solo de quien hizo clic.
  await resolverPendienteConciliacion(supabase, workspaceId, ref)

  // Al aceptar, las porciones del comercial pasan a contar como recaudo: es el momento en
  // que un reparto puede dejar a un negocio con plata de más.
  for (const id of negociosTocados) await avisarSobrepagoSiCorresponde(workspaceId, id)

  // Y ahora sí es plata del negocio: su honorario se abona a la factura, si la hay. Es el
  // momento que `porQueNoSeAbona` le reservó a las porciones propuestas por el comercial.
  // Corre DESPUÉS de responder (`segundo-plano.ts`): era lo que llevaba «Conciliar» a 19,7 s.
  await abonarEnSegundoPlano(workspaceId, negociosTocados)

  for (const id of negociosTocados) revalidatePath(`/negocios/${id}`)
  revalidatePath('/conciliacion')
  return { success: true, conciliados: negociosTocados.length }
}

/** Cierra el aviso de equipo de una referencia (la atendió alguien del área). */
async function resolverPendienteConciliacion(
  supabase: unknown,
  workspaceId: string,
  referencia: string,
) {
  try {
    await db(supabase).rpc('resolver_grupo_notificaciones', {
      p_workspace_id: workspaceId,
      p_grupo_clave: claveConciliacion(referencia),
      p_resuelta_por: null,
    })
  } catch {
    /* la decisión ya se registró; el aviso se limpia igual al recargar */
  }
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
 *
 * ⚠️⚠️ Tampoco toca una porción YA CONFIRMADA. Desde que una referencia parcialmente
 * confirmada vuelve a ser accionable (2026-09-16), rechazarla alcanzaría con un clic a la
 * plata que la financiera ya había aceptado en OTRO negocio, y borrar un cobro no se
 * deshace. Rechazar devuelve al comercial lo que sigue en duda, nada más.
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
    .select('id, negocio_id, split_json, negocios:negocio_id ( codigo )')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', ref)
  const comercial = ((cobrosRaw ?? []) as Array<{
    id: string
    negocio_id: string | null
    split_json: { origen?: string; confirmado_at?: string | null; propuesto_por?: string | null } | null
    negocios: { codigo: string | null } | null
  }>).filter((c) => c.split_json?.origen === 'comercial' && c.negocio_id)

  if (comercial.length === 0) {
    return { success: false, error: 'No hay un reparto propuesto por el comercial para esta referencia.' }
  }

  const yaConfirmadas = comercial.filter((c) => porcionConfirmadaPorFinanciera(c as unknown as CobroParaRecaudo))
  const porRechazar = comercial.filter((c) => !porcionConfirmadaPorFinanciera(c as unknown as CobroParaRecaudo))
  if (porRechazar.length === 0) {
    return {
      success: false,
      error: 'Todas las porciones de esta referencia ya están confirmadas: para deshacerlas hay que anular cada cobro desde el negocio.',
    }
  }

  const negociosTocados = Array.from(new Set(porRechazar.map((c) => c.negocio_id as string)))

  for (const c of porRechazar) {
    const { error: delErr } = await db(supabase).from('cobros').delete().eq('id', c.id).eq('workspace_id', workspaceId)
    if (delErr) return { success: false, error: (delErr as { message?: string }).message ?? 'No se pudo rechazar el reparto' }
  }

  // Cambió el cobrado → des-conciliar los negocios tocados (defensivo). Un negocio cuya
  // porción de esta referencia ya estaba confirmada NO entra: no se le quitó nada.
  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .in('negocio_id', negociosTocados)

  // Constancia en el timeline de cada negocio. La marca `campo_modificado` es la que lee
  // `estadoRepartosDelNegocio` para pintar «Rechazado: <nota>» en el bloque: las porciones
  // ya no existen, así que es lo único que queda del rechazo.
  const notaTxt = (nota ?? '').trim().slice(0, 300)
  for (const id of negociosTocados) {
    await registrarActividad(db(supabase), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: id,
      tipo: 'cambio_sistema',
      autor_id: staffId,
      campo_modificado: CAMPO_REPARTO_RECHAZADO,
      valor_anterior: ref,
      valor_nuevo: notaTxt || null,
      contenido: `El área financiera rechazó el reparto propuesto para la referencia ${ref}.${notaTxt ? ` Nota: ${notaTxt}` : ''} Vuelve a repartirlo.`,
    }, 'rechazarRepartoComercial')
  }

  // Y el comercial que lo propuso recibe la nota en su campana, no solo en el historial:
  // hasta el 2026-10-19 el rechazo no le avisaba a nadie y el pago quedaba sin registrar.
  await avisarRechazoAlComercial(supabase, workspaceId, {
    referencia: ref,
    nota: notaTxt,
    propuestoPor: porRechazar.map((c) => c.split_json?.propuesto_por).filter((s): s is string => !!s),
    negocioId: negociosTocados[0],
    codigos: porRechazar.map((c) => c.negocios?.codigo).filter((s): s is string => !!s),
  })

  // Rechazar tambien resuelve el pendiente del equipo: la decision ya se tomo.
  await resolverPendienteConciliacion(supabase, workspaceId, ref)

  for (const id of negociosTocados) revalidatePath(`/negocios/${id}`)
  for (const c of yaConfirmadas) if (c.negocio_id) revalidatePath(`/negocios/${c.negocio_id}`)
  revalidatePath('/conciliacion')
  return { success: true, eliminados: porRechazar.length }
}

/**
 * Notificación al comercial que propuso el reparto rechazado. `propuesto_por` es un
 * staff.id; la notificación va al profile de ese staff.
 *
 * Tipo `aprobacion_decidida`: es el del CHECK de `notificaciones` que dice «tu solicitud
 * ya tiene decisión». Un tipo fuera del CHECK hace fallar el insert EN SILENCIO.
 */
async function avisarRechazoAlComercial(
  supabase: unknown,
  workspaceId: string,
  p: { referencia: string; nota: string; propuestoPor: string[]; negocioId: string; codigos: string[] },
) {
  const staffIds = Array.from(new Set(p.propuestoPor))
  if (staffIds.length === 0) return
  try {
    const { data } = await db(supabase)
      .from('staff')
      .select('profile_id')
      .eq('workspace_id', workspaceId)
      .in('id', staffIds)
    const negocios = Array.from(new Set(p.codigos)).join(', ')
    for (const s of ((data ?? []) as Array<{ profile_id: string | null }>)) {
      if (!s.profile_id) continue
      await db(supabase).rpc('crear_notificacion', {
        p_workspace_id: workspaceId,
        p_destinatario_id: s.profile_id,
        p_tipo: 'aprobacion_decidida',
        p_contenido: `El área financiera rechazó tu reparto de la referencia ${p.referencia}${negocios ? ` (${negocios})` : ''}.${p.nota ? ` Nota: ${p.nota}` : ''} Vuelve a repartirlo.`,
        p_entidad_tipo: 'negocio',
        p_entidad_id: p.negocioId,
        p_deep_link: `/negocios/${p.negocioId}`,
        p_metadata: { motivo: 'reparto_rechazado', referencia: p.referencia, nota: p.nota || null },
        p_permitir_repetidas: true,
      })
    }
  } catch {
    // El rechazo ya se aplicó; el historial del negocio conserva la nota.
  }
}

// El registro, listado, correccion y anulacion de pagos fuera de la pasarela vive en
// `src/lib/actions/pagos-externos.ts`. Se movio ahi el 2026-08-11 al dejar de ser solo
// un formulario de captura: ahora tiene listado, control de sobre-asignacion por monto,
// soporte obligatorio y anulacion. La via unica de escritura del cobro sigue siendo
// `registrarPagoEnNegocio`, en este archivo.

// ── Redistribuir una referencia desde el panel de la financiera ────────────────

/**
 * La cuenta de un negocio: lo que tiene recaudado y lo que el cliente le debe.
 *
 * `loQueDebePagar` es `valorARecaudar` (honorario + tarifa pasante), el listón más alto
 * que existe: quien lo cubre no puede estar corto en ninguna etapa. Es `null` cuando no
 * hay con qué medirlo —negocio sin cotizar—, y quien decide qué hacer con esa ausencia
 * es `avisoRecaudoNecesario`, no esta función.
 *
 * La propuesta aprobada con honorario 0 (`esCeroDeliberado`) SÍ es medible: la cuenta es
 * la tarifa, o cero si tampoco hay tarifa. Mismo criterio que los gates de saldo.
 */
async function cuentaDelNegocio(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
): Promise<{ recaudoConfirmado: number; loQueDebePagar: number | null; etapaNombre: string }> {
  const [negRes, cobrosRes, conciliadoRes, propRes, modelo] = await Promise.all([
    db(supabase)
      .from('negocios')
      .select('precio_aprobado, precio_estimado, etapas_negocio!negocios_etapa_actual_id_fkey(nombre)')
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    // db(): `split_json` no está en los tipos generados. Ver `recaudo-confirmado.ts`.
    db(supabase)
      .from('cobros')
      .select('monto, split_json, tipo_cobro')
      .eq('negocio_id', negocioId)
      .eq('workspace_id', workspaceId)
      .is('anulado_at', null),
    db(supabase)
      .from('negocio_conciliacion')
      .select('conciliado')
      .eq('negocio_id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(bloque_definitions!inner(tipo))')
      .eq('negocio_id', negocioId)
      .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica'),
    leerModeloDineroCompleto(supabase, negocioId),
  ])

  const neg = negRes.data as {
    precio_aprobado: number | null
    precio_estimado: number | null
    etapas_negocio: { nombre: string } | null
  } | null

  // Las porciones de esta redistribución llevan `origen: 'redistribucion_financiera'`,
  // no `'comercial'`, así que cuentan aunque el recálculo acabe de tumbar el check de
  // conciliación: las escribió la propia financiera.
  const recaudoConfirmado = sumarRecaudoConfirmado(
    (cobrosRes.data ?? []) as CobroParaRecaudo[],
    (conciliadoRes.data as { conciliado: boolean } | null)?.conciliado === true,
  )

  const honorario = neg?.precio_aprobado ?? neg?.precio_estimado ?? 0
  const propuestas = (propRes.data ?? []) as PropuestaBloqueData[]
  const medible = honorario > 0 || esCeroDeliberado(propuestas, neg?.precio_aprobado ?? null)

  return {
    recaudoConfirmado,
    loQueDebePagar: medible ? valorARecaudar(honorario, modelo) : null,
    etapaNombre: neg?.etapas_negocio?.nombre ?? 'sin etapa',
  }
}

/**
 * Buscador de negocios del modal «Corregir el reparto».
 *
 * ⚠️ Antes el modal usaba `buscarNegociosParaValida`, que exige el módulo Valida y el
 * contrato CDA. En un workspace sin Valida (Soena) devolvía `ok:false`, el modal lo
 * convertía en `[]` y el campo quedaba mudo: se escribía «v0477» y no salía nada. El
 * acceso aquí es el MISMO de `redistribuirReferencia` (`ctxFinanciero`): quien puede
 * guardar el reparto puede buscar a qué negocio va.
 */
export async function buscarNegociosParaReparto(
  termino: string,
): Promise<
  | { ok: true; negocios: Array<{ id: string; codigo: string | null; nombre: string | null }> }
  | { ok: false; error: string }
> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { supabase, workspaceId } = ctx

  const filtro = filtroBusquedaNegocio(termino)
  if (!filtro) return { ok: true, negocios: [] }

  const { data, error } = await db(supabase)
    .from('negocios')
    .select('id, codigo, nombre')
    .eq('workspace_id', workspaceId)
    .or(filtro)
    .order('created_at', { ascending: false })
    .limit(8)

  if (error) return { ok: false, error: (error as { message: string }).message }
  return {
    ok: true,
    negocios: (data ?? []) as Array<{ id: string; codigo: string | null; nombre: string | null }>,
  }
}

/**
 * El área financiera reescribe cómo se reparte una referencia entre negocios.
 *
 * Es UNA operación para los cuatro gestos que antes no existían: repartir, deshacer un
 * reparto, dejar todo en el negocio original y mover la referencia completa a otro
 * negocio. Todos son editar una lista de líneas.
 *
 * ⚠️ Lo que esto reemplaza: hasta el 2026-08-11 solo se podía corregir ANTES de que la
 * financiera aceptara el reparto. Esa acción (`eliminarPorcionPago`, borrada el
 * 2026-08-18) exigía negocio en `venta` Y conciliación sin confirmar, y los errores de
 * plata se descubren tarde: en la práctica la corrección era un SQL a mano. Medido el
 * 2026-08-11: las 2 referencias repartidas del workspace estaban las dos fuera de su
 * alcance.
 *
 * Las reglas viven en `src/lib/cobros/redistribucion.ts` (puro, 15 pruebas). Aquí solo
 * se resuelven contra la base y se ejecutan.
 */
async function redistribuirReferenciaSinClave(input: {
  externalRef: string
  /** Valor real del pago que llegó. Se usa como techo. */
  pagoOriginal: number
  lineas: Array<{ negocioId: string; monto: number; porDevolver?: boolean }>
  motivo: string
}): Promise<
  | { ok: true; negociosAfectados: number; gatesReabiertos: number; sinCambios: boolean }
  | { ok: false; error: string; errores?: string[] }
> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { supabase, workspaceId, userId, staffId } = ctx

  const ref = (input.externalRef ?? '').trim()
  if (!ref) return { ok: false, error: 'Referencia inválida' }

  // ── Estado actual: solo porciones VIGENTES ──
  // `anulado_at is null` no es opcional: una porción anulada tiene `monto = 0` y
  // volvería a entrar al reparto como una línea fantasma.
  const { data: actualesRaw, error: leerErr } = await db(supabase)
    .from('cobros')
    .select('id, negocio_id, monto, negocios:negocio_id ( codigo, metadata )')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', ref)
    .is('anulado_at', null)
    .not('negocio_id', 'is', null)

  if (leerErr) return { ok: false, error: (leerErr as { message: string }).message }

  const actuales = ((actualesRaw ?? []) as Array<{
    id: string
    negocio_id: string
    monto: number
    negocios: { codigo: string | null; metadata: Record<string, unknown> | null } | null
  }>).map(c => ({
    cobroId: c.id,
    negocioId: c.negocio_id,
    negocioCodigo: c.negocios?.codigo ?? null,
    monto: Number(c.monto ?? 0),
    negocioFacturado: Boolean(c.negocios?.metadata && 'siigo_factura' in c.negocios.metadata),
  }))

  // Códigos de los negocios destino, para que los errores hablen en el idioma del
  // operador (V0043) y no en uuid.
  const idsDestino = [...new Set(input.lineas.map(l => l.negocioId))]
  // ⚠️ El error de esta consulta se LEE. Descartarlo hace que un fallo de la base sea
  // indistinguible de "ese negocio no existe", y el operador recibe un mensaje falso
  // sobre datos que sí están ahí (pasó en el QA del 2026-08-11).
  const { data: negsRaw, error: negsErr } = await db(supabase)
    .from('negocios')
    .select('id, codigo')
    .eq('workspace_id', workspaceId)
    .in('id', idsDestino.length > 0 ? idsDestino : ['00000000-0000-0000-0000-000000000000'])

  if (negsErr) return { ok: false, error: (negsErr as { message: string }).message }

  const codigoPorId = new Map(
    ((negsRaw ?? []) as Array<{ id: string; codigo: string | null }>).map(n => [n.id, n.codigo]),
  )

  const faltantes = idsDestino.filter(id => !codigoPorId.has(id))
  if (faltantes.length > 0) {
    return {
      ok: false,
      error: `No se encontró ${faltantes.length === 1 ? 'un negocio' : `${faltantes.length} negocios`} de la lista en este espacio de trabajo (${faltantes.join(', ')})`,
    }
  }

  const plan = planearRedistribucion({
    pagoOriginal: input.pagoOriginal,
    actuales,
    destino: input.lineas.map(l => ({ ...l, negocioCodigo: codigoPorId.get(l.negocioId) ?? null })),
    motivo: input.motivo,
  })

  if (!plan.ok) {
    return { ok: false, error: plan.errores[0] ?? 'No se puede aplicar', errores: plan.errores }
  }

  const motivo = input.motivo.trim()
  const ahora = new Date().toISOString()
  // Con dos o más porciones vivas TODAS llevan la misma marca. Una sola sin ella la
  // leen `refDuplicadaNoSplit` y `negocioCongeladoPorDuplicado` como duplicado
  // accidental y congelan los dos negocios.
  const splitId = requiereSplitId(plan.porcionesResultantes) ? randomUUID() : null

  for (const c of plan.cambios) {
    if (c.accion === 'anular') {
      const { error: anErr } = await db(supabase)
        .from('cobros')
        .update({
          monto: 0,
          monto_anulado: c.montoAnterior,
          anulado_at: ahora,
          // profiles.id, NO staff.id: son tablas disjuntas (0 de 52 ids coinciden) y
          // quien lee esta columna la resuelve contra `profiles`. Escribir el staffId
          // dejaba la anulacion sin autor visible en la pantalla de pagos.
          anulado_por: userId,
          anulacion_motivo: `Redistribución de la referencia ${ref}: ${motivo}`.slice(0, 300),
        })
        .eq('id', c.cobroId)
        .eq('workspace_id', workspaceId)
        .is('anulado_at', null)
      if (anErr) return { ok: false, error: (anErr as { message: string }).message }
      continue
    }

    if (c.accion === 'crear') {
      const { error: crErr } = await db(supabase).from('cobros').insert({
        workspace_id: workspaceId,
        negocio_id: c.negocioId,
        monto: c.montoNuevo,
        fecha: todayBogotaISO(),
        external_ref: ref,
        tipo_cobro: 'pago',
        split_json: { split_id: splitId, split_total: input.pagoOriginal, origen: 'redistribucion_financiera' },
        notas: `Redistribución de la referencia ${ref}: ${motivo}`.slice(0, 1000),
      })
      if (crErr) return { ok: false, error: (crErr as { message: string }).message }
      continue
    }

    // 'ajustar' y 'sin_cambio' comparten el UPDATE: el segundo solo re-estampa la
    // marca de reparto, que puede haber cambiado aunque su monto no.
    const { error: upErr } = await db(supabase)
      .from('cobros')
      .update({
        monto: c.montoNuevo,
        split_json: { split_id: splitId, split_total: input.pagoOriginal, origen: 'redistribucion_financiera' },
      })
      .eq('id', c.cobroId)
      .eq('workspace_id', workspaceId)
      .is('anulado_at', null)
    if (upErr) return { ok: false, error: (upErr as { message: string }).message }
  }

  // ── Lo que el cambio de plata desarma, y el aviso SOLO donde hace falta ──
  //
  // Des-concilia, reevalúa los bloques de cobros y reabre SOLO los gates que se habían
  // cerrado con esta plata. No devuelve de etapa: eso lo decide una persona.
  //
  // El aviso (`recaudo_cambiado_pendiente`) es un gate duro que NO cede al override de
  // owner/admin, así que ponerlo donde no hace falta congela el negocio: hasta el
  // 2026-09-08 ninguna pantalla podía resolverlo y V0442/V0443 quedaron atascados con el
  // reparto perfectamente cuadrado. Ahora lo decide `avisoRecaudoNecesario` **por
  // negocio**, con los gates que se reabrieron EN ESE negocio (antes se le pasaba a
  // todos la suma del reparto completo, así que el aviso de uno reportaba los gates de
  // otro).
  let gatesReabiertos = 0
  for (const negocioId of plan.negociosAfectados) {
    const r = await recalcularNegocioPorCambioDeRecaudo(
      negocioId,
      `redistribución de la referencia ${ref}`,
    )
    gatesReabiertos += r.gates_reabiertos

    const cambio = plan.cambios.find(c => c.negocioId === negocioId)
    const deltaRecaudo = cambio ? cambio.montoNuevo - cambio.montoAnterior : 0

    const cuenta = await cuentaDelNegocio(supabase, workspaceId, negocioId)
    const necesitaAviso = avisoRecaudoNecesario({
      gatesReabiertos: r.gates_reabiertos,
      deltaRecaudo,
      recaudoConfirmado: cuenta.recaudoConfirmado,
      loQueDebePagar: cuenta.loQueDebePagar,
    })

    if (necesitaAviso) {
      // El aviso queda pegado al negocio, lo ven la financiera y el comercial, y vuelve
      // a frenar cuando alguien intenta avanzar (guard en `cambiarEtapaNegocioConGate`).
      await guardarAviso({
        supabase,
        workspaceId,
        negocioId,
        referencia: ref,
        motivo,
        etapaAlCambiar: cuenta.etapaNombre,
        gatesReabiertos: r.gates_reabiertos,
        destinoSugerido: null,
        ahora,
        staffId,
      })
    }

    if (staffId) {
      const detalle = cambio
        ? `${fmtCop(cambio.montoAnterior)} → ${fmtCop(cambio.montoNuevo)}`
        : 'ajustado'
      // El reparto cuadrado no deja aviso, así que el registro es lo único que queda
      // de él: decir cómo terminó evita que después parezca que el aviso se perdió.
      const cierre = necesitaAviso
        ? ' Queda pendiente de resolver por el área financiera.'
        : ' El reparto quedó cuadrado: sin pendientes.'
      await registrarActividad(db(supabase), {
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio_sistema',
        autor_id: staffId,
        contenido: `Recaudo redistribuido por el área financiera (ref ${ref}): ${detalle}. Motivo: ${motivo}.${cierre}`.slice(0, 280),
      }, 'redistribuirReferencia')
    }
  }

  // Las porciones nuevas o ajustadas se abonan a la factura de su negocio, si la hay. Un
  // abono YA emitido sobre una porción que esta redistribución anuló o bajó NO se deshace
  // desde aquí: queda en Siigo y lo anula Tesorería (ONE no borra documentos contables).
  // Corre DESPUÉS de responder (`segundo-plano.ts`).
  await abonarEnSegundoPlano(workspaceId, plan.negociosAfectados)

  revalidatePath('/conciliacion')
  for (const negocioId of plan.negociosAfectados) revalidatePath(`/negocios/${negocioId}`)

  // Un reparto idéntico al actual no mueve plata en ningún negocio. Las escrituras de
  // arriba sí corren (re-estampan la marca de reparto, que puede faltar en una
  // referencia vieja), pero decir «Reparto actualizado» es mentirle a la persona.
  return {
    ok: true,
    negociosAfectados: plan.negociosAfectados.length,
    gatesReabiertos,
    sinCambios: plan.negociosAfectados.length === 0,
  }
}

// ── Retroceso financiero ──────────────────────────────────────────────────────

/**
 * A dónde puede volver el caso, según por qué cambió la plata.
 *
 * Devuelve una PROPUESTA con sus alternativas: la financiera decide, y puede elegir
 * cualquier etapa que el caso haya recorrido. Las reglas viven en
 * `src/lib/negocios/retroceso-financiero.ts` (puro, 15 pruebas).
 */
export async function proponerRetroceso(input: {
  negocioId: string
  causa: CausaRetrocesoFinanciero
}): Promise<
  | { ok: true; propuesta: PropuestaRetroceso; etapaActual: string }
  | { ok: false; error: string }
> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { supabase, workspaceId } = ctx

  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('linea_id, etapas_negocio!negocios_etapa_actual_id_fkey(id, nombre, orden, numero, stage)')
    .eq('id', input.negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const actual = negRaw?.etapas_negocio as
    | { id: string; nombre: string; orden: number; numero: number; stage: string }
    | null
  if (!negRaw?.linea_id || !actual) return { ok: false, error: 'Negocio sin etapa actual' }

  const recorridas = await etapasRecorridas(supabase, input.negocioId, negRaw.linea_id)
  const propuesta = proponerRetrocesoFinanciero({
    causa: input.causa,
    etapaActual: actual,
    etapasRecorridas: recorridas,
  })

  return { ok: true, propuesta, etapaActual: actual.nombre }
}

/**
 * Aplica el retroceso decidido por la financiera y retira el aviso.
 *
 * El movimiento reusa `cambiarEtapaNegocio` (el movedor interno que crea las instancias
 * de la etapa destino con su herencia), inyectado como parámetro para no cerrar un ciclo
 * de imports.
 */
export async function aplicarRetrocesoFinanciero(input: {
  negocioId: string
  causa: CausaRetrocesoFinanciero
  destinoEtapaId: string | null
  motivo: string
}): Promise<{ ok: true; movido: boolean } | { ok: false; error: string; errores?: string[] }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const res = await ejecutarRetroceso({
    supabase,
    workspaceId,
    negocioId: input.negocioId,
    causa: input.causa,
    destinoEtapaId: input.destinoEtapaId,
    motivo: input.motivo,
    staffId,
    moverEtapa: (negocioId, etapaId) => cambiarEtapaNegocio(negocioId, etapaId),
  })

  if (!res.ok) return { ok: false, error: res.error ?? 'No se pudo aplicar', errores: res.errores }

  // Resolver el retroceso ES resolver el aviso: el caso ya está donde su plata lo
  // sostiene. Dejarlo puesto frenaría al comercial por algo ya atendido.
  await resolverAviso({
    supabase,
    workspaceId,
    negocioId: input.negocioId,
    motivo: `Retroceso financiero aplicado: ${input.motivo}`,
    staffId,
  })

  revalidatePath('/conciliacion')
  revalidatePath(`/negocios/${input.negocioId}`)

  return { ok: true, movido: res.movido }
}

/**
 * Retira el aviso de recaudo cambiado, con motivo escrito.
 *
 * Es la SALIDA del gate. Hasta el 2026-09-08 `resolverAviso` solo se alcanzaba desde
 * `aplicarRetrocesoFinanciero`, que ninguna pantalla invocaba: el aviso se ponía solo y
 * no había un botón que lo quitara, así que un negocio con el reparto corregido quedaba
 * congelado de forma permanente (V0442 y V0443).
 *
 * Va bajo `ctxFinanciero()` a propósito: quien cambió la plata es quien puede declarar
 * que ya está resuelta. El comercial la VE —para eso el aviso vive en la ficha— pero no
 * la cierra, que es la misma razón por la que el aviso se persiste en vez de mostrarse
 * una vez (ver la cabecera de `lib/correcciones/retroceso.ts`).
 *
 * El mínimo de 10 caracteres lo aplica `resolverAviso`; acá NO se reimplementa.
 */
export async function resolverAvisoRecaudo(input: {
  negocioId: string
  motivo: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const { error } = await resolverAviso({
    supabase,
    workspaceId,
    negocioId: input.negocioId,
    motivo: input.motivo,
    staffId,
  })
  if (error) return { ok: false, error }

  revalidatePath('/conciliacion')
  revalidatePath(`/negocios/${input.negocioId}`)
  return { ok: true }
}

function fmtCop(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

// ── Idempotencia por intención (brief del doble guardado, 2026-10-06) ──────────────────
// Las acciones de abajo son la puerta pública; su cuerpo vive en `<nombre>SinClave`. Con la
// clave del navegador (`useIntencion`), la misma intención repetida (POST que Chromium
// reenvía, doble toque, «Reintentar» tras «No se confirmó») se ejecuta una sola vez.

/** Envía a la financiera un reparto NUEVO. Si la referencia ya tiene uno, se corrige con `editarRepartoComercial`. */
export async function repartirPagoComercial(input: RepartirPagoInput, intencion?: string) {
  return accionIdempotente<ResultadoReparto>(
    { accion: 'repartirPagoComercial', clave: intencion, args: [input], enCurso: () => ({ success: false, error: MENSAJE_EN_CURSO }) },
    () => guardarRepartoComercialSinClave(input, 'nuevo'),
  )
}

/**
 * Corrige un reparto enviado y todavía sin aprobar: reemplaza todas sus porciones en una
 * transacción y le avisa a la financiera. Aprobado, lo rechaza la base.
 */
export async function editarRepartoComercial(input: RepartirPagoInput, intencion?: string) {
  return accionIdempotente<ResultadoReparto>(
    { accion: 'editarRepartoComercial', clave: intencion, args: [input], enCurso: () => ({ success: false, error: MENSAJE_EN_CURSO }) },
    () => guardarRepartoComercialSinClave(input, 'editar'),
  )
}

export async function aceptarRepartoComercial(externalRef: string, intencion?: string) {
  return accionIdempotente<Awaited<ReturnType<typeof aceptarRepartoComercialSinClave>>>(
    { accion: 'aceptarRepartoComercial', clave: intencion, args: [externalRef], enCurso: () => ({ success: false, error: MENSAJE_EN_CURSO }) },
    () => aceptarRepartoComercialSinClave(externalRef),
  )
}

export async function redistribuirReferencia(input: Parameters<typeof redistribuirReferenciaSinClave>[0], intencion?: string) {
  return accionIdempotente<Awaited<ReturnType<typeof redistribuirReferenciaSinClave>>>(
    { accion: 'redistribuirReferencia', clave: intencion, args: [input], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => redistribuirReferenciaSinClave(input),
  )
}
