// ============================================================
// Asistente de ventas — el catálogo de Ferretería, la búsqueda y la tabla de flete (Dimpro, ensayo del 29-oct)
// ------------------------------------------------------------
// La fuente de verdad es ONE: `ferreteria_productos` (nombre, marca, ficha) y `ferreteria_publicaciones` (código MP-xx,
// título, precio). El catálogo NO se copia al reglamento: se lee de la base en cada turno (`produccion-ventas.ts`), así
// un cambio de precio en Ferretería vale en la conversación siguiente sin publicar nada.
// Solo se venden publicaciones `activa` con precio. El precio es el de la publicación, nunca uno calculado.
// La ficha del producto es un arreglo de {etiqueta, valor, fuente, verificado}: lo verificado se afirma; lo demás va
// aparte, para que el modelo lo diga «según el catálogo del fabricante» (o pase a persona si el cliente insiste).
// La tabla de flete vive en el reglamento (ficha `flete.tabla`): Mauricio la cambia sin desplegar. Puro.
// ============================================================

import type { Reglamento } from '../../tipos.ts';
import { pesos } from '../catalogo.ts';

export interface DatoFicha {
  etiqueta: string;
  valor: string;
  verificado: boolean;
}

export interface ProductoVenta {
  publicacionId: string;
  /** El código de la publicación (MP-12). */
  codigo: string;
  sku: string;
  titulo: string;
  nombre: string;
  marca: string | null;
  categoria: string | null;
  etiquetas: string[];
  /** Pesos, el de la publicación activa. */
  precio: number;
  ficha: DatoFicha[];
}

const s = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);

/** La ficha jsonb de `ferreteria_productos` como la ve el asistente. Lo que no tenga etiqueta y valor no entra. Pura. */
export function fichaDe(crudo: unknown): DatoFicha[] {
  if (!Array.isArray(crudo)) return [];
  return crudo.map((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const etiqueta = s(o.etiqueta);
    const valor = o.valor === null || o.valor === undefined ? null : s(String(o.valor));
    if (!etiqueta || !valor) return null;
    return { etiqueta, valor, verificado: o.verificado === true };
  }).filter((x): x is DatoFicha => !!x);
}

const normal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();
const raiz = (w: string) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'para', 'con', 'por', 'que', 'y', 'o', 'en', 'me', 'mi', 'tu',
  'tienen', 'tiene', 'tienes', 'hay', 'venden', 'vende', 'busco', 'buscando', 'quiero', 'necesito', 'precio', 'cuanto', 'cuesta', 'vale',
  'valor', 'sobre', 'info', 'informacion', 'algo', 'alguno', 'alguna', 'como', 'cual', 'este', 'esta', 'ese', 'esa', 'favor', 'hola',
]);

/** Las palabras que cuentan para buscar («bomba 1 HP» → bomba, 1, hp). Pura. */
export function palabrasDeBusqueda(texto: string): string[] {
  return [...new Set(normal(texto).split(' ').filter((w) => w && !VACIAS.has(w) && (w.length >= 2 || /\d/.test(w))).map(raiz))];
}

/** «MP-12», «mp 12», «MP12» → 12. Pura. */
export function numeroDeCodigo(texto: string): number | null {
  const m = /\bmp\s*-?\s*0*(\d{1,4})\b/i.exec(texto);
  return m ? Number(m[1]) : null;
}

/**
 * Busca en el catálogo. Con código (MP-xx) o SKU exacto, ese producto. Con texto, los que más palabras comparten con
 * el nombre, título, marca, categoría y etiquetas (hasta `max`). Sin nada, los primeros `max`. Pura.
 */
export function buscarProductos(ps: ProductoVenta[], q: { buscar?: string | null; codigo?: string | null }, max = 5): ProductoVenta[] {
  const cod = numeroDeCodigo(`${q.codigo ?? ''} ${q.buscar ?? ''}`);
  if (cod !== null) {
    const p = ps.find((x) => numeroDeCodigo(x.codigo) === cod);
    if (p) return [p];
  }
  const sku = normal(q.codigo ?? q.buscar ?? '').replace(/ /g, '');
  if (sku) {
    const p = ps.find((x) => normal(x.sku).replace(/ /g, '') === sku);
    if (p) return [p];
  }
  const palabras = palabrasDeBusqueda(q.buscar ?? '');
  if (!palabras.length) return cod !== null || q.codigo ? [] : ps.slice(0, max);
  const puntaje = ps.map((p) => {
    const hay = new Set(normal([p.titulo, p.nombre, p.marca ?? '', p.categoria ?? '', ...p.etiquetas].join(' ')).split(' ').map(raiz));
    return { p, n: palabras.filter((w) => hay.has(w)).length };
  }).filter((x) => x.n > 0);
  if (!puntaje.length) return [];
  const mejor = Math.max(...puntaje.map((x) => x.n));
  // Con varias palabras, solo los que traen al menos la mitad (redondeada hacia arriba) y los de mejor puntaje primero.
  const piso = Math.max(1, Math.ceil(palabras.length / 2));
  return puntaje.filter((x) => x.n >= Math.min(piso, mejor)).sort((a, b) => b.n - a.n || a.p.codigo.localeCompare(b.p.codigo)).slice(0, max).map((x) => x.p);
}

/** El producto con ese código MP-xx o ese SKU exacto, o nada (nunca una búsqueda aproximada). Pura. */
export function productoPorCodigo(ps: ProductoVenta[], codigo: string): ProductoVenta | null {
  const n = numeroDeCodigo(codigo);
  if (n !== null) return ps.find((x) => numeroDeCodigo(x.codigo) === n) ?? null;
  const sku = normal(codigo).replace(/ /g, '');
  return sku ? ps.find((x) => normal(x.sku).replace(/ /g, '') === sku) ?? null : null;
}

/** Lo que ve el modelo de un producto: precio en pesos y la ficha partida en verificado y del fabricante. Pura. */
export function productoParaModelo(p: ProductoVenta): Record<string, unknown> {
  const ver = p.ficha.filter((d) => d.verificado).map((d) => `${d.etiqueta}: ${d.valor}`);
  const fab = p.ficha.filter((d) => !d.verificado).map((d) => `${d.etiqueta}: ${d.valor}`);
  return {
    codigo: p.codigo,
    producto: p.titulo || p.nombre,
    ...(p.marca ? { marca: p.marca } : {}),
    precio: pesos(p.precio),
    especificaciones_verificadas: ver,
    ...(fab.length ? { segun_catalogo_del_fabricante: fab } : {}),
  };
}

// ── Tabla de flete (ficha `flete.tabla` del reglamento) ──────────────────────

export interface ZonaFlete {
  id: string;
  nombre: string;
  /** Pesos. 0 = sin flete (recoger). */
  flete: number;
  ruta: 'despacho' | 'recoge';
  /** Cómo la puede nombrar el cliente («bogota», «bta», «recoger»…). */
  alias: string[];
}

export interface TablaFlete {
  zonas: ZonaFlete[];
  /** Cuántas horas vive un link de pago. */
  venceHoras: number;
}

export const CLAVE_FLETE = 'flete.tabla';

/** La tabla de flete del reglamento. Sin la ficha, vacía: toda entrega pasa a persona (`fuera_de_zona`). Pura. */
export function tablaFlete(r: Reglamento): TablaFlete {
  const v = (r.fichas.find((f) => f.clave === CLAVE_FLETE)?.valores ?? {}) as Record<string, unknown>;
  const zonas = (Array.isArray(v.zonas) ? v.zonas : []).map((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = s(o.id);
    const nombre = s(o.nombre);
    const flete = typeof o.flete === 'number' && Number.isFinite(o.flete) && o.flete >= 0 ? Math.round(o.flete) : null;
    if (!id || !nombre || flete === null) return null;
    return { id, nombre, flete, ruta: o.ruta === 'recoge' ? 'recoge' as const : 'despacho' as const, alias: (Array.isArray(o.alias) ? o.alias : []).map(String) };
  }).filter((x): x is ZonaFlete => !!x);
  const vh = typeof v.vence_horas === 'number' && v.vence_horas >= 1 && v.vence_horas <= 24 * 7 ? v.vence_horas : 24;
  return { zonas, venceHoras: vh };
}

/** La zona de la tabla que nombra el texto (por id o alias). Pura. */
export function zonaFlete(t: TablaFlete, texto: string | null | undefined): ZonaFlete | null {
  const n = normal(String(texto ?? ''));
  if (!n) return null;
  return t.zonas.find((z) => normal(z.id) === n || [z.nombre, ...z.alias].some((a) => normal(a) === n)) ?? null;
}

/** El total del pedido: precio × cantidad + flete. Lo arma el código, nunca el modelo. Pura. */
export function totalPedido(precio: number, cantidad: number, flete: number): number {
  return Math.round(precio) * cantidad + Math.round(flete);
}
