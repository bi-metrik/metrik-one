'use client'

import { useState } from 'react'
import { Receipt, Clock, Banknote, History } from 'lucide-react'

const CATEGORIA_LABELS: Record<string, string> = {
  materiales: 'Materiales',
  transporte: 'Transporte',
  alimentacion: 'Alimentación',
  servicios_profesionales: 'Servicios profesionales',
  software: 'Software',
  arriendo: 'Arriendo',
  marketing: 'Marketing',
  capacitacion: 'Capacitación',
  otros: 'Otros',
}

export interface HistorialData {
  gastos: Array<{
    id: string
    descripcion: string | null
    monto: number
    categoria: string
    fecha: string
  }>
  horas: Array<{
    id: string
    descripcion: string | null
    horas: number
    fecha: string
    staff_nombre: string | null
  }>
  cobros: Array<{
    id: string
    notas: string | null
    monto: number
    fecha: string | null
    estado_causacion: string
    tipo_cobro: string | null
  }>
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function BloqueHistorial({ data }: { data: HistorialData }) {
  const [activeTab, setActiveTab] = useState<'gastos' | 'horas' | 'cobros'>('gastos')

  const totalGastos = data.gastos.reduce((s, g) => s + g.monto, 0)
  const totalHoras = data.horas.reduce((s, h) => s + h.horas, 0)
  const totalCobros = data.cobros.reduce((s, c) => s + c.monto, 0)

  const hayDatos = data.gastos.length > 0 || data.horas.length > 0 || data.cobros.length > 0

  if (!hayDatos) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <History className="h-8 w-8 text-[#6B7280]/20" />
        <p className="text-xs text-[#6B7280]">Sin registros financieros aún</p>
        <p className="text-[11px] text-[#6B7280]/60">
          Gastos, horas y cobros aparecerán aquí conforme se registren
        </p>
      </div>
    )
  }

  const tabs = [
    { key: 'gastos' as const, label: 'Gastos', count: data.gastos.length, total: fmt(totalGastos), icon: Receipt, color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
    { key: 'horas' as const, label: 'Horas', count: data.horas.length, total: `${totalHoras}h`, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
    { key: 'cobros' as const, label: 'Cobros', count: data.cobros.length, total: fmt(totalCobros), icon: Banknote, color: 'text-green-600', bg: 'bg-green-50 border-green-100' },
  ]

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-[#F3F4F6] p-0.5">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-md px-2 py-1.5 text-center transition-colors ${
              activeTab === tab.key
                ? 'bg-white shadow-sm'
                : 'hover:bg-white/50'
            }`}
          >
            <div className="flex items-center justify-center gap-1">
              <tab.icon className={`h-3 w-3 ${activeTab === tab.key ? tab.color : 'text-[#6B7280]'}`} />
              <span className={`text-[11px] font-medium ${activeTab === tab.key ? 'text-[#1A1A1A]' : 'text-[#6B7280]'}`}>
                {tab.label}
              </span>
              <span className="text-[10px] text-[#6B7280]/60">({tab.count})</span>
            </div>
            <p className={`text-[10px] tabular-nums mt-0.5 ${activeTab === tab.key ? tab.color : 'text-[#6B7280]/60'}`}>
              {tab.total}
            </p>
          </button>
        ))}
      </div>

      {/* Gastos */}
      {activeTab === 'gastos' && (
        <div className="space-y-0.5 max-h-72 overflow-y-auto">
          {data.gastos.length === 0 ? (
            <p className="text-[11px] text-[#6B7280] text-center py-4">Sin gastos registrados</p>
          ) : data.gastos.map(g => (
            <div key={g.id} className="flex items-center justify-between text-[11px] py-1.5 border-b border-[#E5E7EB]/50 last:border-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[#6B7280]/60 tabular-nums shrink-0 w-[70px]">{g.fecha}</span>
                <span className="text-[10px] text-[#6B7280] bg-[#F3F4F6] rounded px-1.5 py-0.5 shrink-0">
                  {CATEGORIA_LABELS[g.categoria] ?? g.categoria}
                </span>
                {g.descripcion && <span className="text-[#1A1A1A] truncate">{g.descripcion}</span>}
              </div>
              <span className="text-red-600 font-medium tabular-nums ml-2 shrink-0">{fmt(g.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Horas */}
      {activeTab === 'horas' && (
        <div className="space-y-0.5 max-h-72 overflow-y-auto">
          {data.horas.length === 0 ? (
            <p className="text-[11px] text-[#6B7280] text-center py-4">Sin horas registradas</p>
          ) : data.horas.map(h => (
            <div key={h.id} className="flex items-center justify-between text-[11px] py-1.5 border-b border-[#E5E7EB]/50 last:border-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[#6B7280]/60 tabular-nums shrink-0 w-[70px]">{h.fecha}</span>
                {h.staff_nombre && <span className="font-medium text-[#1A1A1A] shrink-0">{h.staff_nombre}</span>}
                {h.descripcion && <span className="text-[#6B7280] truncate">{h.descripcion}</span>}
              </div>
              <span className="text-blue-600 font-medium tabular-nums ml-2 shrink-0">{h.horas}h</span>
            </div>
          ))}
        </div>
      )}

      {/* Cobros */}
      {activeTab === 'cobros' && (
        <div className="space-y-0.5 max-h-72 overflow-y-auto">
          {data.cobros.length === 0 ? (
            <p className="text-[11px] text-[#6B7280] text-center py-4">Sin cobros registrados</p>
          ) : data.cobros.map(c => (
            <div key={c.id} className="flex items-center justify-between text-[11px] py-1.5 border-b border-[#E5E7EB]/50 last:border-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[#6B7280]/60 tabular-nums shrink-0 w-[70px]">{c.fecha ?? '—'}</span>
                {c.tipo_cobro && c.tipo_cobro !== 'regular' && (
                  <span className="text-[10px] bg-[#F3F4F6] rounded px-1.5 py-0.5 shrink-0 capitalize">{c.tipo_cobro}</span>
                )}
                {c.notas && <span className="text-[#1A1A1A] truncate">{c.notas}</span>}
                <span className={`text-[10px] shrink-0 ${
                  c.estado_causacion === 'APROBADO' || c.estado_causacion === 'CAUSADO'
                    ? 'text-green-600' : c.estado_causacion === 'PENDIENTE'
                    ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {c.estado_causacion === 'CAUSADO' || c.estado_causacion === 'APROBADO' ? '✓' : c.estado_causacion === 'PENDIENTE' ? '⏳' : '✗'}
                </span>
              </div>
              <span className="text-green-600 font-medium tabular-nums ml-2 shrink-0">{fmt(c.monto)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
