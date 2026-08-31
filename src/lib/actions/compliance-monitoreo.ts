'use server';

/**
 * R3 — pantalla del motor de monitoreo: adopción, tope, horizonte y bitácora.
 *
 * Todo pasa por el rol del oficial de cumplimiento. El motor en sí vive en
 * `@/lib/compliance/barrido` porque también lo llama un cron sin sesión; acá está
 * lo único que un cron no puede hacer: decidir que quien pide es quien puede.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
import { getWorkspace } from './get-workspace';
import { todayBogotaISO } from '@/lib/dates/bogota';
import { puedeLiberarContrapartes } from '@/lib/compliance/liberaciones';
import {
  DEFAULT_HORIZONTE_RECHAZADAS_MESES,
  inicioDePeriodo,
  modoDelBarrido,
  validarCupo,
  validarHorizonte,
  type ModoBarrido,
} from '@/lib/compliance/monitoreo';
import { ejecutarBarrido, type ResumenBarrido } from '@/lib/compliance/barrido';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function guardOficial(): Promise<
  { ok: true; workspaceId: string; userId: string | null } | { ok: false; error: string }
> {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeLiberarContrapartes(role)) {
    return { ok: false, error: 'forbidden_solo_oficial_cumplimiento' };
  }
  const { user } = await getCachedUser();
  return { ok: true, workspaceId, userId: user?.id ?? null };
}

export type FilaBarrido = {
  id: string;
  dia: string;
  modo: ModoBarrido;
  cupo_periodo: number | null;
  candidatos: number;
  ejecutadas: number;
  diferidas: number;
  con_delta: number;
  notificadas: number;
  fallidas: number;
  corte_por_tope: boolean;
  created_at: string;
};

export type EstadoMonitoreo = {
  /**
   * Tres estados, no dos. "No adoptado" no es lo mismo que "adoptado sin tope":
   * el primero es un workspace que nunca entró al motor, el segundo es uno que
   * entró y todavía no dijo cuánto puede gastar.
   */
  adoptado: boolean;
  modo: ModoBarrido;
  cupo_periodo: number | null;
  horizonte_rechazadas_meses: number;
  /** Lo que el motor lleva gastado este mes. No incluye consultas manuales. */
  consumidas_periodo: number;
  periodo_desde: string;
  ultimos_barridos: FilaBarrido[];
};

export async function estadoMonitoreo(): Promise<Result<EstadoMonitoreo>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { data: cfg, error } = await svc
    .from('compliance_monitoreo_config')
    .select('cupo_periodo, horizonte_rechazadas_meses')
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  const hoy = todayBogotaISO();
  const desde = inicioDePeriodo(hoy);

  const { data: barridos } = await svc
    .from('compliance_barridos')
    .select('id, dia, modo, cupo_periodo, candidatos, ejecutadas, diferidas, con_delta, notificadas, fallidas, corte_por_tope, created_at')
    .eq('workspace_id', guard.workspaceId)
    .order('created_at', { ascending: false })
    .limit(30);

  const { data: delPeriodo } = await svc
    .from('compliance_barridos')
    .select('ejecutadas')
    .eq('workspace_id', guard.workspaceId)
    .gte('dia', desde)
    .lte('dia', hoy);

  const consumidas = ((delPeriodo ?? []) as { ejecutadas: number | null }[])
    .reduce((a, f) => a + (f.ejecutadas ?? 0), 0);

  const config = {
    cupo_periodo: typeof cfg?.cupo_periodo === 'number' ? cfg.cupo_periodo : null,
    horizonte_rechazadas_meses:
      typeof cfg?.horizonte_rechazadas_meses === 'number'
        ? cfg.horizonte_rechazadas_meses
        : DEFAULT_HORIZONTE_RECHAZADAS_MESES,
  };

  return {
    ok: true,
    data: {
      adoptado: !!cfg,
      modo: cfg ? modoDelBarrido(config) : 'simulacion',
      ...config,
      consumidas_periodo: consumidas,
      periodo_desde: desde,
      ultimos_barridos: (barridos ?? []) as FilaBarrido[],
    },
  };
}

/**
 * Adopción: el workspace entra al motor.
 *
 * Es un acto explícito y no un efecto de abrir la pantalla. El concepto de
 * Emilio habla de "la configuración adoptada" en el §3, y adoptar algo sin
 * decirlo no es adoptarlo. Entra en simulación: el tope se pone después.
 */
export async function activarMonitoreo(): Promise<Result<{ adoptado: true }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc
    .from('compliance_monitoreo_config')
    .upsert(
      {
        workspace_id: guard.workspaceId,
        cupo_periodo: null,
        horizonte_rechazadas_meses: DEFAULT_HORIZONTE_RECHAZADAS_MESES,
        adoptado_por: guard.userId,
        adoptado_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id', ignoreDuplicates: true },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { adoptado: true } };
}

export async function guardarConfigMonitoreo(input: {
  cupo_periodo: number | null;
  horizonte_rechazadas_meses: number;
}): Promise<Result<{ guardado: true }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const errCupo = validarCupo(input.cupo_periodo);
  if (errCupo) return { ok: false, error: errCupo };
  const errHorizonte = validarHorizonte(input.horizonte_rechazadas_meses);
  if (errHorizonte) return { ok: false, error: errHorizonte };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc
    .from('compliance_monitoreo_config')
    .upsert(
      {
        workspace_id: guard.workspaceId,
        cupo_periodo: input.cupo_periodo,
        horizonte_rechazadas_meses: input.horizonte_rechazadas_meses,
        adoptado_por: guard.userId,
        adoptado_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { guardado: true } };
}

/**
 * Correr el barrido a mano. Mismo motor y mismo tope que el cron: un botón que
 * saltara el tope convertiría el tope en decoración.
 */
export async function correrBarridoAhora(): Promise<Result<ResumenBarrido>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;
  try {
    return { ok: true, data: await ejecutarBarrido(guard.workspaceId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'barrido_fallo' };
  }
}

export type ItemBarrido = {
  id: string;
  documento_tipo: string | null;
  documento_numero: string | null;
  nombre: string | null;
  etiqueta: string;
  motivo: string;
  matches_antes: number | null;
  matches_ahora: number | null;
  fuentes_nuevas: string[] | null;
  diferida: boolean;
  delta: boolean;
  notificada: boolean;
  habilita_reevaluacion: boolean;
  error_mensaje: string | null;
};

export async function detalleBarrido(barridoId: string): Promise<Result<ItemBarrido[]>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_barrido_items')
    .select('id, documento_tipo, documento_numero, nombre, etiqueta, motivo, matches_antes, matches_ahora, fuentes_nuevas, diferida, delta, notificada, habilita_reevaluacion, error_mensaje')
    // El workspace se filtra además del barrido: pedir un id ajeno no puede
    // devolver filas, aunque el id se adivine.
    .eq('workspace_id', guard.workspaceId)
    .eq('barrido_id', barridoId)
    .order('created_at', { ascending: true })
    .limit(2000);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as ItemBarrido[] };
}
