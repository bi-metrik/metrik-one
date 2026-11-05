// ============================================================
// Carrito de los asistentes de venta — el modelo (puro)
// ------------------------------------------------------------
// Spec: docs/specs/2026-11-04_carrito-asistentes-venta.md. El carrito vive en la base (`carritos`, `carrito_lineas`,
// `carrito_pagos`, migración 20261104210000), no en la conversación: la conversación que ve el asistente es la de las
// últimas 24 h y se recorta por tramos; el carrito no se puede perder con ella.
//
//   abierto ──(«sí» a la propuesta: congela y emite el link)──▶ en_pago ──(Bold APROBADO)──▶ pagado ──▶ registrado
//      ▲                                                          │
//      └───────────(el cliente cambia algo: el link se anula)─────┘
//   abierto ──(7 días sin cambios)──▶ abandonado     sin líneas ──▶ cancelado
//
// Este archivo no toca la red ni la base: tipos, totales y reglas de lectura. El repositorio (`repo.ts`) escribe.
// ============================================================

export type EstadoCarrito = 'abierto' | 'en_pago' | 'pagado' | 'registrado' | 'vencido' | 'abandonado' | 'cancelado';
export type EstadoPago = 'creado' | 'procesando' | 'aprobado' | 'rechazado' | 'vencido' | 'error';

/** Los dominios que saben volver un carrito venta en ONE (CHECK de `carritos.dominio`). */
export type DominioCarrito = 'ferreteria';

/** Cuántos días sin cambios deja un carrito abierto antes de leerse como abandonado. */
export const ABANDONO_DIAS = 7;

/** La conversación dueña del carrito (la llave de Chatwoot es cuenta + conversación). */
export interface ConvCarrito {
  cuentaId: number;
  conversacionId: number;
  canal: string;
  contactoId?: number | null;
}

/** Una línea como la arma el dominio desde su catálogo (foto del precio). */
export interface LineaNueva {
  itemTipo: string;
  itemId: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
}

export interface LineaCarrito extends LineaNueva {
  id: string;
  orden: number;
  ventaId: string | null;
}

export interface Carrito {
  id: string;
  dominio: DominioCarrito;
  /** La conversación dueña. */
  conv: ConvCarrito;
  estado: EstadoCarrito;
  version: number;
  lineas: LineaCarrito[];
  subtotal: number;
  flete: number | null;
  total: number | null;
  zona: string | null;
  ruta: 'despacho' | 'recoge' | null;
  actividadAt: string;
}

export interface PagoCarrito {
  id: string;
  carritoId: string;
  referencia: string;
  url: string;
  huella: string;
  version: number;
  monto: number;
  venceAt: string;
  estado: EstadoPago;
}

/** Lo que se congela con el link. */
export interface Entrega {
  zona: string;
  ruta: 'despacho' | 'recoge';
  flete: number;
  nombre: string;
  telefono: string;
  direccion: string | null;
}

/** El link que emitió la pasarela, para registrarlo. */
export interface LinkEmitido {
  referencia: string;
  url: string;
  huella: string;
  monto: number;
  venceAt: string;
}

export type ErrorEmitir = 'carrito_no_vivo' | 'carrito_cambio' | 'carrito_pagado' | 'monto_no_cuadra';

/** Suma de precio × cantidad, en pesos enteros. Pura. */
export function subtotalLineas(lineas: ReadonlyArray<{ precioUnitario: number; cantidad: number }>): number {
  return lineas.reduce((s, l) => s + Math.round(l.precioUnitario) * l.cantidad, 0);
}

/** Subtotal + UN solo flete. Pura. */
export function totalConFlete(lineas: ReadonlyArray<{ precioUnitario: number; cantidad: number }>, flete: number): number {
  return subtotalLineas(lineas) + Math.round(flete);
}

/** ¿Las dos listas son el mismo carrito (mismo producto, unidades y precio, en el mismo orden)? Pura. */
export function mismasLineas(a: ReadonlyArray<LineaNueva>, b: ReadonlyArray<LineaNueva>): boolean {
  return a.length === b.length && a.every((x, i) =>
    x.itemTipo === b[i].itemTipo && x.itemId === b[i].itemId && x.cantidad === b[i].cantidad && Math.round(x.precioUnitario * 100) === Math.round(b[i].precioUnitario * 100));
}

/** ¿Un carrito abierto lleva más de `dias` sin cambios? Pura. */
export function abandonado(c: Pick<Carrito, 'estado' | 'actividadAt'>, ahoraMs: number, dias = ABANDONO_DIAS): boolean {
  return c.estado === 'abierto' && Date.parse(c.actividadAt) < ahoraMs - dias * 86_400_000;
}

/**
 * El carrito como lo ve el asistente al leerlo: un abierto viejo no está (se lee como abandonado y la próxima escritura
 * empieza otro). Un `en_pago` sigue siendo el vivo aunque su link haya vencido: si el cliente cambia algo, se reabre.
 * Pura.
 */
export function vivoAlLeer(c: Carrito | null, ahoraMs: number): Carrito | null {
  if (!c || (c.estado !== 'abierto' && c.estado !== 'en_pago')) return null;
  return abandonado(c, ahoraMs) ? null : c;
}

/** El último link del carrito que todavía cobra (creado y sin vencer), o null. Pura. */
export function pagoVigente(pagos: PagoCarrito[], ahoraMs: number): PagoCarrito | null {
  const vivos = pagos.filter((p) => p.estado === 'creado' && Date.parse(p.venceAt) > ahoraMs);
  return vivos.at(-1) ?? null;
}

/** «MP-62 × 1, MP-64 × 2». Pura. */
export function resumenLineas(lineas: ReadonlyArray<Pick<LineaNueva, 'codigo' | 'cantidad'>>): string {
  return lineas.map((l) => `${l.codigo} × ${l.cantidad}`).join(', ');
}

/** Las líneas cuyo precio cambió entre la foto guardada y el catálogo de hoy (por producto). Pura. */
export function preciosCambiados(antes: ReadonlyArray<LineaNueva>, ahora: ReadonlyArray<LineaNueva>): Array<{ codigo: string; antes: number; ahora: number }> {
  const out: Array<{ codigo: string; antes: number; ahora: number }> = [];
  for (const n of ahora) {
    const v = antes.find((x) => x.itemTipo === n.itemTipo && x.itemId === n.itemId);
    if (v && Math.round(v.precioUnitario) !== Math.round(n.precioUnitario)) out.push({ codigo: n.codigo, antes: Math.round(v.precioUnitario), ahora: Math.round(n.precioUnitario) });
  }
  return out;
}
