// ============================================================
// Núcleo conversacional — texto, botones o lista, con los límites de Meta (§3.3)
// ------------------------------------------------------------
// El modelo decide SI ofrece opciones; el código decide el formato por la cantidad:
//   0 → texto (≤ 600, tope nuestro) · 1 a 3 → botones (título ≤ 20, único; cuerpo ≤ 1024; id ≤ 256)
//   4 a 10 → lista (≤ 10 filas en total; título de fila ≤ 24; descripción ≤ 72; botón ≤ 20; sección ≤ 24)
//   más de 10 → no se permite.
// Límites leídos por Yuto de la documentación de Meta el 2026-10-06 (§1.9).
// Si algo se pasa, el error vuelve al modelo UNA vez para que lo corrija; la segunda, el código corta en la palabra.
// Los ids de las opciones los pone el código (`ag|<turno>|<n>`), nunca el modelo.
// ============================================================

import type { Opcion, Salida } from './tipos.ts';

export const META = {
  botones: 3, tituloBoton: 20, cuerpoBotones: 1024, idBoton: 256,
  filas: 10, tituloFila: 24, descripcionFila: 72, botonLista: 20, cuerpoLista: 4096, idFila: 200,
};
export const BOTON_LISTA = 'Ver opciones';
export const PREFIJO_CONVERSACION = 'ag|c|';
export const PREFIJO_PROPUESTA = 'ag|p|';
/** [Verlos] de «Tienes … sin confirmar»: revive esa propuesta sin modelo (2026-10-21, obras). */
export const PREFIJO_REVIVIR = 'ag|v|';

export interface OpcionModelo { titulo: string; descripcion?: string }

/** Corta en el último espacio antes del tope (sin dejar media palabra). Cuenta caracteres, no bytes. Pura. */
export function cortarEnPalabra(s: string, max: number): string {
  const c = [...s.trim()];
  if (c.length <= max) return c.join('');
  const corte = c.slice(0, max).join('');
  const i = corte.lastIndexOf(' ');
  return (i >= Math.floor(max / 2) ? corte.slice(0, i) : corte).replace(/[\s,.;:–-]+$/u, '');
}

const largo = (s: string) => [...s].length;

/** Lee las opciones que mandó el modelo (strings u objetos). */
export function opcionesDelModelo(v: unknown): OpcionModelo[] {
  if (!Array.isArray(v)) return [];
  return v.map((o) => {
    if (typeof o === 'string') return { titulo: o.trim() };
    const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
    return { titulo: String(x.titulo ?? x.title ?? '').trim(), ...(x.descripcion ? { descripcion: String(x.descripcion).trim() } : {}) };
  }).filter((o) => o.titulo);
}

export type Render = { ok: true; salida: Salida; recortes: string[] } | { ok: false; error: string };

/**
 * Arma la salida. `final`: es el segundo intento (ya no se devuelve error: se corta). `turno`: prefijo de los ids.
 */
export function renderizar(texto: string, opciones: OpcionModelo[], o: { turno: string; topeTexto: number; final: boolean }): Render {
  const recortes: string[] = [];
  // «⏎» es la marca con que `escapar` le muestra al modelo un salto de línea; si la copia, vuelve a ser salto (visto en
  // el arnés, 2026-10-09: «¿Lo anoto…?⏎• Categoría…» en una sola línea, que `sinLineasDelResumen` no reconocía).
  let cuerpo = texto.replace(/[ \t]*⏎[ \t]*/gu, '\n').trim();
  if (largo(cuerpo) > o.topeTexto) {
    if (!o.final) return { ok: false, error: `El texto tiene ${largo(cuerpo)} caracteres; el máximo es ${o.topeTexto}. Acórtalo.` };
    cuerpo = cortarEnPalabra(cuerpo, o.topeTexto);
    recortes.push('texto');
  }
  let ops = opciones;
  if (ops.length > META.filas) {
    if (!o.final) return { ok: false, error: `Máximo ${META.filas} opciones; mandaste ${ops.length}. Muestra las más recientes y ofrece escribir el nombre.` };
    ops = ops.slice(0, META.filas);
    recortes.push('opciones');
  }
  // Únicos (Meta rechaza títulos repetidos en botones).
  const vistos = new Set<string>();
  const repetidos = ops.filter((x) => { const k = x.titulo.toLowerCase(); if (vistos.has(k)) return true; vistos.add(k); return false; });
  if (repetidos.length) {
    if (!o.final) return { ok: false, error: `Hay opciones repetidas: ${repetidos.map((x) => `«${x.titulo}»`).join(', ')}. Cada opción tiene que ser distinta.` };
    const ya = new Set<string>();
    ops = ops.filter((x) => { const k = x.titulo.toLowerCase(); if (ya.has(k)) return false; ya.add(k); return true; });
  }
  if (ops.length === 0) return { ok: true, salida: { tipo: 'texto', texto: cuerpo }, recortes };
  const id = (n: number) => `${PREFIJO_CONVERSACION}${o.turno}|${n + 1}`;
  if (ops.length <= META.botones) {
    const largos = ops.filter((x) => largo(x.titulo) > META.tituloBoton);
    if (largos.length && !o.final) {
      return { ok: false, error: `Estos títulos pasan de ${META.tituloBoton} caracteres: ${largos.map((x) => `«${x.titulo}»`).join(', ')}. Acórtalos.` };
    }
    if (largos.length) recortes.push('titulos');
    const opcionesBot: Opcion[] = ops.map((x, n) => ({ id: id(n), titulo: cortarEnPalabra(x.titulo, META.tituloBoton) }));
    return { ok: true, salida: { tipo: 'botones', texto: cortarEnPalabra(cuerpo, META.cuerpoBotones), opciones: unicos(opcionesBot) }, recortes };
  }
  const largos = ops.filter((x) => largo(x.titulo) > META.tituloFila || (x.descripcion && largo(x.descripcion) > META.descripcionFila));
  if (largos.length && !o.final) {
    return { ok: false, error: `En la lista, el título va hasta ${META.tituloFila} caracteres y la descripción hasta ${META.descripcionFila}. Pásate de: ${largos.map((x) => `«${x.titulo}»`).join(', ')}. Acórtalos (puedes mover el detalle a la descripción).` };
  }
  if (largos.length) recortes.push('titulos');
  const filas: Opcion[] = ops.map((x, n) => ({
    id: id(n),
    titulo: cortarEnPalabra(x.titulo, META.tituloFila),
    ...(x.descripcion ? { descripcion: cortarEnPalabra(x.descripcion, META.descripcionFila) } : {}),
  }));
  return { ok: true, salida: { tipo: 'lista', texto: cortarEnPalabra(cuerpo, META.cuerpoLista), boton: BOTON_LISTA, opciones: unicos(filas) }, recortes };
}

/** Si cortar dejó dos títulos iguales, el segundo lleva su número. */
function unicos(ops: Opcion[]): Opcion[] {
  const ya = new Set<string>();
  return ops.map((x, i) => {
    let t = x.titulo;
    if (ya.has(t.toLowerCase())) t = cortarEnPalabra(`${i + 1}. ${t}`, META.tituloBoton);
    ya.add(t.toLowerCase());
    return { ...x, titulo: t };
  });
}

/**
 * Los botones de una propuesta: [sí] [extras…] [no], con la huella en el id. Un «sí» o un «no» vacío no sale (una lista
 * de elecciones). Los extras: `|a:<clave>` (no escribe) o `|e:<clave>` (escribe con esa elección).
 */
export function botonesPropuesta(huella: string, si: string, no: string, extras: Array<{ clave: string; titulo: string; tipo: 'alt' | 'elige'; descripcion?: string }> = []): Opcion[] {
  const conLista = (si ? 1 : 0) + (no ? 1 : 0) + extras.length > META.botones;
  const tope = conLista ? META.tituloFila : META.tituloBoton;
  return [
    ...(si ? [{ id: `${PREFIJO_PROPUESTA}${huella}|si`, titulo: cortarEnPalabra(si, tope) }] : []),
    ...extras.map((x) => ({
      id: `${PREFIJO_PROPUESTA}${huella}|${x.tipo === 'elige' ? 'e' : 'a'}:${x.clave}`,
      titulo: cortarEnPalabra(x.titulo, tope),
      ...(conLista && x.descripcion ? { descripcion: cortarEnPalabra(x.descripcion, META.descripcionFila) } : {}),
    })),
    ...(no ? [{ id: `${PREFIJO_PROPUESTA}${huella}|no`, titulo: cortarEnPalabra(no, tope) }] : []),
  ];
}

export type Toque =
  | { clase: 'propuesta'; huella: string; si: boolean; alt?: string; elige?: string }
  | { clase: 'revivir'; huella: string }
  | { clase: 'conversacion' };

/** Lee el id de un toque del agente. */
export function leerToque(id: string | null | undefined): Toque | null {
  if (!id) return null;
  if (id.startsWith(PREFIJO_PROPUESTA)) {
    const [huella, accion] = id.slice(PREFIJO_PROPUESTA.length).split('|');
    if (!huella || !accion) return null;
    if (accion === 'si' || accion === 'no') return { clase: 'propuesta', huella, si: accion === 'si' };
    const m = /^([ae]):(.{1,80})$/.exec(accion);
    if (!m) return null;
    return m[1] === 'e' ? { clase: 'propuesta', huella, si: true, elige: m[2] } : { clase: 'propuesta', huella, si: false, alt: m[2] };
  }
  if (id.startsWith(PREFIJO_REVIVIR)) {
    const huella = id.slice(PREFIJO_REVIVIR.length);
    return /^[0-9a-f]{6,64}$/.test(huella) ? { clase: 'revivir', huella } : null;
  }
  if (id.startsWith(PREFIJO_CONVERSACION)) return { clase: 'conversacion' };
  return null;
}
