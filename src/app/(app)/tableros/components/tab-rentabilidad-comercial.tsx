'use client'

import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, Legend,
} from 'recharts'
import type { RentabilidadComercialData } from '../types'
import { ChartCard } from './chart-card'

const GREEN = '#10B981'
const GREEN_BRIGHT = '#34D399'
const CARBON = '#1A1A1A'
const GRAY = '#9CA3AF'

const LINEA_COLORS = ['#10B981', '#34D399', '#6EE7B7', '#059669', '#A7F3D0', '#047857', '#D1FAE5', '#065F46']

// Millones COP con separador de miles: $20.102 M
function fmtM(n: number): string {
  return `$${Math.round(n / 1_000_000).toLocaleString('es-CO')} M`
}
// COP completo: $20.102.566.038
function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
// Etiqueta corta para ejes
function fmtAxis(n: number): string {
  const m = n / 1_000_000
  if (Math.abs(m) >= 1000) return `$${(m / 1000).toFixed(1)}kM`
  return `$${Math.round(m)}M`
}

function limpiarLinea(s: string): string {
  // "01 - INTERCOMUNICADORES" -> "Intercomunicadores"
  const sinCodigo = s.replace(/^\d+\s*-\s*/, '')
  return sinCodigo.charAt(0).toUpperCase() + sinCodigo.slice(1).toLowerCase()
}
function limpiarNombre(s: string): string {
  return s.length > 42 ? s.slice(0, 42) + '…' : s
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" style={accent ? { borderTop: `2px solid ${accent}` } : undefined}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1 leading-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export function TabRentabilidadComercial({ data }: { data: RentabilidadComercialData }) {
  const { kpis, porMes, porLinea, porVendedor, topProductos } = data
  const lineasTop = porLinea.slice(0, 8).map(l => ({ ...l, label: limpiarLinea(l.linea) }))
  const vendedoresTop = porVendedor.slice(0, 8).map(v => ({
    ...v,
    label: v.vendedor.split(' ').slice(0, 2).join(' '),
  }))
  const rango = data.anios.length > 0 ? data.anios.join(' - ') : ''

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Venta neta" value={fmtCOP(kpis.ventaNeta)} sub={`${rango} · ${kpis.documentos.toLocaleString('es-CO')} documentos`} accent={GREEN} />
        <KpiCard label="Utilidad bruta" value={fmtCOP(kpis.utilidad)} sub={`Costo: ${fmtM(kpis.costo)}`} accent={GREEN_BRIGHT} />
        <KpiCard label="Margen bruto" value={`${kpis.margenPct}%`} sub="Utilidad / venta neta" accent={CARBON} />
        <KpiCard label="Líneas activas" value={`${kpis.lineas}`} sub={`${Math.round(kpis.unidades).toLocaleString('es-CO')} unidades`} accent={GRAY} />
      </div>

      {/* Ventas y margen por mes */}
      <ChartCard title="Ventas y margen por mes" subtitle="Venta neta (barras) y margen bruto % (línea)" accentColor={GREEN}>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={porMes} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={0} angle={-35} textAnchor="end" height={48} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtAxis} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                formatter={(value, name) => name === 'Margen %' ? [`${Number(value)}%`, name] : [fmtCOP(Number(value)), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="ventaNeta" name="Venta neta" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={38} />
              <Line yAxisId="right" dataKey="margenPct" name="Margen %" stroke={CARBON} strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ventas por línea */}
        <ChartCard title="Ventas por línea" subtitle={`Top ${lineasTop.length} de ${kpis.lineas} líneas`} accentColor={GREEN}>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lineasTop} layout="vertical" margin={{ left: 0, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="#F3F4F6" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtAxis} />
                <YAxis dataKey="label" type="category" width={110} tick={{ fontSize: 11, fill: '#374151' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                  formatter={(value, _n, props) => [`${fmtCOP(Number(value))} · margen ${props.payload?.margenPct}%`, 'Venta neta']}
                />
                <Bar dataKey="ventaNeta" radius={[0, 4, 4, 0]}>
                  {lineasTop.map((_, i) => <Cell key={i} fill={LINEA_COLORS[i % LINEA_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        {/* Top vendedores */}
        <ChartCard title="Top vendedores" subtitle="Por venta neta" accentColor={GREEN}>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={vendedoresTop} layout="vertical" margin={{ left: 0, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="#F3F4F6" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtAxis} />
                <YAxis dataKey="label" type="category" width={110} tick={{ fontSize: 11, fill: '#374151' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
                  formatter={(value, _n, props) => [`${fmtCOP(Number(value))} · margen ${props.payload?.margenPct}%`, 'Venta neta']}
                />
                <Bar dataKey="ventaNeta" radius={[0, 4, 4, 0]} fill={GREEN_BRIGHT} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Top productos */}
      <ChartCard title="Top productos por venta" subtitle="Los 10 productos de mayor venta neta" accentColor={CARBON}>
        <div className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-400 uppercase border-b border-gray-100">
                <th className="py-2">Producto</th>
                <th className="py-2 text-right">Venta neta</th>
                <th className="py-2 text-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {topProductos.map((p, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 text-gray-700">{limpiarNombre(p.producto)}</td>
                  <td className="py-2 text-right font-medium text-gray-900">{fmtM(p.ventaNeta)}</td>
                  <td className="py-2 text-right text-gray-500">{p.margenPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {/* Nota de fuente */}
      <p className="text-xs text-gray-400 leading-relaxed px-1">
        Fuente: export de Siesa Enterprise (operación Colombia). Datos: {rango} (2026 hasta mayo). Hoy se
        actualiza por carga manual del reporte; conectando ONE directo a Siesa, este tablero se refresca en tiempo real,
        sin descargar ni consolidar a mano.
      </p>
    </div>
  )
}
