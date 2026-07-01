'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { slugVendedor, type VendedorResumen } from './vendedores-types'

const GREEN = '#059669'
const SMALL_N = 15
function fmtCOP(n: number): string { return `$${Math.round(n).toLocaleString('es-CO')}` }
function nombreCorto(s: string): string {
  return s.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
function iniciales(s: string): string {
  const p = s.split(' ').filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}

type SortKey = 'ventaNeta' | 'utilidad' | 'margenPct' | 'documentos'
type SortDir = 'asc' | 'desc'

export default function VendedoresClient({ vendedores }: { vendedores: VendedorResumen[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('ventaNeta')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const totalVenta = vendedores.reduce((s, v) => s + v.ventaNeta, 0)

  const rows = useMemo(() => {
    const arr = [...vendedores]
    arr.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      // nulls (margen sin denominador) siempre al final
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return arr
  }, [vendedores, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-300" />
    return sortDir === 'desc'
      ? <ArrowDown className="h-3.5 w-3.5 text-[#059669]" />
      : <ArrowUp className="h-3.5 w-3.5 text-[#059669]" />
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Equipo comercial</h1>
        <p className="text-sm text-gray-500 mt-1">
          {vendedores.length} vendedores · venta total {fmtCOP(totalVenta)}. Cada uno tendría acceso a su propio perfil de indicadores en tiempo real.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="py-3 px-4 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">Vendedor</th>
                <th className="py-3 px-4 text-right">
                  <button onClick={() => toggleSort('ventaNeta')} className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-500 uppercase tracking-wide hover:text-[#1A1A1A]">
                    Venta neta <SortIcon col="ventaNeta" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right hidden sm:table-cell">
                  <button onClick={() => toggleSort('utilidad')} className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-500 uppercase tracking-wide hover:text-[#1A1A1A]">
                    Utilidad <SortIcon col="utilidad" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">
                  <button onClick={() => toggleSort('margenPct')} className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-500 uppercase tracking-wide hover:text-[#1A1A1A]">
                    Margen <SortIcon col="margenPct" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right hidden md:table-cell">
                  <button onClick={() => toggleSort('documentos')} className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-500 uppercase tracking-wide hover:text-[#1A1A1A]" title="Número de facturas y notas de venta del vendedor">
                    Documentos <SortIcon col="documentos" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1A1A1A] text-white text-xs font-bold shrink-0">
                        {iniciales(v.vendedor)}
                      </div>
                      <span className="font-medium text-gray-900 truncate">{nombreCorto(v.vendedor)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-gray-900 tabular-nums whitespace-nowrap">{fmtCOP(v.ventaNeta)}</td>
                  <td className="py-3 px-4 text-right text-gray-600 tabular-nums whitespace-nowrap hidden sm:table-cell">{fmtCOP(v.utilidad)}</td>
                  <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                    <span className="font-semibold" style={{ color: GREEN }}>{v.margenPct === null ? '—' : `${v.margenPct}%`}</span>
                    {v.margenPct !== null && v.documentos < SMALL_N && <span className="text-[10px] text-gray-400 ml-1">n={v.documentos}</span>}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-500 tabular-nums hidden md:table-cell">{v.documentos.toLocaleString('es-CO')}</td>
                  <td className="py-3 px-4 text-right">
                    <Link href={`/equipo/vendedor/${slugVendedor(v.vendedor)}`} className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold text-[#059669] hover:bg-emerald-50 whitespace-nowrap">
                      Ver más
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
