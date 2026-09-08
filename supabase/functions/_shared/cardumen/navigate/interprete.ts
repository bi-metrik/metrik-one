// Interprete de Navigate: convierte la respuesta LIBRE de la persona en estructura.
//
// Es el unico punto del flujo donde entra el modelo, y entra como lector, no como
// entrevistador: no redacta preguntas, no traduce, no propone repartos. Devuelve JSON con
// indices y banderas; el eco que ve la persona lo arma el motor con los literales del
// instrumento. Reutiliza el adaptador que ya usa el motor R1/R2 (`claudeHaiku`).
//
// Dos capas: primero un lector por palabras (determinista, gratis, cubre los botones y las
// respuestas que repiten la etiqueta); si no alcanza, el modelo.

import type { ModelAdapter } from "../types.ts";
import { parseLooseJSON } from "../json.ts";
import type { DiadaNav, TriadaNav } from "./instrumento.ts";
import type {
  InterpretacionDiada, InterpretacionIntensidad, InterpretacionSegundo, InterpretacionTriada, Interprete,
} from "./tipos.ts";

export function normalizarTexto(t: string): string {
  return (t || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[!¡?¿.,;:"'*_]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Lector por palabras de la etiqueta de peso. Cubre botones y respuestas literales.
 *
 * Corre ANTES del modelo, asi que un falso positivo aqui es una ubicacion fabricada sin que
 * nadie la lea: por eso cada patron es la etiqueta casi literal y no un prefijo. "mi pareja",
 * "el mandato", "les contaba" y un "claro" a secas (que en Colombia es "ok") NO son etiquetas
 * y van al modelo.
 */
export function intensidadPorPalabras(respuesta: string): InterpretacionIntensidad["etiqueta"] {
  const t = normalizarTexto(respuesta);
  if (!t) return null;
  // "No graduo" va primero: "me da igual" contiene "igual" y no es "iban iguales".
  if (/\bno se\b/.test(t) || /\bno sabria\b/.test(t) || /\bda igual\b/.test(t) || /\bno quiero\b/.test(t) || /\bcualquiera\b/.test(t)) return "no_gradua";
  if (/\bparejos?\b/.test(t) || /\biguales\b/.test(t) || /\bpor igual\b/.test(t) || /\bempat(e|ados|adas)\b/.test(t)) return "casi_parejos";
  if (/\buno manda(ba)?\b/.test(t) || /\bmandaba pero\b/.test(t) || /\bel otro (contaba|acompan\w*)\b/.test(t)) return "uno_manda_otro_cuenta";
  // "primero" solo NO alcanza ("no se si el primero"): eso lo lee el modelo. "claro" a secas
  // tampoco: es un "ok". Y "claramente X" solo cuenta cuando X es "el primero": "claramente el
  // clima" nombra algo que no es ninguno de los dos, y eso lo tiene que decidir el modelo, que
  // si sabe cuales son.
  if (/^claramente$/.test(t) || /\b(fue )?clar(amente|o) el (primero|primera|1o|1|uno)\b/.test(t)) return "claramente_el_primero";
  return null;
}

/**
 * Contradicciones literales que no son un orden ni un ancla ("los dos primero", "todos igual").
 * Se atajan por palabras porque un modelo chico las resuelve eligiendo por la persona, que es
 * justo lo que no puede pasar. El motor repregunta con encuadre.
 */
export function contradiccionPorPalabras(respuesta: string): boolean {
  const t = normalizarTexto(respuesta);
  // "los dos primero" (los dos de primeros) si; "los dos primeros son X y Y" es un orden real, no.
  return /^(los|las|ambos|ambas) dos$/.test(t)
    || /\b(los|las) dos (primero|igual|iguales|por igual)\b/.test(t)
    || /\b(ambos|ambas) (primero|igual|por igual)\b/.test(t)
    || /\btod[oa]s (igual|iguales|primero|por igual|parejos)\b/.test(t);
}

/**
 * Un "especial" (no sabe / no aplica / las dos con fuerza) solo se acepta si la respuesta trae
 * evidencia de ESO. Sin esta guarda, un modelo chico usa "not_applicable" como cajon para lo que
 * esta fuera de tema, y una historia de futbol terminaria registrada como "no aplica".
 * "middle" no se comprueba: esta en el eje y pasa por eco + confirmacion como cualquier ancla.
 */
export function evidenciaEspecial(especial: string | null, respuesta: string): boolean {
  if (!especial || especial === "middle") return true;
  const t = normalizarTexto(respuesta);
  if (especial === "dont_know") {
    // "no se" del que no sabe; NO el "no se puede" / "no se nota" impersonal de una historia.
    return /\bno (lo |la )?se\b(?! (puede|pueden|puedo|podia|podria|va|ve|vio|nota|notaba|logra|dio|hizo|ha|han|hace|hacen|sabe|sabia|da|dan|dice|dicen|pasa|pasaba|paso))/.test(t)
      || /\bno (lo |la )?(sabria|sabria decir(le)?|tengo (ni )?idea|estoy segur[oa]|podria decir(le)?)\b/.test(t)
      || /\bni idea\b/.test(t) || /\bquien sabe\b/.test(t);
  }
  if (especial === "not_applicable") {
    return /\bningun[oa]s?\b/.test(t) || /\bnada que ver\b/.test(t) || /\bno aplica\b/.test(t)
      || /\bno tienen? (nada )?que ver\b/.test(t) || /\bno (me )?(corresponde|cabe|encaja)\b/.test(t)
      || /\bno es (mi |el |ese |este )?caso\b/.test(t) || /\bno va con\b/.test(t);
  }
  if (especial === "both_intense") {
    return /\b(las dos|los dos|ambas|ambos|a la vez|al mismo tiempo|las dos cosas)\b/.test(t);
  }
  return true;
}

const REGLAS_LECTOR = `Eres un lector. Recibes lo que una persona respondio en un chat y lo devuelves como JSON.
REGLAS DURAS:
- NO interpretes ni completes: si la persona no lo dijo, no existe. Ante la duda, "claro": false.
- NO inventes un orden que la persona no dio. Un solo polo mencionado NO implica un segundo.
- La persona puede nombrar los polos con otras palabras (parafrasis, sinonimos, ejemplos, otro idioma). Emparejalos por significado, pero solo si es evidente.
- Si la persona NO responde la pregunta — habla de otra cosa, hace una pregunta, se niega, insulta, escribe algo sin sentido, o responde a OTRA pregunta (por ejemplo da un peso cuando se le pidio un orden) — es "claro": false y todo lo demas null/false. No busques la lectura "mas cercana".
- Un polo que NO esta en la lista no se aproxima al mas parecido: "claro": false.
- Si dice cosas contradictorias ("los dos primero", "todos igual"), no elijas por la persona: "claro": false.
- Si la respuesta es larga y divaga, busca dentro de ella una eleccion explicita; si la hay, leela; si no, "claro": false.
- Responde SOLO con el JSON pedido, sin texto alrededor.`;

async function pedirJSON<T>(model: ModelAdapter, system: string, user: string): Promise<T> {
  const llamar = (extra?: string) =>
    model.call({
      system,
      messages: [{ role: "user", content: extra ? `${user}\n\n${extra}` : user }],
      temperature: 0,
      maxTokens: 300,
    });
  try {
    const r = await llamar();
    return parseLooseJSON<T>(r.text);
  } catch {
    const r = await llamar("(Tu respuesta anterior no fue JSON valido. Devuelve SOLO el JSON.)");
    return parseLooseJSON<T>(r.text);
  }
}

const idx = (v: unknown): 0 | 1 | 2 | null => (v === 0 || v === 1 || v === 2 ? v : null);
const ancla = (v: unknown): 1 | 2 | 3 | 4 | 5 | null =>
  v === 1 || v === 2 || v === 3 || v === 4 || v === 5 ? v : null;

export function interpreteConModelo(model: ModelAdapter): Interprete {
  return {
    async triada(t: TriadaNav, respuesta: string): Promise<InterpretacionTriada> {
      if (contradiccionPorPalabras(respuesta)) return { claro: false, dominante: null, segundo: null, solo_uno: false, especial: null };
      const system = `${REGLAS_LECTOR}
Los polos, con su indice:
0 = "${t.polos[0]}"
1 = "${t.polos[1]}"
2 = "${t.polos[2]}"
Se le pregunto a la persona cuales DOS pesaron mas y en que orden.
Devuelve: {"claro": bool, "dominante": 0|1|2|null, "segundo": 0|1|2|null, "solo_uno": bool, "especial": "not_applicable"|"dont_know"|null}
- "dominante": el que la persona puso primero o dijo que peso mas.
- "segundo": el que puso en segundo lugar. null si solo nombro uno.
- "solo_uno": true SOLO si dijo explicitamente que fue unicamente uno ("solo", "unicamente", "nada mas", "los otros no").
- "especial": "not_applicable" si dice que ninguno aplica a lo que conto; "dont_know" si dice que no sabe. Si hay especial, dominante y segundo van null y "claro" es true.
- Mencionar a la gente, al poder o a las fuerzas DENTRO de una historia NO es elegirlos: solo hay lectura si la persona ORDENA o ELIGE de forma explicita ("primero X", "sobre todo X", "X y despues Y", "solo X").
- "claro": false si no se puede leer con seguridad ni un dominante ni un especial.`;
      const r = await pedirJSON<Partial<InterpretacionTriada>>(model, system, `RESPUESTA DE LA PERSONA: ${respuesta}`);
      const dominante = idx(r.dominante);
      const segundo = idx(r.segundo);
      const especialDicho = r.especial === "not_applicable" || r.especial === "dont_know" ? r.especial : null;
      const especial = evidenciaEspecial(especialDicho, respuesta) ? especialDicho : null;
      return {
        // Un especial es una lectura aunque el modelo marque claro:false (no habia dominante que leer).
        claro: especial !== null || (!!r.claro && dominante !== null),
        dominante: especial ? null : dominante,
        segundo: especial || segundo === dominante ? null : segundo,
        solo_uno: !!r.solo_uno && !especial,
        especial,
      };
    },

    async segundo(t: TriadaNav, dominante: number, respuesta: string): Promise<InterpretacionSegundo> {
      if (contradiccionPorPalabras(respuesta)) return { claro: false, segundo: null, ninguno: false };
      const otros = [0, 1, 2].filter((i) => i !== dominante);
      const system = `${REGLAS_LECTOR}
La persona ya dijo que lo que mas peso fue "${t.polos[dominante]}". Se le pregunto cual iria en SEGUNDO lugar entre:
${otros[0]} = "${t.polos[otros[0]]}"
${otros[1]} = "${t.polos[otros[1]]}"
Devuelve: {"claro": bool, "segundo": ${otros[0]}|${otros[1]}|null, "ninguno": bool}
- "ninguno": true si dice que ninguno de los dos peso, que fue solo el primero, o equivalente.
- "claro": false si no se puede leer.`;
      const r = await pedirJSON<Partial<InterpretacionSegundo>>(model, system, `RESPUESTA DE LA PERSONA: ${respuesta}`);
      const segundo = idx(r.segundo);
      const valido = segundo !== null && segundo !== dominante ? segundo : null;
      return { claro: !!r.claro && (valido !== null || !!r.ninguno), segundo: valido, ninguno: !!r.ninguno && valido === null };
    },

    async intensidad(dominante: string, segundo: string, respuesta: string): Promise<InterpretacionIntensidad> {
      const porPalabras = intensidadPorPalabras(respuesta);
      if (porPalabras) return { etiqueta: porPalabras };
      const system = `${REGLAS_LECTOR}
Se le pregunto a la persona como se repartio el peso entre "${dominante}" (primero) y "${segundo}" (segundo), con tres opciones:
- "casi_parejos": iban casi parejos
- "uno_manda_otro_cuenta": uno mandaba pero el otro contaba
- "claramente_el_primero": fue claramente el primero
Devuelve: {"etiqueta": "casi_parejos"|"uno_manda_otro_cuenta"|"claramente_el_primero"|"no_gradua"|null}
- "no_gradua": la persona no quiere o no puede graduar ("no se", "da igual", "cualquiera").
- Repetir el ORDEN ("primero X, despues Y") NO es decir cuanto peso cada uno: null.
- null: no se entiende, habla de otra cosa, o nombra algo que no es ninguno de los dos.`;
      const r = await pedirJSON<Partial<InterpretacionIntensidad>>(model, system, `RESPUESTA DE LA PERSONA: ${respuesta}`);
      const e = r.etiqueta;
      return {
        etiqueta: e === "casi_parejos" || e === "uno_manda_otro_cuenta" || e === "claramente_el_primero" || e === "no_gradua" ? e : null,
      };
    },

    async diada(d: DiadaNav, respuesta: string): Promise<InterpretacionDiada> {
      const system = `${REGLAS_LECTOR}
Se le pregunto a la persona si siente que "${d.izq}" (lado A) o que "${d.der}" (lado B).
Devuelve: {"claro": bool, "ancla": 1|2|3|4|5|null, "especial": "middle"|"both_intense"|"not_applicable"|"dont_know"|null, "lado": "izq"|"der"|null}
Anclas:
1 = claramente A, sin matiz
2 = mas cerca de A, pero con matices ("A, aunque...", "A, pero ahora...")
3 = un poco de las dos, punto medio genuino (tambien "especial": "middle")
4 = mas cerca de B, pero con matices
5 = claramente B, sin matiz
- "both_intense": siente LAS DOS con fuerza a la vez (ambivalencia, no punto medio). ancla null.
- "not_applicable": dice que ninguna de las dos le aplica. ancla null.
- "dont_know": dice que no sabe. ancla null.
- Si hay especial, "claro" es true.
- "lado": hacia que lado se inclina, si se nota; si no, null. Si no hablo de A ni de B, null.
- "claro": true solo si el ancla (o el especial) se lee sin duda. Si la persona matiza sin que quede claro cuanto, "claro": false y deja "lado".
- Un orden de otras opciones, un peso ("casi parejos") o una historia sin postura sobre A y B NO es un ancla: "claro": false, "lado": null.`;
      const r = await pedirJSON<Partial<InterpretacionDiada>>(model, system, `RESPUESTA DE LA PERSONA: ${respuesta}`);
      const especialDicho = r.especial === "middle" || r.especial === "both_intense" || r.especial === "not_applicable" || r.especial === "dont_know"
        ? r.especial
        : null;
      const especial = evidenciaEspecial(especialDicho, respuesta) ? especialDicho : null;
      const a = especial && especial !== "middle" ? null : (especial === "middle" ? 3 : ancla(r.ancla));
      const lado = r.lado === "izq" || r.lado === "der" ? r.lado : null;
      // Un especial es una lectura aunque el modelo marque claro:false (no habia ancla que leer).
      return { claro: especial !== null || (!!r.claro && a !== null), ancla: a, especial, lado };
    },
  };
}
