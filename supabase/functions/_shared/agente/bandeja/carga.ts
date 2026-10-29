// ============================================================
// Núcleo conversacional — lo que se anota en un viaje (bandeja de solicitudes)
// ------------------------------------------------------------
// Falla en vivo del 2026-10-07 (Trappvel, número de prueba): el bot pedía otra vez lo que ya le habían dicho y lo que
// sí entendía no se guardaba. Las cuatro piezas de aquí son puras:
//   · `escritosDelViaje`: lo que el comercial escribió de ESE viaje (desde que lo nombró o desde que pidió abrirlo), no
//     solo el texto que el modelo copió en `proponer`. Así la extracción ve «5 noches, desde el 11» aunque el último
//     mensaje solo diga «salen desde Bogotá».
//   · `planDeCarga`: lo que el modelo de extracción clasificó (`validarCarga`: solo invariantes, ver `extraccion.ts`)
//     + la unión con la propuesta pendiente del mismo viaje (lo nuevo gana solo en el mismo campo). El resumen muestra
//     solo lo que cambiaría. Regreso, alternativas («4 o 5 estrellas») y el grupo los decide el modelo, no el código.
//   · `lineaCargada`: el hecho que se le dice al comercial tras el toque.
// La base la tocan los puertos (`produccion.ts`, `memoria.ts`); esto no escribe nada.
// ============================================================

import { normal } from '../verificador.ts';
import type { FilaConversacion } from '../tipos.ts';
import { aplanarBloques } from '../../niveles-solicitud.ts';
import { huecos } from '../../wa-entendimiento-reglas.ts';
import type { CampoEntendible } from '../../wa-entendimiento-reglas.ts';
import { cargarEnExistente, valorLegible } from '../../wa-carga-reglas.ts';
import type { MensajeEntrega } from '../../wa-guardianes.ts';
import { lineaDuda, validarCarga } from './extraccion.ts';
import type { Quitado, SugeridoAgente } from './extraccion.ts';
import { textoComparable } from '../../perfil-contacto.ts';
import type { HechoPerfil } from '../../perfil-contacto.ts';
import { codigosCanonicos, codigosDelTexto } from './codigo.ts';
import { esAdjuntoEntrante } from '../adjuntos.ts';

/** Lo que se le pasa a la extracción, como mucho (el mismo tope de la conversación que ve el modelo: 6.000 tokens). */
export const TOPE_ESCRITOS_CARACTERES = 24_000;

// ── Lo que el comercial escribió de un viaje ─────────────────────────────────

const delEquipo = (f: FilaConversacion) => f.direccion === 'entrante' && f.clase !== 'reenvio';
/** Un escrito o audio del equipo con texto, o una foto/PDF que mandó el equipo con algo que decir (pie o lo leído). */
const escritoDelEquipo = (f: FilaConversacion) => f.direccion === 'entrante'
  && (((f.clase === 'escrito' || f.clase === 'audio') && !!f.texto?.trim()) || (f.clase !== 'reenvio' && esAdjuntoEntrante(f) && !!textoParaCarga(f)));

// ── Lo que dice un adjunto (foto o PDF), para la carga ───────────────────────

/** Así empieza lo leído de un archivo dentro de lo que va a la extracción (la extracción sabe que es un documento). */
export const MARCA_ARCHIVO = '[archivo adjunto';

/** ¿Este texto de la carga trae lo leído de un archivo? Pura. */
export function traeArchivo(texto: string): boolean {
  return texto.includes(MARCA_ARCHIVO);
}

/**
 * Lo que una fila aporta a la carga de un viaje: su texto (el escrito, o el pie de la foto) y, si es una foto o un PDF
 * ya leído (`../adjuntos.ts`), lo que dice el archivo, marcado como tal. Una fila sin archivo da su texto tal cual (la
 * carga de texto no cambia). Pura.
 */
export function textoParaCarga(f: FilaConversacion): string {
  const base = (f.texto ?? '').trim();
  if (!esAdjuntoEntrante(f)) return base;
  const l = f.media.lectura;
  if (!l?.legible || !l.texto) return base;
  const que = f.media.tipo === 'documento' ? `PDF «${(f.media.nombre ?? 'sin nombre').slice(0, 80)}»` : 'foto';
  const clase = l.clase === 'pago' ? 'comprobante de pago' : l.clase === 'identidad' ? 'documento de identidad' : l.clase === 'viaje' ? 'del viaje' : 'otro documento';
  return [base, `${MARCA_ARCHIVO} · ${que} · ${clase} · lo que dice el archivo] ${l.texto}`].filter(Boolean).join('\n');
}

/** Los adjuntos (foto o PDF ya guardados) de estas filas: lo que queda como soporte del viaje con el toque. Pura. */
export function adjuntosDe(filas: ReadonlyArray<FilaConversacion>): AdjuntoCarga[] {
  return filas.filter(esAdjuntoEntrante).filter((f) => !!f.media.ref).map((f) => ({
    fila: f.id, ref: f.media.ref!, tipo: f.media.tipo === 'documento' ? 'documento' as const : 'imagen' as const,
    nombre: f.media.tipo === 'documento' ? (f.media.nombre ?? null) : null,
  }));
}

/** Un archivo que queda como soporte del viaje cuando se carga lo que trae. */
export interface AdjuntoCarga { fila: string; ref: string; tipo: 'imagen' | 'documento'; nombre: string | null }

/** La opción que el comercial nombró escribiendo («1», «el de san andrés»). Inyectada para no duplicar el candado. */
type OpcionNombrada = (opciones: ReadonlyArray<{ titulo: string; descripcion?: string }>, texto: string) => number | null;

/**
 * Dónde se nombró cada viaje, en orden: un código en un escrito del equipo, la opción que eligió escribiendo, el viaje
 * que abrió con su toque y el viaje nuevo que se le propuso (clave `nuevo:<huella>`, desde el primer mensaje de ese
 * turno; al abrirse pasa a ser su código). `sueltos`: los códigos escritos sin espacios que ya se resolvieron contra la
 * base («m1261» → «M1 26 1», `resolverSueltos`). Pura.
 */
export function nombramientos(
  filas: FilaConversacion[],
  opcionNombrada: OpcionNombrada,
  alias: Record<string, string> = {},
  sueltos: Record<string, string> = {},
): Array<{ i: number; clave: string }> {
  const out: Array<{ i: number; clave: string }> = [];
  const alias2 = { ...alias };
  const inicioDeTurno = new Map<string, number>();
  filas.forEach((f, i) => { if (f.turno_id && !inicioDeTurno.has(f.turno_id)) inicioDeTurno.set(f.turno_id, i); });
  let opciones: ReadonlyArray<{ titulo: string; descripcion?: string }> | null = null;
  filas.forEach((f, i) => {
    if (delEquipo(f)) {
      for (const c of codigosDelTexto(f.texto ?? '', sueltos)) out.push({ i, clave: c });
      if (opciones && f.clase === 'escrito') {
        const k = opcionNombrada(opciones, f.texto ?? '');
        if (k !== null) for (const c of codigosCanonicos(opciones[k].titulo)) out.push({ i, clave: c });
      }
      opciones = null;
    }
    if (f.direccion === 'saliente') opciones = f.opciones?.length ? f.opciones : null;
    const p = f.traza?.propuesta;
    if (p?.accion === 'viaje_nuevo') {
      // El pedido empieza donde empezó el turno que lo propuso, o antes si el modelo señaló el mensaje (`desde`).
      const inicio = f.turno_id ? inicioDeTurno.get(f.turno_id) ?? i : i;
      const desde = typeof p.datos?.desdeFila === 'string' ? filas.findIndex((x) => x.id === p.datos.desdeFila) : -1;
      out.push({ i: desde >= 0 && desde < inicio ? desde : inicio, clave: `nuevo:${p.huella}` });
    }
    const e = f.traza?.ejecucion;
    if (e?.resultado === 'ejecutada') {
      for (const c of e.nombrados ?? []) {
        out.push({ i, clave: c });
        if (e.accion === 'viaje_nuevo') alias2[`nuevo:${e.huella}`] = c;
      }
    }
  });
  return out.map((x) => ({ ...x, clave: alias2[x.clave] ?? x.clave })).sort((a, b) => a.i - b.i);
}

/**
 * Los escritos del comercial sobre `codigo`: cada tramo desde que ese viaje se nombró (o se pidió abrir) hasta que se
 * nombró otro, más los mensajes de este turno (los que todavía no tienen turno) que no nombran otro viaje. Lo más viejo
 * se cae si no cabe en el tope. Pura.
 */
export function escritosDelViaje(
  filas: FilaConversacion[],
  codigo: string,
  opcionNombrada: OpcionNombrada,
  alias: Record<string, string> = {},
  sueltos: Record<string, string> = {},
): string[] {
  return recortar(filasDelViaje(filas, codigo, opcionNombrada, alias, sueltos).map(textoParaCarga));
}

/** Las filas de `escritosDelViaje` (sin recortar): de ellas salen también los adjuntos que van de soporte. Pura. */
export function filasDelViaje(
  filas: FilaConversacion[],
  codigo: string,
  opcionNombrada: OpcionNombrada,
  alias: Record<string, string> = {},
  sueltos: Record<string, string> = {},
): FilaConversacion[] {
  const ev = nombramientos(filas, opcionNombrada, alias, sueltos);
  const tramos: Array<[number, number]> = [];
  ev.forEach((x, k) => {
    if (x.clave !== codigo || (k > 0 && ev[k - 1].clave === codigo)) return;
    tramos.push([x.i, ev.slice(k + 1).find((y) => y.clave !== codigo)?.i ?? filas.length]);
  });
  // Un mensaje de este turno que nombra OTRO viaje (y no este) es de ese otro.
  const deOtro = new Set(ev.filter((x) => x.clave !== codigo).map((x) => x.i));
  for (const x of ev) if (x.clave === codigo) deOtro.delete(x.i);
  return filas.filter((f, i) => escritoDelEquipo(f) && (tramos.some(([d, h]) => i >= d && i < h) || (!f.turno_id && !deOtro.has(i))));
}

function recortar(textos: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (let k = textos.length - 1; k >= 0; k--) {
    total += textos[k].length;
    if (total > TOPE_ESCRITOS_CARACTERES && out.length) break;
    out.unshift(textos[k]);
  }
  return out;
}

// ── El plan de una carga ─────────────────────────────────────────────────────

export interface PlanCarga {
  sugeridos: Record<string, SugeridoAgente>;
  /** Lo que el comercial pidió quitar del viaje (acción explícita: `cargarEnExistente` con `quitar`). */
  quitar?: Record<string, Quitado>;
  historia: string;
  /** Lo de la persona que va a su perfil como sugerido, con el toque de esta carga (solo si la extracción lo pidió). */
  perfil?: HechoPerfil[];
}

/** La línea del resumen con lo que va al perfil (sugerido): el comercial lo ve antes de tocar. Pura. */
export function lineaPerfilSugerido(perfil: ReadonlyArray<Pick<HechoPerfil, 'texto'>>): string {
  return `Al perfil del cliente, por confirmar en ONE: ${perfil.map((h) => h.texto).join('; ')}`;
}

export interface Preparada {
  /** Lo que cambiaría en el viaje, como se le dice a una persona («Fecha de regreso: 16 nov (calculado)»). */
  entendido: string[];
  /** Lo que seguiría faltando para cotizar. */
  falta: string[];
  /** La duda más importante de la extracción, como una línea para arriba del resumen. No bloquea lo demás. */
  duda?: string;
  plan: PlanCarga;
}

type Bloque = { fields: CampoEntendible[]; data: Record<string, unknown> };

export function mensajesDeTextos(textos: ReadonlyArray<string>): MensajeEntrega[] {
  return textos.map((t, i) => ({ n: i + 1, cuerpo: t, reenviado: true, tipo: 'text', origen: 'texto' })) as MensajeEntrega[];
}

/**
 * Lo que la extracción lee en una carga: los textos (como siempre, `mensajesDeTextos`) y, numerado después, lo que el
 * comercial escribió al pedirla (`pedido`, marcado «escrito por el comercial»). Sin `pedido`, igual a `mensajesDeTextos`.
 * Pura.
 */
export function mensajesDeCarga(textos: ReadonlyArray<string>, pedido: ReadonlyArray<string> = []): MensajeEntrega[] {
  const n0 = textos.length;
  return [
    ...mensajesDeTextos(textos),
    ...pedido.map((t, i) => ({ n: n0 + i + 1, cuerpo: t, reenviado: false, tipo: 'text', origen: 'texto' }) as MensajeEntrega),
  ];
}

/**
 * Lo que el comercial escribió al pedir que se cargue la tanda («cárgalo en el G1 26 7, pero salen el 10»): sus escritos
 * de ESE viaje desde el primer reenvío de la tanda (arnés con Haiku del 2026-10-29, a-choque: la tanda iba sola a la
 * extracción y el «salen el 10» se perdía). Va aparte de la tanda: no entra en los mensajes que la propuesta consume.
 * Solo texto escrito (los archivos propios van por anotar). Pura.
 */
export function pedidoDeTanda(
  filas: FilaConversacion[],
  tanda: ReadonlyArray<FilaConversacion>,
  codigo: string,
  opcionNombrada: OpcionNombrada,
  sueltos: Record<string, string> = {},
): string[] {
  if (!tanda.length) return [];
  const desde = filas.findIndex((f) => f.id === tanda[0].id);
  if (desde < 0) return [];
  const delViaje = new Set(filasDelViaje(filas, codigo, opcionNombrada, {}, sueltos).map((f) => f.id));
  return recortar(filas.slice(desde)
    .filter((f) => delViaje.has(f.id) && (f.clase === 'escrito' || f.clase === 'audio'))
    .map((f) => (f.texto ?? '').trim()).filter(Boolean));
}

/** El plan pendiente (lo que se le propuso al comercial y no ha confirmado), tolerante a una traza vieja. Pura. */
export function planPrevio(previo: unknown): { sugeridos: Record<string, SugeridoAgente>; quitar: Record<string, Quitado>; perfil: HechoPerfil[] } {
  const p = (previo && typeof previo === 'object' ? previo : {}) as Partial<PlanCarga>;
  return { sugeridos: p.sugeridos ?? {}, quitar: p.quitar ?? {}, perfil: Array.isArray(p.perfil) ? p.perfil : [] };
}

/** Lo propuesto sin confirmar, por campo: se le muestra a la extracción para que pueda corregirlo o quitarlo. Pura. */
export function propuestoDe(previo: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(planPrevio(previo).sugeridos).map(([k, s]) => [k, s.valor]));
}

/** La marca corta de lo que no está escrito tal cual: el comercial lo revisa antes de tocar. Pura. */
function marcaComo(s: SugeridoAgente): string {
  const como = s.como ?? (s.deduccion ? 'deducido' : undefined);
  return como ? ` (${como})` : '';
}

const sinValor = (v: unknown) => v === undefined || v === null || v === '';

/**
 * La carga que se propone. `raw` es la salida del modelo de extracción (`instruccionesCarga`/`esquemaCarga`) sobre
 * `mensajesDeTextos(textos)`; `previo`, el plan de la propuesta pendiente del mismo viaje (se une: lo nuevo gana solo
 * en el mismo campo, y un «quitar» nuevo saca el valor propuesto). Pura.
 */
export function planDeCarga(p: {
  bloques: ReadonlyArray<Bloque>;
  textos: ReadonlyArray<string>;
  raw: unknown;
  hoyISO: string;
  ahoraIso: string;
  previo?: unknown;
}): Preparada {
  const { fields, valores: yaTiene } = aplanarBloques(p.bloques.map((b) => ({ fields: b.fields, data: b.data })));
  const campos = fields as CampoEntendible[];
  // La pendiente cuenta como sabida para las invariantes (el regreso contra su salida, un `pedir_si`, qué se puede quitar).
  const previo = planPrevio(p.previo);
  const sabido = { ...yaTiene, ...propuestoDe(p.previo) };
  const v = validarCarga(p.raw, campos, p.textos, { hoyISO: p.hoyISO, yaTiene: sabido });

  // La unión con la pendiente: nunca se descarta en silencio un dato propuesto y no rechazado. Lo que el comercial pidió
  // quitar sale de lo propuesto; un valor nuevo deshace un «quitar» pendiente del mismo campo.
  const sugeridos: Record<string, SugeridoAgente> = { ...previo.sugeridos, ...v.sugeridos };
  const quitar: Record<string, Quitado> = { ...previo.quitar, ...v.quitar };
  for (const k of Object.keys(v.quitar)) delete sugeridos[k];
  for (const k of Object.keys(v.sugeridos)) delete quitar[k];
  // Del viaje solo se quita lo que el viaje tiene: lo que solo estaba propuesto ya salió de `sugeridos`.
  for (const k of Object.keys(quitar)) if (sinValor(yaTiene[k])) delete quitar[k];

  // Lo que cambiaría (en seco, como `cargar`): el resumen no repite lo que el viaje ya tiene.
  const meta = { entrega_id: 'agente', en: p.ahoraIso, origenDe: () => 'mensaje' as const };
  const cambia: string[] = [];
  const quitados: string[] = [];
  const noQuitados: string[] = [];
  const vistos = new Set<string>();
  for (const b of p.bloques) {
    const r = cargarEnExistente(b.data, b.fields, sugeridos, meta, vistos, { delModelo: true, quitar });
    cambia.push(...r.escritos, ...r.actualizados.map((a) => a.slug), ...r.conflictos.map((c) => c.slug));
    quitados.push(...r.quitados);
    noQuitados.push(...r.noQuitados);
  }
  const entendido = campos.flatMap((f) => {
    const et = f.label ?? f.slug;
    if (cambia.includes(f.slug)) return [`${et}: ${valorLegible(f, sugeridos[f.slug].valor)}${marcaComo(sugeridos[f.slug])}`];
    if (quitados.includes(f.slug)) return [`${et}: se quita (${quitar[f.slug].razon ?? `«${quitar[f.slug].frase}»`})`];
    if (noQuitados.includes(f.slug)) return [`${et}: no lo quito, lo puso alguien en ONE (cámbialo allí)`];
    return [];
  });
  const quedaria: Record<string, unknown> = { ...yaTiene, ...Object.fromEntries(Object.entries(sugeridos).map(([k, s]) => [k, s.valor])) };
  for (const k of quitados) delete quedaria[k];
  const falta = huecos(campos, quedaria).minimo.faltan.map((f) => f.label ?? f.slug);
  const duda = v.dudas[0] ? lineaDuda(v.dudas[0]) : undefined;
  // Lo de la persona: lo pendiente más lo nuevo, sin repetir el mismo texto.
  const perfil = [...previo.perfil];
  for (const h of v.perfil) if (!perfil.some((x) => textoComparable(x.texto) === textoComparable(h.texto))) perfil.push(h);
  if (perfil.length) entendido.push(lineaPerfilSugerido(perfil));
  return {
    entendido, falta, ...(duda ? { duda } : {}),
    plan: { sugeridos, ...(Object.keys(quitar).length ? { quitar } : {}), historia: v.historia, ...(perfil.length ? { perfil } : {}) },
  };
}

/** ¿Dos listas de lo entendido dicen lo mismo? (sin importar el orden). Pura. */
export function mismoEntendido(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  const x = [...a].map(normal).sort();
  const y = [...b].map(normal).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Lo que el viaje tiene, por la etiqueta de cada campo y como se le dice a una persona («Fecha de regreso: 16 nov»). Lo
 * devuelve `ver_viaje` y lo guarda la escritura confirmada: es lo que respalda que el bot diga «está registrada…». Pura.
 */
export function registradoDe(campos: ReadonlyArray<CampoEntendible>, valores: Record<string, unknown>, solo?: ReadonlyArray<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of campos) {
    if (f.slug.startsWith('_') || (solo && !solo.includes(f.slug))) continue;
    const v = valores[f.slug];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || typeof v === 'object') continue;
    out[f.label ?? f.slug] = valorLegible(f, v);
  }
  return out;
}

/** El hecho tras el toque. Pura. */
export function lineaCargada(codigo: string, escritos: ReadonlyArray<string>, campos: ReadonlyArray<CampoEntendible>, quitados: ReadonlyArray<string> = []): string {
  const porSlug = new Map(campos.map((f) => [f.slug, f.label ?? f.slug]));
  const nombres = (xs: ReadonlyArray<string>) => xs.map((s) => porSlug.get(s) ?? s).join(', ');
  if (!escritos.length && !quitados.length) return `No había datos nuevos para ${codigo}: no cambié nada.`;
  if (!escritos.length) return `Quité de ${codigo}: ${nombres(quitados)}.`;
  return `Cargué en ${codigo}: ${nombres(escritos)}.${quitados.length ? ` Quité: ${nombres(quitados)}.` : ''}`;
}
