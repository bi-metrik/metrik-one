// Navigate — motor determinista de la conversacion.
//
// Todo lo que la persona VE lo arma este archivo con los literales del instrumento: turno
// cero (consentimiento de demo, poblacion, sector), deteccion y confirmacion de idioma,
// triadas en "reparto en dos tiempos" (elicitacion-resolucion-yuto.md §1-2) y diadas en
// "un turno, cinco anclas" (elicitacion-diadas-yuto.md §2-3). El modelo entra SOLO por el
// `Interprete`, para leer texto libre; nunca redacta, nunca traduce, nunca propone.
//
// Es una funcion de (estado, entrada) -> (estado, mensajes, accion). No toca red ni base:
// eso lo hace `index.ts`. Asi se prueba de punta a punta sin modelo ni WhatsApp.
//
// Registro: la persona se trata de USTED, como en la muestra que ve el cliente (Guatemala).
// El guard de espanol neutro (`es-neutro.ts`) solo corrige voseo, asi que no interfiere.

import {
  APERTURA, DIADAS, ESPECIALES_FUERA_DEL_EJE, INTENSIDADES, REPARTO_SOLO_UNO, SECTORES, SECUENCIA, TRIADAS,
  anclasDe, composicion, esTriada, etiquetaSector, preguntaMostrada,
} from "./instrumento.ts";
import type { Ancla, DiadaNav, DimensionId, Poblacion, TriadaNav } from "./instrumento.ts";
import { detectarIdioma } from "./idioma.ts";
import { normalizarTexto } from "./interprete.ts";
import type {
  Accion, DiadaEnCurso, Entrada, Interprete, NavigateState, RegistroDiada, RegistroTriada, Resultado, Salida, TriadaEnCurso,
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
  langSi: "nav_lang_si",
  langOtro: "nav_lang_otro",
  langNo: "nav_lang_no",
  si: "nav_si",
  corrijo: "nav_corrijo",
  intParejos: "nav_int_parejos",
  intManda: "nav_int_manda",
  intClaro: "nav_int_claro",
} as const;

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
  idiomaConfirmar: "Gracias por contarlo. Seguimos en español, ¿le parece?",
  trilingue:
    "ES: Por ahora este instrumento está disponible solo en español. ¿Quiere continuar en español?\n\n" +
    "EN: For now this instrument is available in Spanish only. Would you like to continue in Spanish?\n\n" +
    "PT: Por enquanto este instrumento está disponível apenas em espanhol. Quer continuar em espanhol?",
  trilingueAdios:
    "ES: Entendido. Gracias por su tiempo.\nEN: Understood. Thank you for your time.\nPT: Entendido. Obrigado pelo seu tempo.",
  corrijaConSusPalabrasTriada: "Dígamelo con sus palabras: ¿cuáles dos pesaron más, y en qué orden?",
  noSeguiTriada: "No le alcancé a seguir. Dígame cuál de las tres pesó más, y cuál iría en segundo lugar.",
  guardoAsi: "Listo, lo guardo así.",
  salidaConDatos: "Gracias por lo que alcanzó a compartir. Quedó guardado como prueba de demostración.",
  salidaSinDatos: "Listo, no guardamos nada.",
  alBorrar: "Hecho: borré lo que había compartido y cerré la conversación. Si quiere empezar de nuevo, escriba *cardumen*.",
  cierre:
    "Gracias, eso era todo.\n\nLo que respondió quedó guardado *como prueba de demostración*: no entra en ningún estudio ni se comparte.\n\n" +
    "Esto es lo que quedó registrado, con sus palabras:",
};

// Variar la entrada rompe la monotonia de repetir la misma mecanica (spec de triadas §4.2).
// La posicion es entre las de su misma clase (primera triada, segunda diada...), no en la
// secuencia completa.
const INTRO_TRIADA = ["Pensando en lo que me contó, ", "Sobre eso mismo: ", "Una más sobre lo que contó. "];
const INTRO_DIADA = ["Una cosa más sobre lo que contó.", "Y otra:", "Y una más:"];
const INTRO_ULTIMA = "Por último:";

const texto = (t: string): Salida => ({ tipo: "texto", texto: t });
const botones = (t: string, b: Array<{ id: string; title: string }>): Salida => ({ tipo: "botones", texto: t, botones: b });
const botonesSiNo = (t: string): Salida =>
  botones(t, [{ id: BOTON.si, title: "Sí, así" }, { id: BOTON.corrijo, title: "No, corrijo" }]);

function menuSectores(encabezado: string): Salida {
  const filas = SECTORES.map((s, i) => `${i + 1}. ${etiquetaSector(s)}`).join("\n");
  return texto(`${encabezado}\n\n${filas}\n\nResponda con el número.`);
}

function preguntaTriada(t: TriadaNav, posicion: number): Salida {
  const intro = INTRO_TRIADA[Math.min(posicion, INTRO_TRIADA.length - 1)];
  return texto(
    `*${preguntaMostrada(t)}.* ${intro}se cruzan tres cosas: *${t.polos[0]}*, *${t.polos[1]}* o *${t.polos[2]}*. ¿Cuáles dos pesaron más, y en qué orden?`,
  );
}

function preguntaDiada(d: DiadaNav, posicion: number, esUltima: boolean): Salida {
  const intro = esUltima ? INTRO_ULTIMA : INTRO_DIADA[Math.min(posicion, INTRO_DIADA.length - 1)];
  return texto(`${intro} ¿Siente que *${d.izq}*, o que *${d.der}*?`);
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

function preguntaIntensidad(t: TriadaNav, ec: TriadaEnCurso, corta = false): Salida {
  const dom = t.polos[ec.dominante!];
  const sec = t.polos[ec.segundo!];
  const cuerpo = corta
    ? `¿*Casi parejos*, *uno mandaba pero el otro contaba*, o *fue claramente ${dom}*?`
    : `Una última de esta parte. Entre *${dom}* y *${sec}*, ¿iban *casi parejos*, *uno mandaba pero el otro contaba*, o *fue claramente ${dom}*?`;
  return botones(cuerpo, [
    { id: BOTON.intParejos, title: "Casi parejos" },
    { id: BOTON.intManda, title: "Uno mandaba" },
    { id: BOTON.intClaro, title: "Claramente el 1º" },
  ]);
}

function textoAncla(d: DiadaNav, ec: DiadaEnCurso): string {
  if (ec.especial && ec.especial !== "middle") return ESPECIALES_FUERA_DEL_EJE[ec.especial];
  const a = anclasDe(d).find((x) => x.posicion === ec.ancla);
  return a ? a.texto : "";
}

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
    paso: "consentimiento",
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
  const salidas = [botones(TXT.consentimiento, [{ id: BOTON.ok, title: "OK" }])];
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

// ---- Procesar un mensaje de la persona -------------------------------------------------

export async function procesar(state: NavigateState, entrada: Entrada, interprete: Interprete): Promise<Resultado> {
  const t = (entrada.texto || "").trim();
  const n = normalizarTexto(t);
  const boton = entrada.botonId;
  state.turnos += 1;
  state.historial.push({ role: "persona", text: t });

  // Salidas globales. BORRAR vale en cualquier momento, incluso antes del consentimiento.
  if (ERASE.has(n)) {
    state.closed = true;
    state.paso = "cerrado";
    return resultado(state, [texto(TXT.alBorrar)], "borrar");
  }
  if (EXIT.has(n)) return salir(state);

  const esSi = boton === BOTON.ok || boton === BOTON.si || boton === BOTON.expSi || boton === BOTON.langSi || SI.has(n);
  const esNo = boton === BOTON.no || boton === BOTON.corrijo || boton === BOTON.expNo || boton === BOTON.langNo || NO.has(n);

  switch (state.paso) {
    case "consentimiento": {
      if (esSi) {
        state.consent = { version: CONSENT_VERSION, granted_at: new Date().toISOString() };
        state.paso = "poblacion";
        state.reintentos = 0;
        return resultado(state, [botones(TXT.poblacion, [{ id: BOTON.expSi, title: "Sí, observador" }, { id: BOTON.expNo, title: "No" }])]);
      }
      if (esNo) return cerrarSinGuardar(state, TXT.rechazo);
      state.reintentos += 1;
      if (state.reintentos >= MAX_REINTENTOS) return cerrarSinGuardar(state, TXT.consentimientoAdios);
      return resultado(state, [botones(TXT.consentimientoRepite, [{ id: BOTON.ok, title: "OK" }])]);
    }

    case "poblacion": {
      let poblacion: Poblacion | null = null;
      if (boton === BOTON.expSi || /\b(observador|experto|experta)\b/.test(n) || (esSi && !esNo)) poblacion = "experto";
      else if (boton === BOTON.expNo || /\bciudadan/.test(n) || esNo) poblacion = "ciudadano";
      if (poblacion === null) {
        state.reintentos += 1;
        if (state.reintentos < MAX_REINTENTOS) {
          return resultado(state, [botones(TXT.poblacionRepite, [{ id: BOTON.expSi, title: "Sí, observador" }, { id: BOTON.expNo, title: "No" }])]);
        }
        poblacion = "ciudadano"; // no se puede dejar a la persona atascada en una demo; queda dicho en provenance
      }
      state.poblacion = poblacion;
      state.secuencia = [...SECUENCIA[poblacion]];
      state.paso = "sector";
      state.reintentos = 0;
      return resultado(state, [menuSectores(TXT.sector)]);
    }

    case "sector": {
      const sector = leerSector(n);
      if (sector === null) {
        state.reintentos += 1;
        if (state.reintentos < MAX_REINTENTOS) return resultado(state, [menuSectores(TXT.sectorRepite)]);
        state.sector = null;
      } else {
        state.sector = sector;
      }
      state.paso = "historia";
      state.reintentos = 0;
      return resultado(state, [texto(APERTURA[state.poblacion!])]);
    }

    case "historia": {
      state.historia = t;
      state.idioma_detectado = detectarIdioma(t);
      if (state.idioma_detectado === "en" || state.idioma_detectado === "pt") {
        state.paso = "idioma_no_es";
        return resultado(state, [botones(TXT.trilingue, [{ id: BOTON.langSi, title: "Sí / Yes / Sim" }, { id: BOTON.langNo, title: "No" }])]);
      }
      state.paso = "idioma_confirmar";
      return resultado(state, [botones(TXT.idiomaConfirmar, [{ id: BOTON.langSi, title: "Sí, en español" }, { id: BOTON.langOtro, title: "Otro idioma" }])]);
    }

    case "idioma_confirmar": {
      if (esSi && boton !== BOTON.langOtro) return confirmarIdioma(state);
      state.paso = "idioma_no_es";
      return resultado(state, [botones(TXT.trilingue, [{ id: BOTON.langSi, title: "Sí / Yes / Sim" }, { id: BOTON.langNo, title: "No" }])]);
    }

    case "idioma_no_es": {
      if (esSi) return confirmarIdioma(state);
      if (esNo) return cerrarSinGuardar(state, TXT.trilingueAdios);
      state.reintentos += 1;
      if (state.reintentos >= MAX_REINTENTOS) return cerrarSinGuardar(state, TXT.trilingueAdios);
      return resultado(state, [botones(TXT.trilingue, [{ id: BOTON.langSi, title: "Sí / Yes / Sim" }, { id: BOTON.langNo, title: "No" }])]);
    }

    case "triada_orden":
      return await leerOrden(state, t, interprete);

    case "triada_segundo": {
      const { tri, ec } = triadaActual(state);
      ec.turnos += 1;
      const r = await interprete.segundo(tri, ec.dominante!, t);
      if (r.claro && r.ninguno) {
        ec.solo_uno = true;
        ec.segundo = null;
        ec.notas.push("dijo que ningun otro polo peso");
      } else if (r.claro && r.segundo !== null) {
        ec.segundo = r.segundo;
      } else {
        ec.reintentos += 1;
        if (ec.reintentos < MAX_REINTENTOS) {
          const otros = [0, 1, 2].filter((i) => i !== ec.dominante);
          return resultado(state, [texto(`¿Cuál iría en segundo lugar: *${tri.polos[otros[0]]}* o *${tri.polos[otros[1]]}*? Si ninguno, dígame *ninguno*.`)]);
        }
        ec.segundo = null;
        ec.notas.push("no se pudo leer el segundo polo: queda sin ordenar");
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
      if (esNo) {
        state.paso = "triada_orden";
        return resultado(state, [texto(TXT.corrijaConSusPalabrasTriada)]);
      }
      // Corrigio con contenido ("no, primero X"): se lee como un orden nuevo.
      ec.notas.push("corrigio el eco con sus palabras");
      state.paso = "triada_orden";
      return await leerOrden(state, t, interprete);
    }

    case "triada_intensidad": {
      const { tri, ec } = triadaActual(state);
      ec.turnos += 1;
      let etiqueta = boton === BOTON.intParejos
        ? "casi_parejos" as const
        : boton === BOTON.intManda
          ? "uno_manda_otro_cuenta" as const
          : boton === BOTON.intClaro
            ? "claramente_el_primero" as const
            : null;
      if (etiqueta === null) {
        const r = await interprete.intensidad(tri.polos[ec.dominante!], tri.polos[ec.segundo!], t);
        if (r.etiqueta === "no_gradua") {
          return cerrarTriada(state, { intensidad: null, confirmado: true, nota: "orden confirmado; no quiso graduar: resolucion gruesa" });
        }
        etiqueta = r.etiqueta;
      }
      if (etiqueta === null) {
        ec.reintentos += 1;
        if (ec.reintentos < MAX_REINTENTOS) return resultado(state, [preguntaIntensidad(tri, ec, true)]);
        return cerrarTriada(state, { intensidad: null, confirmado: true, nota: "orden confirmado; la graduacion no se pudo leer: resolucion gruesa" });
      }
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
        return resultado(state, [botonesSiNo(`Lo dejo como *${textoAncla(dia, ec)}*. ¿Así?`)]);
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

    case "cerrado":
    default:
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

function confirmarIdioma(state: NavigateState): Resultado {
  state.idioma_confirmado = true;
  state.reintentos = 0;
  return resultado(state, abrirDimension(state));
}

// ---- Dimensiones ------------------------------------------------------------------------

function abrirDimension(state: NavigateState): Salida[] {
  const id = state.secuencia[state.indice];
  if (!id) return [];
  const previas = state.secuencia.slice(0, state.indice);
  const esUltima = state.indice === state.secuencia.length - 1;
  if (esTriada(id)) {
    state.en_curso = { tipo: "triada", turnos: 0, dominante: null, segundo: null, solo_uno: false, especial: null, correcciones: 0, reintentos: 0, notas: [] };
    state.paso = "triada_orden";
    return [preguntaTriada(TRIADAS[id], previas.filter(esTriada).length)];
  }
  state.en_curso = { tipo: "diada", turnos: 0, ancla: null, especial: null, ofrecidas: [], correcciones: 0, reintentos: 0, notas: [] };
  state.paso = "diada_abrir";
  return [preguntaDiada(DIADAS[id], previas.filter((d) => !esTriada(d)).length, esUltima)];
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

async function leerOrden(state: NavigateState, t: string, interprete: Interprete): Promise<Resultado> {
  const { tri, ec } = triadaActual(state);
  ec.turnos += 1;
  const r = await interprete.triada(tri, t);
  if (!r.claro) {
    ec.reintentos += 1;
    if (ec.reintentos < MAX_REINTENTOS) return resultado(state, [texto(TXT.noSeguiTriada)]);
    return cerrarTriada(state, { intensidad: null, confirmado: false, nota: "no se pudo leer un orden tras dos intentos", sinResolver: true });
  }
  ec.especial = r.especial;
  ec.dominante = r.dominante;
  ec.segundo = r.segundo;
  ec.solo_uno = r.solo_uno;
  if (!r.especial && r.dominante !== null && r.segundo === null && !r.solo_uno) {
    // Nombro uno solo sin excluir a los otros: se pide el segundo (un turno, sin insistir).
    state.paso = "triada_segundo";
    ec.notas.push("nombro un solo polo; se pidio el segundo");
    const otros = [0, 1, 2].filter((i) => i !== r.dominante);
    return resultado(state, [
      texto(`Entendido, *${tri.polos[r.dominante]}* primero. ¿Y en segundo lugar: *${tri.polos[otros[0]]}* o *${tri.polos[otros[1]]}*? Si ninguno, dígame *ninguno*.`),
    ]);
  }
  if (!r.especial && !r.solo_uno) ec.notas.push("ordeno dos polos espontaneamente; residual inferido");
  state.paso = "triada_confirmar";
  return resultado(state, [ecoOrden(tri, ec)]);
}

function cerrarTriada(
  state: NavigateState,
  o: { intensidad: RegistroTriada["intensity_label"]; confirmado: boolean; nota: string; sinResolver?: boolean },
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
      elicitation_turns: ec.turnos,
      reflexivity_note: [...ec.notas, o.nota].join("; "),
    };
    salidas.push(texto(o.sinResolver ? "Lo dejo sin ubicar, no hay problema. Seguimos." : TXT.guardoAsi));
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
    return resultado(state, [botonesSiNo(`Lo dejo como *${textoAncla(dia, ec)}*. ¿Así?`)]);
  }
  ec.reintentos += 1;
  if (ec.reintentos >= MAX_REINTENTOS) {
    return cerrarDiada(state, { confirmado: false, nota: "no se pudo leer un ancla tras dos intentos", sinResolver: true });
  }
  // Matizo sin que quede claro cuanto: se despliegan SOLO las anclas del lado que insinuo.
  ec.ofrecidas = r.lado === "izq" ? [2, 1, 3] : r.lado === "der" ? [4, 5, 3] : [2, 3, 4, "both_intense"];
  ec.notas.push(r.lado ? `matizo hacia ${r.lado}; se ofrecieron las anclas de ese lado` : "matizo sin lado claro; se ofrecieron las intermedias");
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

function cerrarDiada(state: NavigateState, o: { confirmado: boolean; nota: string; sinResolver?: boolean }): Resultado {
  const { id, dia, ec } = diadaActual(state);
  const anclas = anclasDe(dia);
  let reg: RegistroDiada;
  if (o.sinResolver) {
    reg = {
      dyad_id: id, poles: [dia.izq, dia.der], anchor_label: null, anchor_text: null, value: null,
      special_case: "unresolved", resolution_captured: "coarse", confirmed_by_participant: false,
      elicitation_turns: ec.turnos, reflexivity_note: [...ec.notas, o.nota].join("; "),
    };
  } else if (ec.especial && ec.especial !== "middle") {
    reg = {
      dyad_id: id, poles: [dia.izq, dia.der], anchor_label: null, anchor_text: ESPECIALES_FUERA_DEL_EJE[ec.especial], value: null,
      special_case: ec.especial, resolution_captured: "high", confirmed_by_participant: o.confirmado,
      elicitation_turns: ec.turnos, reflexivity_note: [...ec.notas, o.nota].join("; "),
    };
  } else {
    const a = anclas.find((x) => x.posicion === ec.ancla)!;
    reg = {
      dyad_id: id, poles: [dia.izq, dia.der], anchor_label: a.label, anchor_text: a.texto, value: a.value,
      special_case: a.special_case, resolution_captured: "high", confirmed_by_participant: o.confirmado,
      elicitation_turns: ec.turnos, reflexivity_note: [...ec.notas, o.nota].join("; "),
    };
  }
  state.dimensiones[id] = reg;
  return avanzar(state, [texto(o.sinResolver ? "Lo dejo sin ubicar, no hay problema. Seguimos." : TXT.guardoAsi)]);
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
      if (reg.special_case === "unresolved") v = "sin ubicar";
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
      const v = reg.special_case === "unresolved" ? "sin ubicar" : reg.anchor_text ?? "";
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
      raw_history: state.historial,
    },
  };
}
