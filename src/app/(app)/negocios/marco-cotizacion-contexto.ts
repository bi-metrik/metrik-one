'use client'

import { createContext } from 'react'

/**
 * La cotización de viaje se está pintando dentro del marco del negocio
 * (`NegocioDetailClient` con `centro`): mismo encabezado y mismo panel que la página del
 * negocio. `null` = sin marco, y la cotización se pinta como siempre (R6).
 */
export interface ContextoMarcoCotizacion {
  activo: true
}

export const MarcoCotizacionContexto = createContext<ContextoMarcoCotizacion | null>(null)

/** La variable CSS con el alto del encabezado fijo: la zona de pegado se pega debajo. */
export const VAR_ALTO_ENCABEZADO = '--alto-encabezado-negocio'
