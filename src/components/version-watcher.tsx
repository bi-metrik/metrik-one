'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  decidirAccion,
  esNavegacionInterna,
  leerEpoca,
  type Momento,
} from '@/lib/version/decidir'
import {
  anotarEpocaViva,
  motivoActual,
  olvidarPestana,
  registrarPestana,
  tocaCargaCompleta,
} from '@/lib/version/recarga-pendiente'

/**
 * Vigilante de la pestaña. Un deploy normal NO la recarga (desde 2026-10-03):
 * Skew Protection le sirve su propia version. Solo se recarga por:
 *
 *  - **Epoca nueva** (`@/lib/version/epoca`): un PR rompio compatibilidad con las
 *    pestañas viejas. Recarga sola si no hay nada que perder, con aviso si la
 *    persona esta a mitad de algo.
 *  - **Techo de 8 horas**: queda pendiente y se resuelve en la siguiente navegacion
 *    interna (carga completa del destino) o al volver a la pestaña sin trabajo en
 *    curso. Nunca a alguien que esta leyendo una pantalla visible.
 *
 * La logica de "que hacer" NO vive aqui: vive en `@/lib/version/decidir`, que
 * si tiene pruebas (este componente no se puede probar, la suite corre en
 * `node` sin DOM). Aqui solo se miden los hechos — epoca viva, edad, trabajo
 * en curso, conexion — y se ejecuta el veredicto.
 *
 * Contexto: incidentes Jessica (pestaña de un dia, pantalla en blanco al subir
 * un documento) y Daniela (sesion del 3 de agosto, "no abre nada"), 2026-08-19.
 */

/** Cada cuanto se le pregunta al servidor por la epoca viva. */
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

export default function VersionWatcher({ epoca }: { epoca: number }) {
  const [avisar, setAvisar] = useState(false)
  const recargandoRef = useRef(false)

  const recargar = useCallback(() => {
    recargandoRef.current = true
    window.location.reload()
  }, [])

  // Decide con lo que ya se sabe, sin pedir red. Devuelve true si recargo.
  const actuar = useCallback(
    (momento: Momento): boolean => {
      if (recargandoRef.current) return true
      const accion = decidirAccion({
        motivo: motivoActual(Date.now()),
        momento,
        trabajoEnCurso: hayTrabajoEnCurso(),
        enLinea: navigator.onLine,
      })
      if (accion === 'recargar') {
        recargar()
        return true
      }
      // El aviso no se retira: una vez hay epoca nueva, la hay. Si mas adelante
      // la persona termina lo que estaba haciendo, la siguiente revision devuelve
      // 'recargar' y la pestaña se pone al dia sola.
      if (accion === 'avisar') setAvisar(true)
      return false
    },
    [recargar],
  )

  const revisar = useCallback(async () => {
    // Una recarga ya en curso: no volver a entrar ni a pedir nada.
    if (recargandoRef.current) return

    // Sin `x-deployment-id` a proposito: esta consulta DEBE llegar al deployment vivo.
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (res.ok) anotarEpocaViva(leerEpoca(await res.json()))
    } catch {
      // Sin respuesta no se asume nada: la epoca viva queda en la ultima conocida y
      // solo el techo puede pedir la recarga.
    }

    // Despues de la red SIEMPRE como 'intervalo': la respuesta puede tardar segundos
    // por Claro, y para entonces la persona ya esta leyendo. El techo no recarga aqui.
    actuar('intervalo')
  }, [actuar])

  useEffect(() => {
    // `Date.now()` vive aqui y no en el render: en el render el servidor y el
    // cliente calculan valores distintos y eso rompe la hidratacion (React
    // #418), gotcha ya documentado en este repo.
    registrarPestana(epoca, Date.now())

    const timer = setInterval(() => {
      void revisar()
    }, INTERVALO_MS)

    // Volver a la pestaña es el momento con mas informacion: la persona esta a
    // punto de usarla y todavia no esta leyendo nada. Primero se decide con lo que
    // ya se sabe (sin red, para recargar EN el instante de volver y no segundos
    // despues), y luego se pregunta por la epoca.
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      if (actuar('volver')) return
      void revisar()
    }
    document.addEventListener('visibilitychange', alVolver)

    // Navegacion interna por `<a>`/`<Link>` con la recarga pendiente: se convierte
    // en carga completa del destino. Va en captura sobre `window` para correr ANTES
    // que el `onClick` de `<Link>`, que ya habria arrancado la navegacion suave.
    const alClic = (e: MouseEvent) => {
      const ancla = (e.target as Element | null)?.closest?.('a[href]')
      if (!(ancla instanceof HTMLAnchorElement)) return
      const destino = esNavegacionInterna({
        href: ancla.getAttribute('href'),
        ubicacion: window.location.href,
        target: ancla.getAttribute('target'),
        descarga: ancla.hasAttribute('download'),
        boton: e.button,
        modificadora: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        yaPrevenido: e.defaultPrevented,
      })
      if (!destino) return
      if (!tocaCargaCompleta(Date.now(), navigator.onLine)) return
      e.preventDefault()
      e.stopPropagation()
      window.location.assign(destino.href)
    }
    window.addEventListener('click', alClic, true)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('click', alClic, true)
      olvidarPestana()
    }
  }, [epoca, revisar, actuar])

  if (!avisar) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[9998] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-lg"
    >
      <RefreshCw className="h-4 w-4 text-acento" aria-hidden />
      <span className="text-foreground">Hay una versión nueva</span>
      <button
        type="button"
        onClick={recargar}
        className="rounded-full bg-acento px-3 py-1 font-medium text-white transition-colors hover:bg-acento"
      >
        Recargar
      </button>
    </div>
  )
}
