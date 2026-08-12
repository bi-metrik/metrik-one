// Presupuesto de profundidad y paso entre historias. Fuente UNICA: la consumen el motor
// (r1.ts, que impone el paso) y el mensaje de estado (prompts.ts, que se lo cuenta al modelo).
// Escribir la regla dos veces las desincroniza en silencio.

import type { StudySpec, ConversationState } from "./types.ts";

// El piso existe porque cubrir las dimensiones de una fase NO es lo mismo que haber escuchado
// la historia: si la fase 1 se resuelve en un solo turno, la primera historia se queda sin una
// sola repregunta. Medido en la prueba con persona del 2026-08-12: cuatro repreguntas sobre la
// segunda historia y NINGUNA sobre la primera.
export const MAX_REPREGUNTAS_NARRATIVA = 3;
export const MIN_REPREGUNTAS_NARRATIVA = 1;

/** Dimensiones declaradas en una fase del estudio (sin fase = fase 1). */
export function dimsDeFase(spec: StudySpec, fase: number): string[] {
  return [
    ...spec.triads.filter((t) => (t.phase ?? 1) === fase).map((t) => t.id),
    ...spec.dyads.filter((d) => (d.phase ?? 1) === fase).map((d) => d.id),
  ];
}

export function repreguntasDe(state: ConversationState): { n1: number; n2: number } {
  return state.repreguntas_narrativa ?? { n1: 0, n2: 0 };
}

export type PasoNarrativa = "seguir_narrativa1" | "presentar_narrativa2" | "ya_en_narrativa2";

/**
 * Cuando pasar de la primera historia a la segunda. Funcion pura: es la regla que el prompt
 * no logro sostener por su cuenta (ver el forzado en r1.ts).
 */
export function decidirPasoNarrativa(a: {
  tieneSegundaNarrativa: boolean;
  narrativa2Presentada: boolean;
  fase1CubiertaAntes: boolean;
  repreguntasNarrativa1: number;
}): PasoNarrativa {
  if (!a.tieneSegundaNarrativa) return "seguir_narrativa1";
  if (a.narrativa2Presentada) return "ya_en_narrativa2";
  // El tope manda sobre el piso: si ya se profundizo de sobra, se pasa aunque falte cobertura.
  if (a.repreguntasNarrativa1 >= MAX_REPREGUNTAS_NARRATIVA) return "presentar_narrativa2";
  if (a.fase1CubiertaAntes && a.repreguntasNarrativa1 >= MIN_REPREGUNTAS_NARRATIVA) return "presentar_narrativa2";
  return "seguir_narrativa1";
}

/** El paso que corresponde AHORA, leido del estado. Lo usan el motor y el mensaje de estado. */
export function pasoNarrativaActual(state: ConversationState, spec: StudySpec): PasoNarrativa {
  return decidirPasoNarrativa({
    tieneSegundaNarrativa: !!spec.second_elicitation,
    narrativa2Presentada: state.narrativa2_turn !== undefined,
    fase1CubiertaAntes: dimsDeFase(spec, 1).every((d) => state.dimensions_touched.includes(d)),
    repreguntasNarrativa1: repreguntasDe(state).n1,
  });
}
