// Idioma (es / en / pt), determinista y sin modelo. Dos usos que conviene no confundir:
//
//   - `leerIdiomaElegido`: lee la respuesta ESCRITA al primer mensaje ("¿En qué idioma
//     prefiere continuar?") cuando la persona no toca un boton. Primero palabras claras
//     (espanol, english, portugues...), despues la deteccion por palabras funcionales. Esa
//     eleccion es la que decide el flujo. Es la "confirmacion" de instrumento-multilingue-saga.md
//     §5 (detectar, confirmar, bloquear), movida al inicio como eleccion explicita: antes se
//     detectaba en la historia y se confirmaba despues, y quien no hablaba espanol recibia
//     cuatro mensajes que no entendia, consentimiento incluido.
//   - `detectarIdioma` sobre la historia: solo registra `idioma_detectado` en el payload (dato
//     para el instrumento EN/PT futuro). No cambia el flujo.
//
// Deliberadamente simple: cuenta palabras funcionales que solo existen en uno de los tres
// idiomas. Ante la duda devuelve "desconocido"; en el primer mensaje eso se repregunta una
// vez y a la segunda se sigue en espanol (el unico idioma en que existe el instrumento).

import type { Idioma, IdiomaElegible } from "./tipos.ts";

const ES = new Set([
  "el", "los", "las", "y", "es", "una", "del", "al", "lo", "pero", "esta", "hay", "muy",
  "tambien", "porque", "cuando", "todo", "anos", "ya", "mas", "eso", "esto", "aqui", "alla",
  "con", "para", "sin", "hace", "tiene", "tienen", "son", "fue", "era", "estan", "siempre",
  "gente", "cosas", "nada", "algo", "ahora", "antes", "donde", "como", "que", "de", "en",
]);
const EN = new Set([
  "the", "and", "is", "are", "of", "to", "in", "that", "it", "for", "with", "this", "was",
  "have", "has", "not", "but", "they", "there", "been", "from", "more", "new", "people",
  "year", "years", "what", "when", "which", "their", "about", "would", "been", "were",
  "things", "something", "nothing", "now", "before", "here", "because", "always",
]);
const PT = new Set([
  "o", "os", "as", "e", "nao", "com", "do", "da", "dos", "das", "na", "no", "mais", "mas",
  "isso", "muito", "ja", "tambem", "voce", "sao", "uma", "um", "ele", "ela", "eles", "esta",
  "coisas", "coisa", "nada", "algo", "agora", "antes", "aqui", "porque", "sempre", "anos",
  "quando", "tudo", "gente", "pessoas", "tem", "foi", "era", "estao", "que", "de", "em",
]);

// Palabras que estan en dos listas no discriminan; se descuentan de ambas.
const AMBIGUAS = new Set<string>();
for (const w of ES) if (EN.has(w) || PT.has(w)) AMBIGUAS.add(w);
for (const w of PT) if (EN.has(w) || ES.has(w)) AMBIGUAS.add(w);

function normalizar(texto: string): string[] {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function detectarIdioma(texto: string): Idioma {
  const t = texto || "";
  const palabras = normalizar(t);
  if (palabras.length === 0) return "desconocido";

  let es = 0, en = 0, pt = 0;
  for (const w of palabras) {
    if (AMBIGUAS.has(w)) continue;
    if (ES.has(w)) es++;
    if (EN.has(w)) en++;
    if (PT.has(w)) pt++;
  }
  // Marcas ortograficas que no dejan duda.
  if (/[ñ]/i.test(t)) es += 2;
  if (/[ãõ]/i.test(t) || /ção|ções|nh[aeiou]/i.test(t)) pt += 2;

  const ranking = [
    { idioma: "es" as const, n: es },
    { idioma: "en" as const, n: en },
    { idioma: "pt" as const, n: pt },
  ].sort((a, b) => b.n - a.n);

  const [primero, segundo] = ranking;
  if (primero.n < 2) return "desconocido";
  if (primero.n - segundo.n < 1) return "desconocido";
  return primero.idioma;
}

// Como alguien NOMBRA un idioma, sobre texto normalizado (minusculas, sin tildes).
const NOMBRES: ReadonlyArray<[IdiomaElegible, RegExp]> = [
  ["es", /\b(espanol|spanish|castellano)\b/],
  ["en", /\b(ingles|english)\b/],
  ["pt", /\b(portugues|portuguese)\b/],
];

/**
 * Lee la respuesta escrita al primer mensaje. Una palabra clara manda ("english please");
 * si nombra mas de un idioma no se adivina; sin palabra clara decide la deteccion por
 * palabras funcionales. null = no se pudo leer: el motor repregunta una vez y a la segunda
 * sigue en espanol.
 */
export function leerIdiomaElegido(texto: string): IdiomaElegible | null {
  const n = normalizar(texto).join(" ");
  const nombrados = NOMBRES.filter(([, re]) => re.test(n)).map(([idioma]) => idioma);
  if (nombrados.length === 1) return nombrados[0];
  if (nombrados.length > 1) return null;
  const detectado = detectarIdioma(texto);
  return detectado === "desconocido" ? null : detectado;
}
