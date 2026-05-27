'use server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
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
  tipo?: DualTipo;
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

  const identificacion = input.identificacion?.trim() ?? '';
  const nombre = input.nombre?.trim() ?? '';

  if (!identificacion && !nombre) {
    return { ok: false, error: 'validation_error' };
  }

  const body: {
    workspace_origen: string;
    tipo?: DualTipo;
    identificacion?: string;
    nombre?: string;
  } = {
    workspace_origen: slug,
  };
  if (input.tipo) body.tipo = input.tipo;
  if (identificacion) body.identificacion = identificacion;
  if (nombre) body.nombre = nombre;

  try {
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/compliance/dual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify(body),
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
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/compliance/dual/batch`, {
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
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/compliance/dual/batch`, {
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
    const url = new URL(`${VALIDA_API_BASE}/api/v1/compliance/dual/list`);
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
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/compliance/dual/${dualId}`, {
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
      `${VALIDA_API_BASE}/api/v1/compliance/dual/${input.dualId}/audit`,
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
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/compliance/dual/metrics`, {
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

// ─── Historial local: persistencia + listado + filtros ────────────────────

export type DualSeveridad = 'alto' | 'sin_hallazgo' | 'error';

export type DualHistorialItem = {
  id: string;
  dual_id: string | null;
  tipo: 'puntual' | 'masiva_item';
  tipo_persona: DualTipo;
  nombre_consultado: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  severidad: DualSeveridad;
  total_matches: number;
  matches: InformaMatch[];
  titulo_lote: string | null;
  lote_id: string | null;
  error_mensaje: string | null;
  created_at: string;
};

export type DualHistorialFiltros = {
  severidad?: DualSeveridad;
  tipo?: 'puntual' | 'masiva_item';
  fecha_desde?: string;
  fecha_hasta?: string;
  lote_id?: string;
  limite?: number;
};

export type DualConsultaPersistida = DualConsultaPublica & {
  consulta_local_id: string;
  severidad: DualSeveridad;
};

/**
 * Consulta puntual que persiste el resultado en consultas_listas_dual.
 * Reemplazo recomendado para consultaDual() cuando se quiere historial local.
 */
export async function consultaDualPersistente(
  input: DualConsultaInput,
  meta: { lote_id?: string | null; titulo_lote?: string | null; tipo?: 'puntual' | 'masiva_item' } = {},
): Promise<Result<DualConsultaPersistida>> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const tipoRow = meta.tipo ?? 'puntual';
  const idTrim = input.identificacion?.trim() ?? null;
  const nombreTrim = input.nombre?.trim() ?? null;
  const tipoPersona: DualTipo = input.tipo ?? 'natural';

  const r = await consultaDual(input);

  // Caso error: persistimos un registro con severidad='error' (solo si es masiva_item para no ensuciar el historial con errores ad-hoc del usuario en puntual)
  if (!r.ok) {
    if (tipoRow === 'masiva_item') {
      await svc.from('consultas_listas_dual').insert({
        workspace_id: workspaceId,
        lote_id: meta.lote_id ?? null,
        tipo: tipoRow,
        tipo_persona: tipoPersona,
        nombre_consultado: nombreTrim,
        documento_tipo: idTrim ? (tipoPersona === 'juridica' ? 'NIT' : 'CC') : null,
        documento_numero: idTrim,
        dual_id: null,
        severidad: 'error',
        total_matches: 0,
        matches: [],
        titulo_lote: meta.titulo_lote ?? null,
        error_mensaje: r.error,
        created_by: userId,
      });
    }
    return { ok: false, error: r.error };
  }

  const severidad: DualSeveridad = r.data.total_matches > 0 ? 'alto' : 'sin_hallazgo';

  const { data: row, error: errIns } = await svc
    .from('consultas_listas_dual')
    .insert({
      workspace_id: workspaceId,
      lote_id: meta.lote_id ?? null,
      tipo: tipoRow,
      tipo_persona: tipoPersona,
      nombre_consultado: nombreTrim,
      documento_tipo: idTrim ? (tipoPersona === 'juridica' ? 'NIT' : 'CC') : null,
      documento_numero: idTrim,
      dual_id: r.data.dual_id,
      severidad,
      total_matches: r.data.total_matches,
      matches: r.data.matches,
      titulo_lote: meta.titulo_lote ?? null,
      created_by: userId,
    })
    .select('id')
    .single();

  if (errIns || !row) {
    return { ok: false, error: errIns?.message ?? 'persistencia_fallo' };
  }

  return {
    ok: true,
    data: {
      ...r.data,
      consulta_local_id: row.id,
      severidad,
    },
  };
}

export async function listarHistorialDual(
  filtros: DualHistorialFiltros = {},
): Promise<Result<DualHistorialItem[]>> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = svc
    .from('consultas_listas_dual')
    .select(
      'id, dual_id, tipo, tipo_persona, nombre_consultado, documento_tipo, documento_numero, severidad, total_matches, matches, titulo_lote, lote_id, error_mensaje, created_at',
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(filtros.limite ?? 200);

  if (filtros.severidad) q = q.eq('severidad', filtros.severidad);
  if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
  if (filtros.lote_id) q = q.eq('lote_id', filtros.lote_id);
  if (filtros.fecha_desde) q = q.gte('created_at', filtros.fecha_desde);
  if (filtros.fecha_hasta) q = q.lte('created_at', `${filtros.fecha_hasta}T23:59:59.999Z`);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  return { ok: true, data: (data ?? []) as DualHistorialItem[] };
}
