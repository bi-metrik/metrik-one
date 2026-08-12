// R1 — Entrevistador en vivo. Genera el siguiente turno y actualiza el estado de conversacion.
// El estado es lo que se persistiria en Supabase entre webhooks; aqui vive en memoria.

import type {
  StudySpec, ConversationState, R1Output, ModelAdapter, Lang, ChatTurn,
} from "./types.ts";
import { buildR1System, buildR1StateMsg } from "./prompts.ts";
import { parseLooseJSON } from "./json.ts";
import { pasoNarrativaActual, repreguntasDe } from "./narrativas.ts";

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
    closing_asked: [],
    repreguntas_narrativa: { n1: 0, n2: 0 },
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

  // Cobertura ANTES de aplicar lo de este turno: si la pregunta de este turno introduce la ultima
  // dimension, NO debe disparar el cierre en el mismo turno (el usuario aun no la ha respondido).
  const allDims = [...spec.triads.map((t) => t.id), ...spec.dyads.map((d) => d.id)];
  const coverageBefore = allDims.every((d) => state.dimensions_touched.includes(d));

  // El paso a la segunda historia lo decide el CODIGO, y su texto es el LITERAL del estudio.
  // El prompt ya lo pedia y el modelo lo reformulaba igual: en las dos pruebas con personas
  // (2026-08-12) pregunto "una vez que no salio asi" en lugar de "algo que hayas tenido que
  // hacer dos veces". Suenan parecidas y no lo son — la del estudio trae un REPROCESO, que es
  // el dato que sostiene el diagnostico, y la reformulada trae un incidente cualquiera. Una
  // pregunta del instrumento aprobado no puede depender de que el modelo respete una
  // instruccion de estilo, asi que aqui se impone.
  const repreguntas = repreguntasDe(state);
  const enFaseDeCierre = state.closing_asked.length > 0 || (output.closing_asked ?? []).length > 0;
  // Mismo calculo que ya se le informo al modelo en el mensaje de estado (fuente unica).
  const paso = pasoNarrativaActual(state, spec);
  const literalNarrativa2 = state.lang === "es"
    ? spec.second_elicitation?.literal_es
    : spec.second_elicitation?.literal_en;

  if (paso === "presentar_narrativa2" && !enFaseDeCierre && literalNarrativa2) {
    output.message_to_user = literalNarrativa2;
    state.narrativa2_turn = state.turn;
  } else if (!enFaseDeCierre) {
    // Toda pregunta que no presenta una historia ni formula un cierre es una repregunta.
    if (state.narrativa2_turn === undefined) repreguntas.n1 += 1;
    else repreguntas.n2 += 1;
  }
  state.repreguntas_narrativa = repreguntas;

  state.history.push({ role: "interviewer", text: output.message_to_user });
  state.reflexivity_log.push({ turn: state.turn, why: output.reflexivity_note });

  for (const d of output.dimensions_addressed ?? []) {
    if (!state.dimensions_touched.includes(d)) state.dimensions_touched.push(d);
  }
  for (const cap of output.capaA_capture ?? []) {
    state.capaA_confirmed[cap.dimension] = cap;
    if (!state.dimensions_touched.includes(cap.dimension)) state.dimensions_touched.push(cap.dimension);
  }

  // Preguntas de cierre formuladas en este turno (solo ids declarados en el spec: el modelo no inventa preguntas).
  const declaredClosing = (spec.closing_questions ?? []).map((q) => q.id);
  for (const id of output.closing_asked ?? []) {
    if (declaredClosing.includes(id) && !state.closing_asked.includes(id)) state.closing_asked.push(id);
  }

  // saturacion: si el participante no aporto contenido nuevo, sube la racha
  state.saturation_streak = output.new_content ? 0 : state.saturation_streak + 1;

  // --- evaluar cierre (la decision es del codigo, no solo del LLM) ---
  const saturated = state.saturation_streak >= spec.closing.saturation_window;
  const hitCap = state.turn >= spec.closing.turn_cap;

  // Cierra solo si la cobertura YA estaba completa al iniciar este turno (asi no cierra justo despues
  // de preguntar la ultima dimension). El tope duro de turnos siempre cierra.
  // Un estudio con preguntas de cierre no cierra hasta haberlas formulado todas (salvo tope de turnos).
  const closingComplete = declaredClosing.every((id) => state.closing_asked.includes(id));
  if (closingComplete && state.closing_done_turn === undefined) state.closing_done_turn = state.turn;

  // Con todo cubierto y la ultima pregunta de cierre YA RESPONDIDA, se cierra: no se espera
  // saturacion ni que el modelo lo proponga. Exigir saturacion era el defecto de fondo — una
  // persona que responde bien nunca se repite, asi que la racha nunca subia y el bot seguia
  // indagando hasta el tope. Medido en la prueba del 2026-08-12: SIETE repreguntas sobre la
  // misma historia y dos preguntas de mas despues del cierre, una de ellas sobre el futuro
  // laboral de la persona.
  const cierreRespondido =
    closingComplete && state.closing_done_turn !== undefined && state.turn > state.closing_done_turn;

  if ((coverageBefore && (cierreRespondido || saturated || output.propose_close)) || hitCap) {
    state.closed = true;
  }

  return { state, output };
}
