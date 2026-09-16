import 'server-only';

/**
 * La configuración de periodicidad de un workspace, en la forma que consume la regla pura.
 *
 * Recibe el workspace por parámetro porque la usan dos contextos: la consulta que hace una
 * persona (el workspace sale de su sesión) y el barrido de R3, que corre desde un cron sin
 * sesión. Por eso NO vive en un archivo `'use server'`: ahí era un endpoint que, con un id
 * cualquiera, devolvía la política de otro workspace sin pedir cuenta.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { DEFAULT_SUGERIDO, esNivel, type ConfigPeriodicidad } from './periodicidad';

export async function cargarConfigPeriodicidad(workspaceId: string): Promise<ConfigPeriodicidad> {
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
