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
import type { StudySpec, Encuadre } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface EstudioChat {
  estudio: string;          // slug canonico: es el que se guarda en cardumen_respuestas.estudio
  nombre: string | null;
  spec: StudySpec;
  encuadre: Encuadre | null; // null = encuadre generico de siempre
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
    .select("estudio, nombre, modo, spec, activo, encuadre")
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
    encuadre: (data.encuadre ?? null) as Encuadre | null,
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

// ---------------------------------------------------------------------------------------
// Modo `miniweb`: el instrumento es una pagina, no una conversacion.
//
// Hasta hoy las dos mini-webs vivas se despachaban con la palabra Y el destino escritos en
// el codigo del webhook (`isCardumenTrigger`/`isTurismoTrigger` + la constante
// `CARDUMEN_APP_URL`). Eso sigue en pie por retrocompatibilidad, pero un instrumento nuevo
// ya no necesita deploy: entra como fila del catalogo con `modo='miniweb'` y su `url`.
// ---------------------------------------------------------------------------------------

export interface EstudioMiniweb {
  estudio: string;  // slug canonico; es el que la pagina debe mandar a `cardumen-ingesta`
  nombre: string | null;
  url: string;      // destino del instrumento, sin los parametros del participante
}

/**
 * Estudio de mini-web que abre este texto, o null si ninguno.
 *
 * MISMA tabla de triggers y MISMA normalizacion que el chat: una palabra no puede abrir dos
 * estudios (lo garantiza la PK de `cardumen_estudio_triggers`), asi que el orden en que el
 * webhook consulte chat y miniweb no puede cambiarle el dueno a ninguna palabra existente.
 *
 * Dos consultas y no un join embebido, por la misma razon que `resolverEstudioChatPorTrigger`:
 * un join mal nombrado devuelve vacio EN SILENCIO.
 */
export async function resolverEstudioMiniwebPorTrigger(
  supabase: Supa,
  text: string,
): Promise<EstudioMiniweb | null> {
  const palabra = normalizarTrigger(text);
  if (!palabra) return null;

  const { data: trg, error: errTrg } = await supabase
    .from("cardumen_estudio_triggers")
    .select("estudio")
    .eq("palabra", palabra)
    .maybeSingle();
  if (errTrg) {
    console.error("[cardumen] error resolviendo trigger de miniweb:", errTrg.message);
    return null;
  }
  if (!trg?.estudio) return null;

  const { data, error } = await supabase
    .from("cardumen_estudios")
    .select("estudio, nombre, modo, url, activo")
    .eq("estudio", trg.estudio)
    .maybeSingle();
  if (error) {
    console.error("[cardumen] error cargando estudio de miniweb:", error.message);
    return null;
  }
  if (!data) return null;
  if (data.modo !== "miniweb") return null;  // el chat lo atiende su propio bloque
  if (data.activo === false) return null;    // apagado a proposito
  if (!data.url) {
    // Fila a medio sembrar. Se loguea y se devuelve null en vez de reventar: lo que sigue
    // en el webhook son los disparadores viejos, y un throw aqui tumbaria el turno entero.
    console.error(`[cardumen] estudio miniweb '${data.estudio}' sin url: no se despacha`);
    return null;
  }

  return { estudio: data.estudio, nombre: data.nombre ?? null, url: data.url as string };
}

/**
 * URL del instrumento para un participante. `p` identifica al participante y `wa` es el
 * numero por el que escribio; hoy son el mismo dato y van con nombres distintos porque el
 * instrumento los lee aparte y uno de los dos puede dejar de ser el telefono.
 *
 * Respeta la query que ya traiga la url del catalogo (`?` o `&` segun el caso) y escapa el
 * valor: un telefono con `+` quedaria leido como un espacio del otro lado.
 */
export function urlMiniwebParaParticipante(url: string, phone: string): string {
  const sep = url.includes("?") ? "&" : "?";
  const p = encodeURIComponent(phone);
  return `${url}${sep}p=${p}&wa=${p}`;
}
