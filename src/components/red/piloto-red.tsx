'use client'

import { useEffect } from 'react'
import { activarPilotoRed, anotarEventoRed, nuevoIdRed, vaciarBandejaRed } from '@/lib/red/bandeja-red'
import { rutaNormalizada } from '@/lib/red/eventos'
import { esPilotoRed } from '@/lib/red/piloto'
import { ESPERA_SONDA_MS, VENTANA_MS, crearMedidor, type Medidor, type ResultadoSonda } from '@/lib/red/pulso'
import { leerRed } from '@/lib/red/contexto-red'

/**
 * Piloto de red (brief 2026-10-06), montado en `(app)/layout.tsx`. No pinta nada.
 *
 * Solo en los workspaces de `WORKSPACES_PILOTO_RED`: enciende la bandeja de eventos (para que
 * las superficies puedan anotar sus fallas) y, mientras la pestaña está visible, toma el pulso
 * de la conexión hacia Vercel y hacia el punto de control (ver `lib/red/pulso.ts`).
 */

/** Archivo estático del propio dominio (CDN de Vercel). Extensión excluida del middleware. */
const SONDA_VERCEL = '/pulso.png'

function urlControl(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  // `auth/v1/health` sin llave: el gateway de Supabase contesta 401 sin tocar la base. Para la
  // sonda basta con que conteste algo; `no-cors` evita la comprobación previa (CORS).
  return base ? `${base.trim().replace(/\/+$/, '')}/auth/v1/health` : null
}

async function sondear(url: string, init: RequestInit): Promise<ResultadoSonda> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ESPERA_SONDA_MS)
  const inicio = performance.now()
  try {
    await fetch(`${url}?n=${Math.random().toString(36).slice(2, 10)}`, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      signal: ac.signal,
    })
    return { ok: true, ms: performance.now() - inicio }
  } catch {
    return { ok: false, ms: performance.now() - inicio }
  } finally {
    clearTimeout(t)
  }
}

function controladaPorSw(): boolean {
  try {
    return !!navigator.serviceWorker?.controller
  } catch {
    return false
  }
}

function redDelNavegador() {
  const r = leerRed()
  return r ? { tipo: r.tipo, rtt: r.rtt, bajadaMbps: r.bajadaMbps } : undefined
}

export default function PilotoRed({ slug }: { slug: string | null }) {
  const activo = esPilotoRed(slug)

  useEffect(() => {
    if (!activo) return
    activarPilotoRed()
    const control = urlControl()
    if (!control) return

    const medidor: Medidor = crearMedidor({ inicio: Date.now(), nuevoId: nuevoIdRed, sw: controladaPorSw })
    let vivo = true
    let ronda: ReturnType<typeof setTimeout> | null = null
    let visibleDesde: number | null = document.visibilityState === 'visible' ? Date.now() : null
    let offlineDesde: number | null = navigator.onLine === false ? Date.now() : null
    let finVentana = Date.now() + VENTANA_MS

    const acumularTiempos = (ahora: number) => {
      if (visibleDesde !== null) {
        medidor.anotarVisible(ahora - visibleDesde)
        visibleDesde = ahora
      }
      if (offlineDesde !== null) {
        medidor.anotarOffline(ahora - offlineDesde)
        offlineDesde = ahora
      }
    }

    const cerrarVentana = (keepalive: boolean) => {
      const ahora = Date.now()
      acumularTiempos(ahora)
      const pulso = medidor.tomarVentana(ahora, redDelNavegador())
      if (pulso) anotarEventoRed(pulso)
      finVentana = ahora + VENTANA_MS
      void vaciarBandejaRed({ keepalive })
    }

    const programar = () => {
      if (!vivo || document.visibilityState !== 'visible') return
      if (ronda) clearTimeout(ronda)
      ronda = setTimeout(tomarRonda, medidor.intervalo())
    }

    const tomarRonda = async () => {
      ronda = null
      if (!vivo || document.visibilityState !== 'visible') return
      const t = Date.now()
      const [v, c] = await Promise.all([
        sondear(SONDA_VERCEL, {}),
        sondear(control, { mode: 'no-cors' }),
      ])
      if (!vivo) return
      const corte = medidor.anotarRonda(t, v, c, rutaNormalizada(window.location.pathname))
      if (corte) {
        anotarEventoRed(corte)
        // Volvió la red: es el mejor momento para mandar lo pendiente.
        void vaciarBandejaRed()
      }
      if (Date.now() >= finVentana) cerrarVentana(false)
      programar()
    }

    const alCambiarVisibilidad = () => {
      const ahora = Date.now()
      if (document.visibilityState === 'visible') {
        visibleDesde = ahora
        programar()
        void vaciarBandejaRed()
        return
      }
      if (ronda) clearTimeout(ronda)
      ronda = null
      acumularTiempos(ahora)
      visibleDesde = null
      const corte = medidor.cerrarPorOculta(ahora)
      if (corte) anotarEventoRed(corte)
      cerrarVentana(true)
    }
    const alDesconectar = () => {
      if (offlineDesde === null) offlineDesde = Date.now()
    }
    const alConectar = () => {
      if (offlineDesde !== null) {
        medidor.anotarOffline(Date.now() - offlineDesde)
        offlineDesde = null
      }
      void vaciarBandejaRed()
    }

    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('offline', alDesconectar)
    window.addEventListener('online', alConectar)
    void vaciarBandejaRed()
    // Primera ronda enseguida: la línea base de la carga.
    if (document.visibilityState === 'visible') ronda = setTimeout(tomarRonda, 1_000)

    return () => {
      vivo = false
      if (ronda) clearTimeout(ronda)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('offline', alDesconectar)
      window.removeEventListener('online', alConectar)
    }
  }, [activo])

  return null
}
