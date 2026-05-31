// ============================================================
// Centro de costos — motor de asignación para edge function WA bot
// ============================================================
//
// Mirror Deno del motor que vive en src/lib/actions/centro-costos-asignar.ts
// del lado Next.js. Ambos comparten la misma lógica (no se importan entre sí
// porque corren en runtimes distintos: Next.js Node vs Supabase Deno).
//
// Cualquier cambio en una heurística debe replicarse en ambos archivos.
// ============================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type CentroCostos =
  | 'directa_negocio'
  | 'distribuible_one'
  | 'distribuible_clarity'
  | 'mixta';

export type OrigenAsignacion = 'auto' | 'sugerido' | 'manual' | 'split';

export interface PropuestaCC {
  centro: CentroCostos | null;
  origen: OrigenAsignacion | null;
  confianza: number;
  sugerido_negocio_id: string | null;
  razon: string;
}

export interface ContextoBotWA {
  /** Negocio mencionado en el último intent NEGOCIO_* del usuario. */
  negocio_id: string;
  /** ISO timestamp del último intent. Si >5min, se ignora. */
  timestamp: string;
}

const CONTEXTO_TTL_MS = 5 * 60 * 1000;
const SIMILITUD_MIN = 0.8;

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similitudDice(a: string, b: string): number {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let inter = 0;
  for (const bi of ba) if (bb.has(bi)) inter++;
  return (2 * inter) / (ba.size + bb.size);
}

/**
 * Cascada de 3 heurísticas. Misma lógica que el lado Next.js.
 */
export async function proponerCentroCostosWA(args: {
  supabase: SupabaseClient;
  workspaceId: string;
  descripcion: string | null | undefined;
  userId: string | null | undefined;
  contextoBot?: ContextoBotWA;
}): Promise<PropuestaCC> {
  const { supabase, workspaceId, descripcion, userId, contextoBot } = args;
  const desc = (descripcion ?? '').trim();

  // ── 1. Whitelist proveedor ────────────────────────────────
  if (desc) {
    const descNorm = normalizar(desc);
    const { data: matches } = await supabase
      .from('gastos_recurrentes_map')
      .select('centro_costos, negocio_id_default, confianza, proveedor_match')
      .eq('workspace_id', workspaceId);

    if (matches && matches.length > 0) {
      const exacto = matches.find(
        (m: { proveedor_match: string }) =>
          descNorm === m.proveedor_match ||
          descNorm.includes(m.proveedor_match) ||
          m.proveedor_match.includes(descNorm),
      );
      if (exacto) {
        return {
          centro: exacto.centro_costos as CentroCostos,
          origen: 'auto',
          confianza: Number(exacto.confianza ?? 1),
          sugerido_negocio_id: exacto.negocio_id_default ?? null,
          razon: `whitelist:${exacto.proveedor_match}`,
        };
      }
    }
  }

  // ── 2. Contexto bot ───────────────────────────────────────
  if (contextoBot?.negocio_id && contextoBot?.timestamp) {
    const edad = Date.now() - new Date(contextoBot.timestamp).getTime();
    if (edad >= 0 && edad <= CONTEXTO_TTL_MS) {
      return {
        centro: 'directa_negocio',
        origen: 'sugerido',
        confianza: 0.85,
        sugerido_negocio_id: contextoBot.negocio_id,
        razon: `contexto_bot:${contextoBot.negocio_id}`,
      };
    }
  }

  // ── 3. Historial usuario ──────────────────────────────────
  if (desc && userId) {
    const { data: historial } = await supabase
      .from('gastos')
      .select('descripcion, centro_costos, negocio_id')
      .eq('workspace_id', workspaceId)
      .eq('created_by', userId)
      .not('centro_costos', 'is', null)
      .not('descripcion', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (historial && historial.length > 0) {
      let mejor: { g: { descripcion: string; centro_costos: string; negocio_id: string | null }; score: number } | null = null;
      for (const g of historial) {
        if (!g.descripcion) continue;
        const s = similitudDice(desc, g.descripcion);
        if (s >= SIMILITUD_MIN && (!mejor || s > mejor.score)) {
          mejor = { g, score: s };
        }
      }
      if (mejor) {
        return {
          centro: mejor.g.centro_costos as CentroCostos,
          origen: 'sugerido',
          confianza: 0.7,
          sugerido_negocio_id: mejor.g.negocio_id ?? null,
          razon: `historial:sim_${mejor.score.toFixed(2)}`,
        };
      }
    }
  }

  return {
    centro: null,
    origen: null,
    confianza: 0,
    sugerido_negocio_id: null,
    razon: 'sin_senal',
  };
}

/**
 * Post-insert self-learning: si 3 gastos manuales del mismo proveedor
 * coinciden en centro_costos, registra regla auto.
 */
export async function registrarMapeoAutomaticoWA(
  supabase: SupabaseClient,
  gastoId: string,
): Promise<void> {
  const { data: gasto } = await supabase
    .from('gastos')
    .select('id, workspace_id, descripcion, centro_costos, negocio_id, origen_asignacion')
    .eq('id', gastoId)
    .single();

  if (
    !gasto ||
    !gasto.descripcion ||
    !gasto.centro_costos ||
    gasto.origen_asignacion !== 'manual'
  ) {
    return;
  }

  const proveedorMatch = normalizar(gasto.descripcion);
  if (proveedorMatch.length < 3) return;

  const { data: existente } = await supabase
    .from('gastos_recurrentes_map')
    .select('id')
    .eq('workspace_id', gasto.workspace_id)
    .eq('proveedor_match', proveedorMatch)
    .maybeSingle();

  if (existente) return;

  const { data: previos } = await supabase
    .from('gastos')
    .select('id, descripcion, centro_costos, origen_asignacion')
    .eq('workspace_id', gasto.workspace_id)
    .eq('centro_costos', gasto.centro_costos)
    .in('origen_asignacion', ['manual', 'sugerido'])
    .not('descripcion', 'is', null)
    .neq('id', gastoId)
    .limit(200);

  if (!previos) return;

  const coincidentes = previos.filter(
    (p: { descripcion: string }) =>
      p.descripcion && normalizar(p.descripcion) === proveedorMatch,
  );

  if (coincidentes.length < 2) return;

  const negocioDefault =
    gasto.centro_costos === 'directa_negocio' ? gasto.negocio_id : null;

  await supabase.from('gastos_recurrentes_map').insert({
    workspace_id: gasto.workspace_id,
    proveedor_match: proveedorMatch,
    centro_costos: gasto.centro_costos,
    negocio_id_default: negocioDefault,
    confianza: 1.0,
    created_by: 'auto',
  });
}
