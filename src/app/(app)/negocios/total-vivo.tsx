'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

/**
 * El total de la cotización abierta, recién leído por el editor, para la columna de la derecha
 * (la lista de cotizaciones del negocio de viaje, `panel-viaje.tsx`).
 *
 * La columna y el editor son hermanos dentro del marco del negocio: la columna lee
 * `cotizaciones.valor_total` de la carga de la página, que solo cambia con el refresco. Cuando
 * el editor tiene una lectura propia más nueva (`vista-fresca.ts`), publica aquí su total y la
 * columna lo pinta para ESA cotización. Sin proveedor (la página del negocio), nada cambia.
 */

export interface TotalVivo {
  cotizacionId: string
  valorTotal: number | null
}

interface Contexto {
  total: TotalVivo | null
  publicar: (t: TotalVivo | null) => void
}

/** Exportado para las pruebas de la columna; el producto usa `ProveedorTotalVivo`. */
export const TotalVivoContexto = createContext<Contexto | null>(null)

export function ProveedorTotalVivo({ children }: { children: ReactNode }) {
  const [total, publicar] = useState<TotalVivo | null>(null)
  return <TotalVivoContexto.Provider value={{ total, publicar }}>{children}</TotalVivoContexto.Provider>
}

/** El total que la columna pinta para una cotización: el vivo si es de ella, el de la página si no. */
export function totalParaLaLista(
  cotizacionId: string,
  deLaPagina: number | null,
  vivo: TotalVivo | null,
): number | null {
  return vivo && vivo.cotizacionId === cotizacionId ? vivo.valorTotal : deLaPagina
}

export function useTotalVivo(): TotalVivo | null {
  return useContext(TotalVivoContexto)?.total ?? null
}

/** Para el editor. Sin proveedor devuelve una función que no hace nada. */
export function usePublicarTotalVivo(): (t: TotalVivo | null) => void {
  return useContext(TotalVivoContexto)?.publicar ?? sinProveedor
}

function sinProveedor() {}
