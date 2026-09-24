'use client'

// Los votos entre fuentes del negocio que se está pintando, repartidos por contexto para
// que cada bloque de documento muestre, junto a su campo, si otro documento lo respalda o
// lo contradice. Se reparte por contexto en vez de hilarlo por BloqueCard → BloqueRenderer
// → cada bloque (mismo criterio que `AlmacenamientoExternoProvider`). Sin proveedor, la
// lista es vacía y el bloque se pinta como siempre.

import { createContext, useContext, type ReactNode } from 'react'
import type { LecturaFuente, ResultadoVoto } from './votos'

const LecturasContext = createContext<ResultadoVoto[]>([])

export function LecturasProvider({ lecturas, children }: { lecturas: ResultadoVoto[]; children: ReactNode }) {
  return <LecturasContext.Provider value={lecturas}>{children}</LecturasContext.Provider>
}

export function useLecturas(): ResultadoVoto[] {
  return useContext(LecturasContext)
}

/**
 * La lectura de un campo de un documento, si algún voto la usa. Se reconoce por el
 * ARCHIVO y no por el id del bloque: una copia heredada en otra etapa pinta el archivo
 * del origen con otra fila, y el voto siempre lee el origen.
 */
export function lecturaDeCampo(
  lecturas: ResultadoVoto[],
  archivo: unknown,
  field: string,
): { voto: ResultadoVoto; fuente: LecturaFuente } | null {
  if (typeof archivo !== 'string' || !archivo) return null
  for (const voto of lecturas) {
    const fuente = voto.fuentes.find(f => f.archivo === archivo && f.field === field)
    if (fuente) return { voto, fuente }
  }
  return null
}
