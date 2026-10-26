// ============================================================
// Pistas para transcribir — el lector de la base (spec 2026-10-26, §4.6)
// ------------------------------------------------------------
// Solo lectura y siempre con el filtro del workspace. Trae de más a propósito (hasta 200 de cada cosa): el tope lo pone
// `textoPistas`. Solo se llama con el interruptor prendido (`pistasSiEncendidas`). Ante un error devuelve lo que pudo
// leer: las pistas son ayuda, no pueden frenar una transcripción.
// ============================================================

import type { BasePistas, NegocioPista } from './pistas.ts';
import type { SupabaseClient } from '../types.ts';

const rel = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { nombre?: string | null } | null;

/** El equipo activo, los colaboradores activos y los negocios abiertos (del más reciente al más viejo). */
export async function leerBasePistas(
  supabase: SupabaseClient, workspaceId: string, o: { negocios?: boolean } = {},
): Promise<BasePistas> {
  const conNegocios = o.negocios !== false;
  const [st, co, ne] = await Promise.all([
    supabase.from('staff').select('full_name').eq('workspace_id', workspaceId).eq('is_active', true).limit(200),
    supabase.from('wa_collaborators').select('name').eq('workspace_id', workspaceId).eq('is_active', true).limit(200),
    conNegocios
      ? supabase.from('negocios').select('codigo, nombre, empresas(nombre), contactos(nombre)')
        .eq('workspace_id', workspaceId).eq('estado', 'abierto').order('updated_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [st, co, ne]) if (r.error) console.error('[pistas] lectura parcial de la base:', r.error.message);
  const filas = (d: unknown) => (Array.isArray(d) ? d : []) as Array<Record<string, unknown>>;
  return {
    equipo: filas(st.data).map((x) => String(x.full_name ?? '')),
    colaboradores: filas(co.data).map((x) => String(x.name ?? '')),
    negocios: filas(ne.data).map((n): NegocioPista => ({
      codigo: (n.codigo as string | null) ?? null,
      nombre: (n.nombre as string | null) ?? null,
      cliente: rel(n.empresas)?.nombre ?? rel(n.contactos)?.nombre ?? null,
    })),
  };
}
