'use client'
import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import NegocioCard, { type StaffAsignable } from './negocio-card'
import DescargarExcelButton from './descargar-excel-button'
import BusquedaInput from '@/components/busqueda-input'
import BarraFiltros from '@/components/barra-filtros'
import EmptyState from '@/components/empty-state'
import { telefonoCoincide } from '@/lib/busqueda/telefono'
import { ORIGENES_NEGOCIO, origenNegocioLabel } from '@/lib/catalogos/constants'
import { marcaCondicionLabel } from '@/lib/negocios/constants'
import { segmentarNegocios } from '@/lib/negocios/segmentador'
import { contarCoincidenciasFuera } from '@/lib/negocios/coincidencias-fuera'
import { agruparPorLlegada } from '@/lib/negocios/agrupar-por-dia'
import { agruparPorCita, GRUPO_CITA_VENCIDA } from '@/lib/negocios/agrupar-por-cita'
import { agruparApartandoCerrados } from '@/lib/negocios/agrupar-con-cerrados'
import { motivoCierreDeEstado } from '@/lib/negocios/motivo-cierre'
import { useEstadoUrl } from '@/hooks/use-estado-url'
import { filtroDesdeSearchParams, type SearchParams, type ValorFiltro } from '@/lib/filtros/url-estado'
import type { CampoFiltro } from '@/lib/filtros/campos'
import type { NegocioResumen } from './negocio-v2-actions'
import { STAGE_LABEL } from '@/lib/negocios/stage-label'

type FaseFilter = 'todos' | 'venta' | 'ejecucion' | 'cobro' | 'cerrados'
/**
 * Valor del filtro de motivo de la pestaña Cerrados: los tres desenlaces de
 * `motivo-cierre.ts` más `'todos'`, que no descarta nada.
 */
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
  /** Valor crudo del servicio contratado, 'todos', o 'sin_servicio' (aún no se preguntó). */
  servicio: string
  term: string
  /** Solo negocios que pasaron el SLA de su etapa (etapas sin SLA nunca entran). */
  soloAtrasados: boolean
}

/** Valor del filtro para los negocios que no tienen origen registrado. */
const SIN_ORIGEN = 'sin_origen'

/**
 * Valor del filtro para los negocios sin servicio contratado registrado. No son un
 * error: el bloque que lo pregunta vive en una etapa concreta del workflow, así que
 * todo lo que va antes lo tiene vacío por diseño. Los que YA la pasaron y siguen
 * vacíos son justo los que hay que poder aislar.
 */
const SIN_SERVICIO = 'sin_servicio'

/**
 * Orden de la lista. Default: por llegada a la etapa, agrupado por dia.
 *
 * Antes 'reciente' era `created_at desc` — cuando nacio el negocio. Dentro de una
 * etapa esa es la pregunta equivocada: lo que se necesita ver es que cayo aqui hoy
 * y que lleva parado, no quien es el cliente mas nuevo.
 */
type SortKey = 'reciente' | 'atraso' | 'cita'
const SORT_VALIDOS: readonly SortKey[] = ['reciente', 'atraso', 'cita']
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'reciente', label: 'Llegada reciente' },
  { value: 'atraso', label: 'Mas atrasado' },
  { value: 'cita', label: 'Cita mas proxima' },
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
  if (f.servicio !== 'todos') {
    res = res.filter((n) =>
      f.servicio === SIN_SERVICIO ? !n.servicio : n.servicio === f.servicio,
    )
  }
  if (f.term) {
    res = res.filter((n) => {
      const hay = [n.codigo, n.nombre, n.empresa_nombre, n.contacto_nombre, n.vehiculo_label,
        n.cedula, n.radicado, n.numero_factura, n.seccional_label, n.servicio_label,
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
    active: { bg: 'bg-papel', text: 'text-tinta', border: 'border-tinta/20' },
  },
  {
    key: 'venta',
    label: STAGE_LABEL.venta,
    active: { bg: 'bg-acento/10', text: 'text-acento', border: 'border-acento' },
  },
  {
    key: 'ejecucion',
    label: STAGE_LABEL.ejecucion,
    active: { bg: 'bg-[#FFF7ED]', text: 'text-[#C2410C]', border: 'border-[#FED7AA]' },
  },
  {
    key: 'cobro',
    label: STAGE_LABEL.cobro,
    active: { bg: 'bg-[#EFF6FF]', text: 'text-[#2563EB]', border: 'border-[#BFDBFE]' },
  },
  {
    key: 'cerrados',
    label: 'Cerrados',
    active: { bg: 'bg-papel', text: 'text-tinta-suave', border: 'border-[#E5E7EB]' },
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
  canDescargar = false,
  searchParams,
  hoyISO,
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
  /** owner/admin/supervisor: pinta «Descargar Excel» (el gate real está en la ruta). */
  canDescargar?: boolean
  /** Parámetros de la URL ya resueltos por el server component: filtros iniciales. */
  searchParams?: SearchParams
  /**
   * Hoy en Bogotá ('YYYY-MM-DD'), resuelto en el servidor. No se calcula aquí:
   * leer el reloj en render rompe la pureza que exige react-hooks, y el servidor
   * (UTC) y el navegador darían días distintos después de las 19:00 locales.
   */
  hoyISO: string
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
  const [servicio, setServicio] = useEstadoUrl<string>('servicio', 'todos', inicialDe('servicio', 'todos'))
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

  // Cerrados filtrados por motivo.
  //
  // El motivo se DERIVA de `estado` (`motivo-cierre.ts`). Con el criterio anterior
  // —`n.cierre_motivo === motivoCierre`— los tres chips daban cero siempre, porque esa
  // columna está en NULL en todo cierre real de este producto y no se puede poblar.
  const cerradosFiltrados = useMemo(() => {
    if (motivoCierre === 'todos') return cerrados
    return cerrados.filter((n) => motivoCierreDeEstado(n.estado) === motivoCierre)
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
    () => ({ seccional, responsable, origen, servicio, term, soloAtrasados }),
    [seccional, responsable, origen, servicio, term, soloAtrasados],
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

  // Orden. 'reciente' y 'cita' se resuelven al agrupar por día (más abajo), así
  // que aquí solo hay que respetar el orden del servidor.
  // 'atraso' pone primero al más atrasado; los que no tienen SLA (o van a
  // tiempo) quedan al final, sin reordenarse entre sí.
  const currentFiltrado = useMemo(() => {
    if (sortBy !== 'atraso') return currentFiltradoSinOrden
    // Clave finita (no -Infinity): restar dos infinitos da NaN y un comparador
    // que devuelve NaN deja el orden indefinido.
    const exceso = (n: NegocioResumen) => n.sla_exceso_horas ?? -1e9
    return [...currentFiltradoSinOrden].sort((a, b) => exceso(b) - exceso(a))
  }, [currentFiltradoSinOrden, sortBy])

  // La lista se parte por día SOLO cuando el orden vigente es una fecha: 'reciente'
  // agrupa por el día de llegada a la etapa y 'cita' por el día de la cita en la
  // DIAN. Con 'atraso' mandan los días de retraso, y agrupar por fecha pelearía con
  // ese orden; en 'cerrados' ni la etapa actual ni la cita significan nada.
  const agrupada = (sortBy === 'reciente' || sortBy === 'cita') && fase !== 'cerrados'

  /**
   * Quién es cerrado se decide por su ORIGEN (viene en la prop `cerrados`), no releyendo
   * `estado`: la prop la llenó `getNegociosV2('cerrado')`, así que la pertenencia al
   * arreglo no puede desincronizarse de la consulta, y enumerar los estados terminales
   * otra vez aquí sí podría.
   */
  const idsCerrados = useMemo(() => new Set(cerrados.map((n) => n.id)), [cerrados])

  // En "Todos" los cerrados NO entran a los grupos de día (la razón, en
  // `agrupar-con-cerrados.ts`): van en un grupo propio al final, que además los deja
  // dentro de `idsVisibles` para que el Excel los baje.
  const grupos = useMemo(() => {
    if (!agrupada) return []
    return agruparApartandoCerrados(
      currentFiltrado,
      (n) => idsCerrados.has(n.id),
      (abiertosDeLaLista) =>
        sortBy === 'cita'
          ? agruparPorCita(abiertosDeLaLista, hoyISO)
          : agruparPorLlegada(abiertosDeLaLista, hoyISO),
    )
  }, [agrupada, sortBy, currentFiltrado, idsCerrados, hoyISO])

  // El orden por cita solo se ofrece donde significa algo. En un workspace sin
  // bloque de cita configurado toda la lista caería en «Sin cita registrada»: una
  // opción que no puede responder nada es ruido en el desplegable.
  const hayCitas = useMemo(
    () => negocios.some((n) => n.fecha_cita || n.cita_pendiente),
    [negocios],
  )
  const opcionesOrden = useMemo(
    () => (hayCitas ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => o.value !== 'cita')),
    [hayCitas],
  )

  // Lo que se descarga es EXACTAMENTE lo que está a la vista: los ids de la lista ya
  // filtrada y ordenada. La ruta baja esos y nada más, así que no hay que reimplementar
  // `aplicarFiltros` en el servidor ni puede desincronizarse de la pantalla. Cuando la
  // lista está agrupada el orden lo fijan los grupos, no la lista plana: el Excel de
  // «Cita más próxima» tiene que salir en ese mismo orden.
  const idsVisibles = useMemo(
    () => (agrupada ? grupos.flatMap((g) => g.items) : currentFiltrado).map((n) => n.id),
    [agrupada, grupos, currentFiltrado],
  )

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
  // "Todos" suma los cerrados porque su lista los incluye: el chip tiene que ser el largo
  // de lo que abre (en SOENA, 411 abiertos + 33 cerrados = 444), o el usuario ve un número
  // y cuenta otro.
  const faseCount = (key: FaseFilter) =>
    key === 'todos'
      ? negociosFiltrados.length + cerradosFiltradosConFiltros.length
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

  // Servicios contratados presentes en la lista (abiertos + cerrados), con su conteo.
  // Se filtra por el valor CRUDO (`servicio`) y se muestra la etiqueta corta: si mañana
  // cambia el rótulo en la config, los enlaces guardados siguen apuntando a lo mismo.
  const serviciosDisponibles = useMemo(() => {
    const conteo = new Map<string, { label: string; count: number }>()
    for (const n of [...negocios, ...cerrados]) {
      const key = n.servicio ?? SIN_SERVICIO
      const label =
        key === SIN_SERVICIO ? 'Sin servicio definido' : (n.servicio_label ?? key)
      const prev = conteo.get(key)
      conteo.set(key, { label, count: (prev?.count ?? 0) + 1 })
    }
    return Array.from(conteo, ([value, { label, count }]) => ({ value, label, count })).sort(
      // 'Sin servicio definido' de último: es el residuo, no una categoría más.
      (a, b) =>
        a.value === SIN_SERVICIO ? 1
        : b.value === SIN_SERVICIO ? -1
        : a.label.localeCompare(b.label, 'es'),
    )
  }, [negocios, cerrados])

  // Los cuatro filtros secundarios, ya en la forma que dibuja `BarraFiltros`.
  // Un campo con la lista de opciones vacía no se dibuja: es la misma regla de
  // antes (no ofrecer un desplegable que no separa nada), dicha una sola vez.
  const camposFiltro = useMemo<CampoFiltro[]>(() => {
    // Con un solo servicio real el desplegable no separa nada, y si el workspace
    // no captura servicio la única entrada sería 'Sin servicio definido'.
    const hayServicioReal = serviciosDisponibles.some((s) => s.value !== SIN_SERVICIO)
    return [
      {
        clave: 'seccional',
        etiqueta: 'Seccional',
        valor: seccional,
        porDefecto: 'todas',
        etiquetaTodos: 'Todas las seccionales DIAN',
        opciones: seccionalesDisponibles.map((s) => ({ value: s, label: s })),
        onChange: setSeccional,
      },
      {
        clave: 'origen',
        etiqueta: 'Origen',
        valor: origen,
        porDefecto: 'todos',
        etiquetaTodos: 'Todos los orígenes',
        opciones: origenesDisponibles.length > 1 ? origenesDisponibles : [],
        onChange: setOrigen,
      },
      {
        clave: 'servicio',
        etiqueta: 'Servicio',
        valor: servicio,
        porDefecto: 'todos',
        etiquetaTodos: 'Todos los servicios',
        opciones:
          hayServicioReal && serviciosDisponibles.length > 1 ? serviciosDisponibles : [],
        onChange: setServicio,
      },
      {
        clave: 'responsable',
        etiqueta: 'Responsable',
        valor: responsable,
        porDefecto: 'todos',
        etiquetaTodos: 'Todos los responsables',
        opciones: responsablesDisponibles.map((r) => ({ value: r.id, label: r.full_name })),
        onChange: setResponsable,
      },
    ]
  }, [
    seccional, setSeccional, seccionalesDisponibles,
    origen, setOrigen, origenesDisponibles,
    servicio, setServicio, serviciosDisponibles,
    responsable, setResponsable, responsablesDisponibles,
  ])

  // Fases visibles (según stages activos del workspace + si hay cerrados).
  const fases = ALL_FASES.filter((f) =>
    f.key === 'todos'
      ? true
      : f.key === 'cerrados'
        ? cerrados.length > 0
        : stagesActivos.includes(f.key),
  )

  // Coincidencias del término que existen FUERA de la pestaña activa (otra fase, otra
  // etapa, otro motivo de cierre). Es lo que impedía que el buscador dijera "no existe"
  // sobre algo que sí existe: un cerrado no aparece bajo ningún chip de fase, así que
  // buscar su código exacto con "Cobro" puesto devolvía el vacío de la fase. La regla y
  // sus pruebas viven en `src/lib/negocios/coincidencias-fuera.ts`.
  //
  // Se cuenta con los filtros TRANSVERSALES puestos (los de `filtros`) y sin las tres
  // dimensiones de pestaña. `cerrados` va crudo, no `cerradosFiltrados`: el motivo de
  // cierre es justamente una de esas dimensiones.
  const coincidenciasFuera = useMemo(
    () =>
      term.length === 0
        ? 0
        : contarCoincidenciasFuera([...negocios, ...cerrados], currentFiltrado, (xs) =>
            aplicarFiltros(xs, filtros),
          ),
    [term, negocios, cerrados, currentFiltrado, filtros],
  )

  /**
   * Salida del aviso: lleva a "Todos" conservando el término y soltando las dos
   * subdivisiones de la pestaña que se abandona (etapa y motivo de cierre). Sin
   * soltarlas, el destino podría seguir escondiendo lo mismo que se fue a buscar.
   */
  const verEnTodos = () => {
    setFase('todos')
    setEtapaNum(null)
    setMotivoCierre('todos')
  }

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
                  : 'border-[#E5E7EB] text-tinta-suave hover:border-tinta/30 hover:text-tinta'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-black/10' : 'bg-papel'
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
                ? 'border-tinta/30 bg-papel text-tinta'
                : 'border-[#E5E7EB] text-tinta-suave hover:text-tinta'
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
                    ? 'border-tinta/30 bg-papel text-tinta'
                    : vacia
                      ? 'border-[#E5E7EB] text-tinta-suave/50 hover:text-tinta-suave'
                      : 'border-[#E5E7EB] text-tinta-suave hover:text-tinta'
                }`}
              >
                {e.nombre}
                <span
                  className={`rounded-full px-1 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-black/10' : vacia ? 'bg-papel text-tinta-suave/50' : 'bg-papel'
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

      {/* Filtros secundarios (colapsados) + atrasados + orden en una sola fila.
          Antes eran cuatro desplegables a ancho completo apilados: en el celular
          empujaban el primer negocio fuera de la pantalla. Ver `BarraFiltros`. */}
      <BarraFiltros campos={camposFiltro}>
        {(atrasadosCount > 0 || soloAtrasados) && (
          <button
            type="button"
            onClick={() => setSoloAtrasados((v) => !v)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              soloAtrasados
                ? 'border-alerta bg-alerta/10 text-alerta'
                : 'border-[#E5E7EB] text-tinta-suave hover:border-alerta/40 hover:text-alerta'
            }`}
            aria-pressed={soloAtrasados}
          >
            <Clock className="h-3 w-3" />
            Atrasados
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                soloAtrasados ? 'bg-black/10' : 'bg-papel'
              }`}
            >
              {atrasadosCount}
            </span>
          </button>
        )}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
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
        <div className="flex items-center justify-between gap-2 text-xs text-tinta-suave">
          <span>
            {currentFiltrado.length} negocio{currentFiltrado.length !== 1 ? 's' : ''} en la vista
          </span>
          <DescargarExcelButton ids={idsVisibles} />
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
                : cerrados.filter((n) => motivoCierreDeEstado(n.estado) === m).length
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMotivoCierre(m)}
                className={`shrink-0 rounded-full border px-2.5 py-1 transition-colors ${
                  isActive
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
            <p className="text-sm text-tinta-suave">
              {fase === 'todos'
                ? 'Sin negocios'
                : etapaNum !== null
                  ? `Sin negocios en ${etapasDeFase.find((e) => e.numero === etapaNum)?.nombre ?? 'esta etapa'}`
                  : `Sin negocios en ${ALL_FASES.find((f) => f.key === fase)?.label}`}
            </p>
            {fase === 'todos' && (
              <p className="mt-1 text-xs text-tinta-suave/70">Crea uno con el boton +</p>
            )}
          </div>
        )
      ) : agrupada ? (
        <div className="space-y-5">
          {grupos.map((g) => (
            <section key={g.dia || 'sin-fecha'} className="space-y-2">
              {/* El encabezado lleva el conteo: al mirar una etapa, "cuántos
                  cayeron hoy" es la pregunta, y obliga a contar tarjetas si no está. */}
              <div className="flex items-baseline gap-2 px-0.5">
                <h3
                  className={`text-xs font-bold uppercase tracking-wider ${
                    // Las citas ya vencidas son lo que se está perdiendo: el grupo va
                    // primero Y va en rojo, porque leído en gris al tope de la lista
                    // se confunde con "lo más próximo".
                    g.dia === GRUPO_CITA_VENCIDA ? 'text-alerta' : 'text-tinta'
                  }`}
                >
                  {g.etiqueta}
                </h3>
                <span className="text-[11px] text-tinta-suave">
                  {g.items.length} caso{g.items.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-3">
                {g.items.map((n) => (
                  <NegocioCard
                    key={n.id}
                    negocio={n}
                    staffList={staffList}
                    canAsignar={canAsignar}
                    canMarcar={canMarcar}
                    // Agrupada por cita, el encabezado ya no dice cuándo llegó el
                    // caso a la etapa: ese dato vuelve a la tarjeta.
                    mostrarLlegada={sortBy === 'cita'}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {currentFiltrado.map((n) => (
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

      {/* El buscador no puede decir que algo no existe.
          En el vacío es la respuesta a la pregunta que el usuario acaba de hacer; con
          resultados es una nota al pie. Va DESPUÉS del bloque de lista/vacío, así que
          cubre también el caso en que la fase está vacía sin filtrar (ahí
          `sinResultadosBusqueda` es false y el mensaje de búsqueda ni se muestra). */}
      {coincidenciasFuera > 0 && (
        <AvisoOtrasPestanas
          cantidad={coincidenciasFuera}
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
      return 'Perdidos'
    case 'cancelado':
      return 'Cancelados'
  }
}
