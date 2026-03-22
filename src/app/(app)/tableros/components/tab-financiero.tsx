'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Line, ComposedChart, Cell,
} from 'recharts'
import type { FinancieroData } from '../types'
import { StatHero } from './stat-hero'
import { ChartCard } from './chart-card'
import { MiniTable } from './mini-table'

const GREEN = '#10B981'
const GREEN_LIGHT = '#D1FAE5'
const GRAY = '#E5E7EB'
const RED = '#EF4444'

function formatCOP(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function TabFinanciero({ data }: { data: FinancieroData }) {
  const diffEmoji = Math.abs(data.diferenciaTeoricoReal) <= 50000 ? '' : ''

  return (
    <div className="space-y-6">
      {/* Hero: Saldo + Runway */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ChartCard title="Saldo actual" className="md:col-span-1">
          <StatHero label="" value={formatCOP(data.saldoActual)} />
          {data.diferenciaTeoricoReal !== 0 && (
            <p className="text-sm text-gray-500 mt-2">
              Diferencia teorico: <span className={Math.abs(data.diferenciaTeoricoReal) > 50000 ? 'text-amber-600 font-semibold' : 'text-gray-600'}>
                {data.diferenciaTeoricoReal >= 0 ? '+' : ''}{formatCOP(data.diferenciaTeoricoReal)}
              </span>
            </p>
          )}
        </ChartCard>
        <ChartCard title="Runway" className="md:col-span-1">
          <StatHero
            label=""
            value={data.runwayMeses >= 99 ? '99+' : data.runwayMeses.toFixed(1)}
            suffix="meses"
          />
        </ChartCard>
        <ChartCard title="Costos fijos mensuales" className="md:col-span-1">
          <StatHero label="" value={formatCOP(data.costosFijos)} />
          <div className="mt-3 space-y-1 text-sm text-gray-500">
            <div className="flex justify-between">
              <span>Nomina</span>
              <span className="font-medium text-gray-700">{formatCOP(data.componenteNomina)}</span>
            </div>
            <div className="flex justify-between">
              <span>Operativo</span>
              <span className="font-medium text-gray-700">{formatCOP(data.componenteOperativo)}</span>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Ingresos vs Egresos trend */}
      {data.ingresosVsEgresos.length > 0 && (
        <ChartCard
          title="Ingresos vs Egresos"
          subtitle={`Margen promedio: ${data.margenPromedio.toFixed(0)}%`}
        >
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.ingresosVsEgresos} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCOP(v)} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                  formatter={(value, name) => [formatCOP(Number(value)), name === 'ingresos' ? 'Ingresos' : name === 'egresos' ? 'Egresos' : 'Margen']}
                />
                <Bar dataKey="ingresos" name="ingresos" fill={GREEN} radius={[4, 4, 0, 0]} barSize={24} yAxisId="left" />
                <Bar dataKey="egresos" name="egresos" fill={GRAY} radius={[4, 4, 0, 0]} barSize={24} yAxisId="left" />
                <Line
                  type="monotone"
                  dataKey="margen"
                  name="margen"
                  stroke="#6B7280"
                  strokeWidth={2}
                  dot={false}
                  yAxisId="right"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* Top categorias gasto */}
      {data.topCategoriasGasto.length > 0 && (
        <ChartCard title="Top categorias de gasto" subtitle="Este mes vs anterior">
          <div className="space-y-3">
            {data.topCategoriasGasto.map((cat, i) => {
              const maxVal = Math.max(data.topCategoriasGasto[0]?.monto || 1, data.topCategoriasGasto[0]?.montoAnterior || 1)
              const pctCurr = maxVal > 0 ? (cat.monto / maxVal) * 100 : 0
              const pctPrev = maxVal > 0 ? (cat.montoAnterior / maxVal) * 100 : 0
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-900">{cat.categoria}</span>
                    <span className="text-gray-600">{formatCOP(cat.monto)}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pctCurr}%`, backgroundColor: GREEN }} />
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pctPrev}%`, backgroundColor: GRAY }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </ChartCard>
      )}

      {/* Facturado vs Cobrado */}
      {data.facturadoVsCobrado.length > 0 && (
        <ChartCard title="Facturado vs Cobrado" subtitle="Por proyecto">
          <MiniTable
            columns={[
              { key: 'nombre', label: 'Proyecto' },
              { key: 'facturado', label: 'Facturado', align: 'right', render: (v: number) => formatCOP(v) },
              { key: 'cobrado', label: 'Cobrado', align: 'right', render: (v: number) => formatCOP(v) },
              {
                key: 'cartera',
                label: 'Cartera',
                align: 'right',
                render: (v: number) => (
                  <span className={v > 0 ? 'text-amber-600 font-semibold' : 'text-gray-500'}>
                    {formatCOP(v)}
                  </span>
                ),
              },
            ]}
            data={data.facturadoVsCobrado}
          />
        </ChartCard>
      )}

      {/* Impuestos estimados */}
      {data.impuestos && (
        <ChartCard title="Impuestos estimados" subtitle="Basado en ingresos del mes">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-500">ReteFuente</p>
              <p className="text-xl font-bold text-gray-900">{formatCOP(data.impuestos.reteFuente)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">ICA</p>
              <p className="text-xl font-bold text-gray-900">{formatCOP(data.impuestos.ica)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">IVA</p>
              <p className="text-xl font-bold text-gray-900">{formatCOP(data.impuestos.iva)}</p>
            </div>
          </div>
        </ChartCard>
      )}
    </div>
  )
}
