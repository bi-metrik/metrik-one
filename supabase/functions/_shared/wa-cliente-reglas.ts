// ============================================================
// ¿Quién es el cliente? — las reglas, sin I/O
// ------------------------------------------------------------
// Diseño: proyectos/trappvel/clarity/docs/diseno/2026-10-05_diseno-cliente-y-conversacion.md, §3.
// Encargo: brief-max-2026-10-05-viaje-nuevo-cliente-existente.md (PR A), con las decisiones de Mauricio
// del 2026-10-05:
//   1. Un cliente nuevo sin celular, correo ni usuario de WhatsApp/Instagram NO se crea: el bot pide una
//      llave y la tanda espera.
//   2. Un nombre idéntico a UN solo contacto se usa, mostrando su celular en el acuse y en el resumen (sin
//      un turno aparte de «¿es el mismo?»).
//
// «Nuevo» quiere decir VIAJE nuevo. Que el cliente sea nuevo no lo declara el comercial: lo resuelve el
// código buscándolo, primero por la llave (`buscar_contacto_duplicado`, la regla de SOENA) y después por
// el nombre en TODO el directorio (`buscar_clientes_por_nombre`), también los clientes sin viajes abiertos.
// Lo que nunca hace: deducir la identidad solo por el nombre sin mostrarla, crear con una llave que ya es
// de otra persona, ni tocar un dato que ya existe.
//
// Puro a propósito: la consulta a la base vive en `wa-cliente.ts`; aquí llegan sus filas.
// ============================================================

import { mismoNombre } from './meta-leads/dedup-lead.ts';
import { nombrePropio, normalizarNombre } from './wa-entendimiento-reglas.ts';

/** Las tres llaves de «una persona, un contacto» (las mismas de `buscar_contacto_duplicado`). */
export interface Llave {
  /** Solo dígitos: los últimos 10 (el celular colombiano), o lo que haya si son de 7 a 9. */
  celular?: string | null;
  /** En minúsculas. */
  correo?: string | null;
  /** El usuario de WhatsApp o Instagram, sin la arroba. */
  usuario?: string | null;
}

/** Un contacto del directorio como se le muestra al comercial: nunca el celular completo ni el correo. */
export interface FichaCliente {
  id: string;
  nombre: string;
  /** Los 4 últimos dígitos del celular, o `null`. */
  cel4: string | null;
  correo: boolean;
  usuario?: boolean;
  /** Sus viajes abiertos (código y nombre del negocio). */
  abiertos: Array<{ codigo: string | null; nombre: string | null }>;
  /** Su último viaje cerrado, si no tiene abiertos o para distinguirlo. */
  cerrado?: { codigo: string | null; nombre: string | null } | null;
  /** Lo que la RPC de nombre dice del parecido (sin uso para decidir: decide `pareceNombre`). */
  exacto?: boolean;
}

export type ResolucionCliente =
  /** Es esa persona: por la llave (con el mismo nombre, o sin nombre dado) o por el nombre idéntico y único. */
  | { tipo: 'existente'; ficha: FichaCliente; por: 'llave' | 'nombre' | 'eleccion'; nombre: string | null; llave: Llave | null }
  /** Varios: homónimos, parecidos o una llave compartida que el nombre no desempata. Se pregunta cuál. */
  | { tipo: 'elegir'; opciones: FichaCliente[]; motivo: 'homonimos' | 'parecidos' | 'llave_compartida'; nombre: string | null; llave: Llave | null }
  /** La llave dada ya es de un contacto con OTRO nombre: no se crea; se pregunta «¿es la misma persona?». */
  | { tipo: 'llave_de_otro'; ficha: FichaCliente; nombre: string | null; llave: Llave }
  /** Nadie con esa llave ni con ese nombre: se crea con el «sí» del resumen, que muestra el nombre y la llave. */
  | { tipo: 'nuevo'; nombre: string; llave: Llave }
  /** Nadie con ese nombre y no hay llave: se pide una (decisión 1). Nada se crea. */
  | { tipo: 'pedir_llave'; nombre: string }
  /** Sin nombre (y sin nadie con la llave, si la hay): se pregunta para qué cliente es, o cómo se llama. */
  | { tipo: 'sin_nombre'; llave?: Llave | null }
  /** La búsqueda falló: «error al comprobar ≠ permiso para crear». Nada se crea. */
  | { tipo: 'error'; nombre: string | null; llave: Llave | null };

/** Lo más que se muestra de un directorio cuando hay que elegir. */
export const MAX_OPCIONES_CLIENTE = 5;

// ── Llaves ──────────────────────────────────────────────────────────────────

const RE_CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
/**
 * Un celular escrito: de 7 dígitos en adelante, con espacios, puntos, guiones o paréntesis. No empieza pegado a una
 * letra: en «Laura Prueba2 300 123 4567» el «2» es del nombre, no del número.
 */
const RE_CELULAR = /(?<![\p{L}\d])\+?\d[\d\s().-]{5,}\d(?:[.,]0+)?/gu;
const RE_USUARIO = /(?:^|[\s(:,])@([A-Za-z0-9._]{3,30})(?![A-Za-z0-9._@])/;

/** ¿Hay al menos una llave? */
export function tieneLlave(l: Llave | null | undefined): l is Llave {
  return !!l && !!(l.celular || l.correo || l.usuario);
}

/** Los dígitos de un celular escrito («+57 300 555 1234», «300-555-1234», «3005551234.0»). `null` si no son de 7 a 15. */
export function digitosCelular(t: string | null | undefined): string | null {
  // El decimal de Excel («3005551234.0») no es parte del número.
  const s = String(t ?? '').replace(/(\d)[.,]0+\b/g, '$1');
  const d = s.replace(/\D/g, '');
  if (d.length < 7 || d.length > 15) return null;
  return d.length >= 10 ? d.slice(-10) : d;
}

/** Las llaves que trae un texto, donde estén (un reenvío, una frase). `null` si no trae ninguna. */
export function llavesDelTexto(texto: string | null | undefined): Llave | null {
  const t = String(texto ?? '');
  const correo = RE_CORREO.exec(t)?.[0]?.toLowerCase() ?? null;
  const sinCorreo = correo ? t.replace(RE_CORREO, ' ') : t;
  const usuario = RE_USUARIO.exec(sinCorreo)?.[1]?.toLowerCase() ?? null;
  // El celular: un grupo de dígitos con separadores de 7 a 15 dígitos (no una fecha ni una edad sueltas).
  let celular: string | null = null;
  for (const m of sinCorreo.matchAll(RE_CELULAR)) {
    const d = digitosCelular(m[0]);
    if (d) { celular = d; break; }
  }
  const l: Llave = {};
  if (celular) l.celular = celular;
  if (correo) l.correo = correo;
  if (usuario) l.usuario = usuario;
  return tieneLlave(l) ? l : null;
}

/** Lo que puede acompañar a una llave escrita sola: «su cel es 300…», «correo: ana@…», «el de ella». */
const CON_LA_LLAVE: ReadonlySet<string> = new Set([
  'su', 'sus', 'el', 'la', 'es', 'este', 'esta', 'ese', 'esa', 'numero', 'num', 'no', 'cel', 'celular', 'movil', 'telefono', 'tel', 'whatsapp', 'wa',
  'whats', 'wsp', 'correo', 'email', 'mail', 'e', 'instagram', 'insta', 'ig', 'usuario', 'de', 'del', 'ella', 'el', 'y', 'o', 'aqui', 'va', 'te', 'paso',
  'mando', 'ahi', 'tienes', 'listo', 'ok', 'dale', 'por', 'favor', 'porfa', 'gracias', 'cliente', 'clienta', 'le', 'lo', 'mi', 'me', 'escribio', 'por',
]);

/**
 * ¿El escrito es SOLO una llave? «300 555 1234», «su correo es ana@x.co», «@laurapc», «cel: +57 300…». Con
 * algo más («quiere ir el 12 de diciembre, cel 300…»), no: es contenido (un reenvío nunca llega aquí).
 */
export function soloLlave(texto: string | null | undefined): Llave | null {
  const t = String(texto ?? '').trim();
  const l = llavesDelTexto(t);
  if (!l) return null;
  const sin = t.replace(RE_CORREO, ' ').replace(/@[A-Za-z0-9._]{3,30}/g, ' ').replace(RE_CELULAR, ' ');
  const resto = normalizarNombre(sin).split(' ').filter(Boolean);
  return resto.every(w => CON_LA_LLAVE.has(w)) ? l : null;
}

/** Verbos de anotar que pueden ir con la llave: «anótale», «apunta», «guárdale», «regístrale», «agrégale», «ponle». */
const ANOTAR = /^(?:anot|apunt|guard|registr|agreg|pon|coloc|carg)[a-z]*$/;
const TRATAMIENTO: ReadonlySet<string> = new Set(['don', 'dona', 'senor', 'senora', 'sr', 'sra', 'doctor', 'doctora', 'dr', 'dra']);
const CON_LA_LLAVE_Y_EL_CLIENTE: ReadonlySet<string> = new Set(['a', 'al', 'para', 'que', 'como', 'tambien', 'y', 'datos', 'dato', 'contacto']);

/**
 * Octavo control de Vera (hallazgo 7): en la caja de un viaje nuevo, un escrito cuya única información es la llave,
 * con un verbo de anotar y el nombre del cliente de esa caja (con o sin tratamiento): «anótale a don Gerardo el cel
 * 300 111 2222». Es la llave, como `soloLlave`. Con cualquier otra palabra («el de la esposa es …») no lo es.
 */
export function soloLlaveDelCliente(texto: string | null | undefined, cliente: string | null | undefined): Llave | null {
  const t = String(texto ?? '').trim();
  const l = llavesDelTexto(t);
  if (!l || !cliente) return null;
  const delCliente = new Set(palabrasDelNombre(cliente));
  const sin = t.replace(RE_CORREO, ' ').replace(/@[A-Za-z0-9._]{3,30}/g, ' ').replace(RE_CELULAR, ' ');
  const resto = normalizarNombre(sin).split(' ').filter(Boolean);
  return resto.every(w => CON_LA_LLAVE.has(w) || TRATAMIENTO.has(w) || delCliente.has(w) || ANOTAR.test(w) || CON_LA_LLAVE_Y_EL_CLIENTE.has(w)) ? l : null;
}

/**
 * El nombre y la llave de «Ana Gómez 300 555 1234», «Ana Gómez, ana@x.co», «@laurapc»: el nombre sin la llave
 * (ni las palabras que la anuncian: «cel», «correo»), y la llave. Sin llave, el nombre tal cual.
 */
export function separarNombreYLlave(texto: string | null | undefined): { nombre: string; llave: Llave | null } {
  const t = String(texto ?? '').trim();
  const llave = llavesDelTexto(t);
  if (!llave) return { nombre: t, llave: null };
  const nombre = t.replace(RE_CORREO, ' ').replace(/@[A-Za-z0-9._]{3,30}/g, ' ').replace(RE_CELULAR, ' ')
    .replace(/\b(?:cel(?:ular)?|tel(?:[eé]fono)?|whats(?:app)?|wsp|correo|e-?mail|mail|instagram|insta|ig|usuario)\b\.?:?/gi, ' ')
    .replace(/[\s,;:.-]+$/g, '').replace(/^[\s,;:.-]+/g, '').replace(/\s+/g, ' ').trim();
  return { nombre, llave };
}

/** Une dos llaves: lo de `a` gana; lo que falta sale de `b`. */
export function unirLlaves(a: Llave | null | undefined, b: Llave | null | undefined): Llave | null {
  const l: Llave = {};
  const c = a?.celular || b?.celular;
  const m = a?.correo || b?.correo;
  const u = a?.usuario || b?.usuario;
  if (c) l.celular = c;
  if (m) l.correo = m;
  if (u) l.usuario = u;
  return tieneLlave(l) ? l : null;
}

/** «cel. 300 555 1234», «correo ana@x.co», «usuario @laurapc»: la llave dada, como la escribió (es del comercial). */
export function textoLlave(l: Llave | null | undefined): string {
  if (!l) return '';
  if (l.celular) {
    const d = l.celular;
    return `cel. ${d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d}`;
  }
  if (l.correo) return `correo ${l.correo}`;
  return `usuario @${l.usuario}`;
}

/**
 * Octavo control de Vera (hallazgo 9): lo que pasa con la llave que dio el comercial cuando el cliente ya existe. Lo
 * que la ficha no tiene se le agrega al cargar (`completarLlave`, sin pisar nada); un celular distinto del de la
 * ficha no la reemplaza. Las dos cosas se dicen. `null`: nada que decir (la llave es la de la ficha, o no hay).
 */
export function notaDeLaLlave(f: FichaCliente, l: Llave | null | undefined): { agrega: string | null; distinto: string | null } | null {
  if (!tieneLlave(l)) return null;
  const agrega: string[] = [];
  let distinto: string | null = null;
  if (l!.celular) {
    const c4 = l!.celular.slice(-4);
    if (!f.cel4) agrega.push(textoLlave({ celular: l!.celular }));
    else if (f.cel4 !== c4) distinto = `su ficha tiene otro celular (…${f.cel4}); el que me diste (…${c4}) no lo cambio`;
  }
  if (l!.correo && !f.correo) agrega.push(textoLlave({ correo: l!.correo }));
  if (l!.usuario && !f.usuario) agrega.push(textoLlave({ usuario: l!.usuario }));
  if (agrega.length === 0 && !distinto) return null;
  return { agrega: agrega.length ? `le agrego a su ficha el ${agrega.join(' y el ')}` : null, distinto };
}

/** La nota de la llave como una frase («Le agrego a su ficha el cel. 300 111 2222.»). */
export function fraseDeLaLlave(f: FichaCliente, l: Llave | null | undefined): string | null {
  const n = notaDeLaLlave(f, l);
  if (!n) return null;
  const s = [n.agrega, n.distinto].filter(Boolean).join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** «celular», «correo» o «usuario»: qué llave es. */
function cualLlave(l: Llave): string {
  return l.celular ? 'celular' : l.correo ? 'correo' : 'usuario';
}

// ── Nombres ─────────────────────────────────────────────────────────────────

/** Palabras que no identifican a nadie dentro de un nombre. */
const NO_NOMBRAN: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'cliente', 'clienta', 'senor', 'senora', 'sr', 'sra', 'don', 'dona']);

function palabrasDelNombre(n: string | null | undefined): string[] {
  return normalizarNombre(n).split(' ').filter(w => w.length >= 2 && !NO_NOMBRAN.has(w));
}

/** Distancia de edición con transposición (como `distancia` de los encabezados), con tope en 2. */
function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Palabras con las que nunca empieza un nombre propio (noveno control de Vera, hallazgo 1): artículos, posesivos,
 * pronombres, preposiciones, «la persona», verbos de presentación. No es una lista de lo que ES un nombre: solo sirve
 * para no crear «cliente nuevo» con un nombre que arranca con una fórmula que no se pudo quitar.
 */
const NO_EMPIEZA_NOMBRE: ReadonlySet<string> = new Set([
  'el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'nuestro', 'nuestra', 'nuestros', 'nuestras',
  'yo', 'ella', 'ellos', 'ellas', 'usted', 'ustedes', 'este', 'esta', 'ese', 'esa', 'aquel', 'aquella', 'esto', 'eso', 'quien', 'que', 'cual',
  'a', 'al', 'de', 'del', 'para', 'por', 'con', 'en', 'sin', 'sobre', 'hacia', 'persona', 'cliente', 'clienta', 'pasajero', 'pasajera',
  'titular', 'nombre', 'contacto', 'senor', 'senora', 'es', 'son', 'era', 'fue', 'sera', 'seria', 'se', 'le', 'les', 'me', 'te', 'nos', 'va',
  'van', 'viene', 'vienen', 'corresponde', 'corresponden', 'trata', 'llama', 'llaman', 'llamado', 'llamada', 'dice', 'dicen', 'quiere', 'quieren',
  'esta', 'estan', 'hay', 'tiene', 'tienen', 'viaja', 'viajan', 'sale', 'salen', 'tambien', 'ahora', 'ya', 'solo', 'mejor', 'y', 'o', 'pues',
]);

/**
 * Los tramos de 2 a 4 palabras seguidas de un nombre escrito, del más largo al más corto y de atrás hacia adelante,
 * hechos solo de palabras que pueden ser de un nombre (noveno control, hallazgo 1): «la persona se llama Ana Ruiz»
 * → «Ana Ruiz»; «Ana Ruiz Cartagena» → «Ana Ruiz Cartagena», «Ruiz Cartagena», «Ana Ruiz».
 */
export function tramosDelNombre(nombre: string | null | undefined): string[] {
  const tokens = String(nombre ?? '').split(/[\s,.;:!¡¿?()"«»]+/).filter(Boolean);
  const corridas: string[][] = [];
  let actual: string[] = [];
  for (const t of tokens) {
    const n = normalizarNombre(t);
    if (!n || /\d/.test(n) || NO_EMPIEZA_NOMBRE.has(n)) {
      if (actual.length) corridas.push(actual);
      actual = [];
    } else actual.push(t);
  }
  if (actual.length) corridas.push(actual);
  const tramos: string[] = [];
  for (let largo = 4; largo >= 2; largo--) {
    for (const c of [...corridas].reverse()) {
      for (let i = c.length - largo; i >= 0; i--) tramos.push(c.slice(i, i + largo).join(' '));
    }
  }
  return [...new Set(tramos)];
}

/**
 * El nombre del cliente que dice el escrito, contra el directorio (noveno control de Vera, hallazgo 1). Si el nombre
 * entero no es exacto el de nadie pero un tramo suyo sí («la persona se llama Ana Ruiz», «para Ana Ruiz», «Ana Ruiz
 * Cartagena»), el cliente es ese tramo y lo demás se descarta. Sin coincidencia, un nombre que empieza por una
 * palabra que no es de un nombre propio es `dudoso`: se pregunta «¿cómo se llama?», nunca se crea con el prefijo.
 */
export function nombreEnElDirectorio(nombre: string | null | undefined, dir: Directorio): { nombre: string; dudoso: boolean } {
  const entero = String(nombre ?? '').trim();
  const identicos = (n: string) => (dir.porNombre(n) ?? []).filter(f => nombreIdentico(n, f.nombre));
  if (!entero || identicos(entero).length > 0) return { nombre: entero, dudoso: false };
  for (const t of tramosDelNombre(entero)) {
    if (normalizarNombre(t) !== normalizarNombre(entero) && identicos(t).length > 0) return { nombre: t, dudoso: false };
  }
  // Un artículo solo puede empezar el nombre de una empresa («La Riviera», «Los Andes»); con otra palabra que no es de
  // un nombre detrás («la persona …», «el señor …»), o cualquier otra palabra así delante («para …», «mi …»), no.
  const [primera = '', segunda = ''] = normalizarNombre(entero).split(' ');
  const articulo = ['el', 'la', 'los', 'las'].includes(primera);
  return { nombre: entero, dudoso: NO_EMPIEZA_NOMBRE.has(primera) && (!articulo || NO_EMPIEZA_NOMBRE.has(segunda)) };
}

/** ¿El nombre dado es EXACTAMENTE el del contacto? (sin tildes, mayúsculas ni signos) */
export function nombreIdentico(dado: string | null | undefined, contacto: string | null | undefined): boolean {
  const a = normalizarNombre(dado);
  return !!a && a === normalizarNombre(contacto);
}

/**
 * ¿El contacto PARECE el nombre dado? Todas las palabras dadas están en su nombre («Paola Rincón» en «Paola
 * Andrea Rincón Díaz»; «Mauricio» en «Mauricio Moreno»), cada una tal cual o con un error de tipeo si es de
 * cinco letras o más («Gomes» por «Gómez»). Nunca une: solo hace que se pregunte.
 */
export function pareceNombre(dado: string | null | undefined, contacto: string | null | undefined): boolean {
  const ws = palabrasDelNombre(dado);
  const suyas = palabrasDelNombre(contacto);
  if (ws.length === 0 || suyas.length === 0) return false;
  return ws.every(w => suyas.some(s => s === w || (w.length >= 5 && s.length >= 5 && distancia(w, s) <= 1)));
}

// ── El resolvedor (§3.2) ────────────────────────────────────────────────────

/**
 * ¿Quién es el cliente? Decide con lo que trajo la base (`porLlave`: las filas de `buscar_contacto_duplicado`
 * para la llave dada; `porNombre`: las de `buscar_clientes_por_nombre`). `null` en cualquiera = la consulta
 * falló: nada se crea (`error`). `undefined` = no se consultó (no había llave o nombre).
 *
 *   1. Por la llave. Un dueño con el mismo nombre (o sin nombre dado) es esa persona; un dueño con OTRO nombre
 *      es `llave_de_otro` (se pregunta, nunca se crea). Varios dueños (celular compartido): desempata el
 *      nombre (`mismoNombre`, la regla del webhook de Meta); si no desempata, se pregunta cuál.
 *   2. Por el nombre en todo el directorio. Idéntico y único: es él, mostrado con su dato (decisión 2).
 *      Varios idénticos, o solo parecidos: se pregunta cuál, o si es otra persona.
 *   3. Nadie: con llave, cliente nuevo (se crea con el «sí» del resumen); sin llave, se pide una (decisión 1).
 *
 * `descartadas`: los contactos que el comercial ya dijo que NO son (la llave de otro, «es otra persona»).
 */
export function resolverCliente(p: {
  nombre: string | null | undefined;
  llave: Llave | null | undefined;
  porLlave?: ReadonlyArray<FichaCliente> | null;
  porNombre?: ReadonlyArray<FichaCliente> | null;
  descartadas?: ReadonlyArray<string>;
  /** El comercial dijo que no es ninguno de los parecidos: el nombre ya no busca. */
  otraPersona?: boolean;
}): ResolucionCliente {
  const nombre = String(p.nombre ?? '').trim() || null;
  const llave = tieneLlave(p.llave) ? p.llave : null;
  const fuera = new Set(p.descartadas ?? []);
  if (llave) {
    if (p.porLlave === null) return { tipo: 'error', nombre, llave };
    const duenos = p.porLlave ?? [];
    if (duenos.length > 0) {
      const mismos = nombre ? duenos.filter(c => mismoNombre(c.nombre, nombre)) : [...duenos];
      if (mismos.length === 1) return { tipo: 'existente', ficha: mismos[0], por: 'llave', nombre, llave };
      if (mismos.length > 1) return { tipo: 'elegir', opciones: mismos.slice(0, MAX_OPCIONES_CLIENTE), motivo: 'llave_compartida', nombre, llave };
      const vivos = duenos.filter(c => !fuera.has(c.id));
      if (vivos.length === 0) return { tipo: 'llave_de_otro', ficha: duenos[0], nombre, llave };
      if (vivos.length === 1) return { tipo: 'llave_de_otro', ficha: vivos[0], nombre, llave };
      return { tipo: 'elegir', opciones: vivos.slice(0, MAX_OPCIONES_CLIENTE), motivo: 'llave_compartida', nombre, llave };
    }
  }
  if (!nombre) return llave ? { tipo: 'sin_nombre', llave } : { tipo: 'sin_nombre' };
  if (!p.otraPersona) {
    if (p.porNombre === null) return { tipo: 'error', nombre, llave };
    const filas = (p.porNombre ?? []).filter(c => !fuera.has(c.id));
    const identicos = filas.filter(c => nombreIdentico(nombre, c.nombre));
    if (identicos.length === 1) return { tipo: 'existente', ficha: identicos[0], por: 'nombre', nombre, llave };
    if (identicos.length > 1) return { tipo: 'elegir', opciones: identicos.slice(0, MAX_OPCIONES_CLIENTE), motivo: 'homonimos', nombre, llave };
    const parecidos = filas.filter(c => pareceNombre(nombre, c.nombre));
    if (parecidos.length > 0) return { tipo: 'elegir', opciones: parecidos.slice(0, MAX_OPCIONES_CLIENTE), motivo: 'parecidos', nombre, llave };
  }
  return llave ? { tipo: 'nuevo', nombre, llave } : { tipo: 'pedir_llave', nombre };
}

/** ¿La resolución ya dice a quién va el viaje (un contacto, o un cliente nuevo con su llave)? */
export function clienteListo(r: ResolucionCliente): boolean {
  return r.tipo === 'existente' || r.tipo === 'nuevo';
}

// ── Cómo se le muestra al comercial ─────────────────────────────────────────

/** «cel. …9444», «con correo», «sin celular ni correo»: lo que distingue a un contacto sin mostrar su dato completo. */
export function datoDeLaFicha(f: FichaCliente): string {
  if (f.cel4) return `cel. …${f.cel4}`;
  if (f.correo) return 'con correo';
  if (f.usuario) return 'con usuario de WhatsApp o Instagram';
  return 'sin celular ni correo';
}

/** «5 viajes abiertos», «un viaje abierto: Miami 7N», «último viaje: Cartagena mar», «sin viajes». */
export function viajesDeLaFicha(f: FichaCliente): string {
  const n = f.abiertos.length;
  if (n === 1) return `un viaje abierto: ${nombreViaje(f.abiertos[0])}`;
  if (n > 1) return `${n} viajes abiertos`;
  if (f.cerrado) return `último viaje: ${nombreViaje(f.cerrado)}`;
  return 'sin viajes';
}

function nombreViaje(v: { codigo: string | null; nombre: string | null }): string {
  return String(v.nombre ?? '').trim() || String(v.codigo ?? '').trim() || 'sin nombre';
}

/** «Mauricio Moreno (cel. …9444, 5 viajes abiertos)». */
export function fichaEnUnaLinea(f: FichaCliente): string {
  return `${nombrePropio(f.nombre)} (${datoDeLaFicha(f)}, ${viajesDeLaFicha(f)})`;
}

/** «A», «A y B», «A, B y C». */
function enumerar(xs: ReadonlyArray<string>, y = 'y'): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${y} ${xs[xs.length - 1]}`;
}

/** Lo que el bot pide cuando dicen «viaje nuevo» sin decir de quién (D1). */
export const TEXTO_PIDE_CLIENTE = 'Listo, un viaje nuevo. ¿Para qué cliente es?';
/** Lo que sigue a un acuse de viaje nuevo con el cliente claro. */
const SIGUE = 'Reenvíame lo que te pidió y al final te muestro el resumen.';

/**
 * La pregunta o el acuse del cliente de un viaje nuevo, en el acto (§3.3: una sola cosa por mensaje, la
 * pregunta arriba, sin comandos en mayúsculas). Los hechos salen de la resolución; nunca el celular completo
 * de un contacto que ya existe.
 */
export function textoDelCliente(r: ResolucionCliente, opts: { conContenido?: boolean } = {}): string {
  const sigue = opts.conContenido ? 'Ya lo anoté; reenvíame lo demás y al final te muestro el resumen.' : SIGUE;
  switch (r.tipo) {
    case 'existente': {
      const nota = fraseDeLaLlave(r.ficha, r.llave);
      return `Va como viaje nuevo de ${nombrePropio(r.ficha.nombre)}, el que ya tenemos (${datoDeLaFicha(r.ficha)}, ${viajesDeLaFicha(r.ficha)}).${nota ? `\n${nota}` : ''}\n${sigue}`;
    }
    case 'nuevo':
      return `Va como viaje nuevo de ${String(r.nombre).trim()}, cliente nuevo (${textoLlave(r.llave)}). Lo creo cuando me digas que sí en el resumen.\n${sigue}`;
    case 'pedir_llave':
      return `No tengo a ${String(r.nombre).trim()} en el directorio. ¿Me pasas su celular o su correo? Así reviso que no lo tengamos con otro nombre, y sin uno de los dos no lo creo.`;
    case 'llave_de_otro':
      return `Ese ${cualLlave(r.llave)} ya lo tenemos a nombre de ${nombrePropio(r.ficha.nombre)} (${viajesDeLaFicha(r.ficha)}). ¿Es la misma persona?`;
    case 'elegir':
      return textoElegirCliente(r);
    case 'sin_nombre':
      return r.llave ? `No tengo a nadie con ${textoLlave(r.llave)}. ¿Cómo se llama? Mientras tanto guardo lo que me mandes.` : TEXTO_PIDE_CLIENTE;
    case 'error':
      return 'No pude revisar el directorio de clientes. No creo a nadie sin revisarlo: vuelve a escribirme el nombre en un momento.';
  }
}

/** «Tengo dos Andrés Gómez: uno con cel. …4410 (un viaje abierto: Miami) y otro con correo (sin viajes). ¿Cuál es, o es otra persona?» */
export function textoElegirCliente(r: Extract<ResolucionCliente, { tipo: 'elegir' }>): string {
  const ops = r.opciones;
  const nombre = String(r.nombre ?? '').trim();
  const detalle = (f: FichaCliente) => `${datoDeLaFicha(f)}, ${viajesDeLaFicha(f)}`;
  // Con cuatro o más, la lista numerada (que acepta también palabras).
  if (ops.length >= 4) {
    return [`Tengo ${ops.length} contactos que pueden ser ${nombre || 'el cliente'}. ¿Cuál es, o es otra persona?`,
      ...ops.map((f, i) => `${i + 1}. ${nombrePropio(f.nombre)} (${detalle(f)})`)].join('\n');
  }
  if (r.motivo === 'homonimos') {
    const cuantos = ops.length === 2 ? 'dos' : 'tres';
    const partes = ops.map((f, i) => `${['el primero', 'el segundo', 'el tercero'][i]}, ${datoDeLaFicha(f)} (${viajesDeLaFicha(f)})`);
    return `Tengo ${cuantos} ${nombrePropio(ops[0].nombre)}: ${partes.join('; ')}. ¿Cuál es, o es otra persona?`;
  }
  if (r.motivo === 'llave_compartida') {
    return `Ese ${r.llave ? cualLlave(r.llave) : 'dato'} lo comparten ${enumerar(ops.map(f => `${nombrePropio(f.nombre)} (${viajesDeLaFicha(f)})`))}. ¿Cuál es, o es otra persona?`;
  }
  if (ops.length === 1) {
    return `No tengo a ${nombre} tal cual. ¿Es ${nombrePropio(ops[0].nombre)} (${detalle(ops[0])}), o es otra persona?`;
  }
  return `No tengo a ${nombre} tal cual. ¿Es ${enumerar(ops.map(f => `${nombrePropio(f.nombre)} (${detalle(f)})`), 'o')}? ¿O es otra persona?`;
}

/** Tras «no es esa persona» a la llave de otro (D2): nunca se crea con esa llave. */
export function textoNoEsLaMisma(nombre: string | null, ficha: FichaCliente): string {
  return `Entonces ${nombre ? `a ${nombre}` : 'a esa persona'} la creas desde la app, para no mezclarla con ${nombrePropio(ficha.nombre)}; o pásame otro celular o correo. Lo de este viaje queda esperando.`;
}

// ── La respuesta del comercial ──────────────────────────────────────────────

/** «es otra», «ninguno», «otra persona», «no es ninguno de esos». */
const OTRA_PERSONA = /\b(?:otra\s+persona|es\s+otr[oa]|otr[oa]\s+client[ea]|ningun[oa]?|nadie|distint[oa]|diferente|no\s+es\s+(?:ese|esa|el|ella|ninguno|ninguna))\b/;
/** Lo que acompaña una elección sin decir nada: «el de …», «es la que …», «la del cel …». */
const RELLENO_ELECCION: ReadonlySet<string> = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'que', 'es', 'era', 'ese', 'esa', 'este', 'esta', 'con', 'cel',
  'celular', 'numero', 'viajo', 'viaja', 'va', 'a', 'al', 'en', 'para', 'si', 'uno', 'una', 'mismo', 'misma', 'cliente', 'clienta', 'por', 'favor', 'tiene',
  'correo', 'termina', 'terminado', 'viaje', 'cotizacion', 'fue',
  // Octavo control de Vera (hallazgo 5): el relleno de una respuesta más larga («me refiero al que tiene el correo»).
  'me', 'refiero', 'quise', 'decir', 'creo', 'seria', 'pues', 'entonces', 'ya', 'ok', 'y', 'su', 'sus', 'tenia', 'cual', 'quien', 'ultimo', 'ultima',
  'vez', 'antes', 'anterior', 'viajo', 'ese', 'esa', 'mismo', 'misma', 'persona', 'senor', 'senora', 'don', 'dona', 'lo', 'le', 'ahi', 'aparece', 'sale',
  'dice', 'dijiste', 'pusiste', 'mostraste', 'lista', 'opcion']);
/** El dato que el bot muestra de cada ficha, nombrado con relleno («el del correo», «la que no tiene celular»). */
const DICE_CORREO = /\b(?:correo|correos|mail|email|e mail|emails|gmail|hotmail|outlook|yahoo|icloud|electronico)\b/;
const DICE_USUARIO = /\b(?:usuario|instagram|insta|arroba)\b/;
const DICE_SIN_DATOS = /\b(?:sin|no\s+tiene|no\s+tenia)\s+(?:celular|cel|numero|telefono|datos|nada)\b/;
const DICE_CELULAR = /\b(?:celular|cel|numero|telefono|whatsapp)\b/;
const ORDINAL: Readonly<Record<string, number>> = { primero: 1, primera: 1, primer: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, tercer: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5 };
const SI_ES: ReadonlySet<string> = new Set(['si', 'sii', 'sip', 'claro', 'exacto', 'correcto', 'dale', 'es', 'ella', 'el', 'esa', 'ese', 'misma', 'mismo', 'la', 'persona', 'asi', 'eso']);

export type EleccionCliente = { tipo: 'ficha'; ficha: FichaCliente } | { tipo: 'otra' } | null;

/**
 * La respuesta a «¿Cuál es, o es otra persona?»: el número u ordinal («2», «el segundo»), los 4 dígitos
 * («el del 4410»), lo que lo distingue («el de Miami», «Paola Andrea»), un «sí, es ese» con una sola opción,
 * u «otra persona» / «ninguno». `null`: no se entiende (se vuelve a preguntar; nunca se elige por descarte).
 */
export function leerEleccionCliente(texto: string, opciones: ReadonlyArray<FichaCliente>): EleccionCliente {
  const t = normalizarNombre(texto);
  if (!t) return null;
  if (OTRA_PERSONA.test(t)) return { tipo: 'otra' };
  const ws = t.split(' ').filter(Boolean);
  // Número u ordinal: «2», «el 2», «la segunda», «opción 2».
  const num = /^(?:(?:el|la|opcion|numero)\s+)?(\d)$/.exec(t)?.[1];
  // El ordinal, también dentro de una frase («me refiero al segundo que me mostraste»), si es el único.
  const ordinales = [...new Set(ws.map(w => ORDINAL[w]).filter(x => !!x))];
  const k = num ? Number(num) : ws.length <= 8 && ordinales.length === 1 && !/\d/.test(t) ? ordinales[0] : null;
  if (k) return opciones[k - 1] ? { tipo: 'ficha', ficha: opciones[k - 1] } : null;
  // Los 4 últimos dígitos.
  const dig = /\b(\d{4})\b/.exec(t)?.[1];
  if (dig) {
    const f = opciones.filter(o => o.cel4 === dig);
    return f.length === 1 ? { tipo: 'ficha', ficha: f[0] } : null;
  }
  // «sí», «es ella», «esa misma» con una sola opción.
  if (opciones.length === 1 && ws.every(w => SI_ES.has(w))) return { tipo: 'ficha', ficha: opciones[0] };
  // Noveno control (hallazgo 5): haber viajado o no, dicho con sus palabras («el que ya viajó con nosotros», «el que
  // nunca ha viajado»), si solo una de las opciones lo cumple.
  const unico = (cumple: (f: FichaCliente) => boolean) => { const f = opciones.filter(cumple); return f.length === 1 ? { tipo: 'ficha' as const, ficha: f[0] } : null; };
  const conViajes = (f: FichaCliente) => f.abiertos.length > 0 || !!f.cerrado;
  if (/\b(?:nunca\s+(?:ha\s+)?viaj\w*|no\s+ha\s+viajado|sin\s+viajes|no\s+tiene\s+viajes|el\s+nuevo|la\s+nueva)\b/.test(t)) {
    const r = unico(f => !conViajes(f));
    if (r) return r;
  } else if (/\b(?:ya\s+(?:viajo|ha\s+viajado|habia\s+viajado|fue\s+cliente|compro)|ha\s+viajado|viajo\s+con\s+nosotros|tiene\s+viajes|el\s+de\s+antes|el\s+antiguo|la\s+antigua|el\s+conocido|la\s+conocida)\b/.test(t)) {
    const r = unico(conViajes);
    if (r) return r;
  }
  // El dato que el bot mostró y que la distingue («el del correo», «el que no tiene celular»), si lo tiene una sola.
  const porDato = (cumple: (f: FichaCliente) => boolean) => { const f = opciones.filter(cumple); return f.length === 1 ? { tipo: 'ficha' as const, ficha: f[0] } : null; };
  const dato = DICE_SIN_DATOS.test(t) ? porDato(f => !f.cel4 && !f.correo && !f.usuario)
    : DICE_CORREO.test(t) ? porDato(f => !f.cel4 && f.correo)
    : DICE_USUARIO.test(t) ? porDato(f => !f.cel4 && !f.correo && !!f.usuario)
    : DICE_CELULAR.test(t) && !/\bno\b/.test(t) ? porDato(f => !!f.cel4)
    : null;
  if (dato && ws.filter(w => !RELLENO_ELECCION.has(w)).every(w => /^(?:correo|correos|mail|email|emails|electronico|e|gmail|hotmail|outlook|yahoo|icloud|usuario|instagram|insta|arroba|sin|no|ni|tiene|tenia|celular|cel|numero|telefono|whatsapp|datos|nada|ficha|contacto)$/.test(w))) return dato;
  // «el de Miami», «Paola Andrea»: las palabras que quedan están en lo de UN solo contacto.
  const resto = ws.filter(w => !RELLENO_ELECCION.has(w));
  if (resto.length === 0) return null;
  const suyas = (f: FichaCliente) => new Set(palabrasDelNombre([f.nombre, ...f.abiertos.map(v => `${v.nombre ?? ''} ${v.codigo ?? ''}`), f.cerrado?.nombre ?? ''].join(' ')));
  const cuales = opciones.filter(f => { const s = suyas(f); return resto.every(w => s.has(w)); });
  return cuales.length === 1 ? { tipo: 'ficha', ficha: cuales[0] } : null;
}

/** La respuesta a «Ese celular ya lo tenemos a nombre de X. ¿Es la misma persona?»: `si`, `no` o `null`. */
export function leerEsLaMisma(texto: string): 'si' | 'no' | null {
  const t = normalizarNombre(texto);
  if (!t) return null;
  if (/^(?:no|nop|nel|negativo)\b/.test(t) || /\b(?:otra persona|no es (?:ella|el|la misma|el mismo)|es otr[oa]|son (?:dos|distint[oa]s))\b/.test(t)) return 'no';
  const ws = t.split(' ');
  return ws.every(w => SI_ES.has(w) || ['ok', 'listo', 'correcto', 'exacto', 'efectivamente', 'tal', 'cual', 'se', 'registro', 'con', 'nombre', 'completo'].includes(w))
    && ws.some(w => ['si', 'sii', 'sip', 'claro', 'exacto', 'correcto', 'efectivamente', 'es', 'misma', 'mismo'].includes(w)) ? 'si' : null;
}

// ── El directorio que ve una tanda ──────────────────────────────────────────

/**
 * Lo que la base dijo de los nombres y las llaves de una tanda, para decidir sin I/O (`armarSegmentos` lo
 * lee en cada pasada). `null`: la consulta falló. `undefined`: no se consultó.
 */
export interface Directorio {
  porNombre(nombre: string): ReadonlyArray<FichaCliente> | null | undefined;
  porLlave(llave: Llave): ReadonlyArray<FichaCliente> | null | undefined;
}

/** La llave como clave de un mapa: «c:3005551234|m:|u:». */
export function claveDeLlave(l: Llave): string {
  return `c:${l.celular ?? ''}|m:${l.correo ?? ''}|u:${l.usuario ?? ''}`;
}

/** El nombre como clave de un mapa (sin tildes ni mayúsculas). */
export function claveDeNombre(n: string): string {
  return normalizarNombre(n);
}

/** Un directorio armado con lo que se consultó. */
export function directorioDesde(
  nombres: ReadonlyMap<string, ReadonlyArray<FichaCliente> | null>,
  llaves: ReadonlyMap<string, ReadonlyArray<FichaCliente> | null>,
): Directorio {
  return {
    porNombre: n => nombres.get(claveDeNombre(n)),
    porLlave: l => llaves.get(claveDeLlave(l)),
  };
}

/**
 * `resolverCliente` con lo que dijo el directorio. Lo que el directorio no consultó cuenta como una falla
 * (`error`): nunca como «no hay nadie», que llevaría a crear.
 */
export function resolverConDirectorio(dir: Directorio, p: {
  nombre: string | null | undefined; llave: Llave | null | undefined; descartadas?: ReadonlyArray<string>; otraPersona?: boolean;
}): ResolucionCliente {
  // Noveno control (hallazgo 1): el cliente es el tramo del escrito que el directorio tiene exacto; un nombre que
  // arranca con una fórmula que no es de nadie se pregunta («¿cómo se llama?»), no se crea con el prefijo.
  const leido = p.otraPersona ? { nombre: String(p.nombre ?? '').trim(), dudoso: false } : nombreEnElDirectorio(p.nombre, dir);
  const nombre = leido.dudoso ? '' : leido.nombre;
  const llave = tieneLlave(p.llave) ? p.llave : null;
  const porLlave = llave ? dir.porLlave(llave) : undefined;
  const porNombre = nombre && !p.otraPersona ? dir.porNombre(nombre) : undefined;
  return resolverCliente({
    nombre, llave, descartadas: p.descartadas, otraPersona: p.otraPersona,
    porLlave: llave ? (porLlave === undefined ? null : porLlave) : undefined,
    porNombre: nombre && !p.otraPersona ? (porNombre === undefined ? null : porNombre) : undefined,
  });
}
