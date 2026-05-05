'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';

const VALIDA_API_BASE = process.env.VALIDA_API_BASE ?? 'https://api.valida.metrikone.co';

// ─── Types ────────────────────────────────────────────────────────────────

export type DualMode = 'documento' | 'nombre';
export type DualTipo = 'natural' | 'juridica';
export type DualClasificacion =
  | 'zero_zero'
  | 'match_match'
  | 'solo_informa'
  | 'solo_valida'
  | 'pendiente';

export type DualDecision =
  | 'valida_correcto'
  | 'valida_falso_negativo'
  | 'valida_falso_positivo'
  | 'informa_falso_negativo'
  | 'informa_falso_positivo'
  | 'inconcluso';

export type InformaMatch = {
  lista: string;
  nombre: string;
  documento: string | null;
  fundamento: string | null;
};

export type InformaResult = {
  total_matches: number;
  matches: InformaMatch[];
};

export type ValidaMatchSummary = {
  lista_slug: string;
  nombre_principal: string;
  score_final: number;
};

export type DualConsultaPublica = {
  // Lo que ALMA ve (Informa solamente)
  dual_id: string;
  fecha: string;
  total_matches: number;
  matches: InformaMatch[];
};

export type DualListItem = {
  dual_id: string;
  workspace_origen: string;
  fecha: string;
  modo: DualMode;
  tipo: DualTipo;
  identificacion: string | null;
  nombre: string | null;
  count_informa: number;
  count_valida: number;
  clasificacion: DualClasificacion;
  auditada: boolean;
  decision: DualDecision | null;
};

export type DualListResponse = {
  total: number;
  page: number;
  page_size: number;
  items: DualListItem[];
};

export type DualDetail = {
  dual_id: string;
  workspace_origen: string;
  fecha: string;
  modo: DualMode;
  tipo: DualTipo;
  identificacion: string | null;
  nombre: string | null;
  clasificacion: DualClasificacion;
  auditada: boolean;
  decision: DualDecision | null;
  notas: string | null;
  informa: {
    total_matches: number;
    matches: InformaMatch[];
    raw: unknown;
  };
  valida: {
    total_matches: number;
    matches: ValidaMatchSummary[];
    raw: unknown;
  };
};

export type DualMetrics = {
  total_consultas: number;
  pct_zero_zero: number;
  pct_divergencia: number;
  pendientes_auditoria: number;
  positivos_auditados: number;
  recall: number | null;
  precision: number | null;
  cumple_umbral_vera: boolean;
  veredictos: Record<DualDecision, number>;
  por_lista: Array<{
    lista: string;
    positivos_auditados: number;
    recall: number | null;
    precision: number | null;
    cumple_umbral: boolean;
  }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.VALIDA_API_KEY;
  if (!key) throw new Error('VALIDA_API_KEY no esta configurada');
  return key;
}

function getAuditSecret(): string {
  const s = process.env.METRIK_AUDIT_SECRET;
  if (!s) throw new Error('METRIK_AUDIT_SECRET no esta configurado');
  return s;
}

async function getWorkspaceSlug(workspaceId: string): Promise<string | null> {
  const svc = createServiceClient();
  const { data } = await svc
    .from('workspaces')
    .select('slug')
    .eq('id', workspaceId)
    .single();
  return data?.slug ?? null;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function jsonOrError<T>(res: Response): Promise<Result<T>> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    const err = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    return { ok: false, error: err };
  }
  const data = (await res.json()) as T;
  return { ok: true, data };
}

// ─── UI 1: Consulta puntual (alma-afi) ─────────────────────────────────────

export type DualConsultaInput = {
  modo: DualMode;
  tipo: DualTipo;
  identificacion?: string;
  nombre?: string;
};

export async function consultaDual(
  input: DualConsultaInput
): Promise<Result<DualConsultaPublica>> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  const slug = await getWorkspaceSlug(workspaceId);
  if (!slug) return { ok: false, error: 'workspace_slug_no_encontrado' };

  try {
    const res = await fetch(`${VALIDA_API_BASE}/v1/compliance/dual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        modo: input.modo,
        tipo: input.tipo,
        identificacion: input.identificacion ?? null,
        nombre: input.nombre ?? null,
        workspace_origen: slug,
      }),
      cache: 'no-store',
    });
    return jsonOrError<DualConsultaPublica>(res);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}

// ─── UI 1: Batch XLSX ──────────────────────────────────────────────────────

/**
 * Sube un XLSX al endpoint batch y devuelve el blob resultado (XLSX con resultados anexos).
 * El client recibe un base64 + filename para forzar la descarga.
 */
export async function consultaDualBatch(formData: FormData): Promise<
  Result<{ base64: string; filename: string }>
> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  const slug = await getWorkspaceSlug(workspaceId);
  if (!slug) return { ok: false, error: 'workspace_slug_no_encontrado' };

  const file = formData.get('archivo');
  if (!(file instanceof File)) return { ok: false, error: 'archivo_requerido' };

  const out = new FormData();
  out.append('archivo', file);
  out.append('workspace_origen', slug);

  try {
    const res = await fetch(`${VALIDA_API_BASE}/v1/compliance/dual/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getApiKey()}` },
      body: out,
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      const err = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      return { ok: false, error: err };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const cd = res.headers.get('content-disposition') ?? '';
    const m = /filename\s*=\s*"?([^"]+)"?/i.exec(cd);
    const filename = m?.[1] ?? `dual-resultados-${Date.now()}.xlsx`;
    return { ok: true, data: { base64: buf.toString('base64'), filename } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}

/**
 * Descarga la plantilla en blanco (para UI 1) y la entrega como base64 al client.
 */
export async function descargarPlantillaBatch(): Promise<
  Result<{ base64: string; filename: string }>
> {
  try {
    const res = await fetch(`${VALIDA_API_BASE}/v1/compliance/dual/batch`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const cd = res.headers.get('content-disposition') ?? '';
    const m = /filename\s*=\s*"?([^"]+)"?/i.exec(cd);
    const filename = m?.[1] ?? 'plantilla-listas-restrictivas.xlsx';
    return { ok: true, data: { base64: buf.toString('base64'), filename } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}

// ─── UI 2: Listado / Detalle / Audit / Metrics (workspace metrik) ──────────

export type DualListFilters = {
  page?: number;
  pageSize?: number;
  clasificacion?: DualClasificacion[];
  workspace?: string; // slug
  desde?: string; // ISO date
  hasta?: string; // ISO date
  auditada?: 'true' | 'false' | 'all';
};

async function ensureWorkspaceMetrik(): Promise<Result<{ slug: 'metrik' }>> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  const slug = await getWorkspaceSlug(workspaceId);
  if (slug !== 'metrik') return { ok: false, error: 'forbidden' };
  return { ok: true, data: { slug: 'metrik' } };
}

export async function listarConsultasDuales(
  filters: DualListFilters = {}
): Promise<Result<DualListResponse>> {
  const guard = await ensureWorkspaceMetrik();
  if (!guard.ok) return guard;

  try {
    const url = new URL(`${VALIDA_API_BASE}/v1/compliance/dual/list`);
    url.searchParams.set('workspace', filters.workspace ?? 'all');
    url.searchParams.set('page', String(filters.page ?? 1));
    url.searchParams.set('page_size', String(filters.pageSize ?? 50));
    if (filters.clasificacion?.length) {
      url.searchParams.set('clasificacion', filters.clasificacion.join(','));
    }
    if (filters.desde) url.searchParams.set('desde', filters.desde);
    if (filters.hasta) url.searchParams.set('hasta', filters.hasta);
    if (filters.auditada && filters.auditada !== 'all') {
      url.searchParams.set('auditada', filters.auditada);
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'x-metrik-audit': getAuditSecret(),
      },
      cache: 'no-store',
    });
    return jsonOrError<DualListResponse>(res);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}

export async function obtenerConsultaDual(dualId: string): Promise<Result<DualDetail>> {
  const guard = await ensureWorkspaceMetrik();
  if (!guard.ok) return guard;

  try {
    const res = await fetch(`${VALIDA_API_BASE}/v1/compliance/dual/${dualId}`, {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'x-metrik-audit': getAuditSecret(),
      },
      cache: 'no-store',
    });
    return jsonOrError<DualDetail>(res);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}

export async function registrarVeredicto(input: {
  dualId: string;
  decision: DualDecision;
  notas?: string;
}): Promise<Result<{ ok: true }>> {
  const guard = await ensureWorkspaceMetrik();
  if (!guard.ok) return guard;

  try {
    const res = await fetch(
      `${VALIDA_API_BASE}/v1/compliance/dual/${input.dualId}/audit`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getApiKey()}`,
          'x-metrik-audit': getAuditSecret(),
        },
        body: JSON.stringify({ decision: input.decision, notas: input.notas ?? null }),
        cache: 'no-store',
      }
    );
    return jsonOrError<{ ok: true }>(res);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}

export async function obtenerMetricsDuales(): Promise<Result<DualMetrics>> {
  const guard = await ensureWorkspaceMetrik();
  if (!guard.ok) return guard;

  try {
    const res = await fetch(`${VALIDA_API_BASE}/v1/compliance/dual/metrics`, {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'x-metrik-audit': getAuditSecret(),
      },
      cache: 'no-store',
    });
    return jsonOrError<DualMetrics>(res);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}
