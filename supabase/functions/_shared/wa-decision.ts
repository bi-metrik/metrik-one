// ============================================================
// Bot híbrido de la bandeja — la ejecución de los puntos de decisión
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-06-bot-hibrido.md
// Reglas (puras, probadas): `wa-decision-reglas.ts`.
//
// Aquí se lee cuál es el punto de decisión vigente del remitente (la pregunta abierta, o lo que espera su caja), se lee
// el escrito o el toque, y la opción elegida entra por el camino de siempre con su texto canónico:
//   · la pregunta de una entrega, de un entendimiento o de su contacto: `responderPendiente` (el cron la lee igual);
//   · lo que espera la caja abierta: el escrito canónico entra a la tanda (`atenderEnBandeja`), que lo relee igual.
// Funciona igual con el interruptor del intérprete apagado o prendido: el intérprete lo llama primero y, si el escrito
// no decide nada («contenido», «pregunta»), sigue con su trabajo; la ruta de hoy lo llama si nadie lo llamó antes.
// ============================================================

import {
  canonicoDe, CANONICO_NO_ES_NUEVO, conLlaveDelTexto, contextoDecision, esquemaDecision, instruccionesDecision, leerExacto, leerToqueDecision, puntoCliente, puntoConfirmacion,
  puntoDeLaCaja, puntoDelContacto, puntoDelNuevo, puntoDelResumen, puntoDelViaje, siSinCargar, textoVolverAPreguntar, validarDecision,
} from './wa-decision-reglas.ts';
import type { OpcionDecision, PuntoDecision, Veredicto } from './wa-decision-reglas.ts';
import { enviarPunto } from './wa-enviar-botones.ts';
import { sendTextMessage } from './wa-respond.ts';
import {
  botonesDeLaConfirmacion, nuevoPorConfirmar, pendienteDeLaTanda, preguntaAbierta, viajesAbiertosDeLaBandeja,
} from './wa-entendimiento.ts';
import type { PreguntaAbierta } from './wa-entendimiento.ts';
import type { PlanViajes } from './wa-viajes-reglas.ts';
import type { OpcionNegocio } from './wa-carga-reglas.ts';
import { fechaDeMeta } from './wa-bandeja-reglas.ts';
import { llavesDelTexto } from './wa-cliente-reglas.ts';
import type { ConfigBandeja } from './wa-bandeja-reglas.ts';
import { CONFIG_INTERPRETE_POR_DEFECTO, generacionPara, leerConfigInterprete } from './wa-interprete-reglas.ts';
import type { ContactoCandidato } from './wa-entendimiento-reglas.ts';
import type { IncomingMessage, SupabaseClient, WaUser } from './types.ts';

const INTENT = 'bandeja_solicitud';
type Fila = Record<string, unknown>;

// ── El modelo ────────────────────────────────────────────────────────────────

export interface PedidoDecision {
  modelo: string;
  sistema: string;
  usuario: string;
  generationConfig: Record<string, unknown>;
  timeoutMs: number;
}
export type RespuestaDecision =
  | { ok: true; json: unknown; ms: number; tokensIn?: number | null; tokensOut?: number | null }
  | { ok: false; motivo: 'timeout' | 'http' | 'esquema'; ms: number; detalle?: string };

/**
 * Quién contesta: Gemini, con el mismo llamado del intérprete (un intento, con tiempo máximo). Las pruebas lo
 * reemplazan por un modelo falso. Con `WA_INTERPRETE_APAGADO=1` no se llama: el bot pide tocar una opción.
 */
export const modeloDeDecision: { llamar: ((p: PedidoDecision) => Promise<RespuestaDecision>) | null } = { llamar: null };

function envDeDeno(k: string): string | undefined {
  return (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get(k);
}

async function llamarModelo(p: PedidoDecision): Promise<RespuestaDecision> {
  if (modeloDeDecision.llamar) return modeloDeDecision.llamar(p);
  if (String(envDeDeno('WA_INTERPRETE_APAGADO') ?? '').trim() === '1') return { ok: false, motivo: 'http', ms: 0, detalle: 'WA_INTERPRETE_APAGADO' };
  const { llamarGemini } = await import('./wa-interprete.ts');
  return llamarGemini(p);
}

// ── El punto vigente ─────────────────────────────────────────────────────────

/**
 * El punto de decisión vigente del remitente: la pregunta abierta (una a la vez) o, si no hay, lo que espera su caja
 * abierta. `null`: no hay ninguno. Con una pregunta abierta siempre hay punto (aunque no se pueda leer su detalle:
 * entonces solo «Descartar»), para que ningún escrito se tome como su respuesta por adivinanza.
 */
export async function puntoDeDecision(
  supabase: SupabaseClient, workspaceId: string, phone: string, config: ConfigBandeja,
): Promise<PuntoDecision | null> {
  const abierta = await preguntaAbierta(supabase, workspaceId, phone);
  if (abierta) return await puntoDeLaPregunta(supabase, workspaceId, abierta);
  if (config.modoViajes === 'uno') return null;
  return await puntoDeLaTanda(supabase, workspaceId, phone, config);
}

async function puntoDeLaPregunta(supabase: SupabaseClient, ws: string, a: PreguntaAbierta): Promise<PuntoDecision> {
  const viajes = (await viajesAbiertosDeLaBandeja(supabase, ws)) ?? [];
  const generico = (): PuntoDecision => puntoCliente({ ref: a.id, nombre: a.nombre, pregunta: `${a.nombre} · ${a.corta}` });
  if (a.tipo === 'entrega') {
    const { data: e } = await supabase.from('wa_bandeja_entregas').select('id, plan_viajes, negocio_opciones').eq('id', a.id).maybeSingle();
    const plan = (e?.plan_viajes ?? null) as PlanViajes | null;
    if (plan) return puntoDelResumen(a.id, plan, a.nombre, 'entrega', viajes);
    const opciones = Array.isArray(e?.negocio_opciones) ? (e!.negocio_opciones as OpcionNegocio[]) : null;
    return opciones ? puntoDelViaje('entrega', a.id, a.nombre, opciones, viajes) : generico();
  }
  const { data: ent } = await supabase.from('wa_bandeja_entendimientos').select('*').eq('id', a.id).maybeSingle();
  if (!ent) return generico();
  const e = ent as Fila;
  if (a.tipo === 'contacto') {
    const opciones = (Array.isArray(e.contacto_opciones) ? e.contacto_opciones : []) as ContactoCandidato[];
    const est = (e.cliente ?? {}) as { pregunta?: string | null };
    return puntoDelContacto(a.id, a.nombre, est.pregunta ?? null, opciones, String(e.contacto_nombre ?? ''));
  }
  const { data: entrega } = await supabase.from('wa_bandeja_entregas').select('plan_viajes, negocio_opciones').eq('id', e.entrega_id).maybeSingle();
  const c = (e.confirmacion_pendiente as string | null) ?? null;
  if (a.espera === 'resumen' && entrega?.plan_viajes) return puntoDelResumen(String(e.entrega_id), entrega.plan_viajes as PlanViajes, a.nombre, 'negocio', viajes);
  if (c === 'cruce' || c === 'sin_solicitud' || c === 'dos_viajes') {
    return puntoConfirmacion({ ref: a.id, nombre: a.nombre, pregunta: `${a.nombre} · ${a.corta}`, corta: a.corta, c, botones: botonesDeLaConfirmacion(a.id, c) });
  }
  const opciones = Array.isArray(entrega?.negocio_opciones) ? (entrega!.negocio_opciones as OpcionNegocio[]) : [];
  const propuesto = nuevoPorConfirmar(e, null);
  if (propuesto) return puntoDelNuevo(a.id, a.nombre, propuesto, opciones, viajes);
  return puntoDelViaje('negocio', a.id, a.nombre, opciones, viajes);
}

async function puntoDeLaTanda(supabase: SupabaseClient, ws: string, phone: string, config: ConfigBandeja): Promise<PuntoDecision | null> {
  const { data: abierta } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', ws).eq('remitente_phone', phone).eq('estado', 'abierta').limit(1).maybeSingle();
  if (!abierta) return null;
  const p = await pendienteDeLaTanda(supabase, ws, phone, config.horasCajaActiva);
  if (!p) return null;
  return puntoDeLaCaja(String(abierta.id), p);
}

// ── Leer y decidir ───────────────────────────────────────────────────────────

/** Lo que pasó con el escrito: ya se atendió, o no contesta la pregunta y sigue su camino como contenido o pregunta. */
export type ResultadoDecision = 'atendido' | 'contenido' | 'pregunta' | null;

/**
 * Un escrito del comercial con un punto de decisión vigente. `null`: no hay punto (sigue el camino de siempre).
 * `desdeInterprete`: una «pregunta» se devuelve para que la conteste el intérprete; si no, se contesta aquí.
 */
export async function atenderEnPuntoDeDecision(
  supabase: SupabaseClient, user: WaUser, message: IncomingMessage, config: ConfigBandeja, opts: { desdeInterprete?: boolean } = {},
): Promise<ResultadoDecision> {
  const texto = String(message.text ?? '').trim();
  if (!texto || message.type !== 'text' || message.reenviado === true) return null;
  const ws = user.workspace_id;
  const punto = await puntoDeDecision(supabase, ws, message.phone, config);
  if (!punto) return null;
  const viajes = (await viajesAbiertosDeLaBandeja(supabase, ws)) ?? [];
  const exacto = leerExacto(texto, punto, viajes.map(v => v.codigo ?? '').filter(Boolean));
  if (exacto?.tipo === 'opcion') {
    // Lo exacto (el número, el código, el «sí» escrito solo) vale como el toque, también para lo que escribe en un viaje o
    // crea algo. Un escrito libre que dice cargar o crear nunca lo hace: lo lee el modelo y se pide el toque (`soloToque`).
    await aplicar(supabase, user, message, config, punto, exacto.opcion.canonico, texto);
    return 'atendido';
  }
  if (exacto?.tipo === 'llave') {
    // La llave escrita sola es la respuesta tal cual: el lector de hoy la toma sin adivinar (`soloLlave`).
    await aplicar(supabase, user, message, config, punto, texto, texto);
    return 'atendido';
  }
  if (exacto?.tipo === 'fuera') return await volverAPreguntar(message.phone, ws, punto, 'fuera');
  if (siSinCargar(texto, punto)) return await volverAPreguntar(message.phone, ws, punto, 'todavia');
  // El código de otro viaje abierto en la caja abierta: es un encabezado que abre su caja (no contesta la lista).
  if (exacto?.tipo === 'codigo_ajeno' && punto.origen === 'tanda') return 'contenido';

  const cfg = leerConfigInterprete(user.modulos?.bot_conversacional ?? null, null);
  const modelo = cfg.modelo ?? CONFIG_INTERPRETE_POR_DEFECTO.modelo;
  const r = await llamarModelo({
    modelo, sistema: instruccionesDecision(), usuario: contextoDecision(punto, texto),
    generationConfig: generacionPara(modelo, esquemaDecision()), timeoutMs: cfg.timeoutMs,
  });
  if (!r.ok) {
    await telemetria(supabase, user, message, punto, `fallback_${r.motivo}`, null, modelo, r.ms);
    // El cambio de fondo frente a hoy: sin modelo, el bot no adivina.
    return await volverAPreguntar(message.phone, ws, punto, 'modelo');
  }
  const v = validarDecision(r.json, punto, texto);
  await telemetria(supabase, user, message, punto, v.tipo, r.json, modelo, r.ms);
  return await actuar(supabase, user, message, config, punto, v, texto, opts);
}

async function actuar(
  supabase: SupabaseClient, user: WaUser, message: IncomingMessage, config: ConfigBandeja, punto: PuntoDecision, v: Veredicto, texto: string,
  opts: { desdeInterprete?: boolean },
): Promise<ResultadoDecision> {
  const ws = user.workspace_id;
  switch (v.tipo) {
    case 'opcion':
      await aplicar(supabase, user, message, config, punto, canonicoDe(v.opcion, v.nombre, texto), texto);
      return 'atendido';
    case 'solo_toque':
      return await volverAPreguntar(message.phone, ws, punto, 'solo_toque', v.opcion);
    case 'nombre':
      await aplicar(supabase, user, message, config, punto, canonicoDelNombre(punto, v.nombre, texto), texto, {
        accion: 'nombre', nuevo: v.nombre, ...(llavesDelTexto(texto) ? { llave: llavesDelTexto(texto) } : {}),
      });
      return 'atendido';
    case 'llave':
      // La llave sola es la respuesta que el lector de hoy toma sin adivinar (`soloLlave`).
      await aplicar(supabase, user, message, config, punto, v.canonico, texto);
      return 'atendido';
    case 'correccion':
      // La corrección la arma el modelo y la valida el código; entra marcada y escrita como la lee el lector del resumen
      // («corregir: el 3 es de T1 26 9»): nunca como el «sí» ni como la respuesta sobre el cliente.
      await aplicar(supabase, user, message, config, punto, v.canonico, texto);
      return 'atendido';
    case 'contenido':
      return 'contenido';
    case 'pregunta':
      if (opts.desdeInterprete) return 'pregunta';
      return await volverAPreguntar(message.phone, ws, punto, 'pregunta');
    default:
      return await volverAPreguntar(message.phone, ws, punto, 'no_se');
  }
}

/** El nombre que dio el comercial, como lo lee la pregunta de hoy. */
function canonicoDelNombre(p: PuntoDecision, nombre: string, texto: string): string {
  // «¿Creo el cliente nuevo «X»?» y las preguntas del contacto leen el nombre después de «nuevo» (y lo vuelven a
  // mostrar antes de crear); la caja abierta y el resumen, el nombre solo.
  if (p.tipo === 'nuevo' || p.tipo === 'crear' || p.origen === 'contacto') return conLlaveDelTexto(`nuevo ${nombre}`, texto);
  return conLlaveDelTexto(nombre, texto);
}

/**
 * La opción elegida entra por el camino de siempre. `original`: lo que escribió (o tocó) el comercial, que se guarda
 * como el crudo. En la caja abierta, el canónico entra como un escrito suyo (la tanda lo relee igual que hoy).
 */
async function aplicar(
  supabase: SupabaseClient, user: WaUser, message: IncomingMessage, config: ConfigBandeja, punto: PuntoDecision, canonico: string, original: string,
  interpretacion?: Record<string, unknown>,
): Promise<void> {
  const b = await import('./wa-bandeja.ts');
  const ws = user.workspace_id;
  const wamid = message.wa_message_id ?? `decision:${message.phone}:${message.timestamp}`;
  if (punto.origen === 'tanda') {
    // «descartar» descarta todo lo pendiente del remitente (regla 4), como el escrito.
    await b.atenderEnBandeja(supabase, user, {
      ...message, type: 'text', text: canonico, interactive_reply: undefined, reenviado: false,
      decisionLeida: 'respuesta', ...(interpretacion ? { interpretacionDecision: { ...interpretacion, texto: original } } : {}),
    }, config);
    return;
  }
  // «Descartar» en la pregunta del contacto descarta todo lo pendiente, como el escrito (regla 4): esa pregunta no tiene
  // su propio descarte. En las demás, descarta solo lo de esa pregunta (la tanda abierta sigue: H2 del intérprete).
  if (canonico === 'descartar' && punto.origen === 'contacto') {
    await b.descartarTodo(supabase, ws, message.phone, original, wamid, fechaDeMeta(message.timestamp), config);
    return;
  }
  const ok = await b.responderPendiente(supabase, ws, message.phone, canonico, wamid, fechaDeMeta(message.timestamp), config, true, original);
  if (!ok) await enviarTexto(message.phone, `${textoVolverAPreguntar(punto, 'viejo')}`, ws);
}

/** Vuelve a preguntar una vez, en corto, con los botones o la lista. */
async function volverAPreguntar(
  phone: string, ws: string, punto: PuntoDecision, motivo: Parameters<typeof textoVolverAPreguntar>[1], opcion?: OpcionDecision | null,
): Promise<'atendido'> {
  await enviarPunto(phone, textoVolverAPreguntar(punto, motivo, opcion), punto, { workspaceId: ws, intent: INTENT });
  return 'atendido';
}

async function enviarTexto(phone: string, texto: string, ws: string): Promise<void> {
  try {
    await sendTextMessage(phone, texto, { origen: 'bot', workspaceId: ws, intent: INTENT });
  } catch (err) {
    console.error(`[wa-decision] no se pudo enviar a ${phone}:`, err);
  }
}

/** Contesta la «pregunta» que el intérprete no pudo contestar: la pregunta vigente, otra vez. */
export async function volverAlPunto(supabase: SupabaseClient, user: WaUser, phone: string, config: ConfigBandeja, motivo: 'pregunta' | 'no_se' = 'pregunta'): Promise<boolean> {
  const punto = await puntoDeDecision(supabase, user.workspace_id, phone, config);
  if (!punto) return false;
  await volverAPreguntar(phone, user.workspace_id, punto, motivo);
  return true;
}

// ── El toque ─────────────────────────────────────────────────────────────────

/**
 * Un toque en un botón o una fila de un punto de decisión (`bdj|d|…`). Vigente (mismo punto, misma huella): la opción
 * entra por el camino de siempre, también crear (es el toque). Viejo: no hace nada, lo dice y vuelve a mostrar el
 * punto vigente. `false`: no es un toque de decisión.
 */
export async function atenderToqueDeDecision(
  supabase: SupabaseClient, user: WaUser, message: IncomingMessage, config: ConfigBandeja,
): Promise<boolean> {
  const t = message.type === 'interactive' ? leerToqueDecision(message.interactive_reply) : null;
  if (!t) return false;
  const ws = user.workspace_id;
  const punto = await puntoDeDecision(supabase, ws, message.phone, config);
  const opcion = punto && punto.ref === t.ref && punto.version === t.version ? punto.opciones.find(o => o.clave === t.clave && o.visible) : null;
  if (!punto || !opcion) {
    if (punto) await volverAPreguntar(message.phone, ws, punto, 'viejo');
    else await enviarTexto(message.phone, 'Ese botón es de una pregunta que ya no está abierta: no hice nada.', ws);
    return true;
  }
  await aplicar(supabase, user, { ...message, wa_message_id: message.wa_message_id ?? `toque:${message.phone}:${message.timestamp}:${t.clave}` }, config, punto, opcion.canonico, `[botón] ${message.text || opcion.titulo}`);
  return true;
}

/** El canónico de un botón de #1034 (r, p o t) según el punto vigente: «Sí, es la misma» del resumen no es un «sí» a cargar. */
export async function canonicoDeBoton(
  supabase: SupabaseClient, ws: string, phone: string, config: ConfigBandeja, accion: string,
): Promise<string | null> {
  const punto = await puntoDeDecision(supabase, ws, phone, config);
  return punto?.opciones.find(o => o.clave === accion)?.canonico ?? null;
}

// ── Telemetría ───────────────────────────────────────────────────────────────

async function telemetria(
  supabase: SupabaseClient, user: WaUser, message: IncomingMessage, punto: PuntoDecision, resultado: string, propuesta: unknown, modelo: string, ms: number,
): Promise<void> {
  try {
    const { error } = await supabase.from('wa_message_log').insert({
      workspace_id: user.workspace_id, phone: message.phone, direction: 'inbound', intent: `bandeja.decision.${punto.tipo}`,
      message_preview: String(message.text ?? '').slice(0, 100), parser_source: 'decision', gemini_model: modelo, gemini_latency_ms: ms,
      interprete_accion: `decision.${punto.tipo}`, interprete_propuesta: propuesta ?? null, interprete_resultado: resultado,
    });
    if (error) console.error('[wa-decision] no se pudo dejar la telemetría:', error.message);
  } catch (err) {
    console.error('[wa-decision] no se pudo dejar la telemetría:', err);
  }
}

export { CANONICO_NO_ES_NUEVO, puntoDeLaCaja, puntoDelResumen, puntoDelViaje };
