'use client'

/**
 * Equipo cuando el workspace lleva DOS equipos con indicadores propios.
 *
 * Comercial y operaciones no se miden con lo mismo: al comercial se le mide la venta
 * (casos vendidos, recaudo, cumplimiento de meta) y a operaciones el trabajo sobre el
 * caso ya vendido (radicación a tiempo, reprocesos, carga). Mostrarlos en una sola
 * lista obliga a comparar cosas que no se comparan.
 *
 * Cada pestaña reusa la vista que ya existía para ese equipo; aquí no se inventa un
 * indicador nuevo, solo se dejan de mezclar.
 */

import { useState } from 'react'
import EquipoComercialPersonasClient from './equipo-comercial-personas-client'
import { TabOperacionesPersonas } from '../tableros/components/tab-operaciones-personas'
import type { ComercialResumenRow, ComercialMesResponse } from './comercial-types'
import type { OperacionesBonoData } from '../tableros/operaciones-types'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'

type Equipo = 'comercial' | 'operaciones'

interface Props {
  comercial: {
    resumen: ComercialResumenRow[]
    mesData: ComercialMesResponse | null
    anio: number
    mes: number
    metasPorVendedor: [string, number][]
  }
  operaciones: OperacionesBonoData | null
  /** Pestaña inicial: la del área de quien mira, cuando se puede resolver. */
  inicial?: Equipo
}

export default function EquiposClient({ comercial, operaciones, inicial }: Props) {
  const [equipo, setEquipo] = useState<Equipo>(inicial ?? 'comercial')

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-lg bg-gray-100 p-0.5" style={{ width: 'fit-content' }}>
        {([
          { key: 'comercial' as const, label: 'Comercial' },
          { key: 'operaciones' as const, label: 'Operaciones' },
        ]).map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setEquipo(o.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              equipo === o.key ? 'bg-white shadow-sm' : ''
            }`}
            style={{ color: equipo === o.key ? CARBON : GRIS }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {equipo === 'comercial' ? (
        <EquipoComercialPersonasClient
          resumen={comercial.resumen}
          mesData={comercial.mesData}
          anio={comercial.anio}
          mes={comercial.mes}
          metasPorVendedor={comercial.metasPorVendedor}
        />
      ) : operaciones ? (
        <TabOperacionesPersonas data={operaciones} />
      ) : (
        // Sin datos NO se pinta un tablero en ceros: eso se leería como un mes sin
        // errores y sin trabajo, que es lo contrario de "todavía no hay medición".
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">
            Todavía no hay indicadores de operaciones para este periodo.
          </p>
        </div>
      )}
    </div>
  )
}
