// ============================================================
// Fuzzy Lookup Queries (pg_trgm similarity)
// ============================================================

import type { SupabaseClient } from './types.ts';

/** Find a single active project by its code (e.g., "KAE-1", "P-001", or numeric 12 → "P-012") */
export async function findProjectByCode(
  supabase: SupabaseClient,
  workspaceId: string,
  code: number | string,
) {
  // Normalize: if numeric, try "P-XXX" format; if string, match directly
  const codeStr = typeof code === 'number'
    ? `P-${String(code).padStart(3, '0')}`
    : String(code).toUpperCase();

  const { data, error } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('workspace_id', workspaceId)
    .ilike('codigo', codeStr)
    .eq('estado', 'en_ejecucion')
    .single();
  if (error && error.code !== 'PGRST116') console.error('[wa-lookup] findProjectByCode error:', error);
  return data ?? null;
}

/** Find active projects matching entity_hint by fuzzy name match */
export async function findProjects(
  supabase: SupabaseClient,
  workspaceId: string,
  entityHint: string,
  limit = 5,
) {
  const { data, error } = await supabase.rpc('wa_find_projects', {
    p_workspace_id: workspaceId,
    p_hint: entityHint,
    p_limit: limit,
  });
  if (error) console.error('[wa-lookup] findProjects error:', error);
  return data ?? [];
}

/** Find all active projects for a workspace (no hint) */
export async function findActiveProjects(supabase: SupabaseClient, workspaceId: string) {
  const { data } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'en_ejecucion')
    .order('updated_at', { ascending: false });
  return data ?? [];
}

// ── NEGOCIOS ──────────────────────────────────────────────────

/** Find all active negocios for a workspace */
export async function findActiveNegocios(supabase: SupabaseClient, workspaceId: string) {
  const { data } = await supabase
    .from('negocios')
    .select('id, nombre, codigo, precio_estimado, precio_aprobado, empresa_id, contacto_id, stage_actual, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'activo')
    .order('updated_at', { ascending: false });
  return (data ?? []).map((n: any) => ({
    ...n,
    // Alias fields so formatProject() works seamlessly
    proyecto_id: n.id,
    codigo: n.codigo ?? '',
  }));
}

/** Find a single active negocio by its code (e.g., "WOR 001") */
export async function findNegocioByCode(
  supabase: SupabaseClient,
  workspaceId: string,
  code: string,
) {
  const codeStr = String(code).toUpperCase();
  const { data, error } = await supabase
    .from('negocios')
    .select('id, nombre, codigo, precio_estimado, precio_aprobado, empresa_id, contacto_id, stage_actual')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'activo')
    .ilike('codigo', `%${codeStr}%`)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[wa-lookup] findNegocioByCode error:', error);
  if (!data) return null;
  return { ...data, proyecto_id: data.id, codigo: data.codigo ?? '' };
}

/** Find active negocios matching hint by fuzzy name match */
export async function findNegocios(
  supabase: SupabaseClient,
  workspaceId: string,
  hint: string,
  limit = 5,
) {
  // Simple ILIKE search (pg_trgm may not be enabled on negocios yet)
  const { data, error } = await supabase
    .from('negocios')
    .select('id, nombre, codigo, precio_estimado, precio_aprobado, empresa_id, contacto_id, stage_actual')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'activo')
    .ilike('nombre', `%${hint}%`)
    .limit(limit);
  if (error) console.error('[wa-lookup] findNegocios error:', error);
  return (data ?? []).map((n: any) => ({
    ...n,
    proyecto_id: n.id,
    codigo: n.codigo ?? '',
  }));
}

/**
 * Unified: find active destinos (negocios first, then projects).
 * Returns both types with a `_tipo` field to distinguish them.
 */
export async function findActiveDestinos(supabase: SupabaseClient, workspaceId: string) {
  const [negocios, projects] = await Promise.all([
    findActiveNegocios(supabase, workspaceId),
    findActiveProjects(supabase, workspaceId),
  ]);
  return {
    negocios,
    projects,
    all: [
      ...negocios.map((n: any) => ({ ...n, _tipo: 'negocio' as const })),
      ...projects.map((p: any) => ({ ...p, _tipo: 'proyecto' as const })),
    ],
  };
}

/** Unified: find destinos matching hint (negocios + projects) */
export async function findDestinos(
  supabase: SupabaseClient,
  workspaceId: string,
  hint: string,
  limit = 5,
) {
  const [negocios, projects] = await Promise.all([
    findNegocios(supabase, workspaceId, hint, limit),
    findProjects(supabase, workspaceId, hint, limit),
  ]);
  return {
    negocios,
    projects,
    all: [
      ...negocios.map((n: any) => ({ ...n, _tipo: 'negocio' as const })),
      ...projects.map((p: any) => ({ ...p, _tipo: 'proyecto' as const })),
    ],
  };
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
      if (lower.includes(normalizedKw)) return cat;
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
  const currentPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM

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
