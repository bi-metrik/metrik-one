import 'server-only'

/**
 * La autorización de datos por link, del lado del servidor: el estado del contacto, el enlace
 * (reusar o crear), el texto vigente, la página pública, la respuesta del titular y el correo.
 *
 * Todo con `service_role`: las dos tablas no conceden nada a `authenticated`. Quien llama desde
 * una acción con sesión ya validó el permiso (bloque o etapa) y el workspace; la página pública
 * valida el TOKEN y que su workspace sea el del subdominio por el que entró.
 */

import { randomBytes, createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { marcaDelWorkspace, type MarcaWorkspace } from '@/lib/marca/marca-workspace'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { formatFecha } from '@/lib/dates/bogota'
import { leerEstado, ESTADO_VACIO, type EstadoAutorizacion } from './estado'
import {
  casillasVisibles,
  filaATexto,
  leerConfigAutorizacion,
  llenar,
  marcadoresDe,
  normalizarCasillas,
  puedeAutorizar,
  textoVisible,
  urlAutorizacion,
  TEXTO_MARCADOR,
  TOKEN_FORMA,
  type Casilla,
  type CasillasMarcadas,
  type ConfigAutorizacion,
  type Medio,
  type MotivoNoAutorizable,
  type TextoAutorizacion,
} from './texto'
import {
  armarCopiaAutorizacion,
  armarCorreoAutorizacion,
  corteDeReenvio,
  debeEnviarCorreo,
  type MotivoSinCorreo,
  type OrigenCorreo,
} from './correo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

function svc(): Db {
  return createServiceClient() as Db
}

const BASE_DOMAIN = () => (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()

function generarToken(): string {
  return randomBytes(32).toString('base64url')
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

// ─── Lecturas ───────────────────────────────────────────────────────────────

export async function estadoDelContacto(workspaceId: string, contactoId: string): Promise<{ estado: EstadoAutorizacion; error: string | null }> {
  const { data, error } = await svc().rpc('autorizacion_datos_estado', { p_workspace_id: workspaceId, p_contacto_id: contactoId })
  if (error) return { estado: ESTADO_VACIO, error: (error as { message: string }).message }
  return { estado: leerEstado(data), error: null }
}

async function configDelWorkspace(workspaceId: string): Promise<{ config: ConfigAutorizacion; slug: string | null }> {
  const { data } = await svc().from('workspaces').select('slug, config_extra').eq('id', workspaceId).maybeSingle()
  const fila = data as { slug: string | null; config_extra: unknown } | null
  return { config: leerConfigAutorizacion(fila?.config_extra ?? null), slug: fila?.slug ?? null }
}

/** La versión vigente del workspace, o el marcador si no ha publicado ninguna. */
async function textoVigente(workspaceId: string): Promise<TextoAutorizacion> {
  const { data, error } = await svc()
    .from('autorizacion_datos_textos')
    .select('id, version, mayor, menor, titulo, cuerpo_md, detalle_md, casillas, variables, mensajes, plantilla_sha256')
    .eq('workspace_id', workspaceId)
    .lte('publicado_at', new Date().toISOString())
    .order('mayor', { ascending: false })
    .order('menor', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) console.error('[autorizacion-datos] no se pudo leer el texto vigente:', (error as { message: string }).message)
  return filaATexto(data as Record<string, unknown> | null) ?? TEXTO_MARCADOR
}

async function textoPorId(workspaceId: string, textoId: string): Promise<TextoAutorizacion | null> {
  const { data } = await svc()
    .from('autorizacion_datos_textos')
    .select('id, version, mayor, menor, titulo, cuerpo_md, detalle_md, casillas, variables, mensajes, plantilla_sha256')
    .eq('workspace_id', workspaceId)
    .eq('id', textoId)
    .maybeSingle()
  return filaATexto(data as Record<string, unknown> | null)
}

// ─── El enlace ──────────────────────────────────────────────────────────────

export interface EnlaceContacto {
  enlaceId: string
  token: string
  url: string
  creado: boolean
  correoEnviadoAt: string | null
}

/** Reusa el enlace pendiente del contacto o crea uno (RPC con candado por contacto). */
export async function pedirEnlace(p: {
  workspaceId: string
  contactoId: string
  staffId: string | null
  negocioId: string | null
  medio?: Medio
}): Promise<{ enlace: EnlaceContacto | null; error: string | null }> {
  const { config, slug } = await configDelWorkspace(p.workspaceId)
  if (!slug) return { enlace: null, error: 'workspace_sin_slug' }
  const { data, error } = await svc().rpc('autorizacion_datos_enlace', {
    p_workspace_id: p.workspaceId,
    p_contacto_id: p.contactoId,
    p_token_nuevo: generarToken(),
    p_creado_por: p.staffId,
    p_negocio_id: p.negocioId,
    p_dias: config.diasEnlace,
  })
  if (error) return { enlace: null, error: (error as { message: string }).message }
  const r = data as { ok: boolean; error?: string; enlace_id: string; token: string; creado: boolean; correo_enviado_at: string | null }
  if (!r?.ok) return { enlace: null, error: r?.error ?? 'sin_enlace' }
  return {
    enlace: {
      enlaceId: r.enlace_id,
      token: r.token,
      url: urlAutorizacion(slug, BASE_DOMAIN(), r.token, p.medio),
      creado: r.creado,
      correoEnviadoAt: r.correo_enviado_at,
    },
    error: null,
  }
}

// ─── El correo ──────────────────────────────────────────────────────────────

async function enviarPorResend(m: { from: string; to: string; replyTo: string | null; subject: string; html: string; text: string; idempotencyKey: string }): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'sin_resend_api_key' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string }
      return { ok: false, error: `resend_${res.status}${err.message ? `: ${err.message}` : ''}` }
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string }
    return { ok: true, id: body.id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** «Trappvel vía MéTRIK ONE <noreply@metrikone.co>»: el cliente reconoce a su agencia, no a MéTRIK. */
function remitente(marca: MarcaWorkspace): string {
  const nombre = (marca.nombreComercial ?? marca.nombre).replace(/[<>"]/g, '').trim()
  return `${nombre} vía MéTRIK ONE <noreply@metrikone.co>`
}

export type ResultadoCorreo =
  | { enviado: true; email: string; url: string }
  | { enviado: false; motivo: MotivoSinCorreo | 'error'; detalle?: string }

/**
 * Manda el correo con el link si corresponde (`debeEnviarCorreo`). El envío se RECLAMA antes de
 * salir con un UPDATE condicionado sobre `correo_enviado_at`: dos creaciones a la vez para el
 * mismo contacto, o un doble toque, mandan un solo correo. Si Resend falla, el reclamo se
 * devuelve para que el siguiente intento pueda salir.
 */
export async function enviarCorreoAutorizacion(p: {
  workspaceId: string
  contactoId: string
  negocioId: string | null
  staffId: string | null
  origen: OrigenCorreo
}): Promise<ResultadoCorreo> {
  const [{ estado, error }, { config }, texto] = await Promise.all([
    estadoDelContacto(p.workspaceId, p.contactoId),
    configDelWorkspace(p.workspaceId),
    textoVigente(p.workspaceId),
  ])
  if (error) return { enviado: false, motivo: 'error', detalle: error }
  const ahoraMs = Date.now()
  const decision = debeEnviarCorreo({ estado, config, origen: p.origen, textoPublicado: !texto.esMarcador, ahoraMs })
  if (!decision.ok) return { enviado: false, motivo: decision.motivo }

  const { enlace, error: errEnlace } = await pedirEnlace({ ...p, medio: 'correo' })
  if (!enlace) return { enviado: false, motivo: 'error', detalle: errEnlace ?? 'sin_enlace' }

  const ahoraIso = new Date(ahoraMs).toISOString()
  const corte = corteDeReenvio(p.origen, config, ahoraMs)
  const previo = enlace.correoEnviadoAt
  const db = svc()
  let reclamo = db.from('autorizacion_datos_enlaces')
    .update({ correo_enviado_at: ahoraIso, correo_destino: decision.email, correo_origen: p.origen })
    .eq('id', enlace.enlaceId)
    .is('aceptado_at', null)
  reclamo = previo ? reclamo.lt('correo_enviado_at', corte) : reclamo.is('correo_enviado_at', null)
  const { data: reclamado, error: errReclamo } = await reclamo.select('id')
  if (errReclamo) return { enviado: false, motivo: 'error', detalle: (errReclamo as { message: string }).message }
  if (!reclamado?.length) return { enviado: false, motivo: 'enviado_reciente' }

  const marca = await marcaDelWorkspace(p.workspaceId, 'su agencia')
  const m = marcadoresDe(texto, marca, { nombreCliente: estado.contacto?.nombre ?? '', link: enlace.url })
  const correo = armarCorreoAutorizacion(texto, m, marca.colorPrimario)
  const r = await enviarPorResend({
    from: remitente(marca),
    to: decision.email,
    replyTo: config.responderA ?? marca.correo,
    subject: correo.asunto,
    html: correo.html,
    text: correo.texto,
    idempotencyKey: `autorizacion-datos:${enlace.enlaceId}:${ahoraIso}`,
  })
  if (!r.ok) {
    await db.from('autorizacion_datos_enlaces').update({ correo_enviado_at: previo }).eq('id', enlace.enlaceId).eq('correo_enviado_at', ahoraIso)
    console.error('[autorizacion-datos] el correo no salió:', r.error)
    return { enviado: false, motivo: 'error', detalle: r.error }
  }
  await db.from('autorizacion_datos_enlaces').update({ correo_resend_id: r.id }).eq('id', enlace.enlaceId)
  await registrarActividad(db, {
    workspace_id: p.workspaceId,
    entidad_tipo: 'contacto',
    entidad_id: p.contactoId,
    tipo: 'cambio_sistema',
    autor_id: p.staffId,
    contenido: `Se envió el link de autorización de datos a ${decision.email}${p.origen === 'al_crear' ? ' al crear el viaje' : ''}.`,
  }, 'enviarCorreoAutorizacion')
  return { enviado: true, email: decision.email, url: enlace.url }
}

/** Ventana en la que un negocio recién creado todavía dispara el correo automático. */
const MINUTOS_CORREO_AL_CREAR = 15

/**
 * El correo automático al crear un viaje. Lo llaman la acción de crear (Next) y, para los viajes
 * que abre el bot, la ruta `/api/autorizacion-datos/al-crear`. Solo actúa sobre un negocio creado
 * hace menos de 15 minutos: la ruta no pide sesión, y así lo único que puede provocar es el mismo
 * correo que el sistema habría mandado solo.
 */
export async function correoAlCrearNegocio(negocioId: string): Promise<ResultadoCorreo> {
  const { data } = await svc()
    .from('negocios')
    .select('id, workspace_id, contacto_id, created_at, estado')
    .eq('id', negocioId)
    .maybeSingle()
  const n = data as { workspace_id: string; contacto_id: string | null; created_at: string; estado: string } | null
  if (!n || !n.contacto_id) return { enviado: false, motivo: 'sin_contacto' }
  if (Date.now() - Date.parse(n.created_at) > MINUTOS_CORREO_AL_CREAR * 60_000) return { enviado: false, motivo: 'apagado', detalle: 'negocio_viejo' }
  if (n.estado !== 'abierto') return { enviado: false, motivo: 'apagado', detalle: 'negocio_no_abierto' }
  return enviarCorreoAutorizacion({ workspaceId: n.workspace_id, contactoId: n.contacto_id, negocioId, staffId: null, origen: 'al_crear' })
}

// ─── La página pública ──────────────────────────────────────────────────────

export type MotivoEnlace = 'no_encontrado' | 'expirado'

export interface VistaAutorizacion {
  token: string
  marca: MarcaWorkspace
  nombreCliente: string
  texto: TextoAutorizacion
  casillas: Casilla[]
  /** Lo que se muestra, con los marcadores ya llenos (título, cuerpo, casillas). */
  titulo: string
  cuerpo: string
  casillasLlenas: Array<Casilla & { textoLleno: string }>
  /** Si se puede autorizar con este texto (no marcador, sin marcadores vacíos). */
  autorizable: { ok: true } | { ok: false; motivo: MotivoNoAutorizable; faltan: string[] }
  /** Ya autorizó con este token. */
  aceptado: { at: string; version: string; casillas: CasillasMarcadas; medio: Medio } | null
  /** Autorizó una versión mayor anterior: se muestra el texto nuevo para volver a autorizar. */
  reaceptar: boolean
  rechazadoAt: string | null
  canalDatos: string | null
  tieneDetalle: boolean
}

type FilaEnlace = {
  id: string
  workspace_id: string
  contacto_id: string
  token: string
  expira_at: string
  aceptado_at: string | null
  rechazado_at: string | null
  texto_id: string | null
  texto_version: string | null
  texto_mayor: number | null
  casillas: CasillasMarcadas | null
  medio: Medio | null
}

async function workspaceDelSlug(slug: string | null): Promise<string | null> {
  if (!slug) return null
  const { data } = await svc().from('workspaces').select('id').eq('slug', slug).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/**
 * El enlace por su token, SOLO si es del workspace del subdominio. Un token válido abierto bajo
 * otro subdominio responde «no existe»: no se pinta con la marca de otro cliente ni se acepta.
 */
async function enlacePorToken(token: string, slug: string | null): Promise<FilaEnlace | null> {
  if (!TOKEN_FORMA.test(token)) return null
  const wsId = await workspaceDelSlug(slug)
  if (!wsId) return null
  const { data } = await svc()
    .from('autorizacion_datos_enlaces')
    .select('id, workspace_id, contacto_id, token, expira_at, aceptado_at, rechazado_at, texto_id, texto_version, texto_mayor, casillas, medio')
    .eq('token', token)
    .eq('workspace_id', wsId)
    .maybeSingle()
  return (data as FilaEnlace | null) ?? null
}

/** Lo que decide la pantalla, sin base: probado aparte. */
function motivoCerrado(e: Pick<FilaEnlace, 'aceptado_at' | 'expira_at'> | null, ahoraMs: number): MotivoEnlace | null {
  if (!e) return 'no_encontrado'
  if (e.aceptado_at) return null
  return Date.parse(e.expira_at) <= ahoraMs ? 'expirado' : null
}

function urlDetalle(slug: string, token: string): string {
  return `${urlAutorizacion(slug, BASE_DOMAIN(), token).replace(/\?.*$/, '')}/detalle`
}

export async function abrirAutorizacion(
  token: string,
  slug: string | null,
): Promise<{ ok: true; vista: VistaAutorizacion } | { ok: false; motivo: MotivoEnlace; marca: MarcaWorkspace | null }> {
  const e = await enlacePorToken(token, slug)
  const cerrado = motivoCerrado(e, Date.now())
  if (!e || cerrado) {
    return { ok: false, motivo: cerrado ?? 'no_encontrado', marca: e ? await marcaDelWorkspace(e.workspace_id, 'su agencia') : null }
  }

  const [marca, { config }, vigente, contacto] = await Promise.all([
    marcaDelWorkspace(e.workspace_id, 'su agencia'),
    configDelWorkspace(e.workspace_id),
    textoVigente(e.workspace_id),
    svc().from('contactos').select('nombre').eq('id', e.contacto_id).eq('workspace_id', e.workspace_id).maybeSingle(),
  ])
  const nombreCliente = ((contacto.data as { nombre: string } | null)?.nombre ?? '').trim()
  // Ya autorizado: se muestra la versión que firmó (lo que autorizó), salvo que haya una MAYOR
  // nueva: ahí se muestra la nueva completa para que autorice de nuevo (pieza 2 de Emilio).
  const reaceptar = !!e.aceptado_at && !vigente.esMarcador && (e.texto_mayor ?? 0) < vigente.mayor
  const firmado = e.aceptado_at && e.texto_id && !reaceptar ? await textoPorId(e.workspace_id, e.texto_id) : null
  const texto = firmado ?? vigente
  const casillas = casillasVisibles(texto, config)
  const m = marcadoresDe(texto, marca, { nombreCliente, urlDetalle: slug ? urlDetalle(slug, token) : null })

  return {
    ok: true,
    vista: {
      token,
      marca,
      nombreCliente: m.nombreCliente,
      texto,
      casillas,
      titulo: llenar(texto.titulo, m),
      cuerpo: llenar(texto.cuerpoMd, m),
      casillasLlenas: casillas.map(c => ({ ...c, textoLleno: llenar(c.texto, m) })),
      autorizable: puedeAutorizar(texto, m, casillas),
      aceptado: e.aceptado_at && !reaceptar
        ? { at: e.aceptado_at, version: e.texto_version ?? texto.version, casillas: e.casillas ?? {}, medio: e.medio ?? 'otro' }
        : null,
      reaceptar,
      rechazadoAt: e.rechazado_at,
      canalDatos: m.canalDatos,
      tieneDetalle: !!texto.detalleMd,
    },
  }
}

/** El detalle completo (pieza 1b) de la versión que corresponde a este enlace. */
export async function detalleAutorizacion(token: string, slug: string | null): Promise<{ titulo: string; detalle: string; marca: MarcaWorkspace } | null> {
  const r = await abrirAutorizacion(token, slug)
  if (!r.ok || !r.vista.texto.detalleMd) return null
  const m = marcadoresDe(r.vista.texto, r.vista.marca, { nombreCliente: r.vista.nombreCliente, urlDetalle: null })
  return { titulo: r.vista.titulo, detalle: llenar(r.vista.texto.detalleMd!, m), marca: r.vista.marca }
}

// ─── La respuesta del titular ───────────────────────────────────────────────

export type ErrorRespuesta =
  | MotivoEnlace
  | 'ya_autorizo'
  | 'texto_cambio'
  | 'no_autorizable'
  | 'falta_generales'
  | 'error'

export const MENSAJE_RESPUESTA: Record<ErrorRespuesta, string> = {
  no_encontrado: 'Este enlace no existe. Revise que lo haya copiado completo o pídale uno nuevo a su asesor.',
  expirado: 'Este enlace se venció. Pídale uno nuevo a su asesor.',
  ya_autorizo: 'Usted ya autorizó con este enlace.',
  texto_cambio: 'El texto de la autorización se actualizó mientras lo leía. Recargue la página para ver el vigente.',
  no_autorizable: 'Este texto todavía no se puede autorizar.',
  falta_generales: 'Para autorizar, marque la primera casilla.',
  error: 'No se pudo guardar. Intente de nuevo en un momento.',
}

export interface RespuestaTitular {
  token: string
  slug: string | null
  decision: 'autorizo' | 'no_autorizo'
  /** El texto que se le mostró: tiene que ser el vigente, o no se registra. */
  textoId: string | null
  casillas: Record<string, unknown>
  medio: Medio
  ip: string | null
  userAgent: string | null
}

/**
 * Registra «Autorizo» o «No autorizo». El texto, las casillas visibles y la huella se RECALCULAN
 * aquí con lo vigente; lo que manda el navegador solo dice qué texto vio y qué marcó. Si el texto
 * cambió entre que lo leyó y que tocó, no se registra: se le pide recargar.
 *
 * La aceptación es un UPDATE condicionado (sin aceptar, sin vencer, del workspace del
 * subdominio): dos toques a la vez registran uno solo.
 */
export async function responderAutorizacion(p: RespuestaTitular): Promise<{ ok: true; copiaEnviada: boolean } | { ok: false; error: ErrorRespuesta }> {
  const e = await enlacePorToken(p.token, p.slug)
  const cerrado = motivoCerrado(e, Date.now())
  if (!e || cerrado) return { ok: false, error: cerrado ?? 'no_encontrado' }
  const db = svc()
  const vigente = await textoVigente(e.workspace_id)

  if (e.aceptado_at) {
    const reaceptar = !vigente.esMarcador && (e.texto_mayor ?? 0) < vigente.mayor
    if (!reaceptar) return { ok: false, error: 'ya_autorizo' }
    // Versión mayor nueva: la respuesta va a un enlace NUEVO del mismo contacto; el aceptado es
    // evidencia y no se toca.
    const { enlace } = await pedirEnlace({ workspaceId: e.workspace_id, contactoId: e.contacto_id, staffId: null, negocioId: null })
    if (!enlace) return { ok: false, error: 'error' }
    return responderAutorizacion({ ...p, token: enlace.token })
  }

  if (p.decision === 'no_autorizo') {
    const { error } = await db.from('autorizacion_datos_enlaces')
      .update({ rechazado_at: new Date().toISOString() })
      .eq('id', e.id).is('aceptado_at', null)
    if (error) return { ok: false, error: 'error' }
    await registrarActividad(db, {
      workspace_id: e.workspace_id, entidad_tipo: 'contacto', entidad_id: e.contacto_id, tipo: 'cambio_sistema', autor_id: null,
      contenido: 'El titular respondió «No autorizo» en el link de autorización de datos.',
    }, 'responderAutorizacion')
    return { ok: true, copiaEnviada: false }
  }

  if (vigente.esMarcador || !vigente.id || p.textoId !== vigente.id) {
    return { ok: false, error: vigente.esMarcador ? 'no_autorizable' : 'texto_cambio' }
  }

  const [marca, { config, slug }, contacto] = await Promise.all([
    marcaDelWorkspace(e.workspace_id, 'su agencia'),
    configDelWorkspace(e.workspace_id),
    db.from('contactos').select('nombre, email, custom_data').eq('id', e.contacto_id).eq('workspace_id', e.workspace_id).maybeSingle(),
  ])
  const fila = contacto.data as { nombre: string; email: string | null; custom_data: Record<string, unknown> | null } | null
  if (!fila) return { ok: false, error: 'no_encontrado' }
  const visibles = casillasVisibles(vigente, config)
  const m = marcadoresDe(vigente, marca, { nombreCliente: fila.nombre, urlDetalle: slug ? urlDetalle(slug, e.token) : null })
  if (!puedeAutorizar(vigente, m, visibles).ok) return { ok: false, error: 'no_autorizable' }
  const casillas = normalizarCasillas(p.casillas, visibles)
  if (casillas.generales !== true) return { ok: false, error: 'falta_generales' }

  const ahora = new Date().toISOString()
  const huella = sha256(textoVisible(vigente, m, visibles))
  const { data: hecho, error } = await db.from('autorizacion_datos_enlaces')
    .update({
      aceptado_at: ahora,
      medio: p.medio,
      texto_id: vigente.id,
      texto_version: vigente.version,
      texto_mayor: vigente.mayor,
      texto_menor: vigente.menor,
      texto_sha256: huella,
      casillas,
      responsable: m.responsable,
      encargado: m.encargado,
      ip: p.ip?.slice(0, 100) ?? null,
      user_agent: p.userAgent?.slice(0, 500) ?? null,
    })
    .eq('id', e.id)
    .is('aceptado_at', null)
    .gt('expira_at', ahora)
    .select('id')
  if (error) {
    console.error('[autorizacion-datos] no se pudo registrar la aceptación:', (error as { message: string }).message)
    return { ok: false, error: 'error' }
  }
  if (!hecho?.length) return { ok: false, error: 'ya_autorizo' }

  // El resumen en el contacto: cada casilla con su versión. La evidencia es la fila del enlace;
  // esto es lo que se lee en el directorio. Se MEZCLA con lo que ya había.
  const previo = fila.custom_data ?? {}
  const { error: errC } = await db.from('contactos').update({
    custom_data: {
      ...previo,
      autorizacion_datos_link: {
        enlace_id: e.id, aceptado_at: ahora, medio: p.medio, version: vigente.version, mayor: vigente.mayor, menor: vigente.menor, casillas,
      },
    },
    updated_at: ahora,
  }).eq('id', e.contacto_id).eq('workspace_id', e.workspace_id)
  if (errC) console.error('[autorizacion-datos] la aceptación quedó en el enlace, no en el resumen del contacto:', (errC as { message: string }).message)

  const marcadas = visibles.map(c => `${c.clave}: ${casillas[c.clave] ? 'sí' : 'no'}`).join(', ')
  await registrarActividad(db, {
    workspace_id: e.workspace_id, entidad_tipo: 'contacto', entidad_id: e.contacto_id, tipo: 'cambio_sistema', autor_id: null,
    contenido: `El titular autorizó el tratamiento de datos (versión ${vigente.version}; ${marcadas}).`.slice(0, 280),
  }, 'responderAutorizacion')

  let copiaEnviada = false
  const email = (fila.email ?? '').trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && slug) {
    const copia = armarCopiaAutorizacion({
      agencia: m.agencia,
      nombreCliente: m.nombreCliente,
      version: vigente.version,
      casillas: visibles.map(c => ({ texto: llenar(c.texto, m), marcada: casillas[c.clave] === true })),
      link: urlAutorizacion(slug, BASE_DOMAIN(), e.token),
      fecha: formatFecha(ahora, { day: 'numeric', month: 'long', year: 'numeric' }) ?? ahora.slice(0, 10),
    })
    const r = await enviarPorResend({
      from: remitente(marca), to: email, replyTo: config.responderA ?? marca.correo,
      subject: copia.asunto, html: copia.html, text: copia.texto, idempotencyKey: `autorizacion-datos-copia:${e.id}`,
    })
    copiaEnviada = r.ok
    if (!r.ok) console.error('[autorizacion-datos] la copia al titular no salió:', r.error)
  }
  return { ok: true, copiaEnviada }
}

export type { Medio }
