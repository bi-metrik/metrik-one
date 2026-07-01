'use client'

import Link from 'next/link'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { ArrowLeft, Zap } from 'lucide-react'
import type { VendedorPerfil } from '../../vendedores-types'

const GREEN = '#10B981'
const CARBON = '#1A1A1A'
const RAMP = ['#065F46', '#047857', '#059669', '#10B981', '#34D399', '#6EE7B7']
const SMALL_N = 15

function fmtCOP(n: number): string { return `$${Math.round(n).toLocaleString('es-CO')}` }
function fmtM(n: number): string { return `$${Math.round(n / 1_000_000).toLocaleString('es-CO')} M` }
function fmtAxis(n: number): string { const m = n / 1_000_000; return Math.abs(m) >= 1000 ? `$${(m / 1000).toFixed(1)}kM` : `$${Math.round(m)}M` }
function nombreCorto(s: string): string { return s.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') }
function iniciales(s: string): string { const p = s.split(' ').filter(Boolean); return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() }
function limpiarLinea(s: string): string { const t = s.replace(/^\d+\s*-\s*/, ''); return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() }
function trunc(s: string, n: number): string { return s.length > n ? s.slice(0, n) + '…' : s }
function ordinalPos(pct: number | null): string {
  if (pct === null) return 'sin datos suficientes'
  return `percentil ${pct}`
}

function KpiMini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-white/60">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-white/60 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function VendedorPerfilClient({ perfil }: { perfil: VendedorPerfil }) {
  const { kpis, equipo, cumplimiento, porMes, porLinea, topProductos } = perfil
  const cumpl = cumplimiento.cumplimientoPct
  const cumplColor = cumpl === null ? '#6B7280' : cumpl >= 100 ? GREEN : cumpl >= 85 ? '#F59E0B' : '#EF4444'
  const lineasTop = porLinea.map(l => ({ ...l, nombre: limpiarLinea(l.linea) }))

  return (
    <div className="space-y-5 pb-10">
      <Link href="/equipo" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#1A1A1A]">
        <ArrowLeft className="h-4 w-4" /> Equipo comercial
      </Link>

      {/* Header hero */}
      <div className="rounded-2xl bg-[#1A1A1A] text-white p-6 relative overflow-hidden" style={{ borderTop: `3px solid ${GREEN}` }}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-xl font-extrabold shrink-0">
            {iniciales(perfil.vendedor)}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight">{nombreCorto(perfil.vendedor)}</h1>
            <p className="text-sm text-white/60">
              {ordinalPos(equipo.percentilVenta)} en venta · {ordinalPos(equipo.percentilMargen)} en margen (de {equipo.vendedores} vendedores)
            </p>
          </div>
          <div className="sm:ml-auto grid grid-cols-2 gap-6">
            <KpiMini label="Venta neta" value={fmtM(kpis.ventaNeta)} sub={`${kpis.pesoVentaPct}% del total`} />
            <KpiMini label="Margen bruto" value={kpis.margenValido && kpis.margenPct !== null ? `${kpis.margenPct}%` : '—'} sub={equipo.margenPonderado !== null ? `equipo: ${equipo.margenPonderado}%` : undefined} />
          </div>
        </div>
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/70">
          <Zap className="h-3 w-3 text-[#34D399]" /> En la operación conectada, cada vendedor vería este perfil en tiempo real.
        </div>
      </div>

      {/* Cumplimiento de meta + percentiles */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="text-[11px] font-bold text-gray-400 uppercase">Cumplimiento de meta</p>
          <p className="text-3xl font-extrabold tabular-nums mt-1" style={{ color: cumplColor }}>
            {cumpl === null ? 'sin meta' : `${cumpl}%`}
          </p>
          <div className="mt-3 h-2.5 rounded-full bg-gray-100 overflow-hidden">
            {cumpl !== null && <div className="h-full rounded-full" style={{ width: `${Math.min(cumpl, 100)}%`, backgroundColor: cumplColor }} />}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Real {fmtM(cumplimiento.ventaReal)} de meta {fmtM(cumplimiento.metaVenta)}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
          <p className="text-[11px] font-bold text-gray-400 uppercase mb-3">Posición en el equipo</p>
          <PosBar label="Venta" pct={equipo.percentilVenta} />
          <div className="h-3" />
          <PosBar label="Margen" pct={equipo.percentilMargen} />
        </div>
      </div>

      {/* Historico ventas + margen */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" style={{ borderTop: `2px solid ${GREEN}` }}>
        <h3 className="text-[17px] font-bold text-gray-900 mb-4">Histórico de ventas y margen</h3>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={porMes} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={0} angle={-35} textAnchor="end" height={44} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtAxis} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }} formatter={(val, name) => name === 'Margen %' ? [`${val === null ? '—' : val + '%'}`, name] : [fmtCOP(Number(val)), name]} />
              <Bar yAxisId="l" dataKey="ventaNeta" name="Venta neta" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={30} />
              <Line yAxisId="r" dataKey="margenPct" name="Margen %" stroke={CARBON} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Mix por linea */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h3 className="text-[17px] font-bold text-gray-900 mb-4">Mix por línea</h3>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChartLineas data={lineasTop} />
            </ResponsiveContainer>
          </div>
        </div>
        {/* Top productos */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h3 className="text-[17px] font-bold text-gray-900 mb-4">Productos más vendidos</h3>
          <table className="w-full text-sm">
            <tbody>
              {topProductos.map((p, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 text-gray-700">{trunc(p.producto, 38)}</td>
                  <td className="py-2 text-right font-semibold text-gray-900 tabular-nums">{fmtM(p.ventaNeta)}</td>
                  <td className="py-2 text-right text-gray-500 tabular-nums">{p.margenPct === null ? '—' : `${p.margenPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed px-1">
        Fuente: export de Siesa Enterprise (Colombia, COP). Margen bruto (venta menos costo de línea). Percentiles de margen calculados solo entre vendedores con al menos {SMALL_N} documentos.
      </p>
    </div>
  )
}

function PosBar({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-semibold text-[#1A1A1A]">{pct === null ? 'muestra insuficiente' : `percentil ${pct}`}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-gray-100">
        {pct !== null && (
          <div className="absolute top-0 h-full w-1 rounded-full bg-[#1A1A1A]" style={{ left: `${Math.min(Math.max(pct, 0), 100)}%`, transform: 'translateX(-50%)' }} />
        )}
        <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(90deg,#D1FAE5,#10B981)' }} />
        {pct !== null && (
          <div className="absolute top-0 h-full w-1 rounded-full bg-[#1A1A1A] z-10" style={{ left: `${Math.min(Math.max(pct, 0), 100)}%`, transform: 'translateX(-50%)' }} />
        )}
      </div>
    </div>
  )
}

// Sub-chart de mix por linea (barras horizontales con rampa)
function BarChartLineas({ data }: { data: { nombre: string; ventaNeta: number; margenPct: number | null }[] }) {
  return (
    <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
      <CartesianGrid horizontal={false} stroke="#F3F4F6" />
      <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtAxis} />
      <YAxis dataKey="nombre" type="category" width={100} tick={{ fontSize: 11, fill: '#374151' }} tickLine={false} axisLine={false} />
      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }} formatter={(v, _n, p) => [`${fmtCOP(Number(v))} · margen ${p.payload?.margenPct === null ? '—' : p.payload?.margenPct + '%'}`, 'Venta']} />
      <Bar dataKey="ventaNeta" radius={[0, 4, 4, 0]}>
        {data.map((_, i) => <Cell key={i} fill={RAMP[i % RAMP.length]} />)}
      </Bar>
    </BarChart>
  )
}
