'use server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import * as XLSX from 'xlsx';

const VALIDA_API_BASE = process.env.VALIDA_API_BASE ?? 'https://api.valida.metrikone.co';

// ─── Types ────────────────────────────────────────────────────────────────

export type TipoPersona = 'natural' | 'juridica';
export type TipoDocumento = 'CC' | 'CE' | 'NIT' | 'PAS';
export type Severidad = 'alto' | 'medio' | 'bajo' | 'informativo' | 'sin_hallazgo' | 'error';
export type TierLista = '1_vinculante' | '2_obligatoria' | '3_referencia' | '4_kyc_nacional';

export type ValidaMatch = {
  lista: string;
  lista_nombre: string;
  tier: TierLista;
  vinculante_colombia: boolean;
  nombre_coincidencia: string;
  score: number;
  resultado: 'exacto' | 'posible';
  fundamento_legal: string | null;
};

export type ValidaResultado = {
  consulta_id: string;
  severidad: Severidad;
  total_matches: number;
  matches: ValidaMatch[];
  hash_reporte: string;
  fecha_reporte: string;
};

export type ValidaConsultaInput = {
  tipo: TipoPersona;
  nombre: string;
  documento?: { tipo: TipoDocumento; numero: string };
};

export type ConsultaHistorialItem = {
  id: string;
  tipo: 'puntual' | 'masiva_item';
  tipo_persona: TipoPersona;
  nombre_consultado: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  severidad: Severidad;
  total_matches: number;
  valida_consulta_id: string | null;
  hash_reporte: string | null;
  matches: ValidaMatch[] | null;
  created_at: string;
  created_by: string | null;
  negocio_id: string | null;
  negocio_codigo: string | null;
  negocio_nombre: string | null;
  lote_id: string | null;
};

export type FiltrosHistorial = {
  negocio_id?: string;
  severidad?: Severidad;
  tipo?: 'puntual' | 'masiva_item';
  fecha_desde?: string;
  fecha_hasta?: string;
  limite?: number;
};

export type NegocioBusqueda = {
  id: string;
  codigo: string;
  nombre: string;
  estado: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

async function getWorkspaceValidaApiKey(workspaceId: string): Promise<string | null> {
  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (svc.from('workspaces') as any)
    .select('config_extra')
    .eq('id', workspaceId)
    .single();
  const key = (data?.config_extra as Record<string, unknown> | null)?.valida_api_key;
  if (typeof key === 'string' && key.length > 0) return key;
  // Fallback a env var (compatibilidad con setup actual de ALMA)
  return process.env.VALIDA_API_KEY ?? null;
}

async function llamarValida(
  apiKey: string,
  input: ValidaConsultaInput
): Promise<{ ok: true; data: ValidaResultado } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(input),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    const data = (await res.json()) as ValidaResultado;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}

async function persistirConsulta(opts: {
  workspaceId: string;
  userId: string | null;
  negocioId: string | null;
  loteId: string | null;
  tipo: 'puntual' | 'masiva_item';
  input: ValidaConsultaInput;
  resultado:
    | { ok: true; data: ValidaResultado }
    | { ok: false; error: string };
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const isError = !opts.resultado.ok;
  const data = opts.resultado.ok ? opts.resultado.data : null;

  const row = {
    workspace_id: opts.workspaceId,
    negocio_id: opts.negocioId,
    lote_id: opts.loteId,
    tipo: opts.tipo,
    tipo_persona: opts.input.tipo,
    nombre_consultado: opts.input.nombre || null,
    documento_tipo: opts.input.documento?.tipo ?? null,
    documento_numero: opts.input.documento?.numero ?? null,
    valida_consulta_id: data?.consulta_id ?? null,
    severidad: (isError ? 'error' : data!.severidad) as Severidad,
    total_matches: data?.total_matches ?? 0,
    matches: data?.matches ?? null,
    hash_reporte: data?.hash_reporte ?? null,
    created_by: opts.userId,
  };

  const { data: ins, error } = await svc.from('valida_consultas')
    .insert(row)
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: ins.id };
}

// ─── Server Actions ───────────────────────────────────────────────────────

export async function consultarValida(
  input: ValidaConsultaInput,
  opts: { negocio_id?: string | null } = {}
): Promise<
  | { ok: true; data: ValidaResultado; consulta_local_id: string }
  | { ok: false; error: string }
> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const apiKey = await getWorkspaceValidaApiKey(workspaceId);
  if (!apiKey) return { ok: false, error: 'valida_api_key_no_configurada' };

  const resultado = await llamarValida(apiKey, input);

  const persisted = await persistirConsulta({
    workspaceId,
    userId: user?.id ?? null,
    negocioId: opts.negocio_id ?? null,
    loteId: null,
    tipo: 'puntual',
    input,
    resultado,
  });

  if (!resultado.ok) return { ok: false, error: resultado.error };
  if (!persisted.ok) return { ok: false, error: persisted.error };

  return { ok: true, data: resultado.data, consulta_local_id: persisted.id };
}

// ─── Masivo XLSX ──────────────────────────────────────────────────────────
//
// Formato esperado de la plantilla (mismo que ALMA):
//   Columna A: tipo_persona  (natural | juridica)
//   Columna B: nombre_completo (string)
//   Columna C: tipo_documento  (CC | CE | NIT | PAS, opcional)
//   Columna D: numero_documento (opcional)
//   Columna E: negocio_codigo  (opcional, sobrescribe el lote)

type FilaXLSX = {
  tipo_persona: string;
  nombre_completo: string;
  tipo_documento?: string;
  numero_documento?: string;
  negocio_codigo?: string;
};

export async function descargarPlantillaValida(): Promise<
  { ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }
> {
  try {
    const wb = XLSX.utils.book_new();
    const headers = [
      ['tipo_persona', 'nombre_completo', 'tipo_documento', 'numero_documento', 'negocio_codigo'],
      ['natural', 'Juan Perez Gomez', 'CC', '1077089147', ''],
      ['juridica', 'Acme Trading SAS', 'NIT', '900123456', 'C1 26 1'],
      ['natural', 'Maria Rodriguez', '', '', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(headers);
    ws['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Consultas');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return {
      ok: true,
      data: {
        base64: buf.toString('base64'),
        filename: 'valida_plantilla_masiva.xlsx',
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_plantilla' };
  }
}

export async function consultarValidaMasivo(
  fd: FormData,
  opts: { negocio_id_lote?: string | null } = {}
): Promise<
  | { ok: true; data: { base64: string; filename: string; total: number; lote_id: string } }
  | { ok: false; error: string }
> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  const apiKey = await getWorkspaceValidaApiKey(workspaceId);
  if (!apiKey) return { ok: false, error: 'valida_api_key_no_configurada' };

  const file = fd.get('archivo');
  if (!(file instanceof File)) return { ok: false, error: 'archivo_no_provisto' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'archivo_excede_5mb' };

  // Parse XLSX
  let rows: FilaXLSX[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { ok: false, error: 'archivo_sin_hojas' };
    rows = XLSX.utils.sheet_to_json<FilaXLSX>(sheet, { defval: '' });
  } catch {
    return { ok: false, error: 'archivo_no_legible' };
  }

  if (rows.length === 0) return { ok: false, error: 'archivo_vacio' };
  if (rows.length > 500) return { ok: false, error: 'maximo_500_filas_por_lote' };

  // Resolver mapping codigo → negocio_id (para columna negocio_codigo)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const codigos = Array.from(
    new Set(
      rows
        .map(r => String(r.negocio_codigo ?? '').trim())
        .filter(c => c.length > 0)
    )
  );
  const codigoToId = new Map<string, string>();
  if (codigos.length > 0) {
    const { data: negs } = await svc.from('negocios')
      .select('id, codigo')
      .eq('workspace_id', workspaceId)
      .in('codigo', codigos);
    for (const n of (negs ?? []) as Array<{ id: string; codigo: string }>) {
      codigoToId.set(n.codigo, n.id);
    }
  }

  // Generar lote_id
  const loteId = crypto.randomUUID();

  // Procesar cada fila secuencialmente (evita rate-limit y orden de matches en XLSX salida)
  type ResultadoFila = {
    fila: FilaXLSX;
    severidad: Severidad;
    total_matches: number;
    consulta_id: string;
    error: string | null;
  };
  const resultados: ResultadoFila[] = [];

  for (const fila of rows) {
    const tipoPersona = String(fila.tipo_persona ?? '').trim().toLowerCase() as TipoPersona;
    const nombre = String(fila.nombre_completo ?? '').trim();
    const tipoDoc = String(fila.tipo_documento ?? '').trim().toUpperCase() as TipoDocumento;
    const numDoc = String(fila.numero_documento ?? '').trim();
    const negocioCodigo = String(fila.negocio_codigo ?? '').trim();

    const negocioId = negocioCodigo
      ? codigoToId.get(negocioCodigo) ?? null
      : opts.negocio_id_lote ?? null;

    if (!nombre || (tipoPersona !== 'natural' && tipoPersona !== 'juridica')) {
      resultados.push({
        fila,
        severidad: 'error',
        total_matches: 0,
        consulta_id: '',
        error: 'tipo_persona o nombre invalido',
      });
      continue;
    }

    const input: ValidaConsultaInput = {
      tipo: tipoPersona,
      nombre,
      ...(numDoc && tipoDoc ? { documento: { tipo: tipoDoc, numero: numDoc } } : {}),
    };

    const r = await llamarValida(apiKey, input);

    await persistirConsulta({
      workspaceId,
      userId,
      negocioId,
      loteId,
      tipo: 'masiva_item',
      input,
      resultado: r,
    });

    resultados.push({
      fila,
      severidad: r.ok ? r.data.severidad : 'error',
      total_matches: r.ok ? r.data.total_matches : 0,
      consulta_id: r.ok ? r.data.consulta_id : '',
      error: r.ok ? null : r.error,
    });
  }

  // Generar XLSX salida
  try {
    const wb = XLSX.utils.book_new();
    const out = resultados.map(r => ({
      tipo_persona: r.fila.tipo_persona,
      nombre_completo: r.fila.nombre_completo,
      tipo_documento: r.fila.tipo_documento ?? '',
      numero_documento: r.fila.numero_documento ?? '',
      negocio_codigo: r.fila.negocio_codigo ?? '',
      severidad: r.severidad,
      total_matches: r.total_matches,
      consulta_id: r.consulta_id,
      error: r.error ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return {
      ok: true,
      data: {
        base64: buf.toString('base64'),
        filename: `valida_resultados_${stamp}.xlsx`,
        total: resultados.length,
        lote_id: loteId,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_generando_xlsx' };
  }
}

// ─── Historial ────────────────────────────────────────────────────────────

export async function listarConsultasValida(
  filtros: FiltrosHistorial = {}
): Promise<{ ok: true; consultas: ConsultaHistorialItem[] } | { ok: false; error: string }> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  let q = svc
    .from('valida_consultas')
    .select('id, tipo, tipo_persona, nombre_consultado, documento_tipo, documento_numero, severidad, total_matches, valida_consulta_id, hash_reporte, matches, created_at, created_by, negocio_id, lote_id')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(filtros.limite ?? 200);

  if (filtros.negocio_id) q = q.eq('negocio_id', filtros.negocio_id);
  if (filtros.severidad) q = q.eq('severidad', filtros.severidad);
  if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
  if (filtros.fecha_desde) q = q.gte('created_at', filtros.fecha_desde);
  if (filtros.fecha_hasta) q = q.lte('created_at', filtros.fecha_hasta);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  // Resolver datos de negocios
  const negocioIds = Array.from(
    new Set((data ?? []).map((r: { negocio_id: string | null }) => r.negocio_id).filter(Boolean))
  ) as string[];
  const negocioMap = new Map<string, { codigo: string; nombre: string }>();
  if (negocioIds.length > 0) {
    const { data: negs } = await svc.from('negocios')
      .select('id, codigo, nombre')
      .in('id', negocioIds);
    for (const n of (negs ?? []) as Array<{ id: string; codigo: string; nombre: string }>) {
      negocioMap.set(n.id, { codigo: n.codigo, nombre: n.nombre });
    }
  }

  const items: ConsultaHistorialItem[] = (data ?? []).map((r: Record<string, unknown>) => {
    const negId = r.negocio_id as string | null;
    const neg = negId ? negocioMap.get(negId) : null;
    return {
      id: r.id as string,
      tipo: r.tipo as 'puntual' | 'masiva_item',
      tipo_persona: r.tipo_persona as TipoPersona,
      nombre_consultado: r.nombre_consultado as string | null,
      documento_tipo: r.documento_tipo as string | null,
      documento_numero: r.documento_numero as string | null,
      severidad: r.severidad as Severidad,
      total_matches: r.total_matches as number,
      valida_consulta_id: r.valida_consulta_id as string | null,
      hash_reporte: r.hash_reporte as string | null,
      matches: r.matches as ValidaMatch[] | null,
      created_at: r.created_at as string,
      created_by: r.created_by as string | null,
      negocio_id: negId,
      negocio_codigo: neg?.codigo ?? null,
      negocio_nombre: neg?.nombre ?? null,
      lote_id: r.lote_id as string | null,
    };
  });

  return { ok: true, consultas: items };
}

export async function listarConsultasPorNegocio(
  negocioId: string
): Promise<{ ok: true; consultas: ConsultaHistorialItem[] } | { ok: false; error: string }> {
  return listarConsultasValida({ negocio_id: negocioId, limite: 100 });
}

// ─── Buscador de negocios para dropdown (incluye cerrados) ────────────────

export async function buscarNegociosParaValida(
  query: string
): Promise<{ ok: true; negocios: NegocioBusqueda[] } | { ok: false; error: string }> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const trimmed = query.trim();

  let q = svc
    .from('negocios')
    .select('id, codigo, nombre, estado')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (trimmed.length > 0) {
    q = q.or(`codigo.ilike.%${trimmed}%,nombre.ilike.%${trimmed}%`);
  }

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    negocios: (data ?? []) as NegocioBusqueda[],
  };
}
