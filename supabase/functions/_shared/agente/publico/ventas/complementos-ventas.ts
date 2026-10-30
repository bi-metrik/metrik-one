// ============================================================
// Asistente de ventas — la venta cruzada: qué complemento se ofrece con un producto (Dimpro, 30-oct)
// ------------------------------------------------------------
// Mauricio (30-oct): «Necesitamos ofrecer ventas cruzadas. Si va a comprar el taladro, que lleve también otra cosa. Que
// si está interesado, antes del cierre. O preguntar que si no tiene alguna necesidad adicional.»
//
// El complemento NO lo inventa el modelo: sale de un mapa explícito por código MP-xx → lista ordenada de complementos,
// cada uno con la razón de una línea. El mapa vive en el reglamento (ficha `ventas.complementos`, `valores.mapa`), así
// que se carga por SQL de datos sin redesplegar (`semilla-sql-dimpro.ts --complementos <mapa.json>`). Solo se ofrecen los
// complementos que están publicados y activos en el catálogo de ONE en ese momento; el resto se ignora sin error.
// El mapa real lo arma otra sesión desde el catálogo del proveedor (proyectos/dimpro/piloto-marketplace/docs/trabajo/
// mapa-venta-cruzada.xlsx); aquí solo el mecanismo. Puro.
// ============================================================

import type { Ficha, Reglamento } from '../../tipos.ts';
import { numeroDeCodigo } from './catalogo-ventas.ts';
import type { ProductoVenta } from './catalogo-ventas.ts';

export const CLAVE_COMPLEMENTOS = 'ventas.complementos';
/** Cuántos complementos se ofrecen a lo sumo (el mapa puede traer más: se toman los primeros que estén publicados). */
export const MAX_COMPLEMENTOS = 2;

export interface Complemento { codigo: string; razon: string }
/** El mapa como lo guarda la ficha: { "MP-38": [{ codigo: "MP-30", razon: "…" }] }. */
export type MapaComplementos = Record<string, Complemento[]>;

/** El mapa de la ficha, leído con cuidado: lo que no tenga código y razón no entra. Sin ficha, vacío. Pura. */
export function mapaComplementos(r: Pick<Reglamento, 'fichas'>): Map<number, Complemento[]> {
  const crudo = r.fichas.find((f) => f.clave === CLAVE_COMPLEMENTOS)?.valores?.mapa;
  const out = new Map<number, Complemento[]>();
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return out;
  for (const [k, lista] of Object.entries(crudo as Record<string, unknown>)) {
    const n = numeroDeCodigo(k);
    if (n === null || !Array.isArray(lista)) continue;
    const cs = lista.map((x) => {
      const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      const c = typeof o.codigo === 'string' ? o.codigo.trim() : '';
      const razon = typeof o.razon === 'string' ? o.razon.trim() : '';
      return numeroDeCodigo(c) !== null && razon ? { codigo: c, razon } : null;
    }).filter((x): x is Complemento => !!x);
    if (cs.length) out.set(n, cs);
  }
  return out;
}

/**
 * Los complementos de un producto que se pueden ofrecer HOY: del mapa, en su orden, solo los publicados y activos del
 * catálogo, sin el producto mismo, hasta `max`. Pura.
 */
export function complementosDe(mapa: Map<number, Complemento[]>, codigo: string, catalogo: ProductoVenta[], max = MAX_COMPLEMENTOS): Array<{ producto: ProductoVenta; razon: string }> {
  const n = numeroDeCodigo(codigo);
  if (n === null) return [];
  const out: Array<{ producto: ProductoVenta; razon: string }> = [];
  for (const c of mapa.get(n) ?? []) {
    if (out.length >= max) break;
    const m = numeroDeCodigo(c.codigo);
    if (m === null || m === n || out.some((x) => numeroDeCodigo(x.producto.codigo) === m)) continue;
    const p = catalogo.find((x) => numeroDeCodigo(x.codigo) === m);
    if (p) out.push({ producto: p, razon: c.razon });
  }
  return out;
}

/** La ficha del mapa (para la semilla y para cargar uno nuevo por SQL). */
export function fichaComplementos(mapa: MapaComplementos, fuente: string): Ficha {
  return {
    clave: CLAVE_COMPLEMENTOS, tipo: 'guia', carga: 'con_herramienta', herramientas: [],
    hacer: 'Mapa de venta cruzada: por código MP-xx, los complementos en orden con la razón de una línea. Lo usa el código en ver_complementos; solo se ofrecen los que estén publicados y activos.',
    valores: { mapa }, fuente,
  };
}
