'use client'

import { useRouter } from 'next/navigation'
import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react'

/**
 * Tarjeta entera clickable cuyo texto SE PUEDE SELECCIONAR y copiar.
 *
 * Por qué no es un <Link>: dentro de un `<a href>` Chrome no deja seleccionar
 * texto arrastrando el cursor — el arrastre es "arrastrar el enlace". Se midió
 * en Chrome (con y sin ventana) que ni `draggable={false}` ni `user-select:text`
 * lo devuelven: el texto queda inseleccionable y, peor, al soltar el mouse la
 * tarjeta navega. Ese era el reporte de Mauricio (2026-08-02).
 *
 * Así que la tarjeta es un contenedor normal que navega por click. Lo que un
 * ancla daba gratis se repone a mano:
 *   - Cmd/Ctrl/Shift click y click del botón central abren en pestaña nueva.
 *   - Enter y Espacio navegan (rol de enlace para lectores de pantalla).
 *   - El destino se precarga al pasar el cursor, como hacía el prefetch de Link.
 * Lo que se pierde: el menú contextual del navegador sobre el enlace ("copiar
 * dirección") y ver la URL en la barra de estado al pasar el cursor.
 *
 * Los controles internos ya frenan la propagación antes de hacer lo suyo
 * (`frenarNavegacion` en cada tarjeta), así que siguen funcionando igual.
 */
type Props = {
  href: string
  children: ReactNode
} & Omit<HTMLAttributes<HTMLDivElement>, 'onClick'>

export function CardLink({ href, children, className = '', ...rest }: Props) {
  const router = useRouter()

  function abrirEnPestanaNueva() {
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    // Si el usuario acaba de seleccionar texto, soltar el mouse NO es un click.
    if (haySeleccionDentroDe(e.currentTarget)) return
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      abrirEnPestanaNueva()
      return
    }
    router.push(href)
  }

  function handleAuxClick(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 1) return // botón central
    e.preventDefault()
    abrirEnPestanaNueva()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Solo cuando el foco está en la tarjeta: no robarle la tecla a un input
    // o a un botón de adentro.
    if (e.target !== e.currentTarget) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    router.push(href)
  }

  return (
    <div
      {...rest}
      // Un div no trae el cursor de mano que daba el ancla.
      className={`cursor-pointer ${className}`}
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => router.prefetch(href)}
    >
      {children}
    </div>
  )
}

/**
 * Hay texto seleccionado y la selección vive dentro de esta tarjeta.
 * Acotarlo al nodo importa: una selección en OTRA tarjeta no debe bloquear
 * la navegación de esta.
 */
function haySeleccionDentroDe(nodo: HTMLElement): boolean {
  const seleccion = typeof window === 'undefined' ? null : window.getSelection()
  if (!seleccion || seleccion.isCollapsed) return false
  if (!seleccion.toString().trim()) return false
  const ancla = seleccion.anchorNode
  return !!ancla && nodo.contains(ancla)
}
