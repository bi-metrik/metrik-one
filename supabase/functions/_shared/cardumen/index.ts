// CardumenChat — orquestacion para el webhook de WhatsApp.
// Entrevistador conversacional (R1) + serializador (R2) sobre la ventana de servicio 24h.
// ADITIVO: el participante NO es usuario de ONE; el estado vive en cardumen_chat_sessions (no wa-session).

import { sendTextMessage } from "../wa-respond.ts";
import { FEDE_SPEC } from "./spec.ts";
import { claudeHaiku } from "./model.ts";
import { initState, elicitationOpening, nextTurn } from "./r1.ts";
import { serialize } from "./r2.ts";
import type { ConversationState } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

const CHAT_KEYWORDS = ["cardumenchat", "cardumen chat"];
const EXIT_WORDS = ["salir", "cancelar", "terminar"];

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

export async function startCardumenChat(supabase: Supa, phone: string): Promise<void> {
  const state = initState(FEDE_SPEC);
  const opening = elicitationOpening(FEDE_SPEC, state.lang);
  state.history.push({ role: "interviewer", text: opening });
  await supabase.from("cardumen_chat_sessions").upsert({
    phone,
    state,
    closed: false,
    updated_at: new Date().toISOString(),
  });
  await sendTextMessage(
    phone,
    "🐟 *Cardumen*\nGracias por sumar tu historia. Conversemos un momento — responde con tus propias palabras. Escribe *salir* cuando quieras terminar.\n\n" + opening,
  );
  console.log(`[cardumen-chat] iniciada para ${phone}`);
}

export async function continueCardumenChat(supabase: Supa, phone: string, text: string): Promise<void> {
  const exit = (text || "").trim().toLowerCase().replace(/[!¡.,]/g, "");
  const { data: row } = await supabase
    .from("cardumen_chat_sessions")
    .select("state")
    .eq("phone", phone)
    .eq("closed", false)
    .maybeSingle();
  if (!row) return; // no hay sesion abierta (carrera) → no hace nada

  const state = row.state as ConversationState;
  const model = claudeHaiku();

  // Salida explicita del participante.
  if (EXIT_WORDS.includes(exit)) {
    await closeAndSerialize(supabase, phone, state, model, /*userExit*/ true);
    return;
  }

  try {
    const { output } = await nextTurn(model, FEDE_SPEC, state, text);
    if (state.closed) {
      if (output.message_to_user) await sendTextMessage(phone, output.message_to_user);
      await closeAndSerialize(supabase, phone, state, model, false);
    } else {
      await sendTextMessage(phone, output.message_to_user);
      await supabase
        .from("cardumen_chat_sessions")
        .update({ state, updated_at: new Date().toISOString() })
        .eq("phone", phone);
    }
  } catch (e) {
    console.error("[cardumen-chat] error en turno:", (e as Error).message);
    await sendTextMessage(phone, "Perdona, se me cruzaron los cables un momento. ¿Me lo cuentas otra vez?");
  }
}

async function closeAndSerialize(
  supabase: Supa,
  phone: string,
  state: ConversationState,
  model: ReturnType<typeof claudeHaiku>,
  userExit: boolean,
): Promise<void> {
  state.closed = true;
  let payload: Record<string, unknown> = { source: "chat", collection_mode: FEDE_SPEC.collection_mode };
  try {
    const record = await serialize(model, FEDE_SPEC, state);
    payload = { ...payload, ...record };
  } catch (e) {
    console.error("[cardumen-chat] error serializando:", (e as Error).message);
    payload.raw_history = state.history;
  }
  // Guardar el registro en el mismo destino que la mini-web / Flow.
  const { error } = await supabase.from("cardumen_respuestas").insert({
    estudio: Deno.env.get("CARDUMEN_ESTUDIO") || "fede",
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
