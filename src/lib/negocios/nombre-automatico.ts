/**
 * El nombre automático de un negocio desde la app (ficha, «Pegar conversación», creación). La regla y el cálculo viven
 * en `supabase/functions/_shared/nombre-viaje.ts`, compartidos con el bot: un solo criterio para los dos lados.
 */

import {
  leerPlantillaNombre, nombreSegunPlantilla, renombrarSegunPlantilla,
} from '../../../supabase/functions/_shared/nombre-viaje.ts'

export { leerPlantillaNombre, nombreSegunPlantilla }

/** Los campos cuyo valor cambió entre dos `data` de un bloque. Pura. */
export function camposCambiados(antes: Record<string, unknown> | null, despues: Record<string, unknown> | null): string[] {
  const a = antes ?? {}
  const d = despues ?? {}
  return [...new Set([...Object.keys(a), ...Object.keys(d)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(d[k]))
}

/**
 * Rehace el nombre si la línea tiene regla, el nombre sigue siendo el automático y cambió alguno de sus campos. No
 * lanza ni frena el guardado que lo pidió.
 */
export async function renombrarNegocioSiAplica(supabase: unknown, negocioId: string, cambiados?: string[]): Promise<string | null> {
  if (cambiados && cambiados.length === 0) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renombrarSegunPlantilla(supabase as any, negocioId, cambiados)
}
