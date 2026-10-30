// ============================================================
// Asistente de ventas — qué fotos salen en un turno (Dimpro, venta consultiva, 29-oct)
// ------------------------------------------------------------
// Las fotos NO las pide el modelo ni lleva URLs: las decide el código después de la respuesta. Sale la primera foto
// de cada producto que la respuesta nombra con su código MP-xx y que ver_catalogo devolvió en este turno o antes en la
// conversación (lo que el modelo leyó, no lo que se inventó), en el orden en que los nombra, hasta MAX_SUGERENCIAS. La
// URL sale del catálogo (ya filtrada a la lista blanca del bucket). Un producto cuya foto ya salió en la conversación no
// se repite, salvo que el cliente pida verla en este turno: «¿tienes foto?» sobre uno que ya se nombró la reenvía aunque
// el modelo no vuelva a llamar ver_catalogo (Messenger, 29-oct: el bot dijo «el sistema te envía la foto» y no salió
// nada). Pura.
// ============================================================

import type { Traza } from '../../tipos.ts';
import type { FilaPublica, TrazaPublica } from '../tipos.ts';
import { MAX_SUGERENCIAS, codigosEnTexto, numeroDeCodigo } from './catalogo-ventas.ts';
import type { ProductoVenta } from './catalogo-ventas.ts';

type HerramientaTraza = NonNullable<Traza['herramientas']>[number];

export interface FotoDelTurno {
  codigo: string;
  url: string;
  /** El pie de la foto: código y nombre del producto (sin precio: el precio va en el texto). */
  texto: string;
}

const normal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** ¿El cliente pide ver el producto en este turno? («foto», «imagen», «muéstrame», «cómo es», «quiero verlo»). Pura. */
export function pideVerFoto(texto: string): boolean {
  return /\b(foto|fotos|imagen|imagenes|muestr\w*|mostr\w*|ensen\w*|como es|como se ve|verl[oa]s?|ver el|ver la)\b/.test(normal(texto));
}

/** Los códigos que devolvió ver_catalogo en las herramientas de este turno. Pura. */
export function codigosLeidos(herramientas: HerramientaTraza[] | undefined): Set<number> {
  const out = new Set<number>();
  for (const h of herramientas ?? []) {
    if (!h.ok || h.nombre !== 'ver_catalogo') continue;
    const ps = (h.datos as { productos?: Array<{ codigo?: unknown }> } | null)?.productos ?? [];
    for (const p of ps) {
      const n = numeroDeCodigo(String(p?.codigo ?? ''));
      if (n !== null) out.add(n);
    }
  }
  return out;
}

/** Los códigos que devolvió ver_catalogo en cualquier turno anterior de la conversación. Pura. */
export function codigosLeidosEnConversacion(filas: FilaPublica[]): Set<number> {
  const out = new Set<number>();
  for (const f of filas) for (const n of codigosLeidos((f.traza as TrazaPublica | null)?.herramientas)) out.add(n);
  return out;
}

/**
 * Lo que el modelo tiene que saber de las fotos de los productos que ya se consultaron en la conversación: cuáles tienen
 * foto y cuáles ya salieron. En el orden en que se leyeron, los últimos `max`. Pura.
 */
export function fotosConsultadas(filas: FilaPublica[], max = 6): Array<{ codigo: string; tieneFoto: boolean; enviada: boolean }> {
  const vistos = new Map<number, { codigo: string; tieneFoto: boolean }>();
  for (const f of filas) {
    for (const h of (f.traza as TrazaPublica | null)?.herramientas ?? []) {
      if (!h.ok || h.nombre !== 'ver_catalogo') continue;
      for (const p of (h.datos as { productos?: Array<{ codigo?: unknown; tiene_foto?: unknown }> } | null)?.productos ?? []) {
        const n = numeroDeCodigo(String(p?.codigo ?? ''));
        if (n === null) continue;
        vistos.delete(n);
        vistos.set(n, { codigo: String(p.codigo), tieneFoto: p.tiene_foto === true });
      }
    }
  }
  const ya = fotosYaEnviadas(filas);
  return [...vistos.entries()].slice(-max).map(([n, v]) => ({ ...v, enviada: ya.has(n) }));
}

/** Los códigos cuya foto ya salió (publicada) en la conversación. Pura. */
export function fotosYaEnviadas(filas: FilaPublica[]): Set<number> {
  const out = new Set<number>();
  for (const f of filas) {
    for (const x of (f.traza as TrazaPublica | null)?.fotos ?? []) {
      const n = x.ok ? numeroDeCodigo(x.codigo) : null;
      if (n !== null) out.add(n);
    }
  }
  return out;
}

export function fotosDelTurno(p: {
  /** Lo que salió del modelo en este turno. */
  texto: string;
  herramientas: HerramientaTraza[] | undefined;
  catalogo: ProductoVenta[];
  /** Las filas de la conversación antes de este turno. */
  filas: FilaPublica[];
  /** Lo que escribió el cliente en este turno. */
  pedido: string;
}): FotoDelTurno[] {
  const leidos = codigosLeidos(p.herramientas);
  for (const n of codigosLeidosEnConversacion(p.filas)) leidos.add(n);
  if (!leidos.size) return [];
  const ya = pideVerFoto(p.pedido) ? new Set<number>() : fotosYaEnviadas(p.filas);
  const out: FotoDelTurno[] = [];
  for (const c of codigosEnTexto(p.texto)) {
    if (out.length >= MAX_SUGERENCIAS) break;
    const n = numeroDeCodigo(c);
    if (n === null || !leidos.has(n) || ya.has(n)) continue;
    const prod = p.catalogo.find((x) => numeroDeCodigo(x.codigo) === n);
    const url = prod?.fotos?.[0];
    if (!prod || !url) continue;
    out.push({ codigo: prod.codigo, url, texto: `${prod.codigo} · ${prod.titulo || prod.nombre}` });
  }
  return out;
}

/**
 * La guarda del texto de ventas: más de MAX_SUGERENCIAS productos nombrados no sale (vuelve al modelo una vez para que
 * escoja; si insiste, la respuesta no sale). Pura.
 */
export function demasiadosProductos(texto: string): string[] {
  const n = codigosEnTexto(texto).length;
  return n > MAX_SUGERENCIAS
    ? [`nombraste ${n} productos; sugiere como máximo ${MAX_SUGERENCIAS}, los que mejor le sirven para su uso (o pregúntale el uso si no lo sabes)`]
    : [];
}
