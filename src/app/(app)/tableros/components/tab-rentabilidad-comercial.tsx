'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, Legend,
} from 'recharts'
import { X, ArrowUpRight, ChevronRight, RotateCcw } from 'lucide-react'
import type { RentabilidadComercialData, RcFiltros, RcAnio, RcMes } from '../types'
import { ChartCard } from './chart-card'
import { getRentabilidadComercialData } from '../actions'

const GREEN = '#10B981'
const GREEN_BRIGHT = '#34D399'
const CARBON = '#1A1A1A'
// Rampa emerald para rankings (Ren): rank 1 = mas profundo.
const RAMP = ['#065F46', '#047857', '#059669', '#10B981', '#34D399', '#6EE7B7', '#A7F3D0', '#D1FAE5']
const SMALL_N = 15 // umbral de muestra pequena (Saga)

function fmtCOP(n: number): string { return `$${Math.round(n).toLocaleString('es-CO')}` }
function fmtM(n: number): string { return `$${Math.round(n / 1_000_000).toLocaleString('es-CO')} M` }
function fmtAxis(n: number): string {
  const m = n / 1_000_000
  if (Math.abs(m) >= 1000) return `$${(m / 1000).toFixed(1)}kM`
  return `$${Math.round(m)}M`
}
function limpiarLinea(s: string): string {
  const t = s.replace(/^\d+\s*-\s*/, '')
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}
function nombreCorto(s: string): string {
  return s.split(' ').slice(0, 2).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
function trunc(s: string, n: number): string { return s.length > n ? s.slice(0, n) + '…' : s }
export function slugVendedor(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
// Margen null-safe + muestra pequena
function margenTxt(mp: number | null, docs: number): string {
  if (mp === null) return 'sin margen'
  return docs < SMALL_N ? `${mp}% (n=${docs})` : `${mp}%`
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" style={accent ? { borderTop: `2px solid ${accent}` } : undefined}>
      <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wide">{label}</p>
      <p className="text-[28px] font-extrabold text-[#1A1A1A] mt-1 leading-none tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1.5">{sub}</p>}
    </div>
  )
}

const MESES_ORDEN: Record<string, number> = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 }
function mesLabel(mes: string | null): string {
  if (!mes) return ''
  return mes.charAt(0) + mes.slice(1).toLowerCase()
}

const FILTROS_INICIALES: RcFiltros = { anioScope: 'todos', drill: 'anios', mes: null, vendedor: null, linea: null }

export function TabRentabilidadComercial({ data: initialData }: { data: RentabilidadComercialData }) {
  const router = useRouter()
  const [filtros, setFiltros] = useState<RcFiltros>(FILTROS_INICIALES)
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  function apply(next: RcFiltros) {
    setFiltros(next)
    startTransition(async () => {
      const d = await getRentabilidadComercialData({
        anio: next.anioScope === 'todos' ? null : next.anioScope,
        mes: next.mes,
        vendedor: next.vendedor,
        linea: next.linea,
      })
      if (d) setData(d)
    })
  }

  // ── Handlers de interaccion ──
  const clickAnio = (anio: number) => apply({ ...filtros, anioScope: anio, drill: 'meses', mes: null })
  const clickMes = (mes: string) => apply({ ...filtros, mes: filtros.mes === mes ? null : mes })
  const clickLinea = (linea: string) => apply({ ...filtros, linea: filtros.linea === linea ? null : linea })
  const clickVendedor = (vendedor: string) => apply({ ...filtros, vendedor: filtros.vendedor === vendedor ? null : vendedor })
  const irAnios = () => apply({ ...filtros, anioScope: 'todos', drill: 'anios', mes: null })
  const irMeses = () => apply({ ...filtros, mes: null })
  const reset = () => apply(FILTROS_INICIALES)

  const hayFiltro = filtros.mes !== null || filtros.vendedor !== null || filtros.linea !== null || filtros.anioScope !== 'todos'
  const { kpis } = data
  const rango = data.anios.length ? data.anios.join(' - ') : ''

  // Datos de la grafica temporal (control)
  const temporal: Array<RcAnio | RcMes> = filtros.drill === 'anios' ? data.porAnio : data.porMes
  const temporalTitulo = filtros.drill === 'anios' ? 'Ventas y margen por año' : `Ventas y margen por mes · ${filtros.anioScope}`

  const lineasTop = data.porLinea.slice(0, 8).map(l => ({ ...l, nombre: limpiarLinea(l.linea) }))
  const vendedoresTop = data.porVendedor.slice(0, 10).map(v => ({ ...v, nombre: nombreCorto(v.vendedor) }))

  return (
    <div className="space-y-5">
      {/* Barra de control sticky: contexto + breadcrumb + chips */}
      <div className="sticky top-14 z-10 -mx-6 px-6 py-3 bg-[#F9FAFB]/95 backdrop-blur border-b border-gray-100 space-y-2">
        {/* Breadcrumb de drill */}
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <button onClick={irAnios} className={`hover:text-[#059669] ${filtros.drill === 'anios' ? 'font-semibold text-[#1A1A1A]' : ''}`}>Todos los años</button>
          {filtros.anioScope !== 'todos' && (
            <>
              <ChevronRight className="h-3 w-3 text-gray-300" />
              <button onClick={irMeses} className={`hover:text-[#059669] ${filtros.drill === 'meses' && !filtros.mes ? 'font-semibold text-[#1A1A1A]' : ''}`}>{filtros.anioScope}</button>
            </>
          )}
          {filtros.mes && (
            <>
              <ChevronRight className="h-3 w-3 text-gray-300" />
              <span className="font-semibold text-[#1A1A1A]">{mesLabel(filtros.mes)}</span>
            </>
          )}
        </div>

        {/* Chips de filtros activos */}
        {hayFiltro && (
          <div className="flex flex-wrap items-center gap-2">
            {filtros.mes && <Chip label={`Mes: ${mesLabel(filtros.mes)}`} onClear={() => apply({ ...filtros, mes: null })} />}
            {filtros.vendedor && <Chip label={`Vendedor: ${nombreCorto(filtros.vendedor)}`} onClear={() => apply({ ...filtros, vendedor: null })} />}
            {filtros.linea && <Chip label={`Línea: ${limpiarLinea(filtros.linea)}`} onClear={() => apply({ ...filtros, linea: null })} />}
            <button onClick={reset} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#1A1A1A]">
              <RotateCcw className="h-3 w-3" /> Limpiar todo
            </button>
          </div>
        )}
      </div>

      <div className={`space-y-5 transition-opacity duration-200 ${isPending ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        {/* KPIs (ancla: venta + utilidad + margen ponderado, siempre juntos) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Venta neta" value={fmtCOP(kpis.ventaNeta)} sub={`${kpis.documentos.toLocaleString('es-CO')} documentos`} accent={GREEN} />
          <KpiCard label="Utilidad bruta" value={fmtCOP(kpis.utilidad)} sub={`Costo: ${fmtM(kpis.costo)}`} accent={GREEN_BRIGHT} />
          <KpiCard label="Margen bruto" value={kpis.margenValido && kpis.margenPct !== null ? `${kpis.margenPct}%` : '—'} sub={kpis.documentos < SMALL_N ? `muestra pequeña (n=${kpis.documentos})` : 'utilidad / venta neta'} accent={CARBON} />
          <KpiCard label={filtros.vendedor ? 'Vendedor' : 'Líneas · vendedores'} value={filtros.vendedor ? nombreCorto(filtros.vendedor) : `${kpis.lineas} · ${kpis.vendedores}`} sub={`${Math.round(kpis.unidades).toLocaleString('es-CO')} unidades`} />
        </div>

        {/* Grafica temporal = control */}
        <ChartCard title={temporalTitulo} subtitle={filtros.drill === 'anios' ? 'Click en un año para ver sus meses' : 'Click en un mes para filtrar todo el tablero'} accentColor={GREEN}>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={temporal} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={0} angle={filtros.drill === 'meses' ? -35 : 0} textAnchor={filtros.drill === 'meses' ? 'end' : 'middle'} height={filtros.drill === 'meses' ? 48 : 24} />
                <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtAxis} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }} formatter={(val, name) => name === 'Margen %' ? [`${val === null ? '—' : val + '%'}`, name] : [fmtCOP(Number(val)), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Bar yAxisId="l" dataKey="ventaNeta" name="Venta neta" radius={[4, 4, 0, 0]} maxBarSize={44} cursor="pointer"
                  onClick={(e: any) => { if (!e) return; filtros.drill === 'anios' ? clickAnio(e.anio) : clickMes(e.mes) }}>
                  {temporal.map((d, i) => {
                    const sel = filtros.drill === 'meses' && filtros.mes === (d as { mes?: string }).mes
                    const dim = filtros.drill === 'meses' && filtros.mes !== null && !sel
                    return <Cell key={i} fill={GREEN} fillOpacity={dim ? 0.28 : 1} stroke={sel ? CARBON : undefined} strokeWidth={sel ? 1.5 : 0} />
                  })}
                </Bar>
                <Line yAxisId="r" dataKey="margenPct" name="Margen %" stroke={CARBON} strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Ventas por linea (excluye su propio filtro) */}
          <ChartCard title="Ventas por línea" subtitle={filtros.linea ? `Seleccionada: ${limpiarLinea(filtros.linea)}` : 'Click para filtrar'} accentColor={GREEN}>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lineasTop} layout="vertical" margin={{ left: 0, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="#F3F4F6" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtAxis} />
                  <YAxis dataKey="nombre" type="category" width={110} tick={{ fontSize: 11, fill: '#374151' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }} formatter={(v, _n, p) => [`${fmtCOP(Number(v))} · margen ${margenTxt(p.payload?.margenPct ?? null, p.payload?.documentos ?? 0)}`, 'Venta neta']} />
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Bar dataKey="ventaNeta" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(e: any) => e && clickLinea(e.linea)}>
                    {lineasTop.map((l, i) => {
                      const sel = filtros.linea === l.linea
                      const dim = filtros.linea !== null && !sel
                      return <Cell key={i} fill={filtros.linea ? GREEN : RAMP[i % RAMP.length]} fillOpacity={dim ? 0.28 : 1} stroke={sel ? CARBON : undefined} strokeWidth={sel ? 1.5 : 0} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Top vendedores (excluye su propio filtro) + navegar a perfil */}
          <ChartCard title="Vendedores" subtitle="Click filtra · flecha abre su perfil" accentColor={GREEN}>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
              {vendedoresTop.map((v, i) => {
                const sel = filtros.vendedor === v.vendedor
                const dim = filtros.vendedor !== null && !sel
                const max = vendedoresTop[0]?.ventaNeta || 1
                return (
                  <div key={i} className={`group flex items-center gap-2 ${dim ? 'opacity-40' : ''}`}>
                    <button onClick={() => clickVendedor(v.vendedor)} aria-pressed={sel} className="flex-1 min-w-0 text-left" title={`Filtrar por ${v.vendedor}`}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className={`truncate ${sel ? 'font-bold text-[#1A1A1A]' : 'text-gray-600'}`}>{v.nombre}</span>
                        <span className="text-gray-500 tabular-nums shrink-0 ml-2">{fmtM(v.ventaNeta)} · {margenTxt(v.margenPct, v.documentos)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(v.ventaNeta / max) * 100}%`, backgroundColor: GREEN, opacity: sel ? 1 : 0.85, outline: sel ? `1.5px solid ${CARBON}` : 'none' }} />
                      </div>
                    </button>
                    <button onClick={() => router.push(`/equipo/vendedor/${slugVendedor(v.vendedor)}`)} title={`Ver perfil de ${v.vendedor}`} className="shrink-0 rounded-md p-1 text-gray-400 hover:text-[#059669] hover:bg-emerald-50">
                      <ArrowUpRight className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          </ChartCard>
        </div>

        {/* Top productos */}
        <ChartCard title="Top productos por venta" subtitle="Refleja el filtro activo" accentColor={CARBON}>
          {data.topProductos.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Sin datos para este filtro.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold text-gray-400 uppercase border-b border-gray-100">
                  <th className="py-2">Producto</th>
                  <th className="py-2 text-right">Venta neta</th>
                  <th className="py-2 text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {data.topProductos.map((p, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-700">{trunc(p.producto, 44)}</td>
                    <td className="py-2 text-right font-semibold text-gray-900 tabular-nums">{fmtM(p.ventaNeta)}</td>
                    <td className="py-2 text-right text-gray-500 tabular-nums">{margenTxt(p.margenPct, p.documentos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>

        {/* Nota de fuente + perimetro (Saga) */}
        <p className="text-xs text-gray-400 leading-relaxed px-1">
          Fuente: export de Siesa Enterprise (operación Colombia, COP). Datos: {rango} (2026 hasta mayo; mayo 2026 no es comparable con mayo 2025).
          Margen bruto = venta menos costo de línea (no descuenta gastos). Cifras de margen con menos de {SMALL_N} documentos se marcan como muestra pequeña.
          Conectando ONE directo a Siesa, este tablero se actualiza en tiempo real.
        </p>
      </div>
    </div>
  )
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(16,185,129,0.10)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)' }}>
      {label}
      <button onClick={onClear} className="hover:text-[#1A1A1A]" title="Quitar filtro"><X className="h-3 w-3" /></button>
    </span>
  )
}
