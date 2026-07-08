// Estudio "Voz de Venezuela" — orquestacion para el webhook de WhatsApp.
// Bot de escucha (Cardumen, despliegue pro-bono) con motor Gemini + routing por crisis.
// Calca el patron de _shared/cardumen/index.ts (mismas firmas), pero el motor es Gemini
// (base gemini-3.1-flash-lite -> crisis gemini-3.5-flash sticky), NO Haiku/SenseMaker.
// ADITIVO: el participante NO es usuario de ONE; el estado vive en ve_chat_sessions.
// Motor portado verbatim del eval (proyectos/reframeit/venezuela). thinking OFF obligatorio.

import { sendTextMessage, sendTypingIndicator, sendCtaUrl } from "../wa-respond.ts";
import { generate, type Msg } from "./gemini.ts";
import { detectCrisis, crisisPromptBlock, type CrisisType } from "./crisis.ts";
import { BOT_SYSTEM } from "./prompt.ts";
import { serializeVe } from "./serialize.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

const BASE_MODEL = "gemini-3.1-flash-lite";
const CRISIS_MODEL = "gemini-3.5-flash";
const TURN_CAP = 16;
const CRISIS_TURN_CAP = 10; // tope suave en crisis: acompanar sin colgarse ni disparar costo

const VE_KEYWORDS = ["venezuela"];
const EXIT_WORDS = ["salir", "cancelar", "terminar"];

// Politica de tratamiento de datos (voz.metrik.com.co). La salvedad esencial va en el saludo;
// el consentimiento se registra por conducta concluyente (primer mensaje del usuario tras el saludo).
const POLICY_URL = "https://voz.metrik.com.co";
const POLICY_VERSION = "1.0";
const SALVEDAD =
  "Antes de empezar: lo que compartas se usa solo para mostrarle al mundo lo que está pasando y dónde se necesita ayuda. No es una promesa de ayuda ni de rescate. Es voluntario y, si quieres, anónimo. Al continuar aceptas cómo tratamos tus datos (botón de abajo).";

// Saludo/consentimiento del punto 1 del prompt de Juanita, verbatim. Determinista: no lo genera
// el modelo (evita que improvise el consentimiento y ahorra la 1a llamada). El motor entra en el turno 2.
const SALUDO =
  "Hola 🙏 Somos aliados de The House Project y estamos recogiendo las historias de quienes están viviendo esta emergencia, para mostrarle al mundo lo que está pasando y dónde se necesita ayuda. Nos gustaría hacerte unas pocas preguntas. Puedes responder solo las que quieras, con texto o audio, y parar cuando quieras. ¿Te parece bien?";

interface VeState {
  history: { role: "user" | "model"; text: string }[];
  crisis: CrisisType | null;
  turns: number;
  location?: { lat: number; lng: number; name?: string; address?: string };
  consent?: { version: string; at: string };
}

const clean = (s: string) => (s || "").replace(/```[a-z]*|```/gi, "").trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Retraso proporcional al largo del texto para que la respuesta no se sienta instantanea/robotica.
// Tope bajo para no exceder la ventana del indicador "escribiendo" (~25s) ni impacientar al usuario.
const humanDelay = (text: string) => sleep(Math.min(900 + (text?.length ?? 0) * 12, 3000));

// Deteccion de cierre — agradece + senal de anonimato/difusion.
function isClose(text: string): boolean {
  const t = text.toLowerCase();
  // Una PREGUNTA nunca es cierre. El paso de difusion ("¿con tu nombre o anonimo?") menciona
  // "anonimo"/"nombre" pero AUN espera respuesta; cerrar ahi corta la conversacion antes de
  // tiempo y el turno siguiente del usuario cae al flujo de ONE (bug del contacto fantasma).
  if (/[?¿]/.test(t)) return false;
  const thanks = /(gracias|cu[ií]d|un abrazo|acompa|te mando|estamos (con|contigo)|con cari)/.test(t);
  const sig = /(an[oó]nim|reenv[ií]|comparte (el|este|ese) enlace|difund|con tu nombre|hasta pronto|cu[ií]date mucho)/.test(t);
  return thanks && sig;
}

export function isVeTrigger(text: string): boolean {
  const t = (text || "").trim().toLowerCase().replace(/[!¡.,]/g, "");
  return VE_KEYWORDS.includes(t);
}

export async function hasOpenVeChat(supabase: Supa, phone: string): Promise<boolean> {
  const { data } = await supabase
    .from("ve_chat_sessions")
    .select("phone")
    .eq("phone", phone)
    .eq("closed", false)
    .maybeSingle();
  return !!data;
}

export async function startVeChat(supabase: Supa, phone: string, waMessageId?: string): Promise<void> {
  const state: VeState = { history: [{ role: "model", text: SALUDO }], crisis: null, turns: 0 };
  await supabase.from("ve_chat_sessions").upsert({
    phone,
    state,
    closed: false,
    updated_at: new Date().toISOString(),
  });
  if (waMessageId) await sendTypingIndicator(waMessageId); // marca leido + "escribiendo..."
  await humanDelay(SALUDO);
  // Saludo + salvedad esencial en el mismo mensaje, con boton a la politica completa.
  await sendCtaUrl(phone, `${SALUDO}\n\n${SALVEDAD}`, "Ver política", POLICY_URL);
  console.log(`[ve-chat] iniciada para ${phone}`);
}

export async function continueVeChat(
  supabase: Supa,
  phone: string,
  text: string,
  waMessageId?: string,
  location?: { latitude: number; longitude: number; name?: string; address?: string },
): Promise<void> {
  const exit = (text || "").trim().toLowerCase().replace(/[!¡.,]/g, "");
  const { data: row } = await supabase
    .from("ve_chat_sessions")
    .select("state, updated_at")
    .eq("phone", phone)
    .eq("closed", false)
    .maybeSingle();
  if (!row) return; // no hay sesion abierta (carrera) → no hace nada

  // Marca leido + muestra "escribiendo..." mientras se genera la respuesta y corre el retraso humano.
  if (waMessageId) await sendTypingIndicator(waMessageId);

  // Expiracion 24h: fuera de la ventana de servicio de WhatsApp el avance se pierde.
  if (Date.now() - new Date(row.updated_at).getTime() > 24 * 60 * 60 * 1000) {
    await supabase.from("ve_chat_sessions").update({ closed: true }).eq("phone", phone);
    await sendTextMessage(phone, "Tu conversación anterior se venció (pasaron más de 24 horas). Escribe *venezuela* para empezar de nuevo cuando quieras.");
    return;
  }

  const state = row.state as VeState;
  // Ubicacion compartida por WhatsApp: se guarda en el estado para el registro final.
  if (location) {
    state.location = { lat: location.latitude, lng: location.longitude, name: location.name, address: location.address };
  }
  // Consentimiento informado por conducta concluyente: el saludo ya expuso la salvedad y enlazo la
  // politica; el primer mensaje del usuario tras el saludo es su aceptacion. Se registra una sola vez.
  if (!state.consent) state.consent = { version: POLICY_VERSION, at: new Date().toISOString() };

  // Salida explicita del participante.
  if (EXIT_WORDS.includes(exit)) {
    state.history.push({ role: "user", text });
    await supabase.from("ve_chat_sessions").update({ state, closed: true, updated_at: new Date().toISOString() }).eq("phone", phone);
    await sendTextMessage(phone, "Gracias por lo que compartiste. Cuídate mucho 🙏");
    await closeAndSerialize(supabase, phone, state);
    return;
  }

  // 1. Registrar el mensaje del usuario
  state.history.push({ role: "user", text });

  // 2. Detector de crisis (sticky) sobre el ultimo mensaje del usuario
  const hit = detectCrisis(text);
  if (hit && !state.crisis) state.crisis = hit;

  // 3. Tope de turnos (mas corto en crisis)
  const cap = state.crisis ? CRISIS_TURN_CAP : TURN_CAP;
  if (state.turns >= cap) {
    await supabase.from("ve_chat_sessions").update({ state, closed: true, updated_at: new Date().toISOString() }).eq("phone", phone);
    await sendTextMessage(phone, "Gracias por tu tiempo y por confiarnos tu historia. Cuídate mucho 🙏");
    await closeAndSerialize(supabase, phone, state);
    return;
  }

  // 4. Routing: modelo + system segun crisis
  const model = state.crisis ? CRISIS_MODEL : BASE_MODEL;
  const system = state.crisis ? BOT_SYSTEM + crisisPromptBlock(state.crisis) : BOT_SYSTEM;

  // Gemini exige que el historial empiece con turno de usuario; si arranca con el saludo (model),
  // anteponemos un turno sintetico (mismo recurso que el harness de eval).
  const messages: Msg[] = state.history.map((t) => ({ role: t.role, text: t.text }));
  if (messages[0]?.role === "model") messages.unshift({ role: "user", text: "(La persona abre la conversación tras el terremoto.)" });

  try {
    // 5. Generar (thinking OFF obligatorio)
    const r = await generate({ model, system, messages, temperature: 0.7, maxOutputTokens: 256, thinkingBudget: 0 });
    const botText = clean(r.text) || "Estoy aquí contigo. ¿Me cuentas un poco más?";

    // 6. Guardar estado y responder
    state.history.push({ role: "model", text: botText });
    state.turns += 1;
    const closed = isClose(botText) || state.turns >= cap;
    await supabase
      .from("ve_chat_sessions")
      .update({ state, closed, updated_at: new Date().toISOString() })
      .eq("phone", phone);
    await humanDelay(botText); // pausa proporcional para que no llegue instantaneo
    await sendTextMessage(phone, botText);
    if (closed) await closeAndSerialize(supabase, phone, state);
  } catch (e) {
    // El modelo no respondio (tras reintentos). La sesion NO se cierra: el hilo queda guardado
    // y el participante puede retomar reenviando su ultima respuesta.
    console.error("[ve-chat] error en turno:", (e as Error).message ?? "");
    await sendTextMessage(phone, "Perdona, no te alcancé a leer bien. ¿Me lo repites, por favor? Seguimos justo donde quedamos.");
  }
}

// Al cerrar: estructura la conversacion en ve_respuestas. Si hubo crisis, guarda un registro
// marcado y NO difundible (no se extraen campos de difusion). Nunca rompe el cierre.
async function closeAndSerialize(supabase: Supa, phone: string, state: VeState): Promise<void> {
  try {
    if (state.crisis) {
      await supabase.from("ve_respuestas").insert({
        phone,
        atribucion: "anonima",
        crisis: state.crisis,
        turnos: state.turns,
        consent_version: state.consent?.version ?? null,
        consent_at: state.consent?.at ?? null,
        payload: { motivo: "crisis_no_difundible", raw_history: state.history },
      });
      return;
    }
    const rec = await serializeVe(state.history);
    if (!rec) {
      await supabase.from("ve_respuestas").insert({
        phone,
        turnos: state.turns,
        payload: { error: "serialize_failed", raw_history: state.history },
      });
      return;
    }
    await supabase.from("ve_respuestas").insert({
      phone,
      atribucion: rec.atribucion,
      nombre: rec.atribucion === "con_nombre" ? rec.nombre : null,
      ubicacion: rec.ubicacion ?? state.location?.name ?? state.location?.address ?? null,
      lat: state.location?.lat ?? null,
      lng: state.location?.lng ?? null,
      ubicacion_fuente: state.location ? "gps" : (rec.ubicacion ? "texto" : null),
      necesidades: rec.necesidades,
      quien_ayudo: rec.quien_ayudo,
      historia: rec.historia,
      edad: rec.edad,
      sexo: rec.sexo,
      genero: rec.genero,
      zona: rec.zona,
      resumen: rec.resumen,
      idioma: rec.idioma,
      turnos: state.turns,
      consent_version: state.consent?.version ?? null,
      consent_at: state.consent?.at ?? null,
      payload: { record: rec, location: state.location ?? null },
    });
    console.log(`[ve-chat] respuesta serializada para ${phone} (${rec.atribucion})`);
  } catch (e) {
    console.error("[ve-chat] error serializando:", (e as Error).message ?? "");
    try {
      await supabase.from("ve_respuestas").insert({
        phone,
        turnos: state.turns,
        payload: { error: String((e as Error).message ?? "").slice(0, 200), raw_history: state.history },
      });
    } catch { /* si hasta el fallback falla, no rompemos el cierre */ }
  }
}
