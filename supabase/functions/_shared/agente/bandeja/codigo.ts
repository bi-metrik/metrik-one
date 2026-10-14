// ============================================================
// Núcleo conversacional — el código de un viaje escrito de otra forma (bandeja de solicitudes)
// ------------------------------------------------------------
// El código de un negocio es `{empresa} {AA} {n}` CON espacios («M1 26 1», `generate_negocio_codigo()`). En vivo
// (2026-10-09) el comercial escribió «m1261» y el núcleo no lo reconoció: el candado `viaje_nombrado` exigía los espacios.
// Aquí no se adivina un viaje por texto libre: un token con la FORMA de un código (una letra y de 3 a 8 dígitos, pegados
// o con otro separador: «m1261», «M1-26-1», «m1.26.1») da sus lecturas posibles con espacios, y vale solo la que existe
// en la base (`resolverLecturas`, con el puerto). Si existe más de una, no se elige: se pregunta. Pura salvo lo que se
// le inyecte.
// ============================================================

/** El código como lo guarda la base: con espacios. */
export const RE_CODIGO = /\b[A-ZÑ]\d{0,2} \d{2} \d{1,4}\b/gu;

/** Un token con forma de código escrito de cualquier manera (en el texto ya en mayúscula). */
// La letra va pegada a los dígitos (o con un separador que no es espacio): «a 2026» no es un código.
const RE_CODIGO_SUELTO = /(?<![\p{L}\p{N}])[A-ZÑ](?:\d{1,2}[ ._/-]?|[._/-]?)\d{2}[ ._/-]?\d{1,4}(?![\p{L}\p{N}])/gu;
const SEPARADOR = /[ ._/-]+/;

/** Los códigos con espacios del texto (la forma canónica). */
export function codigosCanonicos(texto: string): string[] {
  return [...texto.toUpperCase().matchAll(RE_CODIGO)].map((m) => m[0]);
}

/** La llave compacta: sin separadores y en mayúscula («m1-26-1» → «M1261»). */
export function claveCompacta(s: string): string {
  return s.toUpperCase().replace(/[^A-ZÑ0-9]/gu, '');
}

/**
 * Las lecturas con espacios de un token con forma de código: «M1261» → «M 12 61», «M1 26 1». Respeta los separadores que
 * sí escribieron («M12-61» solo puede ser «M12 61 …» si cuadra). Ni la empresa ni el consecutivo empiezan en 0. Pura.
 */
export function lecturasDeCodigo(token: string): string[] {
  const t = token.toUpperCase().trim();
  const letra = t[0];
  if (!letra || !/[A-ZÑ]/u.test(letra)) return [];
  const grupos = t.slice(1).split(SEPARADOR).filter(Boolean);
  if (!grupos.length || grupos.some((g) => !/^\d+$/.test(g))) return [];
  const digitos = grupos.join('');
  // Dónde cortaron ellos (posiciones dentro de los dígitos).
  const cortes: number[] = [];
  grupos.slice(0, -1).reduce((acc, g) => { cortes.push(acc + g.length); return acc + g.length; }, 0);
  const out: string[] = [];
  for (let a = 0; a <= 2; a++) {
    const empresa = digitos.slice(0, a);
    const anio = digitos.slice(a, a + 2);
    const n = digitos.slice(a + 2);
    if (empresa.length !== a || anio.length !== 2 || n.length < 1 || n.length > 4) continue;
    if (empresa.startsWith('0') || n.startsWith('0')) continue;
    // Todo corte que escribieron tiene que caer en un límite de esta lectura.
    if (cortes.some((c) => c !== a && c !== a + 2)) continue;
    out.push(`${letra}${empresa} ${anio} ${n}`);
  }
  return out;
}

/**
 * Los tokens con forma de código que NO están escritos con espacios («m1261»). Lo canónico no entra: ya se reconoce
 * tal cual. Pura.
 */
export function codigosSueltos(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.toUpperCase().matchAll(RE_CODIGO_SUELTO)) {
    const token = m[0];
    if (lecturasDeCodigo(token).includes(token)) continue;
    if (lecturasDeCodigo(token).length && !out.includes(token)) out.push(token);
  }
  return out;
}

/** Los códigos que existen entre los pedidos (`'error'`: no se pudo consultar). */
export type CodigosExistentes = (candidatos: string[]) => Promise<string[] | 'error'>;

/**
 * Lo que un código escrito de cualquier forma nombra, contra la base: `{ codigo }` si una sola lectura existe,
 * `{ varios }` si existen dos o más (no se elige), `null` si ninguna existe y `'error'` si no se pudo consultar. Un código
 * ya con espacios no consulta nada: es él.
 */
export async function resolverCodigo(
  texto: string, existentes: CodigosExistentes,
): Promise<{ codigo: string } | { varios: string[] } | null | 'error'> {
  const t = texto.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!t) return null;
  const lecturas = lecturasDeCodigo(t);
  if (lecturas.includes(t)) return { codigo: t };
  if (!lecturas.length) return null;
  const hay = await existentes(lecturas);
  if (hay === 'error') return 'error';
  const unicas = lecturas.filter((l) => hay.includes(l));
  if (unicas.length === 1) return { codigo: unicas[0] };
  return unicas.length ? { varios: unicas } : null;
}

/**
 * Los códigos sueltos de unos textos, resueltos de una vez: llave compacta → código con espacios, solo los que tienen
 * UNA lectura que existe. Sin sueltos no consulta nada. Si la consulta falla, ninguno (el candado sigue cerrado).
 */
export async function resolverSueltos(textos: string[], existentes: CodigosExistentes): Promise<Record<string, string>> {
  const sueltos = [...new Set(textos.flatMap(codigosSueltos))];
  if (!sueltos.length) return {};
  const lecturas = new Map(sueltos.map((s) => [s, lecturasDeCodigo(s)]));
  const hay = await existentes([...new Set([...lecturas.values()].flat())]);
  if (hay === 'error') return {};
  const out: Record<string, string> = {};
  for (const [s, ls] of lecturas) {
    const unicas = ls.filter((l) => hay.includes(l));
    if (unicas.length === 1) out[claveCompacta(s)] = unicas[0];
  }
  return out;
}

/**
 * Los códigos que nombra un texto: los escritos con espacios y los sueltos que ya se resolvieron (`sueltos`, de
 * `resolverSueltos`). En el orden en que aparecen. Pura.
 */
export function codigosDelTexto(texto: string, sueltos: Record<string, string> = {}): string[] {
  const t = texto.toUpperCase();
  const hallados: Array<{ i: number; c: string }> = [];
  for (const m of t.matchAll(RE_CODIGO)) hallados.push({ i: m.index ?? 0, c: m[0] });
  if (Object.keys(sueltos).length) {
    for (const m of t.matchAll(RE_CODIGO_SUELTO)) {
      const c = sueltos[claveCompacta(m[0])];
      if (c && !hallados.some((h) => h.i === (m.index ?? 0))) hallados.push({ i: m.index ?? 0, c });
    }
  }
  return hallados.sort((a, b) => a.i - b.i).map((h) => h.c);
}
