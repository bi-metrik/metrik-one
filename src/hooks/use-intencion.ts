'use client'

import { useMemo, useRef } from 'react'
import { nuevaClave } from '@/lib/idempotencia/clave'

/**
 * La clave de UNA intención del usuario (un clic, un envío de formulario).
 *
 * La misma intención puede llegar dos veces al servidor: Chromium repite solo un POST cortado,
 * la persona toca dos veces, o le da «Reintentar» después de «No se confirmó». Con la misma
 * clave, el servidor (`accionIdempotente`) ejecuta una sola vez y le devuelve a la repetición
 * el resultado de la primera.
 *
 *     const intencion = useIntencion()
 *     startTransition(async () => {
 *       const r = await registrarPago(..., intencion.clave())
 *       intencion.cerrar()          // llegó respuesta: lo próximo es otra intención
 *       ...
 *     })
 *
 * - `clave()` devuelve la vigente o crea una. Mientras no se cierre, cualquier reintento
 *   (incluido el que corre tras un error de red, que NO llega a `cerrar()`) manda la misma.
 * - `cerrar()` se llama cuando llegó una respuesta, buena o mala.
 */
export function useIntencion(): { clave: () => string; cerrar: () => void } {
  const ref = useRef<string | null>(null)
  return useMemo(
    () => ({
      clave: () => (ref.current ??= nuevaClave()),
      cerrar: () => {
        ref.current = null
      },
    }),
    [],
  )
}
