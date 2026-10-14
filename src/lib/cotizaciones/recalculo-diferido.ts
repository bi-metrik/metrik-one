import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * «Aceptar los N» con UN solo recálculo (C5, nota técnica de Max §5.3; criterio V4 de Vera).
 *
 * Cada aceptación de la bandeja recalcula el total dentro de su camino (`confirmarTarifaPorPasajero`,
 * el cierre de la forma por pasos…). En un lote de 11 eso eran 22 recálculos en serie. Dentro de
 * `conRecalculoDiferido(...)`, `recalcularTotales` NO corre: anota que quedó pendiente, y quien abrió
 * el lote recalcula una sola vez al final, también si alguna aceptación falló.
 *
 * Opt-in y con el contexto asíncrono de ESA petición (como `memo-de-ruta.ts`): fuera del lote
 * `recalculoDiferido()` es `false` y `recalcularTotales` hace exactamente lo de siempre, sin una ida
 * de más a la base. Solo lo abre la ruta `aceptar-lote`, que exige el interruptor encendido.
 */
const almacen = new AsyncLocalStorage<{ pendientes: Set<string> }>()

/** Corre `fn` con los recálculos diferidos. Devuelve lo de `fn` y las cotizaciones que quedaron por recalcular. */
export async function conRecalculoDiferido<T>(fn: () => Promise<T>): Promise<{ resultado: T; pendientes: string[] }> {
  const estado = { pendientes: new Set<string>() }
  const resultado = await almacen.run(estado, fn)
  return { resultado, pendientes: [...estado.pendientes] }
}

/**
 * ¿Este recálculo se difiere? Si estamos dentro de un lote, anota la cotización y dice `true`: el
 * llamador no recalcula. Fuera de un lote, `false` y nada más.
 */
export function diferirRecalculo(cotizacionId: string): boolean {
  const estado = almacen.getStore()
  if (!estado) return false
  estado.pendientes.add(cotizacionId)
  return true
}
