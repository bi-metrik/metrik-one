// ============================================================
// La bandeja de WhatsApp carga en un negocio EXISTENTE — las reglas, sin I/O
// ------------------------------------------------------------
// Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-30-bandeja-a-negocio-existente.md
//
// El comercial reenvía la segunda y la tercera conversación con el cliente, que es donde se
// completa la solicitud. Al cerrar la entrega el bot pregunta «¿A qué viaje van?» con una lista
// corta numerada y «NUEVO». Aquí vive lo que se DECIDE; `wa-entendimiento.ts` lo ejecuta.
//
// Reglas que no se negocian:
//   1. Nunca se carga solo en un negocio existente: aunque los mensajes nombren a un cliente
//      con un único negocio abierto, ese se PROPONE primero y se pregunta igual.
//   2. En un negocio existente un valor escrito o confirmado por una persona no se pisa: si el
//      mensaje dice otra cosa, queda como conflicto en `_conflictos[slug]` y lo decide una persona.
//   3. Lo que el bot sugirió y NADIE confirmó (sigue en `_sugeridos`, sin `_ediciones`) sí se
//      actualiza con el mensaje nuevo (2026-10-01): el valor anterior queda en la marca
//      (`anterior`) y el bot lo dice («Actualicé adultos: 2 → 3»).
// ============================================================

import { aplanarBloques, calcularNiveles, parsearNumeroColombiano } from './niveles-solicitud.ts';
import {
  aplicarSumas,
  CLAVE_SUGERIDOS,
  deducirCeros,
  LO_LLENA_AGENCIA,
  fraseNombraNumero,
  calificarNombreNuevo,
  leerNuevo,
  marcaDe,
  mayusculasDeViaje,
  nombreDeViaje,
  nombrePropio,
  normalizarNombre,
  normalizarTexto,
  preguntasDelMinimo,
  type CampoEntendible,
  type MarcaSugerido,
  type Sugerido,
} from './wa-entendimiento-reglas.ts';

// ── La lista de «¿A qué viaje van?» ──────────────────────────────────────────

export const MAX_OPCIONES_NEGOCIO = 5;

/** Un negocio abierto de la línea, como lo trae la consulta. */
export interface NegocioAbierto {
  id: string;
  codigo: string | null;
  /** Nombre del contacto (o de la empresa) del negocio. */
  cliente: string | null;
  /** Llave del cliente para contar sus negocios: el contacto, o el nombre si no hay. */
  cliente_id: string | null;
  destino: string | null;
  /** El nombre del negocio («Europa 2 días»): como lo recuerda el comercial. */
  nombre?: string | null;
  created_at: string;
  /** ¿El remitente es responsable de este negocio? */
  del_remitente: boolean;
}

/** Lo que se guarda en `wa_bandeja_entregas.negocio_opciones`, en el orden en que se ofreció. */
export interface OpcionNegocio {
  id: string;
  codigo: string | null;
  cliente: string | null;
  destino: string | null;
  nombre?: string | null;
  /** Lo nombran los mensajes y es su único negocio abierto: va primero. */
  propuesto?: boolean;
}

/** Lo que acompaña una referencia a un viaje de la lista sin nombrarlo: «el de», «la que va a», «el del cliente». */
const RELLENO_REFERENCIA: ReadonlySet<string> = new Set(['el', 'la', 'los', 'las', 'lo', 'de', 'del', 'que', 'va', 'van', 'a', 'al', 'para', 'viaje',
  'cotizacion', 'es', 'era', 'seria', 'ese', 'esa', 'este', 'esta', 'en', 'con', 'cliente', 'clienta', 'senor', 'senora', 'por', 'favor', 'porfa', 'uno',
  'una', 'mismo', 'misma', 'destino', 'hacia', 'sale', 'salen', 'rumbo', 'pa', 'y',
  // Noveno control (hallazgo 8): el demostrativo plural y el verbo de ir («esos van en el de Cartagena»).
  'esos', 'esas', 'estos', 'estas', 'aquellos', 'aquellas', 'ir', 'vamos', 'vaya', 'vayan', 'iria', 'irian', 'iran',
  // El tratamiento del cliente («el de San Andrés de don Diego»: conversación con memoria, 2026-10-05).
  'don', 'dona', 'sr', 'sra']);
/** «el de», «la de», «la que va a», «del»: la respuesta SEÑALA un viaje, no nombra a una persona. */
const SENALA_VIAJE = /^(?:(?:es|era|seria)\s+)?(?:(?:para|pa|en|a)\s+)?(?:el|la|lo|al|del)\s+(?:de|del|que)?\b|^del?\b/;

/**
 * El viaje de la lista que la respuesta nombra con sus palabras (2026-10-05: las listas ya no piden «el número o el
 * código»): «el de Cartagena», «la de Lina», «Europa 2 días», «el que va a Miami». Todas las palabras que quedan sin
 * el relleno tienen que estar en el nombre, el destino o el cliente de UNA sola opción. Si solo coinciden palabras del
 * cliente, tiene que señalar («el de Lina»): «Ana Ríos» a secas puede ser el nombre de un cliente nuevo. Con dígitos,
 * no (el número y el código ya se leen aparte). `null`: ninguna o más de una.
 */
export function opcionNombrada<T extends { codigo?: string | null; cliente?: string | null; destino?: string | null; nombre?: string | null }>(
  texto: string, opciones: ReadonlyArray<T>,
): T | null {
  const t = normalizarNombre(texto);
  if (!t || /\d/.test(t)) return null;
  const ws = t.split(' ').filter(w => w && !RELLENO_REFERENCIA.has(w));
  if (ws.length === 0 || ws.length > 5) return null;
  const senala = SENALA_VIAJE.test(t);
  const delViaje = (o: T) => new Set(normalizarNombre(`${o.nombre ?? ''} ${o.destino ?? ''}`).split(' ').filter(Boolean));
  const delCliente = (o: T) => new Set(normalizarNombre(o.cliente).split(' ').filter(Boolean));
  const cuales = opciones.filter(o => {
    const v = delViaje(o);
    const c = delCliente(o);
    if (!ws.every(w => v.has(w) || c.has(w))) return false;
    return senala || ws.some(w => v.has(w));
  });
  return cuales.length === 1 ? cuales[0] : null;
}

function palabrasDelNombre(nombre: string | null): string[] {
  return [...new Set(normalizarNombre(nombre).split(' ').filter(w => w.length >= 3))];
}

/**
 * ¿Los mensajes nombran a este cliente? Hace falta ver DOS palabras de su nombre como palabras
 * sueltas del texto («Marta Gómez», «la señora Gómez, Marta»). Un nombre de una sola palabra
 * no cuenta: «Marta» aparece en demasiadas conversaciones para proponer nada con eso.
 */
export function nombraAlCliente(texto: string, cliente: string | null): boolean {
  const suyas = palabrasDelNombre(cliente);
  if (suyas.length < 2) return false;
  const delTexto = new Set(normalizarNombre(texto).split(' '));
  return suyas.filter(w => delTexto.has(w)).length >= 2;
}

const porReciente = (a: NegocioAbierto, b: NegocioAbierto) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);

function aOpcion(n: NegocioAbierto, propuesto = false): OpcionNegocio {
  const o: OpcionNegocio = { id: n.id, codigo: n.codigo, cliente: n.cliente, destino: n.destino, nombre: n.nombre ?? null };
  if (propuesto) o.propuesto = true;
  return o;
}

/**
 * La lista: los negocios abiertos de la línea donde el remitente es responsable (o todos, si no
 * tiene ninguno), del más reciente al más viejo, máximo cinco. Si los mensajes nombran a UN solo
 * cliente y ese cliente tiene UN solo negocio abierto, ese va primero con `propuesto`.
 *
 * @param negocios todos los abiertos de la línea (no solo los del remitente): el propuesto
 *                 puede ser de otro comercial.
 */
export function armarOpcionesNegocio(negocios: ReadonlyArray<NegocioAbierto>, textoMensajes: string): OpcionNegocio[] {
  const suyos = negocios.filter(n => n.del_remitente);
  const base = [...(suyos.length > 0 ? suyos : negocios)].sort(porReciente);

  const porCliente = new Map<string, NegocioAbierto[]>();
  for (const n of negocios) {
    const llave = n.cliente_id ?? normalizarNombre(n.cliente);
    if (!llave) continue;
    porCliente.set(llave, [...(porCliente.get(llave) ?? []), n]);
  }
  const nombrados = [...porCliente.values()].filter(ns => nombraAlCliente(textoMensajes, ns[0].cliente));
  const propuesto = nombrados.length === 1 && nombrados[0].length === 1 ? nombrados[0][0] : null;

  const lista = propuesto ? [aOpcion(propuesto, true), ...base.filter(n => n.id !== propuesto.id).map(n => aOpcion(n))] : base.map(n => aOpcion(n));
  return lista.slice(0, MAX_OPCIONES_NEGOCIO);
}

/** «Europa 2 días · Marta Gómez (T1 26 14)» (`nombreDeViaje`). */
export function lineaDeOpcion(o: OpcionNegocio): string {
  return nombreDeViaje(o);
}

/** El pie de la lista (2026-10-05, PR B): sin comandos en mayúsculas; lo que acepta la respuesta no cambia (también «SÍ», «NUEVO», «DESCARTAR»). */
/**
 * Cómo se le dice al comercial que señale un viaje de la lista sin pedirle el número ni el código (2026-10-05): «el de
 * Cartagena» (el destino de una sola opción) o «el de Lina» (el primer nombre de un solo cliente). `null`: nada que
 * distinga. La respuesta la lee `opcionNombrada`; el número y el código siguen valiendo, sin anunciarse.
 */
export function ejemploDeReferencia(opciones: ReadonlyArray<{ cliente?: string | null; destino?: string | null; nombre?: string | null }>): string | null {
  const unico = (k: (o: typeof opciones[number]) => string) => opciones.map(k).find(x => !!x && opciones.filter(o => k(o) === x).length === 1) ?? null;
  // El destino entero («el de San Andrés», no «el de Andrés», que parece una persona).
  const destino = unico(o => normalizarNombre(o.destino));
  if (destino) {
    const o = opciones.find(x => normalizarNombre(x.destino) === destino)!;
    return `el de ${nombrePropio(String(o.destino ?? '').trim().toLocaleUpperCase('es-CO'))}`;
  }
  const pila = unico(o => normalizarNombre(o.cliente).split(' ')[0] ?? '');
  if (pila) {
    const o = opciones.find(x => normalizarNombre(x.cliente).split(' ')[0] === pila)!;
    return `el de ${nombrePropio(String(o.cliente ?? '').trim().split(/\s+/)[0])}`;
  }
  return null;
}

/** El pie de una lista de viajes: dime cuál, con un ejemplo de cómo; sin «el número o el código». */
export function pieDeLista(opciones: ReadonlyArray<{ cliente?: string | null; destino?: string | null; nombre?: string | null }>, cierre: string): string {
  const ej = ejemploDeReferencia(opciones);
  return `Dime cuál${ej ? ` (por ejemplo «${ej}»)` : ''}. ${cierre}`;
}
const PIE_NUEVO = 'Si es un viaje nuevo, escribe «nuevo» y el nombre del cliente; si no va, «descartar».';

/**
 * La pregunta. Sin negocios abiertos solo se ofrece NUEVO. `aviso` antecede cuando se vuelve a
 * preguntar («No entendí…»).
 */
export function textoPreguntaNegocio(p: { nMensajes: number; opciones: ReadonlyArray<OpcionNegocio>; aviso?: string; hibrido?: boolean }): string {
  const n = p.nMensajes;
  const cuales = n === 1 ? 'es el mensaje' : n > 1 ? `son los ${n} mensajes` : 'son';
  // Una pregunta, arriba (el aviso de «No entendí…» va en la misma línea).
  const conAviso = (q: string) => (p.aviso ? `${p.aviso} ${q}` : q);
  if (p.opciones.length === 0) {
    return conAviso(`¿De qué cliente ${cuales}? No tienes viajes abiertos: escribe «nuevo» y su nombre, o «descartar».`);
  }
  const prop = p.opciones[0]?.propuesto ? ` Parece de ${nombreDeViaje({ cliente: p.opciones[0].cliente })} (el 1).` : '';
  return [
    conAviso(`¿De qué viaje ${cuales}?${prop}`),
    ...p.opciones.map((o, i) => `${i + 1}. ${lineaDeOpcion(o)}`),
    // Bot híbrido (2026-10-06): la pregunta sale con la lista; elegir el viaje con el toque o el número. Con palabras, el
    // bot propone el viaje y pide el toque o el «sí». Sin el bot híbrido, como antes: «el de Cartagena».
    p.hibrido ? `Tócalo en la lista o escribe su número. ${PIE_NUEVO}` : pieDeLista(p.opciones, PIE_NUEVO),
  ].join('\n');
}

// ── La respuesta ─────────────────────────────────────────────────────────────

export type RespuestaNegocio =
  | { tipo: 'existente'; negocio_id: string }
  /** Un código que no está en la lista: se busca entre los abiertos del workspace. */
  | { tipo: 'codigo'; codigo: string }
  /** `cliente`: lo que escribió después de NUEVO («NUEVO Marta Gómez»), o null. */
  | { tipo: 'nuevo'; cliente: string | null }
  /**
   * «nueva reserva», «nuevo Pérez»: un «nuevo» con algo que no parece un nombre (`calificarNombreNuevo`).
   * No crea a nadie: el bot vuelve a preguntar con la lista y pide nombre y apellido (control de Vera, NU5).
   */
  | { tipo: 'nuevo_en_duda'; propuesto: string }
  /** «DESCARTAR»: los mensajes no son de ningún viaje (prueba en vivo v2, N2). */
  | { tipo: 'descartar' }
  | { tipo: 'no_entendida' };

/** El código sin espacios ni signos, en mayúscula: «t1 26 14» y «T12614» son el mismo. */
export function codigoCompacto(t: string | null | undefined): string {
  return String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Letra(s) y dígitos: la forma de los códigos de negocio («T1 26 14», «S1 26 3»). */
function pareceCodigo(compacto: string): boolean {
  return /^[A-Z]{1,3}\d{3,}$/.test(compacto) && compacto.length <= 12;
}

/**
 * La respuesta a «¿A qué viaje van?»: el número de la lista, un código, «NUEVO nombre», «DESCARTAR» o
 * el nombre de un negocio o de un cliente de la lista (prueba en vivo v2 del 2026-10-01, N2: la
 * pregunta no se podía contestar). Un nombre que no está en la lista lo busca quien llama entre todos
 * los viajes abiertos.
 */
export function interpretarRespuestaNegocio(texto: string, opciones: ReadonlyArray<OpcionNegocio>): RespuestaNegocio {
  const bruto = String(texto ?? '').trim();
  const t = normalizarTexto(bruto);
  if (/^descart(ar|a|alo|alos|en)?[.!]*$/.test(t)) return { tipo: 'descartar' };
  const num = /^(\d{1,2})\.?$/.exec(t);
  if (num) {
    const i = Number(num[1]) - 1;
    return i >= 0 && i < opciones.length ? { tipo: 'existente', negocio_id: opciones[i].id } : { tipo: 'no_entendida' };
  }
  // «nuevo X», «cliente nuevo X», «otro cliente» (sin nombre: se pide), como en el encabezado (`leerNuevo`),
  // con la misma regla del nombre (`calificarNombreNuevo`): «nueva cotización con hotel 4 estrellas» no se
  // entiende (control de Vera, I3) y «nueva reserva» es duda: se pregunta, nunca se crea (NU5).
  const nuevo = leerNuevo(bruto);
  if (nuevo) {
    const c = calificarNombreNuevo(nuevo.cliente);
    if (c === 'largo') return { tipo: 'no_entendida' };
    if (c === 'duda') return { tipo: 'nuevo_en_duda', propuesto: nuevo.cliente ?? '' };
    return { tipo: 'nuevo', cliente: nuevo.cliente };
  }
  const c = codigoCompacto(bruto);
  if (c) {
    const enLista = opciones.find(o => codigoCompacto(o.codigo) === c);
    if (enLista) return { tipo: 'existente', negocio_id: enLista.id };
    if (pareceCodigo(c)) return { tipo: 'codigo', codigo: c };
  }
  // El nombre del negocio («Europa 2 días») o del cliente («Marta Gómez»), tal cual, en la lista.
  const compacto = (x: string | null | undefined) => normalizarNombre(x).replace(/ /g, '');
  const n = compacto(bruto);
  const porNombre = n ? opciones.filter(o => compacto(o.nombre) === n || compacto(o.cliente) === n) : [];
  if (porNombre.length === 1) return { tipo: 'existente', negocio_id: porNombre[0].id };
  // «el de Cartagena», «la de Lina»: el viaje de la lista que la respuesta señala con sus palabras.
  const nombrada = opcionNombrada(bruto, opciones);
  if (nombrada) return { tipo: 'existente', negocio_id: nombrada.id };
  return { tipo: 'no_entendida' };
}

// ── Cargar sin pisar ─────────────────────────────────────────────────────────

/**
 * Lo que el mensaje dijo distinto a lo que el negocio ya tiene. Vive en
 * `negocio_bloques.data._conflictos[slug]` (espacio de nombres del servidor: el navegador no lo
 * escribe). La pantalla lo muestra en el campo y la persona decide: usar el valor del mensaje
 * (lo escribe como cualquier edición y la marca se va) o dejar el actual (se quita la marca).
 * Mismo formato que lee `src/lib/negocios/sugeridos.ts`.
 */
export interface MarcaConflicto {
  fuente: 'whatsapp';
  entrega_id: string;
  /** Lo que dijo el mensaje. */
  valor: string | number;
  frase: string;
  en: string;
  /** Si la frase salió de una nota de voz o de un texto. */
  origen: 'audio' | 'mensaje';
}

export const CLAVE_CONFLICTOS = '_conflictos';

const vacio = (v: unknown) => v === '' || v === null || v === undefined;

/** ¿Dicen lo mismo? Números por su valor; lo demás sin tildes, mayúsculas ni espacios de más. */
export function mismoValor(f: CampoEntendible, a: unknown, b: unknown): boolean {
  if (f.tipo === 'numero') {
    const x = parsearNumeroColombiano(a);
    const y = parsearNumeroColombiano(b);
    return x !== null && x === y;
  }
  return normalizarTexto(String(a ?? '')) === normalizarTexto(String(b ?? ''));
}

export interface Conflicto {
  slug: string;
  actual: unknown;
  valor: string | number;
  frase: string;
}

/** Un sugerido que nadie confirmó y el mensaje nuevo reemplazó. */
export interface Actualizado {
  slug: string;
  anterior: unknown;
  valor: string | number;
  frase: string;
}

/**
 * Mete lo entendido en la `data` de un bloque de un negocio que YA existe.
 *   · campo vacío y sin corrección registrada → se escribe, con su marca en `_sugeridos`;
 *   · mismo valor que ya tiene → nada (el mensaje lo confirma);
 *   · otro valor sobre un SUGERIDO que nadie confirmó (sigue en `_sugeridos`, sin
 *     `_ediciones`) → se reemplaza; la marca guarda el `anterior` y se va a `actualizados`;
 *   · otro valor sobre lo escrito o confirmado por una persona → NO se toca; queda en
 *     `_conflictos[slug]`.
 * A diferencia de `fusionarSugeridos` (negocio recién creado), aquí un `default` cuenta como
 * valor: en un negocio vivo no se sabe si una persona lo dejó a propósito.
 *
 * @param yaVistos slugs que otro bloque del mismo negocio ya atendió (un slug repetido se
 *                 queda con el primer bloque, como en `aplanarBloques`). Se completa aquí.
 * @param opts.delModelo `true` en el núcleo conversacional: ahí el modelo decide qué número dijeron («él con su
 *                 esposa» son 2 adultos) y qué calculó (su `deduccion` es la explicación del cálculo, no una
 *                 deducción del código), y el comercial lo confirma con su toque. Así no corren las dos reglas del
 *                 flujo viejo de la bandeja: la frase tiene que decir la cifra nueva, y una deducción no reemplaza.
 * @param opts.quitar campos que el comercial pidió QUITAR («el presupuesto está abierto», núcleo conversacional,
 *                 2026-10-07). Acción explícita, nunca implícita: un campo que falta en `sugeridos` no se toca. Se
 *                 quita solo un SUGERIDO sin confirmar (con marca en `_sugeridos`, sin `_ediciones`); lo que
 *                 escribió o confirmó una persona en ONE, o un valor sin marca, no se toca y va a `noQuitados`.
 */
export function cargarEnExistente(
  data: Record<string, unknown>,
  fields: ReadonlyArray<CampoEntendible>,
  sugeridos: Record<string, Sugerido>,
  meta: { entrega_id: string; en: string; origenDe: (frase: string) => 'audio' | 'mensaje' },
  yaVistos: Set<string> = new Set(),
  opts: { delModelo?: boolean; quitar?: Record<string, { frase: string }> } = {},
): {
  data: Record<string, unknown>;
  escritos: string[];
  conflictos: Conflicto[];
  iguales: string[];
  actualizados: Actualizado[];
  /** Números distintos al actual cuya frase no dice el número nuevo: no se tocan. */
  sinSustento: string[];
  /** Campos que se quitaron (`opts.quitar`). */
  quitados: string[];
  /** Campos que se pidió quitar pero los escribió o confirmó una persona: no se tocan. */
  noQuitados: string[];
} {
  const ediciones = (data._ediciones ?? {}) as Record<string, unknown>;
  const marcasPrevias = (data[CLAVE_SUGERIDOS] ?? {}) as Record<string, MarcaSugerido>;
  const marcas = { ...marcasPrevias };
  const choques = { ...((data[CLAVE_CONFLICTOS] ?? {}) as Record<string, MarcaConflicto>) };
  const habiaChoques = Object.keys(choques).length > 0;
  let out: Record<string, unknown> = { ...data };
  const escritos: string[] = [];
  const conflictos: Conflicto[] = [];
  const iguales: string[] = [];
  const actualizados: Actualizado[] = [];
  const sinSustento: string[] = [];
  const quitados: string[] = [];
  const noQuitados: string[] = [];

  for (const f of fields) {
    if (yaVistos.has(f.slug)) continue;
    yaVistos.add(f.slug);
    if (opts.quitar?.[f.slug] && !sugeridos[f.slug]) {
      if (vacio(data[f.slug])) continue;
      if (marcasPrevias[f.slug] && !ediciones[f.slug]) {
        delete out[f.slug];
        delete marcas[f.slug];
        delete choques[f.slug];
        quitados.push(f.slug);
      } else {
        noQuitados.push(f.slug);
      }
      continue;
    }
    const s = sugeridos[f.slug];
    if (!s) continue;
    const actual = data[f.slug];
    if (vacio(actual) && !ediciones[f.slug]) {
      out[f.slug] = s.valor;
      marcas[f.slug] = marcaDe(s, meta);
      escritos.push(f.slug);
      continue;
    }
    if (mismoValor(f, actual, s.valor)) {
      iguales.push(f.slug);
      continue;
    }
    // Para CAMBIAR un número que ya está, la frase tiene que decir el número nuevo: si no, ni se
    // reemplaza ni se arma un conflicto («hablé con mi esposo» no vuelve 2 a «3 adultos»).
    if (!opts.delModelo && f.tipo === 'numero' && !fraseNombraNumero(s.frase, Number(s.valor))) {
      sinSustento.push(f.slug);
      continue;
    }
    // Un sugerido sin confirmar no es de nadie todavía: lo dicho después gana. Una deducción
    // (`deducirCeros`) nunca reemplaza: solo llena vacíos.
    if (marcasPrevias[f.slug] && !ediciones[f.slug] && (opts.delModelo || !s.deduccion)) {
      out[f.slug] = s.valor;
      marcas[f.slug] = marcaDe(s, meta, actual);
      delete choques[f.slug];
      actualizados.push({ slug: f.slug, anterior: actual, valor: s.valor, frase: s.frase });
      continue;
    }
    choques[f.slug] = {
      fuente: 'whatsapp', entrega_id: meta.entrega_id, valor: s.valor, frase: s.frase, en: meta.en, origen: meta.origenDe(s.frase),
    };
    conflictos.push({ slug: f.slug, actual, valor: s.valor, frase: s.frase });
  }

  const tocados = [...escritos, ...actualizados.map(a => a.slug)];
  if (tocados.length > 0) {
    out = mayusculasSoloDe(fields, out, tocados);
  }
  if (tocados.length > 0 || quitados.length > 0) {
    out[CLAVE_SUGERIDOS] = marcas;
    out = aplicarSumas(fields, out);
  }
  // Un sugerido reemplazado se lleva su conflicto viejo: lo último que dijo el cliente gana.
  if (Object.keys(choques).length > 0) out[CLAVE_CONFLICTOS] = choques;
  else if (habiaChoques) delete out[CLAVE_CONFLICTOS];
  return { data: out, escritos, conflictos, iguales, actualizados, sinSustento, quitados, noQuitados };
}

/**
 * Los sugeridos más lo que se DEDUCE con el negocio ya cargado (`deducirCeros`): se carga en
 * seco cada bloque, se aplana lo que quedaría y se deduce sobre eso. Así «los niños tienen 9 y
 * 4» cierra infantes aunque los niños hayan llegado en otra entrega. Puro: no escribe nada.
 */
export function sugeridosConDeducciones(
  bloques: ReadonlyArray<{ fields: CampoEntendible[]; data: Record<string, unknown> }>,
  sugeridos: Record<string, Sugerido>,
  meta: { entrega_id: string; en: string; origenDe: (frase: string) => 'audio' | 'mensaje' },
): Record<string, Sugerido> {
  const vistos = new Set<string>();
  const quedaria = bloques.map(b => ({ fields: b.fields, data: cargarEnExistente(b.data, b.fields, sugeridos, meta, vistos).data }));
  const { fields, valores } = aplanarBloques(quedaria);
  const campos = fields as CampoEntendible[];
  const deducidos = deducirCeros(campos, aplicarSumas(campos, valores));
  const out = { ...sugeridos };
  for (const [slug, s] of Object.entries(deducidos)) if (!(slug in out)) out[slug] = s;
  return out;
}

/** La mayúscula del bloque de viaje, solo sobre lo que se acaba de escribir: lo demás no se toca. */
function mayusculasSoloDe(fields: ReadonlyArray<CampoEntendible>, data: Record<string, unknown>, slugs: string[]): Record<string, unknown> {
  const may = mayusculasDeViaje(fields, data);
  const out = { ...data };
  for (const s of slugs) out[s] = may[s];
  return out;
}

/** ¿La frase salió de una nota de voz? Se busca el mensaje que la contiene. */
export function origenDeFrase(frase: string, mensajes: ReadonlyArray<{ cuerpo: string | null; cuerpo_origen: string | null }>): 'audio' | 'mensaje' {
  const f = normalizarTexto(frase);
  const m = mensajes.find(x => normalizarTexto(String(x.cuerpo ?? '')).includes(f));
  return m?.cuerpo_origen === 'transcripcion' ? 'audio' : 'mensaje';
}

// ── Lo que se cuenta ─────────────────────────────────────────────────────────

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «30-sep» de una fecha AAAA-MM-DD. */
export function diaMes(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])}-${MESES[Number(m[2]) - 1]}` : iso;
}

/** Un valor como se le dice a una persona: fechas «20 nov», opciones por su etiqueta. */
export function valorLegible(f: CampoEntendible, v: unknown): string {
  if (vacio(v)) return '(vacío)';
  if (f.tipo === 'fecha') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    if (m) return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}`;
  }
  const op = (f.opciones ?? []).find(o => String(o.value) === String(v));
  return op?.label ?? String(v);
}

function etiqueta(f: CampoEntendible | undefined, slug: string): string {
  return (f?.label ?? slug).toLowerCase();
}

/**
 * La respuesta al comercial tras cargar en un negocio existente: qué se cargó, qué quedó en
 * conflicto y hasta tres preguntas del mínimo que todavía falta.
 */
export function mensajeCargaExistente(p: {
  codigo: string | null;
  /** Cómo se nombra el viaje (`nombreDeViaje`); sin él, el código. */
  nombre?: string | null;
  fields: ReadonlyArray<CampoEntendible>;
  escritos: Array<{ slug: string; valor: unknown }>;
  conflictos: Conflicto[];
  /** Sugeridos sin confirmar que el mensaje reemplazó: «Actualicé adultos: 2 → 3». */
  actualizados?: ReadonlyArray<Pick<Actualizado, 'slug' | 'anterior' | 'valor'>>;
  faltanMinimo: ReadonlyArray<{ pregunta: string; slug?: string }>;
  /** Slugs que un guardián descartó: sus preguntas van primero y no se recortan. */
  descartados?: ReadonlyArray<string>;
  /** Preguntas de un guardián (C9) que van antes de las del mínimo, aunque el mínimo esté completo. */
  preguntasAntes?: ReadonlyArray<string>;
  /** La línea de avance («T1 26 11 · Carolina — Mínimo 7/9 (78 %) · Completo 12/20 (60 %)»). */
  avance?: string | null;
  enlace: string;
  maxPreguntas?: number;
}): string {
  const porSlug = new Map(p.fields.map(f => [f.slug, f]));
  const cod = p.nombre || p.codigo || 'el viaje';
  const lineas: string[] = [];
  const actualizados = p.actualizados ?? [];
  if (p.escritos.length > 0) {
    const lista = p.escritos.map(e => {
      const f = porSlug.get(e.slug);
      return `${etiqueta(f, e.slug)} ${f ? valorLegible(f, e.valor) : String(e.valor)}`;
    });
    lineas.push(`Cargué en ${cod}: ${lista.join(', ')}.`);
  } else if (actualizados.length === 0) {
    lineas.push(`No encontré datos nuevos para ${cod}.`);
  }
  if (actualizados.length > 0) {
    const lista = actualizados.map(a => {
      const f = porSlug.get(a.slug);
      const leg = (v: unknown) => (f ? valorLegible(f, v) : String(v));
      return `${etiqueta(f, a.slug)}: ${leg(a.anterior)} → ${leg(a.valor)}`;
    });
    lineas.push(`Actualicé ${lista.join('; ')}. Lo anterior era una sugerencia que nadie había confirmado.`);
  }
  if (p.conflictos.length > 0) {
    const lista = p.conflictos.map(c => {
      const f = porSlug.get(c.slug);
      const leg = (v: unknown) => (f ? valorLegible(f, v) : String(v));
      return `${etiqueta(f, c.slug)} (en ONE: ${leg(c.actual)}; el cliente dijo: ${leg(c.valor)})`;
    });
    lineas.push(`No cambié ${p.conflictos.length === 1 ? 'un dato que ya tenía otro valor' : `${p.conflictos.length} datos que ya tenían otro valor`}: ${lista.join('; ')}. Queda marcado para que alguien decida.`);
  }
  if (p.avance) lineas.push(p.avance);
  const max = p.maxPreguntas ?? 3;
  const antes = p.preguntasAntes ?? [];
  if (p.faltanMinimo.length === 0) {
    if (antes.length > 0) lineas.push('Antes de cotizar:', ...antes.map((q, i) => `${i + 1}. ${q}`));
    lineas.push(`Ya está el mínimo para cotizar: ${p.enlace}`);
  } else {
    const preguntas = [...antes, ...preguntasDelMinimo(p.faltanMinimo, p.descartados, max).map(f => f.pregunta)];
    lineas.push('Para empezar a cotizar me falta:', ...preguntas.map((q, i) => `${i + 1}. ${q}`));
    if (p.conflictos.length > 0) lineas.push(p.enlace);
  }
  return lineas.join('\n');
}

/**
 * La línea de avance de una carga: «T1 26 11 · Carolina — Mínimo 7/9 (78 %) · Completo 12/20 (60 %)».
 * Las dos cuentas salen de `calcularNiveles`, la misma función de las barras de la pantalla:
 *   · Mínimo: la barra «Mínimo para cotizar», tal cual.
 *   · Completo: mínimo + deseable, sin los campos que llena la agencia (`lo_llena: agencia`). Los
 *     condicionales que no aplican (edades sin menores) ya no cuentan en `calcularNiveles`.
 * Solo va en el mensaje que cierra una carga; nunca en los acuses (📌, «¿Cambias a…?»).
 */
export function lineaAvance(p: {
  codigo: string | null; cliente: string | null; fields: ReadonlyArray<CampoEntendible>; valores: Record<string, unknown>;
  /** El nombre del negocio («CARTAGENA DIC 12-16»): la línea lo nombra como lo recuerda el comercial. */
  nombre?: string | null;
}): string {
  const todos = calcularNiveles(p.fields, p.valores);
  const sinAgencia = calcularNiveles(p.fields.filter(f => f.lo_llena !== LO_LLENA_AGENCIA), p.valores);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 100);
  const minimo = todos.minimo;
  const completos = sinAgencia.minimo.completos + sinAgencia.deseable.completos;
  const total = sinAgencia.minimo.total + sinAgencia.deseable.total;
  const quien = p.codigo || p.cliente || p.nombre ? nombreDeViaje({ nombre: p.nombre, cliente: p.cliente, codigo: p.codigo }) : 'El viaje';
  return `${quien} — Mínimo ${minimo.completos}/${minimo.total} (${pct(minimo.completos, minimo.total)} %) · Completo ${completos}/${total} (${pct(completos, total)} %)`;
}

/** Primer nombre de quien reenvió: «Tatiana». */
export function primerNombre(nombre: string | null | undefined): string {
  const w = String(nombre ?? '').trim().split(/\s+/)[0] ?? '';
  return w ? w.charAt(0).toLocaleUpperCase('es-CO') + w.slice(1).toLocaleLowerCase('es-CO') : '';
}

/**
 * La traza en la actividad del negocio, con la historia de ESTOS mensajes debajo y fechada:
 * se agrega a lo que ya había, no lo reemplaza.
 * «Se cargaron 3 datos desde WhatsApp (Tatiana, 30-sep)».
 */
export function trazaCarga(p: {
  quien: string;
  fechaISO: string;
  escritos: string[];
  conflictos: Conflicto[];
  actualizados?: ReadonlyArray<Pick<Actualizado, 'slug' | 'anterior' | 'valor'>>;
  /** Campos que se quitaron a pedido del comercial (`cargarEnExistente` con `quitar`). */
  quitados?: ReadonlyArray<string>;
  fields: ReadonlyArray<CampoEntendible>;
  historia: string;
}): string {
  const porSlug = new Map(p.fields.map(f => [f.slug, f]));
  const dia = diaMes(p.fechaISO);
  const quien = p.quien ? `${p.quien}, ${dia}` : dia;
  const n = p.escritos.length + (p.actualizados ?? []).length;
  const cab = n === 0
    ? `No se cargaron datos nuevos desde WhatsApp (${quien})`
    : `Se ${n === 1 ? 'cargó 1 dato' : `cargaron ${n} datos`} desde WhatsApp (${quien})`;
  const partes = [`${cab}.`];
  if ((p.actualizados ?? []).length > 0) {
    const lista = p.actualizados!.map(a => {
      const f = porSlug.get(a.slug);
      const leg = (v: unknown) => (f ? valorLegible(f, v) : String(v));
      return `${f?.label ?? a.slug} ${leg(a.anterior)} → ${leg(a.valor)}`;
    }).join('; ');
    partes.push(`Actualizado (era sugerido, nadie lo había confirmado): ${lista}.`);
  }
  if (p.conflictos.length > 0) {
    const nombres = p.conflictos.map(c => porSlug.get(c.slug)?.label ?? c.slug).join(', ');
    partes.push(`En conflicto, sin cambiar: ${nombres}.`);
  }
  if ((p.quitados ?? []).length > 0) {
    partes.push(`Quitado (lo corrigió el comercial): ${p.quitados!.map(s => porSlug.get(s)?.label ?? s).join(', ')}.`);
  }
  if (p.historia.trim()) partes.push('', `Historia del ${dia}:`, p.historia.trim());
  return partes.join('\n');
}

// ── N6 · ¿es el viaje equivocado? ────────────────────────────────────────────

/** Un choque entre lo que dicen los mensajes y el negocio elegido. */
export interface Cruce {
  que: 'destino' | 'cliente';
  enNegocio: string;
  enMensajes: string;
}

function palabrasLargas(t: string | null | undefined): Set<string> {
  return new Set(normalizarNombre(t).split(' ').filter(w => w.length >= 3));
}

/**
 * Antes de cargar en un negocio EXISTENTE: ¿los mensajes hablan de otro viaje? (N6, C1: los datos
 * de Carolina a Punta Cana terminaron en los campos vacíos de Jorge, que va a Cartagena.)
 *   · destino: los dos tienen destino y ninguno contiene al otro;
 *   · cliente: los mensajes nombran a un cliente que no comparte ni una palabra con el del negocio.
 * Las fechas NO cuentan solas: un cliente que mueve su viaje («mejor del 28») es lo normal, y
 * eso ya lo atiende `cargarEnExistente` (actualiza o deja en conflicto).
 */
export function detectarCruce(p: {
  destinoNegocio: unknown;
  destinoMensajes: unknown;
  clienteNegocio: string | null;
  clienteMensajes: string | null;
}): Cruce[] {
  const out: Cruce[] = [];
  const dn = typeof p.destinoNegocio === 'string' ? p.destinoNegocio.trim() : '';
  const dm = typeof p.destinoMensajes === 'string' ? p.destinoMensajes.trim() : '';
  if (dn && dm) {
    const a = normalizarTexto(dn);
    const b = normalizarTexto(dm);
    if (!a.includes(b) && !b.includes(a)) out.push({ que: 'destino', enNegocio: dn, enMensajes: dm });
  }
  const cn = palabrasLargas(p.clienteNegocio);
  const cm = palabrasLargas(p.clienteMensajes);
  if (cn.size > 0 && cm.size > 0 && ![...cm].some(w => cn.has(w))) {
    out.push({ que: 'cliente', enNegocio: String(p.clienteNegocio), enMensajes: String(p.clienteMensajes) });
  }
  return out;
}

/** «Estos mensajes hablan de Punta Cana y Cartagena Dic · Jorge Pérez (T1 26 8) va a CARTAGENA. ¿Seguro?» */
export function textoAvisoCruce(p: { codigo: string | null; cliente: string | null; destino: string | null; nombre?: string | null; cruces: ReadonlyArray<Cruce> }): string {
  const deQue = p.cruces.map(c => c.enMensajes);
  const nombre = p.codigo || p.cliente || p.nombre ? nombreDeViaje({ nombre: p.nombre, cliente: p.cliente, codigo: p.codigo }) : 'ese viaje';
  return [
    `¿Seguro que estos mensajes van en ${nombre}? Hablan de ${deQue.join(' y de ')}${p.destino ? ` y ese viaje va a ${p.destino}` : ''}; no cargué nada.`,
    'Responde «sí» para cargarlos igual, dime cuál es el viaje correcto, o «nuevo» y el nombre del cliente.',
  ].join('\n');
}
