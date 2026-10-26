import type { VarianteMarca } from './animacion-marca'

/**
 * La intro completa de la marca sale UNA vez por sesion del navegador; despues va la
 * version liviana. Se lleva en `sessionStorage`: muere al cerrar la pestaña, que es
 * justo la unidad de "volvi a entrar".
 *
 * Se separa en mirar y marcar para que un intento fallido (un codigo mal escrito) no
 * gaste la intro: se marca solo cuando la entrada se valida.
 */
export const CLAVE_INTRO_MARCA = 'metrik-one:intro-marca'

type Almacen = Pick<Storage, 'getItem' | 'setItem'>

function almacenDelNavegador(): Almacen | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // Safari en modo privado y algunos navegadores embebidos lanzan al tocarlo.
    return null
  }
}

/** Que variante toca ahora. Sin almacen disponible, la liviana: nunca repetir la intro. */
export function varianteDeIntro(almacen: Almacen | null = almacenDelNavegador()): VarianteMarca {
  if (!almacen) return 'liviana'
  try {
    return almacen.getItem(CLAVE_INTRO_MARCA) ? 'liviana' : 'intro'
  } catch {
    return 'liviana'
  }
}

/** Deja constancia de que la intro ya salio en esta sesion. */
export function marcarIntroVista(almacen: Almacen | null = almacenDelNavegador()): void {
  try {
    almacen?.setItem(CLAVE_INTRO_MARCA, '1')
  } catch {
    // Sin almacen la intro puede repetirse en otra entrada: es lo menos grave.
  }
}
