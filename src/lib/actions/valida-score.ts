'use server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import { calcularScoreNegocio, persistirScore } from '@/lib/valida/calculo-score';
import type { FactoresAplicados } from '@/lib/valida/calculo-score';

export type DatosSarlaftInput = {
  universo: 'contraparte' | 'empleado';
  pais_codigo_iso?: string | null;
  municipio_divipola?: string | null;
  ciiu_codigo?: string | null;
  calidad_verificado?: string | null;
  forma_operacion?: string | null;
  tipo_contrato?: string | null;
  criticidad_cargo?: string | null;
  endeudamiento?: string | null;
  notas?: string | null;
};

export type DatosSarlaftNegocio = DatosSarlaftInput & {
  actualizado_at: string;
};

export type ScoreNegocioItem = {
  negocio_id: string;
  universo: 'contraparte' | 'empleado';
  puntaje: number;
  nivel: 'alto' | 'medio' | 'bajo';
  factores_aplicados: FactoresAplicados;
  proxima_revision: string | null;
  actualizado_at: string;
};

export async function getDatosSarlaft(
  negocioId: string,
): Promise<{ ok: true; datos: DatosSarlaftNegocio | null } | { ok: false; error: string }> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('valida_sarlaft_datos_negocio')
    .select('universo, pais_codigo_iso, municipio_divipola, ciiu_codigo, calidad_verificado, forma_operacion, tipo_contrato, criticidad_cargo, endeudamiento, notas, actualizado_at')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, datos: (data ?? null) as DatosSarlaftNegocio | null };
}

export async function guardarDatosSarlaft(
  negocioId: string,
  input: DatosSarlaftInput,
): Promise<{ ok: true; score: ScoreNegocioItem | null } | { ok: false; error: string }> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { error } = await svc.from('valida_sarlaft_datos_negocio').upsert(
    {
      negocio_id: negocioId,
      workspace_id: workspaceId,
      universo: input.universo,
      pais_codigo_iso: input.pais_codigo_iso ?? null,
      municipio_divipola: input.municipio_divipola ?? null,
      ciiu_codigo: input.ciiu_codigo ?? null,
      calidad_verificado: input.calidad_verificado ?? null,
      forma_operacion: input.forma_operacion ?? null,
      tipo_contrato: input.tipo_contrato ?? null,
      criticidad_cargo: input.criticidad_cargo ?? null,
      endeudamiento: input.endeudamiento ?? null,
      notas: input.notas ?? null,
      actualizado_at: new Date().toISOString(),
      actualizado_por: user?.id ?? null,
    },
    { onConflict: 'negocio_id' },
  );

  if (error) return { ok: false, error: error.message };

  // Recalcular score
  const calc = await calcularScoreNegocio({ workspaceId, negocioId });
  if (!calc.ok) {
    return { ok: true, score: null }; // Datos guardados pero score no se pudo calcular
  }
  await persistirScore({
    workspaceId,
    negocioId,
    universo: input.universo,
    resultado: calc.resultado,
  });

  return {
    ok: true,
    score: {
      negocio_id: negocioId,
      universo: input.universo,
      puntaje: calc.resultado.puntaje,
      nivel: calc.resultado.nivel,
      factores_aplicados: calc.resultado.factores_aplicados,
      proxima_revision: calc.resultado.proxima_revision,
      actualizado_at: new Date().toISOString(),
    },
  };
}

export async function getScoreNegocio(
  negocioId: string,
): Promise<{ ok: true; score: ScoreNegocioItem | null } | { ok: false; error: string }> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('valida_score_negocio')
    .select('negocio_id, universo, puntaje, nivel, factores_aplicados, proxima_revision, actualizado_at')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, score: (data ?? null) as ScoreNegocioItem | null };
}

export async function recalcularScoreNegocio(
  negocioId: string,
): Promise<{ ok: true; score: ScoreNegocioItem | null } | { ok: false; error: string }> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  const calc = await calcularScoreNegocio({ workspaceId, negocioId });
  if (!calc.ok) return { ok: false, error: calc.error };

  // Necesitamos universo del datos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: datos } = await svc
    .from('valida_sarlaft_datos_negocio')
    .select('universo')
    .eq('negocio_id', negocioId)
    .maybeSingle();

  if (!datos) return { ok: false, error: 'datos_sarlaft_no_configurados' };

  await persistirScore({
    workspaceId,
    negocioId,
    universo: datos.universo,
    resultado: calc.resultado,
  });

  return {
    ok: true,
    score: {
      negocio_id: negocioId,
      universo: datos.universo,
      puntaje: calc.resultado.puntaje,
      nivel: calc.resultado.nivel,
      factores_aplicados: calc.resultado.factores_aplicados,
      proxima_revision: calc.resultado.proxima_revision,
      actualizado_at: new Date().toISOString(),
    },
  };
}

export type DistribucionUniverso = {
  alto: number;
  medio: number;
  bajo: number;
  total: number;
};

export type DistribucionWorkspace = {
  contrapartes: DistribucionUniverso;
  empleados: DistribucionUniverso;
};

export async function getDistribucionSegmentacion(): Promise<
  { ok: true; distribucion: DistribucionWorkspace } | { ok: false; error: string }
> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('valida_score_negocio')
    .select('universo, nivel')
    .eq('workspace_id', workspaceId);

  if (error) return { ok: false, error: error.message };

  const result: DistribucionWorkspace = {
    contrapartes: { alto: 0, medio: 0, bajo: 0, total: 0 },
    empleados: { alto: 0, medio: 0, bajo: 0, total: 0 },
  };

  for (const row of (data ?? []) as Array<{ universo: 'contraparte' | 'empleado'; nivel: 'alto' | 'medio' | 'bajo' }>) {
    const bucket = row.universo === 'contraparte' ? result.contrapartes : result.empleados;
    bucket[row.nivel] += 1;
    bucket.total += 1;
  }

  return { ok: true, distribucion: result };
}
