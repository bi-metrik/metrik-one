// Navigate — tipos del motor determinista. Runtime-agnostico (sin Deno): lo prueban
// vitest en node y lo despliega Deno.

import type {
  AnchorLabel, DimensionId, DiadaNav, IntensityLabel, Poblacion, SpecialCase, TriadaNav,
} from "./instrumento.ts";

export type Idioma = "es" | "en" | "pt" | "desconocido";
/** Lo que la persona puede elegir en el primer mensaje. */
export type IdiomaElegible = Exclude<Idioma, "desconocido">;

/** Paso en el que esta la conversacion = que se espera de la persona ahora. */
export type Paso =
  | "idioma"             // primer mensaje: esperando Espanol / English / Portugues
  | "consentimiento"     // esperando OK a la demo (ya en un idioma que la persona entiende)
  | "poblacion"          // esperando si/no a "observador de su sector"
  | "sector"             // esperando numero o nombre de la lista cerrada
  | "historia"           // esperando la narrativa (primer texto libre)
  | "idioma_no_es"       // eligio EN o PT: esperando si/no al mensaje trilingue
  | "triada_orden"       // esperando "cuales dos y en que orden"
  | "triada_segundo"     // nombro uno solo: esperando el segundo
  | "triada_confirmar"   // esperando si/no al eco del orden
  | "triada_intensidad"  // esperando la etiqueta de peso
  | "diada_abrir"        // esperando "A o B"
  | "diada_aclarar"      // esperando eleccion entre las anclas ofrecidas
  | "diada_confirmar"    // esperando si/no al eco del ancla
  | "cerrado";

// ---- Registros por dimension (formato §3 de las dos specs) ----------------------------

export interface RegistroTriada {
  dimension_id: DimensionId;
  poles: [string, string, string];
  dominant: string | null;
  second: string | null;
  residual: string | null;
  intensity_label: IntensityLabel | null;
  composition: [number, number, number] | null;
  resolution_captured: "high" | "coarse";
  confirmed_by_participant: boolean;
  special_case: "not_applicable" | "dont_know" | "unresolved" | null;
  /** La persona se nego a responder ("paso", "no quiero"). Queda `unresolved` y ESTA marca:
   *  no es lo mismo que no haberle entendido. */
  declinado: boolean;
  elicitation_turns: number;
  reflexivity_note: string;
}

export interface RegistroDiada {
  dyad_id: DimensionId;
  poles: [string, string];
  anchor_label: AnchorLabel | null;
  anchor_text: string | null;
  value: number | null;
  special_case: SpecialCase | "unresolved" | null;
  resolution_captured: "high" | "coarse";
  confirmed_by_participant: boolean;
  /** Se nego a responder: queda `not_applicable` (fuera del eje) y ESTA marca, para que el
   *  analisis pueda separarlo de "ninguna de las dos me aplica". */
  declinado: boolean;
  elicitation_turns: number;
  reflexivity_note: string;
}

// ---- Trabajo en curso sobre la dimension actual ------------------------------------

export interface TriadaEnCurso {
  tipo: "triada";
  turnos: number;
  dominante: number | null;
  segundo: number | null;
  solo_uno: boolean;
  especial: "not_applicable" | "dont_know" | null;
  correcciones: number;
  reintentos: number;
  notas: string[];
}

export interface DiadaEnCurso {
  tipo: "diada";
  turnos: number;
  ancla: 1 | 2 | 3 | 4 | 5 | null;
  especial: SpecialCase | null;
  ofrecidas: Array<1 | 2 | 3 | 4 | 5 | "both_intense">; // anclas del menu de aclaracion, en orden
  correcciones: number;
  reintentos: number;
  notas: string[];
}

export interface TurnoHistorial { role: "bot" | "persona"; text: string }

export interface NavigateState {
  motor: "navigate";
  study_id: string;
  demo: true;
  paso: Paso;
  poblacion?: Poblacion;
  sector?: string | null;
  idioma: "es";                 // idioma del instrumento (el unico que existe), bloqueado al confirmar
  idioma_elegido?: IdiomaElegible; // lo que eligio en el primer mensaje; ausente = no eligio y se siguio en espanol por fallback
  idioma_detectado?: Idioma;    // lo que se detecto en la historia: dato para el instrumento EN/PT futuro, no decide nada
  idioma_confirmado: boolean;   // eligio espanol, o acepto seguir en espanol
  historia?: string;
  consent?: { version: string; granted_at: string };
  secuencia: DimensionId[];
  indice: number;               // dimension actual dentro de `secuencia`
  dimensiones: Partial<Record<DimensionId, RegistroTriada | RegistroDiada>>;
  en_curso?: TriadaEnCurso | DiadaEnCurso;
  reintentos: number;           // del paso actual (turno cero)
  turnos: number;               // mensajes de la persona, en total
  notas?: string[];             // lo que paso en el turno cero y no cabe en una dimension (declino decir sector, etc.)
  historial: TurnoHistorial[];
  started_at: string;
  closed: boolean;
}

// ---- Entrada / salida del motor -----------------------------------------------------

export interface Entrada {
  texto: string;
  botonId?: string;   // id del boton interactivo, si la persona toco uno
}

export type Salida =
  | { tipo: "texto"; texto: string }
  | { tipo: "botones"; texto: string; botones: Array<{ id: string; title: string }> };

export type Accion = "seguir" | "guardar_y_cerrar" | "cerrar_sin_guardar" | "borrar";

export interface Resultado {
  state: NavigateState;
  salidas: Salida[];
  accion: Accion;
}

// ---- Interprete: lo unico que pasa por el modelo ------------------------------------
//
// El modelo NO redacta, NO traduce y NO decide: lee la respuesta libre de la persona y
// la devuelve como estructura. El eco y la confirmacion los arma el codigo.

export interface InterpretacionTriada {
  claro: boolean;                 // false = no se pudo leer un orden
  dominante: 0 | 1 | 2 | null;
  segundo: 0 | 1 | 2 | null;      // null si nombro uno solo (ver solo_uno)
  solo_uno: boolean;              // "fue solo X", excluyendo a los otros dos
  especial: "not_applicable" | "dont_know" | null;
}

export interface InterpretacionSegundo {
  claro: boolean;
  segundo: 0 | 1 | 2 | null;
  ninguno: boolean;               // "ninguno de los otros", "solo eso"
}

export interface InterpretacionIntensidad {
  etiqueta: Exclude<IntensityLabel, "solo_uno"> | "no_gradua" | null; // null = no se entendio
}

export interface InterpretacionDiada {
  claro: boolean;
  ancla: 1 | 2 | 3 | 4 | 5 | null;
  especial: SpecialCase | null;
  lado: "izq" | "der" | null;     // pista cuando no es claro
}

export interface Interprete {
  triada(t: TriadaNav, respuesta: string): Promise<InterpretacionTriada>;
  segundo(t: TriadaNav, dominante: number, respuesta: string): Promise<InterpretacionSegundo>;
  intensidad(dominante: string, segundo: string, respuesta: string): Promise<InterpretacionIntensidad>;
  diada(d: DiadaNav, respuesta: string): Promise<InterpretacionDiada>;
}
