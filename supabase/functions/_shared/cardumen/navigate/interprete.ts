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

/** Lector por palabras de la etiqueta de peso. Cubre botones y respuestas literales. */
export function intensidadPorPalabras(respuesta: string): InterpretacionIntensidad["etiqueta"] {
  const t = normalizarTexto(respuesta);
  if (!t) return null;
  // "No graduo" va primero: "me da igual" contiene "igual" y no es "iban iguales".
  if (/\bno se\b/.test(t) || /\bno sabria\b/.test(t) || /\bda igual\b/.test(t) || /\bno quiero\b/.test(t) || /\bcualquiera\b/.test(t)) return "no_gradua";
  if (/\bparej/.test(t) || /\biguales\b/.test(t) || /\bpor igual\b/.test(t) || /\bempate/.test(t)) return "casi_parejos";
  if (/\bmanda/.test(t) || /\bcontaba\b/.test(t) || /\bacompan/.test(t)) return "uno_manda_otro_cuenta";
  // "primero" solo NO alcanza ("no se si el primero"): eso lo lee el modelo.
  if (/\bclaramente\b/.test(t) || /\bclaro\b/.test(t)) return "claramente_el_primero";
  return null;
}

const REGLAS_LECTOR = `Eres un lector. Recibes lo que una persona respondio en un chat y lo devuelves como JSON.
REGLAS DURAS:
- NO interpretes ni completes: si la persona no lo dijo, no existe. Ante la duda, "claro": false.
- NO inventes un orden que la persona no dio. Un solo polo mencionado NO implica un segundo.
- La persona puede nombrar los polos con otras palabras (parafrasis, sinonimos, ejemplos). Emparejalos por significado, pero solo si es evidente.
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
- "especial": "not_applicable" si dice que ninguno aplica a lo que conto; "dont_know" si dice que no sabe. Si hay especial, dominante y segundo van null.
- "claro": false si no se puede leer con seguridad ni un dominante.`;
      const r = await pedirJSON<Partial<InterpretacionTriada>>(model, system, `RESPUESTA DE LA PERSONA: ${respuesta}`);
      const dominante = idx(r.dominante);
      const segundo = idx(r.segundo);
      const especial = r.especial === "not_applicable" || r.especial === "dont_know" ? r.especial : null;
      return {
        claro: !!r.claro && (dominante !== null || especial !== null),
        dominante: especial ? null : dominante,
        segundo: especial || segundo === dominante ? null : segundo,
        solo_uno: !!r.solo_uno && !especial,
        especial,
      };
    },

    async segundo(t: TriadaNav, dominante: number, respuesta: string): Promise<InterpretacionSegundo> {
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
- null: no se entiende.`;
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
- "lado": hacia que lado se inclina, si se nota; si no, null.
- "claro": true solo si el ancla (o el especial) se lee sin duda. Si la persona matiza sin que quede claro cuanto, "claro": false y deja "lado".`;
      const r = await pedirJSON<Partial<InterpretacionDiada>>(model, system, `RESPUESTA DE LA PERSONA: ${respuesta}`);
      const especial = r.especial === "middle" || r.especial === "both_intense" || r.especial === "not_applicable" || r.especial === "dont_know"
        ? r.especial
        : null;
      const a = especial && especial !== "middle" ? null : (especial === "middle" ? 3 : ancla(r.ancla));
      const lado = r.lado === "izq" || r.lado === "der" ? r.lado : null;
      return { claro: !!r.claro && (a !== null || especial !== null), ancla: a, especial, lado };
    },
  };
}
