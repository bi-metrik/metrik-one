'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import {
  claveSegmento,
  puedeConfigurarSegmentos,
  SEGMENTO_NOMBRE_MAX,
  type ComplianceSegmento,
} from '@/lib/compliance/segmentos';
import {
  esUniversoSegmentacion,
  type UniversoSegmentacion,
} from '@/lib/valida/segmentacion-presets';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const COLUMNAS = 'id, nombre, universo, activo, orden';

/**
 * Lee el catálogo del workspace autenticado.
 *
 * Uso interno del módulo (`compliance-dual.ts` lo llama para resolver el
 * segmento de una consulta). Devuelve tanto activos como inactivos cuando se
 * pide: la resolución de consultas históricas y del ABM necesita ver los dos.
 */
export async function listarSegmentos(
  opciones: { incluirInactivos?: boolean } = {},
): Promise<Result<ComplianceSegmento[]>> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = svc
    .from('compliance_segmentos')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });

  if (!opciones.incluirInactivos) q = q.eq('activo', true);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  return { ok: true, data: (data ?? []) as ComplianceSegmento[] };
}

// ─── ABM (solo oficial de cumplimiento) ───────────────────────────────────

async function guardOficial(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: string }
> {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeConfigurarSegmentos(role)) {
    return { ok: false, error: 'forbidden_solo_oficial_cumplimiento' };
  }
  return { ok: true, workspaceId };
}

function validarNombre(nombre: string): string | null {
  const limpio = nombre.trim();
  if (limpio.length === 0) return 'nombre_requerido';
  if (limpio.length > SEGMENTO_NOMBRE_MAX) {
    return `nombre_muy_largo (máximo ${SEGMENTO_NOMBRE_MAX} caracteres)`;
  }
  return null;
}

export async function crearSegmento(input: {
  nombre: string;
  universo: UniversoSegmentacion;
  orden?: number;
}): Promise<Result<ComplianceSegmento>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const errNombre = validarNombre(input.nombre);
  if (errNombre) return { ok: false, error: errNombre };
  if (!esUniversoSegmentacion(input.universo)) {
    return { ok: false, error: 'universo_invalido (esperado: contraparte | empleado)' };
  }

  const nombre = input.nombre.trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Choque por clave normalizada: la unique de la base es sobre el literal, así
  // que "Empleado" y "empleados " pasarían las dos y la columna del Excel dejaría
  // de resolver de forma determinística. Se rechaza aquí, con mensaje.
  const { data: existentes, error: errList } = await svc
    .from('compliance_segmentos')
    .select('id, nombre')
    .eq('workspace_id', guard.workspaceId);
  if (errList) return { ok: false, error: errList.message };

  const clave = claveSegmento(nombre);
  const choque = (existentes ?? []).find(
    (s: { nombre: string }) => claveSegmento(s.nombre) === clave,
  );
  if (choque) {
    return { ok: false, error: `segmento_duplicado ("${choque.nombre}" ya existe)` };
  }

  const orden = Number.isFinite(input.orden) ? Number(input.orden) : (existentes ?? []).length + 1;

  const { data, error } = await svc
    .from('compliance_segmentos')
    .insert({
      workspace_id: guard.workspaceId,
      nombre,
      universo: input.universo,
      activo: true,
      orden,
    })
    .select(COLUMNAS)
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as ComplianceSegmento };
}

export async function actualizarSegmento(input: {
  id: string;
  nombre?: string;
  universo?: UniversoSegmentacion;
  activo?: boolean;
  orden?: number;
}): Promise<Result<ComplianceSegmento>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {};

  if (input.nombre !== undefined) {
    const errNombre = validarNombre(input.nombre);
    if (errNombre) return { ok: false, error: errNombre };
    patch.nombre = input.nombre.trim();
  }
  if (input.universo !== undefined) {
    if (!esUniversoSegmentacion(input.universo)) {
      return { ok: false, error: 'universo_invalido (esperado: contraparte | empleado)' };
    }
    patch.universo = input.universo;
  }
  if (input.activo !== undefined) patch.activo = input.activo;
  if (input.orden !== undefined) patch.orden = input.orden;

  if (Object.keys(patch).length === 0) return { ok: false, error: 'nada_que_actualizar' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  if (patch.nombre) {
    const { data: existentes, error: errList } = await svc
      .from('compliance_segmentos')
      .select('id, nombre')
      .eq('workspace_id', guard.workspaceId);
    if (errList) return { ok: false, error: errList.message };

    const clave = claveSegmento(patch.nombre as string);
    const choque = (existentes ?? []).find(
      (s: { id: string; nombre: string }) => s.id !== input.id && claveSegmento(s.nombre) === clave,
    );
    if (choque) {
      return { ok: false, error: `segmento_duplicado ("${choque.nombre}" ya existe)` };
    }
  }

  // `.eq('workspace_id')` no sobra aunque venga el id: el service client bypassa
  // RLS, así que el aislamiento de workspace hay que ponerlo a mano.
  const { data, error } = await svc
    .from('compliance_segmentos')
    .update(patch)
    .eq('id', input.id)
    .eq('workspace_id', guard.workspaceId)
    .select(COLUMNAS)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'segmento_no_encontrado' };
  return { ok: true, data: data as ComplianceSegmento };
}

/**
 * Borra un segmento — solo si ninguna consulta lo referencia.
 *
 * Si tiene consultas, se rechaza con el conteo: borrarlo destruiría la
 * trazabilidad de por qué se consultó a esa contraparte (y la FK es
 * `on delete restrict`, así que la base lo rechazaría igual pero con un mensaje
 * de Postgres que nadie entiende). El camino correcto es desactivarlo.
 */
export async function eliminarSegmento(id: string): Promise<Result<{ id: string }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { count, error: errCount } = await svc
    .from('consultas_listas_dual')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', guard.workspaceId)
    .eq('segmento_id', id);

  if (errCount) return { ok: false, error: errCount.message };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `segmento_en_uso (${count} consulta(s) lo referencian — desactívalo en vez de borrarlo)`,
    };
  }

  const { data, error } = await svc
    .from('compliance_segmentos')
    .delete()
    .eq('id', id)
    .eq('workspace_id', guard.workspaceId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'segmento_no_encontrado' };
  return { ok: true, data: { id: data.id as string } };
}
