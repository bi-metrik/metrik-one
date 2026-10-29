/**
 * «Ir» a la comisión que falta (QA del #1342, punto 9). «Impide enviar · Falta la comisión…» abría
 * la opción pero dejaba a la asesora buscando la casilla: la del paquete de bloqueo vive dentro de
 * la tarjeta plegada. Esto pide a la tarjeta que se abra (un evento de la ventana: la tarjeta del
 * paquete lo escucha) y, cuando la casilla aparece, la trae a la vista y le pone el foco.
 *
 * Solo navegador; sin estado propio. La casilla es la de `CampoComision` (`data-comision-publica`).
 */

export const EVENTO_ENFOCAR_COMISION = 'one:enfocar-comision'

export interface DetalleEnfocarComision {
  itemId: string
}

const escapar = (s: string) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'))

/** La casilla de la comisión de una opción, dentro de su tarjeta (paquete o línea). */
export function casillaDeComision(raiz: ParentNode, itemId: string): HTMLInputElement | null {
  const id = escapar(itemId)
  return raiz.querySelector<HTMLInputElement>(
    `[data-item-id="${id}"] [data-comision-publica] input, [data-linea-id="${id}"] [data-comision-publica] input`,
  )
}

/**
 * Abre la tarjeta y enfoca su casilla de comisión. Espera a que la tarjeta se pinte (una opción del
 * Paso 1 se monta al cambiar de paso): hasta `intentos` vueltas de `cadaMs`. Devuelve una promesa
 * que dice si la encontró.
 */
export function pedirFocoEnComision(itemId: string, opciones: { intentos?: number; cadaMs?: number } = {}): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(false)
  if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent<DetalleEnfocarComision>(EVENTO_ENFOCAR_COMISION, { detail: { itemId } }))
  const intentos = opciones.intentos ?? 20
  const cadaMs = opciones.cadaMs ?? 150
  return new Promise(resolver => {
    let n = 0
    const buscar = () => {
      const casilla = casillaDeComision(document, itemId)
      if (casilla && !casilla.disabled) {
        casilla.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
        casilla.focus()
        resolver(true)
        return
      }
      if (++n >= intentos) { resolver(false); return }
      setTimeout(buscar, cadaMs)
    }
    setTimeout(buscar, 0)
  })
}
