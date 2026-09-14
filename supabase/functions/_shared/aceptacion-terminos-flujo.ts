// ============================================================
// aceptacion-terminos-flujo — ejecuta el flujo de aceptacion en el webhook
// ------------------------------------------------------------
// Las decisiones viven en `aceptacion-terminos.ts` (puro y probado). Aqui solo se lee y
// escribe `aceptaciones_terminos`, se habla con Meta y se avisa a quien opera.
//
// Dos puertas, y las dos las llama `wa-webhook/index.ts`:
//   · `atenderBotonTerminos`   — va PRIMERO en processMessage: un toque de "Acepto"/"No acepto"
//                                 no puede caer en Cardumen, Venezuela ni en el flujo de gastos.
//   · `atenderPendienteTerminos` — va justo antes del "no reconozco este numero", y tambien
//                                 corre para numeros registrados.
// ============================================================

import { sendButtons, sendDocument, sendTextMessage, sendTextoExacto } from './wa-respond.ts';
import type { EnvioCtx } from './wa-respond.ts';
import { enviarAvisoInterno } from './wa-alerta.ts';
import { logMessage } from './wa-rate-limit.ts';
import type { IncomingMessage, SupabaseClient } from './types.ts';
import {
  INTENT_ACEPTACION,
  MINUTOS_ENTRE_RECORDATORIOS,
  MENSAJE_AJENA,
  MENSAJE_DOCUMENTO_EN_PREPARACION,
  MENSAJE_REINTENTAR,
  MENSAJE_VENCIDA,
  avisoRespuesta,
  botonesAceptacion,
  clasificarRespuestaNoAplicada,
  accionImplementada,
  decidirEntrante,
  enmascararSecreto,
  esIdDeTerminos,
  estaVigente,
  estadoPorDecision,
  leerRespuestaBoton,
  leyendaDocumento,
  mensajeConfirmacion,
  mensajeYaRespondida,
  mensajesCredencialValida,
  mismoHash,
  nombreArchivo,
  sha256Hex,
  telefonoE164,
} from './aceptacion-terminos.ts';
import type { DecisionBoton, FilaAceptacion, ResultadoAccion } from './aceptacion-terminos.ts';

const TABLA = 'aceptaciones_terminos';
const ACCIONES = 'aceptaciones_terminos_acciones';

// Todo menos `payload_respuesta`, que lleva el cuerpo crudo del webhook y no hace falta leer.
const COLUMNAS = [
  'id', 'workspace_id', 'negocio_id', 'telefono', 'nombre_aceptante', 'calidad',
  'empresa_nombre', 'empresa_nit', 'documento_titulo', 'documento_version', 'documento_url',
  'documento_sha256', 'texto_aceptacion', 'estado', 'prompt_wamid', 'documento_wamid',
  'reply_wamid', 'button_id', 'enviado_at', 'ultimo_intento_at', 'respondido_at', 'expira_at',
  'created_at',
].join(', ');

/** Tope de lo que se descarga para verificar el hash. Meta acepta documentos hasta 100 MB, pero
 *  un documento para aceptar por WhatsApp de mas de esto es un error de quien creo la fila. */
const MAX_BYTES_DOCUMENTO = 25 * 1024 * 1024;
const TIMEOUT_DESCARGA_MS = 10_000;
const PAUSA_ENTRE_DOCUMENTO_Y_BOTONES_MS = 3_000;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ctxEnvio(fila: Pick<FilaAceptacion, 'workspace_id'>): EnvioCtx {
  return { origen: 'bot', workspaceId: fila.workspace_id, intent: INTENT_ACEPTACION };
}

// ── Toque de boton ─────────────────────────────────────────────────────────────────────

/**
 * Registra un toque de "Acepto"/"No acepto". Devuelve true si el mensaje era de este flujo
 * (aunque no se haya podido registrar), false si no tiene nada que ver y debe seguir su camino.
 *
 * Idempotencia: el UPDATE solo aplica sobre una fila `pendiente` y vigente de ESE telefono, y
 * `reply_wamid` es unico. Un reintento de Meta del mismo toque encuentra la fila ya respondida
 * con su mismo wamid y no hace nada: ni segunda confirmacion ni segundo aviso.
 */
export async function atenderBotonTerminos(supabase: SupabaseClient, message: IncomingMessage): Promise<boolean> {
  if (message.type !== 'interactive' || !esIdDeTerminos(message.interactive_reply)) return false;

  const respuesta = leerRespuestaBoton(message.meta_mensaje);
  const telefono = telefonoE164(message.phone);
  if (!respuesta || !telefono) {
    // Tiene el prefijo pero no se deja leer (id alterado, sin wamid). No se registra nada: un
    // toque que no se puede deduplicar ni atribuir no es evidencia.
    console.warn(`[aceptacion] toque ilegible de ${message.phone}: ${message.interactive_reply}`);
    await sendTextMessage(message.phone, MENSAJE_AJENA);
    return true;
  }

  const ahora = new Date();
  const respondidoAt = respuesta.respondidoAt ?? ahora.toISOString();
  const payload = {
    mensaje: message.meta_mensaje ?? null,
    cuerpo_webhook: message.webhook_crudo?.cuerpo ?? null,
    x_hub_signature_256: message.webhook_crudo?.firma ?? null,
    recibido_at: ahora.toISOString(),
  };

  const { data: aplicadas, error } = await supabase
    .from(TABLA)
    .update({
      estado: estadoPorDecision(respuesta.decision),
      reply_wamid: respuesta.replyWamid,
      button_id: respuesta.buttonId,
      payload_respuesta: payload,
      respondido_at: respondidoAt,
    })
    .eq('id', respuesta.aceptacionId)
    .eq('telefono', telefono)
    .eq('estado', 'pendiente')
    .gt('expira_at', ahora.toISOString())
    .select(COLUMNAS);

  // 23505 = el reply_wamid ya esta en otra escritura: es el mismo toque llegando dos veces a la
  // vez. Se trata igual que cero filas y la clasificacion lo reconoce como duplicado.
  if (error && error.code !== '23505') {
    console.error(`[aceptacion] no se pudo registrar ${respuesta.aceptacionId}:`, error.message);
    await sendTextMessage(message.phone, MENSAJE_REINTENTAR);
    return true;
  }

  const fila = (aplicadas?.[0] ?? null) as FilaAceptacion | null;
  if (fila) {
    await logMessage(supabase, message.phone, 'inbound', fila.workspace_id, INTENT_ACEPTACION, `[boton] ${respuesta.titulo ?? respuesta.decision}`);
    await sendTextMessage(message.phone, mensajeConfirmacion(fila, respuesta.decision, respondidoAt), ctxEnvio(fila));
    // Las acciones solo corren aqui, en el UPDATE que gano. Un reintento de Meta cae en
    // `duplicado` y nunca llega a esta linea, asi que la llave no sale dos veces.
    const acciones = fila.estado === 'aceptado'
      ? await ejecutarAccionesPostAceptacion(supabase, message.phone, fila)
      : await accionesSinEjecutar(supabase, fila.id);
    await avisarRespuesta(supabase, fila, respuesta.decision, respondidoAt, acciones);
    // Si a esta persona le queda otro documento por aceptar, se muestra ya: la ventana de 24 h
    // esta abierta y esperar a que vuelva a escribir es perderla.
    await mostrarSiguientePendiente(supabase, message.phone, telefono);
    return true;
  }

  await atenderToqueNoAplicado(supabase, message.phone, telefono, respuesta.aceptacionId, respuesta.replyWamid, respuesta.decision, ahora);
  return true;
}

async function atenderToqueNoAplicado(
  supabase: SupabaseClient,
  phone: string,
  telefono: string,
  aceptacionId: string,
  replyWamid: string,
  decision: DecisionBoton,
  ahora: Date,
): Promise<void> {
  const { data, error } = await supabase.from(TABLA).select(COLUMNAS).eq('id', aceptacionId).maybeSingle();
  if (error) {
    console.error(`[aceptacion] no se pudo releer ${aceptacionId}:`, error.message);
    await sendTextMessage(phone, MENSAJE_REINTENTAR);
    return;
  }
  const fila = (data ?? null) as FilaAceptacion | null;
  const motivo = clasificarRespuestaNoAplicada(fila, telefono, replyWamid, ahora);
  console.log(`[aceptacion] toque sin aplicar sobre ${aceptacionId}: ${motivo}`);

  switch (motivo) {
    case 'duplicado':
      return; // reintento de Meta: ya se confirmo y ya se aviso
    case 'ajena':
      await sendTextMessage(phone, MENSAJE_AJENA);
      return;
    case 'reintentar':
      await sendTextMessage(phone, MENSAJE_REINTENTAR);
      return;
    case 'ya_respondida': {
      const f = fila as FilaAceptacion;
      await sendTextMessage(phone, mensajeYaRespondida(f), ctxEnvio(f));
      // Tocar el otro boton despues de responder es intentar cambiar la respuesta: eso lo tiene
      // que saber quien opera, porque por aqui no se cambia.
      if (estadoPorDecision(decision) !== f.estado) {
        await avisarAdmin(
          `⚠️ ${f.nombre_aceptante} (${f.telefono}) tocó «${decision === 'acepto' ? 'Acepto' : 'No acepto'}» sobre «${f.documento_titulo}», que ya estaba ${f.estado}. No se cambió la respuesta.`,
          { documento: f.documento_titulo, telefono: f.telefono, estado: f.estado },
        );
      }
      return;
    }
    case 'vencida': {
      const f = fila as FilaAceptacion;
      if (f.estado === 'pendiente') await expirar(supabase, telefono);
      await sendTextMessage(phone, MENSAJE_VENCIDA, ctxEnvio(f));
      await avisarAdmin(
        `⏰ ${f.nombre_aceptante} (${f.telefono}) tocó un botón de «${f.documento_titulo}» cuando la solicitud ya había vencido. No se registró; si todavía aplica, crea una fila nueva.`,
        { documento: f.documento_titulo, telefono: f.telefono },
      );
      return;
    }
  }
}

// ── Mensaje de un telefono con pendiente ─────────────────────────────────────────────────

/**
 * Si el telefono tiene una aceptacion pendiente, la atiende (documento, recordatorio o nada,
 * segun `decidirEntrante`). Devuelve true si el mensaje NO debe seguir al flujo normal.
 *
 * Ante un error leyendo la tabla devuelve false: una falla de este flujo no puede dejar mudo al
 * bot para todos los demas.
 */
export async function atenderPendienteTerminos(
  supabase: SupabaseClient,
  message: IncomingMessage,
  registrado: boolean,
): Promise<boolean> {
  const telefono = telefonoE164(message.phone);
  if (!telefono) return false;

  const ahora = new Date();
  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq('telefono', telefono)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) {
    console.error(`[aceptacion] no se pudieron leer pendientes de ${telefono}:`, error.message);
    return false;
  }

  const filas = (data ?? []) as FilaAceptacion[];
  if (filas.length === 0) return false;
  if (filas.some((f) => !estaVigente(f, ahora))) await expirar(supabase, telefono);

  const fila = filas.find((f) => estaVigente(f, ahora)) ?? null;
  const decision = decidirEntrante({ pendiente: fila, registrado, ahora });
  if (!fila) return !decision.continuar;

  if (!decision.continuar) {
    // Queda constancia de lo que la persona escribio mientras se le esperaba la respuesta. El
    // flujo normal no lo va a registrar, porque el mensaje no sigue.
    const preview = (message.text || '').trim() || `[${message.type}]`;
    await logMessage(supabase, message.phone, 'inbound', fila.workspace_id, INTENT_ACEPTACION, preview);
  }

  // Dos mensajes seguidos ("Hola" + "buenos dias") llegan como dos webhooks casi a la vez: sin el
  // reclamo atomico, los dos verian la fila sin intento y la persona recibiria el documento doble.
  if (decision.enviar && (await reclamarIntento(supabase, fila.id, ahora, MINUTOS_ENTRE_RECORDATORIOS))) {
    if (decision.enviar === 'documento') await enviarDocumentoYBotones(supabase, message.phone, fila);
    else await recordarBotones(supabase, message.phone, fila);
  }

  return !decision.continuar;
}

async function mostrarSiguientePendiente(supabase: SupabaseClient, phone: string, telefono: string): Promise<void> {
  const ahora = new Date();
  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq('telefono', telefono)
    .eq('estado', 'pendiente')
    .gt('expira_at', ahora.toISOString())
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) {
    console.error(`[aceptacion] no se pudo buscar el siguiente pendiente de ${telefono}:`, error.message);
    return;
  }
  const fila = (data?.[0] ?? null) as FilaAceptacion | null;
  if (!fila) return;
  // Se ignora el enfriamiento a proposito (cero minutos): acaba de responder otro documento, no
  // esta insistiendo. El reclamo sigue, para que dos toques simultaneos no lo muestren dos veces.
  if (!(await reclamarIntento(supabase, fila.id, ahora, 0))) return;
  if (fila.enviado_at) await recordarBotones(supabase, phone, fila);
  else await enviarDocumentoYBotones(supabase, phone, fila);
}

/**
 * Primera vez: verifica el documento, lo envia y despues envia los botones. `enviado_at` se marca
 * solo si salieron LOS DOS: sin botones no hubo nada que aceptar, y el siguiente intento vuelve a
 * mandar el documento.
 */
async function enviarDocumentoYBotones(supabase: SupabaseClient, phone: string, fila: FilaAceptacion): Promise<void> {
  const verificacion = await verificarDocumento(fila.documento_url, fila.documento_sha256);
  if (!verificacion.ok) {
    console.error(`[aceptacion] documento de ${fila.id} no verificado: ${verificacion.motivo}`);
    await sendTextMessage(phone, MENSAJE_DOCUMENTO_EN_PREPARACION, ctxEnvio(fila));
    await avisarAdmin(
      `⚠️ No se envió «${fila.documento_titulo}» a ${fila.nombre_aceptante} (${fila.telefono}): ${verificacion.motivo}. La persona ya escribió y está esperando. Corrige la URL o el hash de la fila ${fila.id}.`,
      { documento: fila.documento_titulo, telefono: fila.telefono, motivo: verificacion.motivo },
    );
    return;
  }

  const ctx = ctxEnvio(fila);
  const documentoWamid = await sendDocument(phone, fila.documento_url, nombreArchivo(fila), leyendaDocumento(fila), ctx);
  if (!documentoWamid) {
    await avisarAdmin(
      `⚠️ Meta rechazó el envío de «${fila.documento_titulo}» a ${fila.telefono} (fila ${fila.id}). Revisa wa_envios.`,
      { documento: fila.documento_titulo, telefono: fila.telefono },
    );
    return;
  }
  await marcar(supabase, fila.id, { documento_wamid: documentoWamid });

  // Meta DESCARGA el documento antes de entregarlo; un mensaje de texto que sale justo detras
  // puede llegarle a la persona primero, y ver botones de "Acepto" sin el documento arriba es
  // justo lo que no puede pasar. La pausa lo hace improbable, no imposible: por eso el aviso
  // interno reporta el acuse del documento junto con la respuesta.
  await pausa(PAUSA_ENTRE_DOCUMENTO_Y_BOTONES_MS);

  const promptWamid = await sendButtons(phone, fila.texto_aceptacion, botonesAceptacion(fila.id), ctx);
  if (!promptWamid) {
    await avisarAdmin(
      `⚠️ Salió el documento «${fila.documento_titulo}» a ${fila.telefono} pero Meta rechazó los botones (fila ${fila.id}). Revisa el largo de texto_aceptacion y wa_envios.`,
      { documento: fila.documento_titulo, telefono: fila.telefono },
    );
    return;
  }
  await marcar(supabase, fila.id, { enviado_at: new Date().toISOString(), prompt_wamid: promptWamid });
}

/** Ya se mostro el documento: solo vuelven los botones, con el mismo texto exacto. */
async function recordarBotones(supabase: SupabaseClient, phone: string, fila: FilaAceptacion): Promise<void> {
  const promptWamid = await sendButtons(phone, fila.texto_aceptacion, botonesAceptacion(fila.id), ctxEnvio(fila));
  if (promptWamid) await marcar(supabase, fila.id, { prompt_wamid: promptWamid });
}

// ── Apoyo ──────────────────────────────────────────────────────────────────────────────

/**
 * Reclama el turno de enviar: pone `ultimo_intento_at` solo si la fila sigue pendiente y su ultimo
 * intento es de hace `minutos` o mas. Devuelve true si este proceso gano el turno.
 *
 * Se marca ANTES de enviar y cuenta como intento aunque el envio falle despues: si el documento no
 * se puede verificar, el siguiente mensaje de la persona no dispara otra descarga ni otro aviso
 * interno hasta que pase el enfriamiento.
 */
async function reclamarIntento(supabase: SupabaseClient, id: string, ahora: Date, minutos: number): Promise<boolean> {
  const limite = new Date(ahora.getTime() - minutos * 60_000).toISOString();
  const { data, error } = await supabase
    .from(TABLA)
    .update({ ultimo_intento_at: ahora.toISOString() })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .or(`ultimo_intento_at.is.null,ultimo_intento_at.lte."${limite}"`)
    .select('id');
  if (error) {
    console.error(`[aceptacion] no se pudo reclamar el envio de ${id}:`, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

async function marcar(supabase: SupabaseClient, id: string, cambios: Record<string, string>): Promise<void> {
  const { error } = await supabase.from(TABLA).update(cambios).eq('id', id).eq('estado', 'pendiente');
  if (error) console.error(`[aceptacion] no se pudo actualizar ${id} (${Object.keys(cambios).join(', ')}):`, error.message);
}

async function expirar(supabase: SupabaseClient, telefono: string): Promise<void> {
  const { error } = await supabase
    .from(TABLA)
    .update({ estado: 'expirado' })
    .eq('telefono', telefono)
    .eq('estado', 'pendiente')
    .lte('expira_at', new Date().toISOString());
  if (error) console.error(`[aceptacion] no se pudieron expirar pendientes de ${telefono}:`, error.message);
}

/**
 * Descarga el documento y compara su SHA-256 con el de la fila. Es lo que convierte
 * `documento_sha256` en evidencia: si no coincide, no se manda nada a aceptar.
 * De paso comprueba que la URL se deja descargar, que es lo mismo que va a intentar Meta.
 */
async function verificarDocumento(url: string, esperado: string): Promise<{ ok: true } | { ok: false; motivo: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_DESCARGA_MS) });
    if (!res.ok) return { ok: false, motivo: `la URL respondió HTTP ${res.status}` };
    const largo = Number(res.headers.get('content-length') ?? '0');
    if (largo > MAX_BYTES_DOCUMENTO) return { ok: false, motivo: `el documento pesa ${largo} bytes (tope ${MAX_BYTES_DOCUMENTO})` };
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES_DOCUMENTO) return { ok: false, motivo: `el documento pesa ${bytes.byteLength} bytes` };
    const calculado = await sha256Hex(bytes);
    if (!mismoHash(calculado, esperado)) return { ok: false, motivo: `el SHA-256 no coincide (calculado ${calculado})` };
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: `no se pudo descargar (${err instanceof Error ? err.message : String(err)})` };
  }
}

// ── Acciones post-aceptacion ─────────────────────────────────────────────────────────────

/**
 * Ejecuta, una sola vez, las acciones pendientes de una aceptacion recien registrada como
 * `aceptado`. Nunca lanza: lo que falle queda en la fila (`fallida`) y en el resultado, que va
 * al aviso interno. No hay reintento automatico.
 *
 * ⚠️ El pago NO se verifica aqui (Bold): la accion sale si la persona acepto, y punto.
 */
async function ejecutarAccionesPostAceptacion(
  supabase: SupabaseClient,
  phone: string,
  fila: FilaAceptacion,
): Promise<ResultadoAccion[]> {
  const { data, error } = await supabase
    .from(ACCIONES)
    .select('id, tipo')
    .eq('aceptacion_id', fila.id)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true });
  if (error) {
    console.error(`[aceptacion] no se pudieron leer las acciones de ${fila.id}:`, error.message);
    return [{ tipo: 'acciones', estado: 'fallida', detalle: `no se pudieron leer (${error.message}); nada se envió` }];
  }

  const resultados: ResultadoAccion[] = [];
  for (const accion of (data ?? []) as Array<{ id: string; tipo: string }>) {
    if (accionImplementada(accion.tipo)) {
      resultados.push(await entregarCredencialValida(supabase, phone, fila, accion.id));
    } else if (accion.tipo === 'enviar_acceso_portal') {
      resultados.push({ tipo: accion.tipo, estado: 'pendiente', detalle: 'sin implementar: el portal de autoservicio todavía no existe' });
    } else {
      resultados.push({ tipo: accion.tipo, estado: 'pendiente', detalle: 'tipo sin implementar' });
    }
  }
  return resultados;
}

/** Lo que quedo sin ejecutar porque la persona NO acepto. Solo informa: nada se envia ni se borra. */
async function accionesSinEjecutar(supabase: SupabaseClient, aceptacionId: string): Promise<ResultadoAccion[]> {
  const { data, error } = await supabase
    .from(ACCIONES)
    .select('tipo')
    .eq('aceptacion_id', aceptacionId)
    .eq('estado', 'pendiente');
  if (error) return [];
  return ((data ?? []) as Array<{ tipo: string }>).map((a) => ({
    tipo: a.tipo,
    estado: 'pendiente' as const,
    detalle: a.tipo === 'enviar_credencial_valida'
      ? 'no se ejecuta porque no aceptó; la llave sigue en Vault hasta que borres la acción'
      : 'no se ejecuta porque no aceptó',
  }));
}

/**
 * Entrega la llave de API de Valida por el chat.
 *
 * Orden, y cada paso tiene su razon:
 *   1. Reclamo atomico (`intentado_at` de null a ahora). Si no se gana, otro proceso ya la tomo:
 *      no se hace nada. Es la segunda llave contra un envio doble, detras del `duplicado`.
 *   2. Leer el secreto de Vault por RPC (solo lo entrega a una accion reclamada de una
 *      aceptacion `aceptado`).
 *   3. Enviar el texto EXACTO, con `preview` enmascarado para `wa_envios`.
 *   4. Marcar `enviada` y borrar el secreto de Vault.
 *   5. El segundo mensaje (sin nada sensible) es de cortesia: si falla no deshace la entrega.
 *
 * La llave vive solo en la variable local `llave`: no se imprime, no se guarda, no viaja en un
 * error. Todo lo que sale hacia afuera usa `enmascararSecreto`.
 */
async function entregarCredencialValida(
  supabase: SupabaseClient,
  phone: string,
  fila: FilaAceptacion,
  accionId: string,
): Promise<ResultadoAccion> {
  const tipo = 'enviar_credencial_valida';

  const { data: reclamo, error: errReclamo } = await supabase
    .from(ACCIONES)
    .update({ intentado_at: new Date().toISOString() })
    .eq('id', accionId)
    .eq('estado', 'pendiente')
    .is('intentado_at', null)
    .select('id');
  if (errReclamo) {
    console.error(`[aceptacion] no se pudo reclamar la accion ${accionId}:`, errReclamo.message);
    return { tipo, estado: 'fallida', detalle: `no se pudo reclamar (${errReclamo.message}); la llave NO se envió y sigue en Vault` };
  }
  if (!reclamo?.length) {
    return { tipo, estado: 'omitida', detalle: 'ya la había tomado otro proceso; no se reenvía' };
  }

  const { data: secreto, error: errSecreto } = await supabase.rpc('leer_secreto_accion_aceptacion', { p_accion_id: accionId });
  const llave = typeof secreto === 'string' ? secreto.trim() : '';
  if (errSecreto || !llave) {
    const motivo = errSecreto ? `no se pudo leer la llave de Vault (${errSecreto.message})` : 'la llave no está en Vault';
    return await marcarFallida(supabase, accionId, tipo, motivo);
  }

  const [mensajeLlave, mensajePortal] = mensajesCredencialValida(llave);
  const mascara = enmascararSecreto(llave);
  const ctx: EnvioCtx = { ...ctxEnvio(fila), preview: mensajesCredencialValida(mascara)[0] };

  let wamid: string | null = null;
  try {
    wamid = await sendTextoExacto(phone, mensajeLlave, ctx);
  } catch (err) {
    // El error de red no lleva el cuerpo del mensaje; igual se reporta solo su nombre.
    console.error(`[aceptacion] error enviando la llave ${mascara} (accion ${accionId}):`, err instanceof Error ? err.name : 'desconocido');
  }
  if (!wamid) {
    return await marcarFallida(supabase, accionId, tipo, `Meta no aceptó el mensaje con la llave ${mascara}`);
  }

  const { error: errEnviada } = await supabase
    .from(ACCIONES)
    .update({ estado: 'enviada', enviada_at: new Date().toISOString(), wamid, error: null })
    .eq('id', accionId)
    .eq('estado', 'pendiente');
  if (errEnviada) {
    console.error(`[aceptacion] la llave ${mascara} salió pero la accion ${accionId} no se pudo marcar:`, errEnviada.message);
    return {
      tipo,
      estado: 'enviada',
      detalle: `llave ${mascara} entregada (wamid ${wamid}), pero la fila no se pudo marcar y la llave SIGUE en Vault: márcala y bórrala a mano`,
    };
  }

  const { data: borrado, error: errBorrado } = await supabase.rpc('borrar_secreto_accion_aceptacion', { p_accion_id: accionId });
  const quedoEnVault = !!errBorrado || borrado !== true;
  if (quedoEnVault) {
    console.error(`[aceptacion] la llave ${mascara} salió pero no se borró de Vault:`, errBorrado?.message ?? 'la RPC no borró nada');
  }

  try {
    await sendTextoExacto(phone, mensajePortal, ctxEnvio(fila));
  } catch {
    console.error(`[aceptacion] no salió el mensaje del portal (accion ${accionId}); la llave sí se entregó`);
  }

  return {
    tipo,
    estado: 'enviada',
    detalle: quedoEnVault
      ? `llave ${mascara} entregada, pero NO se pudo borrar de Vault: bórrala a mano`
      : `llave ${mascara} entregada y borrada de Vault`,
  };
}

async function marcarFallida(
  supabase: SupabaseClient,
  accionId: string,
  tipo: string,
  motivo: string,
): Promise<ResultadoAccion> {
  console.error(`[aceptacion] accion ${accionId} fallida: ${motivo}`);
  const { error } = await supabase
    .from(ACCIONES)
    .update({ estado: 'fallida', error: motivo })
    .eq('id', accionId)
    .eq('estado', 'pendiente');
  if (error) console.error(`[aceptacion] ni siquiera se pudo marcar fallida la accion ${accionId}:`, error.message);
  return { tipo, estado: 'fallida', detalle: `${motivo}. No se reintenta sola; la llave sigue en Vault` };
}

async function avisarRespuesta(
  supabase: SupabaseClient,
  fila: FilaAceptacion,
  decision: DecisionBoton,
  respondidoAt: string,
  acciones: ResultadoAccion[] = [],
): Promise<void> {
  let negocioCodigo: string | null = null;
  if (fila.negocio_id) {
    const { data } = await supabase.from('negocios').select('codigo').eq('id', fila.negocio_id).maybeSingle();
    negocioCodigo = (data?.codigo as string | undefined) ?? null;
  }
  let estadoDocumento: string | null = null;
  if (fila.documento_wamid) {
    const { data } = await supabase.from('wa_envios').select('status').eq('wa_message_id', fila.documento_wamid).maybeSingle();
    estadoDocumento = (data?.status as string | undefined) ?? null;
  }
  await avisarAdmin(
    avisoRespuesta({ fila, decision, respondidoAt, negocioCodigo, estadoDocumento, acciones }),
    {
      respuesta: decision === 'acepto' ? 'Acepto' : 'No acepto',
      documento: fila.documento_titulo,
      version: fila.documento_version,
      nombre: fila.nombre_aceptante,
      empresa: fila.empresa_nombre,
      telefono: fila.telefono,
      negocio: negocioCodigo,
    },
  );
}

/** Canal de alertas internas que ya usa el bot (`WA_ADMIN_NOTIFY_PHONE`). Nunca tumba el flujo. */
async function avisarAdmin(texto: string, variables: Record<string, string | number | null | undefined>): Promise<void> {
  const admin = (Deno.env.get('WA_ADMIN_NOTIFY_PHONE') || '').replace(/\D/g, '');
  if (!admin) {
    console.warn(`[aceptacion] sin aviso interno (falta WA_ADMIN_NOTIFY_PHONE): ${texto.slice(0, 200)}`);
    return;
  }
  try {
    await enviarAvisoInterno(admin, INTENT_ACEPTACION, texto, variables);
  } catch (err) {
    console.error('[aceptacion] el aviso interno fallo:', err);
  }
}
