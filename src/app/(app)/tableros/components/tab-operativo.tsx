'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import type { OperativoData } from '../types'
import { ChartCard } from './chart-card'
import { ProgressGauge } from './progress-gauge'
import { AlertCard } from './alert-card'
import { MiniTable } from './mini-table'

const GREEN = '#10B981'

function formatCOP(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function TabOperativo({ data }: { data: OperativoData }) {
  const totalActivos = data.proyectosPorEstado
    .filter(e => ['En ejecucion', 'Rework'].includes(e.estado))
    .reduce((s, e) => s + e.count, 0)

  return (
    <div className="space-y-6">
      {/* Hero: Proyectos activos */}
      <ChartCard title="Proyectos" subtitle={`${data.completadosMes} completados este mes`}>
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-4xl font-bold text-gray-900">{totalActivos}</span>
          <span className="text-lg font-medium text-gray-500">activos</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.proyectosPorEstado.map((e, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full bg-gray-100 text-gray-700"
            >
              {e.estado}
              <span className="font-bold">{e.count}</span>
            </span>
          ))}
        </div>
      </ChartCard>

      {/* Gauges: Presupuesto + Horas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="Presupuesto consumido" subtitle="Promedio proyectos activos">
          <ProgressGauge label="" value={data.promedioPresupuestoConsumido} />
        </ChartCard>
        <ChartCard title="Horas consumidas" subtitle="Promedio proyectos activos">
          <ProgressGauge label="" value={data.promedioHorasConsumidas} />
        </ChartCard>
      </div>

      {/* Alert: Proyectos en riesgo */}
      <AlertCard
        title="Proyectos en riesgo"
        items={data.proyectosEnRiesgo.map(p => ({
          label: p.nombre,
          badges: [
            ...(p.presupuestoPct > 90 ? [{ text: `Pres: ${p.presupuestoPct.toFixed(0)}%`, variant: 'red' as const }] : []),
            ...(p.horasPct > 90 ? [{ text: `Horas: ${p.horasPct.toFixed(0)}%`, variant: 'yellow' as const }] : []),
          ],
        }))}
      />

      {/* Gastos por categoria */}
      {data.gastosPorCategoria.length > 0 && (
        <ChartCard title="Gastos por categoria" subtitle="Este mes">
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.gastosPorCategoria} layout="vertical" margin={{ left: 0, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="#F3F4F6" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCOP(v)} />
                <YAxis dataKey="categoria" type="category" width={110} tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                  formatter={(value) => [formatCOP(Number(value)), 'Monto']}
                />
                <Bar dataKey="monto" radius={[0, 4, 4, 0]} fill={GREEN} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* Productividad equipo */}
      {data.productividadEquipo.length > 0 && (
        <ChartCard title="Productividad del equipo" subtitle="Horas registradas este mes">
          <MiniTable
            columns={[
              { key: 'nombre', label: 'Nombre' },
              {
                key: 'horasRegistradas',
                label: 'Registradas',
                align: 'right',
                render: (v: number) => `${v.toFixed(0)}h`,
              },
              {
                key: 'horasDisponibles',
                label: 'Disponibles',
                align: 'right',
                render: (v: number) => `${v.toFixed(0)}h`,
              },
              {
                key: 'utilizacion',
                label: 'Utilizacion',
                align: 'right',
                render: (v: number) => (
                  <span className={`font-semibold ${
                    v >= 80 ? 'text-emerald-600' : v >= 50 ? 'text-amber-600' : 'text-gray-400'
                  }`}>
                    {v.toFixed(0)}%
                  </span>
                ),
              },
            ]}
            data={data.productividadEquipo}
            emptyMessage="Sin equipo registrado"
          />
        </ChartCard>
      )}
    </div>
  )
}
