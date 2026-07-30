'use client'

import Link from 'next/link'
import { ArrowRight, Users } from 'lucide-react'
import { GREEN, iniciales, nombreCorto, Mini, RankBadge, RankRow } from './persona-ui'
import type {
  ComercialResumenRow,
  ComercialMesResponse,
  ComercialVendedorMes,
} from './comercial-types'
import { MESES_ES } from './comercial-types'
import { computeRanking, type RankingPersona } from './comercial-ranking'

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

interface Props {
  resumen: ComercialResumenRow[]
  mesData: ComercialMesResponse | null
  anio: number
  mes: number
  /** Metas por vendedor del mes (staff_id, meta_num_ventas). Maps no serializan cross-boundary. */
  metasPorVendedor: [string, number][]
}

/**
 * Hoja de indicadores POR PERSONA (no el agregado, que vive en Tableros).
 * Cada persona ve sus propios indicadores + su posicion en el ranking del equipo.
 * El bucket "(sin responsable)" aparece como fila informativa, fuera del ranking.
 */
export default function EquipoComercialPersonasClient({ resumen, mesData, anio, mes, metasPorVendedor }: Props) {
  const ranking = computeRanking(resumen, new Map(metasPorVendedor))
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
        <RankBadge rank={persona.rank_ventas} total={total} />
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

      {/* Indicadores acumulados + posiciones (ranking primario = ventas) */}
      <div className="space-y-2 border-t border-gray-50 pt-3">
        <RankRow
          label="Ventas (total)"
          value={String(persona.num_ventas)}
          rank={persona.rank_ventas}
          total={total}
          strong
        />
        <RankRow
          label="Honorario recaudado"
          value={fmtCOP(persona.honorario_recaudado)}
          rank={persona.rank_honorario}
          total={total}
        />
        <RankRow
          label="Cumplimiento de meta"
          value={persona.pct_cumplimiento != null ? `${persona.pct_cumplimiento}%` : 'Sin meta'}
          rank={persona.rank_cumplimiento}
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
