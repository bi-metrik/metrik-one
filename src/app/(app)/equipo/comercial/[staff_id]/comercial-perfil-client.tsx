'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, Trophy, Search, X, Clock, AlertTriangle } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { STAGE_LABEL, MESES_ES, type ComercialPerfil, type ComercialPerfilNegocio } from '../../comercial-types'
import type { RankingEquipo, RankingPersona } from '../../comercial-ranking'
import SelectorMesEquipo from '../../selector-mes'
import { VentasDrawer, type CifraSeleccionada } from '../../../tableros/components/ventas-drawer'
import { formatFecha } from '@/lib/dates/bogota'
import { PALETA } from '@/lib/marca/paleta'

const GREEN = PALETA.acento
const GOLD = '#D97706'
const RED = '#B91C1C'

/** Lo que no se mueve con el mes tiene que decirlo. Mismas palabras que en `/equipo`. */
const NOTA_INVENTARIO = 'Inventario a hoy, no depende del mes'

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
function nombreCorto(s: string): string {
  return s.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
function fmtFecha(iso: string | null): string {
  return formatFecha(iso, { day: '2-digit', month: 'short', year: '2-digit' }) ?? '—'
}

type FaseFilter = 'todos' | 'venta' | 'ejecucion' | 'cobro' | 'cerrado'

/**
 * Que responde la tabla de abajo: `mes` = lo que la persona VENDIO en el periodo elegido
 * (desempeno), `todos` = los casos que LLEVA (carga de trabajo). Sin mes elegido solo
 * existe el segundo.
 */
type CorteNegocios = 'mes' | 'todos'

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
  anioRef,
  mesRef,
}: {
  perfil: ComercialPerfil
  ranking: RankingEquipo
  staffId: string | null
  anio: number | null
  mes: number | null
  /** Mes de referencia (el que esta en curso). Lo usa el selector cuando se mira el acumulado. */
  anioRef: number
  mesRef: number
}) {
  const titulo = perfil.sin_responsable ? 'Sin responsable' : nombreCorto(perfil.nombre)
  const miRanking = staffId ? ranking.personas.find((p) => p.responsable_id === staffId) ?? null : null
  const total = ranking.total

  // Etiqueta del periodo activo.
  const hayPeriodo = anio != null && mes != null
  const periodoLabel = hayPeriodo ? `${MESES_ES[mes - 1]} ${anio}` : 'Acumulado'

  // Que cifra se abrio. `null` = panel cerrado. Mismo contrato que Tableros: el panel
  // muestra el conjunto que suma la cifra en la que se hizo clic, no una consulta
  // paralela. Por eso solo se puede abrir con un mes elegido: la RPC del panel filtra
  // por (anio, mes) y con `null` devolveria vacio, o sea una cifra que abre una lista
  // en blanco. El historico se mira navegando a `?mes=acumulado`.
  const [cifra, setCifra] = useState<CifraSeleccionada | null>(null)

  // La cifra se arma FUERA del manejador: asi el "hay periodo y hay ventas" se decide una
  // sola vez y el boton solo existe cuando hay algo que abrir. Cifra en cero no es boton,
  // igual que en Tableros: pintar como clicable algo que abre una lista vacia es peor que
  // no ofrecerlo.
  const cifraVentas: CifraSeleccionada | null =
    anio != null && mes != null && perfil.kpis.num_ventas > 0
      ? {
          anio,
          mes,
          responsableId: staffId,
          sinResponsable: perfil.sin_responsable,
          titulo: `Ventas de ${periodoLabel}`,
          alcance: titulo,
        }
      : null
  const abrirVentas = cifraVentas ? () => setCifra(cifraVentas) : undefined

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
        {/* Selector de periodo: el MISMO de `/equipo` y de Tableros (dos flechas), mas la
            salida al acumulado que esta pantalla si sabe responder. Antes era un
            desplegable con los meses de la SERIE, o sea solo los meses en los que la
            persona vendio: un mes sin ventas no se podia mirar, y es justo el que hay que
            poder mirar. Con las flechas se llega a cualquier mes. */}
        <SelectorMesEquipo
          anio={anio ?? anioRef}
          mes={mes ?? mesRef}
          conAcumulado
          enAcumulado={!hayPeriodo}
          className=""
        />
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
              onAbrir={miRanking.num_ventas > 0 ? abrirVentas : undefined}
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

      {/* KPIs.
          ⚠️ Solo TRES se mueven con el mes: ventas, honorario recaudado y tarifa. Los
          demas son INVENTARIO A HOY (la RPC no los filtra por periodo, y esta bien que no
          lo haga: un caso abierto esta abierto hoy, no en agosto). Cada uno lo dice en su
          etiqueta, porque sin esa nota cambiar de mes y ver la misma cifra se lee como una
          pantalla congelada. Misma nota, mismas palabras que en `/equipo`. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi
          label="Ventas"
          value={String(perfil.kpis.num_ventas)}
          color={GREEN}
          nota={periodoLabel}
          onAbrir={abrirVentas}
        />
        <Kpi label="Negocios activos" value={String(perfil.kpis.negocios_abiertos)} nota={NOTA_INVENTARIO} />
        <Kpi label="Valor aprobado (sin IVA)" value={fmtCOP(perfil.kpis.valor_aprobado)} nota={NOTA_INVENTARIO} />
        <Kpi label="Honorario recaudado" value={fmtCOP(perfil.kpis.honorario_recaudado)} color={GREEN} nota={periodoLabel} />
        {/* Cartera: con IVA, porque es lo que falta que entre a la cuenta. NO es
            "valor aprobado - recaudado": esas dos cifras estan en bases distintas. */}
        <Kpi label="Pendiente de recaudo (con IVA)" value={fmtCOP(perfil.kpis.pendiente_honorario)} nota={NOTA_INVENTARIO} />
        <Kpi
          label="Vencidos (SLA)"
          value={String(perfil.kpis.vencidos)}
          color={perfil.kpis.vencidos > 0 ? RED : undefined}
          nota={NOTA_INVENTARIO}
        />
        <Kpi label="Tarifa UPME (terceros)" value={fmtCOP(perfil.kpis.tarifa_recaudada)} muted nota={periodoLabel} />
      </div>

      {/* Graficas historicas del vendedor: ventas/mes + recaudo/mes (12 meses) */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard titulo="Ventas por mes">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={perfil.serie} margin={{ left: -20, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: PALETA.tintaSuave }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: PALETA.tintaSuave }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => [`${v}`, 'Ventas']} />
              <Bar dataKey="num_ventas" fill={GREEN} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard titulo="Recaudo por mes (honorario)">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={perfil.serie} margin={{ left: -4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: PALETA.tintaSuave }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: PALETA.tintaSuave }} tickLine={false} axisLine={false} width={64}
                tickFormatter={(v) => `$${(Number(v) / 1_000_000).toFixed(0)}M`} />
              <Tooltip formatter={(v) => [fmtCOP(Number(v)), 'Recaudo']} />
              <Line type="monotone" dataKey="honorario_recaudado" stroke={GREEN} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      {/* Embudo por etapa/estatus con monto pendiente de recaudo */}
      <section className="mb-6">
        <h2 className="text-sm font-bold text-gray-900">Embudo por etapa (pendiente de recaudo)</h2>
        {/* Tambien es inventario: son los casos que la persona lleva HOY, en la etapa en la
            que estan hoy. No se recorta al mes, y por eso lo dice. */}
        <p className="mb-3 mt-1 text-xs text-gray-400">{NOTA_INVENTARIO} seleccionado.</p>
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <th className="py-3 px-4 text-left">Etapa</th>
                  <th className="py-3 px-4 text-right">Negocios</th>
                  <th className="py-3 px-4 text-right">Valor aprobado (sin IVA)</th>
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

      {/* Negocios del vendedor con filtros (fase + etapa + busqueda) y SLA/ultimo avance.
          Arriba lleva el corte del periodo: lo que vendio en el mes, o todos sus casos. */}
      <NegociosVendedor
        negocios={perfil.negocios}
        periodoLabel={periodoLabel}
        hayPeriodo={hayPeriodo}
        ventasDelPeriodo={perfil.kpis.num_ventas}
      />

      {/* `key` por cifra: al pasar de una cifra a otra el panel se remonta y arranca
          cargando, en vez de mostrar por un instante la lista anterior. */}
      {cifra && (
        <VentasDrawer
          key={`${cifra.anio}-${cifra.mes}-${cifra.responsableId ?? 'sr'}`}
          cifra={cifra}
          onClose={() => setCifra(null)}
        />
      )}
    </div>
  )
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

function ComparativoCard({
  label, valor, rank, total, color, subrayado, sinDato, onAbrir,
}: {
  label: string
  valor: string
  rank: number
  total: number
  color?: string
  subrayado?: string
  sinDato?: boolean
  /** Abre los casos detras de la cifra. Solo lo trae "Numero de ventas". */
  onAbrir?: () => void
}) {
  const esPrimero = rank === 1 && !sinDato
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      {onAbrir ? (
        <button
          type="button"
          onClick={onAbrir}
          title="Ver los casos detras de esta cifra"
          className="mt-1 block text-2xl font-bold tabular-nums underline decoration-dotted underline-offset-4 hover:text-acento-hover"
          style={{ color: sinDato ? '#9CA3AF' : color ?? PALETA.tinta }}
        >
          {valor}
        </button>
      ) : (
        <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: sinDato ? '#9CA3AF' : color ?? PALETA.tinta }}>
          {valor}
        </p>
      )}
      <div className="mt-1 flex items-center gap-1.5">
        {sinDato || !rank ? (
          <span className="text-xs text-gray-400">{subrayado ?? 'Sin posicion'}</span>
        ) : (
          <>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{ backgroundColor: esPrimero ? '#FEF3C7' : '#F3F4F6', color: esPrimero ? GOLD : PALETA.tintaSuave }}
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
                  className={`border-b border-gray-50 ${yo ? 'bg-acento-tinte/60' : 'hover:bg-gray-50/50'}`}
                >
                  <td className="py-3 px-4 tabular-nums">
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                      style={{ backgroundColor: p.rank_ventas === 1 ? '#FEF3C7' : '#F3F4F6', color: p.rank_ventas === 1 ? GOLD : PALETA.tintaSuave }}
                    >
                      {p.rank_ventas}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <Link href={`/equipo/comercial/${p.responsable_id}`} className={`font-medium ${yo ? 'text-acento' : 'text-gray-900 hover:text-acento-hover'}`}>
                      {nombreCorto(p.nombre)}
                    </Link>
                    {yo && <span className="ml-2 rounded bg-acento/15 px-1.5 py-0.5 text-[10px] font-bold text-acento">Tu</span>}
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

function NegociosVendedor({ negocios, periodoLabel, hayPeriodo, ventasDelPeriodo }: {
  negocios: ComercialPerfilNegocio[]
  /** `Septiembre 2026` o `Acumulado`. */
  periodoLabel: string
  /** Hay un mes elegido (no el acumulado): solo entonces existe el corte por venta. */
  hayPeriodo: boolean
  /** El KPI `Ventas` de arriba. Sirve para comprobar que la lista suma lo mismo. */
  ventasDelPeriodo: number
}) {
  const pathname = usePathname()
  const [corte, setCorte] = useState<CorteNegocios>(hayPeriodo ? 'mes' : 'todos')
  const [fase, setFase] = useState<FaseFilter>('todos')
  const [etapaNum, setEtapaNum] = useState<number | null>(null)
  const [q, setQ] = useState('')

  // Las ventas del periodo. `es_venta` ya viene calculado por la RPC con EL MISMO
  // predicado que el KPI `Ventas` de arriba (`es_venta_periodo`), asi que el corte no
  // reinterpreta nada: filtra por lo que el servidor ya decidio.
  const ventasDelMes = useMemo(() => negocios.filter((n) => n.es_venta), [negocios])

  // El corte manda y los demas filtros operan DENTRO de el: un contador de etapa que
  // siguiera contando el historico mientras la tabla muestra el mes seria el mismo
  // defecto que este cambio corrige, un nivel mas abajo.
  const base = corte === 'mes' ? ventasDelMes : negocios

  // Fases presentes en el corte (para no mostrar pills vacios).
  const fasesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const n of base) if (n.stage) set.add(n.stage)
    return FASES.filter((f) => f.key === 'todos' || set.has(f.key))
  }, [base])

  // Etapas de la fase seleccionada (numero+nombre, en orden de numero).
  const etapasDeFase = useMemo(() => {
    if (fase === 'todos') return []
    const map = new Map<number, string>()
    for (const n of base) {
      if (n.stage === fase && n.etapa_numero != null) map.set(n.etapa_numero, n.etapa_nombre ?? `E${n.etapa_numero}`)
    }
    return Array.from(map, ([numero, nombre]) => ({ numero, nombre })).sort((a, b) => a.numero - b.numero)
  }, [base, fase])

  const faseCount = (key: FaseFilter) =>
    key === 'todos' ? base.length : base.filter((n) => n.stage === key).length
  // Cuenta lo que el clic va a mostrar: dentro del corte Y dentro de la fase abierta.
  const etapaCount = (numero: number) =>
    base.filter((n) => n.etapa_numero === numero && (fase === 'todos' || n.stage === fase)).length

  function seleccionarFase(key: FaseFilter) {
    setFase(key)
    setEtapaNum(null)
  }

  // Al cambiar de corte se sueltan fase y etapa: la fase elegida puede no existir en el
  // otro conjunto, y entonces la pantalla mostraria "sin negocios en este filtro" sin
  // ningun pill que explique por que.
  function seleccionarCorte(valor: CorteNegocios) {
    setCorte(valor)
    setFase('todos')
    setEtapaNum(null)
  }

  const term = q.trim().toLowerCase()
  const filtrados = useMemo(() => {
    let res = base
    if (fase !== 'todos') res = res.filter((n) => n.stage === fase)
    if (etapaNum !== null) res = res.filter((n) => n.etapa_numero === etapaNum)
    if (term) {
      res = res.filter((n) =>
        [n.codigo, n.nombre, n.etapa_nombre].filter(Boolean).join(' ').toLowerCase().includes(term),
      )
    }
    return res
  }, [base, fase, etapaNum, term])

  // ⚠️ El pill del mes TIENE que dar el mismo numero que el KPI `Ventas`: las dos cifras
  // salen del mismo CTE de la misma RPC. Si un dia no coinciden, el problema no es este
  // filtro sino que las dos definiciones de venta se separaron, y eso se dice en pantalla
  // en vez de dejar que alguien cruce las cifras a mano y no sepa a cual creerle.
  const listaYKpiDiscrepan = hayPeriodo && ventasDelMes.length !== ventasDelPeriodo

  return (
    <section>
      <h2 className="text-sm font-bold text-gray-900 mb-3">
        {corte === 'mes' ? `Vendidos en ${periodoLabel}` : 'Todos sus casos'} ({filtrados.length})
      </h2>

      {/* Nivel 0: el corte del periodo. Son DOS preguntas distintas y las dos se usan:
          "que vendio este mes" (desempeno) y "que casos lleva" (carga de trabajo, donde
          un caso de junio que sigue abierto es suyo hoy). Por eso la tabla no se
          reemplaza: se le pone el corte arriba. */}
      {hayPeriodo && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <PillCorte
            label={`Vendidos en ${periodoLabel}`}
            count={ventasDelMes.length}
            active={corte === 'mes'}
            onClick={() => seleccionarCorte('mes')}
          />
          <PillCorte
            label="Todos sus casos"
            count={negocios.length}
            active={corte === 'todos'}
            onClick={() => seleccionarCorte('todos')}
          />
          {/* La salida al historico. El clic en la cifra abre lo que la cifra CUENTA (el
              mes); ver todas las ventas es otra pregunta y tiene su propia puerta. */}
          <Link
            href={`${pathname}?mes=acumulado`}
            className="ml-auto text-xs font-semibold text-acento hover:text-acento-hover"
          >
            Ver todas sus ventas
          </Link>
        </div>
      )}

      {listaYKpiDiscrepan && (
        <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            La lista trae {ventasDelMes.length} venta{ventasDelMes.length === 1 ? '' : 's'} de {periodoLabel} y el
            indicador de arriba dice {ventasDelPeriodo}. Las dos cifras deberian salir del mismo calculo: hay que
            revisar la definicion de venta antes de usar cualquiera de las dos.
          </span>
        </p>
      )}

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
                  ? 'border-tinta/20 bg-papel text-tinta'
                  : 'border-[#E5E7EB] text-tinta-suave hover:border-tinta/30 hover:text-tinta'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-black/10' : 'bg-papel'}`}>
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
              etapaNum === null ? 'border-tinta/30 bg-papel text-tinta' : 'border-[#E5E7EB] text-tinta-suave hover:text-tinta'
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
                  active ? 'border-tinta/30 bg-papel text-tinta' : 'border-[#E5E7EB] text-tinta-suave hover:text-tinta'
                }`}
              >
                {e.nombre}
                <span className={`rounded-full px-1 py-0.5 text-[10px] font-bold ${active ? 'bg-black/10' : 'bg-papel'}`}>{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Busqueda */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-suave" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por codigo, nombre o etapa…"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 pl-9 pr-9 text-sm text-tinta placeholder:text-tinta-suave focus:border-tinta/30 focus:outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Limpiar busqueda"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-tinta-suave transition-colors hover:bg-papel hover:text-tinta"
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
                <th className="py-3 px-4 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wide">Valor aprobado (sin IVA)</th>
                <th className="py-3 px-4 text-right text-[11px] font-bold text-gray-400 uppercase tracking-wide">Honorario</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((n) => (
                <tr key={n.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="py-3 px-4">
                    <Link href={`/negocios/${n.id}`} className="font-medium text-gray-900 hover:text-acento-hover">
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
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-gray-400">
                    {/* Un mes sin ventas se dice con todas las letras. Caer a la lista
                        historica seria contestar otra pregunta sin avisar. */}
                    {corte === 'mes' && base.length === 0
                      ? `Sin ventas en ${periodoLabel}.`
                      : 'Sin negocios en este filtro.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

/**
 * Pill del corte del periodo. Misma marca visual que los pills de fase que ya usa esta
 * pantalla: es el mismo gesto (recortar la tabla), un nivel mas arriba.
 */
function PillCorte({ label, count, active, onClick }: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-tinta/20 bg-papel text-tinta'
          : 'border-[#E5E7EB] text-tinta-suave hover:border-tinta/30 hover:text-tinta'
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-black/10' : 'bg-papel'}`}>
        {count}
      </span>
    </button>
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
      <span className="inline-flex items-center gap-1 rounded-full bg-acento-tinte px-2 py-0.5 text-[11px] font-bold text-acento">
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

function Kpi({ label, value, color, muted, nota, onAbrir }: {
  label: string
  value: string
  color?: string
  muted?: boolean
  /** De que periodo habla la cifra, o si no depende del mes. Ver `NOTA_INVENTARIO`. */
  nota?: string
  /** Abre los casos que hay detras. Sin manejador, la tarjeta no es un boton. */
  onAbrir?: () => void
}) {
  const contenido = (
    <>
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
      <p
        className={`text-xl tabular-nums mt-1 ${muted ? 'font-semibold text-gray-500' : 'font-bold text-gray-900'} ${
          onAbrir ? 'underline decoration-dotted underline-offset-4' : ''
        }`}
        style={color ? { color } : undefined}
      >
        {value}
      </p>
      {nota && <p className="mt-1 text-[10px] text-gray-400">{nota}</p>}
    </>
  )
  // Sin `onAbrir` queda como estaba: una tarjeta, no un boton. Mismo criterio que Tableros.
  if (!onAbrir) {
    return <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">{contenido}</div>
  }
  return (
    <button
      type="button"
      onClick={onAbrir}
      title="Ver los casos detras de esta cifra"
      className="rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-gray-200 hover:bg-gray-50/60 focus:outline-none focus:ring-2 focus:ring-acento/20"
    >
      {contenido}
    </button>
  )
}
