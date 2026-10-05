'use client'

import { useEffect, useSyncExternalStore } from 'react'

/**
 * ¿El negocio que esta en pantalla esta cerrado? Lo anuncia la pantalla que lo pinta y lo
 * lee el FAB, que vive en el shell y del contexto solo conoce el `pathname`.
 *
 * Antes el FAB se lo preguntaba al servidor con una server action en CADA navegacion a
 * una ficha (`negocioDeContextoCerrado`, 871 llamadas en 7 dias, medido 2026-10-05). Next
 * pone las server actions en fila: esa lectura retrasaba la accion real que venia detras
 * («Registrar pago», mover de etapa). Y el dato ya lo tenia la ficha, que lo deriva de
 * `estado` con el mismo criterio (`negocioCerrado`).
 *
 * Mientras la ficha no lo anuncia (el instante entre que cambia la ruta y monta), el FAB
 * lee «no cerrado»: igual que antes mientras la consulta iba en vuelo. Es solo la
 * pantalla: la barrera real vive en el servidor (`guardEditarBloque`,
 * `registrarPagoEnNegocio`, horas y gastos).
 */

const cerrados = new Map<string, boolean>()
const oyentes = new Set<() => void>()

function suscribir(fn: () => void): () => void {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

export function anunciarNegocioEnPantalla(negocioId: string, cerrado: boolean): void {
  if (cerrados.get(negocioId) === cerrado) return
  cerrados.set(negocioId, cerrado)
  for (const fn of oyentes) fn()
}

/** Lo anuncia la pantalla del negocio (ficha, cotizacion, archivos) al montar o al cambiar. */
export function useAnunciarNegocioEnPantalla(negocioId: string | null | undefined, cerrado: boolean): void {
  useEffect(() => {
    if (negocioId) anunciarNegocioEnPantalla(negocioId, cerrado)
  }, [negocioId, cerrado])
}

/** `true` solo si la pantalla anuncio que ESE negocio esta cerrado. */
export function useNegocioCerrado(negocioId: string | null): boolean {
  return useSyncExternalStore(
    suscribir,
    () => (negocioId ? cerrados.get(negocioId) === true : false),
    () => false,
  )
}

/** Solo para pruebas. */
export function olvidarNegociosEnPantalla(): void {
  cerrados.clear()
}

/** Para pantallas de servidor que no montan la ficha (p. ej. `/negocios/[id]/archivos`). */
export function AnunciarNegocioEnPantalla({ negocioId, cerrado }: { negocioId: string; cerrado: boolean }): null {
  useAnunciarNegocioEnPantalla(negocioId, cerrado)
  return null
}
