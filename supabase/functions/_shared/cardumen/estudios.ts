// Resolucion del estudio de Cardumen: UNA sola fuente, el catalogo `cardumen_estudios`.
//
// Antes el estudio estaba repartido en tres sitios que podian discrepar: el spec IMPORTADO
// (spec.ts), una CONSTANTE `CARDUMEN_ESTUDIO` en el webhook y una ENV VAR del mismo nombre.
// Consecuencia medida: las respuestas del chat quedaron etiquetadas `fede` con contenido de
// La Araucania, porque el spec venia del import y la etiqueta de la env var.
//
// Ahora: la palabra que escribe la persona resuelve UNA fila, y de esa fila salen el spec y
// el slug con el que se guarda. Si la palabra no resuelve nada, quien llama decide si cae al
// comportamiento previo (spec importado) — asi ningun estudio vivo cambia de conducta.

import { STUDY_SPEC } from "./spec.ts";
import type { StudySpec } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface EstudioChat {
  estudio: string;          // slug canonico: es el que se guarda en cardumen_respuestas.estudio
  nombre: string | null;
  spec: StudySpec;
  desdeCatalogo: boolean;   // false = spec importado (fallback retrocompatible)
}

/** Misma normalizacion que usaban los triggers del webhook: minuscula, sin puntuacion. */
export function normalizarTrigger(text: string): string {
  return (text || "").trim().toLowerCase().replace(/[!¡?¿.,]/g, "");
}

/**
 * Estudio de chat que abre este texto, o null si ninguno.
 *
 * Dos consultas y no un join embebido: el nombre de la relacion de PostgREST no es estable
 * y un join mal nombrado devuelve vacio EN SILENCIO, que aqui significaria "no hay estudio"
 * y mandaria a la persona al flujo de gastos de ONE. Misma leccion que la resolucion de
 * etapa actual en el producto.
 */
export async function resolverEstudioChatPorTrigger(
  supabase: Supa,
  text: string,
): Promise<EstudioChat | null> {
  const palabra = normalizarTrigger(text);
  if (!palabra) return null;

  const { data: trg, error: errTrg } = await supabase
    .from("cardumen_estudio_triggers")
    .select("estudio")
    .eq("palabra", palabra)
    .maybeSingle();
  if (errTrg) {
    console.error("[cardumen] error resolviendo trigger:", errTrg.message);
    return null;
  }
  if (!trg?.estudio) return null;

  return await cargarEstudioChat(supabase, trg.estudio);
}

/**
 * Carga un estudio de chat por su slug. Se usa tanto al abrir (tras resolver el trigger)
 * como al continuar una conversacion (el slug vive en `state.study_id`).
 */
export async function cargarEstudioChat(
  supabase: Supa,
  estudio: string,
): Promise<EstudioChat | null> {
  const { data, error } = await supabase
    .from("cardumen_estudios")
    .select("estudio, nombre, modo, spec, activo")
    .eq("estudio", estudio)
    .maybeSingle();
  if (error) {
    console.error("[cardumen] error cargando estudio:", error.message);
    return null;
  }
  if (!data) return null;
  if (data.modo !== "chat") return null;   // otra via de captura (miniweb / flow)
  if (data.activo === false) return null;  // apagado a proposito

  // spec NULL = el estudio usa el spec importado. Es el caso de Araucania y preserva su
  // comportamiento exacto; el slug, en cambio, sale del catalogo y no de una env var.
  const spec = (data.spec ?? null) as StudySpec | null;
  return {
    estudio: data.estudio,
    nombre: data.nombre ?? null,
    spec: spec ?? STUDY_SPEC,
    desdeCatalogo: spec !== null,
  };
}

/**
 * Spec con el que continuar una conversacion abierta. Si el catalogo no resuelve (fila
 * borrada, estudio apagado a mitad de una conversacion), cae al spec importado: cortar una
 * conversacion en curso seria peor que terminarla con el spec de siempre.
 */
export async function specDeSesion(supabase: Supa, studyId: string): Promise<StudySpec> {
  if (studyId === STUDY_SPEC.study_id) {
    const e = await cargarEstudioChat(supabase, studyId);
    return e?.spec ?? STUDY_SPEC;
  }
  const e = await cargarEstudioChat(supabase, studyId);
  if (!e) {
    console.warn(`[cardumen] sesion con estudio '${studyId}' no resuelto en catalogo; sigo con el spec importado`);
    return STUDY_SPEC;
  }
  return e.spec;
}
