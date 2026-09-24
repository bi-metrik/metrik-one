import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginar'
import type {
  CostoFila,
  EventoFila,
  ProductoFila,
  PublicacionCatalogo,
  PublicacionFila,
  RepoFerreteria,
  TokenFila,
} from './tipos'

/**
 * Repositorio del módulo Ferretería contra Supabase con service_role. Las tablas `ferreteria_*`
 * no conceden escritura a `authenticated`: TODA escritura pasa por aquí, y cada consulta se
 * acota por `workspace_id` a mano porque el cliente de servicio no pasa por RLS.
 *
 * Las tablas aún no están en `src/types/database.ts` (se regeneran después de aplicar la
 * migración), por eso el cliente va sin tipar.
 */

function lanzar(contexto: string, e: { message: string } | null): void {
  if (e) throw new Error(`[ferreteria] ${contexto}: ${e.message}`)
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

function aPublicacion(f: Record<string, unknown>): PublicacionFila {
  return { ...(f as unknown as PublicacionFila), precio: num(f.precio), etiquetas: (f.etiquetas as string[] | null) ?? [] }
}

function aCosto(f: Record<string, unknown>): CostoFila {
  return { ...(f as unknown as CostoFila), costo_f: Number(f.costo_f), costo_d: num(f.costo_d) }
}

export function repoSupabase(db: SupabaseClient = createServiceClient() as unknown as SupabaseClient): RepoFerreteria {
  return {
    async buscarTokenPorHash(hash) {
      const { data, error } = await db
        .from('ferreteria_tokens')
        .select('id, workspace_id, nombre, escritor, revocado_at')
        .eq('token_hash', hash)
        .maybeSingle()
      lanzar('buscar token', error)
      return (data as TokenFila | null) ?? null
    },
    async marcarUsoToken(id, cuando) {
      const { error } = await db.from('ferreteria_tokens').update({ ultimo_uso_at: cuando }).eq('id', id)
      lanzar('marcar uso del token', error)
    },
    async moduloActivo(ws) {
      const { data, error } = await db.from('workspaces').select('modules').eq('id', ws).maybeSingle()
      lanzar('leer módulos', error)
      return (data?.modules as Record<string, unknown> | null)?.ferreteria === true
    },

    async productoPorSku(ws, sku) {
      const { data, error } = await db.from('ferreteria_productos').select('*').eq('workspace_id', ws).eq('sku', sku).maybeSingle()
      lanzar('producto por SKU', error)
      return (data as ProductoFila | null) ?? null
    },
    async productoPorId(ws, id) {
      const { data, error } = await db.from('ferreteria_productos').select('*').eq('workspace_id', ws).eq('id', id).maybeSingle()
      lanzar('producto por id', error)
      return (data as ProductoFila | null) ?? null
    },
    async guardarProducto(fila) {
      const { id: _id, ...resto } = fila
      const { data, error } = await db
        .from('ferreteria_productos')
        .upsert(resto, { onConflict: 'workspace_id,sku' })
        .select('*')
        .single()
      lanzar('guardar producto', error)
      return data as ProductoFila
    },
    async costos(ws, productoId) {
      const { data, error } = await db
        .from('ferreteria_costos')
        .select('*')
        .eq('workspace_id', ws)
        .eq('producto_id', productoId)
        .order('fecha_lista', { ascending: false })
      lanzar('costos', error)
      return ((data ?? []) as Record<string, unknown>[]).map(aCosto)
    },
    async guardarCosto(fila) {
      const { error } = await db.from('ferreteria_costos').upsert(fila, { onConflict: 'producto_id,fecha_lista' })
      lanzar('guardar costo', error)
    },

    async publicacionPorCodigo(ws, codigo) {
      const { data, error } = await db
        .from('ferreteria_publicaciones')
        .select('*')
        .eq('workspace_id', ws)
        .eq('codigo', codigo)
        .maybeSingle()
      lanzar('publicación por código', error)
      return data ? aPublicacion(data) : null
    },
    async publicacionPorId(ws, id) {
      const { data, error } = await db.from('ferreteria_publicaciones').select('*').eq('workspace_id', ws).eq('id', id).maybeSingle()
      lanzar('publicación por id', error)
      return data ? aPublicacion(data) : null
    },
    async publicacionesPorCodigos(ws, codigos) {
      if (codigos.length === 0) return []
      const { data, error } = await db.from('ferreteria_publicaciones').select('*').eq('workspace_id', ws).in('codigo', codigos)
      lanzar('publicaciones por código', error)
      return ((data ?? []) as Record<string, unknown>[]).map(aPublicacion)
    },
    async publicacionesPendientes(ws) {
      const { data, error } = await db
        .from('ferreteria_publicaciones')
        .select('*')
        .eq('workspace_id', ws)
        .eq('pendiente_en_canal', true)
        .order('codigo')
      lanzar('pendientes', error)
      return ((data ?? []) as Record<string, unknown>[]).map(aPublicacion)
    },
    async catalogoPublicaciones(ws) {
      // Dos lecturas con `traerTodo` (o todo o lanza): el catálogo no debe llegar recortado por
      // el techo de 1.000 filas de PostgREST. El SKU se cruza aquí y no con un embed.
      const [pubs, prods] = await Promise.all([
        traerTodo<Record<string, unknown>>(
          (desde, hasta) =>
            db
              .from('ferreteria_publicaciones')
              .select('codigo, producto_id, canal, titulo, precio, estado, linea, link, id_aviso, fecha_publicacion, pendiente_en_canal')
              .eq('workspace_id', ws)
              .order('codigo')
              .range(desde, hasta),
          { etiqueta: 'ferreteria_publicaciones (catálogo)' },
        ),
        traerTodo<{ id: string; sku: string }>(
          (desde, hasta) => db.from('ferreteria_productos').select('id, sku').eq('workspace_id', ws).order('id').range(desde, hasta),
          { etiqueta: 'ferreteria_productos (sku)' },
        ),
      ])
      const skus = new Map(prods.map((p) => [p.id, p.sku]))
      return pubs.map((f) => {
        const { producto_id, ...resto } = f as unknown as PublicacionCatalogo & { producto_id: string }
        return { ...resto, sku: skus.get(producto_id) ?? null, precio: num(f.precio) }
      })
    },
    async insertarPublicacion(fila) {
      const { data, error } = await db.from('ferreteria_publicaciones').insert(fila).select('*').single()
      lanzar('insertar publicación', error)
      return aPublicacion(data)
    },
    async actualizarPublicacion(ws, id, versionEsperada, cambios) {
      const { data, error } = await db
        .from('ferreteria_publicaciones')
        .update(cambios)
        .eq('workspace_id', ws)
        .eq('id', id)
        .eq('version_canal', versionEsperada)
        .select('id')
      lanzar('actualizar publicación', error)
      return (data ?? []).length === 1
    },

    async insertarEventos(eventos) {
      if (eventos.length === 0) return
      const { error } = await db.from('ferreteria_eventos').insert(eventos)
      lanzar('insertar eventos', error)
    },
    async eventosDesde(ws, publicacionId, desde) {
      const { data, error } = await db
        .from('ferreteria_eventos')
        .select('*')
        .eq('workspace_id', ws)
        .eq('publicacion_id', publicacionId)
        .gte('created_at', desde)
        .order('created_at')
      lanzar('eventos', error)
      return (data ?? []) as EventoFila[]
    },

    async guardarMediciones(filas) {
      const conFecha = filas.map((f) => ({ ...f, updated_at: new Date().toISOString() }))
      const { error } = await db.from('ferreteria_mediciones').upsert(conFecha, { onConflict: 'publicacion_id,fecha' })
      lanzar('guardar mediciones', error)
    },
    async guardarConversaciones(filas) {
      const conFecha = filas.map((f) => ({ ...f, updated_at: new Date().toISOString() }))
      const { error } = await db.from('ferreteria_conversaciones').upsert(conFecha, { onConflict: 'workspace_id,clave' })
      lanzar('guardar conversaciones', error)
    },
    async insertarVenta(fila) {
      const { error } = await db.from('ferreteria_ventas').insert(fila)
      lanzar('insertar venta', error)
    },
  }
}
