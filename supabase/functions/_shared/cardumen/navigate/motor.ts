// Navigate — motor determinista de la conversacion.
//
// Todo lo que la persona VE lo arma este archivo con los literales del instrumento: idioma
// (primer mensaje: eleccion explicita ANTES del consentimiento, para que el consentimiento
// llegue en un idioma que la persona entiende), turno cero (consentimiento de demo,
// poblacion, sector), deteccion del idioma de la historia solo como dato, triadas en "reparto
// en dos tiempos" (elicitacion-resolucion-yuto.md §1-2) y diadas en "un turno, cinco anclas" (elicitacion-diadas-yuto.md §2-3). El modelo entra SOLO por el
// `Interprete`, para leer texto libre; nunca redacta, nunca traduce, nunca propone.
//
// Es una funcion de (estado, entrada) -> (estado, mensajes, accion). No toca red ni base:
// eso lo hace `index.ts`. Asi se prueba de punta a punta sin modelo ni WhatsApp.
//
// Registro: la persona se trata de USTED, como en la muestra que ve el cliente (Guatemala).
// El guard de espanol neutro (`es-neutro.ts`) solo corrige voseo, asi que no interfiere.
//
// Invariante que defiende todo el archivo: NUNCA se fabrica una ubicacion de Capa A a partir
// de ruido. Lo que no se pudo leer se repregunta UNA vez con encuadre mas claro; a la segunda
// queda `unresolved` y se avanza. La sesion no se cuelga, no se reinicia sola y no salta pasos.
// Antes del modelo hay una capa determinista (`meta.ts`): vacio, pregunta de vuelta y
// negativa nunca llegan al lector como si fueran una respuesta.

import {
  APERTURA, DIADAS, ESPECIALES_FUERA_DEL_EJE, INTENSIDADES, REPARTO_SOLO_UNO, SECTORES, SECUENCIA, TRIADAS,
  anclasDe, composicion, esTriada, etiquetaSector, preguntaMostrada,
} from "./instrumento.ts";
import type { Ancla, DiadaNav, DimensionId, Poblacion, TriadaNav } from "./instrumento.ts";
import { detectarIdioma, leerIdiomaElegido } from "./idioma.ts";
import { normalizarTexto } from "./interprete.ts";
import { leerMeta, sinPalabras } from "./meta.ts";
import type {
  Accion, DiadaEnCurso, Entrada, FuenteLectura, IdiomaElegible, Interprete, NavigateState, Paso, RegistroDiada, RegistroTriada, Resultado, Salida,
  TriadaEnCurso,
} from "./tipos.ts";

export const STUDY_ID = "navigate";
export const CONSENT_VERSION = "navigate-demo-v1";
export const PALABRA_CLAVE = "cardumen";

/** Ids de los botones. La persona puede tocar el boton o escribir; ambos se aceptan. */
export const BOTON = {
  ok: "nav_ok",
  no: "nav_no",
  expSi: "nav_exp_si",
  expNo: "nav_exp_no",
  langEs: "nav_lang_es",
  langEn: "nav_lang_en",
  langPt: "nav_lang_pt",
  langSi: "nav_lang_si",
  langNo: "nav_lang_no",
  si: "nav_si",
  corrijo: "nav_corrijo",
  tri1: "nav_tri_1",
  tri2: "nav_tri_2",
  tri3: "nav_tri_3",
  triNinguno: "nav_tri_ninguno",
  intParejos: "nav_int_parejos",
  intManda: "nav_int_manda",
  intClaro: "nav_int_claro",
} as const;

/** Los tres polos de una triada, en el orden del instrumento: el boton `i` es el polo `i`. */
const TRI_IDS = [BOTON.tri1, BOTON.tri2, BOTON.tri3] as const;

/**
 * Que botones VALEN en cada paso. WhatsApp deja tocar botones de mensajes viejos: un "OK"
 * del consentimiento tocado a mitad de una triada no es una respuesta a la triada. Un boton
 * que no es del paso se ignora como boton y su titulo se lee como texto.
 */
const BOTONES_DEL_PASO: Record<Paso, readonly string[]> = {
  idioma: [BOTON.langEs, BOTON.langEn, BOTON.langPt],
  consentimiento: [BOTON.ok, BOTON.no],
  poblacion: [BOTON.expSi, BOTON.expNo],
  sector: [],
  historia: [],
  idioma_no_es: [BOTON.langSi, BOTON.langNo],
  triada_orden: [BOTON.tri1, BOTON.tri2, BOTON.tri3],
  triada_segundo: [BOTON.tri1, BOTON.tri2, BOTON.tri3, BOTON.triNinguno],
  triada_confirmar: [BOTON.si, BOTON.corrijo],
  triada_intensidad: [BOTON.intParejos, BOTON.intManda, BOTON.intClaro],
  diada_abrir: [],
  diada_aclarar: [],
  diada_confirmar: [BOTON.si, BOTON.corrijo],
  cerrado: [],
};

/**
 * Pasos donde la respuesta es una eleccion o un texto libre, no un si/no: un boton viejo de
 * OTRO paso aqui no es una respuesta y se repregunta. Las triadas tienen sus propios botones
 * (los de `BOTONES_DEL_PASO`); los demas botones que lleguen ahi son de un mensaje anterior.
 */
const PASOS_DE_TEXTO = new Set<Paso>([
  "sector", "historia", "triada_orden", "triada_segundo", "triada_intensidad", "diada_abrir", "diada_aclarar",
]);

const SI = new Set([
  "si", "s", "ok", "okay", "listo", "dale", "de acuerdo", "claro", "vale", "correcto", "asi es",
  "exacto", "sip", "yes", "sim", "va", "bueno", "esta bien", "perfecto", "asi", "si asi", "afirmativo",
]);
const NO = new Set(["no", "nop", "nel", "incorrecto", "no asi no", "corrijo", "no corrijo", "al reves", "not", "nao"]);
const EXIT = new Set(["salir", "cancelar", "terminar"]);
const ERASE = new Set(["borrar", "borra todo", "eliminar mis datos"]);
const MAX_REINTENTOS = 2;

// ---- Textos ---------------------------------------------------------------------------

const TXT = {
  // Primer mensaje tras `cardumen`. Corto y en los tres idiomas: la persona todavia no ha
  // dicho cual habla, y el consentimiento solo vale si llega en uno que entienda.
  idioma: "ES: ¿En qué idioma prefiere continuar?\nEN: Which language do you prefer?\nPT: Em que idioma prefere continuar?",
  consentimiento:
    "Hola. Soy el asistente de escucha de *Navigate* (Cardumen).\n\n" +
    "Antes de empezar: *esto es una demostración*. Lo que responda se guarda marcado como prueba y no entra en ningún estudio ni se comparte.\n\n" +
    "En cualquier momento puede escribir *salir* para terminar, o *borrar* para que eliminemos lo suyo.\n\n" +
    "Si está de acuerdo, presione OK para empezar.",
  consentimientoRepite: "Para empezar presione *OK*. Si prefiere no participar, escriba *no* y no guardamos nada.",
  consentimientoAdios: "Le dejo el ejercicio por aquí. Cuando quiera empezar, escriba *cardumen*.",
  rechazo: "Listo, no hay problema. No guardamos nada.",
  poblacion:
    "Una pregunta para ubicarlo. ¿Responde como *observador de su sector*? Es decir, alguien que por su trabajo o experiencia sigue de cerca lo que pasa en un sector.",
  poblacionRepite: "¿Responde como observador de su sector? Toque *Sí, observador* o *No*.",
  sector: "¿En qué sector se ubica? Elija uno de la lista.",
  sectorRepite: "No encontré ese sector en la lista. Responda con el número.",
  trilingue:
    "ES: Por ahora este instrumento está disponible solo en español. ¿Quiere continuar en español?\n\n" +
    "EN: For now this instrument is available in Spanish only. Would you like to continue in Spanish?\n\n" +
    "PT: Por enquanto este instrumento está disponível apenas em espanhol. Quer continuar em espanhol?",
  trilingueAdios:
    "ES: Entendido. Gracias por su tiempo.\nEN: Understood. Thank you for your time.\nPT: Entendido. Obrigado pelo seu tempo.",
  // Van delante del menu numerado de la triada (ver `repreguntaTriada`).
  corrijoTriada: "Entendido.",
  noSeguiTriada: "No le alcancé a seguir.",
  instruccionTriada: "¿Cuál de las tres pesa más? Toque 1, 2 o 3, o dígamelo con sus palabras.",
  instruccionSegundo: "Toque el número, o *Ninguno* si nada más pesó.",
  instruccionIntensidad: "Toque una opción, o dígamelo con sus palabras.",
  instruccionDiada: "Dígamelo con sus palabras.",
  guardoAsi: "Listo, lo guardo así.",
  sinUbicar: "Lo dejo sin ubicar, no hay problema. Seguimos.",
  declino: "Entendido, lo dejo sin responder. Seguimos.",
  salidaConDatos: "Gracias por lo que alcanzó a compartir. Quedó guardado como prueba de demostración.",
  salidaSinDatos: "Listo, no guardamos nada.",
  alBorrar: "Hecho: borré lo que había compartido y cerré la conversación. Si quiere empezar de nuevo, escriba *cardumen*.",
  cierre:
    "Gracias, eso era todo.\n\nLo que respondió quedó guardado *como prueba de demostración*: no entra en ningún estudio ni se comparte.\n\n" +
    "Esto es lo que quedó registrado, con sus palabras:",
  // Meta-respuestas: una frase corta que responde, y en el MISMO mensaje la pregunta pendiente.
  quienSoy:
    "Soy el asistente de *Navigate* (Cardumen). Esto es una demostración: lo que responda se guarda como prueba y no entra en ningún estudio ni se comparte. " +
    "Si prefiere parar, escriba *salir*.",
  noLlegoTexto: "No me llegó texto. Respóndame con un mensaje de texto o de voz, por favor.",
  botonViejo: "Ese botón era de una pregunta anterior. Seguimos con esta:",
  yaEstamos: "Ya estamos en la demostración. Seguimos donde íbamos:",
  sinHistoria: "Entendido. Sin una historia no tengo con qué seguir: si prefiere no continuar, escriba *salir*. Si no, cuénteme:",
  yaCerrado: "Esta conversación ya terminó. Escriba *cardumen* para empezar de nuevo.",
};

// Variar la entrada rompe la monotonia de repetir la misma mecanica (spec de triadas §4.2).
// La posicion es entre las de su misma clase (primera triada, segunda diada...), no en la
// secuencia completa.
const INTRO_TRIADA = ["Pensando en lo que me contó", "Sobre eso mismo", "Una más sobre lo que contó"];
const INTRO_DIADA = ["Una cosa más sobre lo que contó.", "Otra sobre lo mismo.", "Y una más."];
const INTRO_ULTIMA = "Por último.";

/** Cuantos caracteres de la historia se citan al abrir cada triada (recorte en limite de palabra). */
const MAX_CITA_HISTORIA = 90;

const texto = (t: string): Salida => ({ tipo: "texto", texto: t });
const botones = (t: string, b: Array<{ id: string; title: string }>): Salida => ({ tipo: "botones", texto: t, botones: b });

/**
 * Las primeras palabras de la historia, para anclar la pregunta de la triada a lo que la
 * persona acaba de contar. Una sola linea (los saltos se colapsan), recortada en limite de
 * palabra y con "…" si se corto. Vacia si no hay historia: la pregunta se arma sin la cita.
 */
export function citaHistoria(historia: string | undefined, max = MAX_CITA_HISTORIA): string {
  const limpia = (historia ?? "").replace(/\s+/g, " ").trim();
  if (limpia.length <= max) return limpia;
  const corte = limpia.lastIndexOf(" ", max);
  const base = corte > 0 ? limpia.slice(0, corte) : limpia.slice(0, max);
  return `${base.replace(/[\s,;:.!?…]+$/, "")}…`;
}

// Palabra interrogativa (con o sin preposicion delante) sobre la que se abre el "¿". Fronteras
// con \p{L} y no con \b: en JS \b es ASCII y "qué" (con tilde) no cierra palabra.
const INTERROGATIVO = /(?<!\p{L})(?:(?:de|a|en|con|para|por)\s+)?(?:qu[eé]|cu[aá]l(?:es)?|qui[eé]n(?:es)?|c[oó]mo|d[oó]nde|cu[aá]ndo|cu[aá]nt[oa]s?)(?!\p{L})/iu;

/**
 * La pregunta del instrumento en forma interrogativa, sin cambiarle una palabra: el "¿" se
 * abre en la palabra interrogativa y el "?" cierra al final. "De dónde nace lo que observó" ->
 * "¿De dónde nace lo que observó?"; "En el fondo, qué se siente que es" -> "En el fondo, ¿qué
 * se siente que es?". Si no hay palabra interrogativa, se envuelve completa.
 */
export function preguntaInterrogativa(t: TriadaNav): string {
  const p = preguntaMostrada(t);
  const m = INTERROGATIVO.exec(p);
  if (!m) return `¿${p}?`;
  return `${p.slice(0, m.index)}¿${p.slice(m.index)}?`;
}

/** Primera LETRA en minuscula (salta el "¿"), para pegar la pregunta detras de una coma. */
function minusculaInicial(s: string): string {
  return s.replace(/^(\P{L}*)(\p{L})/u, (_, antes: string, letra: string) => antes + letra.toLowerCase());
}

const menuTriada = (t: TriadaNav): string => t.polos.map((p, i) => `${i + 1}. ${p}`).join("\n");
const botonesTriada = (cuerpo: string): Salida =>
  botones(cuerpo, TRI_IDS.map((id, i) => ({ id, title: String(i + 1) })));
const botonesSiNo = (t: string): Salida =>
  botones(t, [{ id: BOTON.si, title: "Sí, así" }, { id: BOTON.corrijo, title: "No, corrijo" }]);
const botonesPoblacion = (t: string): Salida =>
  botones(t, [{ id: BOTON.expSi, title: "Sí, observador" }, { id: BOTON.expNo, title: "No" }]);
const botonesIdioma = (): Salida =>
  botones(TXT.idioma, [{ id: BOTON.langEs, title: "Español" }, { id: BOTON.langEn, title: "English" }, { id: BOTON.langPt, title: "Português" }]);
const botonesConsentimiento = (t: string): Salida => botones(t, [{ id: BOTON.ok, title: "OK" }]);
const botonesTrilingue = (): Salida =>
  botones(TXT.trilingue, [{ id: BOTON.langSi, title: "Sí / Yes / Sim" }, { id: BOTON.langNo, title: "No" }]);

/** Antepone una frase a una salida (texto o botones) sin cambiar su tipo. */
function prefijar(prefijo: string | undefined, s: Salida): Salida {
  if (!prefijo) return s;
  return { ...s, texto: `${prefijo}\n\n${s.texto}` };
}

function menuSectores(encabezado: string): Salida {
  const filas = SECTORES.map((s, i) => `${i + 1}. ${etiquetaSector(s)}`).join("\n");
  return texto(`${encabezado}\n\n${filas}\n\nResponda con el número.`);
}

/**
 * Apertura de una triada: ancla a la historia (sus primeras palabras entre comillas), la
 * pregunta del instrumento en forma interrogativa, los tres polos numerados en lineas aparte
 * y una sola instruccion. Pide UNA cosa (cual pesa mas); el segundo lugar se pide despues.
 * Botones 1, 2, 3.
 */
function preguntaTriada(t: TriadaNav, posicion: number, historia: string | undefined): Salida {
  const intro = INTRO_TRIADA[Math.min(posicion, INTRO_TRIADA.length - 1)];
  const cita = citaHistoria(historia);
  const ancla = cita ? `${intro} ("${cita}")` : intro;
  return botonesTriada(`${ancla}, ${minusculaInicial(preguntaInterrogativa(t))}\n\n${menuTriada(t)}\n\n${TXT.instruccionTriada}`);
}

/** Repregunta de la triada (no se leyo, o corrige): el mismo menu con botones, sin la cita. */
const repreguntaTriada = (t: TriadaNav, prefijo: string): Salida =>
  botonesTriada(`${prefijo}\n\n${menuTriada(t)}\n\n${TXT.instruccionTriada}`);

/** Segundo lugar: los dos polos restantes con SU numero original (no se renumeran) y "Ninguno". */
function preguntaSegundo(t: TriadaNav, dominante: number): Salida {
  const otros = [0, 1, 2].filter((i) => i !== dominante);
  const filas = otros.map((i) => `${i + 1}. ${t.polos[i]}`).join("\n");
  return botones(
    `Entendido, primero *${dominante + 1}. ${t.polos[dominante]}*. ¿Y en segundo lugar?\n\n${filas}\n\n${TXT.instruccionSegundo}`,
    [...otros.map((i) => ({ id: TRI_IDS[i], title: String(i + 1) })), { id: BOTON.triNinguno, title: "Ninguno" }],
  );
}

/** Diada: los dos polos en lineas aparte, sin botones ni numeros (se lee texto libre, spec de diadas). */
function preguntaDiada(d: DiadaNav, posicion: number, esUltima: boolean): Salida {
  const intro = esUltima ? INTRO_ULTIMA : INTRO_DIADA[Math.min(posicion, INTRO_DIADA.length - 1)];
  return texto(`${intro} ¿Cuál de las dos se acerca más a lo que siente?\n\n• ${d.izq}\n• ${d.der}\n\n${TXT.instruccionDiada}`);
}

function ecoOrden(t: TriadaNav, ec: TriadaEnCurso): Salida {
  if (ec.especial) {
    return botonesSiNo(`Lo dejo como *${ESPECIALES_FUERA_DEL_EJE[ec.especial]}*. ¿Así?`);
  }
  const dom = t.polos[ec.dominante!];
  if (ec.solo_uno || ec.segundo === null) {
    return botonesSiNo(
      ec.solo_uno
        ? `Le leo entonces: *solo ${dom}*, y lo demás al margen. ¿Lo dejo así?`
        : `Le leo entonces: *primero, ${dom}*; el resto sin ordenar. ¿Lo dejo así?`,
    );
  }
  const sec = t.polos[ec.segundo];
  const res = t.polos[[0, 1, 2].find((i) => i !== ec.dominante && i !== ec.segundo)!];
  return botonesSiNo(`Le leo entonces: *primero, ${dom}*; *en segundo lugar, ${sec}*; y *${res}* quedó al margen. ¿Lo dejo así?`);
}

/**
 * Intensidad: las tres etiquetas de peso con su redaccion completa en lineas aparte (sin
 * numerar, para que un numero aqui siga significando un polo) y tres botones cortos que
 * mapean a las MISMAS etiquetas pre-registradas (§3.1). "Claramente el N" nombra al dominante
 * por su numero de polo.
 */
function preguntaIntensidad(t: TriadaNav, ec: TriadaEnCurso, corta = false): Salida {
  const dom = t.polos[ec.dominante!];
  const sec = t.polos[ec.segundo!];
  const cabeza = `${corta ? "" : "Una última de esta parte. "}Entre *${dom}* y *${sec}*, ¿cómo se repartió el peso?`;
  const opciones = `• casi parejos\n• uno mandaba pero el otro contaba\n• fue claramente ${dom}`;
  return botones(`${cabeza}\n\n${opciones}\n\n${TXT.instruccionIntensidad}`, [
    { id: BOTON.intParejos, title: "Casi parejos" },
    { id: BOTON.intManda, title: "Uno mandaba más" },
    { id: BOTON.intClaro, title: `Claramente el ${ec.dominante! + 1}` },
  ]);
}

function textoAncla(d: DiadaNav, ec: DiadaEnCurso): string {
  if (ec.especial && ec.especial !== "middle") return ESPECIALES_FUERA_DEL_EJE[ec.especial];
  const a = anclasDe(d).find((x) => x.posicion === ec.ancla);
  return a ? a.texto : "";
}

const ecoDiada = (d: DiadaNav, ec: DiadaEnCurso): Salida => botonesSiNo(`Lo dejo como *${textoAncla(d, ec)}*. ¿Así?`);

function menuAclaracion(d: DiadaNav, ec: DiadaEnCurso): Salida {
  const anclas = anclasDe(d);
  const filas = ec.ofrecidas.map((o, i) => {
    const t = o === "both_intense" ? ESPECIALES_FUERA_DEL_EJE.both_intense : anclas.find((a) => a.posicion === o)!.texto;
    return `${i + 1}. ${t}`;
  });
  return texto(`Entonces, ¿lo dejo como...?\n\n${filas.join("\n")}\n\nResponda con el número, o dígamelo con sus palabras.`);
}

// ---- Estado inicial -------------------------------------------------------------------

export function iniciar(ahora: string): { state: NavigateState; salidas: Salida[] } {
  const state: NavigateState = {
    motor: "navigate",
    study_id: STUDY_ID,
    demo: true,
    paso: "idioma",
    idioma: "es",
    idioma_confirmado: false,
    secuencia: [],
    indice: 0,
    dimensiones: {},
    reintentos: 0,
    turnos: 0,
    historial: [],
    started_at: ahora,
    closed: false,
  };
  const salidas = [botonesIdioma()];
  anotar(state, salidas);
  return { state, salidas };
}

export function esEstadoNavigate(state: unknown): state is NavigateState {
  return !!state && typeof state === "object" && (state as { motor?: string }).motor === "navigate";
}

function anotar(state: NavigateState, salidas: Salida[]): void {
  for (const s of salidas) state.historial.push({ role: "bot", text: s.texto });
}

function resultado(state: NavigateState, salidas: Salida[], accion: Accion = "seguir"): Resultado {
  anotar(state, salidas);
  return { state, salidas, accion };
}

function nota(state: NavigateState, n: string): void {
  (state.notas ??= []).push(n);
}

// ---- Procesar un mensaje de la persona -------------------------------------------------

export async function procesar(state: NavigateState, entrada: Entrada, interprete: Interprete): Promise<Resultado> {
  const t = (entrada.texto || "").trim();
  const n = normalizarTexto(t);
  // Un boton de OTRO paso no vale como boton: su titulo se lee como texto.
  const boton = entrada.botonId && BOTONES_DEL_PASO[state.paso].includes(entrada.botonId) ? entrada.botonId : undefined;
  state.turnos += 1;
  state.historial.push({ role: "persona", text: t });

  if (state.closed || state.paso === "cerrado") return resultado(state, [], "seguir");

  // Salidas globales. BORRAR vale en cualquier momento, incluso antes del consentimiento.
  if (ERASE.has(n)) {
    state.closed = true;
    state.paso = "cerrado";
    return resultado(state, [texto(TXT.alBorrar)], "borrar");
  }
  if (EXIT.has(n)) return salir(state);

  // La palabra clave a mitad de conversacion NO reinicia nada: se recuerda donde ibamos.
  // Antes del consentimiento no hay nada que recordar: se repite la pregunta a secas.
  if (n === PALABRA_CLAVE) {
    const pendiente = preguntaPendiente(state);
    const arrancando = state.paso === "idioma" || state.paso === "consentimiento";
    return resultado(state, [arrancando ? pendiente : prefijar(TXT.yaEstamos, pendiente)]);
  }

  // Capa determinista ANTES del modelo: lo que no es una respuesta no se lee como respuesta.
  if (!boton) {
    if (sinPalabras(t)) return fallaLectura(state, "vacio");
    if (entrada.botonId && PASOS_DE_TEXTO.has(state.paso)) return fallaLectura(state, "boton");
    const meta = leerMeta(t);
    if (meta === "pregunta") return fallaLectura(state, "pregunta");
    if (meta === "negativa") return declinar(state);
  }

  const esSi = boton === BOTON.ok || boton === BOTON.si || boton === BOTON.expSi || boton === BOTON.langSi || SI.has(n);
  const esNo = boton === BOTON.no || boton === BOTON.corrijo || boton === BOTON.expNo || boton === BOTON.langNo || NO.has(n);

  switch (state.paso) {
    case "idioma": {
      const elegido = boton === BOTON.langEs
        ? "es"
        : boton === BOTON.langEn
          ? "en"
          : boton === BOTON.langPt
            ? "pt"
            : leerIdiomaElegido(t);
      if (elegido === null) return fallaLectura(state, "no_leido");
      return fijarIdioma(state, elegido);
    }

    case "consentimiento": {
      if (esSi) {
        state.consent = { version: CONSENT_VERSION, granted_at: new Date().toISOString() };
        state.paso = "poblacion";
        state.reintentos = 0;
        return resultado(state, [botonesPoblacion(TXT.poblacion)]);
      }
      if (esNo) return cerrarSinGuardar(state, TXT.rechazo);
      return fallaLectura(state, "no_leido");
    }

    case "poblacion": {
      // "no soy observador" menciona la palabra y la niega: es ciudadano, no experto.
      const menciona = /\b(observador|observadora|experto|experta)\b/.test(n);
      const niega = /\bno\b/.test(n);
      let poblacion: Poblacion | null = null;
      if (boton === BOTON.expSi) poblacion = "experto";
      else if (boton === BOTON.expNo) poblacion = "ciudadano";
      else if (menciona) poblacion = niega ? "ciudadano" : "experto";
      else if (/\bciudadan/.test(n)) poblacion = "ciudadano";
      else if (esSi && !esNo) poblacion = "experto";
      else if (esNo) poblacion = "ciudadano";
      if (poblacion === null) return fallaLectura(state, "no_leido");
      return fijarPoblacion(state, poblacion);
    }

    case "sector": {
      const sector = leerSector(n);
      if (sector === null) return fallaLectura(state, "no_leido");
      return fijarSector(state, sector);
    }

    case "historia": {
      // La historia se guarda tal cual. El idioma ya se eligio al inicio: aqui solo se registra
      // lo detectado, como dato para el instrumento EN/PT futuro, y se abre la primera dimension.
      state.historia = t;
      state.idioma_detectado = detectarIdioma(t);
      state.reintentos = 0;
      return resultado(state, abrirDimension(state));
    }

    case "idioma_no_es": {
      // "Si / Yes / Sim", o nombrar el espanol ("ok, spanish"), es aceptar seguir en espanol.
      if (esSi || (!esNo && leerIdiomaElegido(t) === "es")) return confirmarIdioma(state);
      if (esNo) return cerrarSinGuardar(state, TXT.trilingueAdios);
      return fallaLectura(state, "no_leido");
    }

    case "triada_orden":
      return await leerOrden(state, t, n, boton, interprete);

    case "triada_segundo": {
      const { tri, ec } = triadaActual(state);
      ec.turnos += 1;
      // Boton o numero: se resuelve sin el lector. Texto libre: el lector, como siempre.
      const explicito = segundoExplicito(n, boton, ec.dominante!);
      const fuente: FuenteLectura = explicito?.fuente ?? "texto";
      const r = explicito ?? await interprete.segundo(tri, ec.dominante!, t);
      if (r.claro && r.ninguno) {
        ec.solo_uno = true;
        ec.segundo = null;
        ec.notas.push(`dijo que ningun otro polo peso (segundo: ${fuente})`);
      } else if (r.claro && r.segundo !== null) {
        ec.segundo = r.segundo;
        ec.notas.push(`segundo: ${fuente}`);
      } else {
        ec.reintentos += 1;
        if (ec.reintentos < MAX_REINTENTOS) return resultado(state, [preguntaSegundo(tri, ec.dominante!)]);
        ec.segundo = null;
        ec.notas.push("no se pudo leer el segundo polo: queda sin ordenar");
      }
      // Eleccion explicita de punta a punta (dominante Y segundo por boton o numero): no hay
      // nada que el modelo haya interpretado, asi que no se confirma. Si cualquiera de los dos
      // lo leyo el modelo, eco + confirmacion como siempre.
      if (r.claro && fuente !== "texto" && dominanteExplicito(ec)) {
        if (ec.solo_uno) return cerrarTriada(state, { intensidad: "solo_uno", confirmado: true, nota: "un solo polo, elegido explicitamente" });
        state.paso = "triada_intensidad";
        return resultado(state, [preguntaIntensidad(tri, ec)]);
      }
      state.paso = "triada_confirmar";
      return resultado(state, [ecoOrden(tri, ec)]);
    }

    case "triada_confirmar": {
      const { tri, ec } = triadaActual(state);
      ec.turnos += 1;
      if (esSi && !esNo) {
        if (ec.especial) return cerrarTriada(state, { intensidad: null, confirmado: true, nota: "la persona lo saco del eje y lo confirmo" });
        if (ec.solo_uno) return cerrarTriada(state, { intensidad: "solo_uno", confirmado: true, nota: "un solo polo, explicito y confirmado" });
        if (ec.segundo === null) return cerrarTriada(state, { intensidad: null, confirmado: true, nota: "solo dominante confirmado; sin segundo: resolucion gruesa" });
        state.paso = "triada_intensidad";
        return resultado(state, [preguntaIntensidad(tri, ec)]);
      }
      ec.correcciones += 1;
      if (ec.correcciones >= MAX_REINTENTOS) {
        return cerrarTriada(state, { intensidad: null, confirmado: false, nota: "corrigio dos veces sin llegar a un orden avalado", sinResolver: true });
      }
      // Vuelve a elegir: es otro intento del orden, con su propio tope (`correcciones`).
      ec.reintentos = 0;
      state.paso = "triada_orden";
      if (esNo) return resultado(state, [repreguntaTriada(tri, TXT.corrijoTriada)]);
      // Corrigio con contenido ("no, primero X", o un numero): se lee como un orden nuevo.
      ec.notas.push("corrigio el eco con sus palabras");
      return await leerOrden(state, t, n, undefined, interprete);
    }

    case "triada_intensidad": {
      const { tri, ec } = triadaActual(state);
      ec.turnos += 1;
      let fuente: FuenteLectura = "boton";
      let etiqueta = boton === BOTON.intParejos
        ? "casi_parejos" as const
        : boton === BOTON.intManda
          ? "uno_manda_otro_cuenta" as const
          : boton === BOTON.intClaro
            ? "claramente_el_primero" as const
            : null;
      if (etiqueta === null) {
        // Un numero aqui es un polo, no una opcion: solo el del dominante significa algo
        // ("claramente el 2"). Cualquier otro se repregunta sin gastar lector ni fabricar.
        const porNumero = intensidadExplicita(n, ec.dominante!);
        fuente = porNumero === null ? "texto" : "numero";
        if (porNumero === "claramente") etiqueta = "claramente_el_primero";
        else if (porNumero === null) {
          const r = await interprete.intensidad(tri.polos[ec.dominante!], tri.polos[ec.segundo!], t);
          if (r.etiqueta === "no_gradua") {
            return cerrarTriada(state, { intensidad: null, confirmado: true, nota: "orden confirmado; no quiso graduar: resolucion gruesa" });
          }
          etiqueta = r.etiqueta;
        }
      }
      if (etiqueta === null) {
        ec.reintentos += 1;
        if (ec.reintentos < MAX_REINTENTOS) return resultado(state, [preguntaIntensidad(tri, ec, true)]);
        return cerrarTriada(state, { intensidad: null, confirmado: true, nota: "orden confirmado; la graduacion no se pudo leer: resolucion gruesa" });
      }
      ec.notas.push(`intensidad: ${fuente}`);
      return cerrarTriada(state, { intensidad: etiqueta, confirmado: true, nota: "ordeno dos polos y graduo con etiqueta de peso; residual inferido" });
    }

    case "diada_abrir":
      return await leerDiada(state, t, interprete);

    case "diada_aclarar": {
      const { dia, ec } = diadaActual(state);
      ec.turnos += 1;
      const k = leerNumero(n);
      const elegida = k !== null && k >= 1 && k <= ec.ofrecidas.length ? ec.ofrecidas[k - 1] : null;
      if (elegida !== null) {
        if (elegida === "both_intense") ec.especial = "both_intense";
        else {
          ec.ancla = elegida;
          ec.especial = elegida === 3 ? "middle" : null;
        }
        ec.notas.push("eligio entre las anclas ofrecidas");
        return cerrarDiada(state, { confirmado: true, nota: "matizo; el bot ofrecio anclas intermedias sin proponer valor y la persona eligio" });
      }
      const r = await interprete.diada(dia, t);
      if (r.claro) {
        aplicarLecturaDiada(ec, r);
        state.paso = "diada_confirmar";
        return resultado(state, [ecoDiada(dia, ec)]);
      }
      ec.reintentos += 1;
      if (ec.reintentos < MAX_REINTENTOS) return resultado(state, [menuAclaracion(dia, ec)]);
      return cerrarDiada(state, { confirmado: false, nota: "no se pudo leer un ancla tras dos intentos", sinResolver: true });
    }

    case "diada_confirmar": {
      const { dia, ec } = diadaActual(state);
      ec.turnos += 1;
      if (esSi && !esNo) return cerrarDiada(state, { confirmado: true, nota: ec.notas.length ? ec.notas.join("; ") : "respondio y confirmo el eco" });
      ec.correcciones += 1;
      if (ec.correcciones >= MAX_REINTENTOS) {
        return cerrarDiada(state, { confirmado: false, nota: "corrigio dos veces sin avalar un ancla", sinResolver: true });
      }
      if (esNo) {
        state.paso = "diada_abrir";
        return resultado(state, [texto(`Dígamelo con sus palabras: ¿más hacia *${dia.izq}* o hacia *${dia.der}*?`)]);
      }
      ec.notas.push("corrigio el eco con sus palabras");
      state.paso = "diada_abrir";
      return await leerDiada(state, t, interprete);
    }

    default:
      // "cerrado" quedo atendido arriba: aqui TypeScript ya lo excluye del tipo.
      return resultado(state, [], "seguir");
  }
}

// ---- Turno cero: helpers ---------------------------------------------------------------

function leerNumero(n: string): number | null {
  const m = /^(\d{1,2})\b/.exec(n);
  return m ? Number(m[1]) : null;
}

export function leerSector(n: string): string | null {
  const k = leerNumero(n);
  if (k !== null && k >= 1 && k <= SECTORES.length) return SECTORES[k - 1];
  if (n.length < 4) return null;
  const candidatos = SECTORES.filter((s) => {
    const ns = normalizarTexto(s);
    return ns === n || ns.includes(n) || n.includes(ns);
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

function fijarPoblacion(state: NavigateState, poblacion: Poblacion): Resultado {
  state.poblacion = poblacion;
  state.secuencia = [...SECUENCIA[poblacion]];
  state.paso = "sector";
  state.reintentos = 0;
  return resultado(state, [menuSectores(TXT.sector)]);
}

function fijarSector(state: NavigateState, sector: string | null): Resultado {
  state.sector = sector;
  state.paso = "historia";
  state.reintentos = 0;
  return resultado(state, [texto(APERTURA[state.poblacion!])]);
}

/** El idioma elegido al inicio decide el flujo: espanol sigue al consentimiento; EN o PT reciben el aviso trilingue. */
function fijarIdioma(state: NavigateState, idioma: IdiomaElegible): Resultado {
  state.idioma_elegido = idioma;
  state.reintentos = 0;
  if (idioma === "es") return confirmarIdioma(state);
  state.paso = "idioma_no_es";
  return resultado(state, [botonesTrilingue()]);
}

/** Espanol confirmado (elegido, aceptado o por fallback): recien aqui se pide el consentimiento. */
function confirmarIdioma(state: NavigateState): Resultado {
  state.idioma_confirmado = true;
  state.reintentos = 0;
  state.paso = "consentimiento";
  return resultado(state, [botonesConsentimiento(TXT.consentimiento)]);
}

// ---- Lo que no se pudo leer: repreguntar una vez, resolver a la segunda ------------------
//
// Todos los caminos "no se leyo" (vacio, boton viejo, pregunta de vuelta, negativa, lectura
// fallida) pasan por aqui, asi que el tope de intentos vive en UN sitio.

type Motivo = "vacio" | "boton" | "pregunta" | "no_leido";

/** Suma un intento al contador del paso actual. Devuelve true si se agoto el tope. */
function sumarIntento(state: NavigateState): boolean {
  const ec = state.en_curso;
  if (ec) ec.turnos += 1;
  switch (state.paso) {
    case "triada_confirmar":
    case "diada_confirmar":
      ec!.correcciones += 1;
      return ec!.correcciones >= MAX_REINTENTOS;
    case "triada_orden":
    case "triada_segundo":
    case "triada_intensidad":
    case "diada_abrir":
    case "diada_aclarar":
      ec!.reintentos += 1;
      return ec!.reintentos >= MAX_REINTENTOS;
    default:
      state.reintentos += 1;
      return state.reintentos >= MAX_REINTENTOS;
  }
}

/** La pregunta que la persona tiene pendiente, tal como se le hizo. */
function preguntaPendiente(state: NavigateState): Salida {
  switch (state.paso) {
    case "idioma": return botonesIdioma();
    case "consentimiento": return botonesConsentimiento(TXT.consentimientoRepite);
    case "poblacion": return botonesPoblacion(TXT.poblacionRepite);
    case "sector": return menuSectores(TXT.sector);
    case "historia": return texto(APERTURA[state.poblacion ?? "ciudadano"]);
    case "idioma_no_es": return botonesTrilingue();
    case "triada_orden": { const { tri } = triadaActual(state); return preguntaTriada(tri, posicionTriada(state), state.historia); }
    case "triada_segundo": { const { tri, ec } = triadaActual(state); return preguntaSegundo(tri, ec.dominante!); }
    case "triada_confirmar": { const { tri, ec } = triadaActual(state); return ecoOrden(tri, ec); }
    case "triada_intensidad": { const { tri, ec } = triadaActual(state); return preguntaIntensidad(tri, ec, true); }
    case "diada_abrir": { const { dia } = diadaActual(state); return preguntaDiada(dia, posicionDiada(state), esUltimaDimension(state)); }
    case "diada_aclarar": { const { dia, ec } = diadaActual(state); return menuAclaracion(dia, ec); }
    case "diada_confirmar": { const { dia, ec } = diadaActual(state); return ecoDiada(dia, ec); }
    case "cerrado": return texto(TXT.yaCerrado);
  }
}

/** La repregunta con encuadre mas claro cuando lo que llego no se pudo leer. */
function repregunta(state: NavigateState, motivo: Motivo): Salida {
  if (motivo !== "no_leido") return preguntaPendiente(state);
  switch (state.paso) {
    case "sector": return menuSectores(TXT.sectorRepite);
    case "triada_orden": return repreguntaTriada(triadaActual(state).tri, TXT.noSeguiTriada);
    default: return preguntaPendiente(state);
  }
}

const PREFIJO: Record<Motivo, string | undefined> = {
  vacio: TXT.noLlegoTexto,
  boton: TXT.botonViejo,
  pregunta: TXT.quienSoy,
  no_leido: undefined,
};

function fallaLectura(state: NavigateState, motivo: Motivo): Resultado {
  if (!sumarIntento(state)) return resultado(state, [prefijar(PREFIJO[motivo], repregunta(state, motivo))]);
  return sinLectura(state);
}

/** Se agotaron los intentos del paso: se resuelve SIN lectura y se sigue. Nunca se rellena. */
function sinLectura(state: NavigateState): Resultado {
  switch (state.paso) {
    case "idioma":
      // Dos mensajes sin un idioma legible: se sigue en espanol, el unico del instrumento, y
      // queda dicho. `idioma_elegido` se queda vacio porque la persona no eligio.
      nota(state, "no se pudo leer el idioma; se siguio en espanol, el unico del instrumento");
      return confirmarIdioma(state);
    case "consentimiento": return cerrarSinGuardar(state, TXT.consentimientoAdios);
    case "poblacion":
      // No se puede dejar a la persona atascada en una demo; queda dicho en provenance.
      nota(state, "no se pudo leer si es observador: se asumio panel ciudadano");
      return fijarPoblacion(state, "ciudadano");
    case "sector":
      nota(state, "no se pudo leer el sector: queda sin sector");
      return fijarSector(state, null);
    case "historia":
      // Sin historia no hay Capa A que ubicar: se cierra con lo que haya (nada, si no hubo historia).
      return salir(state);
    case "idioma_no_es": return cerrarSinGuardar(state, TXT.trilingueAdios);
    case "triada_orden":
      return cerrarTriada(state, { intensidad: null, confirmado: false, nota: "no se pudo leer un orden tras dos intentos", sinResolver: true });
    case "triada_segundo": {
      const { tri, ec } = triadaActual(state);
      ec.segundo = null;
      ec.notas.push("no se pudo leer el segundo polo: queda sin ordenar");
      state.paso = "triada_confirmar";
      return resultado(state, [ecoOrden(tri, ec)]);
    }
    case "triada_confirmar":
      return cerrarTriada(state, { intensidad: null, confirmado: false, nota: "corrigio dos veces sin llegar a un orden avalado", sinResolver: true });
    case "triada_intensidad":
      return cerrarTriada(state, { intensidad: null, confirmado: true, nota: "orden confirmado; la graduacion no se pudo leer: resolucion gruesa" });
    case "diada_abrir":
    case "diada_aclarar":
      return cerrarDiada(state, { confirmado: false, nota: "no se pudo leer un ancla tras dos intentos", sinResolver: true });
    case "diada_confirmar":
      return cerrarDiada(state, { confirmado: false, nota: "corrigio dos veces sin avalar un ancla", sinResolver: true });
    case "cerrado": return resultado(state, []);
  }
}

/** Negativa explicita ("paso", "no quiero responder"): no se insiste. */
function declinar(state: NavigateState): Resultado {
  switch (state.paso) {
    case "idioma":
    case "consentimiento": return cerrarSinGuardar(state, TXT.rechazo);
    case "poblacion":
      nota(state, "declino decir si es observador: se asumio panel ciudadano");
      return fijarPoblacion(state, "ciudadano");
    case "sector":
      nota(state, "declino decir el sector");
      return fijarSector(state, null);
    case "historia":
      // Sin historia no se puede seguir: se explica una vez; a la segunda se cierra.
      if (sumarIntento(state)) return salir(state);
      return resultado(state, [prefijar(TXT.sinHistoria, texto(APERTURA[state.poblacion ?? "ciudadano"]))]);
    case "idioma_no_es": return cerrarSinGuardar(state, TXT.trilingueAdios);
    case "triada_orden":
    case "triada_segundo":
    case "triada_confirmar":
      if (state.en_curso) state.en_curso.turnos += 1;
      return cerrarTriada(state, { intensidad: null, confirmado: false, nota: "declino responder", sinResolver: true, declinado: true });
    case "triada_intensidad":
      if (state.en_curso) state.en_curso.turnos += 1;
      return cerrarTriada(state, { intensidad: null, confirmado: true, nota: "orden confirmado; declino graduar: resolucion gruesa" });
    case "diada_abrir":
    case "diada_aclarar":
    case "diada_confirmar":
      if (state.en_curso) state.en_curso.turnos += 1;
      return cerrarDiada(state, { confirmado: false, nota: "declino responder", declinado: true });
    case "cerrado": return resultado(state, []);
  }
}

// ---- Dimensiones ------------------------------------------------------------------------

const posicionTriada = (state: NavigateState): number => state.secuencia.slice(0, state.indice).filter(esTriada).length;
const posicionDiada = (state: NavigateState): number => state.secuencia.slice(0, state.indice).filter((d) => !esTriada(d)).length;
const esUltimaDimension = (state: NavigateState): boolean => state.indice === state.secuencia.length - 1;

function abrirDimension(state: NavigateState): Salida[] {
  const id = state.secuencia[state.indice];
  if (!id) return [];
  if (esTriada(id)) {
    state.en_curso = { tipo: "triada", turnos: 0, dominante: null, segundo: null, solo_uno: false, especial: null, correcciones: 0, reintentos: 0, notas: [] };
    state.paso = "triada_orden";
    return [preguntaTriada(TRIADAS[id], posicionTriada(state), state.historia)];
  }
  state.en_curso = { tipo: "diada", turnos: 0, ancla: null, especial: null, ofrecidas: [], correcciones: 0, reintentos: 0, notas: [] };
  state.paso = "diada_abrir";
  return [preguntaDiada(DIADAS[id], posicionDiada(state), esUltimaDimension(state))];
}

function triadaActual(state: NavigateState): { id: DimensionId; tri: TriadaNav; ec: TriadaEnCurso } {
  const id = state.secuencia[state.indice];
  if (!id || !esTriada(id) || state.en_curso?.tipo !== "triada") throw new Error(`estado navigate incoherente: ${state.paso} sin triada en curso`);
  return { id, tri: TRIADAS[id], ec: state.en_curso };
}

function diadaActual(state: NavigateState): { id: DimensionId; dia: DiadaNav; ec: DiadaEnCurso } {
  const id = state.secuencia[state.indice];
  if (!id || esTriada(id) || state.en_curso?.tipo !== "diada") throw new Error(`estado navigate incoherente: ${state.paso} sin diada en curso`);
  return { id, dia: DIADAS[id], ec: state.en_curso };
}

// ---- Lectura determinista de la triada: botones y numeros, antes del modelo ---------------
//
// Un boton tocado o un texto que sea SOLO numeros de polo ("1", "el 2", "1 y 3", "2 y luego 1",
// "primero 2 despues 1") es una eleccion explicita: se resuelve sin el lector y, si el orden
// completo salio de ahi, sin eco ni confirmacion (la persona ya eligio, no hay interpretacion
// que avalar). Todo lo demas es texto libre y sigue el camino del modelo.

// Palabras que pueden acompanar a los numeros sin cambiar el sentido. "o" NO esta: "1 o 2" es
// una duda, no un orden. Sobre texto normalizado (sin tildes ni signos).
const RELLENO_NUMEROS = new Set([
  "el", "la", "los", "las", "lo", "y", "e", "luego", "despues", "entonces", "primero", "primera",
  "segundo", "segunda", "tercero", "tercera", "de", "en", "lugar", "numero", "num", "opcion",
]);

/** Numeros de polo (1-3) en el orden en que se escribieron, o null si el texto trae algo mas. */
export function leerNumerosTriada(n: string): number[] | null {
  if (!n) return null;
  const nums: number[] = [];
  for (const crudo of n.split(" ")) {
    const tok = crudo.replace(/^#/, "").replace(/[º°]$/, "");
    if (tok === "1" || tok === "2" || tok === "3") {
      const k = Number(tok);
      if (!nums.includes(k)) nums.push(k);
      continue;
    }
    if (RELLENO_NUMEROS.has(tok)) continue;
    return null;
  }
  return nums.length ? nums : null;
}

const indiceDeBotonTriada = (boton: string | undefined): number | null => {
  const i = boton ? (TRI_IDS as readonly string[]).indexOf(boton) : -1;
  return i >= 0 ? i : null;
};

const dominanteExplicito = (ec: TriadaEnCurso): boolean => ec.dominante_por === "boton" || ec.dominante_por === "numero";

/** Orden explicito al abrir la triada: un boton da el dominante; los numeros dan dominante y, si hay dos, segundo. */
function ordenExplicito(n: string, boton: string | undefined): { dominante: number; segundo: number | null; fuente: FuenteLectura } | null {
  const porBoton = indiceDeBotonTriada(boton);
  if (porBoton !== null) return { dominante: porBoton, segundo: null, fuente: "boton" };
  const nums = leerNumerosTriada(n);
  if (!nums) return null;
  return { dominante: nums[0] - 1, segundo: nums.length >= 2 ? nums[1] - 1 : null, fuente: "numero" };
}

/**
 * Segundo lugar explicito. Devuelve la misma forma que el lector para que el caso se resuelva
 * por un solo camino. `claro: false` con fuente = un numero que no sirve (el propio dominante,
 * o varios que no empiezan por el): se repregunta sin gastar lector. null = no era explicito.
 */
function segundoExplicito(
  n: string, boton: string | undefined, dominante: number,
): { claro: boolean; segundo: 0 | 1 | 2 | null; ninguno: boolean; fuente: FuenteLectura } | null {
  if (boton === BOTON.triNinguno) return { claro: true, segundo: null, ninguno: true, fuente: "boton" };
  const porBoton = indiceDeBotonTriada(boton);
  if (porBoton !== null) {
    return porBoton === dominante
      ? { claro: false, segundo: null, ninguno: false, fuente: "boton" }
      : { claro: true, segundo: porBoton as 0 | 1 | 2, ninguno: false, fuente: "boton" };
  }
  const nums = leerNumerosTriada(n);
  if (!nums) return null;
  let k: number | null = null;
  if (nums.length === 1 && nums[0] - 1 !== dominante) k = nums[0] - 1;
  else if (nums.length === 2 && nums[0] - 1 === dominante && nums[1] - 1 !== dominante) k = nums[1] - 1; // "2 y 1" repitiendo al dominante
  return k === null
    ? { claro: false, segundo: null, ninguno: false, fuente: "numero" }
    : { claro: true, segundo: k as 0 | 1 | 2, ninguno: false, fuente: "numero" };
}

// "claramente el 2", "clarisimo el 1": el numero es el polo.
const CLARAMENTE_N = /\bclar(?:amente|o|isimo) (?:el |la )?([123])\b/;

/**
 * En el turno de peso un numero es un polo. Solo el del dominante tiene lectura ("fue
 * claramente el 2" = claramente el primero); otro numero seria reordenar, y eso no se
 * fabrica: se repregunta. null = no hablo con numeros, que lo lea el modelo.
 */
function intensidadExplicita(n: string, dominante: number): "claramente" | "otro" | null {
  const m = CLARAMENTE_N.exec(n);
  const nums = leerNumerosTriada(n) ?? (m ? [Number(m[1])] : null);
  if (!nums) return null;
  return nums.length === 1 && nums[0] - 1 === dominante ? "claramente" : "otro";
}

async function leerOrden(state: NavigateState, t: string, n: string, boton: string | undefined, interprete: Interprete): Promise<Resultado> {
  const { tri, ec } = triadaActual(state);
  ec.turnos += 1;
  const explicito = ordenExplicito(n, boton);
  if (explicito) {
    ec.especial = null;
    ec.solo_uno = false;
    ec.dominante = explicito.dominante;
    ec.dominante_por = explicito.fuente;
    ec.segundo = explicito.segundo;
    ec.notas.push(`orden: ${explicito.fuente}`);
    if (explicito.segundo === null) {
      state.paso = "triada_segundo";
      return resultado(state, [preguntaSegundo(tri, explicito.dominante)]);
    }
    // Dominante y segundo escritos con numeros: nada que confirmar, directo al peso.
    ec.notas.push(`segundo: ${explicito.fuente}`);
    state.paso = "triada_intensidad";
    return resultado(state, [preguntaIntensidad(tri, ec)]);
  }
  const r = await interprete.triada(tri, t);
  if (!r.claro) {
    ec.reintentos += 1;
    if (ec.reintentos < MAX_REINTENTOS) return resultado(state, [repreguntaTriada(tri, TXT.noSeguiTriada)]);
    return cerrarTriada(state, { intensidad: null, confirmado: false, nota: "no se pudo leer un orden tras dos intentos", sinResolver: true });
  }
  ec.especial = r.especial;
  ec.dominante = r.dominante;
  ec.dominante_por = "texto";
  ec.segundo = r.segundo;
  ec.solo_uno = r.solo_uno;
  ec.notas.push("orden: texto");
  if (!r.especial && r.dominante !== null && r.segundo === null && !r.solo_uno) {
    // Nombro uno solo sin excluir a los otros: se pide el segundo (un turno, sin insistir).
    state.paso = "triada_segundo";
    ec.notas.push("nombro un solo polo; se pidio el segundo");
    return resultado(state, [preguntaSegundo(tri, r.dominante)]);
  }
  if (!r.especial && !r.solo_uno) ec.notas.push("ordeno dos polos espontaneamente; residual inferido");
  state.paso = "triada_confirmar";
  return resultado(state, [ecoOrden(tri, ec)]);
}

function cerrarTriada(
  state: NavigateState,
  o: { intensidad: RegistroTriada["intensity_label"]; confirmado: boolean; nota: string; sinResolver?: boolean; declinado?: boolean },
): Resultado {
  const { id, tri, ec } = triadaActual(state);
  const salidas: Salida[] = [];
  let reg: RegistroTriada;

  if (o.sinResolver || ec.especial) {
    reg = {
      dimension_id: id,
      poles: tri.polos,
      dominant: null,
      second: null,
      residual: null,
      intensity_label: null,
      composition: null,
      resolution_captured: "coarse",
      confirmed_by_participant: o.confirmado,
      special_case: o.sinResolver ? "unresolved" : ec.especial,
      declinado: !!o.declinado,
      elicitation_turns: ec.turnos,
      reflexivity_note: [...ec.notas, o.nota].join("; "),
    };
    salidas.push(texto(o.declinado ? TXT.declino : o.sinResolver ? TXT.sinUbicar : TXT.guardoAsi));
  } else {
    const dom = ec.dominante!;
    const sec = ec.segundo;
    const intens = o.intensidad ? INTENSIDADES.find((x) => x.label === o.intensidad) ?? null : null;
    const reparto = o.intensidad === "solo_uno" ? REPARTO_SOLO_UNO : intens ? intens.reparto : null;
    const alta = reparto !== null;
    const residual = sec === null ? null : tri.polos[[0, 1, 2].find((i) => i !== dom && i !== sec)!];
    reg = {
      dimension_id: id,
      poles: tri.polos,
      dominant: tri.polos[dom],
      second: sec === null ? null : tri.polos[sec],
      residual,
      intensity_label: o.intensidad,
      composition: composicion(dom, sec, reparto),
      resolution_captured: alta ? "high" : "coarse",
      confirmed_by_participant: o.confirmado,
      special_case: null,
      declinado: false,
      elicitation_turns: ec.turnos,
      reflexivity_note: [...ec.notas, o.nota].join("; "),
    };
    if (o.intensidad === "solo_uno") {
      salidas.push(texto(`Listo. Lo guardo así: *${reg.dominant}*, y lo demás al margen.`));
    } else if (sec === null) {
      salidas.push(texto(`Listo. Lo guardo así: *${reg.dominant}* primero, el resto sin ordenar.`));
    } else if (!alta) {
      salidas.push(texto(`Listo. Lo guardo así: *${reg.dominant}* primero y *${reg.second}* segundo, sin graduar.`));
    } else {
      salidas.push(texto(`Listo. Lo guardo así: *${reg.dominant}* fue lo principal, *${reg.second}* acompañó, y *${reg.residual}* quedó al margen.`));
    }
  }
  state.dimensiones[id] = reg;
  return avanzar(state, salidas);
}

async function leerDiada(state: NavigateState, t: string, interprete: Interprete): Promise<Resultado> {
  const { dia, ec } = diadaActual(state);
  ec.turnos += 1;
  const r = await interprete.diada(dia, t);
  if (r.claro) {
    aplicarLecturaDiada(ec, r);
    state.paso = "diada_confirmar";
    return resultado(state, [ecoDiada(dia, ec)]);
  }
  ec.reintentos += 1;
  if (ec.reintentos >= MAX_REINTENTOS) {
    return cerrarDiada(state, { confirmado: false, nota: "no se pudo leer un ancla tras dos intentos", sinResolver: true });
  }
  // No se leyo un ancla: se despliegan las anclas como menu. Si insinuo un lado, SOLO las de
  // ese lado; si no (matizo sin lado, o no hablo de los polos), las intermedias.
  ec.ofrecidas = r.lado === "izq" ? [2, 1, 3] : r.lado === "der" ? [4, 5, 3] : [2, 3, 4, "both_intense"];
  ec.notas.push(r.lado ? `matizo hacia ${r.lado}; se ofrecieron las anclas de ese lado` : "no se leyo un lado; se ofrecieron las intermedias");
  state.paso = "diada_aclarar";
  return resultado(state, [menuAclaracion(dia, ec)]);
}

function aplicarLecturaDiada(ec: DiadaEnCurso, r: { ancla: 1 | 2 | 3 | 4 | 5 | null; especial: Ancla["special_case"] }): void {
  if (r.especial && r.especial !== "middle") {
    ec.especial = r.especial;
    ec.ancla = null;
    return;
  }
  ec.ancla = r.ancla ?? 3;
  ec.especial = ec.ancla === 3 ? "middle" : null;
}

function cerrarDiada(state: NavigateState, o: { confirmado: boolean; nota: string; sinResolver?: boolean; declinado?: boolean }): Resultado {
  const { id, dia, ec } = diadaActual(state);
  const anclas = anclasDe(dia);
  const base = { dyad_id: id, poles: [dia.izq, dia.der] as [string, string], elicitation_turns: ec.turnos, reflexivity_note: [...ec.notas, o.nota].join("; ") };
  let reg: RegistroDiada;
  if (o.declinado) {
    // Fuera del eje, como pide la spec de diadas para lo que no aplica; la marca `declinado`
    // lo separa de "ninguna de las dos me aplica".
    reg = { ...base, anchor_label: null, anchor_text: null, value: null, special_case: "not_applicable", resolution_captured: "coarse", confirmed_by_participant: false, declinado: true };
  } else if (o.sinResolver) {
    reg = { ...base, anchor_label: null, anchor_text: null, value: null, special_case: "unresolved", resolution_captured: "coarse", confirmed_by_participant: false, declinado: false };
  } else if (ec.especial && ec.especial !== "middle") {
    reg = {
      ...base, anchor_label: null, anchor_text: ESPECIALES_FUERA_DEL_EJE[ec.especial], value: null,
      special_case: ec.especial, resolution_captured: "high", confirmed_by_participant: o.confirmado, declinado: false,
    };
  } else {
    const a = anclas.find((x) => x.posicion === ec.ancla)!;
    reg = {
      ...base, anchor_label: a.label, anchor_text: a.texto, value: a.value,
      special_case: a.special_case, resolution_captured: "high", confirmed_by_participant: o.confirmado, declinado: false,
    };
  }
  state.dimensiones[id] = reg;
  return avanzar(state, [texto(o.declinado ? TXT.declino : o.sinResolver ? TXT.sinUbicar : TXT.guardoAsi)]);
}

/** Pasa a la siguiente dimension o cierra. `salidas` son los mensajes que ya toca mandar. */
function avanzar(state: NavigateState, salidas: Salida[]): Resultado {
  state.en_curso = undefined;
  state.indice += 1;
  if (state.indice < state.secuencia.length) {
    return resultado(state, [...salidas, ...abrirDimension(state)]);
  }
  state.paso = "cerrado";
  state.closed = true;
  return resultado(state, [...salidas, texto(`${TXT.cierre}\n\n${resumen(state)}`)], "guardar_y_cerrar");
}

// ---- Cierre y persistencia --------------------------------------------------------------

function salir(state: NavigateState): Resultado {
  const hayDatos = !!state.consent && (!!state.historia || Object.keys(state.dimensiones).length > 0);
  state.closed = true;
  state.paso = "cerrado";
  if (!hayDatos) return resultado(state, [texto(TXT.salidaSinDatos)], "cerrar_sin_guardar");
  return resultado(state, [texto(TXT.salidaConDatos)], "guardar_y_cerrar");
}

function cerrarSinGuardar(state: NavigateState, mensaje: string): Resultado {
  state.closed = true;
  state.paso = "cerrado";
  return resultado(state, [texto(mensaje)], "cerrar_sin_guardar");
}

/** Lo capturado, en palabras, para mostrarlo al cerrar (Saga §2: se muestra la fila, no el punto en el mapa). */
export function resumen(state: NavigateState): string {
  const lineas: string[] = [];
  if (state.poblacion) lineas.push(`• Responde como: ${state.poblacion === "experto" ? "observador de su sector" : "panel ciudadano"}`);
  if (state.sector) lineas.push(`• Sector: ${etiquetaSector(state.sector)}`);
  for (const id of state.secuencia) {
    const reg = state.dimensiones[id];
    if (!reg) continue;
    if ("dimension_id" in reg) {
      const tri = TRIADAS[id as keyof typeof TRIADAS];
      let v: string;
      if (reg.declinado) v = "no quiso responder";
      else if (reg.special_case === "unresolved") v = "sin ubicar";
      else if (reg.special_case) v = ESPECIALES_FUERA_DEL_EJE[reg.special_case];
      else if (reg.intensity_label === "solo_uno") v = `solo ${reg.dominant}`;
      else if (reg.second === null) v = `${reg.dominant} primero`;
      else {
        const intens = INTENSIDADES.find((x) => x.label === reg.intensity_label);
        v = `${reg.dominant} › ${reg.second}${intens ? ` (${intens.texto})` : " (sin graduar)"}`;
      }
      lineas.push(`• ${preguntaMostrada(tri)}: ${v}`);
    } else {
      const dia = DIADAS[id as keyof typeof DIADAS];
      const v = reg.declinado ? "no quiso responder" : reg.special_case === "unresolved" ? "sin ubicar" : reg.anchor_text ?? "";
      lineas.push(`• ${dia.izq} ↔ ${dia.der}: ${v}`);
    }
  }
  return lineas.join("\n");
}

/** Payload que se guarda en `cardumen_respuestas.payload` (formato §3 de las dos specs). */
export function armarPayload(state: NavigateState, salida: "completa" | "salir" | "expirada", ahora: string): Record<string, unknown> {
  const capaA: Record<string, RegistroTriada | RegistroDiada> = {};
  for (const id of state.secuencia) {
    const reg = state.dimensiones[id];
    if (reg) capaA[id] = reg;
  }
  return {
    source: "chat",
    motor: "navigate",
    demo: true,
    study_id: state.study_id,
    collection_mode: "panel_recurrente",
    poblacion: state.poblacion ?? null,
    sector: state.sector ?? null,
    idioma: state.idioma,
    idioma_elegido: state.idioma_elegido ?? null,
    idioma_detectado: state.idioma_detectado ?? null,
    idioma_confirmado: state.idioma_confirmado,
    consent: state.consent ?? null,
    narrative: { historia: state.historia ?? null },
    capaA,
    provenance: {
      turns: state.turnos,
      started_at: state.started_at,
      closed_at: ahora,
      completa: salida === "completa",
      salida,
      dimensiones_capturadas: Object.keys(capaA).length,
      dimensiones_esperadas: state.secuencia.length,
      notas: state.notas ?? [],
      raw_history: state.historial,
    },
  };
}
