'use client'

import { createContext } from 'react'

/**
 * Lo que el marco del negocio (`marco-cotizacion.tsx`) le ofrece a la cotización que
 * envuelve. `null` = no hay marco: la cotización se pinta como siempre (R6).
 */
export interface ContextoMarcoCotizacion {
  /**
   * La bandeja avisa si tiene trabajo en el aire. Es la MISMA condición del aviso al
   * recargar (`enElAire` de `bandeja-capturas.tsx`): el marco la usa para preguntar
   * antes de cambiar de cotización.
   */
  avisarEnElAire: (enElAire: boolean) => void
}

export const MarcoCotizacionContexto = createContext<ContextoMarcoCotizacion | null>(null)

/** La variable CSS con el alto del encabezado fijo: la zona de pegado se pega debajo. */
export const VAR_ALTO_ENCABEZADO = '--alto-encabezado-negocio'
