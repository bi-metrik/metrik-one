// ============================================================
// Asistente de ventas — la respuesta partida por producto, con su foto justo después (Dimpro, ronda 3, 30-oct)
// ------------------------------------------------------------
// Mauricio (Messenger, 30-oct): «Cuando me cuenta las opciones, quisiera que me contara sobre ese producto y después me
// enviara la foto. Y así por cada uno.» Antes salía un solo párrafo con los tres productos y después las fotos, cada una
// con el pie «MP-17 · nombre largo»: el cliente tenía que adivinar cuál era cuál.
//
// El modelo escribe como siempre (un producto por línea, cada una empezando por su código); el CÓDIGO parte el texto y
// arma los envíos: entrada → por cada producto, su texto y su foto (sin pie: el texto de arriba ya dice cuál es) →
// la pregunta de cierre aparte. El emparejamiento texto↔foto lo garantiza el código: cada bloque empieza en la primera
// mención de su código y ningún otro código aparece dentro de él. Si el texto no se deja partir así (los códigos en una
// misma frase, «el MP-17 es mejor que el MP-38», una pregunta con código), sale como antes: el texto entero y después
// las fotos con su pie. Nunca se pierde texto ni una foto. Puro.
// ============================================================

import type { FotoDelTurno } from './fotos-ventas.ts';

export interface Partes {
  /** Lo que va antes del primer producto («Para la casa te sugiero estos:»). Con un solo producto, va en su texto. */
  entrada: string | null;
  /** Un bloque por producto, en el orden en que el texto los nombra. */
  productos: Array<{ codigo: string; texto: string }>;
  /** La pregunta del final, si se deja separar sin llevarse un código. */
  cierre: string | null;
}

export type Envio =
  | { tipo: 'texto'; texto: string }
  /** `pie`: la foto lleva el pie «MP-xx · nombre» (solo cuando el texto de arriba no es de ese producto). */
  | { tipo: 'foto'; foto: FotoDelTurno; pie: boolean };

const RE_CODIGO = /\bmp\s*-?\s*0*(\d{1,4})\b/gi;
const normalCodigo = (n: number) => `MP-${String(n).padStart(2, '0')}`;
/** Viñeta o numeración antes del código: «- », «• », «1. », «2) », y asteriscos de markdown. */
const VINETA = String.raw`(?:[-•·*]|\d{1,2}[.)])`;
/** El código abre un bloque si antes de él (saltando una viñeta) hay inicio, salto de línea o fin de frase. */
const ABRE = new RegExp(String.raw`(?:^|\n|[.!?:;])[ \t]*(?:${VINETA}[ \t]*)?\**[ \t]*$`);
/** La viñeta que quedó al final del bloque anterior (la del producto siguiente). */
const COLA_VINETA = new RegExp(String.raw`(?:^|\s)${VINETA}?\**[ \t]*$`);

function limpiarCola(t: string): string {
  let s = t.trimEnd();
  const m = COLA_VINETA.exec(s);
  if (m && m[0].trim()) s = s.slice(0, m.index).trimEnd();
  return s;
}

const tieneCodigo = (t: string) => new RegExp(RE_CODIGO.source, 'i').test(t);

/**
 * Separa la pregunta del final: la última línea si es una pregunta sin código, o la última frase que empieza con «¿»
 * después de un fin de frase. Si no hay pregunta separable, `cierre` = null y el texto queda entero.
 */
export function separarCierre(texto: string): { cuerpo: string; cierre: string | null } {
  const t = texto.trimEnd();
  if (!t.endsWith('?')) return { cuerpo: t, cierre: null };
  const corte = t.lastIndexOf('\n');
  if (corte > 0) {
    const ultima = t.slice(corte + 1).trim();
    const cuerpo = t.slice(0, corte).trimEnd();
    if (ultima && cuerpo && !tieneCodigo(ultima)) return { cuerpo, cierre: ultima };
  }
  const k = t.lastIndexOf('¿');
  if (k > 0) {
    const antes = t.slice(0, k).trimEnd();
    const pregunta = t.slice(k).trim();
    if (antes && /[.!?:]$/.test(antes) && !tieneCodigo(pregunta) && !pregunta.slice(1).includes('¿')) return { cuerpo: antes, cierre: pregunta };
  }
  return { cuerpo: t, cierre: null };
}

/**
 * Parte la respuesta del modelo por producto. `null` = no nombra productos o no se deja partir sin riesgo (entonces sale
 * como antes). Con un solo producto, todo el texto es suyo (menos la pregunta del final).
 */
export function partirSugerencias(texto: string): Partes | null {
  const t = String(texto ?? '').trim();
  const menciones = [...t.matchAll(RE_CODIGO)].map((m) => ({ codigo: normalCodigo(Number(m[1])), i: m.index! }));
  if (!menciones.length) return null;
  const distintos = [...new Set(menciones.map((m) => m.codigo))];
  if (distintos.length === 1) {
    const { cuerpo, cierre } = separarCierre(t);
    return { entrada: null, productos: [{ codigo: distintos[0], texto: cuerpo }], cierre };
  }
  const inicios = distintos.map((c) => menciones.find((m) => m.codigo === c)!.i);
  if (inicios.some((i) => !ABRE.test(t.slice(0, i)))) return null;
  // Cada mención cae en el bloque de su propio código (si no, el texto mezcla productos: no se parte).
  for (const m of menciones) {
    let b = 0;
    while (b + 1 < inicios.length && inicios[b + 1] <= m.i) b++;
    if (distintos[b] !== m.codigo) return null;
  }
  const bloques = inicios.map((i, k) => limpiarCola(t.slice(i, inicios[k + 1] ?? t.length)));
  const { cuerpo, cierre } = separarCierre(bloques[bloques.length - 1]);
  bloques[bloques.length - 1] = cuerpo;
  if (bloques.some((b) => !b.trim())) return null;
  const entrada = limpiarCola(t.slice(0, inicios[0])) || null;
  return { entrada, productos: distintos.map((codigo, k) => ({ codigo, texto: bloques[k] })), cierre };
}

/**
 * Los envíos del turno, en orden, con las fotos que ya escogió `fotosDelTurno`:
 *   · se deja partir y hay fotos → [entrada] → (texto del producto, su foto sin pie)… → [cierre]. Con un solo producto,
 *     su texto, su foto y la pregunta.
 *   · se deja partir y no hay fotos → un solo mensaje; si son varios productos, uno por línea.
 *   · no se deja partir → el texto entero y después las fotos con su pie (como antes de la ronda 3).
 */
export function planDeEnvios(texto: string, fotos: FotoDelTurno[]): Envio[] {
  const partes = partirSugerencias(texto);
  const comoAntes = (t: string): Envio[] => [{ tipo: 'texto', texto: t }, ...fotos.map((foto): Envio => ({ tipo: 'foto', foto, pie: true }))];
  if (!partes) return comoAntes(texto);
  if (!fotos.length) {
    if (partes.productos.length < 2) return comoAntes(texto);
    return comoAntes([partes.entrada, ...partes.productos.map((p) => p.texto), partes.cierre].filter(Boolean).join('\n'));
  }
  if (fotos.some((f) => !partes.productos.some((p) => p.codigo === f.codigo))) return comoAntes(texto);
  const out: Envio[] = [];
  if (partes.entrada) out.push({ tipo: 'texto', texto: partes.entrada });
  for (const p of partes.productos) {
    out.push({ tipo: 'texto', texto: p.texto });
    const foto = fotos.find((f) => f.codigo === p.codigo);
    if (foto) out.push({ tipo: 'foto', foto, pie: false });
  }
  // La pregunta, aparte y al final (con un solo producto aquí siempre hay foto antes: sin foto no se parte).
  if (partes.cierre) out.push({ tipo: 'texto', texto: partes.cierre });
  return out;
}
