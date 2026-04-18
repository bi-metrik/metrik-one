'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell,
} from 'recharts'
import type { ComercialData } from '../types'
import { StatHero } from './stat-hero'
import { ChartCard } from './chart-card'
import { ProgressGauge } from './progress-gauge'
import { AlertCard } from './alert-card'

const GREEN = '#10B981'
const GREEN_LIGHT = '#D1FAE5'
const GREEN_MED = '#6EE7B7'
const GREEN_BRIGHT = '#34D399'
const YELLOW = '#F59E0B'
const BLUE = '#3B82F6'

const ETAPA_COLORS: Record<string, string> = {
  Lead: GREEN_LIGHT,
  Prospecto: GREEN_MED,
  Propuesta: GREEN_BRIGHT,
  Negociacion: GREEN,
}

function formatCOP(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function TabComercial({ data }: { data: ComercialData }) {
  const metaPct = data.metaRecaudo && data.metaRecaudo > 0
    ? (data.recaudoMes / data.metaRecaudo) * 100
    : null

  const pipelineActivo = data.pipeline.filter(p => p.count > 0 || p.valor > 0)

  return (
    <div className="space-y-6">

      {/* C1 — Recaudo vs Meta */}
      <ChartCard title="Recaudo del mes" accentColor={BLUE}>
        <StatHero
          label=""
          value={formatCOP(data.recaudoMes)}
          delta={data.recaudoDelta}
          deltaLabel="vs mes anterior"
        />
        {metaPct !== null && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{formatCOP(data.recaudoMes)}</span>
              <span>Meta: {formatCOP(data.metaRecaudo!)}</span>
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
            <p className="text-xs text-gray-400 mt-1">
              {metaPct.toFixed(0)}% de la meta &bull; Faltan {data.diasRestantesMes} dias del mes
            </p>
          </div>
        )}
        {metaPct === null && (
          <p className="text-xs text-gray-400 mt-2">Faltan {data.diasRestantesMes} dias del mes</p>
        )}
      </ChartCard>

      {/* C3 — Oportunidades urgentes */}
      <AlertCard
        title="Oportunidades que requieren atencion"
        emptyMessage="Todas las oportunidades al dia"
        items={data.oportunidadesUrgentes.map(o => ({
          label: `${o.nombre}${o.empresa ? ` — ${o.empresa}` : ''}`,
          badges: [
            ...(o.razones.includes('estancada') ? [{
              text: `${o.diasSinMovimiento}d sin movimiento`,
              variant: 'yellow' as const,
            }] : []),
            ...(o.razones.includes('cierre_proximo') ? [{
              text: 'Cierre este mes',
              variant: 'red' as const,
            }] : []),
            ...(o.razones.includes('alto_valor') ? [{
              text: 'Alto valor',
              variant: 'blue' as const,
            }] : []),
          ],
        }))}
      />

      {/* C2 — Pipeline activo */}
      {pipelineActivo.length > 0 && (
        <ChartCard
          title="Pipeline activo"
          subtitle={`${pipelineActivo.reduce((s, p) => s + p.count, 0)} oportunidades`}
          accentColor={BLUE}
        >
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pipelineActivo} layout="vertical" margin={{ left: 0, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="#F3F4F6" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCOP(v)} />
                <YAxis dataKey="etapa" type="category" width={90} tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                  formatter={(value, name, props) => [
                    `${formatCOP(Number(value))} (${props.payload?.count || 0} ops)`,
                    'Pipeline',
                  ]}
                />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                  {pipelineActivo.map((entry, i) => (
                    <Cell key={i} fill={ETAPA_COLORS[entry.etapa] || GREEN} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* C4 + C5 — Conversion y Ritmo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* C4 — Conversion */}
        <ChartCard title="Conversion" accentColor={BLUE}>
          <ProgressGauge label="Tasa de cierre" value={data.conversionRate} />
          <div className="flex gap-3 mt-4">
            <span className="text-sm font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700">
              Ganadas: {data.ganados}
            </span>
            <span className="text-sm font-semibold px-3 py-1 rounded-full bg-red-50 text-red-700">
              Perdidas: {data.perdidos}
            </span>
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

        {/* C5 — Ritmo del embudo */}
        {data.ritmoPipeline ? (
          <ChartCard title="Ritmo del embudo" accentColor={GREEN}>
            <div className="space-y-3 text-sm text-gray-600 leading-relaxed">
              <p>
                Tus oportunidades pasan en promedio{' '}
                <span className="text-2xl font-bold text-emerald-600">{data.ritmoPipeline.diasPromedioEtapaMasLenta}</span>
                {' '}dias en{' '}
                <span className="font-bold text-emerald-600">{data.ritmoPipeline.etapaMasLenta}</span>.
              </p>
              <p>
                Esta semana moviste{' '}
                <span className="text-2xl font-bold text-emerald-600">{data.ritmoPipeline.transicionesEstaSemana}</span>
                {' '}oportunidades.
              </p>
              <p>
                El mes pasado cerraste{' '}
                <span className="text-2xl font-bold text-emerald-600">{data.ritmoPipeline.cierresMesAnterior}</span>
                {' '}negocios en{' '}
                <span className="text-2xl font-bold text-emerald-600">{data.ritmoPipeline.diasPromedioCierre}</span>
                {' '}dias promedio.
              </p>
            </div>
          </ChartCard>
        ) : (
          <ChartCard title="Ritmo del embudo" accentColor={GREEN}>
            <p className="text-sm text-gray-400 py-4">
              Registra movimientos en el pipeline para ver el ritmo del embudo.
            </p>
          </ChartCard>
        )}
      </div>

      {/* C6 — ROI por canal (condicional N>=10) */}
      {data.canalesAdquisicion && data.canalesAdquisicion.length > 0 && (
        <ChartCard
          title="Conversion por canal"
          subtitle={`Solo canales con datos suficientes (${data.totalOportunidadesCerradas} oportunidades cerradas)`}
          accentColor={BLUE}
        >
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.canalesAdquisicion} layout="vertical" margin={{ left: 0, right: 40 }}>
                <CartesianGrid horizontal={false} stroke="#F3F4F6" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                  domain={[0, 100]}
                />
                <YAxis dataKey="canal" type="category" width={90} tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                  formatter={(value) => [`${Number(value).toFixed(0)}%`, 'Conversion']}
                />
                <Bar dataKey="conversionRate" radius={[0, 4, 4, 0]}>
                  {data.canalesAdquisicion.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        entry.conversionRate > 30 ? GREEN
                          : entry.conversionRate >= 15 ? YELLOW
                          : BLUE
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}
    </div>
  )
}
