// ============================================================
// Fuzzy Lookup Queries (pg_trgm similarity)
// ============================================================

import type { SupabaseClient } from './types.ts';
import { bogotaYearMonth } from './bogota.ts';
import { extraerCodigoNegocio, llaveCodigo } from './wa-codigo-negocio.ts';

// ── Row shapes ────────────────────────────────────────────────
// Only the columns these lookups and their callers actually read. The `*`
// selects return more columns than declared here: the types under-promise,
// they never over-promise. Nullability comes from `supabase/migrations/`.

/** What a failed PostgREST call puts in `error` (only `code` is inspected). */
type QueryError = { code?: string } | null;

/** A `negocios` row as requested by the selects in this module. */
export type NegocioRow = {
  id: string;
  nombre: string;
  codigo: string | null;
  precio_estimado: number | null;
  precio_aprobado: number | null;
  empresa_id: string | null;
  contacto_id: string | null;
  stage_actual: string;
  /** Only findActiveNegocios() asks for it. */
  updated_at?: string;
  /** Only findActiveNegocios() embeds them: the client shown next to the name. */
  contactos?: { nombre: string | null } | Array<{ nombre: string | null }> | null;
  empresas?: { nombre: string | null } | Array<{ nombre: string | null }> | null;
};

/** El cliente de un negocio con sus relaciones embebidas (contacto, o empresa). */
export function clienteDelNegocio(n: Pick<NegocioRow, 'contactos' | 'empresas'>): string | null {
  const uno = (v: NegocioRow['contactos']) => (Array.isArray(v) ? v[0] : v)?.nombre ?? null;
  return uno(n.contactos) ?? uno(n.empresas);
}

/** A negocio normalized so formatProject() can read it like a project. */
export type NegocioDestino = Omit<NegocioRow, 'codigo'> & {
  codigo: string;
  proyecto_id: string;
};

/** Resolve the id of a destino regardless of which lookup produced it. */
export function destinoId(d: { proyecto_id?: string; id?: string }): string {
  return d.proyecto_id || d.id || '';
}

// Proyectos legacy: el bot ya no los busca (los gastos van a negocios desde el 2026-10-21). `wa_find_projects`
// sigue en la base, arreglada (20261021093000), sin llamadas desde aquí.

// ── NEGOCIOS ──────────────────────────────────────────────────

/** Find all active negocios for a workspace */
export async function findActiveNegocios(supabase: SupabaseClient, workspaceId: string) {
  const { data } = (await supabase
    .from('negocios')
    .select('id, nombre, codigo, precio_estimado, precio_aprobado, empresa_id, contacto_id, stage_actual, updated_at, contactos(nombre), empresas(nombre)')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')
    .order('updated_at', { ascending: false })) as { data: NegocioRow[] | null };
  return (data ?? []).map((n) => ({
    ...n,
    // Alias fields so formatProject() works seamlessly
    proyecto_id: n.id,
    codigo: n.codigo ?? '',
  }));
}

/**
 * Find a single active negocio by its code (e.g., "R1 26 1"). Compara por la llave del código (sin espacios ni
 * guiones): "r1-26-1" y "R1261" son "R1 26 1". Antes buscaba con `ilike '%R1 26 1%'`, que también casaba
 * "R1 26 10" y se quedaba con cualquiera de los dos; y el respaldo sin espacios solo miraba 20 negocios al azar.
 */
export async function findNegocioByCode(
  supabase: SupabaseClient,
  workspaceId: string,
  code: string,
) {
  const llave = llaveCodigo(code);
  if (!llave) return null;
  const { data, error } = (await supabase
    .from('negocios')
    .select('id, nombre, codigo, precio_estimado, precio_aprobado, empresa_id, contacto_id, stage_actual')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')) as { data: NegocioRow[] | null; error: QueryError };
  if (error) console.error('[wa-lookup] findNegocioByCode error:', error);
  const match = (data ?? []).find((n) => llaveCodigo(n.codigo) === llave);
  return match ? { ...match, proyecto_id: match.id, codigo: match.codigo ?? '' } : null;
}

/** Lo que devuelve `wa_find_negocios`: el negocio y cómo casó. */
export type NegocioEncontrado = NegocioDestino & {
  empresa_nombre?: string | null;
  contacto_nombre?: string | null;
  /** `codigo`: por el código; `exacta`: todas las palabras en el nombre, la empresa o el contacto; `parecida`: trigramas. */
  coincidencia: 'codigo' | 'exacta' | 'parecida';
};

/**
 * Negocios abiertos por código o por texto (nombre del negocio, de la empresa o del contacto), con la RPC
 * `wa_find_negocios`. Si el texto trae un código («Revisa el I1 26 5»), se busca por el código.
 *
 * Si la RPC falla (p. ej. la función se desplegó antes que la migración), sigue con las búsquedas de siempre
 * (código exacto y nombre del negocio): peor que la RPC, pero no deja el gasto sin destino.
 */
export async function buscarNegocios(
  supabase: SupabaseClient,
  workspaceId: string,
  texto: string,
  limit = 5,
): Promise<NegocioEncontrado[]> {
  const codigo = extraerCodigoNegocio(texto);
  const hint = codigo ?? texto.trim();
  if (!hint) return [];
  const { data, error } = (await supabase.rpc('wa_find_negocios', {
    p_workspace_id: workspaceId,
    p_hint: hint,
    p_limit: limit,
  })) as { data: Array<NegocioRow & { coincidencia: NegocioEncontrado['coincidencia'] }> | null; error: QueryError };
  if (!error) {
    return (data ?? []).map((n) => ({ ...n, proyecto_id: n.id, codigo: n.codigo ?? '' }));
  }
  console.error('[wa-lookup] wa_find_negocios error, sigue con la búsqueda de siempre:', error);
  if (codigo) {
    const n = await findNegocioByCode(supabase, workspaceId, codigo);
    return n ? [{ ...n, coincidencia: 'codigo' }] : [];
  }
  const porNombre = await findNegocios(supabase, workspaceId, hint, limit);
  return porNombre.map((n) => ({ ...n, coincidencia: 'parecida' as const }));
}

/** Find active negocios matching hint by fuzzy name match */
export async function findNegocios(
  supabase: SupabaseClient,
  workspaceId: string,
  hint: string,
  limit = 5,
) {
  // Simple ILIKE search (pg_trgm may not be enabled on negocios yet)
  const { data, error } = (await supabase
    .from('negocios')
    .select('id, nombre, codigo, precio_estimado, precio_aprobado, empresa_id, contacto_id, stage_actual')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')
    .ilike('nombre', `%${hint}%`)
    .limit(limit)) as { data: NegocioRow[] | null; error: QueryError };
  if (error) console.error('[wa-lookup] findNegocios error:', error);
  return (data ?? []).map((n) => ({
    ...n,
    proyecto_id: n.id,
    codigo: n.codigo ?? '',
  }));
}

/** Find contacts matching hint */
export async function findContacts(
  supabase: SupabaseClient,
  workspaceId: string,
  hint: string,
  limit = 5,
) {
  const { data, error } = await supabase.rpc('wa_find_contacts', {
    p_workspace_id: workspaceId,
    p_hint: hint,
    p_limit: limit,
  });
  if (error) console.error('[wa-lookup] findContacts error:', error);
  return data ?? [];
}

/** Find active opportunities matching hint */
export async function findOpportunities(
  supabase: SupabaseClient,
  workspaceId: string,
  hint: string,
  limit = 5,
) {
  const { data, error } = await supabase.rpc('wa_find_opportunities', {
    p_workspace_id: workspaceId,
    p_hint: hint,
    p_limit: limit,
  });
  if (error) console.error('[wa-lookup] findOpportunities error:', error);
  return data ?? [];
}

/** Match category hint to one of the 9 gastos categories */
export function matchCategory(hint: string): string | null {
  const map: Record<string, string[]> = {
    materiales: ['material', 'insumo', 'herramienta', 'ferretería', 'compra'],
    transporte: ['transporte', 'gasolina', 'uber', 'taxi', 'bus', 'peaje', 'parqueadero', 'combustible'],
    alimentacion: ['almuerzo', 'comida', 'restaurante', 'alimentación', 'café', 'desayuno', 'tinto', 'tintos', 'cafetería', 'onces'],
    servicios_profesionales: ['contador', 'abogado', 'asesor', 'consultor', 'profesional'],
    software: ['software', 'licencia', 'app', 'suscripción', 'hosting', 'dominio', 'nube', 'cloud'],
    arriendo: ['arriendo', 'alquiler', 'servicios', 'internet', 'luz', 'agua', 'gas', 'oficina'],
    marketing: ['marketing', 'pauta', 'publicidad', 'linkedin', 'google ads', 'instagram', 'tarjetas'],
    capacitacion: ['curso', 'capacitación', 'diplomado', 'libro', 'formación', 'taller'],
    otros: [],
  };

  const lower = hint.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  for (const [cat, keywords] of Object.entries(map)) {
    if (cat === 'otros') continue;
    for (const kw of keywords) {
      const normalizedKw = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      // Las palabras de 3 letras o menos ('gas', 'bus', 'app', 'luz') se exigen
      // enteras: por subcadena, 'gas' casaba con "GASTOS de mano de obra" y lo
      // mandaba a arriendo (gasto real del 2026-07-06).
      const casa = normalizedKw.length <= 3
        ? new RegExp(`(^|[^a-z0-9])${normalizedKw}([^a-z0-9]|$)`).test(lower)
        : lower.includes(normalizedKw);
      if (casa) return cat;
    }
  }
  return null;
}

/** Find pending gastos_fijos_borradores that match concept/category */
export async function findMatchingBorrador(
  supabase: SupabaseClient,
  workspaceId: string,
  concept: string,
  category: string | null,
  amount: number,
) {
  const currentPeriod = bogotaYearMonth(); // YYYY-MM de Bogota: el 30 a las 20:00 no es el mes siguiente

  const { data } = await supabase
    .from('gastos_fijos_borradores')
    .select('*, gastos_fijos_config!inner(nombre)')
    .eq('workspace_id', workspaceId)
    .eq('periodo', currentPeriod)
    .eq('confirmado', false);

  if (!data || data.length === 0) return null;

  // Find best match by concept similarity or category + amount tolerance
  for (const b of data) {
    const nameMatch = concept && b.nombre.toLowerCase().includes(concept.toLowerCase());
    const catMatch = category && b.categoria === category;
    const amountTolerance = Math.abs(b.monto_esperado - amount) / b.monto_esperado < 0.2;

    if ((nameMatch || catMatch) && amountTolerance) {
      return b;
    }
  }
  return null;
}

// ============================================================
// SQL functions for fuzzy matching (to be created via migration)
// These RPC functions will be called from the edge functions
// ============================================================

/*
The following SQL functions need to exist in Supabase.
They are created in the migration file alongside this code.
*/

export const LOOKUP_FUNCTIONS_SQL = `
-- RPC: Find projects by fuzzy name match
CREATE OR REPLACE FUNCTION wa_find_projects(
  p_workspace_id UUID,
  p_hint TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  nombre TEXT,
  estado TEXT,
  contacto_nombre TEXT,
  empresa_nombre TEXT,
  presupuesto_total NUMERIC,
  costo_acumulado NUMERIC,
  presupuesto_consumido_pct NUMERIC,
  horas_reales NUMERIC,
  horas_estimadas NUMERIC,
  facturado NUMERIC,
  cobrado NUMERIC,
  cartera NUMERIC
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    v.proyecto_id AS id,
    v.nombre,
    v.estado,
    v.contacto_nombre,
    v.empresa_nombre,
    v.presupuesto_total,
    v.costo_acumulado,
    v.presupuesto_consumido_pct,
    v.horas_reales,
    v.horas_estimadas,
    v.facturado,
    v.cobrado,
    v.cartera
  FROM v_proyecto_financiero v
  LEFT JOIN contactos c ON c.id = (SELECT contacto_id FROM proyectos WHERE id = v.proyecto_id)
  WHERE v.workspace_id = p_workspace_id
    AND v.estado = 'en_ejecucion'
    AND (
      similarity(v.nombre, p_hint) > 0.3
      OR similarity(COALESCE(v.contacto_nombre, ''), p_hint) > 0.3
      OR similarity(COALESCE(v.empresa_nombre, ''), p_hint) > 0.3
    )
  ORDER BY GREATEST(
    similarity(v.nombre, p_hint),
    similarity(COALESCE(v.contacto_nombre, ''), p_hint),
    similarity(COALESCE(v.empresa_nombre, ''), p_hint)
  ) DESC
  LIMIT p_limit;
$$;

-- RPC: Find contacts by fuzzy name match
CREATE OR REPLACE FUNCTION wa_find_contacts(
  p_workspace_id UUID,
  p_hint TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  nombre TEXT,
  telefono TEXT,
  email TEXT,
  rol TEXT
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id, nombre, telefono, email, rol
  FROM contactos
  WHERE workspace_id = p_workspace_id
    AND similarity(nombre, p_hint) > 0.3
  ORDER BY similarity(nombre, p_hint) DESC
  LIMIT p_limit;
$$;

-- RPC: Find opportunities by fuzzy match
CREATE OR REPLACE FUNCTION wa_find_opportunities(
  p_workspace_id UUID,
  p_hint TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  descripcion TEXT,
  etapa TEXT,
  valor_estimado NUMERIC,
  contacto_nombre TEXT,
  empresa_nombre TEXT,
  updated_at TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    o.id,
    o.descripcion,
    o.etapa,
    o.valor_estimado,
    c.nombre AS contacto_nombre,
    e.nombre AS empresa_nombre,
    o.updated_at
  FROM oportunidades o
  JOIN contactos c ON c.id = o.contacto_id
  JOIN empresas e ON e.id = o.empresa_id
  WHERE o.workspace_id = p_workspace_id
    AND o.etapa NOT IN ('ganada', 'perdida')
    AND (
      similarity(o.descripcion, p_hint) > 0.3
      OR similarity(c.nombre, p_hint) > 0.3
      OR similarity(e.nombre, p_hint) > 0.3
    )
  ORDER BY GREATEST(
    similarity(o.descripcion, p_hint),
    similarity(c.nombre, p_hint),
    similarity(e.nombre, p_hint)
  ) DESC
  LIMIT p_limit;
$$;
`;
