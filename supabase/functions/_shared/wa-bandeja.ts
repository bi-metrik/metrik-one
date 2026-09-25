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
  const ruta = decidirRuta({
    modules, config, tipo: message.type, texto: message.text, reenviado, sesionBotEsperando: sesion,
  });
  return { ruta, config };
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
  });

  if (error) {
    // No se le contesta nada: un "no se pudo" por cada reenvío de una ráfaga sería peor. El
    // error queda en el log de la función con el wamid, que es lo que permite buscarlo en Meta.
    console.error(`[wa-bandeja] no se pudo registrar ${wamid} de ${message.phone}:`, error.message);
    return;
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaRegistro | undefined;
  if (!fila) return;

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

/** Hace la pregunta y deja anotado si salió. La entrega ya está cerrada cuando se llama. */
export async function preguntarCliente(
  supabase: SupabaseClient,
  entregaId: string,
  phone: string,
  nMensajes: number,
  workspaceId: string,
): Promise<void> {
  const ok = await enviar(phone, textoPreguntaCliente(nMensajes), workspaceId);
  const { error } = await supabase
    .from('wa_bandeja_entregas')
    .update(ok ? { pregunta_enviada_at: new Date().toISOString(), pregunta_error: null } : { pregunta_error: 'envio fallido' })
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
