'use client'

import Link from 'next/link'
import { ArrowLeft, Trophy } from 'lucide-react'
import { STAGE_LABEL, type ComercialPerfil } from '../../comercial-types'
import type { RankingPersona } from '../../comercial-ranking'

const GREEN = '#059669'
const GOLD = '#D97706'

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
function nombreCorto(s: string): string {
  return s
    .split(' ')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

export default function ComercialPerfilClient({
  perfil,
  ranking,
  totalEquipo,
}: {
  perfil: ComercialPerfil
  ranking: RankingPersona | null
  totalEquipo: number
}) {
  const titulo = perfil.sin_responsable ? 'Sin responsable' : nombreCorto(perfil.nombre)

  return (
    <div>
      <Link
        href="/equipo"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Equipo comercial
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{titulo}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {perfil.sin_responsable ? 'Negocios sin responsable asignado' : perfil.position ?? 'Comercial'}
        </p>
      </div>

      {/* Ranking prominente */}
      {ranking && (
        <div className="mb-6 rounded-2xl border border-amber-100 bg-amber-50/60 p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: ranking.rank_honorario === 1 ? '#FEF3C7' : '#F3F4F6' }}
              >
                <Trophy className="h-6 w-6" style={{ color: ranking.rank_honorario === 1 ? GOLD : '#9CA3AF' }} />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Mi posicion</p>
                <p className="text-lg font-bold text-gray-900">
                  #{ranking.rank_honorario} de {totalEquipo}
                  <span className="ml-2 text-sm font-normal text-gray-500">en recaudo</span>
                </p>
              </div>
            </div>
            <RankPill label="Valor aprobado" rank={ranking.rank_valor} total={totalEquipo} />
            <RankPill label="Negocios activos" rank={ranking.rank_negocios} total={totalEquipo} />
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Negocios activos" value={String(perfil.kpis.negocios_abiertos)} />
        <Kpi label="Valor aprobado" value={fmtCOP(perfil.kpis.valor_aprobado)} />
        <Kpi label="Honorario recaudado" value={fmtCOP(perfil.kpis.honorario_recaudado)} color={GREEN} />
        <Kpi label="Tarifa UPME (terceros)" value={fmtCOP(perfil.kpis.tarifa_recaudada)} muted />
      </div>

      {/* Conversion por stage */}
      <section className="mb-6">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Negocios por etapa</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {perfil.porStage.map((s) => (
            <div key={s.stage} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{s.negocios}</p>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mt-2">
                {STAGE_LABEL[s.stage] ?? s.stage}
              </p>
              <p className="text-xs text-gray-500 tabular-nums mt-1">{fmtCOP(s.valor_aprobado)}</p>
            </div>
          ))}
          {perfil.porStage.length === 0 && (
            <p className="text-sm text-gray-400 col-span-full">Sin negocios.</p>
          )}
        </div>
      </section>

      {/* Detalle de negocios */}
      <section>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Negocios ({perfil.negocios.length})</h2>
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="py-3 px-4 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">
                    Negocio
                  </th>
                  <th className="py-3 px-4 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide hidden sm:table-cell">
                    Etapa
                  </th>
                  <th className="py-3 px-4 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wide">
                    Valor aprobado
                  </th>
                  <th className="py-3 px-4 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wide">
                    Honorario
                  </th>
                  <th className="py-3 px-4 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wide hidden md:table-cell">
                    Tarifa UPME
                  </th>
                </tr>
              </thead>
              <tbody>
                {perfil.negocios.map((n) => (
                  <tr key={n.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <Link href={`/negocios/${n.id}`} className="font-medium text-gray-900 hover:text-[#059669]">
                        {n.nombre ?? n.codigo ?? 'Negocio'}
                      </Link>
                      {n.codigo && <span className="block text-[11px] text-gray-400">{n.codigo}</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-600 hidden sm:table-cell">
                      {n.etapa_numero != null ? `E${n.etapa_numero} ` : ''}
                      {n.etapa_nombre ?? (n.stage ? STAGE_LABEL[n.stage] ?? n.stage : '')}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                      {fmtCOP(n.valor_aprobado)}
                    </td>
                    <td
                      className="py-3 px-4 text-right font-semibold tabular-nums whitespace-nowrap"
                      style={{ color: GREEN }}
                    >
                      {fmtCOP(n.honorario_recaudado)}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-400 tabular-nums whitespace-nowrap hidden md:table-cell">
                      {fmtCOP(n.tarifa_recaudada)}
                    </td>
                  </tr>
                ))}
                {perfil.negocios.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-gray-400">
                      Sin negocios.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}

function Kpi({
  label,
  value,
  color,
  muted,
}: {
  label: string
  value: string
  color?: string
  muted?: boolean
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
      <p
        className={`text-xl tabular-nums mt-1 ${muted ? 'font-semibold text-gray-500' : 'font-bold text-gray-900'}`}
        style={color ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  )
}

function RankPill({ label, rank, total }: { label: string; rank: number; total: number }) {
  if (!rank) return null
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-lg font-bold text-gray-900">
        #{rank} <span className="text-sm font-normal text-gray-500">de {total}</span>
      </p>
    </div>
  )
}
