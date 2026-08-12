// CardumenChat — orquestacion para el webhook de WhatsApp.
// Entrevistador conversacional (R1) + serializador (R2) sobre la ventana de servicio 24h.
// ADITIVO: el participante NO es usuario de ONE; el estado vive en cardumen_chat_sessions (no wa-session).

import { sendTextMessage } from "../wa-respond.ts";
import { FEDE_SPEC } from "./spec.ts";
import { claudeHaiku } from "./model.ts";
import { initState, elicitationOpening, nextTurn } from "./r1.ts";
import { serialize } from "./r2.ts";
import { resolverEstudioChatPorTrigger, specDeSesion, cargarEstudioChat, type EstudioChat } from "./estudios.ts";
import { sendCtaUrl, sendTextWithRhythm, sendTypingIndicator, enBackground } from "../wa-respond.ts";
import type { ConversationState, StudySpec, Encuadre } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

const CHAT_KEYWORDS = ["cardumenchat", "cardumen chat"];
const EXIT_WORDS = ["salir", "cancelar", "terminar"];
// BORRAR no es una salida mas: cierra Y elimina lo ya guardado. Se promete en el encuadre,
// asi que tiene que funcionar de verdad.
const ERASE_WORDS = ["borrar", "borra todo", "eliminar mis datos"];

/**
 * Estudio que abre este texto. Primero el catalogo (una fila = un estudio, varios
 * estudios pueden convivir); si el catalogo no resuelve, cae a la palabra fija de
 * siempre con el spec importado, para no cambiarle la conducta a lo que ya corre.
 */
export async function resolverEstudioChat(supabase: Supa, text: string): Promise<EstudioChat | null> {
  const delCatalogo = await resolverEstudioChatPorTrigger(supabase, text);
  if (delCatalogo) return delCatalogo;
  if (isCardumenChatTrigger(text)) {
    return { estudio: FEDE_SPEC.study_id, nombre: FEDE_SPEC.title, spec: FEDE_SPEC, encuadre: null, desdeCatalogo: false };
  }
  return null;
}

/** Fallback retrocompatible: la palabra fija de siempre. */
export function isCardumenChatTrigger(text: string): boolean {
  const t = (text || "").trim().toLowerCase().replace(/[!¡.,]/g, "");
  return CHAT_KEYWORDS.includes(t);
}

export async function hasOpenCardumenChat(supabase: Supa, phone: string): Promise<boolean> {
  const { data } = await supabase
    .from("cardumen_chat_sessions")
    .select("phone")
    .eq("phone", phone)
    .eq("closed", false)
    .maybeSingle();
  return !!data;
}

export async function startCardumenChat(
  supabase: Supa,
  phone: string,
  estudio?: EstudioChat,
  waMessageId?: string,
): Promise<void> {
  // Sin estudio explicito, el de siempre: mantiene el comportamiento de los llamadores viejos.
  const spec: StudySpec = estudio?.spec ?? FEDE_SPEC;
  const slug = estudio?.estudio ?? FEDE_SPEC.study_id;
  const state = initState(spec);
  // El slug del catalogo manda sobre el study_id del spec: es el que decide con que estudio
  // se guarda la respuesta al cerrar, y tiene que ser uno solo de punta a punta.
  state.study_id = slug;
  const enc = estudio?.encuadre ?? null;
  const opening = elicitationOpening(spec, state.lang);

  // Con encuadre que pide autorizacion: se informa y NO se pregunta nada hasta el si.
  // La primera pregunta no entra al historial todavia — si entrara, quedaria como turno del
  // entrevistador sin haberse enviado, y R1 creeria que ya pregunto.
  if (enc?.pide_consentimiento) {
    state.consent = { version: enc.version, pendiente: true, reintentos: 0 };
    await supabase.from("cardumen_chat_sessions").upsert({
      phone, state, closed: false, reminded_at: null, updated_at: new Date().toISOString(),
    });
    // En background: son cuatro mensajes con pausas, y hacerlos antes de responderle a Meta
    // arriesga un reintento (que duplicaria el encuadre completo).
    enBackground(enviarEncuadre(phone, enc, waMessageId));
    console.log(`[cardumen-chat] encuadre en camino (${enc.version}), esperando autorizacion de ${phone}`);
    return;
  }

  state.history.push({ role: "interviewer", text: opening });
  await supabase.from("cardumen_chat_sessions").upsert({
    phone,
    state,
    closed: false,
    reminded_at: null,
    updated_at: new Date().toISOString(),
  });
  await sendTextWithRhythm(
    phone,
    (enc?.saludo ? enc.saludo + "\n\n" : "🐟 *Cardumen*\nGracias por sumar tu historia. Conversemos un momento — responde con tus propias palabras.\n\n⏳ *Tienes 24 horas para completarla; si no, se pierde el avance.* Lo ideal es terminarla hoy mismo. Escribe *salir* si quieres terminar antes.\n\n") + opening,
  );
  console.log(`[cardumen-chat] iniciada para ${phone}`);
}

/**
 * Encuadre en tres mensajes. El del medio va como CTA para que la politica se abra en el
 * navegador INTERNO de WhatsApp: un link de texto plano saca a la persona al navegador
 * externo, y a mitad de un ejercicio de confianza eso es perderla.
 */
async function enviarEncuadre(phone: string, enc: Encuadre, waMessageId?: string): Promise<void> {
  // Con ritmo: el encuadre son cuatro mensajes seguidos y de corrido se lee como un volcado
  // automatico. El primero lleva el "escribiendo..." (el unico message_id que tenemos es el
  // del mensaje que abrio la conversacion).
  if (enc.saludo) await sendTextWithRhythm(phone, enc.saludo, { waMessageId });
  if (enc.rubrica) await sendTextWithRhythm(phone, enc.rubrica);
  if (enc.datos) {
    if (enc.url_politica) {
      // El CTA no pasa por sendTextWithRhythm (es interactivo), asi que la pausa va aparte.
      await new Promise((r) => setTimeout(r, 1200));
      // display_text se recorta a 20 caracteres en wa-respond.ts
      await sendCtaUrl(phone, enc.datos, (enc.boton_politica ?? "Politica de datos").slice(0, 20), enc.url_politica);
    } else {
      await sendTextWithRhythm(phone, enc.datos);
    }
  }
  if (enc.cierre_consentimiento) await sendTextWithRhythm(phone, enc.cierre_consentimiento);
}

/** Elimina lo ya guardado de esta persona en este estudio. Lo promete el encuadre. */
async function borrarDatosDeParticipante(supabase: Supa, phone: string, estudio: string): Promise<void> {
  const { error } = await supabase
    .from("cardumen_respuestas")
    .delete()
    .eq("token", phone)
    .eq("estudio", estudio);
  if (error) console.error("[cardumen-chat] error borrando respuestas:", error.message);
  await supabase.from("cardumen_chat_sessions").delete().eq("phone", phone);
}

export async function continueCardumenChat(supabase: Supa, phone: string, text: string, waMessageId?: string): Promise<void> {
  const exit = (text || "").trim().toLowerCase().replace(/[!¡.,]/g, "");
  const { data: row } = await supabase
    .from("cardumen_chat_sessions")
    .select("state, updated_at")
    .eq("phone", phone)
    .eq("closed", false)
    .maybeSingle();
  if (!row) return; // no hay sesion abierta (carrera) → no hace nada

  // Expiracion: si pasaron mas de 24h sin actividad, el avance se pierde (la sesion se cierra).
  if (Date.now() - new Date(row.updated_at).getTime() > 24 * 60 * 60 * 1000) {
    await supabase.from("cardumen_chat_sessions").update({ closed: true }).eq("phone", phone);
    await sendTextMessage(phone, "Tu conversación anterior se venció (pasaron más de 24 horas) y el avance se perdió. Escribe *cardumenchat* para empezar de nuevo cuando quieras.");
    return;
  }

  const state = row.state as ConversationState;
  // El turno pasa por el LLM y tarda: el indicador se manda ya, no despues.
  if (waMessageId) await sendTypingIndicator(waMessageId);

  // BORRAR: vale en cualquier momento, incluso antes de autorizar. Va ANTES del modelo:
  // no tiene sentido gastar un turno de LLM para atender una peticion de borrado.
  if (ERASE_WORDS.includes(exit)) {
    const est = await cargarEstudioChat(supabase, state.study_id);
    await borrarDatosDeParticipante(supabase, phone, state.study_id);
    await sendTextMessage(
      phone,
      est?.encuadre?.al_borrar ?? "Hecho: borré lo que habías compartido y cerré la conversación.",
    );
    console.log(`[cardumen-chat] BORRADO a peticion de ${phone} (estudio ${state.study_id})`);
    return;
  }

  // Puerta de autorizacion: mientras este pendiente, no se pregunta ni se guarda nada.
  if (state.consent?.pendiente) {
    const est = await cargarEstudioChat(supabase, state.study_id);
    const enc = est?.encuadre ?? null;
    const si = (enc?.palabra_si ?? "LISTO").toLowerCase();
    const no = (enc?.palabra_no ?? "NO").toLowerCase();

    if (exit === si) {
      state.consent = {
        version: state.consent.version,
        pendiente: false,
        respuesta: (text || "").trim(),
        granted_at: new Date().toISOString(),
      };
      const specAut = await specDeSesion(supabase, state.study_id);
      const apertura = elicitationOpening(specAut, state.lang);
      state.history.push({ role: "interviewer", text: apertura });
      await supabase
        .from("cardumen_chat_sessions")
        .update({ state, updated_at: new Date().toISOString() })
        .eq("phone", phone);
      await sendTextWithRhythm(phone, apertura);
      console.log(`[cardumen-chat] autorizacion ${state.consent.version} registrada para ${phone}`);
      return;
    }

    if (exit === no || EXIT_WORDS.includes(exit)) {
      // Sin autorizacion no se guarda NADA: la sesion se borra, no se cierra con datos dentro.
      await supabase.from("cardumen_chat_sessions").delete().eq("phone", phone);
      await sendTextMessage(phone, enc?.al_rechazar ?? "Listo, no hay problema. No guardamos nada.");
      console.log(`[cardumen-chat] autorizacion rechazada por ${phone}`);
      return;
    }

    // Cualquier otra cosa: se repite UNA vez y no se avanza. Un bucle infinito de "no te
    // entendi" es peor que cerrar.
    const reintentos = (state.consent.reintentos ?? 0) + 1;
    state.consent = { ...state.consent, reintentos };
    await supabase
      .from("cardumen_chat_sessions")
      .update({ state, updated_at: new Date().toISOString() })
      .eq("phone", phone);
    await sendTextMessage(
      phone,
      reintentos >= 2
        ? `Te dejo el ejercicio por aquí. Cuando quieras empezar, responde *${(enc?.palabra_si ?? "LISTO")}*.`
        : `Para empezar responde *${(enc?.palabra_si ?? "LISTO")}*, o *${(enc?.palabra_no ?? "NO")}* si prefieres no participar.`,
    );
    return;
  }

  const model = claudeHaiku();
  // El spec sale del estudio de ESTA sesion, no de un import global: es lo que permite que
  // dos estudios corran a la vez sin pisarse.
  const spec = await specDeSesion(supabase, state.study_id);

  // Salida explicita del participante.
  if (EXIT_WORDS.includes(exit)) {
    await closeAndSerialize(supabase, phone, state, model, /*userExit*/ true, spec);
    return;
  }

  try {
    const { output } = await nextTurn(model, spec, state, text);
    if (state.closed) {
      // No enviamos otra pregunta al cerrar — solo el agradecimiento/cierre (evita "pregunta + cerramos").
      await closeAndSerialize(supabase, phone, state, model, false, spec);
    } else {
      await sendTextWithRhythm(phone, output.message_to_user);
      await supabase
        .from("cardumen_chat_sessions")
        .update({ state, updated_at: new Date().toISOString() })
        .eq("phone", phone);
    }
  } catch (e) {
    // El modelo no respondio (tras reintentos) o fallo el turno. La sesion NO se cierra:
    // el hilo queda guardado en el turno actual y el participante puede retomar reenviando.
    const errMsg = (e as Error).message ?? "";
    console.error("[cardumen-chat] error en turno:", errMsg);
    const overloaded = /\b(429|500|502|503|504|529)\b/.test(errMsg) || /overloaded|high demand|rate.?limit|timeout/i.test(errMsg);
    await sendTextMessage(
      phone,
      overloaded
        ? "Estoy recibiendo muchas historias en este momento 🙏. Tu conversación quedó guardada — dame un par de minutos y reenvíame tu última respuesta; seguimos justo donde quedamos."
        : "Ups, no te alcancé a escuchar bien. ¿Me lo repites, por favor? Seguimos justo donde quedamos.",
    );
  }
}

async function closeAndSerialize(
  supabase: Supa,
  phone: string,
  state: ConversationState,
  model: ReturnType<typeof claudeHaiku>,
  userExit: boolean,
  specSesion?: StudySpec,
): Promise<void> {
  state.closed = true;
  const spec: StudySpec = specSesion ?? FEDE_SPEC;
  // Sin autorizacion no se guarda nada, aunque haya turnos: el consentimiento es la
  // condicion para que el dato exista, no un tramite posterior.
  if (state.consent?.pendiente) {
    await supabase.from("cardumen_chat_sessions").delete().eq("phone", phone);
    console.log(`[cardumen-chat] cerrada sin autorizacion (nada guardado) para ${phone}`);
    return;
  }

  let payload: Record<string, unknown> = { source: "chat", collection_mode: spec.collection_mode };
  if (state.consent) {
    payload.consent = {
      version: state.consent.version,
      respuesta: state.consent.respuesta,
      granted_at: state.consent.granted_at,
    };
  }
  try {
    const record = await serialize(model, spec, state);
    payload = { ...payload, ...record };
  } catch (e) {
    console.error("[cardumen-chat] error serializando:", (e as Error).message);
    payload.raw_history = state.history;
  }
  // Guardar el registro en el mismo destino que la mini-web / Flow.
  // El estudio sale del ESTADO de la conversacion, no de una env var: la env var era lo que
  // dejaba respuestas etiquetadas con un estudio distinto del spec que las produjo.
  const { error } = await supabase.from("cardumen_respuestas").insert({
    estudio: state.study_id || Deno.env.get("CARDUMEN_ESTUDIO") || "fede",
    token: phone,
    lang: state.lang,
    payload,
  });
  if (error) console.error("[cardumen-chat] error guardando respuesta:", error.message);

  await supabase
    .from("cardumen_chat_sessions")
    .update({ state, closed: true, updated_at: new Date().toISOString() })
    .eq("phone", phone);

  await sendTextMessage(
    phone,
    userExit
      ? "🐟 Gracias por lo que alcanzaste a compartir. Tu historia ya forma parte del cardumen."
      : "🐟 ¡Gracias! Cerramos aquí. Tu historia ya forma parte del cardumen.",
  );
  console.log(`[cardumen-chat] cerrada para ${phone} (userExit=${userExit}, turnos=${state.turn})`);
}
