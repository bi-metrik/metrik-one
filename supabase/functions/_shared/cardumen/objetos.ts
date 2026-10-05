// Cardumen modo `objetos` — la secuencia de objetos sueltos, lado bot.
//
// EL PROBLEMA: la mitad web ya esta viva. Con `?obj=<id>` la pagina del instrumento
// (`reframeit.metrik.com.co/adultos`) sirve UN solo paso de reparto a pantalla completa, hace
// POST a `cardumen-ingesta` y abre `wa.me` con el texto `Listo <objeto> 50-30-20` prellenado.
// Del lado del bot no habia nada: nadie manda el primer objeto y nadie sabe leer ese texto.
//
// LA SOLUCION: un modo de catalogo mas (`cardumen_estudios.modo = 'objetos'`) cuya `spec`
// declara la secuencia, y este modulo. Aqui vive TODO lo que se puede ejercitar sin red:
// leer el spec, armar la url del paso, parsear el texto de vuelta y decidir si la secuencia
// avanza. Los envios de WhatsApp viven en `objetos-flujo.ts` (ese importa `wa-respond.ts`,
// que toca `Deno.env` y no se puede colectar desde vitest).
//
// Por que el regreso depende del toque de la persona y no de un empujon del servidor: cada
// mensaje que ella manda abre la ventana de servicio de Meta, asi que esta secuencia NO
// necesita plantilla aprobada ni ventana de 24h. No meter un envio proactivo en el camino.

import { normalizarTrigger, urlMiniwebParaParticipante } from "./estudios.ts";

// El cliente de Supabase llega sin tipos generados (esto corre en Deno, no en Next):
// mismo alias que el resto de los modulos de Cardumen.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

/** Valor de `cardumen_estudios.modo` y marca de `state.modo` en la sesion. Un solo literal. */
export const MODO_OBJETOS = "objetos";

/** Marca con la que se guarda un vector DERIVADO DEL TEXTO de WhatsApp, nunca medido. */
export const ORIGEN_TEXTO = "texto_whatsapp";

/** Tope de numeros que se aceptan en un `Listo ...`: el instrumento mas ancho tiene 8 opciones. */
const MAX_OPCIONES = 12;

// ---------------------------------------------------------------------------------------
// Forma del spec
// ---------------------------------------------------------------------------------------

export interface ObjetoDelSpec {
  id: string;             // id del paso en el guion del instrumento; va tal cual en `?obj=`
  titulo: string | null;  // etiqueta corta para el mensaje del bot (no es el enunciado)
  opciones: number | null; // cuantos numeros debe traer el `Listo ...`; null = no se verifica
}

export interface SpecObjetos {
  base_url: string;
  encuadre: string | null;
  cierre: string | null;
  objetos: ObjetoDelSpec[];
}

/**
 * Lee el `spec` de un estudio de modo `objetos`, o null si no tiene forma utilizable.
 *
 * Devolver null y no lanzar es deliberado: quien llama es el webhook, y un throw aqui
 * tumbaria el turno completo de la persona (incluido el flujo de ONE que viene despues).
 *
 * `base_url` puede llegar por el spec o, como respaldo, por la columna `url` de la fila
 * (misma columna que usa el modo `miniweb`): una fila sembrada de las dos formas resuelve.
 */
export function leerSpecObjetos(raw: unknown, urlDeLaFila?: string | null): SpecObjetos | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;

  const base = typeof s.base_url === "string" && s.base_url.trim()
    ? s.base_url.trim()
    : (typeof urlDeLaFila === "string" && urlDeLaFila.trim() ? urlDeLaFila.trim() : "");
  // Solo http(s): la url entra en un boton CTA de WhatsApp y cualquier otro esquema lo
  // rechaza Meta con un error que la persona ve como "no se pudo enviar".
  if (!/^https?:\/\//i.test(base)) return null;

  if (!Array.isArray(s.objetos) || s.objetos.length === 0) return null;
  const objetos: ObjetoDelSpec[] = [];
  const vistos = new Set<string>();
  for (const crudo of s.objetos) {
    if (crudo === null || typeof crudo !== "object" || Array.isArray(crudo)) return null;
    const o = crudo as Record<string, unknown>;
    const id = normalizarIdObjeto(typeof o.id === "string" ? o.id : "");
    if (!id) return null;
    // Un id repetido hace la secuencia ambigua (dos pasos se llamarian igual y el texto de
    // vuelta no distinguiria cual): se rechaza el spec entero, no se adivina.
    if (vistos.has(id)) return null;
    vistos.add(id);
    const opciones = typeof o.opciones === "number" && Number.isInteger(o.opciones) &&
        o.opciones >= 2 && o.opciones <= MAX_OPCIONES
      ? o.opciones
      : null;
    objetos.push({
      id,
      titulo: typeof o.titulo === "string" && o.titulo.trim() ? o.titulo.trim() : null,
      opciones,
    });
  }

  return {
    base_url: base,
    encuadre: typeof s.encuadre === "string" && s.encuadre.trim() ? s.encuadre.trim() : null,
    cierre: typeof s.cierre === "string" && s.cierre.trim() ? s.cierre.trim() : null,
    objetos,
  };
}

/**
 * Forma canonica de un id de objeto. El texto de vuelta lo escribe un teclado de celular:
 * llega con tildes, en mayuscula, o con el guion bajo convertido en espacio.
 */
export function normalizarIdObjeto(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------------------
// Parseo del texto de vuelta
// ---------------------------------------------------------------------------------------

export interface RepartoLeido {
  objeto: string;        // id normalizado
  porcentajes: number[]; // enteros tal como los escribio la pagina (Math.round(w*100))
}

/**
 * Lee `Listo <objeto> <numeros>` de un mensaje de WhatsApp, o null si no esta.
 *
 * TOLERANTE A PROPOSITO: el texto lo prellena `wa.me` pero la persona lo puede editar antes
 * de enviarlo y el teclado del celular corrige solo. Tiene que aguantar mayusculas, la tilde
 * de "listó", espacios de mas, texto pegado alrededor, separadores `-` `/` `,` o espacios, y
 * el objeto escrito con guion bajo o con espacio.
 *
 * Se exigen DOS numeros como minimo: un reparto de una sola opcion no existe en ningun
 * instrumento, y con un solo numero cualquier mensaje con una cifra pasaria por reparto.
 */
export function parsearListo(texto: string): RepartoLeido | null {
  const plano = (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  // "listo" como palabra, en cualquier parte del mensaje.
  const marca = /(?:^|[^a-z0-9])listo(?:[^a-z0-9]|$)/.exec(plano);
  if (!marca) return null;
  const resto = plano.slice(marca.index + marca[0].length);

  // La primera corrida de numeros separados. El `(?<![a-z0-9])` evita que el digito final de
  // un id (p.ej. `amigos2`) arranque la corrida y se coma una letra del objeto.
  const nums = /(?<![a-z0-9])(\d{1,3}(?:\s*[-\/,]\s*\d{1,3}|\s+\d{1,3})+)/.exec(resto);
  if (!nums) return null;

  const objeto = normalizarIdObjeto(resto.slice(0, nums.index));
  if (!objeto) return null;

  const porcentajes = nums[1].split(/[^0-9]+/).filter((t) => t !== "").map((t) => Number(t));
  if (porcentajes.length < 2 || porcentajes.length > MAX_OPCIONES) return null;
  // Un porcentaje > 100 no lo escribe la pagina: es un mensaje mutilado, y tratarlo como
  // reparto meteria basura al estudio. Mejor no entender y reenviar el paso.
  if (porcentajes.some((n) => n > 100)) return null;
  if (porcentajes.reduce((a, b) => a + b, 0) <= 0) return null;

  return { objeto, porcentajes };
}

/** Vector normalizado a suma 1 desde los porcentajes enteros del texto. */
export function vectorDePorcentajes(porcentajes: number[]): number[] {
  const total = porcentajes.reduce((a, b) => a + b, 0);
  if (total <= 0) return porcentajes.map(() => 0);
  return porcentajes.map((n) => Math.round((n / total) * 1e6) / 1e6);
}

// ---------------------------------------------------------------------------------------
// Estado de la secuencia
// ---------------------------------------------------------------------------------------

export interface EstadoObjetos {
  modo: typeof MODO_OBJETOS;
  study_id: string;
  paso: number;        // indice del objeto PENDIENTE dentro de spec.objetos
  recibidos: string[]; // ids ya registrados, en orden de llegada
}

/**
 * La marca que mantiene esta sesion fuera del motor de chat.
 *
 * ESTO ES LO QUE PROTEGE LA DEMO VIVA: la sesion de objetos vive en la MISMA tabla
 * `cardumen_chat_sessions` que Navigate (la demo de Grupo Progreso), y el bloque 0b del
 * webhook, al ver una sesion abierta, llama `continueCardumenChat`. Sin esta marca el motor
 * de chat intentaria leer `Listo preocupaciones 50-30-20` como una narrativa — y peor: la
 * palabra de consentimiento por defecto del encuadre de chat es justamente "LISTO".
 */
export function esEstadoObjetos(state: unknown): state is EstadoObjetos {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return false;
  const s = state as Record<string, unknown>;
  return s.modo === MODO_OBJETOS && typeof s.study_id === "string" && !!s.study_id;
}

export function estadoInicialObjetos(studyId: string): EstadoObjetos {
  return { modo: MODO_OBJETOS, study_id: studyId, paso: 0, recibidos: [] };
}

/** El objeto en el que va la persona, o null si ya los repartio todos. */
export function objetoPendiente(spec: SpecObjetos, estado: EstadoObjetos): ObjetoDelSpec | null {
  return spec.objetos[pasoSano(estado)] ?? null;
}

/**
 * Indice del paso, saneado. Un `paso` que no es entero no negativo solo puede venir de una
 * fila de sesion tocada a mano o de un spec acortado: se trata como el primero.
 *
 * Tiene que usarlo TODO el que haga aritmetica con el paso. Si `decidirObjetos` sumara 1 al
 * valor crudo, un `paso` negativo haria que `spec.objetos[paso]` diera `undefined` y la
 * secuencia se cerrara en el primer mensaje.
 */
function pasoSano(estado: EstadoObjetos): number {
  return Number.isInteger(estado.paso) && estado.paso >= 0 ? estado.paso : 0;
}

// ---------------------------------------------------------------------------------------
// Decision de avance
// ---------------------------------------------------------------------------------------

export type DecisionObjetos =
  /** No se entendio el mensaje: se reenvia el paso pendiente, SIN error tecnico. */
  | { tipo: "no_entendido"; pendiente: ObjetoDelSpec }
  /** Llego un objeto valido que NO es el pendiente (link viejo): se registra, no se retrocede. */
  | { tipo: "fuera_de_secuencia"; objeto: ObjetoDelSpec; reparto: RepartoLeido; repetido: boolean; pendiente: ObjetoDelSpec }
  /** El pendiente: se registra y se manda el siguiente. */
  | { tipo: "avanza"; objeto: ObjetoDelSpec; reparto: RepartoLeido; siguiente: ObjetoDelSpec; estado: EstadoObjetos }
  /** El ultimo: se registra, se manda el cierre y la sesion se cierra. */
  | { tipo: "cierra"; objeto: ObjetoDelSpec; reparto: RepartoLeido; estado: EstadoObjetos };

/**
 * Que hace el bot con este mensaje. Pura: no toca base ni red.
 *
 * Reglas que vienen del encargo y no son negociables:
 * - si no parsea, NO se manda un error tecnico: se reenvia el link del paso pendiente;
 * - si el objeto que llega no es el pendiente (la persona reabrio un link viejo), el
 *   registro se acepta pero la secuencia NO retrocede;
 * - un reintento del mismo objeto no avanza dos pasos.
 */
export function decidirObjetos(
  spec: SpecObjetos,
  estado: EstadoObjetos,
  texto: string,
): DecisionObjetos | null {
  const pendiente = objetoPendiente(spec, estado);
  if (!pendiente) return null; // secuencia agotada: la sesion ya deberia estar cerrada

  const reparto = parsearListo(texto);
  if (!reparto) return { tipo: "no_entendido", pendiente };

  const objeto = spec.objetos.find((o) => o.id === reparto.objeto);
  if (!objeto) return { tipo: "no_entendido", pendiente };
  // Cantidad de numeros declarada y no coincide: el mensaje viene mutilado (o es de otra
  // version del instrumento). No se registra un vector de largo equivocado.
  if (objeto.opciones !== null && reparto.porcentajes.length !== objeto.opciones) {
    return { tipo: "no_entendido", pendiente };
  }

  if (objeto.id !== pendiente.id) {
    return {
      tipo: "fuera_de_secuencia",
      objeto,
      reparto,
      repetido: estado.recibidos.includes(objeto.id),
      pendiente,
    };
  }

  const recibidos = estado.recibidos.includes(objeto.id)
    ? estado.recibidos
    : [...estado.recibidos, objeto.id];
  const paso = pasoSano(estado) + 1;
  const siguiente = spec.objetos[paso] ?? null;
  const estadoNuevo: EstadoObjetos = { ...estado, paso, recibidos };

  return siguiente
    ? { tipo: "avanza", objeto, reparto, siguiente, estado: estadoNuevo }
    : { tipo: "cierra", objeto, reparto, estado: estadoNuevo };
}

// ---------------------------------------------------------------------------------------
// URL del paso
// ---------------------------------------------------------------------------------------

/**
 * Url del paso para este participante: `?obj=<id>&e=<estudio>&p=<tel>&wa=<tel>`.
 *
 * `e` va EXPLICITO aunque la pagina tenga un default: el estudio de este modo es una fila
 * distinta de la del instrumento completo, y sin `e` el POST de la pagina caeria bajo el
 * slug del instrumento completo (el que esta evaluando la metodologa) y mezclaria las dos
 * formas de captura.
 *
 * Los parametros del participante los pone `urlMiniwebParaParticipante`, que ya respeta la
 * query previa y escapa el telefono (un `+` sin escapar se lee como espacio del otro lado).
 */
export function urlDelObjeto(
  baseUrl: string,
  estudio: string,
  objetoId: string,
  phone: string,
): string {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const conObjeto = `${baseUrl}${sep}obj=${encodeURIComponent(objetoId)}&e=${encodeURIComponent(estudio)}`;
  return urlMiniwebParaParticipante(conObjeto, phone);
}

// ---------------------------------------------------------------------------------------
// Catalogo y sesion (toman el cliente por parametro: siguen siendo colectables en vitest)
// ---------------------------------------------------------------------------------------

export interface EstudioObjetos {
  estudio: string;
  nombre: string | null;
  spec: SpecObjetos;
}

/**
 * Estudio de modo `objetos` que abre este texto, o null.
 *
 * MISMA tabla de triggers y MISMA normalizacion que el chat y el miniweb: la PK de
 * `cardumen_estudio_triggers` impide que una palabra abra dos estudios, asi que ninguna
 * palabra viva cambia de dueno por existir este bloque.
 *
 * Dos consultas y no un join embebido, por la misma razon que el resto de los resolvers de
 * Cardumen: un join mal nombrado devuelve vacio EN SILENCIO.
 */
export async function resolverEstudioObjetosPorTrigger(
  supabase: Supa,
  text: string,
): Promise<EstudioObjetos | null> {
  const palabra = normalizarTrigger(text);
  if (!palabra) return null;

  const { data: trg, error: errTrg } = await supabase
    .from("cardumen_estudio_triggers")
    .select("estudio")
    .eq("palabra", palabra)
    .maybeSingle();
  if (errTrg) {
    console.error("[cardumen] error resolviendo trigger de objetos:", errTrg.message);
    return null;
  }
  if (!trg?.estudio) return null;

  return await cargarEstudioObjetos(supabase, trg.estudio);
}

/** Carga un estudio de modo `objetos` por slug (al abrir y al continuar la secuencia). */
export async function cargarEstudioObjetos(
  supabase: Supa,
  estudio: string,
): Promise<EstudioObjetos | null> {
  const { data, error } = await supabase
    .from("cardumen_estudios")
    .select("estudio, nombre, modo, spec, url, activo")
    .eq("estudio", estudio)
    .maybeSingle();
  if (error) {
    console.error("[cardumen] error cargando estudio de objetos:", error.message);
    return null;
  }
  if (!data) return null;
  if (data.modo !== MODO_OBJETOS) return null; // chat y miniweb los atienden sus bloques
  if (data.activo === false) return null;      // apagado a proposito

  const spec = leerSpecObjetos(data.spec ?? null, (data.url ?? null) as string | null);
  if (!spec) {
    // Fila a medio sembrar. Se loguea y se devuelve null en vez de reventar el turno.
    console.error(`[cardumen] estudio objetos '${data.estudio}' con spec inutilizable: no se despacha`);
    return null;
  }
  return { estudio: data.estudio, nombre: (data.nombre ?? null) as string | null, spec };
}

/** Guarda el avance. `reminded_at` vuelve a null: hubo actividad, el recordatorio se re-arma. */
export async function guardarSesionObjetos(
  supabase: Supa,
  phone: string,
  estado: EstadoObjetos,
  closed = false,
): Promise<void> {
  const { error } = await supabase.from("cardumen_chat_sessions").upsert({
    phone,
    state: estado,
    closed,
    reminded_at: null,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("[cardumen] error guardando sesion de objetos:", error.message);
}

/**
 * ¿Ya hay registro MEDIDO (o de texto) de este objeto para este participante?
 *
 * El vector autoritativo es el del POST de la pagina a `cardumen-ingesta`. El texto de
 * WhatsApp sirve para AVANZAR la secuencia, no para medir: solo si el POST se cayo (la
 * pagina deja volver al chat igual, a proposito) se guarda el vector derivado del texto.
 */
export async function hayRegistroDelObjeto(
  supabase: Supa,
  estudio: string,
  participante: string,
  objeto: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("cardumen_respuestas")
    .select("id")
    .eq("estudio", estudio)
    .eq("token", participante)
    .eq("payload->>objeto", objeto)
    .limit(1);
  if (error) {
    // Ante la duda NO se guarda: un duplicado de origen distinto es peor que un hueco,
    // porque el analisis no sabria cual de los dos vectores es el medido.
    console.error("[cardumen] error buscando registro del objeto:", error.message);
    return true;
  }
  return (data ?? []).length > 0;
}

/**
 * Guarda el vector DERIVADO DEL TEXTO, marcado. Requisito metodologico de Saga: un vector
 * escrito a mano (porcentajes enteros, redondeados por la pagina, editables por la persona)
 * NUNCA se puede confundir con uno medido. De ahi `origen: 'texto_whatsapp'` en el payload
 * y en la respuesta, y `vector_aproximado` en vez de `vector`.
 */
export async function guardarVectorDeTexto(
  supabase: Supa,
  estudio: string,
  phone: string,
  objeto: ObjetoDelSpec,
  reparto: RepartoLeido,
): Promise<void> {
  const { error } = await supabase.from("cardumen_respuestas").insert({
    estudio,
    token: phone,
    lang: "es",
    payload: {
      // Id de sesion estable por (telefono, objeto): si el mismo texto llega dos veces,
      // `cardumen-ingesta` no interviene aqui, pero la clave deja el duplicado evidente.
      sesion_id: `wa-${phone}-${objeto.id}`,
      modo: "objeto_suelto",
      objeto: objeto.id,
      participante: phone,
      origen: ORIGEN_TEXTO,
      generado_en: new Date().toISOString(),
      respuesta: {
        id: objeto.id,
        tipo: "auto_significacion",
        origen: ORIGEN_TEXTO,
        porcentajes: reparto.porcentajes,
        vector_aproximado: vectorDePorcentajes(reparto.porcentajes),
      },
    },
  });
  if (error) console.error("[cardumen] error guardando vector de texto:", error.message);
}
