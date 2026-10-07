// ============================================================
// Núcleo conversacional — el reglamento (los parámetros de funcionamiento, §3.4)
// ------------------------------------------------------------
// Fichas cortas con nombre. Tres formas de carga:
//   · `siempre`          — van en cada turno (perfil, alcance, invariantes, glosario, estilo y guías cortas);
//   · `indice`           — en cada turno va una línea («id: cuando»); el detalle lo trae `consultar_reglas`;
//   · `con_herramienta`  — la herramienta las devuelve junto con su resultado, justo cuando hacen falta.
// Se guardan en `bot_parametros` (borrador) y se publican como foto inmutable en `bot_reglamentos` (con huella). El
// núcleo solo lee versiones publicadas.
//
// Lo que NO es un parámetro: los candados. La ficha `inv.confirmar` explica la regla; si alguien la borra, el candado
// sigue en el código.
// ============================================================

import type { Ficha, Reglamento } from './tipos.ts';

/** Respuestas fijas del núcleo si el reglamento no trae la suya (un reglamento incompleto no deja al bot mudo). */
export const RESPUESTAS_FIJAS_NUCLEO: Record<string, string> = {
  'rf.fuera_de_tema': 'Eso no lo manejo. Dime en qué te ayudo con lo de este chat.',
  'rf.acuse_reenvio': 'Recibido. Sigue enviando; cuando termines dime y te muestro el resumen.',
  'rf.acuse_lento': 'Dame un momento, lo estoy revisando.',
  'rf.modelo_caido': 'No pude revisarlo ahora. Si es una decisión, toca una opción; si no, escríbemelo de nuevo en un rato.',
  'rf.toque_viejo': 'Ese resumen ya cambió. Este es el de ahora:',
  'rf.no_hice_nada': 'Listo, no hice nada.',
};

const ORDEN_SIEMPRE = ['perfil', 'alcance', 'invariante', 'glosario', 'estilo', 'guia', 'procedimiento'];

function linea(f: Ficha): string {
  return f.cuando ? `${f.clave}: cuando ${f.cuando} → ${f.hacer}` : `${f.clave}: ${f.hacer}`;
}

/** Bloque 2 del contexto: lo que va en todo turno. Las respuestas fijas no van: las escribe el código. */
export function bloqueSiempre(r: Reglamento): string {
  const fichas = r.fichas.filter((f) => f.carga === 'siempre' && f.tipo !== 'respuesta_fija');
  const porTipo = (t: string) => fichas.filter((f) => f.tipo === t).sort((a, b) => (b.prioridad ?? 0) - (a.prioridad ?? 0));
  const partes: string[] = [];
  for (const t of ORDEN_SIEMPRE) {
    const fs = porTipo(t);
    if (fs.length) partes.push(`[${t}]\n${fs.map(linea).join('\n')}`);
  }
  return partes.join('\n\n');
}

/** Bloque 3: una línea por ficha de índice. */
export function bloqueIndice(r: Reglamento): string {
  return r.fichas
    .filter((f) => f.carga === 'indice')
    .map((f) => `${f.clave}: ${f.cuando ?? f.hacer.slice(0, 120)}`)
    .join('\n');
}

/** Las fichas que viajan con una herramienta (`con_herramienta`), como texto corto. */
export function fichasDeHerramienta(r: Reglamento, herramienta: string): string[] {
  return r.fichas
    .filter((f) => f.carga === 'con_herramienta' && (f.herramientas ?? []).includes(herramienta))
    .map(linea);
}

/** `consultar_reglas`: por ids exactos o por tema (palabras en `cuando`/`hacer`). Solo de la versión publicada. */
export function consultar(r: Reglamento, args: { ids?: unknown; tema?: unknown }): { fichas: string[]; no_existen: string[] } {
  const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
  const porClave = new Map(r.fichas.map((f) => [f.clave, f]));
  const fichas: string[] = [];
  const noExisten: string[] = [];
  for (const id of ids) {
    const f = porClave.get(id);
    if (f && f.tipo !== 'respuesta_fija') fichas.push(linea(f));
    else noExisten.push(id);
  }
  const tema = typeof args.tema === 'string' ? normal(args.tema) : '';
  if (tema) {
    const palabras = tema.split(' ').filter((w) => w.length >= 4);
    for (const f of r.fichas) {
      if (f.tipo === 'respuesta_fija' || ids.includes(f.clave)) continue;
      const t = normal(`${f.clave} ${f.cuando ?? ''} ${f.hacer}`);
      if (palabras.some((w) => t.includes(w))) fichas.push(linea(f));
      if (fichas.length >= 6) break;
    }
  }
  return { fichas, no_existen: noExisten };
}

function normal(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, ' ').trim();
}

/** Los temas cerrados de `responder.tema`: los del reglamento (`alc.temas`.valores.temas) más `fuera`. */
export function temas(r: Reglamento): string[] {
  const f = r.fichas.find((x) => x.clave === 'alc.temas');
  const t = Array.isArray(f?.valores?.temas) ? (f!.valores!.temas as unknown[]).map(String).filter(Boolean) : [];
  return [...new Set([...(t.length ? t : ['conversacion']), 'fuera'])];
}

/** El texto de una respuesta fija: la del reglamento o, si no la trae, la del núcleo. */
export function respuestaFija(r: Reglamento | null, clave: string): string {
  const f = r?.fichas.find((x) => x.clave === clave && x.tipo === 'respuesta_fija');
  return f?.hacer ?? RESPUESTAS_FIJAS_NUCLEO[clave] ?? '';
}

/** El perfil (nombre del bot, audiencia, idioma) para el prompt del núcleo. */
export function perfil(r: Reglamento): Record<string, unknown> {
  return r.fichas.find((x) => x.tipo === 'perfil')?.valores ?? {};
}

/** Texto canónico de las fichas (orden por clave, llaves ordenadas): la base del sha256 de una versión. Pura. */
export function canonico(fichas: Ficha[]): string {
  const orden = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(orden);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, orden((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify([...fichas].sort((a, b) => a.clave.localeCompare(b.clave)).map(orden));
}

export async function huellaDe(fichas: Ficha[]): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonico(fichas)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Una ficha bien formada (lo que se carga de la base pasa por aquí). */
export function fichaValida(v: unknown): Ficha | null {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : null;
  if (!o || typeof o.clave !== 'string' || typeof o.hacer !== 'string') return null;
  const tipos = ['perfil', 'alcance', 'invariante', 'glosario', 'guia', 'procedimiento', 'respuesta_fija', 'estilo'];
  const cargas = ['siempre', 'indice', 'con_herramienta'];
  if (!tipos.includes(String(o.tipo)) || !cargas.includes(String(o.carga))) return null;
  return {
    clave: o.clave,
    tipo: o.tipo as Ficha['tipo'],
    carga: o.carga as Ficha['carga'],
    cuando: typeof o.cuando === 'string' ? o.cuando : null,
    hacer: o.hacer,
    herramientas: Array.isArray(o.herramientas) ? o.herramientas.map(String) : null,
    prioridad: typeof o.prioridad === 'number' ? o.prioridad : null,
    fuente: typeof o.fuente === 'string' ? o.fuente : null,
    valores: o.valores && typeof o.valores === 'object' ? o.valores as Record<string, unknown> : null,
  };
}
