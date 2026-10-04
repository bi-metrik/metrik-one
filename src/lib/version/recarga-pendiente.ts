import { motivoParaRecargar, navegarConCargaCompleta, type Motivo } from './decidir'

/**
 * Lo que la pestaña sabe de si misma, compartido entre el vigilante
 * (`VersionWatcher`) y quien navega por codigo (`useNavegacionPendiente`, `CardLink`).
 *
 * Vive a nivel de modulo y no en un contexto de React porque la navegacion por
 * codigo ocurre en manejadores de evento, no en el render, y porque el vigilante y
 * los que navegan no comparten un arbol comun garantizado. Fuera del shell de `(app)`
 * nadie registra la pestaña y todo queda en "navega normal".
 */
interface EstadoPestana {
  epocaCargada: number
  epocaViva: number | null
  nacidaEn: number
}

let estado: EstadoPestana | null = null

/** El vigilante registra la pestaña al montarse. */
export function registrarPestana(epocaCargada: number, nacidaEn: number): void {
  estado = { epocaCargada, epocaViva: null, nacidaEn }
}

/** El vigilante se desmonta: la pestaña deja de estar vigilada. */
export function olvidarPestana(): void {
  estado = null
}

/** La ultima epoca valida que respondio `/api/version`. Un fallo NO la borra. */
export function anotarEpocaViva(epoca: number | null): void {
  if (estado && epoca !== null) estado.epocaViva = epoca
}

export function epocaVivaConocida(): number | null {
  return estado?.epocaViva ?? null
}

/** El motivo vigente con lo que se sabe ahora mismo, sin pedir red. */
export function motivoActual(ahora: number): Motivo | null {
  if (!estado) return null
  return motivoParaRecargar({
    epocaCargada: estado.epocaCargada,
    epocaViva: estado.epocaViva,
    edadMs: ahora - estado.nacidaEn,
  })
}

/** ¿La proxima navegacion interna debe ser carga completa? */
export function tocaCargaCompleta(ahora: number, enLinea: boolean): boolean {
  return navegarConCargaCompleta({ motivo: motivoActual(ahora), enLinea })
}

/**
 * Para quien navega por codigo: si toca, se va al destino con carga completa y
 * devuelve `true` (el que llama no hace su `router.push`). Si no toca, `false`.
 * Un doble toque llama dos veces a `assign` con el mismo destino: inofensivo.
 */
export function cargarCompletoSiToca(href: string): boolean {
  if (typeof window === 'undefined') return false
  if (!tocaCargaCompleta(Date.now(), navigator.onLine)) return false
  window.location.assign(href)
  return true
}
