'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, PieChart, Pie,
} from 'recharts'
import type { ComercialData } from '../types'
import { StatHero } from './stat-hero'
import { ChartCard } from './chart-card'
import { MiniTable } from './mini-table'

const GREEN = '#10B981'
const GRAY = '#E5E7EB'
const RED = '#EF4444'
const YELLOW = '#F59E0B'
const BLUE = '#3B82F6'

const CARTERA_COLORS = [GREEN, YELLOW, '#F97316', RED]

function formatCOP(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function TabComercial({ data }: { data: ComercialData }) {
  const pipelineActivo = data.pipeline.filter(p => !['Ganado', 'Perdido'].includes(p.etapa))
  const metaPct = data.metaVentas && data.metaVentas > 0
    ? (data.ventasMes / data.metaVentas) * 100
    : null

  const donutData = [
    { name: 'Ganadas', value: data.ganados, fill: GREEN },
    { name: 'Perdidas', value: data.perdidos, fill: RED },
  ].filter(d => d.value > 0)

  const carteraData = [
    { rango: '0-30d', value: data.cartera.rango_0_30 },
    { rango: '31-60d', value: data.cartera.rango_31_60 },
    { rango: '61-90d', value: data.cartera.rango_61_90 },
    { rango: '90+d', value: data.cartera.rango_90_plus },
  ]

  return (
    <div className="space-y-6">
      {/* Hero: Ventas vs Meta */}
      <ChartCard title="Ventas del mes" subtitle={metaPct !== null ? `${metaPct.toFixed(0)}% de la meta` : undefined}>
        <StatHero
          label=""
          value={formatCOP(data.ventasMes)}
          delta={data.ventasDelta}
          deltaLabel="vs mes anterior"
        />
        {metaPct !== null && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{formatCOP(data.ventasMes)}</span>
              <span>Meta: {formatCOP(data.metaVentas!)}</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden bg-gray-100">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(metaPct, 100)}%`,
                  backgroundColor: metaPct >= 100 ? GREEN : metaPct >= 70 ? YELLOW : '#6B7280',
                }}
              />
            </div>
          </div>
        )}
      </ChartCard>

      {/* Funnel */}
      <ChartCard title="Pipeline activo" subtitle={`${pipelineActivo.reduce((s, p) => s + p.count, 0)} oportunidades`}>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pipelineActivo} layout="vertical" margin={{ left: 0, right: 16 }}>
              <CartesianGrid horizontal={false} stroke="#F3F4F6" />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
              <YAxis dataKey="etapa" type="category" width={90} tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                formatter={(value) => [formatCOP(Number(value)), 'Valor']}
              />
              <Bar dataKey="valor" radius={[0, 4, 4, 0]} fill={GREEN} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* Conversion + Close Time */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="Conversion">
          <div className="flex items-center gap-6">
            <div className="h-[120px] w-[120px]">
              {donutData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {donutData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-gray-400">Sin datos</div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-2xl font-bold text-gray-900">{data.conversionRate.toFixed(0)}%</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GREEN }} />
                  <span className="text-gray-600">Ganadas: {data.ganados}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RED }} />
                  <span className="text-gray-600">Perdidas: {data.perdidos}</span>
                </div>
              </div>
            </div>
          </div>
          {data.razonesPerdida.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Razones de perdida</p>
              <div className="space-y-1">
                {data.razonesPerdida.slice(0, 3).map((r, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-600">{r.razon}</span>
                    <span className="font-medium text-gray-900">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Tiempo promedio de cierre">
          <StatHero
            label=""
            value={`${data.avgCloseTimeDays}`}
            suffix="dias"
          />
        </ChartCard>
      </div>

      {/* Top 5 Opportunities */}
      <ChartCard title="Top oportunidades abiertas">
        <MiniTable
          columns={[
            { key: 'nombre', label: 'Oportunidad' },
            { key: 'empresa', label: 'Empresa' },
            { key: 'valor', label: 'Valor', align: 'right', render: (v: number) => formatCOP(v) },
            { key: 'etapa', label: 'Etapa' },
            { key: 'diasAbierta', label: 'Dias', align: 'right', render: (v: number) => `${v}d` },
          ]}
          data={data.topOportunidades}
          emptyMessage="Sin oportunidades abiertas"
        />
      </ChartCard>

      {/* Cartera */}
      <ChartCard title="Cartera por antiguedad" subtitle={`Total: ${formatCOP(data.cartera.total)}`}>
        <div className="h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={carteraData} margin={{ left: 0, right: 16 }}>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="rango" tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCOP(v)} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                formatter={(value) => [formatCOP(Number(value)), 'Cartera']}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {carteraData.map((_, i) => (
                  <Cell key={i} fill={CARTERA_COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  )
}
