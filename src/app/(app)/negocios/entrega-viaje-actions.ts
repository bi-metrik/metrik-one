'use server'

/**
 * «Documentos y entrega» (F4, post-cotización; Vera §6 F4, C1, C11).
 *
 * Todo detrás de `lineas_negocio.config_extra.entrega_viaje.activo` (y del plan de pagos, que es
 * de donde sale el cobro mínimo). Cada acción revisa el rol EN EL SERVIDOR (Vera §7.4):
 *   · enviar el paquete: la comercial dueña del negocio y la dirección;
 *   · «Enviar igual» sin el 80 %: solo la dirección, con motivo (aprobación registrada, tipo
 *     `enviar_paquete_sin_cobro`, que cuenta en su tablero);
 *   · cargar documentos del viajero: la comercial dueña, operaciones y la dirección.
 *
 * El paquete sale por C1: el PDF queda en Storage, el correo lo lleva adjunto si el contacto tiene
 * correo, y la comercial lo manda desde su WhatsApp con el mensaje listo (`wa.me`) y toca «Ya lo
 * mandé». Al enviar queda `negocios.metadata.paquete_viaje.enviado_at`: lo lee la cola de
 * facturación de F5 (persona natural: paquete enviado y saldo en cero).
 */

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { accionIdempotente } from '@/lib/idempotencia/accion'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { extractFieldsFromDocument } from '@/lib/ai/extract-fields'
import { BUCKET_DOCUMENTOS_ONE, construirReferenciaOne, esRutaDeWorkspace, hrefArchivo } from '@/lib/almacenamiento/referencia'
import type { SoporteSubidoInput } from '@/lib/cobros/soporte-pago'
import { contextoViaje, nombreYCorreo } from '@/lib/viaje/contexto-viaje'
import { enlaceWhatsApp } from '@/lib/viaje/confirmacion'
import { enviarCorreoAlViajero, trazarWhatsAppManual } from '@/lib/viaje/correo-viajero'
import {
  CAMPOS_PASAPORTE,
  configEntrega,
  documentoDesdeLectura,
  mensajePaquete,
  mensajeVouchers,
  type LecturaDocumento,
  type TipoDocumentoViajero,
} from '@/lib/viaje/entrega'
import { leerVistaEntrega } from '@/lib/viaje/entrega-datos'
import { armarPaquetePdf } from '@/lib/viaje/entrega-paquete'

const MENSAJE_EN_CURSO = 'Tu acción anterior todavía se está guardando. Espera un momento.'
const APAGADO = 'Esta línea no usa la entrega del viaje.'
const SIN_PERMISO_ENVIO = 'Solo la comercial del negocio o la dirección envían el paquete.'
const SIN_PERMISO_DOCS = 'Solo la comercial del negocio, operaciones o la dirección cargan documentos del viajero.'
const SOLO_DIRECCION = 'Solo la dirección puede enviar el paquete sin el cobro mínimo.'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

type Ctx = Extract<Awaited<ReturnType<typeof contextoViaje>>, { ok: true }>['ctx']

async function contexto(negocioId: string): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const c = await contextoViaje(negocioId)
  if (!c.ok) return c
  if (!configEntrega(c.ctx.configLinea).activo) return { ok: false, error: APAGADO }
  return c
}

async function esDeOperaciones(ctx: Ctx): Promise<boolean> {
  if (!ctx.staffId) return false
  const { data } = await ctx.supabase.from('staff_areas').select('area').eq('staff_id', ctx.staffId).eq('area', 'operaciones')
  return ((data ?? []) as unknown[]).length > 0
}

// ── Documentos del viajero (F4-2, C11) ───────────────────────────────────────

export type ResultadoLecturaDocumento =
  | { ok: true; lectura: LecturaDocumento; leido: boolean; aviso: string | null }
  | { ok: false; error: string }

const LECTURA_VACIA: LecturaDocumento = { numero: null, nombre: null, pais: null, fecha_emision: null, fecha_vencimiento: null }
const NO_PUDE_LEER = 'No pude leer el pasaporte. Escribe el número y el vencimiento.'

/** Lee el pasaporte que el navegador ya subió. Propone; la persona confirma. */
export async function leerDocumentoViajero(negocioId: string, soporte: SoporteSubidoInput): Promise<ResultadoLecturaDocumento> {
  const c = await contexto(negocioId)
  if (!c.ok) return c
  if (!c.ctx.puedeConfirmar && !(await esDeOperaciones(c.ctx))) return { ok: false, error: SIN_PERMISO_DOCS }
  if (!esRutaDeWorkspace(soporte.storage_path, c.ctx.workspaceId)) return { ok: false, error: 'Ese archivo no es de este espacio.' }
  const apiKey = process.env.GEMINI_API_KEY ?? ''
  if (!apiKey) return { ok: true, lectura: LECTURA_VACIA, leido: false, aviso: NO_PUDE_LEER }
  try {
    const { data: archivo, error } = await (createServiceClient() as Db).storage.from(BUCKET_DOCUMENTOS_ONE).download(soporte.storage_path)
    if (error || !archivo) return { ok: true, lectura: LECTURA_VACIA, leido: false, aviso: NO_PUDE_LEER }
    const buffer = Buffer.from(await (archivo as Blob).arrayBuffer())
    const mime = soporte.mime_type || (soporte.file_name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
    const r = await extractFieldsFromDocument(buffer, mime, CAMPOS_PASAPORTE, apiKey)
    if (!r.data) return { ok: true, lectura: LECTURA_VACIA, leido: false, aviso: NO_PUDE_LEER }
    return { ok: true, lectura: documentoDesdeLectura(r.data), leido: true, aviso: null }
  } catch (e) {
    console.error('[leerDocumentoViajero]', e instanceof Error ? e.message : e)
    return { ok: true, lectura: LECTURA_VACIA, leido: false, aviso: NO_PUDE_LEER }
  }
}

export interface EntradaDocumentoViajero {
  negocioId: string
  tipo: TipoDocumentoViajero
  numero: string | null
  nombre: string | null
  pais: string | null
  fechaEmision: string | null
  fechaVencimiento: string | null
  soporte: SoporteSubidoInput | null
  leidoPorIa: boolean
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const TIPOS: readonly TipoDocumentoViajero[] = ['pasaporte', 'visa', 'asistencia_medica', 'otro']

function limpio(v: string | null | undefined, max: number): string | null {
  const t = (v ?? '').trim()
  return t ? t.slice(0, max) : null
}

/** Guarda el documento EN EL CONTACTO (C11). El mismo tipo y número vigente se actualiza, no se duplica. */
export async function guardarDocumentoViajero(input: EntradaDocumentoViajero): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await contexto(input.negocioId)
  if (!c.ok) return c
  const ctx = c.ctx
  if (!ctx.puedeConfirmar && !(await esDeOperaciones(ctx))) return { ok: false, error: SIN_PERMISO_DOCS }
  if (!ctx.negocio.contacto_id) return { ok: false, error: 'El negocio no tiene contacto: agrégalo antes de cargar documentos.' }
  if (!TIPOS.includes(input.tipo)) return { ok: false, error: 'Ese tipo de documento no existe.' }
  const numero = limpio(input.numero, 60)?.replace(/\s+/g, '').toUpperCase() ?? null
  for (const f of [input.fechaEmision, input.fechaVencimiento]) {
    if (f && !FECHA.test(f)) return { ok: false, error: 'Revisa las fechas del documento.' }
  }
  if (input.tipo === 'pasaporte' && (!numero || !input.fechaVencimiento)) {
    return { ok: false, error: 'Escribe el número y el vencimiento del pasaporte.' }
  }
  let archivoRef: string | null = null
  if (input.soporte?.storage_path) {
    if (!esRutaDeWorkspace(input.soporte.storage_path, ctx.workspaceId)) return { ok: false, error: 'Ese archivo no es de este espacio.' }
    archivoRef = construirReferenciaOne(BUCKET_DOCUMENTOS_ONE, input.soporte.storage_path)
  }
  if (!numero && !archivoRef) return { ok: false, error: 'Pega el documento o escribe su número.' }

  const fila = {
    workspace_id: ctx.workspaceId,
    contacto_id: ctx.negocio.contacto_id,
    tipo: input.tipo,
    numero,
    nombre_en_documento: limpio(input.nombre, 200),
    pais: limpio(input.pais, 80),
    fecha_emision: input.fechaEmision || null,
    fecha_vencimiento: input.fechaVencimiento || null,
    leido_por_ia: input.leidoPorIa === true,
    negocio_id: ctx.negocio.id,
    updated_at: new Date().toISOString(),
  }
  const existente = numero
    ? ((await ctx.supabase
        .from('contacto_documentos')
        .select('id, archivo_ref')
        .eq('workspace_id', ctx.workspaceId)
        .eq('contacto_id', ctx.negocio.contacto_id)
        .eq('tipo', input.tipo)
        .eq('numero', numero)
        .eq('vigente', true)
        .maybeSingle()).data as { id: string; archivo_ref: string | null } | null)
    : null
  const { error } = existente
    ? await ctx.supabase.from('contacto_documentos').update({ ...fila, archivo_ref: archivoRef ?? existente.archivo_ref }).eq('id', existente.id).eq('workspace_id', ctx.workspaceId)
    : await ctx.supabase.from('contacto_documentos').insert({ ...fila, archivo_ref: archivoRef, vigente: true, created_by: ctx.staffId })
  if (error) return { ok: false, error: `No se pudo guardar el documento: ${error.message}` }

  await registrarActividad(ctx.supabase, {
    workspace_id: ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: ctx.negocio.id,
    tipo: 'cambio',
    autor_id: ctx.staffId,
    contenido: `Documento del viajero guardado en el contacto: ${input.tipo === 'pasaporte' ? 'pasaporte' : input.tipo}${numero ? ` ${numero}` : ''}.`.slice(0, 280),
  }, 'guardarDocumentoViajero')
  revalidatePath(`/negocios/${ctx.negocio.id}`)
  return { ok: true }
}

// ── Paquete de viaje (F4-3, F4-4) ────────────────────────────────────────────

export type ResultadoVerPaquete = { ok: true; pdf: string; filename: string; sinAnexar: string[] } | { ok: false; error: string }

/** «Ver paquete»: el PDF tal como lo va a recibir el viajero. No envía nada. */
export async function verPaquete(negocioId: string, nota: string | null): Promise<ResultadoVerPaquete> {
  const c = await contexto(negocioId)
  if (!c.ok) return c
  if (!c.ctx.puedeConfirmar && !(await esDeOperaciones(c.ctx))) return { ok: false, error: SIN_PERMISO_ENVIO }
  const p = await armarPaquetePdf(c.ctx.supabase, c.ctx.workspaceId, negocioId, nota)
  if (!p) return { ok: false, error: APAGADO }
  return { ok: true, pdf: p.pdf.toString('base64'), filename: p.filename, sinAnexar: p.sinAnexar }
}

export interface EntradaEnviarPaquete {
  negocioId: string
  nota: string | null
  /** «Enviar igual» (solo dirección): por qué sale sin el cobro mínimo. */
  enviarIgualMotivo?: string | null
}

export type ResultadoEnviarPaquete =
  | { ok: true; waUrl: string; mensaje: string; correo: 'enviado' | 'omitido' | 'fallido'; archivoHref: string | null; sinAnexar: string[] }
  | { ok: false; error: string; puedeEnviarIgual?: boolean }

async function enviarPaqueteSinClave(input: EntradaEnviarPaquete): Promise<ResultadoEnviarPaquete> {
  const c = await contexto(input.negocioId)
  if (!c.ok) return c
  const ctx = c.ctx
  if (!ctx.puedeConfirmar) return { ok: false, error: SIN_PERMISO_ENVIO }
  const vista = await leerVistaEntrega(ctx.supabase, ctx.workspaceId, input.negocioId)
  if (!vista) return { ok: false, error: APAGADO }

  // Sin vouchers no hay paquete: es lo que el viajero lleva.
  const faltanVouchers = mensajeVouchers(vista.vouchers)
  if (faltanVouchers) return { ok: false, error: faltanVouchers }

  // Cobro mínimo (F4-3): lo controla el servidor. La dirección puede enviar igual, con motivo.
  const motivo = (input.enviarIgualMotivo ?? '').trim()
  let forzado: { aprobacion_id: string | null; motivo: string } | null = null
  if (!vista.cobro.cumple) {
    if (!motivo) return { ok: false, error: vista.mensajeCobro ?? 'Falta el cobro mínimo.', puedeEnviarIgual: ctx.esDireccion }
    if (!ctx.esDireccion) return { ok: false, error: SOLO_DIRECCION }
    forzado = { aprobacion_id: await registrarEnvioSinCobro(ctx, vista.cobro.pagado, vista.cobro.requerido, vista.hoy, motivo), motivo: motivo.slice(0, 500) }
  }

  const paquete = await armarPaquetePdf(ctx.supabase, ctx.workspaceId, input.negocioId, input.nota)
  if (!paquete) return { ok: false, error: APAGADO }

  // El PDF queda en el repositorio del negocio (Storage, referencia one://).
  const path = `${ctx.workspaceId}/paquetes-viaje/${input.negocioId}/${Date.now()}.pdf`
  const svc = createServiceClient() as Db
  const { error: errSubida } = await svc.storage.from(BUCKET_DOCUMENTOS_ONE).upload(path, paquete.pdf, { contentType: 'application/pdf', upsert: false })
  const archivoRef = errSubida ? null : construirReferenciaOne(BUCKET_DOCUMENTOS_ONE, path)
  if (errSubida) console.error('[enviarPaquete] el PDF no se guardó en Storage:', errSubida.message)

  const yo = await nombreYCorreo(ctx.supabase, ctx.staffId)
  const mensaje = mensajePaquete({
    nombreCliente: vista.cliente.nombre,
    fechaSalida: vista.fechaSalida,
    hoy: vista.hoy,
    nota: input.nota,
    comercial: yo.nombre,
    agencia: vista.agencia,
  })
  const correo = await enviarCorreoAlViajero({
    workspaceId: ctx.workspaceId,
    negocioId: input.negocioId,
    para: vista.cliente.correo,
    replyTo: yo.correo,
    agencia: vista.agencia,
    asunto: 'Tu paquete de viaje',
    texto: mensaje,
    idempotencyKey: `paquete:${input.negocioId}:${archivoRef ?? Date.now()}`,
    adjuntos: [{ filename: paquete.filename, content: paquete.pdf.toString('base64') }],
  })

  // Lo que lee F5 (`enviado_at`) y lo que marca «Cambió un voucher después de enviar» (la huella).
  const { data: neg } = await ctx.supabase.from('negocios').select('metadata').eq('id', input.negocioId).eq('workspace_id', ctx.workspaceId).maybeSingle()
  const meta = ((neg as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>
  const anterior = meta.paquete_viaje as Record<string, unknown> | undefined
  const { error: errMeta } = await ctx.supabase
    .from('negocios')
    .update({
      metadata: {
        ...meta,
        paquete_viaje: {
          enviado_at: new Date().toISOString(),
          enviado_por: ctx.staffId,
          archivo_ref: archivoRef,
          huella_vouchers: paquete.huella,
          forzado,
          correo: correo.estado,
          envios: (typeof anterior?.envios === 'number' ? anterior.envios : 0) + 1,
          ...(typeof anterior?.enviado_at === 'string' ? { primer_envio_at: (anterior.primer_envio_at as string | undefined) ?? anterior.enviado_at } : {}),
        },
      },
    })
    .eq('id', input.negocioId)
    .eq('workspace_id', ctx.workspaceId)
  if (errMeta) return { ok: false, error: `El paquete se armó pero no quedó registrado: ${errMeta.message}` }

  await registrarActividad(ctx.supabase, {
    workspace_id: ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: input.negocioId,
    tipo: 'cambio',
    autor_id: ctx.staffId,
    contenido: (forzado
      ? `Paquete de viaje enviado sin el cobro mínimo: ${forzado.motivo}`
      : `Paquete de viaje ${anterior ? 'reenviado' : 'enviado'}${correo.estado === 'enviado' ? ' (también por correo)' : ''}.`).slice(0, 280),
  }, 'enviarPaquete')
  revalidatePath(`/negocios/${input.negocioId}`)
  return {
    ok: true,
    waUrl: enlaceWhatsApp(vista.cliente.telefono, mensaje),
    mensaje,
    correo: correo.estado,
    archivoHref: hrefArchivo(archivoRef, { descargar: true }),
    sinAnexar: paquete.sinAnexar,
  }
}

/** La aprobación de la dirección queda registrada (cuenta en su tablero). Escribe el servidor. */
async function registrarEnvioSinCobro(ctx: Ctx, pagado: number, requerido: number, hoy: string, motivo: string): Promise<string | null> {
  const svc = createServiceClient() as Db
  // Una vigente por negocio y tipo (índice único): la anterior queda caducada.
  await svc
    .from('aprobaciones_excepcion')
    .update({ estado: 'caducada' })
    .eq('workspace_id', ctx.workspaceId)
    .eq('entidad_id', ctx.negocio.id)
    .eq('tipo', 'enviar_paquete_sin_cobro')
    .in('estado', ['solicitada', 'aprobada'])
  const ahora = new Date().toISOString()
  const { data, error } = await svc
    .from('aprobaciones_excepcion')
    .insert({
      workspace_id: ctx.workspaceId,
      negocio_id: ctx.negocio.id,
      entidad_tipo: 'etapa',
      entidad_id: ctx.negocio.id,
      tipo: 'enviar_paquete_sin_cobro',
      estado: 'aprobada',
      huella: `${Math.round(pagado)}|${Math.round(requerido)}|${hoy}`,
      detalle: { pagado, requerido },
      motivo: motivo.slice(0, 500),
      solicitada_por: ctx.staffId,
      solicitada_at: ahora,
      decidida_por: ctx.staffId,
      decidida_at: ahora,
    })
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('[enviarPaquete] no quedó la aprobación de enviar sin cobro:', error.message)
    return null
  }
  return (data as { id?: string } | null)?.id ?? null
}

export async function enviarPaquete(input: EntradaEnviarPaquete, intencion?: string): Promise<ResultadoEnviarPaquete> {
  return accionIdempotente<ResultadoEnviarPaquete>(
    { accion: 'enviarPaquete', clave: intencion, args: [input], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => enviarPaqueteSinClave(input),
  )
}

/** «Ya lo mandé»: la comercial dice que mandó el paquete por su WhatsApp (traza C1). */
export async function marcarPaqueteMandado(negocioId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await contexto(negocioId)
  if (!c.ok) return c
  if (!c.ctx.puedeConfirmar) return { ok: false, error: SIN_PERMISO_ENVIO }
  const vista = await leerVistaEntrega(c.ctx.supabase, c.ctx.workspaceId, negocioId)
  if (!vista?.paquete) return { ok: false, error: 'Primero envía el paquete.' }
  const yo = await nombreYCorreo(c.ctx.supabase, c.ctx.staffId)
  await trazarWhatsAppManual({
    workspaceId: c.ctx.workspaceId,
    negocioId,
    telefono: vista.cliente.telefono,
    copiaA: yo.nombre,
    titulo: 'Paquete de viaje',
  })
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true }
}
