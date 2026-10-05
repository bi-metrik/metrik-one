'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { useParams, usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { crearColector, type Colector, type TipoNavegacion } from '@/lib/rum/colector'
import { MAX_BYTES_RUM, MUESTREO_RUM } from '@/lib/rum/limites'
import { escucharInicioNavegacion } from '@/lib/rum/navegacion'
import { normalizarRuta } from '@/lib/rum/ruta'
import { nuevoId } from '@/lib/errores-cliente/cola'
import { leerContextoRed } from '@/lib/red/contexto-red'

/**
 * Medicion desde el navegador (RUM), montada en `(app)/layout.tsx` junto al shell. No pinta nada.
 *
 * Junta en memoria las web vitals (LCP, INP, CLS, FCP, TTFB, via `useReportWebVitals` de
 * Next) y la duracion de cada navegacion suave (del toque a que cambia la ruta), y manda
 * TODO en un solo beacon a `/api/rum` cada vez que la pestaña se oculta o se cierra. El
 * endpoint lo deja como una linea `[rum]` en los logs de Vercel.
 *
 * Orden de los oyentes: web-vitals reporta INP y CLS en `visibilitychange` sobre
 * `document`; el de aqui va sobre `window`, al que el evento llega DESPUES (burbujea), asi
 * que el beacon ya las lleva. `pagehide` es la segunda oportunidad (Safari viejo).
 *
 * Privacidad: rutas normalizadas (`/negocios/[id]`), sin query string, sin usuario ni
 * correo. El workspace lo pone el endpoint desde el host.
 */

const URL_RUM = '/api/rum'

interface Estado {
  colector: Colector
  /** Ruta normalizada que esta pintada. */
  ruta: string
  /** La misma, cruda: para comparar con el destino de un clic. */
  pathname: string
}

// Uno por carga completa: el shell puede remontarse sin que la pagina recargue.
let estado: Estado | null = null
let decidido = false

function anotarVital(m: { name: string; value: number; rating?: string }): void {
  estado?.colector.anotarVital(m, estado.ruta)
}

function mandar(): void {
  if (!estado) return
  try {
    const beacon = estado.colector.tomarBeacon(estado.ruta, leerContextoRed())
    if (!beacon) return
    const texto = JSON.stringify(beacon)
    if (texto.length > MAX_BYTES_RUM) return
    const blob = new Blob([texto], { type: 'text/plain;charset=UTF-8' })
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(URL_RUM, blob)) return
    void fetch(URL_RUM, {
      method: 'POST',
      body: texto,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {})
  } catch {
    // La medicion nunca rompe la pantalla.
  }
}

/** ¿El destino cambia la ruta? Las que solo cambian la query no se miden. */
function cambiaDeRuta(href: string | undefined, actual: string): boolean {
  if (!href) return true
  try {
    const url = new URL(href, window.location.href)
    return url.origin === window.location.origin && url.pathname !== actual
  } catch {
    return false
  }
}

export default function RumRed() {
  const pathname = usePathname()
  const params = useParams()
  const ruta = normalizarRuta(pathname ?? '/', params)
  const primera = useRef(true)

  // Arranque (una vez por carga). Va ANTES de `useReportWebVitals`: los efectos de un
  // componente corren en orden, y la primera metrica ya encuentra el colector.
  useEffect(() => {
    if (!decidido) {
      decidido = true
      if (Math.random() < MUESTREO_RUM) {
        estado = {
          colector: crearColector({
            carga: nuevoId(),
            entrada: ruta,
            version: String(process.env.NEXT_DEPLOYMENT_ID || 'dev'),
          }),
          ruta,
          pathname: pathname ?? '/',
        }
      }
    }
    if (!estado) return

    const iniciar = (tipo: TipoNavegacion, ahora: number, href?: string) => {
      if (!estado || !cambiaDeRuta(href, estado.pathname)) return
      estado.colector.iniciarNavegacion(tipo, estado.ruta, ahora)
    }
    const soltar = escucharInicioNavegacion(iniciar)

    // Clic en un enlace interno (los `<Link>` del menu y de las pantallas). En captura:
    // corre antes de que Next lo convierta en navegacion suave.
    const alClic = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      iniciar('enlace', performance.now(), a.href)
    }
    // Atras/adelante: `location` ya cambio, se compara con lo que esta pintado.
    const alHistorial = () => iniciar('historial', performance.now(), window.location.href)
    const alOcultar = () => {
      if (document.visibilityState === 'hidden') mandar()
    }

    document.addEventListener('click', alClic, true)
    window.addEventListener('popstate', alHistorial)
    window.addEventListener('visibilitychange', alOcultar)
    window.addEventListener('pagehide', mandar)
    return () => {
      soltar()
      document.removeEventListener('click', alClic, true)
      window.removeEventListener('popstate', alHistorial)
      window.removeEventListener('visibilitychange', alOcultar)
      window.removeEventListener('pagehide', mandar)
    }
    // Solo al montar: la ruta inicial es la de entrada; los cambios los sigue el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // El destino ya pinto: cierra la navegacion en curso.
  useEffect(() => {
    if (primera.current) {
      primera.current = false
      return
    }
    if (!estado) return
    estado.colector.terminarNavegacion(ruta, performance.now())
    estado.ruta = ruta
    estado.pathname = pathname ?? '/'
  }, [ruta, pathname])

  useReportWebVitals(anotarVital)

  return null
}
