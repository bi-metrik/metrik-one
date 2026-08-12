'use client'
import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import NegocioCard, { type StaffAsignable } from './negocio-card'
import BusquedaInput from '@/components/busqueda-input'
import EmptyState from '@/components/empty-state'
import { telefonoCoincide } from '@/lib/busqueda/telefono'
import { ORIGENES_NEGOCIO, origenNegocioLabel } from '@/lib/catalogos/constants'
import { marcaCondicionLabel } from '@/lib/negocios/constants'
import { segmentarNegocios } from '@/lib/negocios/segmentador'
import { useEstadoUrl } from '@/hooks/use-estado-url'
import { filtroDesdeSearchParams, type SearchParams, type ValorFiltro } from '@/lib/filtros/url-estado'
import type { NegocioResumen } from './negocio-v2-actions'

type FaseFilter = 'todos' | 'venta' | 'ejecucion' | 'cobro' | 'cerrados'
type MotivoCierre = 'todos' | 'exitoso' | 'perdido' | 'cancelado'

// Valores admisibles desde la URL. Sin esta lista, un `?fase=basura` (enlace viejo,
// barra de direcciones editada) deja la lista vacía sin explicación.
const FASES_VALIDAS: readonly FaseFilter[] = ['todos', 'venta', 'ejecucion', 'cobro', 'cerrados']
const MOTIVOS_VALIDOS: readonly MotivoCierre[] = ['todos', 'exitoso', 'perdido', 'cancelado']

/** Etapa del workflow de la línea, para el segmentador de nivel 2. */
export type EtapaSeg = { numero: number; nombre: string; stage: string; orden: number }

interface FaseSpec {
  key: FaseFilter
  label: string
  /** Tokens MeTRIK por stage. */
  active: { bg: string; text: string; border: string }
}

/**
 * Filtros transversales de la lista (todos menos fase/etapa y motivo de cierre).
 * `term` llega ya normalizado (trim + lowercase); cadena vacía = sin búsqueda.
 */
type FiltrosLista = {
  seccional: string
  responsable: string
  /** Valor de ORIGENES_NEGOCIO, 'todos', o 'sin_origen' (negocios previos a la captura). */
  origen: string
  term: string
  /** Solo negocios que pasaron el SLA de su etapa (etapas sin SLA nunca entran). */
  soloAtrasados: boolean
}

/** Valor del filtro para los negocios que no tienen origen registrado. */
const SIN_ORIGEN = 'sin_origen'

/** Orden de la lista. Default: el del servidor (más reciente primero). */
type SortKey = 'reciente' | 'atraso'
const SORT_VALIDOS: readonly SortKey[] = ['reciente', 'atraso']
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'reciente', label: 'Mas reciente' },
  { value: 'atraso', label: 'Mas atrasado' },
]

/** ¿El negocio pasó el SLA de su etapa? false si la etapa no tiene SLA configurado. */
const estaAtrasado = (n: NegocioResumen) =>
  n.sla_exceso_horas !== null && n.sla_exceso_horas > 0

/**
 * Origen que se muestra y se filtra. Misma regla que el badge de la tarjeta:
 * mientras el backfill de la columna no esté aplicado, un negocio marcado por la
 * integración de Meta cuenta como origen 'meta'. Una sola definición para que
 * filtro y badge no digan cosas distintas.
 */
const origenEfectivo = (n: NegocioResumen): string | null =>
  n.origen ?? (n.es_meta_lead ? 'meta' : null)

/**
 * Fuente única del filtrado de la lista de negocios.
 *
 * Antes esta lógica estaba copiada literalmente en tres `useMemo` (lista visible,
 * base de contadores de fase, cerrados). Cada filtro nuevo había que escribirlo
 * tres veces y cualquier olvido producía contadores que no cuadraban con la lista.
 */
function aplicarFiltros(lista: NegocioResumen[], f: FiltrosLista): NegocioResumen[] {
  let res = lista
  if (f.soloAtrasados) {
    res = res.filter(estaAtrasado)
  }
  if (f.seccional !== 'todas') {
    res = res.filter((n) => n.seccional_label === f.seccional)
  }
  if (f.responsable !== 'todos') {
    res = res.filter((n) => n.responsables.some((r) => r.id === f.responsable))
  }
  if (f.origen !== 'todos') {
    // 'sin_origen' aísla los negocios anteriores a la captura obligatoria: son
    // los que la financiera tiene que resolver a mano, no un caso a esconder.
    res = res.filter((n) =>
      f.origen === SIN_ORIGEN ? !origenEfectivo(n) : origenEfectivo(n) === f.origen,
    )
  }
  if (f.term) {
    res = res.filter((n) => {
      const hay = [n.codigo, n.nombre, n.empresa_nombre, n.contacto_nombre, n.vehiculo_label,
        n.cedula, n.radicado, n.numero_factura, n.seccional_label,
        origenNegocioLabel(origenEfectivo(n)), n.aliado_nombre,
        ...n.marcas.map((m) => marcaCondicionLabel(m.tipo)),
        ...n.responsables.map((r) => r.full_name)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      // El teléfono va aparte: comparado como texto casi nunca coincide, porque el
      // mismo número está guardado con indicativo, con paréntesis o pelado.
      return hay.includes(f.term) || telefonoCoincide(n.contacto_telefono, f.term)
    })
  }
  return res
}

// Tokens MeTRIK (no Tailwind generico)
const ALL_FASES: FaseSpec[] = [
  {
    key: 'todos',
    label: 'Todos',
    active: { bg: 'bg-[#F5F4F2]', text: 'text-[#1A1A1A]', border: 'border-[#1A1A1A]/20' },
  },
  {
    key: 'venta',
    label: 'Venta',
    active: { bg: 'bg-[#10B981]/10', text: 'text-[#059669]', border: 'border-[#10B981]' },
  },
  {
    key: 'ejecucion',
    label: 'Ejecucion',
    active: { bg: 'bg-[#FFF7ED]', text: 'text-[#C2410C]', border: 'border-[#FED7AA]' },
  },
  {
    key: 'cobro',
    label: 'Cobro',
    active: { bg: 'bg-[#EFF6FF]', text: 'text-[#2563EB]', border: 'border-[#BFDBFE]' },
  },
  {
    key: 'cerrados',
    label: 'Cerrados',
    active: { bg: 'bg-[#F5F4F2]', text: 'text-[#6B7280]', border: 'border-[#E5E7EB]' },
  },
]

export default function NegociosClient({
  negocios,
  cerrados,
  stagesActivos,
  etapas,
  defaultStage = 'todos',
  staffList = [],
  canAsignar = false,
  canMarcar = false,
  searchParams,
}: {
  negocios: NegocioResumen[]
  cerrados: NegocioResumen[]
  stagesActivos: string[]
  etapas: EtapaSeg[]
  defaultStage?: FaseFilter
  /** Staff activo del workspace, para el selector de responsable de la tarjeta. */
  staffList?: StaffAsignable[]
  /** Rol gerencial (owner/admin/supervisor): habilita asignar/quitar desde la lista. */
  canAsignar?: boolean
  /** Rol gerencial: habilita poner/quitar marcas de condición desde la lista. */
  canMarcar?: boolean
  /** Parámetros de la URL ya resueltos por el server component: filtros iniciales. */
  searchParams?: SearchParams
}) {
  // Segmentador jerárquico: fase (stage) → etapa (numero dentro de la fase).
  //
  // Los filtros viven en la URL (`useEstadoUrl`), no solo en estado de React: antes,
  // filtrar la lista, entrar a un caso y volver los borraba, y había que rehacerlos
  // cada vez. De paso la vista filtrada queda compartible por enlace.
  // El `inicial` lo resuelve el SERVIDOR desde los searchParams (ver `page.tsx`): sin
  // él, el primer render del servidor sale sin filtrar y el del cliente filtrado, que
  // es un desajuste de hidratación con parpadeo visible.
  const inicialDe = <T extends ValorFiltro>(clave: string, def: T, admisibles?: readonly T[]) =>
    ({ inicial: filtroDesdeSearchParams(searchParams, clave, def, admisibles), admisibles })

  const [fase, setFase] = useEstadoUrl<FaseFilter>('fase', defaultStage, inicialDe('fase', defaultStage, FASES_VALIDAS))
  const [etapaNum, setEtapaNum] = useEstadoUrl<number | null>('etapa', null, inicialDe('etapa', null))
  const [motivoCierre, setMotivoCierre] = useEstadoUrl<MotivoCierre>('cierre', 'todos', inicialDe('cierre', 'todos' as MotivoCierre, MOTIVOS_VALIDOS))
  const [q, setQ] = useEstadoUrl<string>('q', '', inicialDe('q', ''))
  const [seccional, setSeccional] = useEstadoUrl<string>('seccional', 'todas', inicialDe('seccional', 'todas'))
  const [responsable, setResponsable] = useEstadoUrl<string>('responsable', 'todos', inicialDe('responsable', 'todos'))
  const [origen, setOrigen] = useEstadoUrl<string>('origen', 'todos', inicialDe('origen', 'todos'))
  const [soloAtrasados, setSoloAtrasados] = useEstadoUrl<boolean>('atrasados', false, inicialDe('atrasados', false))
  const [sortBy, setSortBy] = useEstadoUrl<SortKey>('orden', 'reciente', inicialDe('orden', 'reciente' as SortKey, SORT_VALIDOS))

  // Seccionales DIAN presentes en los negocios (para el filtro). Solo las que existen.
  const seccionalesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const n of negocios) if (n.seccional_label) set.add(n.seccional_label)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))
  }, [negocios])

  // Responsables asignados presentes en los negocios (para el filtro). Únicos por id.
  const responsablesDisponibles = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of negocios) for (const r of n.responsables) map.set(r.id, r.full_name)
    return Array.from(map, ([id, full_name]) => ({ id, full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
  }, [negocios])

  // Cerrados filtrados por motivo
  const cerradosFiltrados = useMemo(() => {
    if (motivoCierre === 'todos') return cerrados
    return cerrados.filter((n) => n.cierre_motivo === motivoCierre)
  }, [cerrados, motivoCierre])

  // Etapas de la fase seleccionada (solo cuando la fase es un stage), en orden del workflow.
  const etapasDeFase = useMemo(
    () =>
      fase === 'venta' || fase === 'ejecucion' || fase === 'cobro'
        ? etapas.filter((e) => e.stage === fase).sort((a, b) => a.orden - b.orden)
        : [],
    [etapas, fase],
  )

  // Al cambiar de fase se limpia la etapa seleccionada.
  const seleccionarFase = (key: FaseFilter) => {
    setFase(key)
    setEtapaNum(null)
  }

  // Búsqueda libre (código, nombre/contacto, empresa, vehículo, celular, cédula, radicado) + filtro de seccional DIAN
  const term = q.trim().toLowerCase()
  const filtros = useMemo<FiltrosLista>(
    () => ({ seccional, responsable, origen, term, soloAtrasados }),
    [seccional, responsable, origen, term, soloAtrasados],
  )

  // Lista + contadores de etapa salen de la misma segmentación: el contador de una etapa
  // NO se filtra a sí mismo (si no, al elegir una etapa las demás caen a cero y se pierde
  // la foto de la fase). Regla y pruebas en src/lib/negocios/segmentador.ts.
  const segmentacion = useMemo(
    () =>
      segmentarNegocios(negocios, cerradosFiltrados, fase, etapaNum, (xs) =>
        aplicarFiltros(xs, filtros),
      ),
    [negocios, cerradosFiltrados, fase, etapaNum, filtros],
  )
  const currentFiltradoSinOrden = segmentacion.lista
  const etapaCount = segmentacion.contarEtapa

  // Orden. 'reciente' respeta el orden del servidor (created_at desc).
  // 'atraso' pone primero al más atrasado; los que no tienen SLA (o van a
  // tiempo) quedan al final, sin reordenarse entre sí.
  const currentFiltrado = useMemo(() => {
    if (sortBy !== 'atraso') return currentFiltradoSinOrden
    // Clave finita (no -Infinity): restar dos infinitos da NaN y un comparador
    // que devuelve NaN deja el orden indefinido.
    const exceso = (n: NegocioResumen) => n.sla_exceso_horas ?? -1e9
    return [...currentFiltradoSinOrden].sort((a, b) => exceso(b) - exceso(a))
  }, [currentFiltradoSinOrden, sortBy])

  // Negocios con todos los filtros activos EXCEPTO fase/etapa (responsable + seccional + búsqueda).
  // Base para los contadores de fase: refleja el filtro de responsable, seccional y búsqueda libre
  // sin que el tab de fase seleccionado distorsione los totales de los demás tabs.
  const negociosFiltrados = useMemo(() => aplicarFiltros(negocios, filtros), [negocios, filtros])

  // Cerrados con los mismos filtros de responsable + seccional + búsqueda (ya filtrados por motivo).
  const cerradosFiltradosConFiltros = useMemo(
    () => aplicarFiltros(cerradosFiltrados, filtros),
    [cerradosFiltrados, filtros],
  )

  // ── Contadores — reflejan todos los filtros activos excepto la fase/etapa. ──
  const faseCount = (key: FaseFilter) =>
    key === 'todos'
      ? negociosFiltrados.length
      : key === 'cerrados'
        ? cerradosFiltradosConFiltros.length
        : negociosFiltrados.filter((n) => n.stage_actual === key).length

  // Atrasados dentro de la fase/etapa seleccionada, ignorando el propio toggle
  // (si no, al activarlo el contador se congelaría en su propio resultado).
  const atrasadosCount = useMemo(
    () =>
      segmentarNegocios(negocios, cerradosFiltrados, fase, etapaNum, (xs) =>
        aplicarFiltros(xs, { ...filtros, soloAtrasados: false }),
      ).lista.filter(estaAtrasado).length,
    [negocios, cerradosFiltrados, fase, etapaNum, filtros],
  )

  // Orígenes presentes en la lista (abiertos + cerrados), con su conteo. Solo se
  // ofrecen los que existen: un desplegable con orígenes vacíos es ruido.
  const origenesDisponibles = useMemo(() => {
    const conteo = new Map<string, number>()
    for (const n of [...negocios, ...cerrados]) {
      const key = origenEfectivo(n) ?? SIN_ORIGEN
      conteo.set(key, (conteo.get(key) ?? 0) + 1)
    }
    const orden = ORIGENES_NEGOCIO.map((o) => o.value as string)
    return Array.from(conteo, ([value, count]) => ({
      value,
      label: value === SIN_ORIGEN ? 'Sin origen registrado' : (origenNegocioLabel(value) ?? value),
      count,
    })).sort((a, b) => {
      // Catálogo en su orden; 'sin origen' de último (es el residuo histórico).
      const ia = a.value === SIN_ORIGEN ? 999 : orden.indexOf(a.value)
      const ib = b.value === SIN_ORIGEN ? 999 : orden.indexOf(b.value)
      return ia - ib
    })
  }, [negocios, cerrados])

  // Fases visibles (según stages activos del workspace + si hay cerrados).
  const fases = ALL_FASES.filter((f) =>
    f.key === 'todos'
      ? true
      : f.key === 'cerrados'
        ? cerrados.length > 0
        : stagesActivos.includes(f.key),
  )

  const showEmpty = currentFiltrado.length === 0
  const isFilteringMotivo = fase === 'cerrados' && motivoCierre !== 'todos'
  // "La búsqueda no encontró nada" solo si la fase/etapa SÍ tiene negocios sin filtrar
  // (si no, el vacío es de la etapa, no de la búsqueda).
  const hayEnFaseEtapa =
    segmentarNegocios(negocios, cerradosFiltrados, fase, etapaNum, (xs) => xs).lista.length > 0
  const sinResultadosBusqueda = term.length > 0 && currentFiltrado.length === 0 && hayEnFaseEtapa

  return (
    <div className="space-y-4">
      {/* Nivel 1: fases */}
      <div className="flex flex-wrap gap-2">
        {fases.map((f) => {
          const count = faseCount(f.key)
          const active = fase === f.key
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => seleccionarFase(f.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? `${f.active.bg} ${f.active.text} ${f.active.border}`
                  : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A]'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-black/10' : 'bg-[#F5F4F2]'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Nivel 2: etapas de la fase seleccionada (solo stages) */}
      {etapasDeFase.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setEtapaNum(null)}
            className={`shrink-0 rounded-full border px-2.5 py-1 transition-colors ${
              etapaNum === null
                ? 'border-[#1A1A1A]/30 bg-[#F5F4F2] text-[#1A1A1A]'
                : 'border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]'
            }`}
          >
            Todas
          </button>
          {etapasDeFase.map((e) => {
            const count = etapaCount(e.numero)
            const active = etapaNum === e.numero
            const vacia = count === 0
            return (
              <button
                key={e.numero}
                type="button"
                onClick={() => setEtapaNum(e.numero)}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ${
                  active
                    ? 'border-[#1A1A1A]/30 bg-[#F5F4F2] text-[#1A1A1A]'
                    : vacia
                      ? 'border-[#E5E7EB] text-[#6B7280]/50 hover:text-[#6B7280]'
                      : 'border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]'
                }`}
              >
                {e.nombre}
                <span
                  className={`rounded-full px-1 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-black/10' : vacia ? 'bg-[#F5F4F2] text-[#6B7280]/50' : 'bg-[#F5F4F2]'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Barra de búsqueda */}
      <BusquedaInput
        value={q}
        onChange={setQ}
        placeholder="Buscar por código, cliente, celular, cédula, seccional o vehículo…"
        ariaLabel="Buscar negocios"
      />

      {/* Filtro por seccional DIAN (solo si hay seccionales en los negocios) */}
      {seccionalesDisponibles.length > 0 && (
        <select
          value={seccional}
          onChange={(e) => setSeccional(e.target.value)}
          aria-label="Filtrar por seccional DIAN"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 px-3 text-sm text-[#1A1A1A] focus:border-[#1A1A1A]/30 focus:outline-none"
        >
          <option value="todas">Todas las seccionales DIAN</option>
          {seccionalesDisponibles.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}

      {/* Filtro por origen del negocio (solo si hay más de un origen distinto) */}
      {origenesDisponibles.length > 1 && (
        <select
          value={origen}
          onChange={(e) => setOrigen(e.target.value)}
          aria-label="Filtrar por origen del negocio"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 px-3 text-sm text-[#1A1A1A] focus:border-[#1A1A1A]/30 focus:outline-none"
        >
          <option value="todos">Todos los orígenes</option>
          {origenesDisponibles.map((o) => (
            <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
          ))}
        </select>
      )}

      {/* Filtro por responsable asignado (solo si hay responsables en los negocios) */}
      {responsablesDisponibles.length > 0 && (
        <select
          value={responsable}
          onChange={(e) => setResponsable(e.target.value)}
          aria-label="Filtrar por responsable asignado"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 px-3 text-sm text-[#1A1A1A] focus:border-[#1A1A1A]/30 focus:outline-none"
        >
          <option value="todos">Todos los responsables</option>
          {responsablesDisponibles.map((r) => (
            <option key={r.id} value={r.id}>{r.full_name}</option>
          ))}
        </select>
      )}

      {/* Atrasados + orden. El toggle solo aparece si hay algo atrasado que
          mostrar (etapas sin SLA nunca cuentan como atraso). */}
      {(atrasadosCount > 0 || soloAtrasados) && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSoloAtrasados((v) => !v)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              soloAtrasados
                ? 'border-[#EF4444] bg-[#EF4444]/10 text-[#EF4444]'
                : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#EF4444]/40 hover:text-[#EF4444]'
            }`}
            aria-pressed={soloAtrasados}
          >
            <Clock className="h-3 w-3" />
            Atrasados
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                soloAtrasados ? 'bg-black/10' : 'bg-[#F5F4F2]'
              }`}
            >
              {atrasadosCount}
            </span>
          </button>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            aria-label="Ordenar negocios"
            className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-[#1A1A1A] focus:border-[#1A1A1A]/30 focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Sub-filtros Cerrados (motivo) */}
      {fase === 'cerrados' && cerrados.length > 0 && (
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1 text-xs">
          {(['todos', 'exitoso', 'perdido', 'cancelado'] as MotivoCierre[]).map((m) => {
            const isActive = motivoCierre === m
            const cuenta =
              m === 'todos'
                ? cerrados.length
                : cerrados.filter((n) => n.cierre_motivo === m).length
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMotivoCierre(m)}
                className={`shrink-0 rounded-full border px-2.5 py-1 transition-colors ${
                  isActive
                    ? 'border-[#1A1A1A]/30 bg-[#F5F4F2] text-[#1A1A1A]'
                    : 'border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]'
                }`}
              >
                {motivoLabel(m)} {cuenta > 0 && `(${cuenta})`}
              </button>
            )
          })}
        </div>
      )}

      {/* Lista o empty */}
      {showEmpty ? (
        sinResultadosBusqueda ? (
          <EmptyState
            title={`Sin resultados para "${q.trim()}"`}
            description="Prueba con otro código, cliente, celular, cédula, seccional o vehículo."
            primaryCta={{ label: 'Limpiar búsqueda', onClick: () => setQ('') }}
          />
        ) : fase === 'cerrados' && !isFilteringMotivo ? (
          <EmptyState
            illustration="/empty-states/empty-cerrados.svg"
            illustrationAlt="Sin negocios cerrados todavia"
            title="Sin negocios cerrados todavia"
            description="Aqui veras el historial de negocios exitosos, perdidos y cancelados cuando los tengas."
          />
        ) : fase === 'cerrados' && isFilteringMotivo ? (
          <EmptyState
            title={`Sin cerrados como ${motivoLabel(motivoCierre).toLowerCase()}`}
            description="Prueba otro filtro o quita el filtro de motivo."
            primaryCta={{
              label: 'Quitar filtro',
              onClick: () => setMotivoCierre('todos'),
            }}
          />
        ) : (
          <div className="py-16 text-center">
            <p className="text-sm text-[#6B7280]">
              {fase === 'todos'
                ? 'Sin negocios abiertos'
                : etapaNum !== null
                  ? `Sin negocios en ${etapasDeFase.find((e) => e.numero === etapaNum)?.nombre ?? 'esta etapa'}`
                  : `Sin negocios en ${ALL_FASES.find((f) => f.key === fase)?.label}`}
            </p>
            {fase === 'todos' && (
              <p className="mt-1 text-xs text-[#6B7280]/70">Crea uno con el boton +</p>
            )}
          </div>
        )
      ) : (
        <div className="space-y-3">
          {currentFiltrado.map((n) => (
            <NegocioCard
              key={n.id}
              negocio={n}
              staffList={staffList}
              canAsignar={canAsignar}
              canMarcar={canMarcar}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function motivoLabel(m: MotivoCierre): string {
  switch (m) {
    case 'todos':
      return 'Todos'
    case 'exitoso':
      return 'Exitosos'
    case 'perdido':
      return 'Perdidos'
    case 'cancelado':
      return 'Cancelados'
  }
}
