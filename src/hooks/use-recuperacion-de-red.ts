'use client'

import { startTransition, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { reportarErrorCliente, reportarRecuperacion } from '@/lib/errores-cliente/enviar'
import { esErrorDeRed } from '@/lib/red/error-de-red'
import { anotarFallaRed } from '@/lib/red/bandeja-red'
import {
  ESPERA_CONFIRMAR_RECUPERACION_MS,
  cargaActual,
  enLinea,
  erroresDeRuta,
  planearRecuperacion,
  reclamarRecarga,
  reclamarSuave,
  registrarErrorDeRuta,
  sessionStorageSeguro,
  tomarPendiente,
  type OrigenPantalla,
} from '@/lib/red/auto-recarga'

/**
 * Que pinta la pantalla de error:
 * - `recuperando`: la animacion de carga de la marca (se esta reintentando solo).
 * - `sin-internet`: la animacion + "Sin internet. Seguimos apenas vuelva." (`onLine` false).
 * - `agotado`: error de red sin mas intentos: "Esta página está tardando más de lo normal".
 * - `error`: no es de red: la pantalla de siempre.
 */
export type EstadoPantalla = 'recuperando' | 'sin-internet' | 'agotado' | 'error'

/**
 * La escalera de `lib/red/auto-recarga.ts` aplicada a una pantalla de error montada.
 *
 * El render NO lee ni escribe `sessionStorage`: el estado inicial sale solo del error
 * (`esErrorDeRed`), asi que un error de red arranca en `recuperando` y, si el tope ya estaba
 * gastado, pasa a `agotado` en el mismo tick (la animacion aparece a los 300 ms: no se ve).
 * Todo lo que escribe corre en un temporizador que programa el efecto y que la limpieza
 * cancela: en StrictMode (montar, desmontar, montar) solo sobrevive el del segundo montaje,
 * asi que hay UN solo reclamo y UN solo beacon.
 */
export function useRecuperacionDeRed(
  error: Error & { digest?: string },
  reset: () => void,
  origen: OrigenPantalla,
): EstadoPantalla {
  const router = useRouter()
  const esRed = esErrorDeRed(error)
  const [estado, setEstado] = useState<EstadoPantalla>(esRed ? 'recuperando' : 'error')

  useEffect(() => {
    let vivo = true
    const temporizadores = new Set<ReturnType<typeof setTimeout>>()
    let quitarOnline: (() => void) | null = null
    const programar = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        temporizadores.delete(t)
        if (vivo) fn()
      }, ms)
      temporizadores.add(t)
    }
    const etiqueta = origen === 'app' ? '[app]' : '[global]'

    if (!esRed) {
      programar(() => {
        console.error(`${etiqueta} error no capturado:`, error)
        reportarErrorCliente(error, origen, false, { accion: 'ninguna' })
      }, 0)
      return () => {
        vivo = false
        temporizadores.forEach(clearTimeout)
      }
    }

    const pathname = window.location.pathname
    // Piloto de red: una pantalla que cayó por la red cuenta como falla de navegación. En un
    // temporizador, como todo lo que escribe aquí: en StrictMode solo sobrevive uno.
    programar(() => anotarFallaRed({ superficie: 'navegacion', error, ruta: pathname }), 0)
    const base = { message: String(error?.message ?? '') || String(error), name: error?.name, origen }

    const agotar = (intento: number, reportar: boolean) => {
      // Sin intentos: lo pendiente ya no se va a "recuperar solo".
      tomarPendiente(pathname, sessionStorageSeguro(), Date.now())
      setEstado('agotado')
      if (reportar) reportarErrorCliente(error, origen, false, { accion: 'agotado', intento, enLinea: enLinea() })
    }

    const esperarRed = () => {
      setEstado('sin-internet')
      if (quitarOnline) return
      const alVolver = () => {
        quitarOnline?.()
        quitarOnline = null
        if (!vivo) return
        setEstado('recuperando')
        decidir()
      }
      window.addEventListener('online', alVolver)
      quitarOnline = () => window.removeEventListener('online', alVolver)
    }

    const decidir = () => {
      const plan = planearRecuperacion({
        error,
        pathname,
        almacen: sessionStorageSeguro(),
        ahora: Date.now(),
        enLinea: enLinea(),
      })
      if (!plan) return
      console.error(`${etiqueta} error de red (${plan.accion}, intento ${plan.intento}):`, error)
      // Va por `sendBeacon`, que sobrevive a la recarga.
      reportarErrorCliente(error, origen, plan.accion !== 'agotado', {
        accion: plan.accion,
        intento: plan.intento,
        enLinea: enLinea(),
      })

      switch (plan.accion) {
        case 'esperar-red':
          esperarRed()
          return
        case 'agotado':
          agotar(plan.intento, false)
          return
        case 'suave': {
          if (!reclamarSuave(pathname, sessionStorageSeguro(), Date.now(), base)) {
            agotar(plan.intento, true)
            return
          }
          // Si en ESPERA_CONFIRMAR_RECUPERACION_MS la ruta no vuelve a fallar, se recupero.
          // Temporizador del MODULO, no del componente: `reset()` lo desmonta.
          const antes = erroresDeRuta(pathname)
          const estaCarga = cargaActual()
          setTimeout(() => {
            if (cargaActual() !== estaCarga || erroresDeRuta(pathname) !== antes) return
            if (!tomarPendiente(pathname, sessionStorageSeguro(), Date.now())) return
            reportarRecuperacion({ ...base, intento: plan.intento, accion: 'suave' })
          }, ESPERA_CONFIRMAR_RECUPERACION_MS)
          // El patron de Next para errores de server components: pedir de nuevo el payload
          // y volver a pintar el segmento, sin bajar otra vez la pagina entera.
          startTransition(() => {
            router.refresh()
            reset()
          })
          return
        }
        case 'recarga':
          programar(() => {
            if (!enLinea()) {
              esperarRed()
              return
            }
            if (reclamarRecarga(pathname, sessionStorageSeguro(), Date.now(), base)) {
              window.location.reload()
              return
            }
            // `sessionStorage` dejo de guardar (o el tope se lleno entre tanto): no se recarga.
            agotar(plan.intento, true)
          }, plan.esperaMs)
      }
    }

    programar(() => {
      registrarErrorDeRuta(pathname)
      decidir()
    }, 0)

    return () => {
      vivo = false
      temporizadores.forEach(clearTimeout)
      quitarOnline?.()
      quitarOnline = null
    }
  }, [error, esRed, origen, reset, router])

  return estado
}
