'use server'

/**
 * «El cliente confirmó» (F2, post-cotización): plan de pagos, aprobación del plan fuera de la
 * regla, confirmación con mensaje al viajero y prerreserva.
 *
 * Todo detrás de `lineas_negocio.config_extra.plan_pagos.activo` (ausente = apagado = como hoy).
 * Cada acción revisa el rol EN EL SERVIDOR (Vera C15): confirmar, cambiar el plan y mandar
 * mensajes, la comercial dueña del negocio y la dirección; aprobar, solo la dirección.
 *
 * Las lecturas no son acciones: la ficha lee la vista en el servidor (`ConfirmacionViaje`), y
 * después de cada escritura se revalida la página.
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { accionIdempotente } from '@/lib/idempotencia/accion'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { preciosDeLasTarifas } from '@/lib/fiscal/iva-cotizacion-datos'
import { duplicarCotizacionCompleta } from '@/lib/cotizaciones/duplicar-cotizacion'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { generarServiciosDesdeTarifa } from '@/lib/viaje/servicios-viaje-datos'
import { archivarSoporte, type SoporteSubidoInput } from '@/lib/cobros/soporte-pago'
import {
  configPlanPagos,
  fechaCorta,
  huellaPlan,
  leerCuotas,
  pesos,
  planSugerido,
  validarPlan,
  type CuotaPlan,
} from '@/lib/viaje/plan-pagos'
import {
  enlaceWhatsApp,
  leerTitular,
  mensajeConfirmacion,
  primerNombre,
  seccionesDeTerminos,
} from '@/lib/viaje/confirmacion'
import {
  aplicarPrerreservaVencida,
  aprobacionVigenteParaHuella,
  avisarAprobadores,
  etapaDeConfirmacion,
  guardarVersionPlan,
  type ConfirmacionGuardada,
} from '@/lib/viaje/confirmacion-datos'
import { enviarCorreoAlViajero, trazarWhatsAppManual } from '@/lib/viaje/correo-viajero'
import { contextoViaje, nombreYCorreo, type ContextoViaje } from '@/lib/viaje/contexto-viaje'
import { aceptarCotizacionNegocio } from './[id]/cotizacion/actions'
import { cambiarEtapaNegocio } from './negocio-v2-actions'

const MENSAJE_EN_CURSO = 'Tu acción anterior todavía se está guardando. Espera un momento.'
const SIN_PERMISO = 'Solo la comercial del negocio o la dirección pueden hacer esto.'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

type Contexto = ContextoViaje
const contexto = contextoViaje

/** El total contra el que se mide el plan: el precio de la tarifa elegida (el mismo cálculo que la aprobación). */
async function totalDeTarifa(db: Db, workspaceId: string, cotizacionId: string, itinerarioId: string | null): Promise<{ ok: true; total: number; nombre: string | null } | { ok: false; error: string }> {
  const precios = await preciosDeLasTarifas(db, { workspaceId, cotizacionId })
  if (!precios.ok) return { ok: false, error: precios.error }
  if (precios.tarifas.length === 0) {
    const { data } = await db.from('cotizaciones').select('valor_total').eq('id', cotizacionId).maybeSingle()
    const v = Number((data as { valor_total?: number } | null)?.valor_total ?? 0)
    return v > 0 ? { ok: true, total: v, nombre: null } : { ok: false, error: 'La cotización no tiene total.' }
  }
  const t = itinerarioId ? precios.tarifas.find((x) => x.itinerarioId === itinerarioId) : precios.tarifas.find((x) => x.esRecomendada)
  if (!t) return { ok: false, error: 'Esa tarifa no iba en la propuesta.' }
  if (t.precio === null) return { ok: false, error: t.motivo ?? 'No se pudo calcular el precio de esa tarifa.' }
  return { ok: true, total: t.precio, nombre: t.nombre }
}

async function cotizacionDelNegocio(db: Db, negocioId: string, cotizacionId: string): Promise<{ id: string; estado: string; tarifa_aceptada_id: string | null; consecutivo: string | null } | null> {
  const { data } = await db.from('cotizaciones').select('*').eq('id', cotizacionId).eq('negocio_id', negocioId).maybeSingle()
  return (data as { id: string; estado: string; tarifa_aceptada_id: string | null; consecutivo: string | null } | null) ?? null
}

// ── Plan propuesto (versión nueva) ───────────────────────────────────────────

export interface EntradaPlan {
  negocioId: string
  cotizacionId: string
  itinerarioId: string | null
  cuotas: CuotaPlan[]
  motivo: string | null
}

async function prepararPlan(ctx: Contexto, input: EntradaPlan) {
  const cuotas = leerCuotas(input.cuotas)
  if (!cuotas) return { ok: false as const, error: 'Las cuotas no tienen forma de plan (fecha y monto en cada una).' }
  const cot = await cotizacionDelNegocio(ctx.supabase, ctx.negocio.id, input.cotizacionId)
  if (!cot) return { ok: false as const, error: 'Cotización no encontrada en este negocio.' }
  const total = await totalDeTarifa(ctx.supabase, ctx.workspaceId, cot.id, input.itinerarioId)
  if (!total.ok) return { ok: false as const, error: total.error }
  const { viaje } = await leerViajeDelNegocio(ctx.supabase, ctx.negocio.id)
  const regla = configPlanPagos(ctx.configLinea).regla
  const hoy = todayBogotaISO()
  const v = validarPlan(cuotas, { total: total.total, fechaSalida: viaje.fechas.inicio, hoy, regla })
  const sugerido = planSugerido({ total: total.total, fechaSalida: viaje.fechas.inicio, hoy, regla })
  const esSugerido = !!sugerido && huellaPlan(sugerido, total.total) === huellaPlan(cuotas, total.total)
  return { ok: true as const, cuotas, cot, total: total.total, tarifaNombre: total.nombre, viaje, regla, hoy, v, origen: esSugerido ? ('sugerido' as const) : ('ajustado' as const) }
}

async function guardarPlanPropuestoSinClave(input: EntradaPlan) {
  const c = await contexto(input.negocioId)
  if (!c.ok) return { ok: false as const, error: c.error }
  if (!c.ctx.puedeConfirmar) return { ok: false as const, error: SIN_PERMISO }
  const p = await prepararPlan(c.ctx, input)
  if (!p.ok) return p
  if (!p.v.cuadra) return { ok: false as const, error: `Las cuotas suman ${pesos(p.v.suma)} y el viaje vale ${pesos(p.total)}.` }
  const r = await guardarVersionPlan(c.ctx.supabase, {
    workspaceId: c.ctx.workspaceId,
    negocioId: input.negocioId,
    cotizacionId: p.cot.id,
    cuotas: p.cuotas,
    total: p.total,
    fechaReferencia: p.viaje.fechas.inicio,
    regla: p.regla,
    dentroDeRegla: p.v.dentroDeRegla,
    origen: p.origen,
    motivo: input.motivo?.trim().slice(0, 500) || null,
    staffId: c.ctx.staffId,
    acordar: false,
    aprobacionId: null,
  })
  if (!r.ok) return r
  revalidatePath(`/negocios/${input.negocioId}`)
  return { ok: true as const, version: r.version }
}

export async function guardarPlanPropuesto(input: EntradaPlan, intencion?: string) {
  return accionIdempotente<Awaited<ReturnType<typeof guardarPlanPropuestoSinClave>>>(
    { accion: 'guardarPlanPropuesto', clave: intencion, args: [input], enCurso: () => ({ ok: false as const, error: MENSAJE_EN_CURSO }) },
    () => guardarPlanPropuestoSinClave(input),
  )
}

// ── Aprobación del plan fuera de la regla (F2-3) ─────────────────────────────

async function pedirAprobacionPlanSinClave(input: EntradaPlan) {
  const c = await contexto(input.negocioId)
  if (!c.ok) return { ok: false as const, error: c.error }
  if (!c.ctx.puedeConfirmar) return { ok: false as const, error: SIN_PERMISO }
  const p = await prepararPlan(c.ctx, input)
  if (!p.ok) return p
  if (!p.v.cuadra) return { ok: false as const, error: `Las cuotas suman ${pesos(p.v.suma)} y el viaje vale ${pesos(p.total)}.` }
  if (p.v.dentroDeRegla) return { ok: false as const, error: 'El plan está dentro de la regla: no hace falta pedir aprobación.' }

  const guardado = await guardarVersionPlan(c.ctx.supabase, {
    workspaceId: c.ctx.workspaceId,
    negocioId: input.negocioId,
    cotizacionId: p.cot.id,
    cuotas: p.cuotas,
    total: p.total,
    fechaReferencia: p.viaje.fechas.inicio,
    regla: p.regla,
    dentroDeRegla: false,
    origen: 'ajustado',
    motivo: input.motivo?.trim().slice(0, 500) || null,
    staffId: c.ctx.staffId,
    acordar: false,
    aprobacionId: null,
  })
  if (!guardado.ok) return guardado

  // La escribe solo el servidor (la tabla no concede escritura a la sesión). Una pedida anterior
  // del mismo negocio que no se decidió caduca: la vigente es la de estas cuotas.
  const svc = createServiceClient() as Db
  await svc
    .from('aprobaciones_excepcion')
    .update({ estado: 'caducada' })
    .eq('negocio_id', input.negocioId)
    .eq('tipo', 'plan_fuera_de_regla')
    .eq('estado', 'solicitada')
  const huella = huellaPlan(p.cuotas, p.total)
  const pct = Math.floor(p.v.pctAlMinimo)
  const { data: ap, error } = await svc
    .from('aprobaciones_excepcion')
    .insert({
      workspace_id: c.ctx.workspaceId,
      negocio_id: input.negocioId,
      entidad_tipo: 'plan_pago',
      entidad_id: guardado.planId,
      tipo: 'plan_fuera_de_regla',
      estado: 'solicitada',
      huella,
      detalle: {
        total: p.total,
        fecha_minimo: p.v.fechaMinimo,
        pct_al_minimo: pct,
        despues_del_viaje: p.v.despuesDelViaje,
        cuotas: p.cuotas,
        razon: input.motivo?.trim().slice(0, 500) || null,
      },
      solicitada_por: c.ctx.staffId,
    })
    .select('id')
    .single()
  if (error || !ap) return { ok: false as const, error: `No se pudo pedir la aprobación: ${error?.message ?? 'sin respuesta'}` }
  await svc.from('negocio_planes_pago').update({ aprobacion_id: (ap as { id: string }).id }).eq('id', guardado.planId)

  const cliente = c.ctx.negocio.nombre ?? 'el negocio'
  const porque = p.v.fechaMinimo
    ? `al ${fechaCorta(p.v.fechaMinimo)} llevaría el ${pct} % (la regla pide el ${p.regla.pct_minimo} %)`
    : 'el plan no se puede medir contra la fecha del viaje'
  await avisarAprobadores(svc, {
    workspaceId: c.ctx.workspaceId,
    configLinea: c.ctx.configLinea,
    negocioId: input.negocioId,
    entidadId: guardado.planId,
    tipo: 'aprobacion_pendiente',
    contenido: `Plan de pagos fuera de la regla en ${cliente}: ${porque}. ¿Lo apruebas?`,
  })
  await registrarActividad(c.ctx.supabase, {
    workspace_id: c.ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: input.negocioId,
    tipo: 'cambio',
    autor_id: c.ctx.staffId,
    contenido: `Pidió a dirección aprobar el plan de pagos v${guardado.version} (fuera de la regla: ${porque}).`.slice(0, 280),
  }, 'pedirAprobacionPlan')
  revalidatePath(`/negocios/${input.negocioId}`)
  return { ok: true as const }
}

export async function pedirAprobacionPlan(input: EntradaPlan, intencion?: string) {
  return accionIdempotente<Awaited<ReturnType<typeof pedirAprobacionPlanSinClave>>>(
    { accion: 'pedirAprobacionPlan', clave: intencion, args: [input], enCurso: () => ({ ok: false as const, error: MENSAJE_EN_CURSO }) },
    () => pedirAprobacionPlanSinClave(input),
  )
}

async function decidirAprobacionPlanSinClave(negocioId: string, aprobacionId: string, decision: 'aprobada' | 'rechazada', motivo: string | null) {
  const c = await contexto(negocioId)
  if (!c.ok) return { ok: false as const, error: c.error }
  if (!c.ctx.esDireccion) return { ok: false as const, error: 'Solo la dirección aprueba un plan fuera de la regla.' }
  const razon = motivo?.trim() ?? ''
  if (decision === 'rechazada' && razon.length < 3) return { ok: false as const, error: 'Escribe por qué no lo apruebas (le llega a quien lo pidió).' }
  if (!c.ctx.staffId) return { ok: false as const, error: 'Tu usuario no está en el equipo del espacio.' }

  const svc = createServiceClient() as Db
  const { data, error } = await svc
    .from('aprobaciones_excepcion')
    .update({ estado: decision, decidida_por: c.ctx.staffId, decidida_at: new Date().toISOString(), motivo: razon || null })
    .eq('id', aprobacionId)
    .eq('negocio_id', negocioId)
    .eq('workspace_id', c.ctx.workspaceId)
    .eq('tipo', 'plan_fuera_de_regla')
    .eq('estado', 'solicitada')
    .select('id, solicitada_por, entidad_id')
  if (error) return { ok: false as const, error: error.message }
  const fila = ((data ?? []) as Array<{ id: string; solicitada_por: string | null; entidad_id: string }>)[0]
  if (!fila) return { ok: false as const, error: 'Esa solicitud ya se decidió o caducó.' }

  if (fila.solicitada_por) {
    await avisarAprobadores(svc, {
      workspaceId: c.ctx.workspaceId,
      configLinea: c.ctx.configLinea,
      negocioId,
      entidadId: fila.entidad_id,
      tipo: 'aprobacion_decidida',
      destinatariosStaff: [fila.solicitada_por],
      contenido: decision === 'aprobada'
        ? `Aprobado el plan de pagos de ${c.ctx.negocio.nombre ?? 'el negocio'}. Ya puedes confirmarlo con el cliente.`
        : `No aprobado el plan de pagos de ${c.ctx.negocio.nombre ?? 'el negocio'}: ${razon}`,
    })
  }
  await registrarActividad(c.ctx.supabase, {
    workspace_id: c.ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio',
    autor_id: c.ctx.staffId,
    contenido: (decision === 'aprobada' ? 'Aprobó el plan de pagos fuera de la regla.' : `No aprobó el plan de pagos: ${razon}`).slice(0, 280),
  }, 'decidirAprobacionPlan')
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true as const }
}

export async function decidirAprobacionPlan(negocioId: string, aprobacionId: string, decision: 'aprobada' | 'rechazada', motivo: string | null, intencion?: string) {
  return accionIdempotente<Awaited<ReturnType<typeof decidirAprobacionPlanSinClave>>>(
    { accion: 'decidirAprobacionPlan', clave: intencion, args: [negocioId, aprobacionId, decision, motivo], enCurso: () => ({ ok: false as const, error: MENSAJE_EN_CURSO }) },
    () => decidirAprobacionPlanSinClave(negocioId, aprobacionId, decision, motivo),
  )
}

// ── «El cliente confirmó» (F2-2, C1, C16) ────────────────────────────────────

export interface EntradaConfirmacion extends EntradaPlan {
  /** `YYYY-MM-DD`: cuándo dijo que sí. Hoy por defecto. */
  fechaConfirmacion: string | null
  titular: unknown
  /** Correo del viajero si el contacto no lo tenía (opcional, no bloquea; Vera C1.6). */
  correoCliente: string | null
  /** Hora de vencimiento de la tarifa congelada (ISO), o null. */
  prerreservaVence: string | null
  extra: string | null
  pantallazo: SoporteSubidoInput | null
}

export type ResultadoConfirmacion =
  | { ok: true; servicios: number; waUrl: string; correo: 'enviado' | 'omitido' | 'fallido'; avisoTitular: string | null; nombre: string }
  | { ok: false; error: string }

async function confirmarClienteViajeSinClave(input: EntradaConfirmacion): Promise<ResultadoConfirmacion> {
  const c = await contexto(input.negocioId)
  if (!c.ok) return { ok: false, error: c.error }
  const ctx = c.ctx
  if (!ctx.puedeConfirmar) return { ok: false, error: SIN_PERMISO }

  // Ya confirmado: una segunda confirmación no rehace nada (un cambio de plan es otra acción).
  const previa = (ctx.negocio.metadata?.confirmacion_cliente ?? null) as ConfirmacionGuardada | null
  if (previa?.registrada_at) return { ok: false, error: 'Este negocio ya tiene la confirmación del cliente registrada.' }

  const p = await prepararPlan(ctx, input)
  if (!p.ok) return { ok: false, error: p.error }
  if (!p.v.cuadra) {
    return { ok: false, error: p.v.diferencia > 0 ? `Faltan ${pesos(p.v.diferencia)}: las cuotas no suman el total del viaje.` : `Sobran ${pesos(-p.v.diferencia)}: las cuotas suman más que el total del viaje.` }
  }
  if (p.v.despuesDelViaje && p.viaje.fechas.inicio) {
    return { ok: false, error: 'Hay una cuota después del día del viaje.' }
  }
  const huella = huellaPlan(p.cuotas, p.total)
  let aprobacionId: string | null = null
  if (!p.v.dentroDeRegla) {
    aprobacionId = await aprobacionVigenteParaHuella(ctx.supabase, input.negocioId, huella)
    if (!aprobacionId) return { ok: false, error: 'El plan está fuera de la regla: pídele a la dirección que lo apruebe antes de confirmar.' }
  }

  // Titular de facturación.
  const { data: contactoRow } = ctx.negocio.contacto_id
    ? await ctx.supabase.from('contactos').select('id, nombre, email, telefono').eq('id', ctx.negocio.contacto_id).maybeSingle()
    : { data: null }
  const contacto = contactoRow as { id: string; nombre: string; email: string | null; telefono: string | null } | null
  const correoNuevo = input.correoCliente?.trim() || null
  const viajero = { nombre: contacto?.nombre ?? ctx.negocio.nombre ?? 'Cliente', correo: contacto?.email ?? correoNuevo, telefono: contacto?.telefono ?? null }
  const titular = leerTitular(input.titular, viajero)
  if (!titular.ok) return { ok: false, error: titular.error }
  if (correoNuevo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoNuevo)) return { ok: false, error: 'El correo del cliente no parece válido.' }

  const fechaConf = input.fechaConfirmacion && /^\d{4}-\d{2}-\d{2}$/.test(input.fechaConfirmacion) ? input.fechaConfirmacion : p.hoy
  if (fechaConf > p.hoy) return { ok: false, error: 'La fecha de la confirmación no puede ser futura.' }
  let prerreserva: { vence_at: string; estado: 'vigente' } | null = null
  if (input.prerreservaVence) {
    const ms = Date.parse(input.prerreservaVence)
    if (Number.isNaN(ms) || ms <= Date.now()) return { ok: false, error: 'La hora de vencimiento de la tarifa congelada tiene que ser futura.' }
    prerreserva = { vence_at: new Date(ms).toISOString(), estado: 'vigente' }
  }

  // 1. La cotización queda aceptada con la tarifa que escogió (y nacen los servicios, F0).
  if (p.cot.estado === 'aceptada') {
    if (input.itinerarioId && p.cot.tarifa_aceptada_id && p.cot.tarifa_aceptada_id !== input.itinerarioId) {
      return { ok: false, error: 'La cotización ya está aprobada con otra tarifa. Corrígela antes de confirmar con esta.' }
    }
  } else {
    const acep = await aceptarCotizacionNegocio(p.cot.id, input.negocioId, input.itinerarioId)
    if (!acep.success) return { ok: false, error: acep.error ?? 'No se pudo aprobar la cotización.' }
  }
  // Idempotente: si ya estaban, no duplica; si la aceptación no alcanzó a crearlas, las trae.
  await generarServiciosDesdeTarifa(ctx.supabase, { workspaceId: ctx.workspaceId, negocioId: input.negocioId, cotizacionId: p.cot.id, staffId: ctx.staffId })
  const { count: servicios } = await ctx.supabase
    .from('negocio_servicios')
    .select('id', { count: 'exact', head: true })
    .eq('negocio_id', input.negocioId)
    .neq('estado', 'cancelado')

  // 2. El plan acordado.
  const plan = await guardarVersionPlan(ctx.supabase, {
    workspaceId: ctx.workspaceId,
    negocioId: input.negocioId,
    cotizacionId: p.cot.id,
    cuotas: p.cuotas,
    total: p.total,
    fechaReferencia: p.viaje.fechas.inicio,
    regla: p.regla,
    dentroDeRegla: p.v.dentroDeRegla,
    origen: p.origen,
    motivo: input.motivo?.trim().slice(0, 500) || null,
    staffId: ctx.staffId,
    acordar: true,
    aprobacionId,
  })
  if (!plan.ok) return { ok: false, error: plan.error }

  // 3. El mensaje (la constancia de lo acordado, D6) con las condiciones escritas (D-9).
  const [{ data: ws }, yo] = await Promise.all([
    ctx.supabase.from('workspaces').select('name').eq('id', ctx.workspaceId).maybeSingle(),
    nombreYCorreo(ctx.supabase, ctx.staffId),
  ])
  const agencia = ((ws as { name?: string } | null)?.name ?? '').trim() || 'la agencia'
  const comercial = yo.nombre
  const correoComercial = yo.correo
  const texto = mensajeConfirmacion({
    nombreCliente: viajero.nombre,
    destino: p.viaje.destino,
    fechaSalida: p.viaje.fechas.inicio,
    fechaRegreso: p.viaje.fechas.fin,
    composicion: p.viaje.composicion,
    tarifaNombre: p.tarifaNombre,
    total: p.total,
    cuotas: p.cuotas,
    fechaMinimo: p.v.fechaMinimo,
    pctMinimo: p.regla.pct_minimo,
    hoy: p.hoy,
    terminos: seccionesDeTerminos(typeof ctx.configLinea.terminos_base === 'string' ? ctx.configLinea.terminos_base : null),
    extra: input.extra?.slice(0, 1000) ?? null,
    comercial: comercial ? primerNombre(comercial) : null,
    agencia,
  })
  const waUrl = enlaceWhatsApp(viajero.telefono, texto)

  // 4. El correo, si hay (además del WhatsApp que manda la comercial).
  if (correoNuevo && contacto && !contacto.email) {
    await ctx.supabase.from('contactos').update({ email: correoNuevo }).eq('id', contacto.id).eq('workspace_id', ctx.workspaceId)
  }
  const correo = await enviarCorreoAlViajero({
    workspaceId: ctx.workspaceId,
    negocioId: input.negocioId,
    para: viajero.correo,
    replyTo: correoComercial,
    agencia,
    asunto: `Tu viaje con ${agencia}: confirmación y plan de pagos`,
    texto,
    idempotencyKey: `confirmacion-viaje:${input.negocioId}:${plan.planId}`,
  })

  // 5. La pantalla del sí, si la pegaron.
  let pantallazo: Record<string, unknown> | null = null
  if (input.pantallazo?.storage_path) {
    const { userId } = await getWorkspace()
    pantallazo = await archivarSoporte(ctx.supabase, ctx.workspaceId, input.negocioId, input.pantallazo, 'Confirmación', userId ?? '')
  }

  // 6. La confirmación en el negocio (lo leen los gates de la etapa y la factura de empresa, C4).
  const ahora = new Date().toISOString()
  const confirmacion: ConfirmacionGuardada = {
    registrada_at: ahora,
    registrada_por: ctx.staffId,
    registrada_por_nombre: comercial,
    fecha: fechaConf,
    cotizacion_id: p.cot.id,
    itinerario_id: input.itinerarioId,
    tarifa_nombre: p.tarifaNombre,
    total: p.total,
    plan_id: plan.planId,
    pantallazo,
    mensaje: { texto, preparado_at: ahora, wa_url: waUrl, enviado_at: null, enviado_por: null, enviado_por_nombre: null, correo },
  }
  const { data: negFresco } = await ctx.supabase.from('negocios').select('metadata').eq('id', input.negocioId).maybeSingle()
  const metaBase = ((negFresco as { metadata?: Record<string, unknown> } | null)?.metadata ?? ctx.negocio.metadata ?? {}) as Record<string, unknown>
  const metaNueva: Record<string, unknown> = {
    ...metaBase,
    confirmacion_cliente: confirmacion,
    titular_facturacion: { ...titular.titular, registrado_at: ahora },
    ...(prerreserva ? { prerreserva } : {}),
  }
  const { error: errMeta } = await ctx.supabase
    .from('negocios')
    .update({ metadata: metaNueva, updated_at: ahora })
    .eq('id', input.negocioId)
    .eq('workspace_id', ctx.workspaceId)
  if (errMeta) return { ok: false, error: `El plan quedó guardado, pero no la confirmación: ${errMeta.message}` }

  // 7. El negocio queda en la etapa de confirmación (C16: «gana» y «el cliente confirmó» son una acción).
  if (ctx.negocio.linea_id) {
    const { data: etapas } = await ctx.supabase
      .from('etapas_negocio')
      .select('id, nombre, numero, orden, config_extra, is_active')
      .eq('linea_id', ctx.negocio.linea_id)
      .order('orden', { ascending: true })
    const lista = ((etapas ?? []) as Array<{ id: string; nombre: string; numero: number; orden: number; config_extra: Record<string, unknown> | null; is_active?: boolean }>).filter((e) => e.is_active !== false)
    const destino = etapaDeConfirmacion(lista)
    const { data: negEtapa } = await ctx.supabase.from('negocios').select('etapa_actual_id').eq('id', input.negocioId).maybeSingle()
    const actual = lista.find((e) => e.id === (negEtapa as { etapa_actual_id?: string } | null)?.etapa_actual_id)
    if (destino && actual && actual.orden < destino.orden) {
      const mov = await cambiarEtapaNegocio(input.negocioId, destino.id)
      if (mov.error) console.error('[confirmarClienteViaje] la confirmación quedó, pero el negocio no pasó de etapa:', mov.error)
    }
  }

  await registrarActividad(ctx.supabase, {
    workspace_id: ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: input.negocioId,
    tipo: 'cambio',
    autor_id: ctx.staffId,
    contenido: `El cliente confirmó${p.tarifaNombre ? ` la tarifa ${p.tarifaNombre}` : ''} por ${pesos(p.total)}. Plan de pagos v${plan.version} con ${p.cuotas.length} cuota${p.cuotas.length === 1 ? '' : 's'}${p.v.dentroDeRegla ? '' : ' (aprobado por dirección)'}. Factura a nombre de ${titular.titular.nombre}.`.slice(0, 280),
  }, 'confirmarClienteViaje')

  revalidatePath(`/negocios/${input.negocioId}`)
  return { ok: true, servicios: servicios ?? 0, waUrl, correo: correo.estado, avisoTitular: titular.aviso, nombre: primerNombre(viajero.nombre) }
}

export async function confirmarClienteViaje(input: EntradaConfirmacion, intencion?: string): Promise<ResultadoConfirmacion> {
  return accionIdempotente<ResultadoConfirmacion>(
    { accion: 'confirmarClienteViaje', clave: intencion, args: [input], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => confirmarClienteViajeSinClave(input),
  )
}

// ── «Ya lo mandé» (C1.2: la traza del WhatsApp de la comercial) ──────────────

async function marcarConfirmacionEnviadaSinClave(negocioId: string) {
  const c = await contexto(negocioId)
  if (!c.ok) return { ok: false as const, error: c.error }
  if (!c.ctx.puedeConfirmar) return { ok: false as const, error: SIN_PERMISO }
  const meta = (c.ctx.negocio.metadata ?? {}) as Record<string, unknown>
  const conf = meta.confirmacion_cliente as ConfirmacionGuardada | undefined
  if (!conf?.mensaje) return { ok: false as const, error: 'No hay mensaje de confirmación preparado.' }
  if (conf.mensaje.enviado_at) return { ok: true as const }

  const [yo, { data: contacto }] = await Promise.all([
    nombreYCorreo(c.ctx.supabase, c.ctx.staffId),
    c.ctx.negocio.contacto_id ? c.ctx.supabase.from('contactos').select('telefono').eq('id', c.ctx.negocio.contacto_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const nombre = yo.nombre
  const ahora = new Date().toISOString()
  const metaNueva = {
    ...meta,
    confirmacion_cliente: { ...conf, mensaje: { ...conf.mensaje, enviado_at: ahora, enviado_por: c.ctx.staffId, enviado_por_nombre: nombre } },
  }
  const { error } = await c.ctx.supabase.from('negocios').update({ metadata: metaNueva }).eq('id', negocioId).eq('workspace_id', c.ctx.workspaceId)
  if (error) return { ok: false as const, error: error.message }
  await trazarWhatsAppManual({
    workspaceId: c.ctx.workspaceId,
    negocioId,
    telefono: (contacto as { telefono?: string } | null)?.telefono ?? null,
    copiaA: yo.correo,
    titulo: 'Confirmación del viaje y plan de pagos',
  })
  await registrarActividad(c.ctx.supabase, {
    workspace_id: c.ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio',
    autor_id: c.ctx.staffId,
    contenido: `${nombre ?? 'La comercial'} mandó la confirmación al cliente por WhatsApp.`.slice(0, 280),
  }, 'marcarConfirmacionEnviada')
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true as const }
}

export async function marcarConfirmacionEnviada(negocioId: string, intencion?: string) {
  return accionIdempotente<Awaited<ReturnType<typeof marcarConfirmacionEnviadaSinClave>>>(
    { accion: 'marcarConfirmacionEnviada', clave: intencion, args: [negocioId], enCurso: () => ({ ok: false as const, error: MENSAJE_EN_CURSO }) },
    () => marcarConfirmacionEnviadaSinClave(negocioId),
  )
}

// ── Prerreserva vencida al abrir el negocio (C9) ─────────────────────────────

/**
 * La ficha la llama al ver una prerreserva ya vencida (el cron la aplica a primera hora; esto
 * cubre el resto del día). Idempotente: si ya se aplicó o hubo pago, no hace nada.
 */
export async function aplicarPrerreservaSiVencio(negocioId: string) {
  const { workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false as const, error: 'No autenticado' }
  const svc = createServiceClient() as Db
  const r = await aplicarPrerreservaVencida(svc, {
    workspaceId,
    negocioId,
    ahoraMs: Date.now(),
    duplicar: async (cotizacionId) => {
      const d = await duplicarCotizacionCompleta(svc, { workspaceId, cotizacionId, negocioId })
      return d.ok ? { ok: true, id: d.id } : { ok: false, error: d.error }
    },
  })
  if (r.aplicada) revalidatePath(`/negocios/${negocioId}`)
  return { ok: true as const, aplicada: r.aplicada }
}
