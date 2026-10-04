'use client'

import { useEffect } from 'react'
import { reportarRecuperacion } from '@/lib/errores-cliente/enviar'
import {
  ESPERA_CONFIRMAR_RECUPERACION_MS,
  erroresDeRuta,
  sessionStorageSeguro,
  tomarPendiente,
} from '@/lib/red/auto-recarga'

/**
 * Cierra el episodio de un error de red que se curo con una RECARGA automatica.
 *
 * La pantalla de error no puede saberlo: la recarga la desmonta. Por eso, antes de recargar,
 * deja anotado en `sessionStorage` lo que estaba pasando (`reclamarRecarga`/`reclamarSuave`),
 * y este vigia, montado en el layout raiz (corre en CUALQUIER carga completa, tambien la
 * que sigue a `global-error`), mira a los `ESPERA_CONFIRMAR_RECUPERACION_MS`: si la ruta no
 * volvio a fallar en esta carga, manda el beacon `recuperado: true` con el intento en que
 * se recupero. No pinta nada; sin anotacion no hace nada.
 */
export default function VigiaRecuperacion() {
  useEffect(() => {
    const pathname = window.location.pathname
    const t = setTimeout(() => {
      if (erroresDeRuta(pathname) > 0) return
      const p = tomarPendiente(pathname, sessionStorageSeguro(), Date.now())
      if (p) reportarRecuperacion(p)
    }, ESPERA_CONFIRMAR_RECUPERACION_MS)
    return () => clearTimeout(t)
  }, [])
  return null
}
