// ============================================================
// Bandeja de solicitudes por WhatsApp — la ejecución
// ------------------------------------------------------------
// Las decisiones viven en `wa-bandeja-reglas.ts` (puro, probado) y en las funciones SQL de
// la migración 20260925200000 (agrupar y deduplicar, probado con PGlite). Aquí solo se
// traduce el mensaje, se registra y se contesta.
//
// Regla de este módulo: la materia prima NO se pierde. Si el audio no se transcribe, el
// mensaje se guarda igual con el motivo; si la pregunta no sale, la entrega queda cerrada con
// el error anotado.
// ============================================================

import { transcribeAudio, PROMPT_TRANSCRIPCION_LITERAL } from './wa-transcribe.ts';
import { armarPreguntaNegocio, cambioPorConfirmar, candidatosDeEncabezado, hayPreguntaPendiente, tomarRespuestaContacto } from './wa-entendimiento.ts';
import { esNo, esSi, lineaCaja, resolverEncabezado, respuestaAlEncabezado } from './wa-viajes-reglas.ts';
import type { ResolucionEncabezado, ViajeAbierto } from './wa-viajes-reglas.ts';
import { sendTextMessage } from './wa-respond.ts';
import {
  bandejaActiva,
  cuerpoDelMensaje,
  decidirRuta,
  esPalabraCierre,
  fechaDeMeta,
  leerConfigBandeja,
  respuestaTrasRegistro,
  textoPreguntaCliente,
  TEXTO_ANOTADO,
  TEXTO_NADA_PENDIENTE,
} from './wa-bandeja-reglas.ts';
import type { AccionRegistro, ConfigBandeja, Ruta } from './wa-bandeja-reglas.ts';
import type { IncomingMessage, SupabaseClient, WaUser } from './types.ts';

/** Marca en `wa_envios.intent` de todo lo que el bot le dice al comercial desde la bandeja. */
const INTENT_BANDEJA = 'bandeja_solicitud';

/** Estados de `bot_sessions` que significan "el bot espera una respuesta" (ver `isAwaitingResponse`). */
const ESTADOS_ESPERANDO = [
  'confirming', 'awaiting_selection', 'awaiting_reason', 'awaiting_payment_status',
  'awaiting_image', 'collecting', 'awaiting_timeout_confirm',
];

/**
 * `config_extra` del workspace. Solo se lee cuando la bandeja está encendida, así que para
 * cualquier otro workspace el bot no hace ni una consulta más que antes.
 */
async function configDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<ConfigBandeja> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('config_extra')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error) console.error('[wa-bandeja] no se pudo leer config_extra, uso la config por defecto:', error.message);
  return leerConfigBandeja(data?.config_extra ?? null);
}

/**
 * ¿Hay una conversación del bot a medias? Consulta SIN crear sesión: `getOrCreateSession`
 * insertaría una fila en `bot_sessions` por cada reenvío de la bandeja.
 */
async function sesionBotEsperando(supabase: SupabaseClient, phone: string, workspaceId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('bot_sessions')
    .select('state')
    .eq('user_phone', phone)
    .eq('workspace_id', workspaceId)
    .in('state', ESTADOS_ESPERANDO)
    .gt('expires_at', new Date().toISOString())
    .limit(1);
  if (error) {
    // Ante la duda, el gasto a medias gana: perderlo es peor que mandar un mensaje al bot.
    console.error('[wa-bandeja] no se pudo leer la sesion del bot:', error.message);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Decide si el mensaje va a la bandeja. Devuelve la config para no leerla dos veces.
 * Con la bandeja apagada en el workspace no toca la base: para todos los demás el bot hace
 * exactamente las mismas consultas que antes.
 */
export async function rutaDelMensaje(
  supabase: SupabaseClient,
  user: WaUser,
  message: IncomingMessage,
): Promise<{ ruta: Ruta; config: ConfigBandeja | null }> {
  const modules = (user.modulos?.modules ?? null) as Record<string, unknown> | null;
  if (!bandejaActiva(modules)) return { ruta: 'bot', config: null };

  const config = await configDelWorkspace(supabase, user.workspace_id);
  const reenviado = message.reenviado === true;
  // Un reenvío va a la bandeja pase lo que pase: no hace falta preguntar por la sesión.
  const sesion = reenviado ? false : await sesionBotEsperando(supabase, message.phone, user.workspace_id);
  const base = { modules, config, tipo: message.type, texto: message.text, reenviado, sesionBotEsperando: sesion };
  let ruta = decidirRuta(base);
  // Regla 5 (N8): un escrito suelto solo se queda en la bandeja si hay una tanda abierta, una
  // pregunta pendiente o es un encabezado. Se mira solo cuando hace falta (texto escrito que hoy
  // iría a la bandeja), para no sumar consultas a los reenvíos.
  if (ruta === 'bandeja' && !reenviado && message.type === 'text') {
    ruta = decidirRuta({ ...base, ...(await contextoDelEscrito(supabase, user.workspace_id, message.phone, message.text, config)) });
  }
  return { ruta, config };
}

/**
 * Lo que la regla 5 de `decidirRuta` necesita saber de un escrito. Ante un error de lectura se
 * deja `undefined`: el escrito va a la bandeja, como antes (la regla solo saca lo que SABE que no
 * es de la bandeja).
 */
async function contextoDelEscrito(
  supabase: SupabaseClient, workspaceId: string, phone: string, texto: string, config: ConfigBandeja,
): Promise<{ entregaAbierta?: boolean; preguntaPendiente?: boolean; esEncabezado?: boolean }> {
  const { data: abierta, error } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'abierta').limit(1).maybeSingle();
  if (error) return {};
  if (abierta) {
    // Con la tanda abierta solo importa si hay una pregunta pendiente (regla 4b: una pregunta escrita va al bot).
    return { entregaAbierta: true, preguntaPendiente: await hayPreguntaPendiente(supabase, workspaceId, phone) };
  }
  const desde = new Date(Date.now() - config.horasRespuestaCliente * 3600_000).toISOString();
  const { data: esperando, error: e2 } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'esperando_cliente')
    .gte('pregunta_enviada_at', desde).limit(1).maybeSingle();
  if (e2) return {};
  const preguntaPendiente = !!esperando || await hayPreguntaPendiente(supabase, workspaceId, phone);
  if (preguntaPendiente) return { entregaAbierta: false, preguntaPendiente: true };
  let esEncabezado = false;
  if (config.modoViajes !== 'uno') {
    const c = await candidatosDeEncabezado(supabase, workspaceId);
    if (!c) return {};
    esEncabezado = resolverEncabezado(texto, c.viajes, c.equipo) !== null;
  }
  return { entregaAbierta: false, preguntaPendiente: false, esEncabezado };
}

type FilaRegistro = { accion: AccionRegistro; entrega: string | null; mensajes: number | null };

/** Guarda el mensaje en la bandeja y, si toca, le contesta al comercial. */
export async function atenderEnBandeja(
  supabase: SupabaseClient,
  user: WaUser,
  message: IncomingMessage,
  config: ConfigBandeja,
): Promise<void> {
  if (!message.wa_message_id) {
    // Sin wamid no hay forma de deduplicar lo que Meta reintenta. No debería pasar: el payload
    // lo pone en todos los tipos. Se deja constancia y se sigue guardando con un id sintético
    // derivado de lo único estable que hay.
    console.warn(`[wa-bandeja] mensaje sin wamid de ${message.phone} (${message.type})`);
  }
  const wamid = message.wa_message_id ?? `sin-wamid:${message.phone}:${message.timestamp}:${message.type}`;

  // Un encabezado («Carolina», «T1 26 9») abre una caja: nunca es la respuesta a una pregunta
  // pendiente (QA de #971: el que se escribía antes del «sí» se tomaba como respuesta al resumen).
  const encabezado = await encabezadoDelEscrito(supabase, user.workspace_id, message, config);
  // La respuesta a «¿Cambias a…? sí/no» va a la tanda (la lee el reparto) y tampoco es la
  // respuesta a otra pregunta (QA de #971 v5).
  const cambio = encabezado ? null : await respuestaAlCambio(supabase, user.workspace_id, message, config);
  const esEncabezado = encabezado !== null || cambio !== null;

  // ¿Es la respuesta a «¿cuál de estos contactos es?» del paso de entendimiento? Se mira
  // ANTES de registrar: como contenido abriría una entrega nueva y la pregunta quedaría sin
  // respuesta. Solo un texto escrito (no reenviado) puede serlo.
  if (!esEncabezado && message.type === 'text' && message.reenviado !== true && (message.text || '').trim()) {
    const tomada = await tomarRespuestaContacto(supabase, {
      workspaceId: user.workspace_id, phone: message.phone, texto: message.text.trim(),
      wamid, enviadoAt: fechaDeMeta(message.timestamp),
    });
    if (tomada) return;
  }

  let { cuerpo, origen } = cuerpoDelMensaje(message);
  let errorTranscripcion: string | null = null;
  let mediaId: string | null = message.image_id ?? null;

  if (message.type === 'audio') {
    mediaId = message.audio_id ?? null;
    if (message.audio_id) {
      const r = await transcribeAudio(message.audio_id, {
        prompt: PROMPT_TRANSCRIPCION_LITERAL,
        maxOutputTokens: 8192,
        exigirFinCompleto: true,
      });
      if (r.text) {
        cuerpo = r.text;
        origen = 'transcripcion';
      } else {
        errorTranscripcion = r.error ?? 'sin texto';
      }
    } else {
      errorTranscripcion = 'audio sin id de Meta';
    }
  }

  const esCierre = message.type === 'text' && message.reenviado !== true
    && esPalabraCierre(message.text, config.palabrasCierre);

  const { data, error } = await supabase.rpc('wa_bandeja_registrar_mensaje', {
    p_workspace_id: user.workspace_id,
    p_remitente_phone: message.phone,
    p_remitente_staff_id: user.collaborator_id ? null : (await staffIdDelRemitente(supabase, user)),
    p_remitente_colaborador_id: user.collaborator_id ?? null,
    p_wa_message_id: wamid,
    p_tipo: message.type,
    p_cuerpo: cuerpo,
    p_cuerpo_origen: origen,
    p_reenviado: message.reenviado === true,
    p_reenviado_muchas_veces: message.reenviado_muchas_veces === true,
    p_meta_media_id: mediaId,
    p_transcripcion_error: errorTranscripcion,
    p_enviado_at: fechaDeMeta(message.timestamp),
    p_es_cierre: esCierre,
    p_horas_respuesta_cliente: config.horasRespuestaCliente,
    p_puede_ser_respuesta: !esEncabezado,
  });

  if (error) {
    // No se le contesta nada: un "no se pudo" por cada reenvío de una ráfaga sería peor. El
    // error queda en el log de la función con el wamid, que es lo que permite buscarlo en Meta.
    console.error(`[wa-bandeja] no se pudo registrar ${wamid} de ${message.phone}:`, error.message);
    return;
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaRegistro | undefined;
  if (!fila) return;

  // En el acto (QA de #971 v5): un encabezado exacto se confirma con «📌»; uno aproximado pregunta
  // «¿Cambias a…? sí/no» y lo que sigue queda sin asignar hasta la respuesta.
  if (fila.accion === 'agregar' || fila.accion === 'abrir') {
    const aviso = cambio
      ? (cambio.si ? `📌 ${lineaCaja(cambio.viaje)}` : `No cambio a ${lineaCaja(cambio.viaje)}: lo que sigue queda sin asignar hasta otro encabezado.`)
      : respuestaAlEncabezado(encabezado);
    if (aviso) await enviar(message.phone, aviso, user.workspace_id);
  }

  switch (respuestaTrasRegistro(fila.accion)) {
    case 'pregunta':
      if (fila.entrega) await preguntarCliente(supabase, fila.entrega, message.phone, fila.mensajes ?? 0, user.workspace_id);
      break;
    case 'nada_pendiente':
      await enviar(message.phone, TEXTO_NADA_PENDIENTE, user.workspace_id);
      break;
    case 'anotado':
      await enviar(message.phone, TEXTO_ANOTADO, user.workspace_id);
      break;
    default:
      break;
  }
}

/** ¿Es un texto escrito (no reenviado) en modo `encabezado`? Solo ahí hay encabezados. */
function escritoEnModoEncabezado(message: IncomingMessage, config: ConfigBandeja): boolean {
  return config.modoViajes !== 'uno' && message.type === 'text' && message.reenviado !== true && !!(message.text || '').trim();
}

/** El encabezado que es este escrito, o `null`. Los nombres del equipo nunca lo son. */
async function encabezadoDelEscrito(
  supabase: SupabaseClient, workspaceId: string, message: IncomingMessage, config: ConfigBandeja,
): Promise<ResolucionEncabezado | null> {
  if (!escritoEnModoEncabezado(message, config)) return null;
  const c = await candidatosDeEncabezado(supabase, workspaceId);
  return c ? resolverEncabezado(message.text, c.viajes, c.equipo) : null;
}

/** Si el escrito es «sí» o «no» y la tanda abierta espera respuesta a «¿Cambias a…?», cuál y a qué viaje. */
async function respuestaAlCambio(
  supabase: SupabaseClient, workspaceId: string, message: IncomingMessage, config: ConfigBandeja,
): Promise<{ si: boolean; viaje: ViajeAbierto } | null> {
  if (!escritoEnModoEncabezado(message, config)) return null;
  const si = esSi(message.text);
  if (!si && !esNo(message.text)) return null;
  const viaje = await cambioPorConfirmar(supabase, workspaceId, message.phone, config.horasCajaActiva);
  return viaje ? { si, viaje } : null;
}

/**
 * `identifyUser` no devuelve el `staff.id` (devuelve `user_id`, el de auth). Se resuelve aquí,
 * acotado al workspace: `staff.profile_id` es único en toda la base y un staff de otro
 * workspace no puede quedar como remitente de este.
 */
async function staffIdDelRemitente(supabase: SupabaseClient, user: WaUser): Promise<string | null> {
  if (!user.user_id) return null;
  // `wa_identify_user` no vive en las migraciones del repo, así que no está escrito si su
  // `user_id` es el del perfil o el del staff: se aceptan las dos, siempre dentro del workspace.
  const { data, error } = await supabase
    .from('staff')
    .select('id')
    .eq('workspace_id', user.workspace_id)
    .or(`profile_id.eq.${user.user_id},id.eq.${user.user_id}`)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[wa-bandeja] no se pudo resolver el staff del remitente:', error.message);
    return null;
  }
  return data?.id ?? null;
}

async function enviar(phone: string, texto: string, workspaceId: string): Promise<boolean> {
  try {
    await sendTextMessage(phone, texto, { origen: 'bot', workspaceId, intent: INTENT_BANDEJA });
    return true;
  } catch (err) {
    console.error(`[wa-bandeja] no se pudo enviar a ${phone}:`, err);
    return false;
  }
}

/**
 * Hace la pregunta y deja anotado si salió. La entrega ya está cerrada cuando se llama.
 *
 * La pregunta es «¿A qué viaje van?» con la lista corta de negocios abiertos y NUEVO; la lista
 * ofrecida se guarda en la entrega para que «2» signifique lo mismo al contestar. En modo
 * `encabezado` (y con encabezados en la tanda) es el resumen del reparto (`plan_viajes`), y nada se carga hasta el «sí». Si la lista
 * no se puede armar (sin línea, error de lectura), sale la pregunta vieja «¿De qué cliente
 * es?» y la entrega sigue el camino de antes (negocio nuevo).
 */
export async function preguntarCliente(
  supabase: SupabaseClient,
  entregaId: string,
  phone: string,
  nMensajes: number,
  workspaceId: string,
): Promise<void> {
  const viaje = await armarPreguntaNegocio(supabase, entregaId, workspaceId, nMensajes);
  if (viaje?.plan && viaje.sinDudas) {
    // `confirmar: si_duda` y un reparto sin una sola duda: se carga sin preguntar, y se dice qué.
    await enviar(phone, `Cargo esto sin preguntar (un solo viaje, por encabezado):\n${viaje.texto.split('\n').slice(0, -1).join('\n')}`, workspaceId);
    const { error } = await supabase.from('wa_bandeja_entregas').update({
      plan_viajes: viaje.plan, pregunta_enviada_at: new Date().toISOString(),
      estado: 'con_cliente', cliente_texto: 'sí', cliente_respondido_at: new Date().toISOString(),
    }).eq('id', entregaId);
    if (error) console.error(`[wa-bandeja] no se pudo cargar sin preguntar ${entregaId}:`, error.message);
    return;
  }
  // Un resumen largo llega en varias partes: las primeras se mandan antes de la que espera respuesta.
  for (const p of viaje?.antes ?? []) await enviar(phone, p, workspaceId);
  const ok = await enviar(phone, viaje?.texto ?? textoPreguntaCliente(nMensajes), workspaceId);
  const lista = viaje?.plan ? { plan_viajes: viaje.plan } : viaje?.opciones ? { negocio_opciones: viaje.opciones } : {};
  const { error } = await supabase
    .from('wa_bandeja_entregas')
    .update(ok
      ? { pregunta_enviada_at: new Date().toISOString(), pregunta_error: null, ...lista }
      : { pregunta_error: 'envio fallido', ...lista })
    .eq('id', entregaId);
  if (error) console.error(`[wa-bandeja] no se pudo anotar la pregunta de ${entregaId}:`, error.message);
}

/** Lo que corre el cron: cierra lo vencido y pregunta, una vez por entrega. */
export async function cerrarEntregasVencidas(supabase: SupabaseClient): Promise<{ cerradas: number }> {
  const { data, error } = await supabase.rpc('wa_bandeja_cerrar_vencidas');
  if (error) {
    console.error('[wa-bandeja] no se pudieron cerrar las entregas vencidas:', error.message);
    return { cerradas: 0 };
  }
  const filas = (data ?? []) as Array<{ entrega: string; workspace: string; telefono: string; mensajes: number }>;
  for (const f of filas) {
    await preguntarCliente(supabase, f.entrega, f.telefono, f.mensajes, f.workspace);
  }
  return { cerradas: filas.length };
}
