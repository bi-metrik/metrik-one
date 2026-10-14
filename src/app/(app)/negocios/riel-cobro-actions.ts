'use server'

/**
 * Riel de cobro al viajero (F2, post-cotización): pegar el comprobante en cualquier etapa →
 * lectura → confirmar → pago registrado → recibo de caja → avance de la etapa con el anticipo.
 *
 * Todo detrás de `lineas_negocio.config_extra.plan_pagos.activo`. Registrar el pago del viajero lo
 * hacen la comercial dueña (o quien además de operaciones tiene área comercial y lleva el negocio)
 * y la dirección; el servidor lo revisa (Vera C15, §7.4).
 *
 * «Deshacer (8)» (Vera C7.4): el pago se registra al confirmar (la plata entró y el riel se mueve en
 * el acto); durante 8 s se puede deshacer y, pasados, la pantalla pide el recibo
 * (`consolidarPagoViajero`). Si se cierra la pestaña antes, el recibo no se pierde: queda pendiente
 * con «Reintentar» en la cabecera.
 */

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { accionIdempotente } from '@/lib/idempotencia/accion'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { extractFieldsFromDocument } from '@/lib/ai/extract-fields'
import { BUCKET_DOCUMENTOS_ONE, esRutaDeWorkspace } from '@/lib/almacenamiento/referencia'
import { archivarSoporte, type SoporteSubidoInput } from '@/lib/cobros/soporte-pago'
import { contextoViaje, nombreYCorreo } from '@/lib/viaje/contexto-viaje'
import { pesos } from '@/lib/viaje/plan-pagos'
import {
  CAMPOS_COMPROBANTE,
  mensajeRecibo,
  pagoRepetido,
  propuestaDesdeLectura,
  type LecturaComprobante,
} from '@/lib/viaje/riel-cobro'
import { cuentasDelNegocio, emitirReciboViaje, leerVistaRiel } from '@/lib/viaje/riel-cobro-datos'
import { etapaDeConfirmacion, evaluarGatesConfirmacion } from '@/lib/viaje/confirmacion-datos'
import { enlaceWhatsApp } from '@/lib/viaje/confirmacion'
import { enviarCorreoAlViajero } from '@/lib/viaje/correo-viajero'
import { cambiarEtapaNegocioConGate, recalcularNegocioPorCambioDeRecaudo } from './negocio-v2-actions'

const MENSAJE_EN_CURSO = 'Tu acción anterior todavía se está guardando. Espera un momento.'
const SIN_PERMISO = 'Solo la comercial del negocio o la dirección registran pagos del viajero.'
/** Ventana en la que «Deshacer» todavía borra el pago (la pantalla ofrece 8 s; el margen es la red). */
const VENTANA_DESHACER_MS = 2 * 60 * 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// ── Lectura del comprobante (F2-4) ───────────────────────────────────────────

export type ResultadoLectura =
  | { ok: true; lectura: LecturaComprobante; leido: boolean; aviso: string | null }
  | { ok: false; error: string }

/**
 * Lee el comprobante que el navegador ya subió a Storage. Propone; la persona confirma. Si no se
 * puede leer, devuelve la propuesta vacía para escribirla a mano (la foto ya quedó guardada).
 */
export async function leerComprobantePago(negocioId: string, soporte: SoporteSubidoInput): Promise<ResultadoLectura> {
  const c = await contextoViaje(negocioId)
  if (!c.ok) return { ok: false, error: c.error }
  if (!c.ctx.puedeConfirmar) return { ok: false, error: SIN_PERMISO }
  if (!esRutaDeWorkspace(soporte.storage_path, c.ctx.workspaceId)) return { ok: false, error: 'Ese archivo no es de este espacio.' }

  const vacia: LecturaComprobante = { monto: null, fecha: null, banco: null, referencia: null, cuentaId: null, pareceProveedor: false }
  const apiKey = process.env.GEMINI_API_KEY ?? ''
  if (!apiKey) return { ok: true, lectura: vacia, leido: false, aviso: 'No se pudo leer el comprobante: escribe los datos a mano.' }
  try {
    const svc = createServiceClient() as Db
    const { data: archivo, error } = await svc.storage.from(BUCKET_DOCUMENTOS_ONE).download(soporte.storage_path)
    if (error || !archivo) return { ok: true, lectura: vacia, leido: false, aviso: 'No se pudo abrir el comprobante: escribe los datos a mano.' }
    const buffer = Buffer.from(await (archivo as Blob).arrayBuffer())
    const mime = soporte.mime_type || (soporte.file_name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
    const r = await extractFieldsFromDocument(buffer, mime, CAMPOS_COMPROBANTE, apiKey)
    if (!r.data) return { ok: true, lectura: vacia, leido: false, aviso: 'No se pudo leer el comprobante: escribe los datos a mano.' }
    const [cuentas, { data: ws }] = await Promise.all([
      cuentasDelNegocio(c.ctx.workspaceId, c.ctx.configLinea),
      c.ctx.supabase.from('workspaces').select('name').eq('id', c.ctx.workspaceId).maybeSingle(),
    ])
    const lectura = propuestaDesdeLectura(r.data, cuentas, ((ws as { name?: string } | null)?.name ?? '').trim())
    // C17: fuera de una fila, pegar abre «pago del viajero»; si parece un pago a un proveedor, se dice.
    const aviso = lectura.pareceProveedor ? 'Parece un pago a un proveedor. ¿Es de un servicio? Si es así, regístralo en la fila del servicio.' : null
    return { ok: true, lectura, leido: true, aviso }
  } catch (e) {
    console.error('[leerComprobantePago]', e instanceof Error ? e.message : e)
    return { ok: true, lectura: vacia, leido: false, aviso: 'No se pudo leer el comprobante: escribe los datos a mano.' }
  }
}

// ── Registrar el pago (F2-5) ─────────────────────────────────────────────────

export interface EntradaPagoViajero {
  negocioId: string
  monto: number
  /** `YYYY-MM-DD` del pago. */
  fecha: string
  cuentaId: string
  referencia: string | null
  banco: string | null
  soporte: SoporteSubidoInput
  /** La persona vio el aviso de referencia repetida y confirma que es otro pago. */
  confirmarRepetido?: boolean
}

export type ResultadoPagoViajero =
  | { ok: true; cobroId: string; avanzo: string | null; textoAvance: string | null }
  | { ok: false; error: string; repetido?: boolean }

async function registrarPagoViajeroSinClave(input: EntradaPagoViajero): Promise<ResultadoPagoViajero> {
  const c = await contextoViaje(input.negocioId)
  if (!c.ok) return { ok: false, error: c.error }
  const ctx = c.ctx
  if (!ctx.puedeConfirmar) return { ok: false, error: SIN_PERMISO }

  const monto = Math.round(Number(input.monto))
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Escribe el valor del pago.' }
  const hoy = todayBogotaISO()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha) || input.fecha > hoy) return { ok: false, error: 'La fecha del pago no puede ser futura.' }
  const cuentas = await cuentasDelNegocio(ctx.workspaceId, ctx.configLinea)
  const cuenta = cuentas.find((x) => x.id === input.cuentaId)
  if (!cuenta) return { ok: false, error: 'Elige la cuenta donde entró el pago.' }
  if (!input.soporte?.storage_path) return { ok: false, error: 'Pega o sube el comprobante.' }

  const { data: previos } = await ctx.supabase.from('cobros').select('*').eq('negocio_id', input.negocioId).eq('workspace_id', ctx.workspaceId)
  const existentes = (previos ?? []) as Array<{ monto: number; fecha: string | null; external_ref?: string | null; anulado_at?: string | null }>
  if (!input.confirmarRepetido && pagoRepetido(existentes, input.referencia, monto)) {
    return { ok: false, repetido: true, error: `Ya hay un pago de ${pesos(monto)} con la referencia ${input.referencia}. ¿Es otro pago?` }
  }

  const soporte = await archivarSoporte(ctx.supabase, ctx.workspaceId, input.negocioId, input.soporte, 'Pagos del cliente', ctx.userId ?? '')
  if (!soporte) return { ok: false, error: 'No se pudo guardar el comprobante.' }

  const primero = !existentes.some((p) => !!p.fecha && !p.anulado_at)
  const { data: fila, error } = await ctx.supabase
    .from('cobros')
    .insert({
      workspace_id: ctx.workspaceId,
      negocio_id: input.negocioId,
      monto,
      fecha: input.fecha,
      tipo_cobro: primero ? 'anticipo' : 'pago',
      cuenta_recaudo: cuenta.id,
      soporte,
      external_ref: input.referencia?.trim().slice(0, 120) || null,
      notas: input.banco ? `Desde ${input.banco.trim().slice(0, 80)}` : null,
      created_by: ctx.staffId,
    })
    .select('id')
    .single()
  if (error || !fila) return { ok: false, error: `No se pudo registrar el pago: ${error?.message ?? 'sin respuesta'}` }
  const cobroId = (fila as { id: string }).id

  try { await recalcularNegocioPorCambioDeRecaudo(input.negocioId, 'pago del viajero') } catch (e) {
    console.error('[registrarPagoViajero] no se pudo reevaluar el negocio:', e instanceof Error ? e.message : e)
  }

  await registrarActividad(ctx.supabase, {
    workspace_id: ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: input.negocioId,
    tipo: 'cambio',
    autor_id: ctx.staffId,
    contenido: `Pago del cliente de ${pesos(monto)} del ${input.fecha}, entró a ${cuenta.nombre}${input.referencia ? ` (ref. ${input.referencia})` : ''}.`.slice(0, 280),
  }, 'registrarPagoViajero')

  // F2-8: con el anticipo, la etapa de confirmación pasa sola y operaciones se entera.
  const avance = await avanzarConElAnticipo(ctx, cobroId)
  revalidatePath(`/negocios/${input.negocioId}`)
  return { ok: true, cobroId, avanzo: avance?.etapa ?? null, textoAvance: avance?.texto ?? null }
}

export async function registrarPagoViajero(input: EntradaPagoViajero, intencion?: string): Promise<ResultadoPagoViajero> {
  return accionIdempotente<ResultadoPagoViajero>(
    { accion: 'registrarPagoViajero', clave: intencion, args: [input], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => registrarPagoViajeroSinClave(input),
  )
}

type Ctx = Extract<Awaited<ReturnType<typeof contextoViaje>>, { ok: true }>['ctx']

async function avanzarConElAnticipo(ctx: Ctx, cobroId: string): Promise<{ etapa: string; texto: string } | null> {
  if (!ctx.negocio.linea_id) return null
  const { data: etapasRaw } = await ctx.supabase
    .from('etapas_negocio')
    .select('id, nombre, numero, orden, config_extra, is_active')
    .eq('linea_id', ctx.negocio.linea_id)
    .order('orden', { ascending: true })
  const etapas = ((etapasRaw ?? []) as Array<{ id: string; nombre: string; numero: number; orden: number; config_extra: Record<string, unknown> | null; is_active?: boolean }>).filter((e) => e.is_active !== false)
  const conf = etapaDeConfirmacion(etapas)
  const { data: neg } = await ctx.supabase.from('negocios').select('etapa_actual_id, metadata, nombre').eq('id', ctx.negocio.id).maybeSingle()
  const actual = (neg as { etapa_actual_id?: string } | null)?.etapa_actual_id
  if (!conf || actual !== conf.id) return null
  const pendientes = await evaluarGatesConfirmacion(ctx.supabase, {
    workspaceId: ctx.workspaceId,
    negocioId: ctx.negocio.id,
    gates: ((conf.config_extra?.gates ?? []) as string[]),
    mensajes: ((conf.config_extra?.gate_messages ?? {}) as Record<string, string>),
  })
  if (pendientes.length > 0) return null
  const siguiente = etapas.find((e) => e.orden > conf.orden)
  if (!siguiente) return null
  const mov = await cambiarEtapaNegocioConGate(ctx.negocio.id, siguiente.id)
  if (mov.error) {
    console.warn('[registrarPagoViajero] el anticipo entró pero la etapa no pasó:', mov.error)
    return null
  }
  // Marca para «Deshacer»: si se deshace este pago, el negocio vuelve a la confirmación.
  const meta = ((neg as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>
  const { data: negDespues } = await ctx.supabase.from('negocios').select('metadata').eq('id', ctx.negocio.id).maybeSingle()
  const metaDespues = ((negDespues as { metadata?: Record<string, unknown> } | null)?.metadata ?? meta) as Record<string, unknown>
  await ctx.supabase.from('negocios').update({ metadata: { ...metaDespues, avance_por_pago: { cobro_id: cobroId, desde: conf.id } } }).eq('id', ctx.negocio.id)

  // Operaciones se entera (F2-8): «{cliente} pagó el anticipo. Ya puedes reservar».
  const { data: contacto } = ctx.negocio.contacto_id
    ? await ctx.supabase.from('contactos').select('nombre').eq('id', ctx.negocio.contacto_id).maybeSingle()
    : { data: null }
  const cliente = (contacto as { nombre?: string } | null)?.nombre?.trim() || ctx.negocio.nombre || 'El cliente'
  const texto = `${cliente} pagó el anticipo. Ya puedes reservar.`
  await avisarOperaciones(ctx, texto)
  return { etapa: siguiente.nombre, texto }
}

async function avisarOperaciones(ctx: Ctx, texto: string): Promise<void> {
  const svc = createServiceClient() as Db
  const { data: resp } = await svc.from('negocio_responsables').select('staff_id').eq('negocio_id', ctx.negocio.id).eq('rol', 'operaciones')
  let staffIds = ((resp ?? []) as Array<{ staff_id: string }>).map((r) => r.staff_id)
  if (staffIds.length === 0) {
    const { data: area } = await svc.from('staff_areas').select('staff_id, staff!inner(workspace_id, is_active)').eq('area', 'operaciones').eq('staff.workspace_id', ctx.workspaceId)
    staffIds = ((area ?? []) as Array<{ staff_id: string; staff?: { is_active?: boolean | null } | null }>).filter((a) => a.staff?.is_active !== false).map((a) => a.staff_id)
  }
  if (staffIds.length === 0) return
  const { data: perfiles } = await svc.from('staff').select('profile_id').eq('workspace_id', ctx.workspaceId).in('id', staffIds)
  const ids = [...new Set(((perfiles ?? []) as Array<{ profile_id: string | null }>).map((p) => p.profile_id).filter((x): x is string => !!x))]
  if (ids.length === 0) return
  const { error } = await svc.from('notificaciones').insert(ids.map((p) => ({
    workspace_id: ctx.workspaceId,
    destinatario_id: p,
    tipo: 'handoff',
    estado: 'pendiente',
    contenido: texto.slice(0, 500),
    entidad_tipo: 'negocio',
    entidad_id: ctx.negocio.id,
    deep_link: `/negocios/${ctx.negocio.id}`,
    metadata: { negocio_id: ctx.negocio.id, motivo: 'anticipo_registrado' },
  })))
  if (error) console.error('[registrarPagoViajero] no se pudo avisar a operaciones:', error.message)
}

// ── Deshacer (8) ─────────────────────────────────────────────────────────────

async function deshacerPagoViajeroSinClave(negocioId: string, cobroId: string) {
  const c = await contextoViaje(negocioId)
  if (!c.ok) return { ok: false as const, error: c.error }
  if (!c.ctx.puedeConfirmar) return { ok: false as const, error: SIN_PERMISO }
  const { data: cobro } = await c.ctx.supabase
    .from('cobros')
    .select('*')
    .eq('id', cobroId)
    .eq('negocio_id', negocioId)
    .eq('workspace_id', c.ctx.workspaceId)
    .maybeSingle()
  const fila = cobro as { created_at?: string | null; created_by?: string | null; siigo_recibo?: unknown } | null
  if (!fila) return { ok: true as const }
  if (fila.siigo_recibo) return { ok: false as const, error: 'El recibo ya salió: el pago se anula con motivo, no se deshace.' }
  const edad = Date.now() - Date.parse(fila.created_at ?? '')
  if (!(edad >= 0 && edad <= VENTANA_DESHACER_MS) || (fila.created_by && fila.created_by !== c.ctx.staffId)) {
    return { ok: false as const, error: 'Ya pasó el momento de deshacer: el pago se anula con motivo.' }
  }
  const { error } = await c.ctx.supabase.from('cobros').delete().eq('id', cobroId).eq('workspace_id', c.ctx.workspaceId)
  if (error) return { ok: false as const, error: error.message }

  // Si este pago movió la etapa, vuelve.
  const { data: neg } = await c.ctx.supabase.from('negocios').select('metadata').eq('id', negocioId).maybeSingle()
  const meta = ((neg as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>
  const avance = meta.avance_por_pago as { cobro_id?: string; desde?: string } | undefined
  if (avance?.cobro_id === cobroId && avance.desde) {
    const resto = { ...meta }
    delete resto.avance_por_pago
    await c.ctx.supabase.from('negocios').update({ etapa_actual_id: avance.desde, metadata: resto }).eq('id', negocioId).eq('workspace_id', c.ctx.workspaceId)
  }
  try { await recalcularNegocioPorCambioDeRecaudo(negocioId, 'pago deshecho') } catch { /* el pago ya no está */ }
  await registrarActividad(c.ctx.supabase, {
    workspace_id: c.ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio',
    autor_id: c.ctx.staffId,
    contenido: 'Deshizo el registro de un pago del cliente antes de emitir el recibo.',
  }, 'deshacerPagoViajero')
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true as const }
}

export async function deshacerPagoViajero(negocioId: string, cobroId: string, intencion?: string) {
  return accionIdempotente<Awaited<ReturnType<typeof deshacerPagoViajeroSinClave>>>(
    { accion: 'deshacerPagoViajero', clave: intencion, args: [negocioId, cobroId], enCurso: () => ({ ok: false as const, error: MENSAJE_EN_CURSO }) },
    () => deshacerPagoViajeroSinClave(negocioId, cobroId),
  )
}

// ── Recibo de caja y aviso al cliente (F2-6, Noor §7.2) ──────────────────────

export type ResultadoConsolidar =
  | { ok: true; numero: string | null; pendiente: string | null; waUrl: string; correo: 'enviado' | 'omitido' | 'fallido' }
  | { ok: false; error: string }

async function consolidarPagoViajeroSinClave(negocioId: string, cobroId: string): Promise<ResultadoConsolidar> {
  const c = await contextoViaje(negocioId)
  if (!c.ok) return { ok: false, error: c.error }
  if (!c.ctx.puedeConfirmar) return { ok: false, error: SIN_PERMISO }
  const { data: cobro } = await c.ctx.supabase.from('cobros').select('id, monto').eq('id', cobroId).eq('negocio_id', negocioId).maybeSingle()
  if (!cobro) return { ok: false, error: 'Ese pago ya no está.' }
  const yo = await nombreYCorreo(c.ctx.supabase, c.ctx.staffId)
  const recibo = await emitirReciboViaje({ workspaceId: c.ctx.workspaceId, negocioId, cobroId, staffNombre: yo.nombre, configLinea: c.ctx.configLinea })

  const vista = await leerVistaRiel(c.ctx.supabase, c.ctx.workspaceId, negocioId)
  const monto = Number((cobro as { monto: number }).monto)
  const texto = vista
    ? mensajeRecibo({ nombreCliente: vista.cliente.nombre, monto, riel: vista.riel, numeroRecibo: recibo.numero, agencia: vista.agencia })
    : `Recibimos tu pago de ${pesos(monto)}. ¡Gracias!`
  const correo = await enviarCorreoAlViajero({
    workspaceId: c.ctx.workspaceId,
    negocioId,
    para: vista?.cliente.correo ?? null,
    replyTo: yo.correo,
    agencia: vista?.agencia ?? 'Tu agencia',
    asunto: recibo.numero ? `Recibimos tu pago · recibo de caja ${recibo.numero}` : 'Recibimos tu pago',
    texto,
    idempotencyKey: `recibo-viaje:${cobroId}:${recibo.numero ?? 'sin-numero'}`,
  })
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true, numero: recibo.numero, pendiente: recibo.pendiente, waUrl: enlaceWhatsApp(vista?.cliente.telefono ?? null, texto), correo: correo.estado }
}

export async function consolidarPagoViajero(negocioId: string, cobroId: string, intencion?: string): Promise<ResultadoConsolidar> {
  return accionIdempotente<ResultadoConsolidar>(
    { accion: 'consolidarPagoViajero', clave: intencion, args: [negocioId, cobroId], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => consolidarPagoViajeroSinClave(negocioId, cobroId),
  )
}

/** «Reintentar» un recibo pendiente (C7.1). Idempotente: un recibo ya emitido no sale dos veces. */
export async function reintentarReciboViaje(negocioId: string, cobroId: string, intencion?: string) {
  return accionIdempotente<{ ok: true; numero: string | null; pendiente: string | null } | { ok: false; error: string }>(
    { accion: 'reintentarReciboViaje', clave: intencion, args: [negocioId, cobroId], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    async () => {
      const c = await contextoViaje(negocioId)
      if (!c.ok) return { ok: false, error: c.error }
      if (!c.ctx.puedeConfirmar) return { ok: false, error: SIN_PERMISO }
      const yo = await nombreYCorreo(c.ctx.supabase, c.ctx.staffId)
      const r = await emitirReciboViaje({ workspaceId: c.ctx.workspaceId, negocioId, cobroId, staffNombre: yo.nombre, configLinea: c.ctx.configLinea })
      revalidatePath(`/negocios/${negocioId}`)
      return { ok: true, ...r }
    },
  )
}
