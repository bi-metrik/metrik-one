'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * El estado del botón «Avanzar de etapa», SIN depender del `isPending` de la transición (prueba
 * del #1229, punto a: el botón se quedaba en «Cambiando…» hasta recargar aunque la etapa sí
 * avanzó).
 *
 * Por qué no basta el `isPending`: la acción llama a `revalidatePath` y la transición no termina
 * hasta que la ficha nueva se pinta. Si ese repintado se demora o no llega, el botón queda
 * colgado para siempre aunque el servidor ya contestó. Aquí la fase la mueve la RESPUESTA:
 *
 *   listo ──(clic)──▶ enviando ──(contestó, no movió)──▶ listo
 *                         └──(contestó, movió)──▶ actualizando ──(llegó la etapa nueva)──▶ listo
 *                                                      ├─(4 s)─▶ pide la ficha otra vez
 *                                                      └─(15 s)─▶ atascado: «Recargar»
 *
 * Mientras se espera la etapa nueva el botón sigue deshabilitado: la pantalla todavía muestra la
 * etapa de antes, y avanzar «otra vez» desde ahí (con routing) movería el caso dos etapas.
 *
 * ⚠️ `terminar` se llama DESPUÉS de un `await` dentro de `startTransition`: en React 19 esa
 * actualización ya no es parte de la transición, así que se pinta enseguida (es justo lo que se
 * busca). `empezar` va antes de `startTransition`, también urgente.
 */
export type FaseAvance = 'listo' | 'enviando' | 'actualizando' | 'atascado'

export interface EstadoAvance {
  fase: FaseAvance
  /** La etapa en que estaba el caso al tocar el botón. */
  desde: string | null
}

export type EventoAvance =
  | { tipo: 'empezar'; etapa: string | null }
  | { tipo: 'terminar'; movio: boolean }
  | { tipo: 'etapa'; etapa: string | null }
  | { tipo: 'vencio' }

export const LISTO: EstadoAvance = { fase: 'listo', desde: null }

/** PURO: la fase siguiente. */
export function siguienteFaseAvance(e: EstadoAvance, ev: EventoAvance): EstadoAvance {
  switch (ev.tipo) {
    case 'empezar':
      return { fase: 'enviando', desde: ev.etapa }
    case 'terminar':
      if (e.fase !== 'enviando') return e
      return ev.movio ? { fase: 'actualizando', desde: e.desde } : LISTO
    case 'etapa':
      // La ficha ya trae otra etapa: terminó (también si llegó antes que la respuesta).
      return (e.fase === 'actualizando' || e.fase === 'atascado') && ev.etapa !== e.desde ? LISTO : e
    case 'vencio':
      return e.fase === 'actualizando' ? { ...e, fase: 'atascado' } : e
  }
}

export const MS_PEDIR_FICHA = 4_000
export const MS_ATASCADO = 15_000

export function useAvanceDeEtapa(etapaActualId: string | null, pedirFicha: () => void) {
  const [estado, setEstado] = useState<EstadoAvance>(LISTO)

  useEffect(() => {
    setEstado((e) => siguienteFaseAvance(e, { tipo: 'etapa', etapa: etapaActualId }))
  }, [etapaActualId])

  useEffect(() => {
    if (estado.fase !== 'actualizando') return
    const t1 = setTimeout(pedirFicha, MS_PEDIR_FICHA)
    const t2 = setTimeout(() => setEstado((e) => siguienteFaseAvance(e, { tipo: 'vencio' })), MS_ATASCADO)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
    // pedirFicha cambia en cada render del padre: el temporizador se arma una vez por fase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.fase])

  const empezar = useCallback(() => setEstado((e) => siguienteFaseAvance(e, { tipo: 'empezar', etapa: etapaActualId })), [etapaActualId])
  const terminar = useCallback((movio: boolean) => setEstado((e) => siguienteFaseAvance(e, { tipo: 'terminar', movio })), [])

  return { fase: estado.fase, ocupado: estado.fase !== 'listo', empezar, terminar }
}
