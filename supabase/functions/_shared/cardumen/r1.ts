// R1 — Entrevistador en vivo. Genera el siguiente turno y actualiza el estado de conversacion.
// El estado es lo que se persistiria en Supabase entre webhooks; aqui vive en memoria.

import type {
  StudySpec, ConversationState, R1Output, ModelAdapter, Lang, ChatTurn,
} from "./types.ts";
import { buildR1System, buildR1StateMsg } from "./prompts.ts";
import { parseLooseJSON } from "./json.ts";

export function initState(spec: StudySpec, lang: Lang = spec.lang_default): ConversationState {
  return {
    study_id: spec.study_id,
    lang,
    turn: 0,
    history: [],
    dimensions_touched: [],
    capaA_confirmed: {},
    saturation_streak: 0,
    reflexivity_log: [],
    closed: false,
  };
}

export function elicitationOpening(spec: StudySpec, lang: Lang): string {
  const p = spec.elicitation_prompt;
  if (p.status === "OK") return lang === "es" ? p.literal_es! : p.literal_en!;
  return lang === "es" ? p.placeholder_es : p.placeholder_en;
}

// Procesa el mensaje del participante y produce el siguiente turno del entrevistador.
export async function nextTurn(
  model: ModelAdapter,
  spec: StudySpec,
  state: ConversationState,
  participantMessage: string,
): Promise<{ state: ConversationState; output: R1Output }> {
  state.history.push({ role: "participant", text: participantMessage });

  const system = buildR1System(spec, state.lang);
  const stateMsg = buildR1StateMsg(state, spec);

  const messages = [
    ...state.history.map((t: ChatTurn) => ({
      role: t.role === "interviewer" ? ("assistant" as const) : ("user" as const),
      content: t.text,
    })),
    { role: "user" as const, content: stateMsg },
  ];

  // Retry una vez si el modelo emite JSON no parseable (comilla sin escapar, etc.) — robustez de produccion.
  let output: R1Output;
  try {
    const res = await model.call({ system, messages, temperature: 0.7, maxTokens: 1400 });
    output = parseLooseJSON<R1Output>(res.text);
  } catch {
    const retry = await model.call({
      system,
      messages: [...messages, { role: "user" as const, content: "Tu respuesta anterior no fue JSON valido. Devuelve SOLO el JSON exacto del formato, con todas las comillas internas escapadas." }],
      temperature: 0.3,
      maxTokens: 1400,
    });
    output = parseLooseJSON<R1Output>(retry.text);
  }

  // --- actualizar estado ---
  state.turn += 1;
  state.history.push({ role: "interviewer", text: output.message_to_user });
  state.reflexivity_log.push({ turn: state.turn, why: output.reflexivity_note });

  for (const d of output.dimensions_addressed ?? []) {
    if (!state.dimensions_touched.includes(d)) state.dimensions_touched.push(d);
  }
  for (const cap of output.capaA_capture ?? []) {
    state.capaA_confirmed[cap.dimension] = cap;
    if (!state.dimensions_touched.includes(cap.dimension)) state.dimensions_touched.push(cap.dimension);
  }

  // saturacion: si el participante no aporto contenido nuevo, sube la racha
  state.saturation_streak = output.new_content ? 0 : state.saturation_streak + 1;

  // --- evaluar cierre (la decision es del codigo, no solo del LLM) ---
  const allDims = [...spec.triads.map((t) => t.id), ...spec.dyads.map((d) => d.id)];
  const coverageComplete = allDims.every((d) => state.dimensions_touched.includes(d));
  const saturated = state.saturation_streak >= spec.closing.saturation_window;
  const hitCap = state.turn >= spec.closing.turn_cap;

  if ((coverageComplete && (saturated || output.propose_close)) || hitCap) {
    state.closed = true;
  }

  return { state, output };
}
