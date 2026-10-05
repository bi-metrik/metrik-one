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
import {
  armarPreguntaNegocio, candidatosDeEncabezado, conNombreDelViaje, descartarPendientesDelRemitente, hayPreguntaPendiente, nombreDeLaEntrega,
  nombreYConteoDeLaTanda, pendienteDeLaTanda, preguntaAbierta, procesarEntendimientos, reintentarCarga, textoDeLaConsulta, simularEnLaTanda,
  textoDeLoQueFalta, textoPrimero, tomarRespuestaContacto, tomarRespuestaDeEntrega, cargarDatoEnElViaje, nombreDelViajeDeId, viajesAbiertosDeLaBandeja,
} from './wa-entendimiento.ts';
import { anotarConsultaPendiente, consultaVigente, focosVigentes, leerConversacion, viajeEnFoco } from './wa-foco.ts';
import type { ConsultaPendiente } from './wa-foco.ts';
import { leerNuevo, leerViajeNuevo } from './wa-entendimiento-reglas.ts';
import type { EnLaTanda, PreguntaAbierta } from './wa-entendimiento.ts';
import { interpretarRespuestaNegocio, opcionNombrada, pieDeLista } from './wa-carga-reglas.ts';
import type { OpcionNegocio } from './wa-carga-reglas.ts';
import { leerConsultaBandeja } from './wa-consulta-bandeja.ts';
import type { ConsultaBandeja } from './wa-consulta-bandeja.ts';
import {
  candidatosDelEncabezado, esRespuestaA, esRuidoEscrito, esSiNoCorto, leerEleccion, lineaCaja, nombreDeViaje, pareceEncabezado, pareceRespuesta, resolverEncabezado,
  respuestaAlEncabezado, textoPreguntaEncabezadoCorta,
} from './wa-viajes-reglas.ts';
import type { ResolucionEncabezado, ViajeAbierto } from './wa-viajes-reglas.ts';
import { sendTextMessage } from './wa-respond.ts';
import {
  bandejaActiva,
  cuerpoDelMensaje,
  decidirRuta,
  empiezaConPrefijoBot,
  esDescartarTodo,
  leerReintentar,
  textoDescarteTotal,
  esPalabraCierre,
  esPedidoDeGuia,
  esPregunta,
  ESPERA_EN_VUELO_MS,
  fechaDeMeta,
  hayQueEsperarEnVuelo,
  leerConfigBandeja,
  quitarPrefijoConsulta,
  respuestaTrasRegistro,
  salidaDeLaSesion,
  textoGuiaBandeja,
  textoPistaConsulta,
  textoPreguntaCliente,
  TEXTO_NADA_PENDIENTE,
  TEXTO_SESION_CANCELADA,
} from './wa-bandeja-reglas.ts';
import type { AccionRegistro, ConfigBandeja, ParteDescartada, Ruta } from './wa-bandeja-reglas.ts';
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
export async function configDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<ConfigBandeja> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('config_extra')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error) console.error('[wa-bandeja] no se pudo leer config_extra, uso la config por defecto:', error.message);
  return leerConfigBandeja(data?.config_extra ?? null);
}

/**
 * ¿Hay una conversación del bot a medias? Devuelve su estado, o `null`. Consulta SIN crear sesión:
 * `getOrCreateSession` insertaría una fila en `bot_sessions` por cada reenvío de la bandeja.
 */
async function sesionBotEsperando(supabase: SupabaseClient, phone: string, workspaceId: string): Promise<string | null> {
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
    return 'desconocido';
  }
  return ((data ?? [])[0]?.state as string | undefined) ?? null;
}

/** Corta la conversación del bot a medias (un «cancelar» o un encabezado la cortaron). */
async function cortarSesionBot(supabase: SupabaseClient, phone: string, workspaceId: string): Promise<void> {
  const { error } = await supabase.from('bot_sessions').update({ state: 'completed' })
    .eq('user_phone', phone).eq('workspace_id', workspaceId).in('state', ESTADOS_ESPERANDO);
  if (error) console.error('[wa-bandeja] no se pudo cerrar la sesion del bot:', error.message);
}

/** Lo que es un escrito como encabezado, para cortar una conversación del bot: por código, por nombre o nada. */
async function encabezadoParaLaSesion(
  supabase: SupabaseClient, workspaceId: string, texto: string, config: ConfigBandeja,
): Promise<'codigo' | 'nombre' | null> {
  if (config.modoViajes === 'uno') return null;
  const c = await candidatosDeEncabezado(supabase, workspaceId);
  const r = c ? resolverEncabezado(texto, c.viajes, c.equipo) : null;
  if (!r || r.tipo === 'no_reconocido') return null;
  if (r.tipo === 'codigo_desconocido' || (r.tipo === 'viaje' && r.por === 'codigo')) return 'codigo';
  return 'nombre';
}

/**
 * Decide si el mensaje va a la bandeja. Devuelve la config para no leerla dos veces.
 * Con la bandeja apagada en el workspace no toca la base: para todos los demás el bot hace
 * exactamente las mismas consultas que antes.
 *
 * Con la bandeja encendida MANDA LA BANDEJA (prueba en vivo del 2026-10-01): solo van al bot un
 * escrito con prefijo («gasto …», «bot …») y lo que contesta una conversación del bot de verdad a
 * medias. `textoParaElBot`: el escrito sin el prefijo de consulta. `atendido`: ya se contestó
 * (un «cancelar» que cortó la conversación del bot, o un pedido de guía); no hay nada más que hacer.
 */
export async function rutaDelMensaje(
  supabase: SupabaseClient,
  user: WaUser,
  message: IncomingMessage,
): Promise<{ ruta: Ruta; config: ConfigBandeja | null; textoParaElBot?: string; atendido?: boolean }> {
  const modules = (user.modulos?.modules ?? null) as Record<string, unknown> | null;
  if (!bandejaActiva(modules)) return { ruta: 'bot', config: null };

  const config = await configDelWorkspace(supabase, user.workspace_id);
  const reenviado = message.reenviado === true;
  const escrito = message.type === 'text' && !reenviado;
  // Un reenvío va a la bandeja pase lo que pase, y un prefijo del bot va al bot: ninguno de los
  // dos necesita mirar la sesión.
  const conPrefijo = escrito && empiezaConPrefijoBot(message.text, config.prefijosBot);
  // Un pedido de guía tampoco: se contesta y la conversación del bot a medias sigue como estaba.
  const guia = escrito && !conPrefijo && esPedidoDeGuia(message.text);
  const estado = reenviado || conPrefijo || guia ? null : await sesionBotEsperando(supabase, message.phone, user.workspace_id);
  const salida = estado && escrito
    ? salidaDeLaSesion({ texto: message.text, estadoSesion: estado, encabezado: await encabezadoParaLaSesion(supabase, user.workspace_id, message.text, config) })
    : null;
  const ruta = decidirRuta({
    modules, config, tipo: message.type, texto: message.text, reenviado, sesionBotEsperando: estado !== null, salidaDeSesion: salida,
  });
  if (ruta === 'guia') {
    // Solo la guía: sin registrar nada, la tanda abierta y la pregunta pendiente quedan intactas.
    await enviar(message.phone, textoGuiaBandeja(config), user.workspace_id);
    return { ruta, config, atendido: true };
  }
  if (ruta === 'bot') {
    const sinPrefijo = conPrefijo ? quitarPrefijoConsulta(message.text, config.prefijosConsulta) : null;
    // «bot ¿cómo funciona?» llega al bot como «ayuda»: el atajo del parser lo manda a `handleAyuda`
    // sin pasar por el modelo, y ahí sale la guía de la bandeja arriba de la ayuda de siempre.
    if (sinPrefijo && esPedidoDeGuia(sinPrefijo)) return { ruta, config, textoParaElBot: 'ayuda' };
    return sinPrefijo ? { ruta, config, textoParaElBot: sinPrefijo } : { ruta, config };
  }
  if (salida) {
    await cortarSesionBot(supabase, message.phone, user.workspace_id);
    if (salida === 'cancelar') {
      await enviar(message.phone, TEXTO_SESION_CANCELADA, user.workspace_id);
      return { ruta, config, atendido: true };
    }
  }
  return { ruta, config };
}

/**
 * Cuánto se espera a los mensajes en camino antes de decidir qué es un escrito
 * (`hayQueEsperarEnVuelo`). Es un objeto para que una prueba pueda intercalar ahí lo que llega
 * mientras tanto (la carrera de los webhooks), sin un reloj de verdad.
 */
export const esperaEnVuelo = {
  ms: ESPERA_EN_VUELO_MS,
  dormir: (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms)),
};

/**
 * ¿Este escrito podría tomarse como la RESPUESTA a una pregunta pendiente? Lo que hace falta para
 * `hayQueEsperarEnVuelo`: si hay una tanda abierta y si hay una pregunta (de la entrega o del
 * entendimiento) sin contestar.
 */
/** ¿El remitente tiene una tanda abierta? */
async function hayTandaAbierta(supabase: SupabaseClient, workspaceId: string, phone: string): Promise<boolean> {
  const { data } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'abierta').limit(1).maybeSingle();
  return !!data;
}

/**
 * Toma el escrito como la respuesta a la pregunta pendiente del remitente: primero una del
 * entendimiento (re-pregunta, confirmación, contacto) y si no, la de una entrega cerrada (el resumen o
 * «¿A qué viaje van?»). `aunConTandaAbierta`: aunque haya una caja abierta. Devuelve `true` si la tomó.
 */
export async function responderPendiente(
  supabase: SupabaseClient, workspaceId: string, phone: string, texto: string, wamid: string, enviadoAt: string | null,
  config: ConfigBandeja, aunConTandaAbierta: boolean,
  /** El escrito tal como llegó, si `texto` es su forma canónica (lo que tradujo el intérprete). */
  cuerpo?: string,
): Promise<boolean> {
  const antes = procesarEnElActo.activo ? await preguntaAbierta(supabase, workspaceId, phone) : null;
  const tomada = await tomarRespuestaContacto(supabase, { workspaceId, phone, texto, wamid, enviadoAt, aunConTandaAbierta, cuerpo })
    || await tomarRespuestaDeEntrega(supabase, { workspaceId, phone, texto, wamid, enviadoAt, horas: config.horasRespuestaCliente, cuerpo });
  if (tomada) await seguirEnElActo(supabase, workspaceId, phone, { texto, antes });
  return tomada;
}

/**
 * Conversación con memoria (2026-10-05, punto 5): lo que el bot toma como respuesta («1», «sí», un nombre, un código)
 * se acusa en una línea y se procesa EN EL ACTO, sin esperar al cron de cada minuto. En la prueba de Mauricio el «1»
 * tardó 55 s y el «sí» 37 s: la respuesta quedaba guardada hasta la siguiente pasada del cron (hasta 60 s) y después
 * corría el modelo. El cron sigue igual, como red: si algo falla aquí, lo toma en su pasada. Es un objeto para que las
 * pruebas que miden el cron lo puedan apagar.
 */
export const procesarEnElActo = { activo: true };

export async function seguirEnElActo(
  supabase: SupabaseClient, workspaceId: string, phone: string, p: { texto?: string; antes?: PreguntaAbierta | null } = {},
): Promise<void> {
  if (!procesarEnElActo.activo) return;
  const acuse = p.texto ? await acuseDeLaRespuesta(supabase, p.texto, p.antes ?? null) : null;
  if (acuse) await enviar(phone, acuse, workspaceId);
  try {
    await procesarEntendimientos(supabase, { workspaceId, phone });
    await enviarPreguntasEnCola(supabase, { workspaceId, phone });
  } catch (err) {
    // El cron lo vuelve a tomar en su pasada: nada se pierde.
    console.error(`[wa-bandeja] no se pudo procesar en el acto lo de ${phone}:`, err);
  }
}

/** La línea que acusa una respuesta antes del trabajo lento: a qué viaje va, o que se está cargando. */
async function acuseDeLaRespuesta(supabase: SupabaseClient, texto: string, antes: PreguntaAbierta | null): Promise<string | null> {
  const t = texto.trim();
  if (!t || esDescartarTodo(t) || /^descart/i.test(t)) return null;
  if (antes?.espera === 'resumen') return esSiNoCorto(t) && /^(?:s[ií]|dale|claro|listo|ok)/i.test(t) ? 'Listo, lo cargo. Te aviso en cuanto quede.' : 'Recibido, lo estoy revisando.';
  if (antes?.tipo === 'entrega' && antes.espera === 'viaje') {
    const { data: e } = await supabase.from('wa_bandeja_entregas').select('negocio_opciones').eq('id', antes.id).maybeSingle();
    const opciones = Array.isArray(e?.negocio_opciones) ? (e!.negocio_opciones as OpcionNegocio[]) : [];
    const r = interpretarRespuestaNegocio(t, opciones);
    const o = r.tipo === 'existente' ? opciones.find(x => x.id === r.negocio_id) : null;
    if (o) return `Listo, va a ${nombreDeViaje({ nombre: o.nombre ?? null, cliente: o.cliente ?? null, codigo: o.codigo ?? null })}. Lo estoy leyendo.`;
  }
  return 'Recibido, lo estoy leyendo. Te aviso en un momento.';
}

/**
 * «descartar» o «cancelar» escritos solos, en cualquier momento (Trappvel, 2026-10-02, regla 4):
 * descartan TODO lo pendiente del remitente y el bot dice de qué y cuántos mensajes:
 *   · la tanda abierta (queda cerrada, sin pregunta ni carga, con el motivo; el «descartar» se guarda
 *     en ella como su cierre);
 *   · las entregas que esperan su pregunta o su respuesta y los entendimientos que esperan una
 *     respuesta, de cualquier capa (`descartarPendientesDelRemitente`).
 * Antes «cancelar» solo descartaba la tanda abierta y «descartar» solo contestaba el resumen: con la
 * pregunta todavía en camino, el «descartar» de Edgar abrió una tanda nueva y quedó como contenido.
 */
export async function descartarTodo(
  supabase: SupabaseClient, workspaceId: string, phone: string, texto: string, wamid: string, enviadoAt: string | null, config: ConfigBandeja,
): Promise<void> {
  const { partes, guardada } = await descartarTandaAbierta(supabase, workspaceId, phone, texto, wamid, enviadoAt, config);
  partes.push(...await descartarPendientesDelRemitente(supabase, { workspaceId, phone, texto, wamid, enviadoAt, guardarRespuesta: !guardada, bandeja: config }));
  await enviar(phone, textoDescarteTotal(partes), workspaceId);
}

/**
 * Descarta SOLO la tanda abierta del remitente (queda cerrada, sin pregunta ni carga, con el motivo; el
 * escrito se guarda en ella como su cierre). Es la primera mitad de `descartarTodo`, y la usa sola el
 * intérprete cuando el «bórralo» se refiere a la tanda (H2, caso 2). `guardada`: el escrito quedó guardado.
 */
export async function descartarTandaAbierta(
  supabase: SupabaseClient, workspaceId: string, phone: string, texto: string, wamid: string, enviadoAt: string | null, config: ConfigBandeja,
): Promise<{ partes: ParteDescartada[]; guardada: boolean }> {
  const partes: ParteDescartada[] = [];
  const { data: abierta } = await supabase.from('wa_bandeja_entregas').select('id, remitente_staff_id, remitente_colaborador_id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'abierta').limit(1).maybeSingle();
  let guardada = false;
  if (abierta) {
    const { nombre, n } = await nombreYConteoDeLaTanda(supabase, abierta.id as string, workspaceId, config.horasCajaActiva);
    const ahora = new Date().toISOString();
    const { data: hecho, error } = await supabase.from('wa_bandeja_entregas')
      .update({ estado: 'esperando_cliente', cerrada_at: ahora, motivo_cierre: 'palabra_cierre', pregunta_error: TANDA_CANCELADA })
      .eq('id', abierta.id).eq('estado', 'abierta').select('id');
    if (error) console.error(`[wa-bandeja] no se pudo descartar la tanda ${abierta.id}:`, error.message);
    if (!error && (hecho ?? []).length > 0) {
      partes.push({ nombre, n });
      const { error: eIns } = await supabase.from('wa_bandeja_mensajes').insert({
        workspace_id: workspaceId, entrega_id: abierta.id, wa_message_id: wamid, remitente_phone: phone,
        remitente_staff_id: abierta.remitente_staff_id ?? null, remitente_colaborador_id: abierta.remitente_colaborador_id ?? null,
        tipo: 'text', papel: 'cierre', cuerpo: texto, cuerpo_origen: 'texto', enviado_at: enviadoAt,
      });
      if (eIns) console.error('[wa-bandeja] no se pudo guardar el «descartar»:', eIns.message);
      guardada = true;
    }
  }
  return { partes, guardada };
}

/** Marca de una tanda que el comercial descartó: cerrada sin pregunta (no ocupa la cola). */
const TANDA_CANCELADA = 'descartada por el comercial: no se pregunta ni se carga';

/** Marca de una tanda que solo trajo encabezados y acuses: no hay nada que preguntar (no ocupa la cola). */
const SIN_CONTENIDO = 'solo encabezados o acuses: no hay mensajes que repartir';

export async function estadoParaEsperar(
  supabase: SupabaseClient, workspaceId: string, phone: string, config: ConfigBandeja,
): Promise<{ hayAbierta: boolean; hayPregunta: boolean }> {
  const { data: abierta } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'abierta').limit(1).maybeSingle();
  if (abierta) return { hayAbierta: true, hayPregunta: false };
  const desde = new Date(Date.now() - config.horasRespuestaCliente * 3600_000).toISOString();
  const { data: esperando } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'esperando_cliente')
    .gte('pregunta_enviada_at', desde).limit(1).maybeSingle();
  return { hayAbierta: false, hayPregunta: !!esperando || await hayPreguntaPendiente(supabase, workspaceId, phone) };
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
  const escrito = message.type === 'text' && message.reenviado !== true && !!(message.text || '').trim();
  const texto = (message.text || '').trim();
  // «listo» cierra la tanda: nunca es la respuesta a una pregunta (aunque sea también un «sí»).
  const esCierre = escrito && esPalabraCierre(message.text, config.palabrasCierre);
  const responder = (aunConTandaAbierta: boolean) => responderPendiente(supabase, user.workspace_id, message.phone, texto, wamid, fechaDeMeta(message.timestamp), config, aunConTandaAbierta);

  // Órdenes del comercial a la bandeja (prueba en vivo v2): REINTENTAR una carga fallida y
  // «cancelar» la tanda abierta. Ninguna de las dos es contenido.
  if (escrito) {
    const objetivo = leerReintentar(texto);
    if (objetivo !== null) {
      await reintentarCarga(supabase, user.workspace_id, message.phone, objetivo);
      return;
    }
    // Regla 4 (Trappvel, 2026-10-02): «descartar» o «cancelar» descartan TODO lo pendiente.
    if (esDescartarTodo(texto)) {
      await descartarTodo(supabase, user.workspace_id, message.phone, texto, wamid, fechaDeMeta(message.timestamp), config);
      return;
    }
    // Una pregunta ESCRITA al bot sobre la bandeja («¿qué viajes tiene abiertos?», «¿qué le falta?», «¿qué llevo?»;
    // prueba de Mauricio del 2026-10-05, 09:26): se contesta en el acto, en solo lectura, y no se registra: nunca es
    // contenido de la tanda. Un reenvío nunca llega aquí (`escrito`). La pregunta abierta, si la hay, se recuerda.
    const consulta = esCierre ? null : leerConsultaBandeja(texto, { reenviado: false });
    if (consulta) {
      await contestarConsulta(supabase, user.workspace_id, message.phone, consulta, config);
      return;
    }
    // Conversación con memoria (2026-10-05): la consulta que esperaba su viaje, la respuesta a «me falta» (directo al
    // viaje en foco, sin tanda), la pregunta de a cuál de dos viajes va, o la carga que sigue en vuelo.
    const memoria = esCierre ? null : await decidirConMemoria(supabase, user.workspace_id, message.phone, texto, config, { wamid, enviadoAt: fechaDeMeta(message.timestamp) });
    if (memoria && await actuarConMemoria(supabase, user, message.phone, memoria, config)) return;
  }

  const pendiente = escrito ? await preguntaAbierta(supabase, user.workspace_id, message.phone) : null;
  // Lo que el escrito haría en la tanda (diseño 2026-10-05): con el directorio, la respuesta a lo que espera la
  // caja (el cliente de un viaje nuevo, su llave, cuál de los parecidos, la lista) NO es un encabezado. En la
  // prueba de Mauricio, «El cliente es Mauricio Moreno» tras «nuevo viaje» abría la lista de sus 5 viajes.
  const sim = config.modoViajes !== 'uno' && !esCierre
    ? await simularEnLaTanda(supabase, user.workspace_id, message.phone, config.horasCajaActiva, texto, fechaDeMeta(message.timestamp) ?? new Date().toISOString(),
      { reenviado: message.reenviado === true, tipo: message.type })
    : null;
  // Un encabezado («Carolina», «T1 26 9») abre una caja: nunca es la respuesta a una pregunta
  // pendiente (QA de #971: el que se escribía antes del «sí» se tomaba como respuesta al resumen).
  // Lo que la tanda toma como contenido de su caja (el nombre del cliente de un viaje nuevo, octavo control de Vera)
  // tampoco es un encabezado, aunque su texto resuelva un viaje.
  const encabezado = sim?.respuesta || sim?.contenido ? null : await encabezadoDelEscrito(supabase, user.workspace_id, message, config);

  // Regla 3 (Trappvel, 2026-10-02; antes N1 y N2 de la prueba en vivo v2): con una pregunta abierta,
  // lo que tiene forma de su respuesta la contesta, sea cual sea la capa que preguntó (el resumen,
  // «¿A qué viaje van?», el entendimiento) y aunque haya una caja abierta: nunca abre una tanda ni
  // queda como contenido. Con «¿A qué viaje van?» o el nombre de un cliente nuevo pendientes, un
  // encabezado («P 26 2», «nuevo X», el nombre de un viaje) también es la respuesta.
  //
  // Sexto control de Vera (hallazgo 7): mientras espera el «sí» a «¿Creo el cliente nuevo «X»?», TODO lo escrito
  // (que no sea la palabra de cierre) es su respuesta, aunque no tenga forma de respuesta y aunque haya una tanda
  // abierta: nunca entra a la caja de esa tanda. Si no se entiende, se vuelve a preguntar (H2). Los reenvíos sí
  // siguen siendo contenido: son del cliente, no una respuesta del comercial.
  const contesta = !!pendiente && (esRespuestaA(pendiente.espera, texto) || ((pendiente.espera === 'viaje' || pendiente.espera === 'nombre') && encabezado !== null)
    || !!pendiente.nuevoPorConfirmar);
  if (escrito && !esCierre && contesta) {
    if (await responder(true)) return;
  }

  // Si la tanda abierta espera algo en el acto (la elección de la lista de un encabezado o el nombre
  // de un «nuevo»), una respuesta va a la tanda (la relee el reparto) y no es contenido. Con otra
  // pregunta abierta, la lista del encabezado no se pregunta en el acto (una pregunta a la vez).
  // Sin la simulación (fuera del modo encabezado, o no se pudo leer la tanda) no hay nada que esperar en el acto.
  const enEspera = sim ? enEsperaDe(sim, !!pendiente) : null;
  const esEncabezado = encabezado !== null || enEspera?.respuesta === true;

  // Un acuse suelto («ok gracias», «👍») sin tanda abierta ni pregunta no abre una tanda (v2, N7).
  if (escrito && !esEncabezado && !pendiente && esRuidoEscrito(texto) && !esCierre && !(await hayTandaAbierta(supabase, user.workspace_id, message.phone))) {
    return;
  }

  // La carrera de los webhooks (prueba en vivo del 2026-10-01, error 1): un escrito que podría
  // tomarse como la respuesta a una pregunta pendiente, o una palabra de cierre, espera a que entre
  // lo que el comercial mandó justo antes (su encabezado, el último mensaje de la tanda).
  const respuesta = escrito && pareceRespuesta(message.text);
  if (escrito && !esEncabezado) {
    const e = esCierre ? { hayAbierta: true, hayPregunta: false } : await estadoParaEsperar(supabase, user.workspace_id, message.phone, config);
    if (hayQueEsperarEnVuelo({ escrito, esEncabezado, esCierre, pareceRespuesta: respuesta, ...e })) await esperaEnVuelo.dormir(esperaEnVuelo.ms);
  }

  // ¿Es la respuesta a «¿cuál de estos contactos es?» del paso de entendimiento? Se mira
  // ANTES de registrar: como contenido abriría una entrega nueva y la pregunta quedaría sin
  // respuesta. Solo un texto escrito (no reenviado) puede serlo.
  if (!esEncabezado && message.type === 'text' && message.reenviado !== true && (message.text || '').trim()) {
    const tomada = await tomarRespuestaContacto(supabase, {
      workspaceId: user.workspace_id, phone: message.phone, texto: message.text.trim(),
      wamid, enviadoAt: fechaDeMeta(message.timestamp),
    });
    if (tomada) {
      await seguirEnElActo(supabase, user.workspace_id, message.phone, { texto: message.text.trim() });
      return;
    }
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

  // En el acto (QA de #971 v5): un encabezado exacto se confirma con «📌»; uno aproximado o ambiguo
  // pregunta con la lista numerada y lo que sigue queda sin asignar hasta que el comercial elija.
  if (fila.accion === 'agregar' || fila.accion === 'abrir') {
    // Con una pregunta abierta, un encabezado nuevo (o el contenido que abre una tanda) la recuerda en
    // una línea, y se siguen registrando los mensajes (prueba en vivo del 2026-10-01; regla 3 del
    // 2026-10-02: la pregunta se vuelve a mostrar corta antes de seguir).
    const otra = encabezado || fila.accion === 'abrir'
      ? await preguntaAbierta(supabase, user.workspace_id, message.phone, fila.entrega ? [fila.entrega] : [])
      : null;
    const candidatos = candidatosDelEncabezado(encabezado);
    const aviso = enEspera ? enEspera.aviso
      // Una pregunta a la vez: con otra abierta, la lista del encabezado se decide en el resumen.
      : otra && candidatos.length > 0 ? `«${message.text.trim()}» puede ser ${candidatos.map(lineaCaja).join(' o ')}: lo decides en el resumen de esta tanda.`
      : (sim?.abre ? sim.acuse : respuestaAlEncabezado(encabezado, message.text))
        // Una pregunta escrita que abre una tanda: quizá era para el bot de siempre (se fue la regla N8).
        ?? (fila.accion === 'abrir' && escrito && esPregunta(message.text) ? textoPistaConsulta(config.prefijosConsulta) : null)
        // Nunca silencio (2026-10-05, punto 7): un escrito que abre una tanda sin cliente lo dice en una línea y qué espera.
        ?? (fila.accion === 'abrir' && escrito && config.modoViajes !== 'uno' ? await textoTandaSinCliente(supabase, user.workspace_id, message.phone, config) : null);
    const texto = [aviso, otra ? textoPrimero(otra) : null].filter(Boolean).join('\n');
    if (texto) await enviar(message.phone, texto, user.workspace_id);
  }

  switch (respuestaTrasRegistro(fila.accion)) {
    case 'pregunta':
      if (fila.entrega) await preguntarCliente(supabase, fila.entrega, message.phone, fila.mensajes ?? 0, user.workspace_id, { porPalabra: true });
      break;
    case 'nada_pendiente':
      await enviar(message.phone, TEXTO_NADA_PENDIENTE, user.workspace_id);
      break;
    default:
      break;
  }
}

/**
 * Lo que la simulación dice que contestar si la tanda esperaba algo: la respuesta en la caja (con su acuse), o el
 * recordatorio de lo que espera cuando llega contenido (solo la primera vez). `null`: la tanda no espera nada, o el
 * escrito abre otra caja. Con otra pregunta abierta, la lista del encabezado no se pregunta en el acto.
 */
function enEsperaDe(sim: EnLaTanda, hayOtraPregunta: boolean): { aviso: string | null; respuesta: boolean } | null {
  if (sim.respuesta) return { aviso: hayOtraPregunta && sim.antes?.tipo === 'eleccion' ? null : sim.acuse, respuesta: true };
  if (sim.abre || !sim.antes) return null;
  if (hayOtraPregunta && sim.antes.tipo === 'eleccion') return null;
  if (sim.antes.conContenido) return { aviso: null, respuesta: false };
  const a = sim.antes;
  return { aviso: a.tipo === 'eleccion' ? textoPreguntaEncabezadoCorta(a.texto, a.candidatos) : textoDeLoQueFalta(a), respuesta: false };
}

/**
 * Contesta una pregunta al bot sobre la bandeja (solo lectura) y recuerda en una línea lo que sigue pendiente: la
 * pregunta abierta del remitente, o lo que espera su tanda. Lo usan la ruta de hoy y el intérprete.
 */
export async function contestarConsulta(
  supabase: SupabaseClient, workspaceId: string, phone: string, consulta: ConsultaBandeja, config: ConfigBandeja,
): Promise<void> {
  // Nada de datos viejos (2026-10-05, punto 4): con una carga del remitente en vuelo, la consulta de un viaje espera a
  // que termine y lo dice; en la prueba de Mauricio contestó con lo de antes de la carga y a los 5 s ya era otra cosa.
  if (consulta.tipo !== 'tanda' && await cargaEnVuelo(supabase, workspaceId, phone)) {
    await enviar(phone, 'Lo estoy cargando; te digo en un momento.', workspaceId);
    for (let i = 0; i < esperaDeCarga.intentos && await cargaEnVuelo(supabase, workspaceId, phone); i++) await esperaDeCarga.dormir(esperaDeCarga.ms);
  }
  const respuesta = await textoDeLaConsulta(supabase, workspaceId, phone, consulta, config);
  const abierta = await preguntaAbierta(supabase, workspaceId, phone);
  const deLaTanda = abierta || config.modoViajes === 'uno' ? null : await pendienteDeLaTanda(supabase, workspaceId, phone, config.horasCajaActiva);
  const sigue = abierta ? textoPrimero(abierta) : deLaTanda ? `Sigue pendiente: ${textoDeLoQueFalta(deLaTanda)}` : null;
  await enviar(phone, [respuesta, sigue].filter(Boolean).join('\n'), workspaceId);
}

// ── Conversación con memoria (2026-10-05) ──────────────────────────────────

/** Cuánto espera una consulta a que termine la carga en vuelo (un objeto para que las pruebas intercalen la carga). */
export const esperaDeCarga = {
  ms: 1500,
  intentos: 30,
  dormir: (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms)),
};

/** Lo que hace la memoria con un escrito: contestar la consulta que esperaba su viaje, cargar el dato que responde a «me falta», preguntar a cuál de dos viajes va, o decir que la carga sigue en vuelo. */
export type DecisionMemoria =
  | { tipo: 'consulta'; consulta: ConsultaBandeja }
  | { tipo: 'dato'; negocioId: string; cuerpo: string; wamid: string; enviadoAt: string | null; deLaPendiente: boolean }
  | { tipo: 'preguntar'; texto: string; pendiente: ConsultaPendiente }
  | { tipo: 'en_vuelo'; texto: string };

/** «Lo estoy cargando»: un escrito que repite la respuesta o nombra el viaje mientras la carga sigue en vuelo. */
export const TEXTO_EN_VUELO = 'Ya lo estoy cargando; te aviso en cuanto quede.';

/**
 * ¿Qué hace la memoria con este escrito? `null`: nada (sigue el camino de hoy). Solo sin tanda abierta ni pregunta
 * pendiente, y solo en modo encabezado (donde el reparto va por viaje). Lo usan la ruta de hoy y el intérprete (que,
 * si la memoria lo toma, no llama al modelo): funciona igual con el interruptor apagado o prendido.
 */
export async function decidirConMemoria(
  supabase: SupabaseClient, workspaceId: string, phone: string, texto: string, config: ConfigBandeja,
  msg: { wamid: string; enviadoAt: string | null },
): Promise<DecisionMemoria | null> {
  const t = texto.trim();
  if (!t || config.modoViajes === 'uno') return null;
  if (await hayTandaAbierta(supabase, workspaceId, phone)) return null;
  if (await preguntaAbierta(supabase, workspaceId, phone)) return null;
  const conv = await leerConversacion(supabase, workspaceId, phone);
  const ahora = Date.now();
  const viajes = (await viajesAbiertosDeLaBandeja(supabase, workspaceId)) ?? [];
  const porId = (ids: string[]) => ids.map(id => viajes.find(v => v.id === id)).filter((v): v is ViajeAbierto => !!v);

  // 1. La consulta (o el dato) que esperaba saber de qué viaje es: el escrito que nombra el viaje la contesta.
  const pendiente = consultaVigente(conv.consulta, ahora);
  if (pendiente) {
    const cands = pendiente.candidatos?.length ? porId(pendiente.candidatos) : viajes;
    const v = viajeQueNombra(t, cands, !!pendiente.candidatos?.length);
    if (v && pendiente.tipo === 'viaje') {
      return { tipo: 'consulta', consulta: { tipo: 'viaje', ref: v.codigo ?? v.cliente ?? null, ...(pendiente.alcance && pendiente.alcance !== 'ambos' ? { alcance: pendiente.alcance } : {}) } };
    }
    if (v && pendiente.tipo === 'dato' && pendiente.texto) {
      return { tipo: 'dato', negocioId: v.id, cuerpo: pendiente.texto, wamid: pendiente.wamid ?? msg.wamid, enviadoAt: pendiente.enviadoAt ?? null, deLaPendiente: true };
    }
  }

  const enc = resolverEncabezado(t, viajes);
  // 2. Una carga del mismo remitente sigue en vuelo: un escrito que repite la respuesta («1», «el de San Andrés») o
  // nombra el MISMO viaje no abre tanda. Un encabezado de otro viaje sí (es otra cosa).
  const vuelo = await viajesEnVuelo(supabase, workspaceId, phone);
  if (vuelo) {
    const nombrados = candidatosDelEncabezado(enc).concat(enc?.tipo === 'viaje' ? [enc.viaje] : []).map(v => v.id);
    const mismo = nombrados.length > 0 && nombrados.some(id => vuelo.has(id));
    // Repetir la respuesta: un número de la lista, «el de …», o un sí/no corto (no un nombre nuevo ni otra cosa).
    const repite = !enc && (leerEleccion(t) !== null || /^(?:del?|el|la)\s+(?:de|del)\b/i.test(t) || esSiNoCorto(t));
    if (mismo || repite) return { tipo: 'en_vuelo', texto: TEXTO_EN_VUELO };
  }

  // 3. La respuesta a «me falta»: un dato escrito, sin tanda, cuando el viaje en foco es el que el bot acaba de cargar y le
  // pidió datos. No si es una pregunta, un acuse, un «nuevo …» o nombra otro viaje (eso sigue el camino de hoy).
  const vigentes = focosVigentes(conv.focos, ahora, config.minutosFoco);
  const conFaltantes = vigentes.filter(f => (f.faltan ?? 0) > 0);
  if (conFaltantes.length === 0 || (vigentes[0].faltan ?? 0) === 0) return null;
  // Un encabezado (aun del mismo viaje: abre su caja, como siempre) tampoco.
  if (esPregunta(t) || esRuidoEscrito(t) || leerNuevo(t) || leerViajeNuevo(t) !== undefined || enc || pareceEncabezado(t, viajes)) return null;
  const cands = porId(conFaltantes.slice(0, 2).map(f => f.negocio_id));
  if (cands.length === 1) return { tipo: 'dato', negocioId: cands[0].id, cuerpo: t, wamid: msg.wamid, enviadoAt: msg.enviadoAt, deLaPendiente: false };
  if (cands.length === 0) return null;
  // Dos viajes con faltantes en la ventana: va al que nombre el texto; si no nombra ninguno, se pregunta una vez.
  const v = viajeQueNombra(t, cands, false);
  if (v) return { tipo: 'dato', negocioId: v.id, cuerpo: t, wamid: msg.wamid, enviadoAt: msg.enviadoAt, deLaPendiente: false };
  return {
    tipo: 'preguntar',
    texto: `¿Para cuál viaje es lo que me escribiste: ${cands.map(lineaCaja).join(' o ')}? ${pieDeLista(cands, 'Si es un viaje nuevo, «nuevo» y el nombre del cliente.')}`,
    pendiente: { tipo: 'dato', texto: t, wamid: msg.wamid, enviadoAt: msg.enviadoAt, candidatos: cands.map(c => c.id), at: new Date().toISOString() },
  };
}

/** El viaje que el texto señala entre unos candidatos: por su código o nombre, «el de Cartagena», o el número de la lista. */
function viajeQueNombra(texto: string, cands: ReadonlyArray<ViajeAbierto>, numerada: boolean): ViajeAbierto | null {
  if (cands.length === 0) return null;
  const r = resolverEncabezado(texto, cands);
  if (r?.tipo === 'viaje' || r?.tipo === 'aproximado') return r.viaje;
  const o = opcionNombrada(texto, cands);
  if (o) return o;
  if (numerada) {
    const k = leerEleccion(texto);
    if (k !== null && cands[k - 1]) return cands[k - 1];
  }
  return null;
}

/** «Lo guardo en una tanda nueva. ¿De qué viaje es? …»: con el viaje en foco como ejemplo, si lo hay. */
async function textoTandaSinCliente(supabase: SupabaseClient, ws: string, phone: string, config: ConfigBandeja): Promise<string> {
  const f = viajeEnFoco((await leerConversacion(supabase, ws, phone)).focos, Date.now(), config.minutosFoco);
  const v = f.tipo === 'uno' ? ((await viajesAbiertosDeLaBandeja(supabase, ws)) ?? []).find(x => x.id === f.foco.negocio_id) ?? null : null;
  const ejemplo = v?.codigo ? ` Si es de ${nombreDeViaje(v)}, escribe «${v.codigo}».` : '';
  return `Lo guardo en una tanda nueva. Escríbeme de qué cliente o viaje es (el código sirve), o «nuevo» y el nombre del cliente.${ejemplo} Cuando termines, «${config.palabrasCierre[0] ?? 'listo'}».`;
}

/** Hace lo que decidió la memoria. `false`: no pudo (sigue el camino de hoy). */
export async function actuarConMemoria(
  supabase: SupabaseClient, user: WaUser, phone: string, d: DecisionMemoria, config: ConfigBandeja,
): Promise<boolean> {
  const ws = user.workspace_id;
  if (d.tipo === 'consulta') {
    await anotarConsultaPendiente(supabase, ws, phone, null);
    await contestarConsulta(supabase, ws, phone, d.consulta, config);
    return true;
  }
  if (d.tipo === 'preguntar') {
    await anotarConsultaPendiente(supabase, ws, phone, d.pendiente);
    await enviar(phone, d.texto, ws);
    return true;
  }
  if (d.tipo === 'en_vuelo') {
    await enviar(phone, d.texto, ws);
    return true;
  }
  // El dato: se acusa en el acto (qué viaje) y se carga sin tanda, resumen ni «sí»; la respuesta dice qué anotó y cuánto falta.
  const nombre = await nombreDelViajeDeId(supabase, ws, d.negocioId);
  const staffId = user.collaborator_id ? null : await staffIdDelRemitente(supabase, user);
  const ok = await cargarDatoEnElViaje(supabase, {
    workspaceId: ws, phone, staffId, colaboradorId: user.collaborator_id ?? null, wamid: d.wamid, cuerpo: d.cuerpo, enviadoAt: d.enviadoAt, negocioId: d.negocioId,
  });
  if (!ok) return false;
  if (d.deLaPendiente) await anotarConsultaPendiente(supabase, ws, phone, null);
  await enviar(phone, `Lo anoto en ${nombre ?? 'ese viaje'}. Lo estoy leyendo; te digo qué quedó.`, ws);
  await seguirEnElActo(supabase, ws, phone);
  return true;
}

/**
 * ¿Hay una carga del remitente en vuelo? Un entendimiento procesando (de hace menos de 3 minutos), una respuesta que
 * se tomó y todavía no se procesó, o una entrega lista que el entendimiento todavía no tomó.
 */
export async function cargaEnVuelo(supabase: SupabaseClient, workspaceId: string, phone: string): Promise<boolean> {
  return (await viajesEnVuelo(supabase, workspaceId, phone)) !== null;
}

/**
 * Los viajes de la carga en vuelo del remitente (los que se saben: el destino de un entendimiento, o el viaje que eligió
 * la respuesta tomada de la lista). `null`: no hay carga en vuelo. Un conjunto vacío: hay, pero no se sabe a qué viaje.
 */
export async function viajesEnVuelo(supabase: SupabaseClient, workspaceId: string, phone: string): Promise<Set<string> | null> {
  const hace = new Date(Date.now() - 3 * 60_000).toISOString();
  const viajes = new Set<string>();
  let hay = false;
  const { data: ents } = await supabase.from('wa_bandeja_entendimientos')
    .select('estado, updated_at, respuesta_negocio, respuesta_contacto, negocio_destino_id, entrega_id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).in('estado', ['procesando', 'esperando_negocio', 'esperando_contacto']).limit(20);
  for (const e of (ents ?? []) as Array<Record<string, unknown>>) {
    const enVuelo = (e.estado === 'procesando' && String(e.updated_at ?? '') >= hace)
      || (e.estado === 'esperando_negocio' && !!e.respuesta_negocio) || (e.estado === 'esperando_contacto' && !!e.respuesta_contacto);
    if (!enVuelo) continue;
    hay = true;
    if (e.negocio_destino_id) viajes.add(String(e.negocio_destino_id));
  }
  const { data: listas } = await supabase.from('wa_bandeja_entregas').select('id, cliente_texto, negocio_opciones')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'con_cliente').limit(20);
  const filas = (listas ?? []) as Array<Record<string, unknown>>;
  if (filas.length > 0) {
    const { data: tomadas } = await supabase.from('wa_bandeja_entendimientos').select('entrega_id').in('entrega_id', filas.map(x => x.id));
    const ya = new Set(((tomadas ?? []) as Array<{ entrega_id: string }>).map(x => x.entrega_id));
    for (const f of filas.filter(x => !ya.has(String(x.id)))) {
      hay = true;
      const opciones = Array.isArray(f.negocio_opciones) ? (f.negocio_opciones as OpcionNegocio[]) : [];
      const r = interpretarRespuestaNegocio(String(f.cliente_texto ?? ''), opciones);
      if (r.tipo === 'existente') viajes.add(r.negocio_id);
    }
  }
  return hay ? viajes : null;
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

/**
 * `identifyUser` no devuelve el `staff.id` (devuelve `user_id`, el de auth). Se resuelve aquí,
 * acotado al workspace: `staff.profile_id` es único en toda la base y un staff de otro
 * workspace no puede quedar como remitente de este.
 */
export async function staffIdDelRemitente(supabase: SupabaseClient, user: WaUser): Promise<string | null> {
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

export async function enviar(phone: string, texto: string, workspaceId: string): Promise<boolean> {
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
  opts: { porPalabra?: boolean } = {},
): Promise<void> {
  // Con la bandeja encendida todo lo escrito entra: una tanda hecha solo de acuses y risas («ok
  // gracias», «😂») no se pregunta. Queda cerrada con el motivo y sin pregunta (no ocupa la cola).
  if (await soloRuidoEscrito(supabase, entregaId)) {
    const { error } = await supabase.from('wa_bandeja_entregas').update({ pregunta_error: SOLO_RUIDO }).eq('id', entregaId);
    if (error) console.error(`[wa-bandeja] no se pudo anotar la tanda de ruido ${entregaId}:`, error.message);
    if (opts.porPalabra) await enviar(phone, TEXTO_NADA_PENDIENTE, workspaceId);
    return;
  }
  // Una sola pregunta abierta a la vez por remitente: con otra pendiente, esta espera en cola
  // (`pregunta_enviada_at` nula) y sale cuando se conteste la primera (`enviarPreguntasEnCola`).
  const pendiente = await preguntaAbierta(supabase, workspaceId, phone, [entregaId]);
  if (pendiente) {
    await enviar(phone, `${textoPrimero(pendiente)}\nLo que acabas de mandar te lo pregunto después.`, workspaceId);
    return;
  }
  const viaje = await armarPreguntaNegocio(supabase, entregaId, workspaceId, nMensajes);
  if (viaje?.sinContenido) {
    // Solo encabezados y acuses: no hay nada que repartir ni cargar. Se dice y no se pregunta.
    const { error } = await supabase.from('wa_bandeja_entregas').update({ pregunta_error: SIN_CONTENIDO }).eq('id', entregaId);
    if (error) console.error(`[wa-bandeja] no se pudo anotar la tanda sin contenido ${entregaId}:`, error.message);
    await enviar(phone, `${viaje.sinContenido} · No me pasaste mensajes del cliente: no creé ni cargué nada.`, workspaceId);
    return;
  }
  if (viaje?.plan && viaje.sinDudas) {
    // `confirmar: si_duda` y un reparto sin una sola duda: se carga sin preguntar, y se dice qué.
    // Sin la pregunta de arriba ni el pie: lo que se carga.
    await enviar(phone, `Cargo esto sin preguntar (un solo viaje, por encabezado):\n${viaje.texto.split('\n').slice(1, -1).join('\n')}`, workspaceId);
    const { error } = await supabase.from('wa_bandeja_entregas').update({
      plan_viajes: viaje.plan, pregunta_enviada_at: new Date().toISOString(),
      estado: 'con_cliente', cliente_texto: 'sí', cliente_respondido_at: new Date().toISOString(),
    }).eq('id', entregaId);
    if (error) console.error(`[wa-bandeja] no se pudo cargar sin preguntar ${entregaId}:`, error.message);
    return;
  }
  // Toda pregunta lleva el nombre del viaje al principio («Diego Prueba · Entendí 1 viaje…»).
  const { data: ent } = await supabase.from('wa_bandeja_entregas').select('created_at').eq('id', entregaId).maybeSingle();
  const nombre = nombreDeLaEntrega(viaje?.plan ?? null, (ent?.created_at as string | null) ?? null);
  const partes = [...(viaje?.antes ?? []), viaje?.texto ?? textoPreguntaCliente(nMensajes)].map((p, i) => (i === 0 ? conNombreDelViaje(nombre, p) : p));
  // Un resumen largo llega en varias partes: las primeras se mandan antes de la que espera respuesta.
  for (const p of partes.slice(0, -1)) await enviar(phone, p, workspaceId);
  const ok = await enviar(phone, partes[partes.length - 1], workspaceId);
  const lista = viaje?.plan ? { plan_viajes: viaje.plan } : viaje?.opciones ? { negocio_opciones: viaje.opciones } : {};
  const { error } = await supabase
    .from('wa_bandeja_entregas')
    .update(ok
      ? { pregunta_enviada_at: new Date().toISOString(), pregunta_error: null, ...lista }
      : { pregunta_error: 'envio fallido', ...lista })
    .eq('id', entregaId);
  if (error) console.error(`[wa-bandeja] no se pudo anotar la pregunta de ${entregaId}:`, error.message);
}

/** Marca de una tanda que no se pregunta: solo acuses y risas escritos por el comercial. */
const SOLO_RUIDO = 'solo acuses o risas del comercial: no se pregunta';

/** ¿La tanda es solo de escritos del comercial sin nada de una solicitud? Un reenvío, un audio o una foto nunca lo son. */
async function soloRuidoEscrito(supabase: SupabaseClient, entregaId: string): Promise<boolean> {
  const { data, error } = await supabase.from('wa_bandeja_mensajes').select('cuerpo, reenviado, tipo')
    .eq('entrega_id', entregaId).eq('papel', 'contenido');
  if (error || !data || data.length === 0) return false;
  return (data as Array<{ cuerpo: string | null; reenviado: boolean | null; tipo: string | null }>)
    .every(m => m.reenviado !== true && m.tipo === 'text' && esRuidoEscrito(m.cuerpo));
}

/**
 * Las preguntas en cola: entregas cerradas cuyo resumen no salió porque el remitente tenía otra
 * pregunta abierta. Sale una por remitente, la más vieja, cuando ya no hay otra abierta. Lo
 * llama el cron del entendimiento al terminar (ahí es donde se atienden las respuestas).
 */
export async function enviarPreguntasEnCola(supabase: SupabaseClient, de?: { workspaceId: string; phone: string }): Promise<{ enviadas: number }> {
  const base = supabase.from('wa_bandeja_entregas').select('id, workspace_id, remitente_phone, n_mensajes, cerrada_at');
  const { data, error } = await (de ? base.eq('workspace_id', de.workspaceId).eq('remitente_phone', de.phone) : base)
    .eq('estado', 'esperando_cliente').is('pregunta_enviada_at', null).is('pregunta_error', null)
    .order('cerrada_at', { ascending: true }).limit(50);
  if (error) {
    console.error('[wa-bandeja] no se pudieron leer las preguntas en cola:', error.message);
    return { enviadas: 0 };
  }
  let enviadas = 0;
  for (const e of (data ?? []) as Array<{ id: string; workspace_id: string; remitente_phone: string; n_mensajes: number | null }>) {
    if (await preguntaAbierta(supabase, e.workspace_id, e.remitente_phone, [e.id])) continue;
    await preguntarCliente(supabase, e.id, e.remitente_phone, e.n_mensajes ?? 0, e.workspace_id);
    enviadas++;
  }
  return { enviadas };
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
