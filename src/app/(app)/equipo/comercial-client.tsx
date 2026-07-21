'use client'

import Link from 'next/link'
import { ArrowRight, Users } from 'lucide-react'
import type { ComercialResumenRow } from './comercial-types'

const GREEN = '#059669'

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
function nombreCorto(s: string): string {
  return s
    .split(' ')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}
function iniciales(s: string): string {
  const p = s.split(' ').filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}

export default function ComercialClient({ equipo }: { equipo: ComercialResumenRow[] }) {
  const totalHonorario = equipo.reduce((s, v) => s + v.honorario_recaudado, 0)
  const totalTarifa = equipo.reduce((s, v) => s + v.tarifa_recaudada, 0)
  const totalAprobado = equipo.reduce((s, v) => s + v.valor_aprobado, 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Equipo comercial</h1>
        <p className="text-sm text-gray-500 mt-1">
          Seguimiento por vendedor. El recaudo mostrado es honorario (ingreso real); la tarifa UPME
          se reporta aparte como plata de terceros.
        </p>
      </div>

      {/* Totales del equipo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Valor aprobado</p>
          <p className="text-xl font-bold text-gray-900 tabular-nums mt-1">{fmtCOP(totalAprobado)}</p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Honorario recaudado</p>
          <p className="text-xl font-bold tabular-nums mt-1" style={{ color: GREEN }}>
            {fmtCOP(totalHonorario)}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Tarifa UPME (terceros)</p>
          <p className="text-xl font-semibold text-gray-500 tabular-nums mt-1">{fmtCOP(totalTarifa)}</p>
        </div>
      </div>

      {/* Tarjetas por responsable */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {equipo.map((v) => {
          const cardKey = v.responsable_id ?? 'sin-responsable'
          const href = `/equipo/comercial/${cardKey}`
          return (
            <Link
              key={cardKey}
              href={href}
              className="group rounded-2xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-gray-200 transition-all"
            >
              <div className="flex items-center gap-3 mb-4">
                {v.sin_responsable ? (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-400 shrink-0">
                    <Users className="h-5 w-5" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1A1A1A] text-white text-xs font-bold shrink-0">
                    {iniciales(v.nombre)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {v.sin_responsable ? 'Sin responsable' : nombreCorto(v.nombre)}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {v.sin_responsable ? 'Negocios sin asignar' : v.position ?? 'Comercial'}
                  </p>
                </div>
              </div>

              {/* Conteos por stage */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <StageCount label="Venta" n={v.en_venta} />
                <StageCount label="Ejecucion" n={v.en_ejecucion} />
                <StageCount label="Cobro" n={v.en_cobro} />
              </div>

              {/* Cifras */}
              <div className="space-y-2 border-t border-gray-50 pt-3">
                <Row label="Negocios activos" value={String(v.negocios_abiertos)} />
                <Row label="Valor aprobado" value={fmtCOP(v.valor_aprobado)} />
                <Row
                  label="Honorario recaudado"
                  value={fmtCOP(v.honorario_recaudado)}
                  strong
                  color={GREEN}
                />
                <Row label="Tarifa UPME (terceros)" value={fmtCOP(v.tarifa_recaudada)} muted />
              </div>

              <div className="mt-4 flex items-center justify-end text-xs font-semibold text-[#059669]">
                Ver detalle
                <ArrowRight className="ml-1 h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          )
        })}
      </div>

      {equipo.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">Aun no hay negocios registrados para el equipo.</p>
        </div>
      )}
    </div>
  )
}

function StageCount({ label, n }: { label: string; n: number }) {
  return (
    <div className="rounded-lg bg-gray-50 py-2 text-center">
      <p className="text-lg font-bold text-gray-900 tabular-nums leading-none">{n}</p>
      <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">{label}</p>
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  muted,
  color,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
  color?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span
        className={`tabular-nums whitespace-nowrap ${
          strong ? 'font-bold' : muted ? 'text-gray-400 text-sm' : 'font-semibold text-gray-900 text-sm'
        }`}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  )
}
