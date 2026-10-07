'use client'

import { useLinkStatus } from 'next/link'
import { useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react'
import AnimacionMarca from '@/components/marca/animacion-marca'
import { EsperaConLimite } from '@/components/red/aviso-conexion'
import { cargarCompletoSiToca } from '@/lib/version/recarga-pendiente'
import { marcarInicioNavegacion } from '@/lib/rum/navegacion'

/**
 * Respuesta inmediata al tocar algo que navega, sin esperar a la red.
 *
 * El problema (2026-10-03): desde Claro/Telmex cada ida a Vercel tarda segundos. Al tocar
 * un negocio de la lista no pasaba nada visible hasta que llegaba la ficha, porque el
 * `loading.tsx` de `(app)` solo se vuelve a montar cuando cambia el segmento de primer
 * nivel: entre `/negocios` y `/negocios/[id]` no aparece nunca (verificado en
 * `layout-router.js` de Next 16.1). Y un `loading.tsx` más abajo tampoco sirve: Next lo
 * conoce por el árbol que manda el servidor, o sea que también depende de la red.
 *
 * Así que el estado de "estoy abriendo" vive en el cliente:
 *   - `navegar(href)` envuelve `router.push` en `startTransition`. Next resuelve la
 *     navegación como una transición, y `isPending` queda en `true` hasta que React pinta
 *     la página destino (o la pantalla de error, que también es un render que termina).
 *   - Los `<Link>` del menú no pasan por aquí: avisan con `<SenalDeEnlace />`, que lee el
 *     `useLinkStatus` del enlace en el que vive.
 *   - `<CapaNavegacionPendiente />` pinta la animación de marca sobre el área de contenido
 *     mientras cualquiera de las dos cosas esté pendiente.
 *
 * Nada de esto pide red ni temporizadores: el estado cambia en el mismo evento del toque.
 * El tope de la espera tambien es CSS (`EsperaConLimite`).
 */

interface NavegacionPendiente {
  /** Hay una navegación en curso (de una tarjeta o de un enlace del menú). */
  pendiente: boolean
  /** A dónde va la navegación de tarjeta en curso; `null` si no hay ninguna. */
  destino: string | null
  /** Navega a `href` dentro de una transición. Repetir el mismo destino en curso no hace nada. */
  navegar: (href: string) => void
  /** Un `<Link>` avisa que empezó o terminó su navegación. */
  avisarEnlace: (id: symbol, pendiente: boolean) => void
}

const Contexto = createContext<NavegacionPendiente | null>(null)

export function NavegacionPendienteProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [transicionPendiente, iniciar] = useTransition()
  const [destino, setDestino] = useState<string | null>(null)
  // El destino también en una ref: el segundo toque de un doble toque llega antes de que
  // React pinte el `isPending`, y es justo el que hay que frenar.
  const destinoEnCurso = useRef<string | null>(null)
  const [enlaces, setEnlaces] = useState<ReadonlySet<symbol>>(() => new Set())

  // Al terminar la transición (llegó la página, o la de error) se suelta la guarda del
  // doble toque. El `destino` en estado no hace falta limpiarlo: solo se expone mientras
  // la transición está pendiente. Depende también de `destino`: si React llegara a pintar
  // el toque y el final en un solo commit, el cambio de destino igual dispara la limpieza.
  useEffect(() => {
    if (!transicionPendiente) destinoEnCurso.current = null
  }, [transicionPendiente, destino])

  const navegar = useCallback(
    (href: string) => {
      if (destinoEnCurso.current === href) return
      // La pestaña tiene una recarga pendiente (techo de 8 h o epoca nueva): esta
      // navegacion es el momento de ponerse al dia, como carga completa del destino.
      if (cargarCompletoSiToca(href)) return
      destinoEnCurso.current = href
      // RUM: desde el toque hasta que pinta el destino (lo cierra `rum-red.tsx`).
      marcarInicioNavegacion('tarjeta', href)
      setDestino(href)
      iniciar(() => {
        router.push(href)
      })
    },
    [router],
  )

  const avisarEnlace = useCallback((id: symbol, pendiente: boolean) => {
    setEnlaces((previos) => {
      if (previos.has(id) === pendiente) return previos
      const siguientes = new Set(previos)
      if (pendiente) siguientes.add(id)
      else siguientes.delete(id)
      return siguientes
    })
  }, [])

  const valor = useMemo<NavegacionPendiente>(
    () => ({
      pendiente: transicionPendiente || enlaces.size > 0,
      destino: transicionPendiente ? destino : null,
      navegar,
      avisarEnlace,
    }),
    [transicionPendiente, enlaces, destino, navegar, avisarEnlace],
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

/** El estado compartido, o `null` fuera del shell de `(app)`. */
export function useNavegacionPendiente(): NavegacionPendiente | null {
  return useContext(Contexto)
}

/**
 * Va DENTRO de un `<Link>`: reporta al shell cuando ese enlace está navegando. No pinta
 * nada; la señal visible es la capa del área de contenido.
 */
export function SenalDeEnlace() {
  const { pending } = useLinkStatus()
  const ctx = useContext(Contexto)
  const [id] = useState(() => Symbol('enlace'))
  const avisar = ctx?.avisarEnlace

  useEffect(() => {
    if (!avisar) return
    avisar(id, pending)
    // Si el enlace se desmonta a media navegación (se cerró el panel "Más"), no queda
    // colgado como pendiente.
    return () => avisar(id, false)
  }, [avisar, id, pending])

  return null
}

/**
 * La animación de marca sobre el área de contenido mientras hay una navegación pendiente.
 * Va como hermana del `<main>` dentro de un contenedor `relative`: tapa la vista vieja sin
 * tapar el menú ni la barra superior, y no se va con el scroll de la lista.
 *
 * El retardo de 120 ms es CSS: si la página llega antes, la capa se desmonta sin haberse
 * visto. Mientras tanto la tarjeta tocada ya está atenuada, así que el toque se nota.
 */
export function CapaNavegacionPendiente() {
  const ctx = useContext(Contexto)
  if (!ctx?.pendiente) return null
  // Con tope (2026-10-06): Next no le pone limite a una navegacion, y si el payload RSC se
  // queda colgado en la ruta de Claro/Telmex la capa quedaba para siempre. A los 45 s (desde 2026-10-07; antes 25) cede al
  // aviso "No pudimos conectar con ONE"; Reintentar carga el destino completo (si la
  // navegacion es de una tarjeta) o la pagina actual (enlace del menu, cuyo destino no se
  // conoce aqui).
  return (
    <EsperaConLimite
      causa="navegacion"
      destino={ctx.destino}
      className="absolute inset-0 z-20 bg-background"
    >
      <AnimacionMarca
        variante="liviana"
        etiqueta="Abriendo"
        retardoMs={120}
        tamano="clamp(1.6rem, 4vw, 2.2rem)"
      />
    </EsperaConLimite>
  )
}
