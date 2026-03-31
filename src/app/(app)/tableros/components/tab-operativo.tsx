'use client'

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts'
import type { OperativoData } from '../types'
import { ChartCard } from './chart-card'
import { ProgressGauge } from './progress-gauge'
import { AlertCard } from './alert-card'
import { MiniTable } from './mini-table'

const GREEN = '#10B981'
const YELLOW = '#F59E0B'
const RED = '#EF4444'
const AMBER = '#F59E0B'

const ESTADO_COLORES: Record<string, string> = {
  'En ejecucion': 'bg-emerald-100 text-emerald-700',
  'Pausado': 'bg-amber-100 text-amber-700',
  'Rework': 'bg-amber-100 text-amber-700',
  'Completado': 'bg-slate-100 text-slate-700',
  'Cerrado': 'bg-slate-100 text-slate-700',
  'Cancelado': 'bg-red-100 text-red-700',
}

function formatCOP(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function getSaludColor(pct: number): string {
  if (pct > 70) return GREEN
  if (pct >= 40) return YELLOW
  return RED
}

export function TabOperativo({ data }: { data: OperativoData }) {
  const saludColor = getSaludColor(data.saludPct)

  return (
    <div className="space-y-6">

      {/* O1 — Salud operativa (hero RadialBar) */}
      <ChartCard title="Salud operativa" accentColor={saludColor}>
        {data.proyectosActivos === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No hay proyectos activos</p>
        ) : (
          <div className="flex flex-col items-center">
            <div className="relative w-full h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="60%"
                  outerRadius="80%"
                  data={[{ value: data.saludPct, fill: saludColor }]}
                  startAngle={180}
                  endAngle={0}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar
                    dataKey="value"
                    cornerRadius={8}
                    background={{ fill: '#F3F4F6' }}
                    angleAxisId={0}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-end pb-4 pointer-events-none">
                <span className="text-3xl font-bold text-gray-900">{data.saludPct.toFixed(0)}%</span>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {data.proyectosSaludables} de {data.proyectosActivos} proyectos saludables
            </p>
          </div>
        )}
      </ChartCard>

      {/* O2 — Alertas unificadas */}
      <AlertCard
        title="Alertas de proyectos"
        emptyMessage="Todos los proyectos en orden"
        items={data.alertas.map(a => ({
          label: a.nombre,
          badges: [
            ...(a.tipo.includes('presupuesto') ? [{
              text: `Presupuesto ${a.presupuestoPct.toFixed(0)}%`,
              variant: 'red' as const,
            }] : []),
            ...(a.tipo.includes('horas') && a.horasPct !== undefined ? [{
              text: `Horas ${a.horasPct.toFixed(0)}%`,
              variant: 'yellow' as const,
            }] : []),
            ...(a.tipo.includes('entrega_proxima') && a.diasParaEntrega !== undefined ? [{
              text: `Entrega en ${a.diasParaEntrega}d`,
              variant: 'red' as const,
            }] : []),
            ...(a.tipo.includes('avance_bajo') ? [{
              text: 'Avance bajo',
              variant: 'yellow' as const,
            }] : []),
          ],
        }))}
      />

      {/* O6 — Costo por proyecto */}
      {data.costoPorProyecto.length > 0 && (
        <ChartCard title="Consumo de presupuesto" subtitle="Proyectos activos" accentColor={AMBER}>
          <div className="space-y-5">
            {data.costoPorProyecto.map((p, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-900 truncate">{p.nombre}</span>
                  <span className="text-gray-500 shrink-0 ml-2">
                    {formatCOP(p.gastoReal)} / {formatCOP(p.presupuesto)}
                  </span>
                </div>
                <ProgressGauge label="" value={p.pct} size="sm" />
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {/* O4 — Consumo promedio presupuesto + horas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="Presupuesto promedio" subtitle="Proyectos activos" accentColor={AMBER}>
          <ProgressGauge label="" value={data.promedioPresupuestoConsumido} />
          {data.proyectosEnRiesgoPresupuesto > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              {data.proyectosEnRiesgoPresupuesto} de {data.totalProyectosActivos} por encima del 80%
            </p>
          )}
        </ChartCard>
        <ChartCard title="Horas promedio" subtitle="Proyectos activos" accentColor={AMBER}>
          <ProgressGauge label="" value={data.promedioHorasConsumidas} />
          {data.proyectosEnRiesgoHoras > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              {data.proyectosEnRiesgoHoras} de {data.totalProyectosActivos} por encima del 80%
            </p>
          )}
        </ChartCard>
      </div>

      {/* O3 — Resumen estados (solo badges con count > 0) */}
      {data.proyectosPorEstado.length > 0 && (
        <ChartCard title="Proyectos por estado" subtitle={`${data.completadosMes} completados este mes`} accentColor="#64748B">
          <div className="flex flex-wrap gap-3">
            {data.proyectosPorEstado.map((e, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold ${ESTADO_COLORES[e.estado] || 'bg-gray-100 text-gray-700'}`}
              >
                <span className="text-2xl font-bold">{e.count}</span>
                <span className="font-medium">{e.estado}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {/* O5 — Rentabilidad cerrados */}
      {data.rentabilidadCerrados.length > 0 && (
        <ChartCard title="Rentabilidad proyectos cerrados" subtitle="Ultimos 10 proyectos" accentColor={GREEN}>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.rentabilidadCerrados}
                layout="vertical"
                margin={{ left: 0, right: 48 }}
              >
                <CartesianGrid horizontal={false} stroke="#F3F4F6" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                  domain={[0, 100]}
                />
                <YAxis
                  dataKey="nombre"
                  type="category"
                  width={110}
                  tick={{ fontSize: 11, fill: '#374151' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                  formatter={(value) => [`${Number(value).toFixed(0)}%`, 'Margen']}
                />
                <Bar dataKey="margenPct" radius={[0, 4, 4, 0]}>
                  {data.rentabilidadCerrados.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        entry.margenPct > 30 ? GREEN
                          : entry.margenPct >= 10 ? YELLOW
                          : RED
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* O7 — Productividad equipo (solo si > 1 miembro) */}
      {data.productividadEquipo.length > 1 && (
        <ChartCard title="Productividad del equipo" subtitle="Horas registradas este mes" accentColor="#64748B">
          <MiniTable
            columns={[
              { key: 'nombre', label: 'Nombre' },
              {
                key: 'horasRegistradas',
                label: 'Horas',
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
