'use client'

import { useCallback, useTransition, type TransitionStartFunction } from 'react'
import { toast } from 'sonner'
import { mensajeDeFallaDeRed } from '@/lib/red/error-de-red'
import { envolverTolerante } from '@/lib/red/transicion-tolerante'
import { alNoConfirmarse, type OpcionesSinConfirmar } from '@/lib/red/accion-sin-confirmar'

/** Un aviso por racha: diez acciones que fallan juntas no apilan diez toasts. */
const ID_TOAST_SIN_CONEXION = 'sin-conexion'

function avisarSinConexion() {
  toast.error(mensajeDeFallaDeRed(), { id: ID_TOAST_SIN_CONEXION })
}

/**
 * `useTransition` que no tumba la pantalla cuando falla la red.
 *
 * Misma firma que el de React, a proposito: adoptarlo es cambiar la linea del hook, sin
 * tocar los `startTransition(async () => …)` de cada boton. Ver `envolverTolerante`.
 *
 * Con `sinConfirmar` (acciones de escritura LARGAS: emitir, avanzar, generar) el corte no
 * dice «intenta de nuevo»: dice que no se confirmó, relee el estado real y solo ofrece
 * reintentar si la acción lo declara seguro. Ver `@/lib/red/accion-sin-confirmar`.
 */
export function useTransitionTolerante(
  sinConfirmar?: OpcionesSinConfirmar,
): [boolean, TransitionStartFunction] {
  const [isPending, start] = useTransition()
  const startTolerante = useCallback<TransitionStartFunction>(
    (cb) => start(envolverTolerante(cb, () => {
      const o = sinConfirmar
      if (!o) return avisarSinConexion()
      alNoConfirmarse(o, (a) => toast.error(a.mensaje, {
        id: ID_TOAST_SIN_CONEXION,
        ...(a.accion ? { action: { label: a.accion.etiqueta, onClick: a.accion.alHacer } } : {}),
      }))
    })),
    [start, sinConfirmar],
  )
  return [isPending, startTolerante]
}
