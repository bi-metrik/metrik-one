// Cardumen modo `objetos` — la entrevista completa por WhatsApp, lado bot.
//
// EL PROBLEMA: la mitad web ya esta viva. Con `?obj=<id>` la pagina del instrumento
// (`reframeit.metrik.com.co/adultos`) sirve UN solo paso de reparto a pantalla completa, hace
// POST a `cardumen-ingesta` y abre `wa.me` con el texto `Listo <objeto> 50-30-20` prellenado.
// Del lado del bot no habia nada: nadie conduce la entrevista y nadie sabe leer ese texto.
//
// LA SOLUCION: un modo de catalogo mas (`cardumen_estudios.modo = 'objetos'`) cuya `spec`
// declara la SECUENCIA DE PASOS del instrumento, y este modulo. Aqui vive TODO lo que se
// puede ejercitar sin red: leer el spec, armar la url del paso, parsear lo que vuelve y
// decidir si la secuencia avanza. Los envios de WhatsApp viven en `objetos-flujo.ts` (ese
// importa `wa-respond.ts`, que toca `Deno.env` y no se puede colectar desde vitest).
//
// Por que el regreso depende del toque de la persona y no de un empujon del servidor: cada
// mensaje que ella manda abre la ventana de servicio de Meta, asi que esta secuencia NO
// necesita plantilla aprobada ni ventana de 24h. No meter un envio proactivo en el camino.
//
// REGLA METODOLOGICA QUE ATRAVIESA TODO EL MODULO: los enunciados son LITERALES del spec y
// las respuestas se guardan VERBATIM. El bot no parafrasea la pregunta, no resume el relato,
// no lo interpreta y no lo repite en otras palabras. Si el texto de la pregunta cambia entre
// participantes las respuestas dejan de ser comparables, y un resumen del bot mete la
// interpretacion del modelo dentro del dato. Nada de esto pasa por un LLM.

import { normalizarTrigger, urlMiniwebParaParticipante } from "./estudios.ts";

// El cliente de Supabase llega sin tipos generados (esto corre en Deno, no en Next):
// mismo alias que el resto de los modulos de Cardumen.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

/** Valor de `cardumen_estudios.modo` y marca de `state.modo` en la sesion. Un solo literal. */
export const MODO_OBJETOS = "objetos";

/**
 * Marcas de origen que quedan en el payload.
 *
 * `ORIGEN_TEXTO` es el caso delicado: un reparto DERIVADO DEL TEXTO de WhatsApp, o sea
 * porcentajes enteros que la persona pudo editar antes de enviar. No es una medicion y no se
 * puede confundir con una. `ORIGEN_WA` es captura normal del bot (relato y opcion unica): ahi
 * el mensaje de WhatsApp SI es el dato, porque no existe otra via.
 */
export const ORIGEN_TEXTO = "texto_whatsapp";
export const ORIGEN_WA = "whatsapp";

/** Tope de numeros que se aceptan en un `Listo ...`: el reparto mas ancho tiene 8 opciones. */
const MAX_OPCIONES = 12;

/** Tope de opciones de un paso de opcion unica. Mas que esto no es una pregunta cerrada. */
const MAX_CHIPS = 10;

/** Tope del texto de un relato que se guarda. Un mensaje de WhatsApp no pasa de 4096. */
const MAX_RELATO = 8000;

// ---------------------------------------------------------------------------------------
// Forma del spec
// ---------------------------------------------------------------------------------------

/** Paso de reparto: la pagina lo sirve con `?obj=<id>` y el bot solo manda el boton. */
export interface PasoReparto {
  tipo: "reparto";
  id: string;              // id del paso en el guion del instrumento; va tal cual en `?obj=`
  titulo: string | null;   // etiqueta corta para el mensaje del bot (NO es el enunciado)
  opciones: number | null; // cuantos numeros debe traer el `Listo ...`; null = no se verifica
}

/** Micro-narrativa. `pregunta` es LITERAL y se manda tal cual, sin una palabra mas. */
export interface PasoRelato {
  tipo: "relato";
  id: string;
  pregunta: string;
}

/** Opcion unica (los `chips` del guion). `opciones` son los literales, en su orden. */
export interface PasoChips {
  tipo: "chips";
  id: string;
  pregunta: string;
  opciones: string[];
}

export type PasoObjetos = PasoReparto | PasoRelato | PasoChips;

export interface SpecObjetos {
  base_url: string;
  encuadre: string | null;
  cierre: string | null;
  pasos: PasoObjetos[];
}

/**
 * Lee el `spec` de un estudio de modo `objetos`, o null si no tiene forma utilizable.
 *
 * Devolver null y no lanzar es deliberado: quien llama es el webhook, y un throw aqui
 * tumbaria el turno completo de la persona (incluido el flujo de ONE que viene despues).
 *
 * `base_url` puede llegar por el spec o, como respaldo, por la columna `url` de la fila
 * (misma columna que usa el modo `miniweb`): una fila sembrada de las dos formas resuelve.
 *
 * `objetos: [...]` se sigue aceptando como alias de una secuencia de PUROS repartos: es la
 * forma con la que nacio este modo y asi un spec viejo no queda invalido de golpe.
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

  const crudos = Array.isArray(s.pasos) ? s.pasos : (Array.isArray(s.objetos) ? s.objetos : null);
  if (!crudos || crudos.length === 0) return null;
  const alias = !Array.isArray(s.pasos);

  const pasos: PasoObjetos[] = [];
  const vistos = new Set<string>();
  for (const crudo of crudos) {
    const paso = leerPaso(crudo, alias);
    if (!paso) return null;
    // Un id repetido hace la secuencia ambigua (dos pasos se llamarian igual, y el texto de
    // vuelta de un reparto no distinguiria cual): se rechaza el spec entero, no se adivina.
    if (vistos.has(paso.id)) return null;
    vistos.add(paso.id);
    pasos.push(paso);
  }

  return {
    base_url: base,
    encuadre: textoUtil(s.encuadre),
    cierre: textoUtil(s.cierre),
    pasos,
  };
}

function textoUtil(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Un paso del spec, o null si no se puede usar. `alias` = venia de `objetos: [...]`. */
function leerPaso(crudo: unknown, alias: boolean): PasoObjetos | null {
  if (crudo === null || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const o = crudo as Record<string, unknown>;

  const id = normalizarIdObjeto(typeof o.id === "string" ? o.id : "");
  if (!id) return null;

  const tipo = alias ? "reparto" : (typeof o.tipo === "string" ? o.tipo : "");

  if (tipo === "reparto") {
    const opciones = typeof o.opciones === "number" && Number.isInteger(o.opciones) &&
        o.opciones >= 2 && o.opciones <= MAX_OPCIONES
      ? o.opciones
      : null;
    return { tipo: "reparto", id, titulo: textoUtil(o.titulo), opciones };
  }

  if (tipo === "relato") {
    // Sin enunciado literal no hay paso: el bot NO puede redactar la pregunta. Preferimos un
    // spec invalido (que se loguea y no despacha) a una pregunta inventada.
    const pregunta = textoUtil(o.pregunta);
    if (!pregunta) return null;
    return { tipo: "relato", id, pregunta };
  }

  if (tipo === "chips") {
    const pregunta = textoUtil(o.pregunta);
    if (!pregunta) return null;
    if (!Array.isArray(o.opciones) || o.opciones.length < 2 || o.opciones.length > MAX_CHIPS) return null;
    const opciones: string[] = [];
    for (const op of o.opciones) {
      const t = textoUtil(op);
      if (!t) return null;
      opciones.push(t);
    }
    // Dos opciones que normalizan igual son indistinguibles para `leerChips`.
    if (new Set(opciones.map(normalizarTexto)).size !== opciones.length) return null;
    return { tipo: "chips", id, pregunta, opciones };
  }

  return null;
}

/** Minuscula, sin tildes. Es como se comparan los textos que escribe una persona. */
export function normalizarTexto(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Forma canonica de un id de paso. El texto de vuelta de un reparto lo escribe un teclado de
 * celular: llega con tildes, en mayuscula, o con el guion bajo convertido en espacio.
 */
export function normalizarIdObjeto(texto: string): string {
  return normalizarTexto(texto)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------------------
// Parseo del texto de vuelta de un reparto
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
  const plano = normalizarTexto(texto);

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
// Opcion unica
// ---------------------------------------------------------------------------------------

/**
 * Id del boton interactivo de una opcion. Lleva el id del paso dentro a proposito: un boton
 * de OTRO paso (la persona desplaza el chat hacia arriba y toca uno viejo) no vale como
 * respuesta a este. Misma leccion que `BOTONES_DEL_PASO` en Navigate.
 */
export function idBotonChip(pasoId: string, indice: number): string {
  return `chip:${pasoId}:${indice}`;
}

/**
 * La opcion que eligio la persona (el literal del spec), o null.
 *
 * Tres formas, igual que hace el chat: el id del boton, el NUMERO de la lista numerada, y el
 * texto escrito. Lo del numero no es un adorno: las opciones interactivas de WhatsApp son
 * como maximo TRES, y dos pasos del instrumento tienen cuatro y cinco (ver `objetos-flujo.ts`).
 */
export function leerChips(paso: PasoChips, texto: string, botonId?: string | null): string | null {
  if (botonId) {
    for (let i = 0; i < paso.opciones.length; i++) {
      if (botonId === idBotonChip(paso.id, i)) return paso.opciones[i];
    }
    // Boton de otro paso: no resuelve, y tampoco se cae al texto (el titulo del boton viaja
    // como texto del mensaje y resolveria por la via de abajo sin ser de este paso).
    return null;
  }

  const t = normalizarTexto(texto);
  if (!t) return null;

  // Numero de la lista numerada. Solo si el mensaje es EL numero: "tengo 3 hijos" no es una
  // eleccion.
  const soloNumero = /^(\d{1,2})\D?$/.exec(t);
  if (soloNumero) {
    const i = Number(soloNumero[1]) - 1;
    return paso.opciones[i] ?? null;
  }

  for (const op of paso.opciones) {
    if (normalizarTexto(op) === t) return op;
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Relato
// ---------------------------------------------------------------------------------------

/**
 * ¿Vale la pena UNA repregunta suave? Solo para respuestas de una o dos palabras.
 *
 * Es deliberadamente angosto y se pregunta UNA sola vez (lo lleva `estado.repreguntados`):
 * la longitud de un relato NUNCA puede bloquear la secuencia. Si la persona insiste con
 * poco, se acepta y queda registrado como es.
 */
export function relatoEsMuyCorto(texto: string): boolean {
  const t = (texto || "").trim();
  if (!t) return true;
  return t.length < 12 || t.split(/\s+/).length < 3;
}

// ---------------------------------------------------------------------------------------
// Estado de la secuencia
// ---------------------------------------------------------------------------------------

export interface EstadoObjetos {
  modo: typeof MODO_OBJETOS;
  study_id: string;
  paso: number;            // indice del paso PENDIENTE dentro de spec.pasos
  recibidos: string[];     // ids ya registrados, en orden de llegada
  repreguntados?: string[]; // ids de relato a los que ya se les repregunto UNA vez
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
  return { modo: MODO_OBJETOS, study_id: studyId, paso: 0, recibidos: [], repreguntados: [] };
}

/** El paso en el que va la persona, o null si ya los respondio todos. */
export function pasoPendiente(spec: SpecObjetos, estado: EstadoObjetos): PasoObjetos | null {
  return spec.pasos[pasoSano(estado)] ?? null;
}

/**
 * Indice del paso, saneado. Un `paso` que no es entero no negativo solo puede venir de una
 * fila de sesion tocada a mano o de un spec acortado: se trata como el primero.
 *
 * Tiene que usarlo TODO el que haga aritmetica con el paso. Si `decidirObjetos` sumara 1 al
 * valor crudo, un `paso` negativo haria que `spec.pasos[paso]` diera `undefined` y la
 * secuencia se cerrara en el primer mensaje.
 */
function pasoSano(estado: EstadoObjetos): number {
  return Number.isInteger(estado.paso) && estado.paso >= 0 ? estado.paso : 0;
}

function yaRepreguntado(estado: EstadoObjetos, id: string): boolean {
  return (estado.repreguntados ?? []).includes(id);
}

// ---------------------------------------------------------------------------------------
// Decision de avance
// ---------------------------------------------------------------------------------------

/** Lo que la persona respondio en un paso, listo para guardar. */
export type RespuestaDelPaso =
  | { tipo: "reparto"; reparto: RepartoLeido }
  | { tipo: "relato"; texto: string; deAudio: boolean }
  | { tipo: "chips"; valor: string };

export type DecisionObjetos =
  /** No se entendio el mensaje: se reenvia el paso pendiente, SIN error tecnico. */
  | { tipo: "no_entendido"; pendiente: PasoObjetos }
  /** Relato de una o dos palabras: UNA repregunta suave y se sigue pase lo que pase. */
  | { tipo: "repregunta"; pendiente: PasoRelato; estado: EstadoObjetos }
  /** Llego un reparto valido que NO es el pendiente (link viejo): se registra, no se retrocede. */
  | { tipo: "fuera_de_secuencia"; paso: PasoReparto; reparto: RepartoLeido; repetido: boolean; pendiente: PasoObjetos }
  /** El pendiente: se registra y se manda el siguiente. */
  | { tipo: "avanza"; paso: PasoObjetos; respuesta: RespuestaDelPaso; siguiente: PasoObjetos; estado: EstadoObjetos }
  /** El ultimo: se registra, se manda el cierre y la sesion se cierra. */
  | { tipo: "cierra"; paso: PasoObjetos; respuesta: RespuestaDelPaso; estado: EstadoObjetos };

export interface EntradaObjetos {
  texto: string;
  botonId?: string | null;
  /** El texto viene de una nota de voz transcrita. Queda en el registro: no es lo que escribio. */
  deAudio?: boolean;
}

/**
 * Que hace el bot con este mensaje. Pura: no toca base ni red.
 *
 * Reglas que vienen del encargo y no son negociables:
 * - si no se entiende, NO se manda un error tecnico: se reenvia el paso pendiente;
 * - un reparto que no es el pendiente (la persona reabrio un link viejo) se registra, pero la
 *   secuencia NO retrocede;
 * - un reintento del mismo paso no avanza dos pasos;
 * - la longitud de un relato nunca bloquea: una repregunta como maximo.
 */
export function decidirObjetos(
  spec: SpecObjetos,
  estado: EstadoObjetos,
  entrada: EntradaObjetos,
): DecisionObjetos | null {
  const pendiente = pasoPendiente(spec, estado);
  if (!pendiente) return null; // secuencia agotada: la sesion ya deberia estar cerrada

  // Un reparto se reconoce SIEMPRE y antes que nada, sea cual sea el paso pendiente: el
  // texto viene de un link que la persona pudo abrir en cualquier momento. Si no se mirara
  // primero, un `Listo quien_decidio 60-20-20` que llega mientras se espera la historia
  // quedaria guardado como el relato de la persona.
  const reparto = parsearListo(entrada.texto);
  if (reparto) {
    const paso = spec.pasos.find(
      (p): p is PasoReparto => p.tipo === "reparto" && p.id === reparto.objeto,
    );
    if (paso) return decidirReparto(spec, estado, pendiente, paso, reparto);
    // `Listo <algo que no es un reparto de este instrumento>`: no se adivina.
    return { tipo: "no_entendido", pendiente };
  }

  if (pendiente.tipo === "reparto") {
    // Lo unico que vale en un paso de reparto es el texto de vuelta de la pagina.
    return { tipo: "no_entendido", pendiente };
  }

  if (pendiente.tipo === "chips") {
    const valor = leerChips(pendiente, entrada.texto, entrada.botonId);
    if (!valor) return { tipo: "no_entendido", pendiente };
    return avanzar(spec, estado, pendiente, { tipo: "chips", valor });
  }

  // relato
  const texto = (entrada.texto || "").trim();
  if (!texto) return { tipo: "no_entendido", pendiente };
  if (relatoEsMuyCorto(texto) && !yaRepreguntado(estado, pendiente.id)) {
    return {
      tipo: "repregunta",
      pendiente,
      estado: { ...estado, repreguntados: [...(estado.repreguntados ?? []), pendiente.id] },
    };
  }
  // VERBATIM: se recorta por tamano y nada mas. No se resume, no se normaliza, no se limpia.
  return avanzar(spec, estado, pendiente, {
    tipo: "relato",
    texto: texto.slice(0, MAX_RELATO),
    deAudio: entrada.deAudio === true,
  });
}

function decidirReparto(
  spec: SpecObjetos,
  estado: EstadoObjetos,
  pendiente: PasoObjetos,
  paso: PasoReparto,
  reparto: RepartoLeido,
): DecisionObjetos {
  // Cantidad de numeros declarada y no coincide: el mensaje viene mutilado (o es de otra
  // version del instrumento). No se registra un vector de largo equivocado.
  if (paso.opciones !== null && reparto.porcentajes.length !== paso.opciones) {
    return { tipo: "no_entendido", pendiente };
  }
  if (paso.id !== pendiente.id) {
    return {
      tipo: "fuera_de_secuencia",
      paso,
      reparto,
      repetido: estado.recibidos.includes(paso.id),
      pendiente,
    };
  }
  return avanzar(spec, estado, paso, { tipo: "reparto", reparto });
}

function avanzar(
  spec: SpecObjetos,
  estado: EstadoObjetos,
  paso: PasoObjetos,
  respuesta: RespuestaDelPaso,
): DecisionObjetos {
  const recibidos = estado.recibidos.includes(paso.id)
    ? estado.recibidos
    : [...estado.recibidos, paso.id];
  const indice = pasoSano(estado) + 1;
  const siguiente = spec.pasos[indice] ?? null;
  const estadoNuevo: EstadoObjetos = { ...estado, paso: indice, recibidos };

  return siguiente
    ? { tipo: "avanza", paso, respuesta, siguiente, estado: estadoNuevo }
    : { tipo: "cierra", paso, respuesta, estado: estadoNuevo };
}

// ---------------------------------------------------------------------------------------
// URL del paso de reparto
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
 * ¿Ya hay fila de este paso para este participante?
 *
 * Doble funcion. En los repartos: el vector autoritativo es el del POST de la pagina a
 * `cardumen-ingesta`, y el texto de WhatsApp solo sirve para AVANZAR; solo si ese POST se
 * cayo (la pagina deja volver al chat igual, a proposito) se guarda el vector del texto.
 * En los pasos narrativos: es la idempotencia, para que un mensaje reenviado no deje dos filas.
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
 * Guarda la respuesta de un paso.
 *
 * La forma de `respuesta` es la MISMA que produce el HTML del instrumento
 * (`tipo: 'auto_significacion' | 'micro_narrativa' | 'opcion_unica'`), para que el analisis
 * no tenga que saber por que via entro el dato. Lo que SI cambia es la marca de origen.
 *
 * Un reparto derivado del texto va con `origen: 'texto_whatsapp'` y bajo la clave
 * `vector_aproximado`, no `vector`: requisito metodologico de Saga — un vector escrito a
 * mano (porcentajes enteros, redondeados por la pagina, editables por la persona) NUNCA se
 * puede confundir con uno medido.
 */
export async function guardarRespuestaDelPaso(
  supabase: Supa,
  estudio: string,
  phone: string,
  paso: PasoObjetos,
  respuesta: RespuestaDelPaso,
): Promise<void> {
  const { error } = await supabase.from("cardumen_respuestas").insert({
    estudio,
    token: phone,
    lang: "es",
    payload: {
      // Id de sesion estable por (telefono, paso): deja el duplicado evidente si alguna vez
      // se cuela uno.
      sesion_id: `wa-${phone}-${paso.id}`,
      modo: "objeto_suelto",
      objeto: paso.id,
      participante: phone,
      origen: respuesta.tipo === "reparto" ? ORIGEN_TEXTO : ORIGEN_WA,
      generado_en: new Date().toISOString(),
      respuesta: cuerpoDeRespuesta(paso, respuesta),
    },
  });
  if (error) console.error("[cardumen] error guardando respuesta del paso:", error.message);
}

function cuerpoDeRespuesta(
  paso: PasoObjetos,
  respuesta: RespuestaDelPaso,
): Record<string, unknown> {
  if (respuesta.tipo === "reparto") {
    return {
      id: paso.id,
      tipo: "auto_significacion",
      origen: ORIGEN_TEXTO,
      porcentajes: respuesta.reparto.porcentajes,
      vector_aproximado: vectorDePorcentajes(respuesta.reparto.porcentajes),
    };
  }
  if (respuesta.tipo === "relato") {
    return {
      id: paso.id,
      tipo: "micro_narrativa",
      origen: ORIGEN_WA,
      // El enunciado literal viaja con la respuesta: asi el dato dice a que pregunta
      // responde aunque el spec cambie despues.
      pregunta: paso.tipo === "relato" ? paso.pregunta : null,
      texto: respuesta.texto,
      largo_caracteres: respuesta.texto.length,
      // Una transcripcion NO es el texto que la persona escribio. Queda dicho.
      transcrito_de_audio: respuesta.deAudio,
      audio: respuesta.deAudio ? { origen: "whatsapp_voz" } : null,
    };
  }
  return {
    id: paso.id,
    tipo: "opcion_unica",
    origen: ORIGEN_WA,
    pregunta: paso.tipo === "chips" ? paso.pregunta : null,
    valor: respuesta.valor,
  };
}
