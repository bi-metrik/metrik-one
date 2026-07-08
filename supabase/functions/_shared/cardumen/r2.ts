// R2 — Serializador. Corre 1 vez al cerrar la conversacion (asincrono, no bloquea al usuario).
// Convierte la conversacion N-turnos en un registro estructurado para el "gran bowl" (pipeline de Max).

import type { StudySpec, ConversationState, SerializedRecord, ModelAdapter, CapaAPlacement, DimensionId } from "./types.ts";
import { buildR2System } from "./prompts.ts";
import { parseLooseJSON } from "./json.ts";

export async function serialize(
  model: ModelAdapter,
  spec: StudySpec,
  state: ConversationState,
): Promise<SerializedRecord> {
  const system = buildR2System(spec, state.lang);
  const transcript = state.history
    .map((t) => `${t.role === "interviewer" ? "ENTREVISTADOR" : "PARTICIPANTE"}: ${t.text}`)
    .join("\n");

  const res = await model.call({
    system,
    messages: [{ role: "user", content: `CONVERSACION COMPLETA:\n${transcript}` }],
    temperature: 0.2, // fidelidad > estilo
    maxTokens: 4000,
  });

  let parsed: Partial<SerializedRecord>;
  try {
    parsed = parseLooseJSON<Partial<SerializedRecord>>(res.text);
  } catch {
    const retry = await model.call({
      system,
      messages: [{ role: "user", content: `CONVERSACION COMPLETA:\n${transcript}\n\n(Tu respuesta anterior no fue JSON valido. Devuelve SOLO el JSON exacto, comillas internas escapadas.)` }],
      temperature: 0.2,
      maxTokens: 4000,
    });
    parsed = parseLooseJSON<Partial<SerializedRecord>>(retry.text);
  }
  const allDims: DimensionId[] = [...spec.triads.map((t) => t.id), ...spec.dyads.map((d) => d.id)];

  // Garantia dura: toda dimension no expresada queda na=true (R2 nunca rellena lo que el humano no dijo).
  const capaA: Record<DimensionId, CapaAPlacement> = {};
  for (const d of allDims) {
    const v = parsed.capaA?.[d];
    capaA[d] = v && !v.na && v.verbatim
      ? v
      : { dimension: d, lean: "n/a", verbatim: "", na: true };
  }

  return {
    study_id: spec.study_id,
    collection_mode: spec.collection_mode,
    narrative: parsed.narrative ?? {},
    capaA,
    capaB: parsed.capaB ?? [],
    classification: parsed.classification ?? {},
    provenance: {
      turns: state.turn,
      reflexivity_log: state.reflexivity_log,
      non_canonical: spec.elicitation_prompt.status !== "OK",
      non_canonical_reason: spec.elicitation_prompt.status !== "OK"
        ? "Prompt elicitador aun es placeholder (falta literal del instrumento maestro FEDE)"
        : undefined,
    },
  };
}
