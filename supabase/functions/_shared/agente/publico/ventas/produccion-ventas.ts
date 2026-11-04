// ============================================================
// Asistente de ventas — los puertos de producción: el catálogo de Ferretería (Supabase), la pasarela de Bold con las
// llaves DE LA BÓVEDA del workspace (`bold-workspace.ts`, #1294) y el carrito guardado (`carritos`, `carrito_lineas`,
// `carrito_pagos`, migración 20261104210000). Todo con service_role y acotado al workspace. No lee el entorno.
// ============================================================

import type { SupabaseClient } from '../../../types.ts';
import { consultarLinkBold, llavesBoldDelWorkspace, pasarelaConLlaves } from '../../../funciones/bold-workspace.ts';
import { fichaDe, fotosDe } from './catalogo-ventas.ts';
import type { ProductoNoDisponible, ProductoVenta } from './catalogo-ventas.ts';
import type { PuertosVentas } from './puertos-ventas.ts';
import { linksDeCarritos } from './puertos-ventas.ts';
import { carritosSupabase } from '../carrito/repo.ts';

type Fila = Record<string, unknown>;
/**
 * Las publicaciones activas con precio, con su producto. Las fotos, solo las del bucket propio en `hostFotos` (el host
 * del proyecto de Supabase); sin host, ninguna. Pura (sobre las filas del select).
 */
export function productosDeFilas(filas: Fila[], hostFotos: string | null = null): ProductoVenta[] {
  return filas.map((x): ProductoVenta | null => {
    const p = (Array.isArray(x.producto) ? x.producto[0] : x.producto) as Fila | null;
    const precio = Number(x.precio);
    if (!p || !(precio > 0)) return null;
    return {
      publicacionId: String(x.id), codigo: String(x.codigo), sku: String(p.sku ?? ''), titulo: String(x.titulo ?? ''), nombre: String(p.nombre ?? ''),
      marca: (p.marca as string | null) ?? null, categoria: (p.categoria as string | null) ?? null, etiquetas: Array.isArray(x.etiquetas) ? x.etiquetas.map(String) : [],
      precio, ficha: fichaDe(p.ficha), fotos: fotosDe(p.fotos, hostFotos),
    };
  }).filter((x): x is ProductoVenta => !!x).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}

/** Las publicaciones no activas, con su producto, sin precio ni ficha. Pura (sobre las filas del select). */
export function noDisponiblesDeFilas(filas: Fila[]): ProductoNoDisponible[] {
  return filas.map((x): ProductoNoDisponible | null => {
    const p = (Array.isArray(x.producto) ? x.producto[0] : x.producto) as Fila | null;
    if (!p) return null;
    return {
      publicacionId: String(x.id), codigo: String(x.codigo), estado: String(x.estado), sku: String(p.sku ?? ''), titulo: String(x.titulo ?? ''),
      nombre: String(p.nombre ?? ''), marca: (p.marca as string | null) ?? null, categoria: (p.categoria as string | null) ?? null,
      etiquetas: Array.isArray(x.etiquetas) ? x.etiquetas.map(String) : [],
    };
  }).filter((x): x is ProductoNoDisponible => !!x).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}

/** El host de la URL del proyecto (`SUPABASE_URL`), o null. Pura. */
export function hostDe(url: string | null | undefined): string | null {
  try { return url ? new URL(url).host : null; } catch { return null; }
}

export function ventasSupabase(
  supabase: SupabaseClient, workspaceId: string, f: typeof fetch = (u, i) => globalThis.fetch(u, i), o: { hostFotos?: string | null } = {},
): PuertosVentas {
  let cache: { ps: ProductoVenta[]; vence: number } | null = null;
  let cacheNd: { ps: ProductoNoDisponible[]; vence: number } | null = null;
  const carritos = carritosSupabase(supabase, workspaceId, 'ferreteria');
  return {
    async catalogo() {
      if (cache && cache.vence > Date.now()) return cache.ps;
      const { data, error } = await supabase.from('ferreteria_publicaciones')
        .select('id, codigo, titulo, precio, etiquetas, producto:ferreteria_productos!inner(sku, nombre, marca, categoria, ficha, fotos)')
        .eq('workspace_id', workspaceId).eq('estado', 'activa').not('precio', 'is', null).limit(500);
      if (error) throw new Error(`no se pudo leer el catálogo: ${error.message}`);
      const ps = productosDeFilas((data ?? []) as Fila[], o.hostFotos ?? null);
      cache = { ps, vence: Date.now() + 60_000 };
      return ps;
    },
    // Solo cuando lo pedido no está activo (3-nov): un código agotado no es lo mismo que uno que no existe.
    async noDisponibles() {
      if (cacheNd && cacheNd.vence > Date.now()) return cacheNd.ps;
      const { data, error } = await supabase.from('ferreteria_publicaciones')
        .select('id, codigo, titulo, estado, etiquetas, producto:ferreteria_productos!inner(sku, nombre, marca, categoria)')
        .eq('workspace_id', workspaceId).neq('estado', 'activa').limit(500);
      if (error) throw new Error(`no se pudo leer el catálogo no disponible: ${error.message}`);
      const ps = noDisponiblesDeFilas((data ?? []) as Fila[]);
      cacheNd = { ps, vence: Date.now() + 60_000 };
      return ps;
    },
    // Se leen en cada llamada (sin caché): borrar la llave en la bóveda desconecta de inmediato.
    pasarela: async () => pasarelaConLlaves(await llavesBoldDelWorkspace(supabase, workspaceId), f),
    async consultarLink(referencia) {
      const llaves = await llavesBoldDelWorkspace(supabase, workspaceId);
      if (!llaves.identidad) return 'sin_llaves';
      const r = await consultarLinkBold(llaves.identidad, referencia, f);
      return r ? { estado: r.estado, total: r.total, sandbox: r.sandbox, espacioDePruebas: llaves.espacioDePruebas === true } : null;
    },
    carritos,
    ...linksDeCarritos(carritos),
  };
}
