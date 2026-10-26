// ============================================================
// Asistente público — el catálogo, las funciones y las políticas, leídos del reglamento publicado (§7, §8.1)
// ------------------------------------------------------------
// El contenido variable (precios, fechas, funciones, dirección, políticas) nunca va en el prompt: vive en fichas del
// reglamento y llega por herramienta. Así Sabor cambia o agrega experiencias (cenas con película, catas, clases…)
// publicando una versión nueva del reglamento, sin desplegar. Todas usan la misma ficha: el código no distingue tipos.
// Las fichas:
//   · `cat.<id>`  experiencia (valores.tipo = 'experiencia'): nombre, incluye, precio por persona, abono, duración,
//                 edad sugerida, dirección, vigencia (`vigente_desde`/`vigente_hasta`, fechas de Bogotá), versión.
//   · `fun.<id>`  función (valores.tipo = 'funcion'): experiencia e inicio (ISO con zona).
//   · `pol.<clave>` regla de información general (§8.3: parqueadero, llegada, ninos, mascotas, accesibilidad,
//                 cancelacion_y_cambios, celebraciones, grupos): el texto va en `hacer`. Una clave sin ficha = `sin_dato`.
// La ficha de función ampliada (§8.3, 2026-10-21) vive en el jsonb `valores` de `cat.<id>`: historia, precio por pareja,
// cobro de grupo, condiciones (tipo, monto, unidad, condición, desde, hasta, acumulable), capacidad, disposición,
// ubicaciones (zona, descripción, recargo) y `elige_mesa` (si / no / se_pide). Sin migración: el reglamento ya es jsonb.
// Van con `carga: con_herramienta` y sin herramientas: no entran al sistema ni viajan pegadas a otra herramienta.
// «Publicada» = está en la versión publicada del reglamento (`bot_reglamentos`). Puro.
// ============================================================

import type { Ficha, Reglamento } from '../tipos.ts';

/** Un descuento o recargo de la ficha, con su condición y su vigencia (fechas de Bogotá). */
export interface Condicion {
  id: string;
  tipo: 'descuento' | 'recargo';
  /** En pesos. */
  monto: number;
  /** «por persona», «por reserva»… (texto de la ficha). */
  unidad: string | null;
  /** Qué tiene que pasar para que aplique, completa («pagar antes del jueves»). */
  condicion: string;
  desde: string;
  hasta: string;
  /** Si se puede sumar con otra. Ausente = no (la plantilla: en blanco, no se suman). */
  acumulable: boolean;
}

/** Una zona que cambia la experiencia o el precio. */
export interface Ubicacion { zona: string; descripcion: string; recargo: number | null; unidad: string | null }

export type EligeMesa = 'si' | 'no' | 'se_pide';

export interface Experiencia {
  id: string;
  nombre: string;
  /** La historia, con las palabras de Sabor (3 a 5 frases). */
  historia: string | null;
  incluye: string;
  precioPersona: number;
  precioPareja: number | null;
  /** Cómo se cobra un grupo de otro tamaño. Sin esto, la pregunta es `duda_abierta`. */
  cobroGrupo: string | null;
  condiciones: Condicion[];
  /** Puestos de la función: describe la experiencia, nunca dice que hay cupo. */
  capacidad: number | null;
  disposicion: string | null;
  ubicaciones: Ubicacion[];
  /** `null` = la ficha no lo dice (no se anota preferencia: es duda abierta). */
  eligeMesa: EligeMesa | null;
  abono: number | null;
  duracion: string | null;
  edadSugerida: string | null;
  direccion: string | null;
  vigenteDesde: string;
  vigenteHasta: string;
  version: string;
  fechaFicha: string | null;
  ejemplo: boolean;
}

export interface Funcion { id: string; experiencia: string; inicio: string }

const v = (f: Ficha) => (f.valores ?? {}) as Record<string, unknown>;
const s = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);
const n = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
const fecha = (x: unknown): string | null => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);

/** La fecha de hoy en Bogotá («2026-10-23»). Pura. */
export function hoyBogota(ms: number): string {
  return new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function experiencias(r: Reglamento): Experiencia[] {
  return r.fichas.filter((f) => f.clave.startsWith('cat.') && v(f).tipo === 'experiencia').map((f) => {
    const x = v(f);
    const id = s(x.id) ?? f.clave.slice(4);
    const nombre = s(x.nombre);
    const precio = n(x.precio_persona);
    const desde = fecha(x.vigente_desde);
    const hasta = fecha(x.vigente_hasta);
    if (!nombre || precio === null || !desde || !hasta) return null;
    return {
      id, nombre, historia: s(x.historia), incluye: s(x.incluye) ?? '', precioPersona: precio, precioPareja: n(x.precio_pareja), cobroGrupo: s(x.cobro_grupo),
      condiciones: (Array.isArray(x.condiciones) ? x.condiciones : []).map(condicionDe).filter((c): c is Condicion => !!c),
      capacidad: n(x.capacidad), disposicion: s(x.disposicion),
      ubicaciones: (Array.isArray(x.ubicaciones) ? x.ubicaciones : []).map(ubicacionDe).filter((u): u is Ubicacion => !!u),
      eligeMesa: x.elige_mesa === 'si' || x.elige_mesa === 'no' || x.elige_mesa === 'se_pide' ? x.elige_mesa : null,
      abono: n(x.abono), duracion: s(x.duracion), edadSugerida: s(x.edad_sugerida),
      direccion: s(x.direccion), vigenteDesde: desde, vigenteHasta: hasta, version: s(x.version) ?? 'sin versión', fechaFicha: fecha(x.fecha_ficha), ejemplo: x.ejemplo === true,
    };
  }).filter((x): x is Experiencia => !!x);
}

function condicionDe(v: unknown): Condicion | null {
  const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const monto = n(x.monto);
  const condicion = s(x.condicion);
  const desde = fecha(x.desde);
  const hasta = fecha(x.hasta);
  if ((x.tipo !== 'descuento' && x.tipo !== 'recargo') || monto === null || !condicion || !desde || !hasta) return null;
  return { id: s(x.id) ?? condicion, tipo: x.tipo, monto, unidad: s(x.unidad), condicion, desde, hasta, acumulable: x.acumulable === true };
}

function ubicacionDe(v: unknown): Ubicacion | null {
  const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const zona = s(x.zona);
  if (!zona) return null;
  return { zona, descripcion: s(x.descripcion) ?? '', recargo: n(x.recargo), unidad: s(x.unidad) };
}

/** Las condiciones con vigencia hoy (hora de Bogotá): una vencida o futura no sale nunca. Pura. */
export function condicionesVigentes(e: Pick<Experiencia, 'condiciones'>, ahoraMs: number): Condicion[] {
  const hoy = hoyBogota(ahoraMs);
  return e.condiciones.filter((c) => c.desde <= hoy && hoy <= c.hasta);
}

/** La zona de la ficha que corresponde a lo que dijo el cliente o el modelo («frente», «mesa del frente»). Pura. */
export function zonaDe(e: Pick<Experiencia, 'ubicaciones'>, texto: string | null | undefined): Ubicacion | null {
  const t = ` ${String(texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ')} `;
  return e.ubicaciones.find((u) => t.includes(` ${u.zona.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')} `)) ?? null;
}

/** Las vigentes hoy (hora de Bogotá). Una vencida no sale nunca (§8.1: nunca la experiencia anterior). Pura. */
export function vigentes(r: Reglamento, ahoraMs: number): Experiencia[] {
  const hoy = hoyBogota(ahoraMs);
  return experiencias(r).filter((e) => e.vigenteDesde <= hoy && hoy <= e.vigenteHasta);
}

export function funciones(r: Reglamento): Funcion[] {
  return r.fichas.filter((f) => f.clave.startsWith('fun.') && v(f).tipo === 'funcion').map((f) => {
    const x = v(f);
    const experiencia = s(x.experiencia);
    const inicio = s(x.inicio);
    if (!experiencia || !inicio || Number.isNaN(Date.parse(inicio))) return null;
    return { id: s(x.id) ?? f.clave.slice(4), experiencia, inicio };
  }).filter((x): x is Funcion => !!x);
}

/** Las funciones futuras de una experiencia, en orden. Nunca dicen si hay cupo (eso es etapa 2). Pura. */
export function funcionesFuturas(r: Reglamento, experiencia: string, ahoraMs: number, max = 10): Funcion[] {
  return funciones(r)
    .filter((f) => f.experiencia === experiencia && Date.parse(f.inicio) > ahoraMs)
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))
    .slice(0, max);
}

/** Las claves de `consultar_reglas` (§8.3). Una sin ficha devuelve `sin_dato`. */
export const CLAVES_REGLAS = ['parqueadero', 'llegada', 'ninos', 'mascotas', 'accesibilidad', 'cancelacion_y_cambios', 'celebraciones', 'grupos'] as const;

export function politicas(r: Reglamento): Array<{ clave: string; texto: string }> {
  return r.fichas.filter((f) => f.clave.startsWith('pol.')).map((f) => ({ clave: f.clave.slice(4), texto: f.hacer }));
}

/** «$95.000» (pesos, sin decimales). Pura. */
export function pesos(x: number): string {
  return `$${Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** «sábado 24 de octubre» en hora de Bogotá. Pura. */
export function fechaBogota(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' }).replace(/ | /g, ' ');
}

/** «7:00 p. m.» en hora de Bogotá. Pura. */
export function horaBogota(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/ | /g, ' ');
}

/** «sábado 24 de octubre, 7:00 p. m.» en hora de Bogotá. Pura. */
export function cuandoBogota(iso: string): string {
  return `${fechaBogota(iso)}, ${horaBogota(iso)}`;
}

/**
 * Las funciones agrupadas por fecha de Bogotá, en orden (Mauricio, 26-oct: primero la fecha y después el horario). Así
 * el modelo ve cuántos horarios tiene cada fecha sin contar. Pura.
 */
export function funcionesPorFecha(fs: Funcion[]): Array<{ fecha: string; horarios: Array<{ id: string; hora: string }> }> {
  const grupos: Array<{ fecha: string; horarios: Array<{ id: string; hora: string }> }> = [];
  for (const f of [...fs].sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))) {
    const fecha = fechaBogota(f.inicio);
    const g = grupos.find((x) => x.fecha === fecha) ?? (grupos.push({ fecha, horarios: [] }), grupos.at(-1)!);
    g.horarios.push({ id: f.id, hora: horaBogota(f.inicio) });
  }
  return grupos;
}
