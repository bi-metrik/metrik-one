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
  /**
   * Las fotos del producto (`ferreteria_productos.fotos`), SOLO las del bucket propio (`urlFotoPermitida`). El modelo
   * no las ve: las manda el código con los productos que nombró (`fotosDelTurno`).
   */
  fotos?: string[];
}

/** El bucket de las fotos del catálogo de Ferretería: solo de ahí sale una foto al cliente. */
export const BUCKET_FOTOS = 'ferreteria-fotos';

/**
 * ¿La foto es del bucket propio? https, el host del proyecto de Supabase (`hostPermitido`) y la ruta pública de
 * `ferreteria-fotos`. Sin host permitido, ninguna. Pura.
 */
export function urlFotoPermitida(url: unknown, hostPermitido: string | null | undefined): url is string {
  if (typeof url !== 'string' || !hostPermitido) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === hostPermitido && !u.username && !u.password
      && u.pathname.startsWith(`/storage/v1/object/public/${BUCKET_FOTOS}/`) && !u.pathname.includes('..');
  } catch {
    return false;
  }
}

/** Las fotos jsonb de `ferreteria_productos` que pasan la lista blanca, en orden. Pura. */
export function fotosDe(crudo: unknown, hostPermitido: string | null | undefined): string[] {
  return (Array.isArray(crudo) ? crudo : []).filter((u): u is string => urlFotoPermitida(u, hostPermitido));
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

/**
 * Lo que ve el modelo de un producto: precio en pesos, la ficha partida en verificado y del fabricante y si tiene foto
 * (la URL nunca: la foto la manda el código). Pura.
 */
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
    tiene_foto: (p.fotos?.length ?? 0) > 0,
  };
}

// ── Venta consultiva: pocas sugerencias, las que mejor encajan con el uso ────

/** Cuántos productos sugiere el asistente a la vez (y cuántas fotos manda). Ni el catálogo ni la respuesta pasan de aquí. */
export const MAX_SUGERENCIAS = 3;

/**
 * El tipo de un producto, para la pregunta de uso: el título hasta la marca («Taladro magnético Ferton de 40 mm» →
 * «Taladro magnético»); sin marca en el título, sus tres primeras palabras. Pura.
 */
export function tipoDe(p: ProductoVenta): string {
  const t = (p.titulo || p.nombre).trim();
  const marca = p.marca?.trim();
  const i = marca ? t.toLowerCase().indexOf(marca.toLowerCase()) : -1;
  const corte = i > 0 ? t.slice(0, i) : t.split(/\s+/).slice(0, 3).join(' ');
  return corte.replace(/[\s,(]+(de|del|con|para)?\s*$/i, '').trim() || t;
}

/**
 * Las palabras de uso que el cliente dice y cómo aparecen en el catálogo. La búsqueda las cruza con el título, las
 * etiquetas y la ficha. «cable» no está aquí: es lo contrario de inalámbrico (`DE_CABLE`).
 */
const SINONIMOS_USO: Record<string, string[]> = {
  metal: ['metal', 'acero', 'hierro', 'metalmecanica', 'metalica', 'metalico', 'lamina'],
  acero: ['metal', 'acero', 'hierro', 'metalmecanica', 'metalica', 'metalico'],
  estructura: ['estructura', 'magnetico', 'metalmecanica'],
  magnetico: ['magnetico'],
  concreto: ['concreto', 'ladrillo', 'muro', 'sds', 'rotomartillo', 'demolicion', 'cincelar'],
  ladrillo: ['ladrillo', 'concreto', 'muro'],
  muro: ['muro', 'concreto', 'ladrillo'],
  pared: ['muro', 'concreto', 'ladrillo'],
  madera: ['madera', 'carpinteria', 'ebanisteria'],
  carpinteria: ['madera', 'carpinteria', 'ebanisteria'],
  inalambrico: ['inalambrico', 'inalambrica', 'bateria'],
  bateria: ['inalambrico', 'inalambrica', 'bateria'],
  hogar: ['hogar', 'casa', 'mueble'],
  casa: ['hogar', 'casa', 'mueble'],
  obra: ['obra', 'construccion', 'concreto', 'demolicion'],
  construccion: ['obra', 'construccion', 'concreto'],
  taller: ['taller', 'mecanica', 'industrial'],
  industrial: ['industrial', 'taller'],
  carro: ['carro', 'automotriz', 'llanta', 'mecanica'],
  moto: ['moto', 'automotriz', 'mecanica'],
};
const DE_CABLE = new Set(['cable', 'cord', 'corriente', 'enchufe', 'toma', 'electrico', 'alambrico']);
const INALAMBRICO = new Set(['inalambrico', 'inalambrica', 'bateria']);

const palabrasDe = (p: ProductoVenta, conFicha: boolean) => new Set(normal([
  p.titulo, p.nombre, p.marca ?? '', p.categoria ?? '', ...p.etiquetas, ...(conFicha ? p.ficha.map((d) => `${d.etiqueta} ${d.valor}`) : []),
].join(' ')).split(' ').map(raiz));

export type Sugerencia =
  | { tipo: 'codigo'; productos: ProductoVenta[] }
  /** Más de `MAX_SUGERENCIAS` y sin uso: el asistente pregunta el uso. `tipos` le da con qué preguntar. */
  | { tipo: 'preguntar'; coincidencias: number; tipos: string[] }
  | { tipo: 'sugerir'; productos: ProductoVenta[]; coincidencias: number };

/**
 * La búsqueda de la venta consultiva. Con código (MP-xx) o SKU: ese producto. Con texto: los que traen las palabras de
 * `buscar` (como `buscarProductos`, sin tope). Si son más de `MAX_SUGERENCIAS` y el cliente no dijo para qué lo quiere
 * (`uso` vacío), no devuelve productos: pide preguntar el uso. Con uso (o con pocos), los `MAX_SUGERENCIAS` que mejor
 * encajan: más palabras de uso en el título, las etiquetas o la ficha; «de cable» deja fuera lo inalámbrico (y al
 * revés); el título que empieza por lo que busca gana al accesorio («Soporte para taladro»); y a lo sumo dos del mismo
 * tipo (salvo el tipo que pidió con todas sus palabras), para que haya de dónde escoger. Pura.
 */
export function sugerirProductos(ps: ProductoVenta[], q: { buscar?: string | null; codigo?: string | null; uso?: string | null }): Sugerencia {
  const cod = numeroDeCodigo(`${q.codigo ?? ''} ${q.buscar ?? ''}`);
  const sku = normal(q.codigo ?? '').replace(/ /g, '');
  if (cod !== null || sku) {
    const p = productoPorCodigo(ps, q.codigo || q.buscar || '');
    if (p) return { tipo: 'codigo', productos: [p] };
    // Un código que no está, sin otras palabras: nada (nunca una búsqueda aproximada en su lugar).
    if (!palabrasDeBusqueda((q.buscar ?? '').replace(/\bmp\s*-?\s*\d+\b/gi, '')).length) return { tipo: 'codigo', productos: [] };
  }
  const todos = buscarProductos(ps, { buscar: q.buscar ?? null, codigo: null }, Number.MAX_SAFE_INTEGER);
  const uso = palabrasDeBusqueda(q.uso ?? '');
  if (!uso.length && todos.length > MAX_SUGERENCIAS) {
    return { tipo: 'preguntar', coincidencias: todos.length, tipos: [...new Set(todos.map(tipoDe))].slice(0, 8) };
  }
  const buscar = palabrasDeBusqueda(q.buscar ?? '');
  const cable = uso.some((w) => DE_CABLE.has(w));
  const quiereInal = uso.some((w) => INALAMBRICO.has(w));
  const objetivo = uso.filter((w) => !DE_CABLE.has(w)).map((w) => SINONIMOS_USO[w] ?? [w]);
  const puntuados = todos.map((p, orden) => {
    const hay = palabrasDe(p, true);
    const inal = [...INALAMBRICO].some((w) => hay.has(w));
    const titulo = normal(p.titulo || p.nombre).split(' ').map(raiz);
    return {
      p, orden, inal,
      uso: objetivo.filter((grupo) => grupo.some((w) => hay.has(raiz(w)))).length,
      // Desempate: cuántas palabras de uso trae (el rotomartillo «concreto, SDS, demolición» gana al que solo dice «ladrillo»).
      aciertos: objetivo.flat().filter((w) => hay.has(raiz(w))).length,
      principal: buscar.length > 0 && buscar.includes(titulo[0]) ? 1 : 0,
      // «Soporte para taladro» cuando busca un taladro: accesorio, va al final.
      accesorio: !buscar.includes(titulo[0]) && buscar.some((w) => titulo.some((x, i) => x === w && titulo[i - 1] === 'para')) ? 1 : 0,
    };
  });
  // «De cable» saca lo inalámbrico, e «inalámbrico» lo de cable, salvo que no quede nada.
  const filtrados = cable || quiereInal ? puntuados.filter((x) => (cable ? !x.inal : x.inal)) : puntuados;
  const base = filtrados.length ? filtrados : puntuados;
  const orden = [...base].sort((a, b) => a.accesorio - b.accesorio || b.uso - a.uso || b.aciertos - a.aciertos || b.principal - a.principal || a.orden - b.orden);
  const elegidos: typeof orden = [];
  const porTipo = new Map<string, number>();
  for (const x of orden) {
    const t = normal(tipoDe(x.p));
    // El tope de dos por tipo no vale para el tipo que el cliente nombró entero («taladro magnético»).
    const pidioEseTipo = t.split(' ').filter((w) => w && !VACIAS.has(w)).map(raiz).every((w) => buscar.includes(w));
    if (!pidioEseTipo && (porTipo.get(t) ?? 0) >= 2) continue;
    porTipo.set(t, (porTipo.get(t) ?? 0) + 1);
    elegidos.push(x);
    if (elegidos.length === MAX_SUGERENCIAS) break;
  }
  // Si la regla de dos por tipo dejó cupo libre, se llena con los siguientes.
  for (const x of orden) {
    if (elegidos.length >= MAX_SUGERENCIAS) break;
    if (!elegidos.includes(x)) elegidos.push(x);
  }
  return { tipo: 'sugerir', productos: elegidos.map((x) => x.p), coincidencias: base.length };
}

/** Los códigos MP-xx que nombra un texto, sin repetir y en orden (como «MP-17», normalizados). Pura. */
export function codigosEnTexto(texto: string): string[] {
  const out: string[] = [];
  for (const m of String(texto ?? '').matchAll(/\bmp\s*-?\s*0*(\d{1,4})\b/gi)) {
    const c = `MP-${String(Number(m[1])).padStart(2, '0')}`;
    if (!out.includes(c)) out.push(c);
  }
  return out;
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
