/**
 * «Marcar el viaje como Bloqueo» desde la cotización (Tatiana, 2026-11-03).
 *
 * La modalidad vive en el campo `modalidad_viaje` del bloque de datos que la declara («Condiciones del
 * viaje» en Trappvel, `bloqueo-modalidad.ts`). Desde la cotización ese bloque suele ser de una etapa
 * YA superada (Solicitud) y estar «completo»: el autosave normal (`actualizarBloqueData`) lo trata como
 * corrección y exige el opt-in `corregir_campos_gerencial`, que ese bloque no tiene. Por eso la escritura
 * es una acción estrecha (`modalidad-actions.ts`) que solo toca ESTE campo, con estos dos valores.
 *
 * Aquí lo puro: qué fila tiene el campo, qué valor guarda y la data que queda. Sin IO salvo la lectura.
 */

import { esValorBloqueo, SLUG_MODALIDAD } from './bloqueo-modalidad'

export type ValorModalidad = 'a_medida' | 'bloqueo'
export const VALORES_MODALIDAD: readonly ValorModalidad[] = ['a_medida', 'bloqueo']

export const MENSAJE_SIN_CAMPO_MODALIDAD = 'Este negocio no tiene el campo «Modalidad» en Condiciones del viaje.'

export function esValorModalidad(v: unknown): v is ValorModalidad {
  return typeof v === 'string' && (VALORES_MODALIDAD as readonly string[]).includes(v)
}

/** Una fila de `negocio_bloques` con su config, como la trae `leerCampoModalidad`. */
export interface FilaConConfig {
  id: string
  data: Record<string, unknown> | null
  bloque_configs: {
    config_extra?: { fields?: unknown } | null
    bloque_definitions?: { tipo?: string | null } | null
  } | null
}

export interface CampoModalidad {
  /** La fila de `negocio_bloques` donde vive el campo. */
  negocioBloqueId: string
  data: Record<string, unknown>
  /** `''` = sin elegir (cuenta como A medida). */
  valor: ValorModalidad | ''
}

/** ¿La config del bloque declara el campo `modalidad_viaje`? */
function declaraModalidad(fila: FilaConConfig): boolean {
  if ((fila.bloque_configs?.bloque_definitions?.tipo ?? null) !== 'datos') return false
  const fields = fila.bloque_configs?.config_extra?.fields
  return Array.isArray(fields) && fields.some(f => (f as { slug?: unknown } | null)?.slug === SLUG_MODALIDAD)
}

/** El valor guardado, normalizado. Una etiqueta escrita a mano («Bloqueo») cuenta como `bloqueo`. */
export function valorDeModalidad(v: unknown): ValorModalidad | '' {
  if (typeof v !== 'string' || v.trim() === '') return ''
  return esValorBloqueo(v) ? 'bloqueo' : 'a_medida'
}

/** La primera fila cuyo bloque declara el campo. `null` = este negocio no tiene modalidad. */
export function campoModalidadDesdeFilas(filas: readonly FilaConConfig[]): CampoModalidad | null {
  const f = filas.find(declaraModalidad)
  if (!f) return null
  const data = (f.data ?? {}) as Record<string, unknown>
  return { negocioBloqueId: f.id, data, valor: valorDeModalidad(data[SLUG_MODALIDAD]) }
}

/** La data que se escribe: la guardada, con SOLO la modalidad cambiada. */
export function dataConModalidad(data: Record<string, unknown>, valor: ValorModalidad): Record<string, unknown> {
  return { ...data, [SLUG_MODALIDAD]: valor }
}

/**
 * ¿La tarjeta rechazada por «no es Bloqueo» ofrece el botón «Marcar el viaje como Bloqueo»? Solo si
 * el negocio tiene el campo, la cotización se edita y es la forma por pasos (el paquete solo existe ahí).
 */
export function ofreceMarcarBloqueo(e: { campoDisponible: boolean; editable: boolean; porPasos: boolean }): boolean {
  return e.campoDisponible && e.editable && e.porPasos
}

/** Lee el campo del negocio. El error se devuelve: nunca se convierte en «no tiene el campo». */
export async function leerCampoModalidad(
  supabase: unknown,
  negocioId: string,
): Promise<{ campo: CampoModalidad | null; error: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('negocio_bloques')
    .select('id, data, bloque_configs!inner(config_extra, bloque_definitions!inner(tipo))')
    .eq('negocio_id', negocioId)
  if (error) return { campo: null, error: (error as { message: string }).message }
  return { campo: campoModalidadDesdeFilas((data ?? []) as FilaConConfig[]), error: null }
}
