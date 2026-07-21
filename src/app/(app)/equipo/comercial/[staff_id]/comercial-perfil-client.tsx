'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { ArrowLeft, Trophy, Search, X, Clock, AlertTriangle } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { STAGE_LABEL, MESES_ES, type ComercialPerfil, type ComercialPerfilNegocio } from '../../comercial-types'
import type { RankingEquipo, RankingPersona } from '../../comercial-ranking'

const GREEN = '#059669'
const GOLD = '#D97706'
const RED = '#B91C1C'

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
function nombreCorto(s: string): string {
  return s.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
function fmtFecha(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })
}

type FaseFilter = 'todos' | 'venta' | 'ejecucion' | 'cobro' | 'cerrado'

const FASES: { key: FaseFilter; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'venta', label: 'Venta' },
  { key: 'ejecucion', label: 'Ejecucion' },
  { key: 'cobro', label: 'Cobro' },
  { key: 'cerrado', label: 'Cerrado' },
]

export default function ComercialPerfilClient({
  perfil,
  ranking,
  staffId,
  anio,
  mes,
}: {
  perfil: ComercialPerfil
  ranking: RankingEquipo
  staffId: string | null
  anio: number | null
  mes: number | null
}) {
  const router = useRouter()
  const pathname = usePathname()

  const titulo = perfil.sin_responsable ? 'Sin responsable' : nombreCorto(perfil.nombre)
  const miRanking = staffId ? ranking.personas.find((p) => p.responsable_id === staffId) ?? null : null
  const total = ranking.total

  // Etiqueta del periodo activo.
  const periodoLabel = anio != null && mes != null ? `${MESES_ES[mes - 1]} ${anio}` : 'Acumulado'

  // Opciones del selector de periodo: acumulado + los meses de la serie del vendedor.
  const opcionesPeriodo = useMemo(() => {
    const meses = [...perfil.serie]
      .map((p) => ({ value: `${p.anio}-${String(p.mes).padStart(2, '0')}`, label: `${MESES_ES[p.mes - 1]} ${p.anio}` }))
      .reverse() // mas reciente primero
    return meses
  }, [perfil.serie])

  const periodoValue = anio != null && mes != null ? `${anio}-${String(mes).padStart(2, '0')}` : 'acumulado'

  function cambiarPeriodo(value: string) {
    const url = value === 'acumulado' ? pathname : `${pathname}?mes=${value}`
    router.push(url)
  }

  return (
    <div>
      <Link
        href="/equipo"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Equipo comercial
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{titulo}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {perfil.sin_responsable ? 'Negocios sin responsable asignado' : perfil.position ?? 'Comercial'}
          </p>
        </div>
        {/* Selector de periodo: acumulado (default) o por mes. Filtra TODO el perfil y el ranking. */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Periodo</span>
          <select
            value={periodoValue}
            onChange={(e) => cambiarPeriodo(e.target.value)}
            aria-label="Periodo del perfil"
            className="rounded-lg border border-[#E5E7EB] bg-white py-2 px-3 text-sm font-medium text-[#1A1A1A] focus:border-[#1A1A1A]/30 focus:outline-none"
          >
            <option value="acumulado">Acumulado</option>
            {opcionesPeriodo.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Leaderboard: 3 comparativos + tabla del equipo. Transparente (todos ven cifras y posiciones). */}
      <section className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4" style={{ color: GOLD }} />
          <h2 className="text-sm font-bold text-gray-900">Leaderboard del equipo</h2>
          <span className="text-[11px] text-gray-400">· {periodoLabel}</span>
        </div>

        {miRanking && (
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ComparativoCard
              label="Numero de ventas"
              valor={String(miRanking.num_ventas)}
              rank={miRanking.rank_ventas}
              total={total}
            />
            <ComparativoCard
              label="Honorario recaudado"
              valor={fmtCOP(miRanking.honorario_recaudado)}
              rank={miRanking.rank_honorario}
              total={total}
              color={GREEN}
            />
            <ComparativoCard
              label="Cumplimiento de meta"
              valor={miRanking.pct_cumplimiento != null ? `${miRanking.pct_cumplimiento}%` : 'Sin meta'}
              rank={miRanking.rank_cumplimiento}
              total={ranking.personas.filter((p) => p.pct_cumplimiento != null).length}
              subrayado={
                miRanking.meta_num_ventas != null
                  ? `Meta: ${miRanking.meta_num_ventas} ventas`
                  : 'Sin meta propia asignada'
              }
              sinDato={miRanking.pct_cumplimiento == null}
            />
          </div>
        )}

        <LeaderboardTabla ranking={ranking} destacado={staffId} />
      </section>

      {/* KPIs del periodo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Ventas" value={String(perfil.kpis.num_ventas)} color={GREEN} />
        <Kpi label="Negocios activos" value={String(perfil.kpis.negocios_abiertos)} />
        <Kpi label="Valor aprobado" value={fmtCOP(perfil.kpis.valor_aprobado)} />
        <Kpi label="Honorario recaudado" value={fmtCOP(perfil.kpis.honorario_recaudado)} color={GREEN} />
        <Kpi label="Pendiente de recaudo" value={fmtCOP(perfil.kpis.pendiente_honorario)} />
        <Kpi label="Vencidos (SLA)" value={String(perfil.kpis.vencidos)} color={perfil.kpis.vencidos > 0 ? RED : undefined} />
        <Kpi label="Tarifa UPME (terceros)" value={fmtCOP(perfil.kpis.tarifa_recaudada)} muted />
      </div>

      {/* Graficas historicas del vendedor: ventas/mes + recaudo/mes (12 meses) */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard titulo="Ventas por mes">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={perfil.serie} margin={{ left: -20, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => [`${v}`, 'Ventas']} />
              <Bar dataKey="num_ventas" fill={GREEN} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard titulo="Recaudo por mes (honorario)">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={perfil.serie} margin={{ left: -4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} width={64}
                tickFormatter={(v) => `$${(Number(v) / 1_000_000).toFixed(0)}M`} />
              <Tooltip formatter={(v) => [fmtCOP(Number(v)), 'Recaudo']} />
              <Line type="monotone" dataKey="honorario_recaudado" stroke={GREEN} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      {/* Embudo por etapa/estatus con monto pendiente de recaudo */}
      <section className="mb-6">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Embudo por etapa (pendiente de recaudo)</h2>
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <th className="py-3 px-4 text-left">Etapa</th>
                  <th className="py-3 px-4 text-right">Negocios</th>
                  <th className="py-3 px-4 text-right">Valor aprobado</th>
                  <th className="py-3 px-4 text-right">Pendiente de recaudo</th>
                </tr>
              </thead>
              <tbody>
                {perfil.porEtapa.map((e, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-3 px-4">
                      <span className="font-medium text-gray-900">
                        {e.etapa_numero != null ? `E${e.etapa_numero} ` : ''}{e.etapa_nombre}
                      </span>
                      {e.stage && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                          {STAGE_LABEL[e.stage] ?? e.stage}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-900 tabular-nums">{e.negocios}</td>
                    <td className="py-3 px-4 text-right text-gray-600 tabular-nums">{fmtCOP(e.valor_aprobado)}</td>
                    <td className="py-3 px-4 text-right font-semibold tabular-nums" style={{ color: e.pendiente_honorario > 0 ? '#B45309' : '#9CA3AF' }}>
                      {fmtCOP(e.pendiente_honorario)}
                    </td>
                  </tr>
                ))}
                {perfil.porEtapa.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-sm text-gray-400">Sin negocios.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Negocios del vendedor con filtros (fase + etapa + busqueda) y SLA/ultimo avance */}
      <NegociosVendedor negocios={perfil.negocios} />
    </div>
  )
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

function ComparativoCard({
  label, valor, rank, total, color, subrayado, sinDato,
}: {
  label: string
  valor: string
  rank: number
  total: number
  color?: string
  subrayado?: string
  sinDato?: boolean
}) {
  const esPrimero = rank === 1 && !sinDato
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: sinDato ? '#9CA3AF' : color ?? '#1A1A1A' }}>
        {valor}
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        {sinDato || !rank ? (
          <span className="text-xs text-gray-400">{subrayado ?? 'Sin posicion'}</span>
        ) : (
          <>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{ backgroundColor: esPrimero ? '#FEF3C7' : '#F3F4F6', color: esPrimero ? GOLD : '#6B7280' }}
            >
              {esPrimero && <Trophy className="h-3 w-3" />}#{rank} de {total}
            </span>
            {subrayado && <span className="text-[11px] text-gray-400">{subrayado}</span>}
          </>
        )}
      </div>
    </div>
  )
}

function LeaderboardTabla({ ranking, destacado }: { ranking: RankingEquipo; destacado: string | null }) {
  // Orden del leaderboard: por numero de ventas (metrica primaria), ya viene ordenado.
  const filas: RankingPersona[] = ranking.personas
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] font-bold uppercase tracking-wide text-gray-400">
              <th className="py-3 px-4 text-left">#</th>
              <th className="py-3 px-4 text-left">Comercial</th>
              <th className="py-3 px-4 text-right">Ventas</th>
              <th className="py-3 px-4 text-right">Recaudo</th>
              <th className="py-3 px-4 text-right">Cumplimiento</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => {
              const yo = p.responsable_id === destacado
              return (
                <tr
                  key={p.responsable_id}
                  className={`border-b border-gray-50 ${yo ? 'bg-emerald-50/60' : 'hover:bg-gray-50/50'}`}
                >
                  <td className="py-3 px-4 tabular-nums">
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                      style={{ backgroundColor: p.rank_ventas === 1 ? '#FEF3C7' : '#F3F4F6', color: p.rank_ventas === 1 ? GOLD : '#6B7280' }}
                    >
                      {p.rank_ventas}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <Link href={`/equipo/comercial/${p.responsable_id}`} className={`font-medium ${yo ? 'text-[#059669]' : 'text-gray-900 hover:text-[#059669]'}`}>
                      {nombreCorto(p.nombre)}
                    </Link>
                    {yo && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Tu</span>}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">{p.num_ventas}</td>
                  <td className="py-3 px-4 text-right font-semibold tabular-nums" style={{ color: GREEN }}>{fmtCOP(p.honorario_recaudado)}</td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {p.pct_cumplimiento != null ? (
                      <span className="font-semibold text-gray-900">{p.pct_cumplimiento}%</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {filas.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-400">Sin comerciales con negocios.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Negocios del vendedor (config /negocios: fase + etapa + busqueda) ─────────

function NegociosVendedor({ negocios }: { negocios: ComercialPerfilNegocio[] }) {
  const [fase, setFase] = useState<FaseFilter>('todos')
  const [etapaNum, setEtapaNum] = useState<number | null>(null)
  const [q, setQ] = useState('')

  // Fases presentes en los negocios del vendedor (para no mostrar pills vacios).
  const fasesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const n of negocios) if (n.stage) set.add(n.stage)
    return FASES.filter((f) => f.key === 'todos' || set.has(f.key))
  }, [negocios])

  // Etapas de la fase seleccionada (numero+nombre, en orden de numero).
  const etapasDeFase = useMemo(() => {
    if (fase === 'todos') return []
    const map = new Map<number, string>()
    for (const n of negocios) {
      if (n.stage === fase && n.etapa_numero != null) map.set(n.etapa_numero, n.etapa_nombre ?? `E${n.etapa_numero}`)
    }
    return Array.from(map, ([numero, nombre]) => ({ numero, nombre })).sort((a, b) => a.numero - b.numero)
  }, [negocios, fase])

  const faseCount = (key: FaseFilter) =>
    key === 'todos' ? negocios.length : negocios.filter((n) => n.stage === key).length
  const etapaCount = (numero: number) => negocios.filter((n) => n.etapa_numero === numero).length

  function seleccionarFase(key: FaseFilter) {
    setFase(key)
    setEtapaNum(null)
  }

  const term = q.trim().toLowerCase()
  const filtrados = useMemo(() => {
    let res = negocios
    if (fase !== 'todos') res = res.filter((n) => n.stage === fase)
    if (etapaNum !== null) res = res.filter((n) => n.etapa_numero === etapaNum)
    if (term) {
      res = res.filter((n) =>
        [n.codigo, n.nombre, n.etapa_nombre].filter(Boolean).join(' ').toLowerCase().includes(term),
      )
    }
    return res
  }, [negocios, fase, etapaNum, term])

  return (
    <section>
      <h2 className="text-sm font-bold text-gray-900 mb-3">Negocios ({filtrados.length})</h2>

      {/* Nivel 1: fases */}
      <div className="mb-2 flex flex-wrap gap-2">
        {fasesDisponibles.map((f) => {
          const count = faseCount(f.key)
          const active = fase === f.key
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => seleccionarFase(f.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-[#1A1A1A]/20 bg-[#F5F4F2] text-[#1A1A1A]'
                  : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A]'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-black/10' : 'bg-[#F5F4F2]'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Nivel 2: etapas de la fase */}
      {etapasDeFase.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setEtapaNum(null)}
            className={`shrink-0 rounded-full border px-2.5 py-1 transition-colors ${
              etapaNum === null ? 'border-[#1A1A1A]/30 bg-[#F5F4F2] text-[#1A1A1A]' : 'border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]'
            }`}
          >
            Todas
          </button>
          {etapasDeFase.map((e) => {
            const count = etapaCount(e.numero)
            const active = etapaNum === e.numero
            return (
              <button
                key={e.numero}
                type="button"
                onClick={() => setEtapaNum(e.numero)}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ${
                  active ? 'border-[#1A1A1A]/30 bg-[#F5F4F2] text-[#1A1A1A]' : 'border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]'
                }`}
              >
                {e.nombre}
                <span className={`rounded-full px-1 py-0.5 text-[10px] font-bold ${active ? 'bg-black/10' : 'bg-[#F5F4F2]'}`}>{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Busqueda */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por codigo, nombre o etapa…"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 pl-9 pr-9 text-sm text-[#1A1A1A] placeholder:text-[#6B7280] focus:border-[#1A1A1A]/30 focus:outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Limpiar busqueda"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#1A1A1A]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="py-3 px-4 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">Negocio</th>
                <th className="py-3 px-4 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Etapa</th>
                <th className="py-3 px-4 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide hidden md:table-cell">Ultimo avance</th>
                <th className="py-3 px-4 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">SLA</th>
                <th className="py-3 px-4 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wide">Valor aprobado</th>
                <th className="py-3 px-4 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wide">Honorario</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((n) => (
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
                  <td className="py-3 px-4 text-gray-600 tabular-nums hidden md:table-cell whitespace-nowrap">
                    {fmtFecha(n.ultimo_avance)}
                  </td>
                  <td className="py-3 px-4">
                    <SlaBadge estado={n.sla_estado} />
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                    {fmtCOP(n.valor_aprobado)}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold tabular-nums whitespace-nowrap" style={{ color: GREEN }}>
                    {fmtCOP(n.honorario_recaudado)}
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-gray-400">Sin negocios en este filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function SlaBadge({ estado }: { estado: ComercialPerfilNegocio['sla_estado'] }) {
  if (estado === 'vencido') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
        <AlertTriangle className="h-3 w-3" /> Vencido
      </span>
    )
  }
  if (estado === 'a_tiempo') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
        <Clock className="h-3 w-3" /> A tiempo
      </span>
    )
  }
  return <span className="text-[11px] text-gray-400">—</span>
}

// ── Primitivos ───────────────────────────────────────────────────────────────

function ChartCard({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-bold text-gray-900">{titulo}</p>
      {children}
    </div>
  )
}

function Kpi({ label, value, color, muted }: { label: string; value: string; color?: string; muted?: boolean }) {
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
