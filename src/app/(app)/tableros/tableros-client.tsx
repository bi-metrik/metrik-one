'use client'

import { useState, useTransition } from 'react'
import type { ComercialData, OperativoData, FinancieroData, Periodo } from './types'
import { TabComercial } from './components/tab-comercial'
import { TabOperativo } from './components/tab-operativo'
import { TabFinanciero } from './components/tab-financiero'
import { getComercialData, getOperativoData, getFinancieroData } from './actions'

type TabKey = 'financiero' | 'comercial' | 'operativo'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'financiero', label: 'Financiero' },
  { key: 'comercial', label: 'Comercial' },
  { key: 'operativo', label: 'Operativo' },
]

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'mes', label: 'Este mes' },
  { key: 'trimestre', label: 'Trimestre' },
  { key: '6meses', label: '6 meses' },
  { key: 'anio', label: 'Anual' },
]

interface TablerosClientProps {
  initialComercial: ComercialData | null
  initialOperativo: OperativoData | null
  initialFinanciero: FinancieroData | null
}

export default function TablerosClient({
  initialComercial,
  initialOperativo,
  initialFinanciero,
}: TablerosClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('financiero')
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [isPending, startTransition] = useTransition()

  const [comercial, setComercial] = useState(initialComercial)
  const [operativo, setOperativo] = useState(initialOperativo)
  const [financiero, setFinanciero] = useState(initialFinanciero)

  function handlePeriodoChange(p: Periodo) {
    setPeriodo(p)
    startTransition(async () => {
      if (activeTab === 'comercial') {
        const data = await getComercialData(p)
        if (data) setComercial(data)
      } else if (activeTab === 'operativo') {
        const data = await getOperativoData(p)
        if (data) setOperativo(data)
      } else {
        const data = await getFinancieroData(p)
        if (data) setFinanciero(data)
      }
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tableros</h1>
        <p className="text-sm text-gray-500 mt-1">Indicadores de gestion en tiempo real</p>
      </div>

      {/* Sticky tab bar + periodo */}
      <div className="sticky top-0 z-10 bg-[#F9FAFB] pt-1 pb-4 -mx-6 px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Tabs */}
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Periodo selector */}
        <div className="flex gap-1">
          {PERIODOS.map(p => (
            <button
              key={p.key}
              onClick={() => handlePeriodoChange(p.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                periodo === p.key
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className={`transition-opacity duration-200 ${isPending ? 'opacity-50' : 'opacity-100'}`}>
        {activeTab === 'financiero' && financiero && <TabFinanciero data={financiero} />}
        {activeTab === 'comercial' && comercial && <TabComercial data={comercial} />}
        {activeTab === 'operativo' && operativo && <TabOperativo data={operativo} />}

        {/* Empty state */}
        {activeTab === 'financiero' && !financiero && <EmptyState />}
        {activeTab === 'comercial' && !comercial && <EmptyState />}
        {activeTab === 'operativo' && !operativo && <EmptyState />}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-lg font-medium text-gray-400">Sin datos suficientes</p>
      <p className="text-sm text-gray-400 mt-1">Registra movimientos para ver tus indicadores aqui.</p>
    </div>
  )
}
