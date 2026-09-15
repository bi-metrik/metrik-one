'use client'

// ¿El negocio que se está pintando guarda sus archivos en almacenamiento externo?
//
// Lo decide el servidor (página del negocio) y se reparte por contexto en vez de
// hilarlo como prop por BloqueCard → BloqueRenderer → cada bloque. El valor por
// defecto es `false`: cualquier pantalla que monte un bloque de documentos sin el
// proveedor se comporta exactamente como antes (Drive).

import { createContext, useContext, type ReactNode } from 'react'

const AlmacenamientoExternoContext = createContext(false)

export function AlmacenamientoExternoProvider({
  externo,
  children,
}: {
  externo: boolean
  children: ReactNode
}) {
  return <AlmacenamientoExternoContext.Provider value={externo}>{children}</AlmacenamientoExternoContext.Provider>
}

export function useAlmacenamientoExterno(): boolean {
  return useContext(AlmacenamientoExternoContext)
}
