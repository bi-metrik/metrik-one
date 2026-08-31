'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import { resolverNombresUsuarios } from './_usuarios';
import { listarSegmentos } from './compliance-segmentos';
import {
  claveSegmento,
  FILTRO_SIN_SEGMENTO,
  type ComplianceSegmento,
} from '@/lib/compliance/segmentos';
import type { UniversoSegmentacion } from '@/lib/valida/segmentacion-presets';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { getCachedUser } from '@/lib/supabase/auth-user'
import { cargarCatalogoTierVigente } from './compliance-tier-catalogo';
import { clasificarConsulta, verificarCeroSupresion, type TierResuelto } from '@/lib/compliance/tier-fuentes';
import { cargarConfigPeriodicidad } from './compliance-periodicidad';
import { calcularVigencia } from '@/lib/compliance/periodicidad';
import { todayBogotaISO } from '@/lib/dates/bogota';

// `||` (no `??`): una env vacia ("") debe caer al default igual que si estuviera ausente.
// Vercel puede inyectar VALIDA_API_BASE="" y `??` la dejaria pasar -> URL relativa rota.
const VALIDA_API_BASE = process.env.VALIDA_API_BASE || 'https://api.valida.metrikone.co';

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

/**
 * Lo que el proveedor manda DENTRO de cada coincidencia.
 *
 * Estos campos ya están persistidos en `consultas_listas_dual.matches[].detalle`
 * desde el primer día (verificado contra producción el 2026-08-25: 50 de 50
 * coincidencias traen `fuente`). El tipo los escondía, no la base.
 *
 * Los tres que importan y por qué:
 *
 *   - `fuente` es la LLAVE de clasificación por tier. Para todo lo que no es
 *     medios es un código estable (`OFAC`, `PEPINT`, `CSL`, `NAREWUSA`…); el
 *     nombre visible de la lista NO sirve como llave porque en producción ya hay
 *     mojibake (`USA WANTED: NARCOTICS REWARDS PROGRAM—MISCELLANEOUS TARGETS`,
 *     guion largo UTF-8 leído como latin-1). Ver `@/lib/compliance/tier-fuentes`.
 *   - `coincidencia` dice si el cruce fue por documento o por nombre. Es el eje
 *     de identidad: solo 4 de 50 coincidencias medidas tienen documento.
 *   - `porcentajeDeCoincidencia` llega como TEXTO (`"80"`), no como número.
 *
 * Todo opcional y el resto abierto con index signature: `matches` se lee del
 * jsonb con un cast, sin validar, así que declarar un campo como obligatorio
 * sería afirmar algo que nadie verifica en tiempo de ejecución.
 */
export type InformaMatchDetalle = {
  fuente?: string | null;
  coincidencia?: string | null;
  porcentajeDeCoincidencia?: string | null;
  nombreEncontrado?: string | null;
  identificacionEncontrada?: string | null;
  delitoOCausa?: string | null;
  lista?: string | null;
  [k: string]: unknown;
};

export type InformaMatch = {
  lista: string;
  nombre: string;
  documento: string | null;
  fundamento: string | null;
  detalle?: InformaMatchDetalle;
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

/**
 * Lo que la fuente (metrik-valida) necesita para consultar. El segmento NO viaja:
 * es una etiqueta operativa de ONE, no un criterio de búsqueda.
 */
export type DualConsultaBase = {
  tipo?: DualTipo;
  identificacion?: string;
  nombre?: string;
};

/**
 * Input de una consulta que se persiste en el historial.
 *
 * `segmento_id` es una clave OBLIGATORIA con valor nullable a propósito: obliga a
 * cada llamador a decidir explícitamente (el compilador no deja omitirla), y el
 * `null` sirve para las filas de un lote que ya vienen con error y que igual se
 * registran para que quede constancia de por qué no se consultaron.
 *
 * Para una consulta REAL el segmento es obligatorio y lo exige
 * `consultaDualPersistente` en tiempo de ejecución, ANTES de llamar a la fuente
 * (cada llamada es facturable: no se gasta una consulta para después rechazarla).
 */
export type DualConsultaInput = DualConsultaBase & {
  segmento_id: string | null;
};

export async function consultaDual(
  input: DualConsultaBase
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
 * Genera la plantilla del cargue masivo AQUÍ, en ONE.
 *
 * Antes se descargaba de la API de metrik-valida mientras `prepararLoteDual`
 * (que vive en este archivo) era quien la parseaba: el contrato estaba partido
 * en dos repos y una columna nueva en el parser no llegaba nunca al archivo que
 * bajaba el usuario. Además el catálogo de segmentos es POR WORKSPACE, así que
 * la plantilla ya no puede ser un archivo estático.
 *
 * Quien define el formato de parseo emite la plantilla. Una sola fuente.
 *
 * La hoja 1 va con ENCABEZADOS Y NADA MÁS: una fila de ejemplo sería una
 * consulta facturable contra la cuenta del cliente si alguien sube la plantilla
 * tal cual. Los valores válidos y las instrucciones viven en la hoja 2.
 */
export async function generarPlantillaLoteDual(): Promise<
  Result<{ base64: string; filename: string }>
> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  const cat = await listarSegmentos();
  if (!cat.ok) return { ok: false, error: cat.error };
  if (cat.data.length === 0) {
    return { ok: false, error: ERROR_CATALOGO_VACIO };
  }

  const nombres = cat.data.map((s) => s.nombre);

  const hojaDatos = XLSX.utils.aoa_to_sheet([[...COLUMNAS_PLANTILLA]]);
  hojaDatos['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 38 }, { wch: 24 }];

  const instrucciones: string[][] = [
    ['Cómo llenar la plantilla'],
    [''],
    ['Llena la hoja "Consultas". Una fila por persona o empresa. Hasta ' + LOTE_LIMITE + ' filas.'],
    ['No cambies los nombres de las columnas ni el orden de la primera fila.'],
    [''],
    ['Columna', 'Obligatoria', 'Valores válidos'],
    ['tipo', 'Sí', 'natural | juridica'],
    ['identificacion', 'Al menos una de las dos', 'Cédula o NIT, solo números'],
    ['nombre', 'Al menos una de las dos', 'Nombre completo o razón social'],
    ['segmento', 'Sí', nombres.join(' | ')],
    [''],
    ['Segmentos configurados en este espacio de trabajo'],
    ['Segmento', 'Universo'],
    ...cat.data.map((s) => [s.nombre, s.universo]),
    [''],
    ['Si necesitas un segmento que no está en esta lista, pídeselo al oficial de cumplimiento:'],
    ['se configura en Compliance → Catálogo de segmentos.'],
  ];
  const hojaInstrucciones = XLSX.utils.aoa_to_sheet(instrucciones);
  hojaInstrucciones['!cols'] = [{ wch: 46 }, { wch: 26 }, { wch: 46 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaDatos, HOJA_DATOS);
  XLSX.utils.book_append_sheet(wb, hojaInstrucciones, 'Instrucciones');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return {
    ok: true,
    data: {
      base64: buf.toString('base64'),
      filename: 'plantilla-listas-restrictivas.xlsx',
    },
  };
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
  consultado_por: string | null;
  /** null en consultas anteriores al catálogo de segmentos. */
  segmento_id: string | null;
  /**
   * null con `segmento_id` no nulo = el segmento ya no está en el catálogo.
   * La pantalla lo dice ("Segmento no encontrado") en vez de pintar un guion
   * indistinguible de "nunca tuvo segmento".
   */
  segmento_nombre: string | null;
  segmento_universo: UniversoSegmentacion | null;
  /**
   * Hasta cuándo cubre esta consulta (R2). null en las anteriores a la
   * periodicidad: la pantalla lo muestra como "sin vigencia", que no es lo mismo
   * que vencida.
   */
  vigente_hasta: string | null;
};

export type DualHistorialFiltros = {
  severidad?: DualSeveridad;
  tipo?: 'puntual' | 'masiva_item';
  fecha_desde?: string;
  fecha_hasta?: string;
  lote_id?: string;
  limite?: number;
  /**
   * id del catálogo, o `FILTRO_SIN_SEGMENTO` para ver solo las consultas
   * históricas que no lo tienen. Un id que no exista en el catálogo se rechaza
   * con error: un filtro que devuelve vacío por silencio es indistinguible de
   * "no hay consultas de ese segmento".
   */
  segmento_id?: string;
};

export type DualConsultaPersistida = DualConsultaPublica & {
  consulta_local_id: string;
  severidad: DualSeveridad;
  segmento_id: string;
  segmento_nombre: string;
};

export type DualConsultaMeta = {
  lote_id?: string | null;
  titulo_lote?: string | null;
  tipo?: 'puntual' | 'masiva_item';
  /**
   * Fila de un lote que ya venía inválida desde el XLSX.
   *
   * Se registra el error TAL CUAL lo detectó `prepararLoteDual` y NO se llama a
   * la fuente: la fila hay que corregirla igual, y cada llamada es facturable.
   * Antes se enviaba el input mutilado y el historial guardaba
   * `validation_error`, que no le dice a nadie qué celda arreglar.
   */
  error_fila?: string | null;
};

/**
 * Consulta puntual que persiste el resultado en consultas_listas_dual.
 * Reemplazo recomendado para consultaDual() cuando se quiere historial local.
 */
export async function consultaDualPersistente(
  input: DualConsultaInput,
  meta: DualConsultaMeta = {},
): Promise<Result<DualConsultaPersistida>> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  const { user } = await getCachedUser();
  const userId = user?.id ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const tipoRow = meta.tipo ?? 'puntual';
  const idTrim = input.identificacion?.trim() ?? null;
  const nombreTrim = input.nombre?.trim() ?? null;
  const tipoPersona: DualTipo = input.tipo ?? 'natural';
  const errorFila = meta.error_fila?.trim() || null;

  const filaBase = {
    workspace_id: workspaceId,
    lote_id: meta.lote_id ?? null,
    tipo: tipoRow,
    tipo_persona: tipoPersona,
    nombre_consultado: nombreTrim,
    documento_tipo: idTrim ? (tipoPersona === 'juridica' ? 'NIT' : 'CC') : null,
    documento_numero: idTrim,
    titulo_lote: meta.titulo_lote ?? null,
    created_by: userId,
  };

  // Fila que ya llegó inválida: se deja constancia y NO se gasta una consulta.
  if (errorFila) {
    if (tipoRow === 'masiva_item') {
      await svc.from('consultas_listas_dual').insert({
        ...filaBase,
        segmento_id: input.segmento_id,
        dual_id: null,
        severidad: 'error',
        total_matches: 0,
        matches: [],
        error_mensaje: errorFila,
      });
    }
    return { ok: false, error: errorFila };
  }

  // El segmento se valida ANTES de llamar a la fuente: rechazarlo después
  // habría quemado una consulta facturable sin poder registrarla bien.
  const segmento = await resolverSegmentoParaConsulta(workspaceId, input.segmento_id);
  if (!segmento.ok) return { ok: false, error: segmento.error };

  const r = await consultaDual({
    tipo: input.tipo,
    identificacion: input.identificacion,
    nombre: input.nombre,
  });

  // Caso error: persistimos un registro con severidad='error' (solo si es masiva_item para no ensuciar el historial con errores ad-hoc del usuario en puntual)
  if (!r.ok) {
    if (tipoRow === 'masiva_item') {
      await svc.from('consultas_listas_dual').insert({
        ...filaBase,
        segmento_id: segmento.data.id,
        dual_id: null,
        severidad: 'error',
        total_matches: 0,
        matches: [],
        error_mensaje: r.error,
      });
    }
    return { ok: false, error: r.error };
  }

  const severidad: DualSeveridad = r.data.total_matches > 0 ? 'alto' : 'sin_hallazgo';

  // Clasificación por tier en modo OBSERVABLE (concepto Emilio 2026-08-31, C1).
  // `severidad` NO se toca: sigue siendo el único campo del que dependen la
  // bandeja del oficial y la auditoría de contrataciones. El tier se guarda al
  // lado para poder medirlo, y no decide nada hasta el bloque B.
  const clasificacion = await clasificarParaGuardar(r.data.matches);

  // R2: hasta cuándo cubre esta consulta. Se calcula al guardar con la config
  // vigente HOY y se congela en la fila: si el oficial cambia la política mañana,
  // las consultas viejas conservan la vigencia con la que se emitieron. Derivarla
  // al leer reescribiría el pasado cada vez que alguien ajusta un número.
  const vigencia = await calcularVigenciaParaGuardar(workspaceId, clasificacion);

  const { data: row, error: errIns } = await svc
    .from('consultas_listas_dual')
    .insert({
      ...filaBase,
      segmento_id: segmento.data.id,
      dual_id: r.data.dual_id,
      severidad,
      total_matches: r.data.total_matches,
      matches: r.data.matches,
      ...clasificacion,
      ...vigencia,
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
      segmento_id: segmento.data.id,
      segmento_nombre: segmento.data.nombre,
    },
  };
}

/** Las columnas de clasificación que se escriben junto a la consulta. */
export type ClasificacionPersistida = {
  tier_catalogo_version: number | null;
  tier_maximo: string | null;
  tier_sin_clasificar: boolean;
  tier_fuentes_sin_clasificar: string[] | null;
  tier_hallazgos: number | null;
  tier_duplicados: number | null;
  tier_opera: boolean | null;
};

/**
 * Clasifica las coincidencias para guardarlas junto a la consulta.
 *
 * Tres caminos de fallo, y los tres caen del mismo lado:
 *
 *   - Sin catálogo sembrado: no se clasifica y se marca `tier_sin_clasificar`.
 *   - El catálogo no resuelve alguna fuente (C4): se clasifica y se marca igual.
 *   - La verificación de cero supresión falla (C3): se DESCARTA la clasificación
 *     entera y se marca igual.
 *
 * `tier_sin_clasificar` es lo que enruta al canal de mayor exigencia. Que los
 * tres caminos terminen ahí no es pereza: los tres significan lo mismo, que no
 * sabemos qué es lo que la fuente devolvió, y ante esa duda el lado correcto es
 * el que exige más.
 *
 * Nunca lanza. La consulta ya se pagó contra la cuenta del cliente: perderla por
 * un problema de clasificación sería cambiar un dato incompleto por ninguno.
 */
async function clasificarParaGuardar(
  matches: InformaMatch[] | null | undefined,
): Promise<ClasificacionPersistida> {
  const sinClasificacion: ClasificacionPersistida = {
    tier_catalogo_version: null,
    tier_maximo: null,
    tier_sin_clasificar: true,
    tier_fuentes_sin_clasificar: null,
    tier_hallazgos: null,
    tier_duplicados: null,
    tier_opera: null,
  };

  // Una consulta sin coincidencias no tiene nada que clasificar, y marcarla
  // como sin clasificar sería mandar al canal de mayor exigencia a una
  // contraparte que salió limpia.
  if (!matches || matches.length === 0) {
    return { ...sinClasificacion, tier_sin_clasificar: false };
  }

  let catalogo;
  try {
    catalogo = await cargarCatalogoTierVigente();
  } catch {
    return sinClasificacion;
  }
  if (!catalogo) return sinClasificacion;

  const clasificada = clasificarConsulta(matches, catalogo);

  // C3: si la clasificación perdió una coincidencia, no se guarda. Un conteo que
  // esconde un hallazgo es peor que no tener conteo.
  if (!verificarCeroSupresion(clasificada, matches.length)) {
    console.error(
      '[tier] cero_supresion_violada',
      { devueltas: matches.length, hallazgos: clasificada.hallazgos.length, duplicados: clasificada.duplicados.length },
    );
    return { ...sinClasificacion, tier_catalogo_version: catalogo.version };
  }

  return {
    tier_catalogo_version: catalogo.version,
    tier_maximo: clasificada.tierMaximo,
    tier_sin_clasificar: clasificada.haySinClasificar,
    tier_fuentes_sin_clasificar: clasificada.fuentesSinClasificar.length > 0
      ? clasificada.fuentesSinClasificar
      : null,
    tier_hallazgos: clasificada.hallazgos.length,
    tier_duplicados: clasificada.duplicados.length,
    tier_opera: clasificada.opera,
  };
}

/**
 * Traduce la clasificación guardada a la vigencia de la consulta (R2).
 *
 * Se apoya en `tier_maximo` y `tier_sin_clasificar` en vez de volver a clasificar:
 * la fila y su vigencia tienen que hablar de lo mismo. Si alguna vez difieren,
 * el historial diría un tier y una fecha calculada con otro.
 *
 * Nunca lanza. Una consulta ya pagada no se pierde porque falló el cálculo de
 * una fecha; se guarda sin vigencia, que la pantalla muestra como tal.
 */
async function calcularVigenciaParaGuardar(
  workspaceId: string,
  clasificacion: ClasificacionPersistida,
): Promise<{ vigente_hasta: string | null; vigencia_meses: number | null; vigencia_nivel: string | null }> {
  try {
    const config = await cargarConfigPeriodicidad(workspaceId);

    // `tiersPresentes` reducido a lo que la fila guarda. Se agrega
    // `sin_clasificar` cuando la marca está puesta aunque el tier máximo sea
    // otro: la fuente desconocida tiene que poder ganar la vigencia más corta.
    const presentes: TierResuelto[] = [];
    if (clasificacion.tier_maximo) presentes.push(clasificacion.tier_maximo as TierResuelto);
    if (clasificacion.tier_sin_clasificar && !presentes.includes('sin_clasificar')) {
      presentes.push('sin_clasificar');
    }

    const v = calcularVigencia(
      todayBogotaISO(),
      presentes,
      config,
      clasificacion.tier_opera === true,
    );
    return {
      vigente_hasta: v.vigente_hasta,
      vigencia_meses: v.meses,
      vigencia_nivel: v.nivel,
    };
  } catch {
    return { vigente_hasta: null, vigencia_meses: null, vigencia_nivel: null };
  }
}

/**
 * El segmento de una consulta nueva es obligatorio, tiene que existir en el
 * catálogo del workspace y tiene que estar activo. Los tres casos fallan con
 * mensaje propio: "no lo mandaste", "no existe" y "está desactivado" mandan a
 * lugares distintos.
 */
async function resolverSegmentoParaConsulta(
  workspaceId: string,
  segmentoId: string | null,
): Promise<Result<ComplianceSegmento>> {
  if (!segmentoId) return { ok: false, error: 'segmento_requerido' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_segmentos')
    .select('id, nombre, universo, activo, orden')
    .eq('id', segmentoId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'segmento_no_encontrado' };

  const seg = data as ComplianceSegmento;
  if (!seg.activo) {
    return { ok: false, error: `segmento_inactivo ("${seg.nombre}" está desactivado en el catálogo)` };
  }
  return { ok: true, data: seg };
}

export async function listarHistorialDual(
  filtros: DualHistorialFiltros = {},
): Promise<Result<DualHistorialItem[]>> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // El catalogo completo (activos e inactivos): una consulta vieja puede apuntar
  // a un segmento ya desactivado y su nombre tiene que seguir apareciendo.
  const catalogo = await listarSegmentos({ incluirInactivos: true });
  if (!catalogo.ok) return { ok: false, error: catalogo.error };
  const segMap = new Map(catalogo.data.map((sg) => [sg.id, sg]));

  // Un filtro por un segmento que no existe devolveria cero filas, que en
  // pantalla es identico a "este segmento no tiene consultas". Se corta aqui.
  if (filtros.segmento_id && filtros.segmento_id !== FILTRO_SIN_SEGMENTO) {
    if (!segMap.has(filtros.segmento_id)) {
      return { ok: false, error: 'segmento_desconocido (no esta en el catalogo del workspace)' };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = svc
    .from('consultas_listas_dual')
    .select(
      'id, dual_id, tipo, tipo_persona, nombre_consultado, documento_tipo, documento_numero, severidad, total_matches, matches, titulo_lote, lote_id, error_mensaje, created_at, created_by, segmento_id, vigente_hasta',
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(filtros.limite ?? 200);

  if (filtros.severidad) q = q.eq('severidad', filtros.severidad);
  if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
  if (filtros.lote_id) q = q.eq('lote_id', filtros.lote_id);
  if (filtros.fecha_desde) q = q.gte('created_at', filtros.fecha_desde);
  if (filtros.fecha_hasta) q = q.lte('created_at', `${filtros.fecha_hasta}T23:59:59.999Z`);
  if (filtros.segmento_id === FILTRO_SIN_SEGMENTO) q = q.is('segmento_id', null);
  else if (filtros.segmento_id) q = q.eq('segmento_id', filtros.segmento_id);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  // Resolver usuario que realizo cada consulta (trazabilidad — mostrar SIEMPRE quien consulto)
  const userMap = await resolverNombresUsuarios(svc, (data ?? []).map((r: { created_by: string | null }) => r.created_by));
  const items: DualHistorialItem[] = (data ?? []).map((r: Record<string, unknown>) => {
    const segId = (r.segmento_id as string | null) ?? null;
    const seg = segId ? segMap.get(segId) : undefined;
    return {
      ...(r as unknown as DualHistorialItem),
      consultado_por: r.created_by ? (userMap.get(r.created_by as string) ?? null) : null,
      segmento_id: segId,
      segmento_nombre: seg?.nombre ?? null,
      segmento_universo: seg?.universo ?? null,
    };
  });

  return { ok: true, data: items };
}

// ─── Carga masiva fila por fila: preparacion local del XLSX ───────────────

export type DualFilaPreparada = {
  posicion: number;
  input: DualConsultaInput;
  error: string | null;
};

export type DualLotePreparado = {
  lote_id: string;
  total: number;
  filas: DualFilaPreparada[];
};

const LOTE_LIMITE = 500;

/**
 * Contrato de la plantilla. Lo consumen las DOS puntas —
 * `generarPlantillaLoteDual` (que emite el archivo) y `prepararLoteDual` (que lo
 * parsea)— para que no puedan divergir.
 */
const HOJA_DATOS = 'Consultas';
const COLUMNAS_PLANTILLA = ['tipo', 'identificacion', 'nombre', 'segmento'] as const;

const ERROR_CATALOGO_VACIO =
  'catalogo_segmentos_vacio (el oficial de cumplimiento debe crear al menos un segmento en Compliance -> Catalogo de segmentos)';

function normalizarTipo(v: unknown): DualTipo | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (t === 'natural' || t === 'persona natural') return 'natural';
  if (t === 'juridica' || t === 'jurídica' || t === 'persona juridica' || t === 'persona jurídica')
    return 'juridica';
  return null;
}

function asStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Lee el XLSX subido por el usuario y devuelve filas validadas listas para
 * consultar fila por fila. NO golpea metrik-valida — solo parsea.
 *
 * Formato esperado de la plantilla (hoja de datos, la que emite
 * `generarPlantillaLoteDual`):
 *   columna A: tipo            (natural | juridica)
 *   columna B: identificacion  (opcional)
 *   columna C: nombre          (opcional)
 *   columna D: segmento        (obligatorio, del catalogo del workspace)
 * Al menos uno de los dos (identificacion o nombre) es obligatorio.
 *
 * Una fila con segmento vacio o desconocido queda marcada como error de fila:
 * NO se consulta (cada consulta es facturable) y el motivo viaja hasta el
 * historial para que se sepa que celda corregir.
 */
export async function prepararLoteDual(
  formData: FormData,
): Promise<Result<DualLotePreparado>> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  const file = formData.get('archivo');
  if (!(file instanceof File)) return { ok: false, error: 'archivo_requerido' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'archivo_muy_grande' };

  const catalogo = await listarSegmentos();
  if (!catalogo.ok) return { ok: false, error: catalogo.error };
  if (catalogo.data.length === 0) return { ok: false, error: ERROR_CATALOGO_VACIO };

  const porClave = new Map<string, ComplianceSegmento>();
  for (const seg of catalogo.data) porClave.set(claveSegmento(seg.nombre), seg);
  const nombresValidos = catalogo.data.map((seg) => seg.nombre).join(' | ');

  const buffer = Buffer.from(await file.arrayBuffer());

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return { ok: false, error: 'xlsx_invalido' };
  }

  // La plantilla trae una segunda hoja de instrucciones: se busca la de datos
  // por nombre y solo si no esta se cae a la primera (archivos viejos o propios).
  const sheetName = workbook.SheetNames.includes(HOJA_DATOS)
    ? HOJA_DATOS
    : workbook.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'xlsx_sin_hojas' };

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  if (rows.length === 0) return { ok: false, error: 'xlsx_vacio' };
  if (rows.length > LOTE_LIMITE) {
    return { ok: false, error: `xlsx_excede_limite_${LOTE_LIMITE}` };
  }

  const filas: DualFilaPreparada[] = rows.map((row, i) => {
    const posicion = i + 2; // fila 1 = header

    // Acepta keys 'tipo'/'Tipo'/'TIPO' (sheet_to_json usa el header tal cual)
    const tipoRaw = row.tipo ?? row.Tipo ?? row.TIPO;
    const identificacion = asStr(row.identificacion ?? row.Identificacion ?? row.IDENTIFICACION);
    const nombre = asStr(row.nombre ?? row.Nombre ?? row.NOMBRE);
    const segmentoRaw = asStr(row.segmento ?? row.Segmento ?? row.SEGMENTO);

    const segmento = segmentoRaw ? porClave.get(claveSegmento(segmentoRaw)) : undefined;
    const segmentoId = segmento?.id ?? null;

    const tipo = normalizarTipo(tipoRaw);
    if (!tipo) {
      return {
        posicion,
        input: { tipo: 'natural', segmento_id: segmentoId },
        error: 'tipo_invalido (esperado: natural | juridica)',
      };
    }
    if (!identificacion && !nombre) {
      return {
        posicion,
        input: { tipo, segmento_id: segmentoId },
        error: 'fila_sin_identificacion_ni_nombre',
      };
    }
    if (!segmentoRaw) {
      return {
        posicion,
        input: { tipo, segmento_id: null },
        error: `fila_sin_segmento (columna 'segmento' obligatoria - esperado: ${nombresValidos})`,
      };
    }
    if (!segmento) {
      return {
        posicion,
        input: { tipo, segmento_id: null },
        error: `segmento_invalido "${segmentoRaw}" (esperado: ${nombresValidos})`,
      };
    }

    return {
      posicion,
      input: {
        tipo,
        segmento_id: segmento.id,
        ...(identificacion ? { identificacion } : {}),
        ...(nombre ? { nombre } : {}),
      },
      error: null,
    };
  });

  return {
    ok: true,
    data: {
      lote_id: randomUUID(),
      total: filas.length,
      filas,
    },
  };
}
