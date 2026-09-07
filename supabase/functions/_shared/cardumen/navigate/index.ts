// Navigate — enganche del motor determinista con Supabase y WhatsApp.
//
// Mismo contrato que el motor R1/R2 (`../index.ts`): el estado vive en
// `cardumen_chat_sessions.state` (con `motor: "navigate"` como discriminador) y la
// respuesta cae en `cardumen_respuestas` con `estudio` = slug del catalogo. El participante
// NO es usuario de ONE. El webhook no sabe que existe este modulo: entra por
// `startCardumenChat` / `continueCardumenChat`, que delegan aqui cuando toca.

import { sendButtons, sendTextMessage, sendTextWithRhythm, sendTypingIndicator, calcularPausaMs } from "../../wa-respond.ts";
import { claudeHaiku } from "../model.ts";
import { interpreteConModelo } from "./interprete.ts";
import { armarPayload, esEstadoNavigate, iniciar, procesar } from "./motor.ts";
import type { NavigateState, Salida } from "./tipos.ts";

// deno-lint-ignore no-explicit-any
type Supa = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export { esEstadoNavigate };

const VENTANA_MS = 24 * 60 * 60 * 1000;

export async function startNavigate(supabase: Supa, phone: string, slug: string, waMessageId?: string): Promise<void> {
  const ahora = new Date().toISOString();
  const { state, salidas } = iniciar(ahora);
  // El slug del catalogo manda sobre la constante del motor: es el que se guarda al cerrar.
  state.study_id = slug;
  await supabase.from("cardumen_chat_sessions").upsert({
    phone, state, closed: false, reminded_at: null, updated_at: ahora,
  });
  if (waMessageId) await sendTypingIndicator(waMessageId);
  await enviar(phone, salidas);
  console.log(`[navigate] iniciada para ${phone} (estudio ${slug})`);
}

export async function continueNavigate(
  supabase: Supa,
  phone: string,
  state: NavigateState,
  updatedAt: string,
  text: string,
  waMessageId?: string,
  botonId?: string,
): Promise<void> {
  // Expiracion: fuera de la ventana de servicio de 24h el avance se pierde.
  if (Date.now() - new Date(updatedAt).getTime() > VENTANA_MS) {
    await supabase.from("cardumen_chat_sessions").update({ closed: true }).eq("phone", phone);
    await sendTextMessage(phone, "Su conversación anterior se venció (pasaron más de 24 horas). Escriba *cardumen* para empezar de nuevo cuando quiera.");
    return;
  }
  if (waMessageId) await sendTypingIndicator(waMessageId);

  const interprete = interpreteConModelo(claudeHaiku());
  let r;
  try {
    r = await procesar(state, { texto: text, botonId }, interprete);
  } catch (e) {
    // El modelo no leyo (o el estado esta incoherente). No se persiste nada: la persona
    // reenvia y seguimos justo donde quedamos.
    console.error("[navigate] error en turno:", (e as Error).message ?? "");
    await sendTextMessage(phone, "Perdone, no le alcancé a leer bien. ¿Me lo repite? Seguimos justo donde quedamos.");
    return;
  }

  const ahora = new Date().toISOString();
  switch (r.accion) {
    case "borrar": {
      const { error } = await supabase
        .from("cardumen_respuestas")
        .delete()
        .eq("token", phone)
        .eq("estudio", state.study_id);
      if (error) console.error("[navigate] error borrando respuestas:", error.message);
      await supabase.from("cardumen_chat_sessions").delete().eq("phone", phone);
      await enviar(phone, r.salidas);
      console.log(`[navigate] BORRADO a peticion de ${phone}`);
      return;
    }
    case "cerrar_sin_guardar": {
      // Sin consentimiento (o sin instrumento en su idioma) no se guarda NADA: la sesion se borra.
      await supabase.from("cardumen_chat_sessions").delete().eq("phone", phone);
      await enviar(phone, r.salidas);
      console.log(`[navigate] cerrada sin guardar para ${phone} (paso ${state.paso})`);
      return;
    }
    case "guardar_y_cerrar": {
      const completa = state.secuencia.length > 0 && state.indice >= state.secuencia.length;
      const payload = armarPayload(state, completa ? "completa" : "salir", ahora);
      const { error } = await supabase.from("cardumen_respuestas").insert({
        estudio: state.study_id,
        token: phone,
        lang: state.idioma,
        payload,
      });
      if (error) console.error("[navigate] error guardando respuesta:", error.message);
      await supabase
        .from("cardumen_chat_sessions")
        .update({ state, closed: true, updated_at: ahora })
        .eq("phone", phone);
      await enviar(phone, r.salidas);
      console.log(`[navigate] cerrada para ${phone} (completa=${completa}, turnos=${state.turnos})`);
      return;
    }
    default: {
      await supabase
        .from("cardumen_chat_sessions")
        .update({ state, updated_at: ahora })
        .eq("phone", phone);
      await enviar(phone, r.salidas);
    }
  }
}

/** Manda los mensajes del motor en orden, con ritmo humano. Los botones no pasan por
 *  `sendTextWithRhythm` (son interactivos), asi que la pausa va aparte. */
async function enviar(phone: string, salidas: Salida[]): Promise<void> {
  for (const s of salidas) {
    if (s.tipo === "texto") {
      await sendTextWithRhythm(phone, s.texto);
    } else {
      await new Promise((r) => setTimeout(r, calcularPausaMs(s.texto)));
      await sendButtons(phone, s.texto, s.botones);
    }
  }
}
