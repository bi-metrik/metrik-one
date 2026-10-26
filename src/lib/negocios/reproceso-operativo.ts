/**
 * El operativo del caso también puede abrir un reproceso, solo donde la etapa lo declara.
 *
 * Hasta el 2026-10-07 un reproceso lo abrían únicamente dirección o un supervisor de
 * operaciones: mueve el 40% del bono y por eso tenía la puerta angosta. SOE-001 (decisión
 * de Mauricio): en las etapas de acompañamiento a la DIAN (Confirmación del radicado,
 * Validación de rechazo y Acto administrativo) el rechazo de la DIAN lo devuelve el
 * operativo del caso, que es quien se entera primero.
 *
 * La puerta se abre por CONFIGURACIÓN de la etapa, no por rol:
 *
 *   etapas_negocio.config_extra.reproceso_operativo = ["devolucion_dian"]
 *
 * y solo para quien está asignado al caso con el puesto de operaciones
 * (`negocio_responsables.rol = 'operaciones'`). Fuera de esas etapas, o para otro tipo de
 * reproceso, la regla de siempre. Lo que el operativo NO elige es la causa: queda la del
 * motivo (`motivos-reproceso.ts`), porque decidir si el error le cuenta en el bono sería
 * juez y parte.
 *
 * Puro: lo usan el server action (que además consulta el puesto) y la pantalla (que solo
 * decide si dibuja el botón; la última palabra es del servidor).
 */

import { BLOQUE_DEL_TRAMO, type TipoReproceso } from './atribucion-reproceso'

/** Los tipos de reproceso que la etapa le abre al operativo del caso. */
export function tiposReprocesoOperativo(configEtapa: Record<string, unknown> | null | undefined): TipoReproceso[] {
  const v = configEtapa?.reproceso_operativo
  const lista = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
  return [...new Set(lista.filter((t): t is TipoReproceso => typeof t === 'string' && t in BLOQUE_DEL_TRAMO))]
}

export function operativoPuedeReprocesar(input: {
  tipo: TipoReproceso
  configEtapa: Record<string, unknown> | null | undefined
  esOperativoDelCaso: boolean
}): boolean {
  if (!input.esOperativoDelCaso) return false
  return tiposReprocesoOperativo(input.configEtapa).includes(input.tipo)
}
