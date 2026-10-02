'use client'

import { useCallback, useTransition, type TransitionStartFunction } from 'react'
import { toast } from 'sonner'
import { MENSAJE_SIN_CONEXION } from '@/lib/red/error-de-red'
import { envolverTolerante } from '@/lib/red/transicion-tolerante'

/** Un aviso por racha: diez acciones que fallan juntas no apilan diez toasts. */
const ID_TOAST_SIN_CONEXION = 'sin-conexion'

function avisarSinConexion() {
  toast.error(MENSAJE_SIN_CONEXION, { id: ID_TOAST_SIN_CONEXION })
}

/**
 * `useTransition` que no tumba la pantalla cuando falla la red.
 *
 * Misma firma que el de React, a proposito: adoptarlo es cambiar la linea del hook, sin
 * tocar los `startTransition(async () => …)` de cada boton. Ver `envolverTolerante`.
 */
export function useTransitionTolerante(): [boolean, TransitionStartFunction] {
  const [isPending, start] = useTransition()
  const startTolerante = useCallback<TransitionStartFunction>(
    (cb) => start(envolverTolerante(cb, avisarSinConexion)),
    [start],
  )
  return [isPending, startTolerante]
}
