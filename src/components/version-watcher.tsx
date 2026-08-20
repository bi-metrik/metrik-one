'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { decidirAccion, estaObsoleta } from '@/lib/version/decidir'

/**
 * Vigilante de la pestaña. Detecta que el bundle cargado quedo atras y la
 * recarga — sola si no hay nada que perder, con aviso si la persona esta a
 * mitad de algo.
 *
 * La logica de "que hacer" NO vive aqui: vive en `@/lib/version/decidir`, que
 * si tiene pruebas (este componente no se puede probar, la suite corre en
 * `node` sin DOM). Aqui solo se miden los hechos — version viva, edad, trabajo
 * en curso, conexion — y se ejecuta el veredicto.
 *
 * Contexto: incidentes Jessica (pestaña de un dia, pantalla en blanco al subir
 * un documento) y Daniela (sesion del 3 de agosto, "no abre nada"), 2026-08-19.
 */

/** Cada cuanto se le pregunta al servidor por la version viva. */
const INTERVALO_MS = 5 * 60 * 1000

/**
 * ¿La persona esta a mitad de algo que una recarga le borraria?
 *
 * Se mide contra el DOM real, no contra estado que habria que mantener al dia
 * en cada formulario del producto. Tres señales, y basta una:
 *
 *  - esta escribiendo (el foco esta en un campo),
 *  - hay un campo sucio (su valor ya no es el que trajo el servidor),
 *  - hay un archivo escogido pero todavia sin subir.
 *
 * Los falsos positivos son baratos y los falsos negativos no: equivocarse hacia
 * "si hay trabajo" solo muestra el aviso; equivocarse hacia "no hay" le borra
 * lo que llevaba escrito.
 */
function hayTrabajoEnCurso(): boolean {
  const activo = document.activeElement
  if (activo instanceof HTMLElement) {
    const tag = activo.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (activo.isContentEditable) return true
  }

  for (const campo of Array.from(document.querySelectorAll('input'))) {
    if (campo.type === 'file') {
      if (campo.files && campo.files.length > 0) return true
      continue
    }
    if (campo.type === 'checkbox' || campo.type === 'radio') {
      if (campo.checked !== campo.defaultChecked) return true
      continue
    }
    if (campo.value !== campo.defaultValue) return true
  }

  for (const area of Array.from(document.querySelectorAll('textarea'))) {
    if (area.value !== area.defaultValue) return true
  }

  return false
}

export default function VersionWatcher({ version }: { version: string }) {
  const [avisar, setAvisar] = useState(false)
  const nacidaEnRef = useRef<number | null>(null)
  const recargandoRef = useRef(false)

  const recargar = useCallback(() => {
    recargandoRef.current = true
    window.location.reload()
  }, [])

  const revisar = useCallback(async () => {
    // Una recarga ya en curso: no volver a entrar ni a pedir nada.
    if (recargandoRef.current) return
    const nacidaEn = nacidaEnRef.current
    if (nacidaEn === null) return

    let versionViva: string | null = null
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (res.ok) {
        const cuerpo = (await res.json()) as { version?: unknown }
        versionViva = typeof cuerpo.version === 'string' ? cuerpo.version : null
      }
    } catch {
      // Sin respuesta no se asume nada. `versionViva` se queda en null y solo
      // el techo de edad puede disparar la recarga — que es justo el caso que
      // hay que cubrir: si el endpoint esta caido, la pestaña de dieciseis dias
      // igual tiene que reciclarse.
    }

    const accion = decidirAccion({
      obsoleta: estaObsoleta({
        versionCargada: version,
        versionViva,
        edadMs: Date.now() - nacidaEn,
      }),
      trabajoEnCurso: hayTrabajoEnCurso(),
      enLinea: navigator.onLine,
    })

    if (accion === 'recargar') {
      recargar()
      return
    }
    // El aviso no se retira: una vez hay version nueva, la hay. Si mas adelante
    // la persona termina lo que estaba haciendo, la siguiente revision devuelve
    // 'recargar' y la pestaña se pone al dia sola.
    if (accion === 'avisar') setAvisar(true)
  }, [version, recargar])

  useEffect(() => {
    // `Date.now()` vive aqui y no en el render: en el render el servidor y el
    // cliente calculan valores distintos y eso rompe la hidratacion (React
    // #418), gotcha ya documentado en este repo.
    nacidaEnRef.current = Date.now()

    const timer = setInterval(() => {
      void revisar()
    }, INTERVALO_MS)

    // Volver a la pestaña es el momento con mas informacion: es cuando la
    // persona esta a punto de usarla y cuando el intervalo pudo haber quedado
    // congelado por el navegador en segundo plano.
    const alVolver = () => {
      if (document.visibilityState === 'visible') void revisar()
    }
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [revisar])

  if (!avisar) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[9998] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-lg"
    >
      <RefreshCw className="h-4 w-4 text-emerald-600" aria-hidden />
      <span className="text-foreground">Hay una versión nueva</span>
      <button
        type="button"
        onClick={recargar}
        className="rounded-full bg-emerald-600 px-3 py-1 font-medium text-white transition-colors hover:bg-emerald-700"
      >
        Recargar
      </button>
    </div>
  )
}
