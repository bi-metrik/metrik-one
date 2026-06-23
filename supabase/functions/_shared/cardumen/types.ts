// Cardumen Chat — tipos nucleo del motor conversacional (R1 + R2).
// Runtime-agnostico: solo usa `fetch`. Corre en Node 23 (--experimental-strip-types) y en Deno (webhook ONE).

export type Lang = "es" | "en";

// ---- Spec del estudio (Capa A congelada en pre-registro) ----
export interface Triad {
  id: string;
  theme_es: string; theme_en: string;
  apex_es: [string, string, string]; apex_en: [string, string, string];
}
export interface Dyad {
  id: string;
  theme_es: string; theme_en: string;
  poles_es: [string, string]; poles_en: [string, string];
}
export interface StudySpec {
  study_id: string;
  title: string;
  lang_default: Lang;
  collection_mode: "study_async" | "event_live" | "panel_recurrente";
  elicitation_prompt: {
    status: "OK" | "PENDIENTE_LITERAL";
    placeholder_es: string; placeholder_en: string;
    literal_es?: string; literal_en?: string;
  };
  narrative_fields: string[];
  triads: Triad[];
  dyads: Dyad[];
  classification_metadata: string[];
  closing: { turn_cap: number; saturation_window: number };
}

// Dimensiones de Capa A = union de triadas + diadas. Cada una debe tocarse al cerrar.
export type DimensionId = string; // "T1".."T7", "D1","D2"

// ---- Estado de conversacion (volatil; lo que persiste en Supabase entre turnos) ----
export interface ConversationState {
  study_id: string;
  lang: Lang;
  turn: number;                       // turnos del entrevistador emitidos
  history: ChatTurn[];                // historial completo de la conversacion
  dimensions_touched: DimensionId[];  // dimensiones de Capa A elicitadas al menos una vez
  capaA_confirmed: Record<DimensionId, CapaAPlacement>; // lo que el HUMANO confirmo, en sus palabras
  saturation_streak: number;          // repreguntas seguidas sin contenido nuevo
  reflexivity_log: ReflexivityEntry[]; // por que de cada repregunta (auditoria de sesgo)
  closed: boolean;
}

export interface ChatTurn { role: "interviewer" | "participant"; text: string; }

// Colocacion de Capa A en lenguaje natural (granularidad ordinal/gruesa — decision 2026-06-21).
// NUNCA una coordenada numerica: el canal no la renderiza y la persona no la dio.
export interface CapaAPlacement {
  dimension: DimensionId;
  lean: string;        // hacia que apex/polo se inclino, EN PALABRAS de la persona o etiqueta ordinal
  verbatim: string;    // cita textual que ancla la colocacion (provenance)
  na: boolean;         // la persona dijo que no aplica
}

export interface ReflexivityEntry { turn: number; why: string; }

// ---- Salida estructurada de R1 por turno ----
export interface R1Output {
  message_to_user: string;       // la repregunta abierta (lo unico que ve el participante)
  reflexivity_note: string;      // por que esta repregunta (no se envia al usuario; va al log)
  dimensions_addressed: DimensionId[]; // dimensiones que este turno toco/elicito
  capaA_capture: CapaAPlacement[];     // colocaciones de Capa A confirmadas en este turno (puede ir vacio)
  new_content: boolean;          // el ultimo turno del participante aporto contenido nuevo?
  propose_close: boolean;        // R1 cree que se cumplio el criterio de cierre
}

// ---- Salida estructurada de R2 (serializador, 1x por conversacion) ----
export interface SerializedRecord {
  study_id: string;
  collection_mode: string;
  narrative: Record<string, string>;            // Title / Utopia / Dystopia / FragmentEntry si se elicitaron
  capaA: Record<DimensionId, CapaAPlacement>;   // valores tal como el humano los coloco (NA si no se elicito)
  capaB: { dimension: DimensionId; micro_narrative: string; quote: string }[]; // profundidad por dimension
  classification: Record<string, string>;       // region/antiguedad/ocupacion/sector si surgieron
  provenance: { turns: number; reflexivity_log: ReflexivityEntry[]; non_canonical: boolean; non_canonical_reason?: string };
}

// ---- Adaptador de modelo (pluggable: gemini / claude / ...) ----
export interface ModelMessage { role: "system" | "user" | "assistant"; content: string; }
export interface ModelCallOpts {
  system: string;
  messages: ModelMessage[];
  plainText?: boolean;   // true => respuesta de texto libre (no fuerza JSON). Default: JSON.
  temperature?: number;
  maxTokens?: number;
}
export interface ModelResult { text: string; usage?: { in: number; out: number } }
export interface ModelAdapter {
  id: string;            // ej "gemini-2.5-flash-lite"
  pricing: { in: number; out: number }; // USD / 1M tokens (de arquitectura-conversacional-yuto.md)
  call(opts: ModelCallOpts): Promise<ModelResult>;
}
