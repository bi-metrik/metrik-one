// ============================================================
// aviso-datos-bot-flujo — la puerta del aviso de datos del bot, ejecutada
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-05-aviso-datos-primer-mensaje.md
// Las decisiones viven en `aviso-datos-bot.ts` (puro y probado). Aqui se lee y escribe
// `aceptaciones_terminos` y `wa_mensajes_retenidos`, y se reusa el envio del flujo de aceptacion
// de terminos (documento verificado por SHA-256 + mensaje con botones «Acepto» / «No acepto»).
//
// Dos entradas, las dos desde `wa-webhook/index.ts`:
//   · `atenderAvisoDatos` — la puerta. Va justo despues de identificar al remitente (dueño,
//     miembro o colaborador) y ANTES del interprete, la bandeja, el modulo, la transcripcion y el
//     parser: un mensaje retenido no ha tocado ningun tercero.
//   · `cerrarAviso`       — lo que pasa cuando la persona responde (boton o «acepto» escrito).
//
// Con el aviso apagado (`config_extra.aviso_datos_bot` ausente o `activo` distinto de true) la
// puerta devuelve false sin hacer ni una consulta: la config llega en la misma lectura que
// identifica al remitente.
// ============================================================

import { sendTextMessage } from './wa-respond.ts';
import type { EnvioCtx } from './wa-respond.ts';
import { logMessage } from './wa-rate-limit.ts';
import { todayBogotaISO } from './bogota.ts';
import type { IncomingMessage, SupabaseClient, WaUser } from './types.ts';
import { MENSAJE_REINTENTAR, epochAIso, sha256Hex, telefonoE164 } from './aceptacion-terminos.ts';
import type { DecisionBoton, FilaAceptacion } from './aceptacion-terminos.ts';
import {
  COLUMNAS,
  TABLA,
  avisarAdmin,
  enviarDocumentoYBotones,
  reclamarIntento,
  recordarBotones,
} from './aceptacion-terminos-flujo.ts';
import {
  INTENT_AVISO_DATOS,
  MAX_RETENIDOS,
  MENSAJE_ACEPTADO,
  MENSAJE_ACEPTADO_CON_RETENIDOS,
  MENSAJE_FALLA,
  MENSAJE_RECHAZADO,
  MENSAJE_TOPE_RETENIDOS,
  MINUTOS_RECORDATORIO_AVISO,
  SEGUNDOS_URL_DOCUMENTO,
  decidirPuerta,
  leerConfigAvisoDatos,
  mensajeParaRetener,
  mensajeRetenido,
  metaTs,
  nombreAceptante,
  seRetiene,
  versionVigente,
} from './aviso-datos-bot.ts';
import type { ConfigAvisoDatos, FilaAviso, VersionDocumento } from './aviso-datos-bot.ts';

const RETENIDOS = 'wa_mensajes_retenidos';

/** Como se procesa un mensaje retenido: `processMessage` del webhook, entero, desde el principio. */
export type Reprocesar = (message: IncomingMessage) => Promise<void>;

function ctx(workspaceId: string): EnvioCtx {
  return { origen: 'bot', workspaceId, intent: INTENT_AVISO_DATOS };
}

const digitos = (telefono: string) => telefono.replace(/\D/g, '');

// ── La puerta ──────────────────────────────────────────────────────────────────────────

/**
 * Devuelve true si el mensaje NO debe seguir (quedo retenido, era la respuesta al aviso, o la
 * puerta no pudo decidir). False = la persona acepto la version vigente, o el aviso esta apagado.
 *
 * Falla CERRADA: con el aviso encendido, si no se puede leer la constancia, la config esta mal o
 * el documento no se puede preparar, el mensaje no se procesa y se le dice que lo intente luego.
 */
export async function atenderAvisoDatos(
  supabase: SupabaseClient,
  user: WaUser,
  message: IncomingMessage,
  reprocesar: Reprocesar,
): Promise<boolean> {
  const lectura = leerConfigAvisoDatos(user.modulos?.aviso_datos_bot);
  if (lectura.estado === 'apagado') return false;

  const telefono = telefonoE164(message.phone);
  if (lectura.estado === 'invalido' || !telefono) {
    const motivo = lectura.estado === 'invalido' ? lectura.motivo : `telefono ilegible (${message.phone})`;
    await fallaCerrada(message.phone, user.workspace_id, `config_extra.aviso_datos_bot: ${motivo}`);
    return true;
  }
  const config = lectura.config;

  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq('workspace_id', user.workspace_id)
    .eq('telefono', telefono)
    .eq('aviso_datos_version', config.version)
    .in('estado', ['pendiente', 'aceptado'])
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    await fallaCerrada(message.phone, user.workspace_id, `no se pudo leer la constancia (${error.message})`, false);
    return true;
  }

  const filas = (data ?? []) as FilaAceptacion[];
  const decision = decidirPuerta({
    filas: filas as unknown as FilaAviso[],
    texto: message.type === 'text' ? message.text : null,
    ahora: new Date(),
    wamid: message.wa_message_id,
  });

  switch (decision.accion) {
    case 'pasar':
      return false;
    case 'duplicado':
      return true;
    case 'responder': {
      const fila = filas.find((f) => f.id === decision.fila.id) as FilaAceptacion;
      await responderEscrito(supabase, message, fila, decision.decision, reprocesar);
      return true;
    }
    case 'retener': {
      await expirarVencidas(supabase, decision.vencidas);
      const fila = filas.find((f) => f.id === decision.fila.id) as FilaAceptacion;
      return await retenerYRecordar(supabase, user, message, fila);
    }
    case 'crear': {
      await expirarVencidas(supabase, decision.vencidas);
      const fila = await crearSolicitud(supabase, user, telefono, config);
      if (!fila) {
        await sendTextMessage(message.phone, MENSAJE_FALLA, ctx(user.workspace_id));
        return true;
      }
      return await retenerYRecordar(supabase, user, message, fila);
    }
  }
}

/**
 * Retiene el mensaje y recuerda el aviso, maximo una vez cada `MINUTOS_RECORDATORIO_AVISO` (una
 * rafaga de reenvios recibe UN aviso, no uno por mensaje). Devuelve true si el mensaje no sigue.
 */
async function retenerYRecordar(
  supabase: SupabaseClient,
  user: WaUser,
  message: IncomingMessage,
  fila: FilaAceptacion,
): Promise<boolean> {
  const retenido = await retener(supabase, fila, message);

  // Carrera: la persona acepto (o rechazo) en otro webhook entre la lectura de arriba y la
  // insercion. El reproceso de esa aceptacion ya leyo la lista y este mensaje no estaba: se
  // atiende aqui mismo, o se borra si no acepto.
  if (retenido.estado === 'retenido') {
    const ahora = await estadoActual(supabase, fila.id);
    if (ahora === 'aceptado') return !(await tomarRetenido(supabase, retenido.id, message.phone));
    if (ahora === 'rechazado' || ahora === 'expirado') {
      await supabase.from(RETENIDOS).delete().eq('id', retenido.id);
      if (ahora === 'rechazado') return true;
    }
  }
  if (retenido.estado === 'error') {
    await sendTextMessage(message.phone, MENSAJE_FALLA, ctx(user.workspace_id));
    return true;
  }

  if (await reclamarIntento(supabase, fila.id, new Date(), MINUTOS_RECORDATORIO_AVISO)) {
    if (retenido.estado === 'tope') await sendTextMessage(message.phone, MENSAJE_TOPE_RETENIDOS, ctx(user.workspace_id));
    if (fila.enviado_at) await recordarBotones(supabase, message.phone, fila);
    else await enviarDocumentoYBotones(supabase, message.phone, fila);
  }
  return true;
}

type Retencion =
  | { estado: 'retenido'; id: string }
  | { estado: 'duplicado' | 'tope' | 'no_se_retiene' | 'error' };

/** Guarda el mensaje para procesarlo al aceptar. Nada sale de la base: ni transcripcion ni modelo. */
async function retener(supabase: SupabaseClient, fila: FilaAceptacion, message: IncomingMessage): Promise<Retencion> {
  if (!seRetiene(message)) return { estado: 'no_se_retiene' };

  const { count, error: errCount } = await supabase
    .from(RETENIDOS)
    .select('id', { count: 'exact', head: true })
    .eq('aceptacion_id', fila.id);
  if (errCount) {
    console.error(`[aviso-datos] no se pudo contar lo retenido de ${fila.id}:`, errCount.message);
    return { estado: 'error' };
  }
  if ((count ?? 0) >= MAX_RETENIDOS) {
    console.warn(`[aviso-datos] ${fila.telefono} paso el tope de ${MAX_RETENIDOS} retenidos; este no se guarda`);
    return { estado: 'tope' };
  }

  const { data, error } = await supabase
    .from(RETENIDOS)
    .insert({
      aceptacion_id: fila.id,
      workspace_id: fila.workspace_id,
      telefono: fila.telefono,
      wa_message_id: message.wa_message_id ?? null,
      tipo: message.type,
      mensaje: mensajeParaRetener(message),
      meta_ts: metaTs(message.timestamp),
      expira_at: fila.expira_at,
    })
    .select('id');
  // 23505 = el mismo wamid ya esta retenido: un reintento de Meta. No se guarda ni se procesa dos veces.
  if (error?.code === '23505') return { estado: 'duplicado' };
  if (error || !data?.[0]?.id) {
    console.error(`[aviso-datos] no se pudo retener el mensaje de ${fila.telefono}:`, error?.message ?? 'sin fila');
    return { estado: 'error' };
  }
  return { estado: 'retenido', id: data[0].id as string };
}

/**
 * Crea la solicitud de esta persona para la version vigente: verifica la version del documento,
 * firma su URL (Meta la descarga) y deja la fila `pendiente`. Si otro mensaje simultaneo ya la
 * creo (indice unico parcial), devuelve esa.
 */
async function crearSolicitud(
  supabase: SupabaseClient,
  user: WaUser,
  telefono: string,
  config: ConfigAvisoDatos,
): Promise<FilaAceptacion | null> {
  const { data: doc, error: errDoc } = await supabase
    .from('documentos_contractuales_versiones')
    .select('id, titulo, version, pdf_bucket, pdf_path, pdf_sha256, texto_sha256, vigente_desde, vigente_hasta')
    .eq('id', config.documentoVersionId)
    .maybeSingle();
  if (errDoc || !doc) {
    await alertarConfig(user.workspace_id, `la version ${config.documentoVersionId} no se pudo leer (${errDoc?.message ?? 'no existe'})`);
    return null;
  }
  const version = doc as VersionDocumento;
  if (!versionVigente(version, todayBogotaISO())) {
    await alertarConfig(user.workspace_id, `la version ${version.id} no está vigente hoy`);
    return null;
  }

  const { data: firmada, error: errUrl } = await supabase.storage
    .from(version.pdf_bucket)
    .createSignedUrl(version.pdf_path, SEGUNDOS_URL_DOCUMENTO);
  const url = (firmada?.signedUrl as string | undefined) ?? '';
  if (errUrl || !url.startsWith('https://')) {
    await alertarConfig(user.workspace_id, `no se pudo firmar el PDF ${version.pdf_bucket}/${version.pdf_path} (${errUrl?.message ?? url})`);
    return null;
  }

  const { data, error } = await supabase
    .from(TABLA)
    .insert({
      workspace_id: user.workspace_id,
      telefono,
      nombre_aceptante: nombreAceptante(user.name),
      // Acepta como titular de sus datos, no en nombre de la empresa.
      calidad: 'persona_natural',
      documento_titulo: version.titulo,
      documento_version: version.version,
      documento_url: url,
      documento_sha256: version.pdf_sha256,
      texto_aceptacion: config.texto,
      canal: 'whatsapp',
      documento_version_id: version.id,
      texto_documento_sha256: version.texto_sha256,
      texto_aceptacion_sha256: await sha256Hex(new TextEncoder().encode(config.texto).buffer as ArrayBuffer),
      aviso_datos_version: config.version,
    })
    .select(COLUMNAS);
  if (!error && data?.[0]) return data[0] as FilaAceptacion;

  if (error?.code === '23505') {
    const { data: otra } = await supabase
      .from(TABLA)
      .select(COLUMNAS)
      .eq('workspace_id', user.workspace_id)
      .eq('telefono', telefono)
      .eq('aviso_datos_version', config.version)
      .eq('estado', 'pendiente')
      .limit(1);
    if (otra?.[0]) return otra[0] as FilaAceptacion;
  }
  console.error(`[aviso-datos] no se pudo crear la solicitud de ${telefono}:`, error?.message ?? 'sin fila');
  return null;
}

// ── La respuesta ───────────────────────────────────────────────────────────────────────

/**
 * «acepto» / «no acepto» ESCRITO sobre un aviso ya mostrado. Misma escritura condicionada que el
 * boton (solo sobre la fila pendiente y vigente de ESE telefono), con el wamid del mensaje como
 * llave de idempotencia y `button_id = 'texto:<decision>'` para que se distinga del toque.
 */
async function responderEscrito(
  supabase: SupabaseClient,
  message: IncomingMessage,
  fila: FilaAceptacion,
  decision: DecisionBoton,
  reprocesar: Reprocesar,
): Promise<void> {
  const wamid = message.wa_message_id;
  if (!wamid) {
    // Sin wamid no hay como deduplicar: no es evidencia. Se le piden los botones.
    await recordarBotones(supabase, message.phone, fila);
    return;
  }
  const ahora = new Date();
  const respondidoAt = epochAIso(message.timestamp) ?? ahora.toISOString();
  const { data, error } = await supabase
    .from(TABLA)
    .update({
      estado: decision === 'acepto' ? 'aceptado' : 'rechazado',
      reply_wamid: wamid,
      button_id: `texto:${decision}`,
      payload_respuesta: {
        via: 'texto',
        mensaje: { id: wamid, type: 'text', timestamp: message.timestamp, text: { body: message.text } },
        cuerpo_webhook: message.webhook_crudo?.cuerpo ?? null,
        x_hub_signature_256: message.webhook_crudo?.firma ?? null,
        recibido_at: ahora.toISOString(),
      },
      respondido_at: respondidoAt,
    })
    .eq('id', fila.id)
    .eq('telefono', fila.telefono)
    .eq('estado', 'pendiente')
    .gt('expira_at', ahora.toISOString())
    .select(COLUMNAS);

  if (error && error.code !== '23505') {
    console.error(`[aviso-datos] no se pudo registrar la respuesta escrita sobre ${fila.id}:`, error.message);
    await sendTextMessage(message.phone, MENSAJE_REINTENTAR, ctx(fila.workspace_id));
    return;
  }
  const aplicada = (data?.[0] ?? null) as FilaAceptacion | null;
  if (!aplicada) {
    // Reintento de Meta del mismo mensaje, o un toque simultaneo que gano: ya se confirmo alla.
    console.log(`[aviso-datos] respuesta escrita sin aplicar sobre ${fila.id} (duplicada o ya respondida)`);
    return;
  }
  await logMessage(supabase, message.phone, 'inbound', aplicada.workspace_id, INTENT_AVISO_DATOS, `[texto] ${decision}`);
  await cerrarAviso(supabase, aplicada, decision, respondidoAt, reprocesar);
}

/**
 * La persona respondio el aviso (boton o texto) y la fila ya quedo `aceptado` o `rechazado`.
 *
 * - Acepto: se marca `wa_collaborators.consent_accepted_at` (si es colaborador), se confirma en
 *   una linea y se procesa lo retenido EN ORDEN (timestamp de Meta, luego llegada), uno a uno y
 *   de punta a punta por `processMessage`. Cada mensaje se reclama borrandolo: dos procesos no
 *   procesan el mismo, y lo procesado no queda guardado.
 * - No acepto: se borra lo retenido sin procesarlo, se le dice que no podra usar el bot y se
 *   avisa a quien opera.
 */
export async function cerrarAviso(
  supabase: SupabaseClient,
  fila: FilaAceptacion,
  decision: DecisionBoton,
  respondidoAt: string,
  reprocesar: Reprocesar,
): Promise<void> {
  const phone = digitos(fila.telefono);

  if (decision !== 'acepto' || fila.estado !== 'aceptado') {
    const { error } = await supabase.from(RETENIDOS).delete().eq('aceptacion_id', fila.id);
    if (error) console.error(`[aviso-datos] no se pudo borrar lo retenido de ${fila.id}:`, error.message);
    await sendTextMessage(phone, MENSAJE_RECHAZADO, ctx(fila.workspace_id));
    await avisarAdmin(
      `🚫 ${fila.nombre_aceptante} (${fila.telefono}) NO aceptó el aviso de datos del bot (versión ${fila.aviso_datos_version}). No podrá usar el bot hasta que lo acepte; lo que había enviado se borró sin procesar.`,
      { telefono: fila.telefono, nombre: fila.nombre_aceptante, version: fila.aviso_datos_version ?? null },
    );
    return;
  }

  await marcarConsentimiento(supabase, fila, respondidoAt);

  const { data, error } = await supabase
    .from(RETENIDOS)
    .select('id')
    .eq('aceptacion_id', fila.id)
    .order('meta_ts', { ascending: true, nullsFirst: false })
    .order('orden', { ascending: true });
  if (error) console.error(`[aviso-datos] no se pudo leer lo retenido de ${fila.id}:`, error.message);
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);

  await sendTextMessage(phone, ids.length ? MENSAJE_ACEPTADO_CON_RETENIDOS : MENSAJE_ACEPTADO, ctx(fila.workspace_id));

  for (const id of ids) {
    const m = await tomarRetenido(supabase, id, phone);
    if (!m) continue;
    try {
      await reprocesar(m);
    } catch (err) {
      // Uno que falla no detiene a los demas. Ya no esta retenido: se perdio, como se perderia
      // cualquier mensaje que revienta en el flujo normal.
      console.error(`[aviso-datos] fallo el reproceso de un mensaje retenido de ${fila.telefono}:`, err);
    }
  }
}

/** Reclama un retenido borrandolo, y lo devuelve listo para `processMessage`. Null si otro ya lo tomo. */
async function tomarRetenido(supabase: SupabaseClient, id: string, phone: string): Promise<IncomingMessage | null> {
  const { data, error } = await supabase.from(RETENIDOS).delete().eq('id', id).select('mensaje');
  if (error) {
    console.error(`[aviso-datos] no se pudo tomar el retenido ${id}:`, error.message);
    return null;
  }
  const fila = (data?.[0] ?? null) as { mensaje: unknown } | null;
  return fila ? mensajeRetenido(fila.mensaje, digitos(phone)) : null;
}

/** Ley 1581: el colaborador queda con su fecha de consentimiento. Al staff no aplica (no esta en la tabla). */
async function marcarConsentimiento(supabase: SupabaseClient, fila: FilaAceptacion, respondidoAt: string): Promise<void> {
  const d = digitos(fila.telefono);
  const { error } = await supabase
    .from('wa_collaborators')
    .update({ consent_accepted_at: respondidoAt })
    .eq('workspace_id', fila.workspace_id)
    .or(`phone.eq.${d},phone.eq.+${d}`);
  if (error) console.error(`[aviso-datos] no se pudo marcar consent_accepted_at de ${fila.telefono}:`, error.message);
}

// ── Apoyo ──────────────────────────────────────────────────────────────────────────────

async function estadoActual(supabase: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await supabase.from(TABLA).select('estado').eq('id', id).maybeSingle();
  return (data?.estado as string | undefined) ?? null;
}

async function expirarVencidas(supabase: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from(TABLA)
    .update({ estado: 'expirado' })
    .in('id', ids)
    .eq('estado', 'pendiente')
    .lte('expira_at', new Date().toISOString());
  if (error) console.error('[aviso-datos] no se pudieron expirar solicitudes vencidas:', error.message);
}

async function fallaCerrada(phone: string, workspaceId: string, motivo: string, esConfig = true): Promise<void> {
  console.error(`[aviso-datos] puerta cerrada para ${phone} (workspace ${workspaceId}): ${motivo}`);
  await sendTextMessage(phone, MENSAJE_FALLA, ctx(workspaceId));
  if (esConfig) await alertarConfig(workspaceId, motivo);
}

// Un aviso interno por workspace cada 30 min como maximo (por instancia): con la config rota, cada
// mensaje del equipo pasaria por aqui.
const ultimaAlerta = new Map<string, number>();
const MS_ENTRE_ALERTAS = 30 * 60_000;

async function alertarConfig(workspaceId: string, motivo: string): Promise<void> {
  console.error(`[aviso-datos] workspace ${workspaceId}: ${motivo}`);
  const ahora = Date.now();
  if (ahora - (ultimaAlerta.get(workspaceId) ?? 0) < MS_ENTRE_ALERTAS) return;
  ultimaAlerta.set(workspaceId, ahora);
  await avisarAdmin(
    `⚠️ El aviso de datos del bot está encendido en el workspace ${workspaceId} pero no se puede mostrar: ${motivo}. Nadie de ese workspace puede usar el bot hasta corregirlo (o apagar config_extra.aviso_datos_bot).`,
    { workspace: workspaceId, motivo },
  );
}
