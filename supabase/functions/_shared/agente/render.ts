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
/**
 * El payload de los botones de respuesta rápida de NUESTRAS plantillas: `ag|t|<plantilla>|<accion>` (spec 2026-10-26,
 * asistentes-roles-y-funciones §4.5). Se arma con `payloadPlantilla`; nunca a mano.
 */
export const PREFIJO_PLANTILLA = 'ag|t|';

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

/** Los botones de una propuesta: [sí] [no], con la huella en el id. */
export function botonesPropuesta(huella: string, si: string, no: string): Opcion[] {
  return [
    { id: `${PREFIJO_PROPUESTA}${huella}|si`, titulo: cortarEnPalabra(si, META.tituloBoton) },
    { id: `${PREFIJO_PROPUESTA}${huella}|no`, titulo: cortarEnPalabra(no, META.tituloBoton) },
  ];
}

export type Toque =
  | { clase: 'propuesta'; huella: string; si: boolean }
  | { clase: 'conversacion' }
  | { clase: 'plantilla'; plantilla: string; accion: string };

/**
 * Lee el id de un toque del agente. `null` = no es del agente y sigue por el camino de siempre: otro botón, un payload
 * sin prefijo o el `rec_ok` de los recordatorios (#966, que el webhook resuelve antes de llegar aquí).
 */
export function leerToque(id: string | null | undefined): Toque | null {
  if (!id) return null;
  if (id.startsWith(PREFIJO_PROPUESTA)) {
    const [huella, accion] = id.slice(PREFIJO_PROPUESTA.length).split('|');
    if (!huella || (accion !== 'si' && accion !== 'no')) return null;
    return { clase: 'propuesta', huella, si: accion === 'si' };
  }
  if (id.startsWith(PREFIJO_CONVERSACION)) return { clase: 'conversacion' };
  if (id.startsWith(PREFIJO_PLANTILLA)) {
    const partes = id.slice(PREFIJO_PLANTILLA.length).split('|');
    if (partes.length !== 2 || !partes.every((x) => CLAVE_PLANTILLA.test(x))) return null;
    return { clase: 'plantilla', plantilla: partes[0], accion: partes[1] };
  }
  return null;
}

// ── El botón de una plantilla nuestra (§4.5) ──────────────────────────────────

/**
 * Nombre de la plantilla y acción: minúsculas, dígitos y guion bajo, como pide Meta para el nombre de una plantilla
 * («Lowercase, alphanumeric characters and underscores only», Template components). Sin `|`, que separa las partes.
 */
const CLAVE_PLANTILLA = /^[a-z0-9_]+$/;

/**
 * Largo máximo del payload. Meta NO publica un tope para el `payload` de un botón de respuesta rápida de plantilla
 * (revisado el 2026-10-26 en la referencia de la Message API y en la de la versión anterior: «Developer-defined payload
 * that is returned when the button is clicked», sin largo). El único tope publicado para el id de un botón es el de los
 * botones de respuesta: «Maximum 256 characters»
 * (https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages).
 * Se usa ese, el mismo de `META.idBoton`.
 */
export const MAX_PAYLOAD_PLANTILLA = META.idBoton;

/**
 * Arma el payload de un botón de una plantilla nuestra: `ag|t|<plantilla>|<accion>`. Lanza si la plantilla o la acción
 * no son claves válidas o si el payload pasa del tope: es un error de quien construye la plantilla, no del usuario. Pura.
 */
export function payloadPlantilla(plantilla: string, accion: string): string {
  if (!CLAVE_PLANTILLA.test(plantilla)) throw new Error(`payloadPlantilla: «${plantilla}» no es un nombre de plantilla (minúsculas, dígitos y _)`);
  if (!CLAVE_PLANTILLA.test(accion)) throw new Error(`payloadPlantilla: «${accion}» no es una acción (minúsculas, dígitos y _)`);
  const p = `${PREFIJO_PLANTILLA}${plantilla}|${accion}`;
  if (p.length > MAX_PAYLOAD_PLANTILLA) throw new Error(`payloadPlantilla: ${p.length} caracteres; el máximo es ${MAX_PAYLOAD_PLANTILLA}`);
  return p;
}

/**
 * El componente que se manda con la plantilla para que el botón `index` devuelva ese payload. Sin él, Meta devuelve
 * como payload el TEXTO del botón (ejemplo de la doc: `"payload": "Unsubscribe", "text": "Unsubscribe"`) y el agente
 * no lo reconoce. Forma de `TemplateComponent` (`wa-respond.ts`), declarada aquí para no importar la red. Pura.
 */
export function componenteBotonPlantilla(plantilla: string, accion: string, index: number): {
  type: 'button'; sub_type: 'quick_reply'; index: string; parameters: Array<{ type: 'payload'; payload: string }>;
} {
  if (!Number.isInteger(index) || index < 0 || index > 9) throw new Error(`componenteBotonPlantilla: índice ${index} fuera de 0..9`);
  return { type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload: payloadPlantilla(plantilla, accion) }] };
}
