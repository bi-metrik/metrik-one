'use client'

import Link from 'next/link'
import { Trophy, ArrowRight, Users } from 'lucide-react'
import type {
  ComercialResumenRow,
  ComercialMesResponse,
  ComercialVendedorMes,
} from './comercial-types'
import { MESES_ES } from './comercial-types'
import { computeRanking, type RankingPersona } from './comercial-ranking'

const GREEN = '#059669'
const GOLD = '#D97706'

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
function nombreCorto(s: string): string {
  return s.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
function iniciales(s: string): string {
  const p = s.split(' ').filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}

interface Props {
  resumen: ComercialResumenRow[]
  mesData: ComercialMesResponse | null
  anio: number
  mes: number
}

/**
 * Hoja de indicadores POR PERSONA (no el agregado, que vive en Tableros).
 * Cada persona ve sus propios indicadores + su posicion en el ranking del equipo.
 * El bucket "(sin responsable)" aparece como fila informativa, fuera del ranking.
 */
export default function EquipoComercialPersonasClient({ resumen, mesData, anio, mes }: Props) {
  const ranking = computeRanking(resumen)
  const ventasMesPorId = new Map<string, ComercialVendedorMes>()
  for (const v of mesData?.porVendedor ?? []) {
    if (v.responsable_id) ventasMesPorId.set(v.responsable_id, v)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Equipo comercial</h1>
        <p className="mt-1 text-sm text-gray-500">
          Indicadores por persona y posicion en el ranking del equipo. El tablero agregado vive en Tableros.
        </p>
      </div>

      {/* Ranking / hoja por persona */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ranking.personas.map((p) => (
          <PersonaCard
            key={p.responsable_id}
            persona={p}
            total={ranking.total}
            ventasMes={ventasMesPorId.get(p.responsable_id) ?? null}
            mesLabel={`${MESES_ES[mes - 1]} ${anio}`}
          />
        ))}
      </div>

      {/* Bucket sin responsable: informativo, fuera del ranking */}
      {ranking.sinResponsable && ranking.sinResponsable.negocios_total > 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-700">Sin responsable</p>
              <p className="text-xs text-gray-400">
                {ranking.sinResponsable.negocios_total} negocios sin asignar (fuera del ranking)
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-700 tabular-nums">
                {ranking.sinResponsable.negocios_abiertos} activos
              </p>
              <p className="text-xs text-gray-400 tabular-nums">{fmtCOP(ranking.sinResponsable.valor_aprobado)}</p>
            </div>
          </div>
        </div>
      )}

      {ranking.personas.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">Aun no hay vendedores con negocios asignados.</p>
        </div>
      )}
    </div>
  )
}

function PersonaCard({
  persona,
  total,
  ventasMes,
  mesLabel,
}: {
  persona: RankingPersona
  total: number
  ventasMes: ComercialVendedorMes | null
  mesLabel: string
}) {
  return (
    <Link
      href={`/equipo/comercial/${persona.responsable_id}`}
      className="group rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:border-gray-200 hover:shadow-md"
    >
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1A1A1A] text-xs font-bold text-white">
          {iniciales(persona.nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-gray-900">{nombreCorto(persona.nombre)}</p>
          <p className="truncate text-xs text-gray-400">{persona.position ?? 'Comercial'}</p>
        </div>
        <RankBadge rank={persona.rank_honorario} total={total} />
      </div>

      {/* Indicadores del mes */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Mini label={`Ventas ${mesLabel}`} value={ventasMes ? String(ventasMes.num_ventas) : '0'} />
        <Mini
          label="Valor vendido"
          value={ventasMes ? fmtCOP(ventasMes.valor_sin_iva) : '$0'}
          color={GREEN}
        />
      </div>

      {/* Indicadores acumulados + posiciones */}
      <div className="space-y-2 border-t border-gray-50 pt-3">
        <RankRow
          label="Honorario recaudado"
          value={fmtCOP(persona.honorario_recaudado)}
          rank={persona.rank_honorario}
          total={total}
          strong
        />
        <RankRow
          label="Valor aprobado"
          value={fmtCOP(persona.valor_aprobado)}
          rank={persona.rank_valor}
          total={total}
        />
        <RankRow
          label="Negocios activos"
          value={String(persona.negocios_abiertos)}
          rank={persona.rank_negocios}
          total={total}
        />
      </div>

      <div className="mt-4 flex items-center justify-end text-xs font-semibold text-[#059669]">
        Ver mi hoja
        <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function RankBadge({ rank, total }: { rank: number; total: number }) {
  if (!rank) return null
  const esPrimero = rank === 1
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold"
      style={{
        backgroundColor: esPrimero ? '#FEF3C7' : '#F3F4F6',
        color: esPrimero ? GOLD : '#6B7280',
      }}
      title={`Posicion ${rank} de ${total} en honorario recaudado`}
    >
      {esPrimero && <Trophy className="h-3 w-3" />}
      #{rank} de {total}
    </span>
  )
}

function Mini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-gray-900" style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  )
}

function RankRow({
  label,
  value,
  rank,
  total,
  strong,
}: {
  label: string
  value: string
  rank: number
  total: number
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`tabular-nums whitespace-nowrap text-sm ${strong ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>
          {value}
        </span>
        {rank > 0 && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 tabular-nums" title={`Posicion ${rank} de ${total}`}>
            #{rank}
          </span>
        )}
      </div>
    </div>
  )
}
