'use server';

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import type {
  ConfigPersistida,
  EntradaBitacora,
  PesosContrapartes,
  PesosEmpleados,
  PresetSegmentacion,
  UmbralesUniverso,
} from '@/lib/valida/segmentacion-presets';
import {
  PRESETS,
  UMBRALES_DEFAULT,
  pesosSumanUno,
} from '@/lib/valida/segmentacion-presets';

// ─── Helpers ──────────────────────────────────────────────────────────────

function defaultConfig(): ConfigPersistida {
  const base = PRESETS.sector_real_general;
  return {
    preset: base.preset,
    pesos_contrapartes: base.pesos_contrapartes,
    pesos_empleados: base.pesos_empleados,
    umbrales_contrapartes: base.umbrales_contrapartes,
    umbrales_empleados: base.umbrales_empleados,
    disclaimer_aceptado: false,
    version: 1,
    aplicada_at: null,
    aplicada_por: null,
  };
}

// ─── Server actions ───────────────────────────────────────────────────────

export async function getSegmentacionConfig(): Promise<
  { ok: true; config: ConfigPersistida } | { ok: false; error: string }
> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('valida_segmentacion_config')
    .select('preset, pesos_contrapartes, pesos_empleados, umbrales_contrapartes, umbrales_empleados, disclaimer_aceptado, version, aplicada_at, aplicada_por')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  if (!data) {
    return { ok: true, config: defaultConfig() };
  }

  // Si umbrales vienen vacíos (config recién creada), llenar con defaults
  const umbralesC = (data.umbrales_contrapartes && Object.keys(data.umbrales_contrapartes).length > 0)
    ? data.umbrales_contrapartes
    : UMBRALES_DEFAULT;
  const umbralesE = (data.umbrales_empleados && Object.keys(data.umbrales_empleados).length > 0)
    ? data.umbrales_empleados
    : UMBRALES_DEFAULT;

  return {
    ok: true,
    config: {
      preset: data.preset as PresetSegmentacion,
      pesos_contrapartes: data.pesos_contrapartes as PesosContrapartes,
      pesos_empleados: data.pesos_empleados as PesosEmpleados,
      umbrales_contrapartes: umbralesC as UmbralesUniverso,
      umbrales_empleados: umbralesE as UmbralesUniverso,
      disclaimer_aceptado: data.disclaimer_aceptado,
      version: data.version,
      aplicada_at: data.aplicada_at,
      aplicada_por: data.aplicada_por,
    },
  };
}

export async function aplicarSegmentacionConfig(input: {
  preset: PresetSegmentacion;
  pesos_contrapartes: PesosContrapartes;
  pesos_empleados: PesosEmpleados;
  umbrales_contrapartes: UmbralesUniverso;
  umbrales_empleados: UmbralesUniverso;
  disclaimer_aceptado: boolean;
  razon_cambio?: string | null;
}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  if (!input.disclaimer_aceptado) {
    return { ok: false, error: 'disclaimer_obligatorio' };
  }
  if (!pesosSumanUno(input.pesos_contrapartes)) {
    return { ok: false, error: 'pesos_contrapartes_no_suman_uno' };
  }
  if (!pesosSumanUno(input.pesos_empleados)) {
    return { ok: false, error: 'pesos_empleados_no_suman_uno' };
  }
  if (input.umbrales_contrapartes.alto_min <= input.umbrales_contrapartes.medio_min) {
    return { ok: false, error: 'umbrales_contrapartes_invertidos' };
  }
  if (input.umbrales_empleados.alto_min <= input.umbrales_empleados.medio_min) {
    return { ok: false, error: 'umbrales_empleados_invertidos' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Obtener versión actual para incrementar
  const { data: existing } = await svc
    .from('valida_segmentacion_config')
    .select('version')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  const nuevaVersion = (existing?.version ?? 0) + 1;

  // Upsert configuración
  const { error: errUp } = await svc
    .from('valida_segmentacion_config')
    .upsert(
      {
        workspace_id: workspaceId,
        preset: input.preset,
        pesos_contrapartes: input.pesos_contrapartes,
        pesos_empleados: input.pesos_empleados,
        umbrales_contrapartes: input.umbrales_contrapartes,
        umbrales_empleados: input.umbrales_empleados,
        disclaimer_aceptado: true,
        version: nuevaVersion,
        aplicada_at: new Date().toISOString(),
        aplicada_por: userId,
      },
      { onConflict: 'workspace_id' },
    );

  if (errUp) return { ok: false, error: errUp.message };

  // Insertar bitácora
  const { error: errBit } = await svc
    .from('valida_segmentacion_bitacora')
    .insert({
      workspace_id: workspaceId,
      version: nuevaVersion,
      preset: input.preset,
      pesos_contrapartes: input.pesos_contrapartes,
      pesos_empleados: input.pesos_empleados,
      umbrales_contrapartes: input.umbrales_contrapartes,
      umbrales_empleados: input.umbrales_empleados,
      aplicada_por: userId,
      razon_cambio: input.razon_cambio ?? null,
    });

  if (errBit) return { ok: false, error: errBit.message };

  return { ok: true, version: nuevaVersion };
}

export async function listarBitacoraSegmentacion(): Promise<
  { ok: true; entradas: EntradaBitacora[] } | { ok: false; error: string }
> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('valida_segmentacion_bitacora')
    .select('id, version, preset, pesos_contrapartes, pesos_empleados, umbrales_contrapartes, umbrales_empleados, aplicada_at, aplicada_por, razon_cambio')
    .eq('workspace_id', workspaceId)
    .order('aplicada_at', { ascending: false })
    .limit(50);

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    entradas: (data ?? []) as EntradaBitacora[],
  };
}
