'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ComposedChart, ReferenceLine,
} from 'recharts'
import type { FinancieroData } from '../types'
import { StatHero } from './stat-hero'
import { ChartCard } from './chart-card'
import { MiniTable } from './mini-table'
import { AlertCard } from './alert-card'

const GREEN = '#10B981'
const SLATE = '#64748B'
const RED = '#EF4444'

function formatCOP(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function TabFinanciero({ data }: { data: FinancieroData }) {
  const flujoColor = data.flujoNeto >= 0 ? 'text-emerald-600' : 'text-red-600'
  const runwayColor = data.runwayMeses >= 6 ? 'text-emerald-600' : data.runwayMeses >= 3 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-6">

      {/* F1 — Flujo neto del mes (hero ancho completo) */}
      <ChartCard
        title="Flujo neto del mes"
        accentColor={data.flujoNeto >= 0 ? GREEN : RED}
      >
        <div className="flex items-end gap-4">
          <div>
            <span className={`text-4xl font-bold ${flujoColor}`}>
              {formatCOP(data.flujoNeto)}
            </span>
          </div>
          {data.flujoNetoDelta !== 0 && (
            <span className={`mb-1 text-sm font-semibold px-2 py-0.5 rounded-full ${
              data.flujoNetoDelta > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}>
              {data.flujoNetoDelta > 0 ? '+' : ''}{data.flujoNetoDelta.toFixed(0)}% vs mes anterior
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mt-1">Ingresos menos egresos registrados este mes</p>
      </ChartCard>

      {/* F2 — Saldo + Runway */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="Saldo actual" accentColor={GREEN}>
          <StatHero label="" value={formatCOP(data.saldoActual)} />
          {Math.abs(data.diferenciaTeoricoReal) > 50000 && (
            <p className="text-sm text-amber-600 mt-2">
              Diferencia teorico/real: {data.diferenciaTeoricoReal >= 0 ? '+' : ''}{formatCOP(data.diferenciaTeoricoReal)}
            </p>
          )}
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1 text-sm text-gray-500">
            <div className="flex justify-between">
              <span>Nomina</span>
              <span className="font-medium text-gray-700">{formatCOP(data.componenteNomina)}</span>
            </div>
            <div className="flex justify-between">
              <span>Operativo fijo</span>
              <span className="font-medium text-gray-700">{formatCOP(data.componenteOperativo)}</span>
            </div>
            <div className="flex justify-between font-semibold text-gray-700">
              <span>Total fijos</span>
              <span>{formatCOP(data.costosFijos)}</span>
            </div>
          </div>
        </ChartCard>

        <ChartCard title="Runway" accentColor={data.runwayMeses >= 6 ? GREEN : data.runwayMeses >= 3 ? '#F59E0B' : RED}>
          <p className={`text-4xl font-bold ${runwayColor}`}>
            {data.runwayMeses >= 99 ? '99+' : data.runwayMeses.toFixed(1)}
            <span className="text-lg font-medium text-gray-500 ml-2">meses</span>
          </p>
          <p className="text-sm text-gray-500 mt-2">
            {data.runwayMeses >= 6
              ? 'Caja saludable — mas de 6 meses de operacion'
              : data.runwayMeses >= 3
              ? 'Caja moderada — entre 3 y 6 meses'
              : 'Caja baja — menos de 3 meses'}
          </p>
        </ChartCard>
      </div>

      {/* F3 — Ingresos vs Egresos con breakeven */}
      {data.ingresosVsEgresos.length > 0 && (
        <ChartCard
          title="Ingresos vs Egresos"
          subtitle={`${data.margenPromedio.toFixed(0)}% margen prom.`}
          accentColor={GREEN}
        >
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.ingresosVsEgresos} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCOP(v)} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                  formatter={(value, name) => [
                    formatCOP(Number(value)),
                    name === 'ingresos' ? 'Ingresos' : 'Egresos',
                  ]}
                />
                <Bar dataKey="ingresos" name="ingresos" fill={GREEN} radius={[4, 4, 0, 0]} barSize={24} />
                <Bar dataKey="egresos" name="egresos" fill={SLATE} radius={[4, 4, 0, 0]} barSize={24} />
                {data.costosFijos > 0 && (
                  <ReferenceLine
                    y={data.costosFijos}
                    stroke={RED}
                    strokeDasharray="4 4"
                    label={{ value: 'Breakeven', position: 'insideTopRight', fontSize: 11, fill: RED }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* F4 — Cartera pendiente */}
      {data.carteraPendiente.length > 0 && (
        <ChartCard title="Cartera pendiente" subtitle="Proyectos con saldo por cobrar" accentColor="#F59E0B">
          <MiniTable
            columns={[
              { key: 'nombre', label: 'Proyecto' },
              {
                key: 'facturado',
                label: 'Facturado',
                align: 'right',
                render: (v: number) => (
                  <span className="hidden sm:inline">{formatCOP(v)}</span>
                ),
              },
              {
                key: 'cobrado',
                label: 'Cobrado',
                align: 'right',
                render: (v: number) => (
                  <span className="hidden sm:inline">{formatCOP(v)}</span>
                ),
              },
              {
                key: 'cartera',
                label: 'Pendiente',
                align: 'right',
                render: (v: number) => (
                  <span className="font-semibold text-amber-600">{formatCOP(v)}</span>
                ),
              },
              {
                key: 'diasAtraso',
                label: 'Antiguedad',
                align: 'right',
                render: (v: number) => (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    v > 60 ? 'bg-red-50 text-red-700' : v > 30 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
                  }`}>
                    {v}d
                  </span>
                ),
              },
            ]}
            data={data.carteraPendiente}
          />
        </ChartCard>
      )}

      {/* F5 — Posicion neta de caja */}
      <ChartCard
        title="Posicion neta de caja"
        accentColor={data.posicionNetaCaja >= 0 ? GREEN : RED}
      >
        <div className="flex items-end gap-4">
          <span className={`text-4xl font-bold ${data.posicionNetaCaja >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {formatCOP(data.posicionNetaCaja)}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Por cobrar: {formatCOP(data.totalCarteraCobrar)} &nbsp;/&nbsp; Por pagar: {formatCOP(data.totalGastosPorPagar)}
        </p>
      </ChartCard>

      {/* F6 — Gastos anómalos (condicional) */}
      {data.gastosAnomalos.length > 0 && (
        <AlertCard
          title="Gastos anomalos este mes"
          items={data.gastosAnomalos.map(g => ({
            label: `${g.categoria}: ${formatCOP(g.monto)}`,
            badges: [
              {
                text: `+${g.deltaPct.toFixed(0)}% vs anterior`,
                variant: g.deltaPct >= 50 ? ('red' as const) : ('yellow' as const),
              },
            ],
          }))}
        />
      )}

      {/* F7 — Impuestos estimados */}
      {data.impuestos && (
        <ChartCard title="Impuestos estimados" subtitle="Basado en ingresos del mes" accentColor={SLATE}>
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
