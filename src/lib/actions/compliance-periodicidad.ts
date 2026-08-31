'use server';

/**
 * R2 — configuración de periodicidad de revalidación.
 *
 * La política es del obligado, no de MéTRIK: el cuadro 12/6/3 es criterio del
 * oficial de cumplimiento y no tiene fuente normativa verificada (dictamen Lucía
 * 2026-08-24). Lo que MéTRIK afirma es qué ES la fuente (el tier); cuántos meses
 * dura la vigencia lo decide el cliente.
 *
 * NINGUNA función de este archivo llama a Informa ni a Valida.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
import { getWorkspace } from './get-workspace';
import {
  DEFAULT_SUGERIDO,
  NIVELES,
  esNivel,
  validarMeses,
  type ConfigPeriodicidad,
  type NivelPeriodicidad,
} from '@/lib/compliance/periodicidad';
import { puedeLiberarContrapartes } from '@/lib/compliance/liberaciones';

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

export type FilaPeriodicidad = {
  nivel: NivelPeriodicidad;
  meses: number;
  /** El workspace nunca lo guardó: se está mostrando la sugerencia. */
  es_sugerido: boolean;
  actualizado_at: string | null;
};

/**
 * La configuración del workspace, completada con el default sugerido para los
 * niveles que nadie ha tocado.
 *
 * Se completa a propósito en vez de devolver huecos: un nivel sin meses deja sin
 * vigencia a toda consulta que lo traiga, o sea la saca del barrido en silencio.
 * Cada fila dice si es lo que el oficial guardó o lo que le estamos sugiriendo.
 */
export async function listarPeriodicidad(): Promise<Result<FilaPeriodicidad[]>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_periodicidad_config')
    .select('nivel, meses, updated_at')
    .eq('workspace_id', guard.workspaceId);

  if (error) return { ok: false, error: error.message };

  const guardadas = new Map<string, { meses: number; updated_at: string }>();
  for (const f of (data ?? []) as Array<{ nivel: string; meses: number; updated_at: string }>) {
    guardadas.set(f.nivel, { meses: f.meses, updated_at: f.updated_at });
  }

  return {
    ok: true,
    data: NIVELES.map((nivel) => {
      const g = guardadas.get(nivel);
      return {
        nivel,
        meses: g?.meses ?? DEFAULT_SUGERIDO[nivel],
        es_sugerido: !g,
        actualizado_at: g?.updated_at ?? null,
      };
    }),
  };
}

/** La misma configuración, en la forma que consume la regla pura. */
export async function cargarConfigPeriodicidad(
  workspaceId: string,
): Promise<ConfigPeriodicidad> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data } = await svc
    .from('compliance_periodicidad_config')
    .select('nivel, meses')
    .eq('workspace_id', workspaceId);

  const config: Record<string, number> = { ...DEFAULT_SUGERIDO };
  for (const f of (data ?? []) as Array<{ nivel: string; meses: number }>) {
    if (esNivel(f.nivel)) config[f.nivel] = f.meses;
  }
  return config as ConfigPeriodicidad;
}

/**
 * Guarda los meses de un nivel.
 *
 * No hay borrado: volver al sugerido es guardar el número sugerido. Un "borrar"
 * dejaría una fila sin política y la vigencia de esas consultas dependería de un
 * default que el oficial no ve.
 */
export async function guardarPeriodicidad(input: {
  nivel: string;
  meses: unknown;
}): Promise<Result<{ nivel: NivelPeriodicidad; meses: number }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  if (!esNivel(input.nivel)) return { ok: false, error: 'nivel_invalido' };
  const errorMeses = validarMeses(input.meses);
  if (errorMeses) return { ok: false, error: errorMeses };
  const meses = Number(input.meses);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc
    .from('compliance_periodicidad_config')
    .upsert(
      {
        workspace_id: guard.workspaceId,
        nivel: input.nivel,
        meses,
        actualizado_por: guard.userId,
      },
      { onConflict: 'workspace_id,nivel' },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { nivel: input.nivel, meses } };
}
