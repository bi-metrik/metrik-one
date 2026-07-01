'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { slugVendedor, type VendedorResumen } from './vendedores-types'

const GREEN = '#10B981'
const SMALL_N = 15
function fmtCOP(n: number): string { return `$${Math.round(n).toLocaleString('es-CO')}` }
function nombreCorto(s: string): string {
  return s.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
function iniciales(s: string): string {
  const p = s.split(' ').filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}

export default function VendedoresClient({ vendedores }: { vendedores: VendedorResumen[] }) {
  const max = vendedores[0]?.ventaNeta || 1
  const totalVenta = vendedores.reduce((s, v) => s + v.ventaNeta, 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Equipo comercial</h1>
        <p className="text-sm text-gray-500 mt-1">
          {vendedores.length} vendedores · venta total {fmtCOP(totalVenta)}. Cada uno tendría acceso a su propio perfil de indicadores en tiempo real.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {vendedores.map((v, i) => (
          <Link
            key={i}
            href={`/equipo/vendedor/${slugVendedor(v.vendedor)}`}
            className="group rounded-2xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
            style={{ borderTop: `2px solid ${GREEN}` }}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1A1A1A] text-white text-sm font-bold shrink-0">
                {iniciales(v.vendedor)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 truncate">{nombreCorto(v.vendedor)}</p>
                <p className="text-xs text-gray-400">{v.documentos.toLocaleString('es-CO')} documentos</p>
              </div>
              <ArrowUpRight className="h-4 w-4 text-gray-300 group-hover:text-[#059669]" />
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase">Venta neta</p>
                <p className="text-lg font-extrabold text-gray-900 tabular-nums">{fmtCOP(v.ventaNeta)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold text-gray-400 uppercase">Margen</p>
                <p className="text-lg font-extrabold text-[#059669] tabular-nums">
                  {v.margenPct === null ? '—' : `${v.margenPct}%`}
                  {v.documentos < SMALL_N && <span className="text-[10px] text-gray-400 font-normal"> n={v.documentos}</span>}
                </p>
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(v.ventaNeta / max) * 100}%`, backgroundColor: GREEN }} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
