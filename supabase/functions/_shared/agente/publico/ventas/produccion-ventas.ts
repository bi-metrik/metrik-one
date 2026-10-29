// ============================================================
// Asistente de ventas — los puertos de producción: el catálogo de Ferretería (Supabase), la pasarela de Bold con las
// llaves DE LA BÓVEDA del workspace (`bold-workspace.ts`, #1294) y la tabla `ferreteria_links_bold` (migración
// 20261029150000). Todo con service_role y acotado al workspace. Este archivo no lee el entorno.
// ============================================================

import type { SupabaseClient } from '../../../types.ts';
import { consultarLinkBold, llavesBoldDelWorkspace, pasarelaConLlaves } from '../../../funciones/bold-workspace.ts';
import { fichaDe } from './catalogo-ventas.ts';
import type { ProductoVenta } from './catalogo-ventas.ts';
import type { LinkGuardado, NuevoLink, PuertosVentas } from './puertos-ventas.ts';

type Fila = Record<string, unknown>;
const COLUMNAS_LINK = 'referencia, url, huella, publicacion_id, cantidad, precio_unitario, flete, monto, zona, ruta, comprador_nombre, comprador_telefono, direccion, chatwoot_cuenta_id, chatwoot_conversacion_id, canal, vence_at, registro';

/** Una fila de `ferreteria_links_bold` como la ve el asistente. Pura. */
export function linkDeFila(x: Fila): LinkGuardado {
  return {
    referencia: String(x.referencia), url: String(x.url), huella: String(x.huella), publicacionId: String(x.publicacion_id), cantidad: Number(x.cantidad),
    precioUnitario: Number(x.precio_unitario), flete: Number(x.flete), monto: Number(x.monto), zona: String(x.zona), ruta: x.ruta === 'recoge' ? 'recoge' : 'despacho',
    compradorNombre: String(x.comprador_nombre), compradorTelefono: String(x.comprador_telefono), direccion: (x.direccion as string | null) ?? null,
    cuentaId: Number(x.chatwoot_cuenta_id), conversacionId: Number(x.chatwoot_conversacion_id), canal: String(x.canal), venceAt: String(x.vence_at ?? ''), registro: String(x.registro),
  };
}

/** Las publicaciones activas con precio, con su producto. Pura (sobre las filas del select). */
export function productosDeFilas(filas: Fila[]): ProductoVenta[] {
  return filas.map((x) => {
    const p = (Array.isArray(x.producto) ? x.producto[0] : x.producto) as Fila | null;
    const precio = Number(x.precio);
    if (!p || !(precio > 0)) return null;
    return {
      publicacionId: String(x.id), codigo: String(x.codigo), sku: String(p.sku ?? ''), titulo: String(x.titulo ?? ''), nombre: String(p.nombre ?? ''),
      marca: (p.marca as string | null) ?? null, categoria: (p.categoria as string | null) ?? null, etiquetas: Array.isArray(x.etiquetas) ? x.etiquetas.map(String) : [],
      precio, ficha: fichaDe(p.ficha),
    };
  }).filter((x): x is ProductoVenta => !!x).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}

export function ventasSupabase(supabase: SupabaseClient, workspaceId: string, f: typeof fetch = (u, i) => globalThis.fetch(u, i)): PuertosVentas {
  let cache: { ps: ProductoVenta[]; vence: number } | null = null;
  return {
    async catalogo() {
      if (cache && cache.vence > Date.now()) return cache.ps;
      const { data, error } = await supabase.from('ferreteria_publicaciones')
        .select('id, codigo, titulo, precio, etiquetas, producto:ferreteria_productos!inner(sku, nombre, marca, categoria, ficha)')
        .eq('workspace_id', workspaceId).eq('estado', 'activa').not('precio', 'is', null).limit(500);
      if (error) throw new Error(`no se pudo leer el catálogo: ${error.message}`);
      const ps = productosDeFilas((data ?? []) as Fila[]);
      cache = { ps, vence: Date.now() + 60_000 };
      return ps;
    },
    // Se leen en cada llamada (sin caché): borrar la llave en la bóveda desconecta de inmediato.
    pasarela: async () => pasarelaConLlaves(await llavesBoldDelWorkspace(supabase, workspaceId), f),
    async consultarLink(referencia) {
      const llaves = await llavesBoldDelWorkspace(supabase, workspaceId);
      if (!llaves.identidad) return 'sin_llaves';
      const r = await consultarLinkBold(llaves.identidad, referencia, f);
      return r ? { estado: r.estado, total: r.total } : null;
    },
    async linkPorHuella(huella) {
      const { data, error } = await supabase.from('ferreteria_links_bold').select(COLUMNAS_LINK).eq('workspace_id', workspaceId).eq('huella', huella).maybeSingle();
      if (error) throw new Error(`no se pudo leer el link: ${error.message}`);
      return data ? linkDeFila(data as Fila) : null;
    },
    async linkPorReferencia(referencia) {
      const { data, error } = await supabase.from('ferreteria_links_bold').select(COLUMNAS_LINK).eq('workspace_id', workspaceId).eq('referencia', referencia).maybeSingle();
      if (error) throw new Error(`no se pudo leer el link: ${error.message}`);
      return data ? linkDeFila(data as Fila) : null;
    },
    async guardarLink(l: NuevoLink) {
      const { data, error } = await supabase.from('ferreteria_links_bold').insert({
        workspace_id: workspaceId, referencia: l.referencia, url: l.url, huella: l.huella, publicacion_id: l.publicacionId, cantidad: l.cantidad,
        precio_unitario: l.precioUnitario, flete: l.flete, monto: l.monto, zona: l.zona, ruta: l.ruta, comprador_nombre: l.compradorNombre,
        comprador_telefono: l.compradorTelefono, direccion: l.direccion, chatwoot_cuenta_id: l.cuentaId, chatwoot_conversacion_id: l.conversacionId,
        canal: l.canal, vence_at: l.venceAt,
      }).select(COLUMNAS_LINK).single();
      if (error || !data) throw new Error(`no se pudo guardar el link: ${error?.message ?? 'sin fila'}`);
      return linkDeFila(data as Fila);
    },
  };
}
