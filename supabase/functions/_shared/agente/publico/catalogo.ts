// ============================================================
// Asistente público — el catálogo, las funciones y las políticas, leídos del reglamento publicado (§7, §8.1)
// ------------------------------------------------------------
// El contenido variable (precios, fechas, funciones, dirección, políticas) nunca va en el prompt: vive en fichas del
// reglamento y llega por herramienta. Así Sabor cambia la película de la semana publicando una versión nueva del
// reglamento, sin desplegar. Las fichas:
//   · `cat.<id>`  experiencia (valores.tipo = 'experiencia'): nombre, incluye, precio por persona, abono, duración,
//                 edad sugerida, dirección, vigencia (`vigente_desde`/`vigente_hasta`, fechas de Bogotá), versión.
//   · `fun.<id>`  función (valores.tipo = 'funcion'): experiencia e inicio (ISO con zona).
//   · `pol.<clave>` política publicada: el texto va en `hacer`.
// Van con `carga: con_herramienta` y sin herramientas: no entran al sistema ni viajan pegadas a otra herramienta.
// «Publicada» = está en la versión publicada del reglamento (`bot_reglamentos`). Puro.
// ============================================================

import type { Ficha, Reglamento } from '../tipos.ts';

export interface Experiencia {
  id: string;
  nombre: string;
  incluye: string;
  precioPersona: number;
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
      id, nombre, incluye: s(x.incluye) ?? '', precioPersona: precio, abono: n(x.abono), duracion: s(x.duracion), edadSugerida: s(x.edad_sugerida),
      direccion: s(x.direccion), vigenteDesde: desde, vigenteHasta: hasta, version: s(x.version) ?? 'sin versión', fechaFicha: fecha(x.fecha_ficha), ejemplo: x.ejemplo === true,
    };
  }).filter((x): x is Experiencia => !!x);
}

/** Las vigentes hoy (hora de Bogotá). Una vencida no sale nunca (§8.1: nunca la película anterior). Pura. */
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

export function politicas(r: Reglamento): Array<{ clave: string; texto: string }> {
  return r.fichas.filter((f) => f.clave.startsWith('pol.')).map((f) => ({ clave: f.clave.slice(4), texto: f.hacer }));
}

/** «$95.000» (pesos, sin decimales). Pura. */
export function pesos(x: number): string {
  return `$${Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** «sábado 24 de octubre, 7:00 p. m.» en hora de Bogotá. Pura. */
export function cuandoBogota(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });
  const hora = d.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true });
  return `${dia}, ${hora}`.replace(/ | /g, ' ');
}
