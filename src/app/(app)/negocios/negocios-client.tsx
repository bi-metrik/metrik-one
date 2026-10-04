'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import NegocioCard, { type StaffAsignable } from './negocio-card'
import DescargarExcelButton from './descargar-excel-button'
import SubirADriveButton from './subir-a-drive-button'
import BusquedaInput from '@/components/busqueda-input'
import BarraFiltros from '@/components/barra-filtros'
import EmptyState from '@/components/empty-state'
import { GRUPO_CITA_VENCIDA } from '@/lib/negocios/agrupar-por-cita'
import { aplicarFiltroEnQuery } from '@/lib/filtros/url-estado'
import type { CampoFiltro } from '@/lib/filtros/campos'
import { STAGE_LABEL } from '@/lib/negocios/stage-label'
import { pedirJson, pegarPagina, refrescarComienzo } from '@/lib/negocios/paginas-lista'
import { esErrorDeRed, mensajeDeFallaDeRed } from '@/lib/red/error-de-red'
import {
  expandirTarjeta,
  leerParametrosLista,
  parametrosPorDefecto,
  SIN_SERVICIO,
  type FaseFilter,
  type MotivoCierre,
  type ParametrosLista,
  type SortKey,
  type TarjetaCompacta,
  type VistaLista,
} from '@/lib/negocios/vista-lista'

/**
 * La lista de `/negocios`.
 *
 * Desde el 2026-10-03 NO tiene la lista entera en memoria: el servidor filtra, cuenta y
 * manda una página de tarjetas (`lib/negocios/vista-lista.ts` explica por qué). Cambiar un
 * filtro pide la vista nueva a `GET /api/negocios/lista`; «Ver más» pide la página
 * siguiente. Los filtros siguen viviendo en la URL (se escriben con `replaceState`, sin
 * navegar), así que volver atrás los conserva y la vista filtrada se comparte por enlace.
 *
 * Mientras llega la vista nueva se queda la anterior, atenuada: nunca una lista vacía que
 * parezca respuesta. Si la petición falla, la anterior sigue y se ofrece reintentar.
 */

interface FaseSpec {
  key: FaseFilter
  label: string
  /** Tokens MeTRIK por stage. */
  active: { bg: string; text: string; border: string }
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'reciente', label: 'Llegada reciente' },
  { value: 'atraso', label: 'Mas atrasado' },
  { value: 'cita', label: 'Cita mas proxima' },
]

/** Espera tras la última tecla del buscador antes de pedir la vista. */
const ESPERA_BUSQUEDA_MS = 350

// Tokens MeTRIK (no Tailwind generico)
const ALL_FASES: FaseSpec[] = [
  { key: 'todos', label: 'Todos', active: { bg: 'bg-papel', text: 'text-tinta', border: 'border-tinta/20' } },
  { key: 'venta', label: STAGE_LABEL.venta, active: { bg: 'bg-acento/10', text: 'text-acento', border: 'border-acento' } },
  { key: 'ejecucion', label: STAGE_LABEL.ejecucion, active: { bg: 'bg-[#FFF7ED]', text: 'text-[#C2410C]', border: 'border-[#FED7AA]' } },
  { key: 'cobro', label: STAGE_LABEL.cobro, active: { bg: 'bg-[#EFF6FF]', text: 'text-[#2563EB]', border: 'border-[#BFDBFE]' } },
  { key: 'cerrados', label: 'Cerrados', active: { bg: 'bg-papel', text: 'text-tinta-suave', border: 'border-[#E5E7EB]' } },
]

/** La query de la URL con los parámetros puestos (los que están en su defecto no se escriben). */
function queryConParametros(queryActual: string, p: ParametrosLista, defaultStage: FaseFilter): string {
  const d = parametrosPorDefecto(defaultStage)
  let q = queryActual
  for (const k of Object.keys(d) as Array<keyof ParametrosLista>) {
    q = aplicarFiltroEnQuery(q, k, p[k], d[k])
  }
  return q
}

/**
 * Qué se le pide a la ruta:
 *   - `filtros`: la vista nueva para otros filtros (reemplaza la lista);
 *   - `mas`: la página siguiente («Ver más», se pega detrás);
 *   - `refresco`: relee todo lo cargado tras adoptar una vista refrescada (reemplaza el
 *     comienzo sin encoger la lista).
 */
type ModoPedido = 'filtros' | 'mas' | 'refresco'

interface Pedido {
  p: ParametrosLista
  modo: ModoPedido
  desde: number
  cuantos?: number
}

export default function NegociosClient({
  vista,
  stagesActivos,
  staffList = [],
  canAsignar = false,
  canMarcar = false,
  canDescargar = false,
  canPublicarEnDrive = true,
}: {
  /** Primera página + resumen, resueltos en el servidor para los filtros de la URL. */
  vista: VistaLista
  stagesActivos: string[]
  /** Staff activo del workspace, para el selector de responsable de la tarjeta. */
  staffList?: StaffAsignable[]
  /** Rol gerencial (owner/admin/supervisor): habilita asignar/quitar desde la lista. */
  canAsignar?: boolean
  /** Rol gerencial: habilita poner/quitar marcas de condición desde la lista. */
  canMarcar?: boolean
  /** owner/admin/supervisor: pinta «Descargar Excel» (el gate real está en la ruta). */
  canDescargar?: boolean
  /** false en un workspace con almacenamiento externo: la hoja no se publica en Drive. */
  canPublicarEnDrive?: boolean
}) {
  const defaultStage = vista.defaultStage

  // `actual`: la última vista que llegó (resumen + parámetros con que se pidió).
  // `params`: lo que la persona tiene puesto ahora; adelanta a `actual` mientras carga.
  const [actual, setActual] = useState<VistaLista>(vista)
  const [tarjetas, setTarjetas] = useState<TarjetaCompacta[]>(vista.tarjetas)
  const [params, setParams] = useState<ParametrosLista>(vista.parametros)
  const [qInput, setQInput] = useState(vista.parametros.q)
  const [cargando, setCargando] = useState<ModoPedido | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Una server action (asignar, marcar…) hace `revalidatePath('/negocios')` y el servidor
  // manda una vista nueva por props: se adopta. Patrón de React para estado derivado de
  // props (en render, no en un efecto).
  const [vistaPrevia, setVistaPrevia] = useState(vista)
  const [cargadasTrasRefresco, setCargadasTrasRefresco] = useState(0)
  if (vista !== vistaPrevia) {
    setVistaPrevia(vista)
    setActual(vista)
    setParams(vista.parametros)
    setQInput(vista.parametros.q)
    // El error era de la vista anterior: la nueva llegó bien.
    setError(null)
    if (tarjetas.length > vista.tarjetas.length) {
      // Ya se habían cargado más páginas. La lista NO se encoge a la primera página (el
      // scroll saltaba y la lista volvía a crecer): el comienzo se refresca ya y el resto
      // se queda hasta que vuelva la relectura de todo lo cargado.
      setTarjetas(refrescarComienzo(tarjetas, vista.tarjetas))
      setCargadasTrasRefresco(tarjetas.length)
    } else {
      setTarjetas(vista.tarjetas)
      setCargadasTrasRefresco(0)
    }
  }

  const paramsRef = useRef(params)
  const abortRef = useRef<AbortController | null>(null)
  const turnoRef = useRef(0)
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Lo último que falló: «Reintentar» repite ESO (una página de «Ver más» no vuelve a la 1).
  const fallidoRef = useRef<Pedido | null>(null)

  const pedir = useCallback(
    async (p: ParametrosLista, modo: ModoPedido, desde = 0, cuantos?: number) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      const turno = ++turnoRef.current
      setCargando(modo)
      setError(null)
      try {
        const base = queryConParametros('', p, defaultStage)
        const extra = `desde=${desde}${cuantos ? `&cuantos=${cuantos}` : ''}`
        const v = await pedirJson<VistaLista>(`/api/negocios/lista?${base ? `${base}&` : ''}${extra}`, ac.signal)
        if (turno !== turnoRef.current) return
        setActual(v)
        fallidoRef.current = null
        setTarjetas((prev) =>
          modo === 'mas'
            ? pegarPagina(prev, v.desde, v.tarjetas)
            : modo === 'refresco' && v.tarjetas.length < v.resumen.totalVista
              ? // La relectura llega hasta 200 tarjetas: si había más cargadas, la cola se conserva.
                refrescarComienzo(prev, v.tarjetas)
              : v.tarjetas,
        )
      } catch (e) {
        if (ac.signal.aborted || turno !== turnoRef.current) return
        fallidoRef.current = { p, modo, desde, cuantos }
        setError(esErrorDeRed(e) ? mensajeDeFallaDeRed() : 'No se pudo cargar la lista. Intenta de nuevo.')
      } finally {
        if (turno === turnoRef.current) setCargando(null)
      }
    },
    [defaultStage],
  )

  /** Pone filtros: estado, URL (sin navegar) y la vista nueva (con espera si es tecleo). */
  const cambiar = useCallback(
    (patch: Partial<ParametrosLista>, esperaMs = 0) => {
      const next = { ...paramsRef.current, ...patch }
      paramsRef.current = next
      setParams(next)
      if (typeof window !== 'undefined') {
        const query = queryConParametros(window.location.search, next, defaultStage)
        const url = query ? `${window.location.pathname}?${query}` : window.location.pathname
        window.history.replaceState(window.history.state, '', url)
      }
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current)
      if (esperaMs > 0) temporizadorRef.current = setTimeout(() => void pedir(next, 'filtros'), esperaMs)
      else void pedir(next, 'filtros')
    },
    [defaultStage, pedir],
  )

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  // Tras adoptar una vista refrescada, se relee todo lo que estaba cargado (desde 0) y
  // recién entonces se reemplaza.
  useEffect(() => {
    if (cargadasTrasRefresco <= 0) return
    void pedir(vista.parametros, 'refresco', 0, cargadasTrasRefresco)
  }, [vista, cargadasTrasRefresco, pedir])

  const reintentar = useCallback(() => {
    const f = fallidoRef.current
    if (!f) return void pedir(paramsRef.current, 'filtros')
    void pedir(f.p, f.modo, f.desde, f.cuantos)
  }, [pedir])

  // Al volver atrás, el router puede restaurar una vista guardada con otros filtros que
  // los de la URL. Manda la URL.
  useEffect(() => {
    const sp = Object.fromEntries(new URLSearchParams(window.location.search).entries())
    const desdeUrl = leerParametrosLista(sp, defaultStage)
    if (JSON.stringify(desdeUrl) !== JSON.stringify(vista.parametros)) {
      const t = setTimeout(() => {
        setQInput(desdeUrl.q)
        cambiar(desdeUrl)
      }, 0)
      return () => clearTimeout(t)
    }
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current)
    },
    [],
  )

  const r = actual.resumen
  // Los contadores de etapa son de la fase de `actual`; mientras llega la vista de otra
  // fase no se pintan números que ya no corresponden.
  const etapasAlDia = actual.parametros.fase === params.fase

  const etapasDeFase = useMemo(
    () =>
      params.fase === 'venta' || params.fase === 'ejecucion' || params.fase === 'cobro'
        ? actual.etapas.filter((e) => e.stage === params.fase)
        : [],
    [actual.etapas, params.fase],
  )

  const seleccionarFase = (key: FaseFilter) => cambiar({ fase: key, etapa: null })
  const verEnTodos = () => cambiar({ fase: 'todos', etapa: null, cierre: 'todos' })

  const opcionesOrden = r.hayCitas ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => o.value !== 'cita')

  // Los cuatro filtros secundarios en la forma de `BarraFiltros`. Lista vacía = no se dibuja.
  const camposFiltro = useMemo<CampoFiltro[]>(() => {
    const { seccionales, origenes, servicios, responsables } = r.opciones
    // Con un solo servicio real (o ninguno) el desplegable no separa nada.
    const hayServicioReal = servicios.some((s) => s.value !== SIN_SERVICIO)
    return [
      {
        clave: 'seccional', etiqueta: 'Seccional', valor: params.seccional, porDefecto: 'todas',
        etiquetaTodos: 'Todas las seccionales DIAN', opciones: seccionales,
        onChange: (v: string) => cambiar({ seccional: v }),
      },
      {
        clave: 'origen', etiqueta: 'Origen', valor: params.origen, porDefecto: 'todos',
        etiquetaTodos: 'Todos los orígenes', opciones: origenes.length > 1 ? origenes : [],
        onChange: (v: string) => cambiar({ origen: v }),
      },
      {
        clave: 'servicio', etiqueta: 'Servicio', valor: params.servicio, porDefecto: 'todos',
        etiquetaTodos: 'Todos los servicios',
        opciones: hayServicioReal && servicios.length > 1 ? servicios : [],
        onChange: (v: string) => cambiar({ servicio: v }),
      },
      {
        clave: 'responsable', etiqueta: 'Responsable', valor: params.responsable, porDefecto: 'todos',
        etiquetaTodos: 'Todos los responsables', opciones: responsables,
        onChange: (v: string) => cambiar({ responsable: v }),
      },
    ]
  }, [r.opciones, params.seccional, params.origen, params.servicio, params.responsable, cambiar])

  // Fases visibles (según stages activos del workspace + si hay cerrados).
  const fases = ALL_FASES.filter((f) =>
    f.key === 'todos' ? true : f.key === 'cerrados' ? r.totalCerrados > 0 : stagesActivos.includes(f.key),
  )

  const negocios = useMemo(
    () => tarjetas.map((t) => expandirTarjeta(t, actual.almacenamientoExterno)),
    [tarjetas, actual.almacenamientoExterno],
  )

  // Lo que se descarga es EXACTAMENTE lo que está a la vista, en su orden: el servidor
  // resuelve los ids con la misma función que arma la lista (`solo=ids`).
  const obtenerIds = useCallback(async () => {
    const base = queryConParametros('', paramsRef.current, defaultStage)
    const ac = new AbortController()
    const { ids } = await pedirJson<{ ids: string[] }>(
      `/api/negocios/lista?${base ? `${base}&` : ''}solo=ids`,
      ac.signal,
    )
    return ids
  }, [defaultStage])

  const aplicado = actual.parametros
  const showEmpty = r.totalVista === 0
  const isFilteringMotivo = aplicado.fase === 'cerrados' && aplicado.cierre !== 'todos'
  // "La búsqueda no encontró nada" solo si la fase/etapa SÍ tiene negocios sin filtrar.
  const sinResultadosBusqueda = aplicado.q.trim().length > 0 && r.totalVista === 0 && r.hayEnFaseEtapa
  const agrupada = r.grupos !== null
  const faltan = r.totalVista - tarjetas.length

  return (
    <div className="space-y-4">
      {/* Nivel 1: fases */}
      <div className="flex flex-wrap gap-2" data-nivel="fases">
        {fases.map((f) => {
          const count = r.conteoFases[f.key]
          const active = params.fase === f.key
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => seleccionarFase(f.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? `${f.active.bg} ${f.active.text} ${f.active.border}`
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

      {/* Nivel 2: etapas de la fase seleccionada (solo stages) */}
      {etapasDeFase.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs" data-nivel="etapas">
          <button
            type="button"
            onClick={() => cambiar({ etapa: null })}
            className={`shrink-0 rounded-full border px-2.5 py-1 transition-colors ${
              params.etapa === null
                ? 'border-tinta/30 bg-papel text-tinta'
                : 'border-[#E5E7EB] text-tinta-suave hover:text-tinta'
            }`}
          >
            Todas
          </button>
          {etapasDeFase.map((e) => {
            const count = etapasAlDia ? (r.conteoEtapas[e.numero] ?? 0) : null
            const active = params.etapa === e.numero
            const vacia = count === 0
            return (
              <button
                key={e.numero}
                type="button"
                data-etapa={e.numero}
                onClick={() => cambiar({ etapa: e.numero })}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ${
                  active
                    ? 'border-tinta/30 bg-papel text-tinta'
                    : vacia
                      ? 'border-[#E5E7EB] text-tinta-suave/50 hover:text-tinta-suave'
                      : 'border-[#E5E7EB] text-tinta-suave hover:text-tinta'
                }`}
              >
                {e.nombre}
                {count !== null && (
                  <span
                    className={`rounded-full px-1 py-0.5 text-[10px] font-bold ${
                      active ? 'bg-black/10' : vacia ? 'bg-papel text-tinta-suave/50' : 'bg-papel'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Barra de búsqueda */}
      <BusquedaInput
        value={qInput}
        onChange={(v) => {
          setQInput(v)
          cambiar({ q: v }, ESPERA_BUSQUEDA_MS)
        }}
        placeholder="Buscar por código, cliente, celular, cédula, seccional o vehículo…"
        ariaLabel="Buscar negocios"
      />

      {/* Filtros secundarios (colapsados) + atrasados + orden en una sola fila. */}
      <BarraFiltros campos={camposFiltro}>
        {(r.atrasados > 0 || params.atrasados) && (
          <button
            type="button"
            onClick={() => cambiar({ atrasados: !params.atrasados })}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              params.atrasados
                ? 'border-alerta bg-alerta/10 text-alerta'
                : 'border-[#E5E7EB] text-tinta-suave hover:border-alerta/40 hover:text-alerta'
            }`}
            aria-pressed={params.atrasados}
          >
            <Clock className="h-3 w-3" />
            Atrasados
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${params.atrasados ? 'bg-black/10' : 'bg-papel'}`}>
              {r.atrasados}
            </span>
          </button>
        )}
        <select
          value={params.orden}
          onChange={(e) => cambiar({ orden: e.target.value as SortKey })}
          aria-label="Ordenar negocios"
          className="ml-auto rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-tinta focus:border-tinta/30 focus:outline-none"
        >
          {opcionesOrden.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </BarraFiltros>

      {/* Descarga de autoservicio (Acta SOENA, SEXTA num. 2): la tabla tal como se ve,
          con los filtros puestos. Solo para los roles que la ruta deja pasar. */}
      {canDescargar && (
        <div className="flex items-start justify-between gap-2 text-xs text-tinta-suave">
          <span className="pt-1.5">
            {r.totalVista} negocio{r.totalVista !== 1 ? 's' : ''} en la vista
          </span>
          <div className="flex flex-wrap items-start justify-end gap-2">
            <DescargarExcelButton total={r.totalVista} obtenerIds={obtenerIds} />
            {canPublicarEnDrive && <SubirADriveButton total={r.totalVista} obtenerIds={obtenerIds} />}
          </div>
        </div>
      )}

      {/* Sub-filtros Cerrados (motivo). Conteo sobre los cerrados sin filtrar. */}
      {params.fase === 'cerrados' && r.totalCerrados > 0 && (
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1 text-xs">
          {(['todos', 'exitoso', 'perdido', 'cancelado'] as MotivoCierre[]).map((m) => {
            const cuenta = r.conteoMotivos[m]
            return (
              <button
                key={m}
                type="button"
                onClick={() => cambiar({ cierre: m })}
                className={`shrink-0 rounded-full border px-2.5 py-1 transition-colors ${
                  params.cierre === m
                    ? 'border-tinta/30 bg-papel text-tinta'
                    : 'border-[#E5E7EB] text-tinta-suave hover:text-tinta'
                }`}
              >
                {motivoLabel(m)} {cuenta > 0 && `(${cuenta})`}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-alerta/30 bg-alerta/5 px-3 py-2 text-xs text-alerta">
          <span>{error}</span>
          <button
            type="button"
            onClick={reintentar}
            className="shrink-0 rounded font-medium underline underline-offset-2"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Lista o empty. Mientras llega otra vista, la anterior se queda atenuada. */}
      <div
        aria-busy={cargando === 'filtros'}
        className={cargando === 'filtros' ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}
      >
        {showEmpty ? (
          sinResultadosBusqueda ? (
            <EmptyState
              title={`Sin resultados para "${aplicado.q.trim()}"`}
              description="Prueba con otro código, cliente, celular, cédula, seccional o vehículo."
              primaryCta={{
                label: 'Limpiar búsqueda',
                onClick: () => {
                  setQInput('')
                  cambiar({ q: '' })
                },
              }}
            />
          ) : aplicado.fase === 'cerrados' && !isFilteringMotivo ? (
            <EmptyState
              illustration="/empty-states/empty-cerrados.svg"
              illustrationAlt="Sin negocios cerrados todavia"
              title="Sin negocios cerrados todavia"
              description="Aqui veras el historial de negocios exitosos, desistidos y cancelados cuando los tengas."
            />
          ) : aplicado.fase === 'cerrados' && isFilteringMotivo ? (
            <EmptyState
              title={`Sin cerrados como ${motivoLabel(aplicado.cierre).toLowerCase()}`}
              description="Prueba otro filtro o quita el filtro de motivo."
              primaryCta={{ label: 'Quitar filtro', onClick: () => cambiar({ cierre: 'todos' }) }}
            />
          ) : (
            <div className="py-16 text-center">
              <p className="text-sm text-tinta-suave">
                {aplicado.fase === 'todos'
                  ? 'Sin negocios'
                  : aplicado.etapa !== null
                    ? `Sin negocios en ${actual.etapas.find((e) => e.numero === aplicado.etapa)?.nombre ?? 'esta etapa'}`
                    : `Sin negocios en ${ALL_FASES.find((f) => f.key === aplicado.fase)?.label}`}
              </p>
              {aplicado.fase === 'todos' && <p className="mt-1 text-xs text-tinta-suave/70">Crea uno con el boton +</p>}
            </div>
          )
        ) : agrupada ? (
          <div className="space-y-5">
            {r.grupos!
              .filter((g) => g.desde < negocios.length)
              .map((g) => {
                const items = negocios.slice(g.desde, Math.min(g.desde + g.total, negocios.length))
                return (
                  <section key={g.dia || 'sin-fecha'} className="space-y-2">
                    {/* El encabezado lleva el conteo del grupo ENTERO, no solo lo cargado. */}
                    <div className="flex items-baseline gap-2 px-0.5">
                      <h3
                        className={`text-xs font-bold uppercase tracking-wider ${
                          // Las citas vencidas van primero Y en rojo: en gris se leerían como "lo más próximo".
                          g.dia === GRUPO_CITA_VENCIDA ? 'text-alerta' : 'text-tinta'
                        }`}
                      >
                        {g.etiqueta}
                      </h3>
                      <span className="text-[11px] text-tinta-suave">
                        {g.total} caso{g.total !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {items.map((n) => (
                        <NegocioCard
                          key={n.id}
                          negocio={n}
                          staffList={staffList}
                          canAsignar={canAsignar}
                          canMarcar={canMarcar}
                          // Agrupada por cita, el encabezado ya no dice cuándo llegó el caso.
                          mostrarLlegada={aplicado.orden === 'cita'}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
          </div>
        ) : (
          <div className="space-y-3">
            {negocios.map((n) => (
              <NegocioCard
                key={n.id}
                negocio={n}
                staffList={staffList}
                canAsignar={canAsignar}
                canMarcar={canMarcar}
                mostrarLlegada
              />
            ))}
          </div>
        )}
      </div>

      {/* Página siguiente. Un botón y no scroll infinito: con la red mala, cargar sin que
          nadie lo pida gasta datos y deja al usuario sin saber qué está esperando. */}
      {!showEmpty && faltan > 0 && (
        <button
          type="button"
          onClick={() => void pedir(aplicado, 'mas', tarjetas.length)}
          disabled={cargando !== null}
          aria-busy={cargando === 'mas'}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] py-2.5 text-xs font-medium text-tinta transition-colors hover:border-tinta/30 disabled:opacity-60"
          data-ver-mas
        >
          {cargando === 'mas' && <Loader2 className="h-3 w-3 animate-spin" />}
          Ver más · {tarjetas.length} de {r.totalVista}
        </button>
      )}

      {/* El buscador no puede decir que algo no existe: aviso de coincidencias en otras
          pestañas, en el vacío o como nota al pie. */}
      {r.coincidenciasFuera > 0 && (
        <AvisoOtrasPestanas
          cantidad={r.coincidenciasFuera}
          onVerEnTodos={verEnTodos}
          variante={showEmpty ? 'vacio' : 'pie'}
        />
      )}
    </div>
  )
}

/**
 * «3 coincidencias en otras pestañas · Ver en Todos».
 *
 * Deliberadamente NO es un banner: el chip de fase sigue mandando y la lista sigue
 * siendo la de la pestaña. Esto solo dice que hay más y ofrece la salida.
 */
function AvisoOtrasPestanas({
  cantidad,
  onVerEnTodos,
  variante,
}: {
  cantidad: number
  onVerEnTodos: () => void
  /** 'vacio': debajo del empty state, centrado. 'pie': nota discreta bajo la lista. */
  variante: 'vacio' | 'pie'
}) {
  const enVacio = variante === 'vacio'
  return (
    <p
      className={
        enVacio
          ? 'flex flex-wrap items-center justify-center gap-1.5 text-sm text-tinta'
          : 'flex flex-wrap items-center gap-1.5 px-0.5 text-xs text-tinta-suave'
      }
    >
      <span>
        {cantidad} coincidencia{cantidad === 1 ? '' : 's'} en otras pestañas
      </span>
      <span aria-hidden="true" className="text-tinta-suave/50">
        ·
      </span>
      <button
        type="button"
        onClick={onVerEnTodos}
        className="rounded font-medium text-acento underline underline-offset-2 hover:text-acento-hover focus:outline-none focus:ring-2 focus:ring-acento/40"
      >
        Ver en Todos
      </button>
    </p>
  )
}

function motivoLabel(m: MotivoCierre): string {
  switch (m) {
    case 'todos':
      return 'Todos'
    case 'exitoso':
      return 'Exitosos'
    case 'perdido':
      return 'Desistidos'
    case 'cancelado':
      return 'Cancelados'
  }
}
