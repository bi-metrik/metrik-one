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

import { aplanarBloques, parsearNumeroColombiano } from './niveles-solicitud.ts';
import {
  aplicarSumas,
  CLAVE_SUGERIDOS,
  deducirCeros,
  fraseNombraNumero,
  marcaDe,
  mayusculasDeViaje,
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
  /** Lo nombran los mensajes y es su único negocio abierto: va primero. */
  propuesto?: boolean;
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
  const o: OpcionNegocio = { id: n.id, codigo: n.codigo, cliente: n.cliente, destino: n.destino };
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

/** «T1 26 14 · MARTA GÓMEZ · Punta Cana». Lo que falte no se escribe. */
export function lineaDeOpcion(o: OpcionNegocio): string {
  return [o.codigo, o.cliente, o.destino].filter(v => typeof v === 'string' && v.trim() !== '').join(' · ') || 'Sin código';
}

const PIE_NUEVO = 'o escribe NUEVO y el nombre del cliente si es un viaje nuevo.';

/**
 * La pregunta. Sin negocios abiertos solo se ofrece NUEVO. `aviso` antecede cuando se vuelve a
 * preguntar («No entendí…»).
 */
export function textoPreguntaNegocio(p: { nMensajes: number; opciones: ReadonlyArray<OpcionNegocio>; aviso?: string }): string {
  const n = p.nMensajes;
  const recibi = n > 0 ? `Recibí ${n} ${n === 1 ? 'mensaje' : 'mensajes'}. ` : '';
  const cab = p.aviso ? [p.aviso] : [];
  if (p.opciones.length === 0) {
    return [...cab, `${recibi}No tienes viajes abiertos: escribe NUEVO y el nombre del cliente para crear el viaje.`].join('\n');
  }
  const prop = p.opciones[0]?.propuesto ? [`Parece de ${p.opciones[0].cliente}: es la 1.`] : [];
  return [
    ...cab,
    `${recibi}¿A qué viaje van?`,
    ...prop,
    ...p.opciones.map((o, i) => `${i + 1}. ${lineaDeOpcion(o)}`),
    `Responde con el número o el código, ${PIE_NUEVO}`,
  ].join('\n');
}

// ── La respuesta ─────────────────────────────────────────────────────────────

export type RespuestaNegocio =
  | { tipo: 'existente'; negocio_id: string }
  /** Un código que no está en la lista: se busca entre los abiertos del workspace. */
  | { tipo: 'codigo'; codigo: string }
  /** `cliente`: lo que escribió después de NUEVO («NUEVO Marta Gómez»), o null. */
  | { tipo: 'nuevo'; cliente: string | null }
  | { tipo: 'no_entendida' };

/** El código sin espacios ni signos, en mayúscula: «t1 26 14» y «T12614» son el mismo. */
export function codigoCompacto(t: string | null | undefined): string {
  return String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Letra(s) y dígitos: la forma de los códigos de negocio («T1 26 14», «S1 26 3»). */
function pareceCodigo(compacto: string): boolean {
  return /^[A-Z]{1,3}\d{3,}$/.test(compacto) && compacto.length <= 12;
}

export function interpretarRespuestaNegocio(texto: string, opciones: ReadonlyArray<OpcionNegocio>): RespuestaNegocio {
  const bruto = String(texto ?? '').trim();
  const t = normalizarTexto(bruto);
  const num = /^(\d{1,2})\.?$/.exec(t);
  if (num) {
    const i = Number(num[1]) - 1;
    return i >= 0 && i < opciones.length ? { tipo: 'existente', negocio_id: opciones[i].id } : { tipo: 'no_entendida' };
  }
  const nuevo = /^\s*nuev[oa]\b[\s,.:;-]*([\s\S]*)$/i.exec(bruto);
  if (nuevo) {
    const resto = nuevo[1].trim();
    return { tipo: 'nuevo', cliente: resto === '' ? null : resto };
  }
  const c = codigoCompacto(bruto);
  if (c) {
    const enLista = opciones.find(o => codigoCompacto(o.codigo) === c);
    if (enLista) return { tipo: 'existente', negocio_id: enLista.id };
    if (pareceCodigo(c)) return { tipo: 'codigo', codigo: c };
  }
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
 */
export function cargarEnExistente(
  data: Record<string, unknown>,
  fields: ReadonlyArray<CampoEntendible>,
  sugeridos: Record<string, Sugerido>,
  meta: { entrega_id: string; en: string; origenDe: (frase: string) => 'audio' | 'mensaje' },
  yaVistos: Set<string> = new Set(),
): {
  data: Record<string, unknown>;
  escritos: string[];
  conflictos: Conflicto[];
  iguales: string[];
  actualizados: Actualizado[];
  /** Números distintos al actual cuya frase no dice el número nuevo: no se tocan. */
  sinSustento: string[];
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

  for (const f of fields) {
    if (yaVistos.has(f.slug)) continue;
    yaVistos.add(f.slug);
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
    if (f.tipo === 'numero' && !fraseNombraNumero(s.frase, Number(s.valor))) {
      sinSustento.push(f.slug);
      continue;
    }
    // Un sugerido sin confirmar no es de nadie todavía: lo dicho después gana. Una deducción
    // (`deducirCeros`) nunca reemplaza: solo llena vacíos.
    if (marcasPrevias[f.slug] && !ediciones[f.slug] && !s.deduccion) {
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
    out[CLAVE_SUGERIDOS] = marcas;
    out = mayusculasSoloDe(fields, out, tocados);
    out = aplicarSumas(fields, out);
  }
  // Un sugerido reemplazado se lleva su conflicto viejo: lo último que dijo el cliente gana.
  if (Object.keys(choques).length > 0) out[CLAVE_CONFLICTOS] = choques;
  else if (habiaChoques) delete out[CLAVE_CONFLICTOS];
  return { data: out, escritos, conflictos, iguales, actualizados, sinSustento };
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
  infanteMenorDe?: number,
): Record<string, Sugerido> {
  const vistos = new Set<string>();
  const quedaria = bloques.map(b => ({ fields: b.fields, data: cargarEnExistente(b.data, b.fields, sugeridos, meta, vistos).data }));
  const { fields, valores } = aplanarBloques(quedaria);
  const campos = fields as CampoEntendible[];
  const deducidos = deducirCeros(campos, aplicarSumas(campos, valores), infanteMenorDe);
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
  fields: ReadonlyArray<CampoEntendible>;
  escritos: Array<{ slug: string; valor: unknown }>;
  conflictos: Conflicto[];
  /** Sugeridos sin confirmar que el mensaje reemplazó: «Actualicé adultos: 2 → 3». */
  actualizados?: ReadonlyArray<Pick<Actualizado, 'slug' | 'anterior' | 'valor'>>;
  faltanMinimo: ReadonlyArray<{ pregunta: string; slug?: string }>;
  /** Slugs que un guardián descartó: sus preguntas van primero y no se recortan. */
  descartados?: ReadonlyArray<string>;
  enlace: string;
  maxPreguntas?: number;
}): string {
  const porSlug = new Map(p.fields.map(f => [f.slug, f]));
  const cod = p.codigo ?? 'el viaje';
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
  const max = p.maxPreguntas ?? 3;
  if (p.faltanMinimo.length === 0) {
    lineas.push(`Ya está el mínimo para cotizar: ${p.enlace}`);
  } else {
    lineas.push('Para empezar a cotizar me falta:', ...preguntasDelMinimo(p.faltanMinimo, p.descartados, max).map((f, i) => `${i + 1}. ${f.pregunta}`));
    if (p.conflictos.length > 0) lineas.push(p.enlace);
  }
  return lineas.join('\n');
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

/** «Estos mensajes hablan de Punta Cana y T1 26 8 es de JORGE PÉREZ a CARTAGENA. ¿Seguro?» */
export function textoAvisoCruce(p: { codigo: string | null; cliente: string | null; destino: string | null; cruces: ReadonlyArray<Cruce> }): string {
  const deQue = p.cruces.map(c => c.enMensajes);
  const viaje = [p.codigo ?? 'ese viaje', p.cliente ? `es de ${p.cliente}` : null, p.destino ? `a ${p.destino}` : null].filter(Boolean).join(' ');
  return [
    `Estos mensajes hablan de ${deQue.join(' y de ')} y ${viaje}. No cargué nada.`,
    '¿Seguro que van ahí? Responde SÍ para cargarlos igual, o el número o el código del viaje correcto, o NUEVO y el nombre del cliente.',
  ].join('\n');
}
