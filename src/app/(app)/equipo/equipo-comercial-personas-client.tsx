'use client'

import Link from 'next/link'
import { ArrowRight, Users } from 'lucide-react'
import { GREEN, iniciales, nombreCorto, Mini, RankBadge, RankRow } from './persona-ui'
import type {
  ComercialResumenRow,
  ComercialMesResponse,
  ComercialVendedorMes,
} from './comercial-types'
import { etiquetaMes, paramMes } from './mes-navegacion'
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
 *
 * ⚠️ TODA la tarjeta habla del mes seleccionado, ranking incluido: `resumen` llega ya
 * filtrado por el periodo. Lo unico que no se mueve con el mes son los dos bloques de
 * abajo (lideres y sin responsable), que muestran INVENTARIO a hoy (casos abiertos y
 * valor aprobado) porque la RPC no los filtra por periodo, y porque un caso abierto
 * esta abierto hoy, no en agosto. Ahi la etiqueta lo dice en pantalla: sin esa nota,
 * cambiar de mes y ver la misma cifra se lee como un tablero congelado.
 */
export default function EquipoComercialPersonasClient({ resumen, mesData, anio, mes, metasPorVendedor }: Props) {
  const ranking = computeRanking(resumen, new Map(metasPorVendedor))
  const ventasMesPorId = new Map<string, ComercialVendedorMes>()
  for (const v of mesData?.porVendedor ?? []) {
    if (v.responsable_id) ventasMesPorId.set(v.responsable_id, v)
  }
  const mesLabel = etiquetaMes(anio, mes)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Equipo comercial · {mesLabel}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ventas, recaudo y cumplimiento de {mesLabel}, con la posición de cada persona en el
          ranking de ese mes. El tablero agregado vive en Tableros.
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
            mesParam={paramMes(anio, mes)}
          />
        ))}
      </div>

      {/* Quien lidera no compite, pero sus casos se ven: si se ocultaran, la suma del
          equipo quedaria corta sin explicar por que. */}
      {ranking.lideres.length > 0 && (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
            Casos que llevan los lideres
          </p>
          <p className="mb-3 mt-1 text-xs text-gray-400">
            Inventario a hoy: no depende del mes seleccionado.
          </p>
          <div className="space-y-3">
            {ranking.lideres.map((l) => (
              <div key={l.responsable_id} className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
                  {iniciales(l.nombre)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-gray-700">{nombreCorto(l.nombre)}</p>
                  <p className="text-xs text-gray-400">{l.position ?? 'Lidera el equipo'} · fuera del ranking</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-700 tabular-nums">{l.negocios_abiertos} activos hoy</p>
                  <p className="text-xs text-gray-400 tabular-nums">{fmtCOP(l.valor_aprobado)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                {ranking.sinResponsable.negocios_total} negocios sin asignar (fuera del ranking) ·
                inventario a hoy, no depende del mes seleccionado
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-700 tabular-nums">
                {ranking.sinResponsable.negocios_abiertos} activos hoy
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
  mesParam,
}: {
  persona: RankingPersona
  total: number
  ventasMes: ComercialVendedorMes | null
  /** `YYYY-MM` del periodo activo: viaja al perfil para que abra en el mismo mes. */
  mesParam: string
}) {
  return (
    <Link
      href={`/equipo/comercial/${persona.responsable_id}?mes=${mesParam}`}
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

      {/* Indicadores del mes seleccionado. Las ventas salen del resumen (la MISMA
          fuente que la meta y el ranking): si vinieran del KPI del mes, la tarjeta
          podria mostrar "4 ventas" al lado de un cumplimiento calculado sobre 5.
          El mes no se repite en cada etiqueta: lo dice el titulo de la pagina. */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Mini label="Ventas" value={String(persona.num_ventas)} />
        <Mini
          label="Valor vendido"
          value={ventasMes ? fmtCOP(ventasMes.valor_sin_iva) : '$0'}
          color={GREEN}
        />
      </div>

      {/* Posiciones del mes. La fila de ventas NO se repite aqui: mostraria el mismo
          numero de arriba con otro nombre (era "Ventas (total)" cuando el resumen si
          era historico), y su posicion ya la lleva el distintivo del encabezado. */}
      <div className="space-y-2 border-t border-gray-50 pt-3">
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
