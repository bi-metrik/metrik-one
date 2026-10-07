// ============================================================
// Núcleo conversacional — lo que se anota en un viaje (bandeja de solicitudes)
// ------------------------------------------------------------
// Falla en vivo del 2026-10-07 (Trappvel, número de prueba): el bot pedía otra vez lo que ya le habían dicho y lo que
// sí entendía no se guardaba. Las cuatro piezas de aquí son puras:
//   · `escritosDelViaje`: lo que el comercial escribió de ESE viaje (desde que lo nombró o desde que pidió abrirlo), no
//     solo el texto que el modelo copió en `proponer`. Así la extracción ve «5 noches, desde el 11» aunque el último
//     mensaje solo diga «salen desde Bogotá».
//   · `planDeCarga`: la extracción de hoy (`entenderEntrega` con sus guardianes) + el regreso que se deriva (salida + N
//     noches) + las alternativas de una opción cerrada («4 o 5 estrellas») + la unión con la propuesta pendiente del
//     mismo viaje (lo nuevo gana solo en el mismo campo). El resumen muestra solo lo que cambiaría.
//   · `lineaCargada`: el hecho que se le dice al comercial tras el toque.
// La base la tocan los puertos (`produccion.ts`, `memoria.ts`); esto no escribe nada.
// ============================================================

import { normal } from '../verificador.ts';
import type { FilaConversacion } from '../tipos.ts';
import { aplanarBloques } from '../../niveles-solicitud.ts';
import {
  DIAS_EN_LETRAS, fraseNombraNumero, fraseNombraOpcion, huecos, normalizarTexto,
} from '../../wa-entendimiento-reglas.ts';
import type { CampoEntendible, Sugerido } from '../../wa-entendimiento-reglas.ts';
import { cargarEnExistente, sugeridosConDeducciones, valorLegible } from '../../wa-carga-reglas.ts';
import { entenderEntrega } from '../../wa-guardianes.ts';
import type { MensajeEntrega } from '../../wa-guardianes.ts';

const RE_CODIGO = /\b[A-ZÑ]\d{0,2} \d{2} \d{1,4}\b/gu;
/** Lo que se le pasa a la extracción, como mucho (el mismo tope de la conversación que ve el modelo: 6.000 tokens). */
export const TOPE_ESCRITOS_CARACTERES = 24_000;

// ── Lo que el comercial escribió de un viaje ─────────────────────────────────

const delEquipo = (f: FilaConversacion) => f.direccion === 'entrante' && f.clase !== 'reenvio';
const escritoDelEquipo = (f: FilaConversacion) => f.direccion === 'entrante' && (f.clase === 'escrito' || f.clase === 'audio') && !!f.texto?.trim();

/** La opción que el comercial nombró escribiendo («1», «el de san andrés»). Inyectada para no duplicar el candado. */
type OpcionNombrada = (opciones: ReadonlyArray<{ titulo: string; descripcion?: string }>, texto: string) => number | null;

/**
 * Dónde se nombró cada viaje, en orden: un código en un escrito del equipo, la opción que eligió escribiendo, el viaje
 * que abrió con su toque y el viaje nuevo que se le propuso (clave `nuevo:<huella>`, desde el primer mensaje de ese
 * turno; al abrirse pasa a ser su código). Pura.
 */
export function nombramientos(
  filas: FilaConversacion[],
  opcionNombrada: OpcionNombrada,
  alias: Record<string, string> = {},
): Array<{ i: number; clave: string }> {
  const out: Array<{ i: number; clave: string }> = [];
  const alias2 = { ...alias };
  const inicioDeTurno = new Map<string, number>();
  filas.forEach((f, i) => { if (f.turno_id && !inicioDeTurno.has(f.turno_id)) inicioDeTurno.set(f.turno_id, i); });
  let opciones: ReadonlyArray<{ titulo: string; descripcion?: string }> | null = null;
  filas.forEach((f, i) => {
    if (delEquipo(f)) {
      for (const m of (f.texto ?? '').toUpperCase().matchAll(RE_CODIGO)) out.push({ i, clave: m[0] });
      if (opciones && f.clase === 'escrito') {
        const k = opcionNombrada(opciones, f.texto ?? '');
        if (k !== null) for (const m of opciones[k].titulo.toUpperCase().matchAll(RE_CODIGO)) out.push({ i, clave: m[0] });
      }
      opciones = null;
    }
    if (f.direccion === 'saliente') opciones = f.opciones?.length ? f.opciones : null;
    const p = f.traza?.propuesta;
    if (p?.accion === 'viaje_nuevo') out.push({ i: f.turno_id ? inicioDeTurno.get(f.turno_id) ?? i : i, clave: `nuevo:${p.huella}` });
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
): string[] {
  const ev = nombramientos(filas, opcionNombrada, alias);
  const tramos: Array<[number, number]> = [];
  ev.forEach((x, k) => {
    if (x.clave !== codigo || (k > 0 && ev[k - 1].clave === codigo)) return;
    tramos.push([x.i, ev.slice(k + 1).find((y) => y.clave !== codigo)?.i ?? filas.length]);
  });
  // Un mensaje de este turno que nombra OTRO viaje (y no este) es de ese otro.
  const deOtro = new Set(ev.filter((x) => x.clave !== codigo).map((x) => x.i));
  for (const x of ev) if (x.clave === codigo) deOtro.delete(x.i);
  const elegidas = filas.filter((f, i) => escritoDelEquipo(f) && (tramos.some(([d, h]) => i >= d && i < h) || (!f.turno_id && !deOtro.has(i))));
  return recortar(elegidas.map((f) => f.texto!.trim()));
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

// ── Lo que se deriva ─────────────────────────────────────────────────────────

const SLUG_SALIDA = 'fecha_salida';
const SLUG_REGRESO = 'fecha_regreso';
const SLUG_REQUISITOS = 'requisitos_especiales';

/**
 * El regreso cuando dicen cuántas noches: salida + N días. Solo si TODOS los escritos dicen el mismo número de noches
 * (dos números distintos = no se sabe cuál). «5 días» no deriva nada: cinco días son cuatro noches o cinco, según a
 * quién se le pregunte. Pura.
 */
export function regresoPorNoches(textos: ReadonlyArray<string>, salidaISO: unknown): Sugerido | null {
  if (typeof salidaISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(salidaISO)) return null;
  const letras = Object.keys(DIAS_EN_LETRAS).filter((w) => w !== 'primero').join('|');
  const re = new RegExp(`\\b(\\d{1,2}|${letras})\\s+noches?\\b`, 'gu');
  const hallados: Array<{ n: number; frase: string }> = [];
  for (const t of textos) {
    for (const m of normalizarTexto(t).matchAll(re)) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : DIAS_EN_LETRAS[m[1]];
      if (n >= 1 && n <= 60) hallados.push({ n, frase: m[0] });
    }
  }
  const distintos = new Set(hallados.map((h) => h.n));
  if (distintos.size !== 1) return null;
  const { n, frase } = hallados[0];
  const d = new Date(`${salidaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  const valor = d.toISOString().slice(0, 10);
  return { valor, frase, deduccion: `salida ${salidaISO} + ${n} noche${n === 1 ? '' : 's'}` };
}

/**
 * Las opciones concretas de un campo cerrado que nombra la oración de la frase («La categoría puede ser 4 o 5
 * estrellas» nombra 4 y 5). La oración se corta en «.», «;», «,» y saltos: «Son 5 noches, categoría 4» no nombra el 5.
 * Pura.
 */
export function opcionesNombradas(f: CampoEntendible, frase: string, textos: ReadonlyArray<string>): string[] {
  const concretas = (f.opciones ?? []).filter((o) => o.no_definido !== true && String(o.value) !== '');
  if (concretas.length < 2) return [];
  const fr = normalizarTexto(frase);
  const oraciones = textos.flatMap((t) => t.split(/[.;,\n!?]+/u)).map((o) => o.trim()).filter(Boolean);
  const oracion = oraciones.find((o) => normalizarTexto(o).includes(fr)) ?? oraciones.find((o) => fr.includes(normalizarTexto(o))) ?? frase;
  // Con números en la etiqueta («4 estrellas») mandan los números: «estrellas» la comparten todas y no nombra ninguna.
  const numeros = (o: { label?: string; value: string }) => [...normalizarTexto(String(o.label ?? o.value)).matchAll(/\d+/g)].map((m) => Number(m[0]));
  return concretas
    .filter((o) => (numeros(o).length ? numeros(o).some((n) => fraseNombraNumero(oracion, n)) : fraseNombraOpcion(f, o, oracion)))
    .map((o) => String(o.value));
}

// ── El plan de una carga ─────────────────────────────────────────────────────

export interface PlanCarga {
  sugeridos: Record<string, Sugerido>;
  historia: string;
}

export interface Preparada {
  /** Lo que cambiaría en el viaje, como se le dice a una persona («Fecha de regreso: 16 nov»). */
  entendido: string[];
  /** Lo que seguiría faltando para cotizar. */
  falta: string[];
  plan: PlanCarga;
}

type Bloque = { fields: CampoEntendible[]; data: Record<string, unknown> };

export function mensajesDeTextos(textos: ReadonlyArray<string>): MensajeEntrega[] {
  return textos.map((t, i) => ({ n: i + 1, cuerpo: t, reenviado: true, tipo: 'text', origen: 'texto' })) as MensajeEntrega[];
}

const vacio = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * La carga que se propone. `raw` es la salida del modelo de extracción sobre `mensajesDeTextos(textos)`; `previo`, el
 * plan de la propuesta pendiente del mismo viaje (se une: lo nuevo gana solo en el mismo campo). Pura.
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
  const porSlug = new Map(campos.map((f) => [f.slug, f]));
  const e = entenderEntrega(p.raw, campos, mensajesDeTextos(p.textos), { hoyISO: p.hoyISO, conocidos: yaTiene });
  const nuevos: Record<string, Sugerido> = { ...e.salida.sugeridos };
  const notas: string[] = [];
  const conRango = new Set<string>();

  // «4 o 5 estrellas» en un campo de UNA opción: no se elige una (sería inventar). Si la config tiene requisitos
  // especiales (texto), las dos quedan ahí y el campo queda para que una persona elija; si no, el campo queda vacío y
  // el resumen lo dice. En un campo de texto no hace falta nada: guarda la frase como la dijeron.
  for (const [slug, s] of Object.entries(nuevos)) {
    const f = porSlug.get(slug);
    if (!f || !(f.opciones ?? []).length) continue;
    const nombradas = opcionesNombradas(f, s.frase, p.textos);
    if (nombradas.length < 2) continue;
    delete nuevos[slug];
    conRango.add(slug);
    const etiquetas = nombradas.map((v) => valorLegible(f, v));
    notas.push(`${f.label ?? slug}: ${etiquetas.slice(0, -1).join(', ')} o ${etiquetas.at(-1)}`);
  }
  if (notas.length && porSlug.has(SLUG_REQUISITOS)) {
    const antes = String(nuevos[SLUG_REQUISITOS]?.valor ?? yaTiene[SLUG_REQUISITOS] ?? '').trim();
    const faltan = notas.filter((n) => !normal(antes).includes(normal(n)));
    if (faltan.length) nuevos[SLUG_REQUISITOS] = { valor: [antes, ...faltan].filter(Boolean).join('; '), frase: nuevos[SLUG_REQUISITOS]?.frase ?? faltan[0] };
  }

  // La unión con la pendiente: nunca se descarta en silencio un dato propuesto y no rechazado.
  const previo = (p.previo && typeof p.previo === 'object' ? (p.previo as Partial<PlanCarga>).sugeridos : null) ?? {};
  const unidos: Record<string, Sugerido> = { ...previo, ...nuevos };
  for (const slug of conRango) if (previo[slug] && !nuevos[slug]) delete unidos[slug];

  // El regreso que se deriva: salida (la de ahora o la que ya tiene) + N noches.
  if (porSlug.has(SLUG_REGRESO) && !unidos[SLUG_REGRESO] && vacio(yaTiene[SLUG_REGRESO])) {
    const r = regresoPorNoches(p.textos, unidos[SLUG_SALIDA]?.valor ?? yaTiene[SLUG_SALIDA]);
    if (r) unidos[SLUG_REGRESO] = r;
  }

  const meta = { entrega_id: 'agente', en: p.ahoraIso, origenDe: () => 'mensaje' as const };
  const sugeridos = sugeridosConDeducciones(p.bloques, unidos, meta);

  // Lo que cambiaría (en seco, como `cargar`): el resumen no repite lo que el viaje ya tiene.
  const cambia: string[] = [];
  const vistos = new Set<string>();
  for (const b of p.bloques) {
    const r = cargarEnExistente(b.data, b.fields, sugeridos, meta, vistos);
    cambia.push(...r.escritos, ...r.actualizados.map((a) => a.slug), ...r.conflictos.map((c) => c.slug));
  }
  const entendido = campos.filter((f) => cambia.includes(f.slug)).map((f) => `${f.label ?? f.slug}: ${valorLegible(f, sugeridos[f.slug].valor)}`);
  const quedaria = { ...yaTiene, ...Object.fromEntries(Object.entries(sugeridos).map(([k, s]) => [k, s.valor])) };
  // Un campo cerrado cuyas alternativas quedaron en requisitos (en este plan o de antes) se nombra con ellas.
  const requisitos = String(quedaria[SLUG_REQUISITOS] ?? '');
  const falta = huecos(campos, quedaria).minimo.faltan.map((f) => {
    const label = f.label ?? f.slug;
    const nota = [...notas, ...requisitos.split(/;\s*/)].find((n) => normal(n).startsWith(`${normal(label)}: `));
    return nota && (porSlug.get(f.slug)?.opciones ?? []).length ? `${label} (dijeron ${nota.slice(label.length + 2).toLowerCase()}: ¿cuál?)` : label;
  });
  if (notas.length && !porSlug.has(SLUG_REQUISITOS)) {
    for (const n of notas) entendido.push(`(sin guardar) ${n}: el campo es de una sola opción`);
  }
  return { entendido, falta, plan: { sugeridos, historia: e.salida.historia } };
}

/** ¿Dos listas de lo entendido dicen lo mismo? (sin importar el orden). Pura. */
export function mismoEntendido(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  const x = [...a].map(normal).sort();
  const y = [...b].map(normal).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** El hecho tras el toque. Pura. */
export function lineaCargada(codigo: string, escritos: ReadonlyArray<string>, campos: ReadonlyArray<CampoEntendible>): string {
  const porSlug = new Map(campos.map((f) => [f.slug, f.label ?? f.slug]));
  return escritos.length
    ? `Cargué en ${codigo}: ${escritos.map((s) => porSlug.get(s) ?? s).join(', ')}.`
    : `No había datos nuevos para ${codigo}: no cambié nada.`;
}
