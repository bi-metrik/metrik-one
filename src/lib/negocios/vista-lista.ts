/**
 * La lista de `/negocios` resuelta en el SERVIDOR: filtros, búsqueda, segmentación por
 * fase/etapa, orden, grupos por día, contadores y la página de tarjetas que viaja.
 *
 * ── Por qué se mudó del cliente ──
 *
 * Hasta el 2026-10-03 el server component mandaba al navegador TODOS los negocios
 * (abiertos y cerrados, ~40 campos cada uno) y el cliente filtraba en memoria. En SOENA
 * eran 505 negocios en una sola línea de 773 KB del payload RSC (815 KB la página, 105 KB
 * en br); con la ruta de red mala la respuesta se cortaba siempre antes de esa línea, y
 * cuando llegaba tardaba de 3 a 15 s. Las demás páginas pesaban 40-47 KB.
 *
 * Ahora el navegador recibe solo lo que pinta: una PÁGINA de tarjetas (`TAMANO_PAGINA`),
 * los contadores ya contados y las opciones de los filtros. El universo se queda en el
 * servidor, así que los contadores, la búsqueda y el aviso de «coincidencias en otras
 * pestañas» siguen viendo TODO (abiertos y cerrados), no solo lo que viajó.
 *
 * Todo lo de aquí es puro (sin red ni reloj): la misma función da la primera carga
 * (`page.tsx`), los cambios de filtro y «ver más» (`GET /api/negocios/lista`) y los ids
 * del Excel. Por eso lo que se descarga sigue siendo exactamente lo que se ve.
 *
 * Las reglas de cada pieza no cambiaron: se copiaron de `negocios-client.tsx` tal cual
 * (incluidos sus porqués), y sus pruebas siguen en `segmentador`, `coincidencias-fuera`,
 * `agrupar-*` y `motivo-cierre`.
 */
import type { NegocioResumen } from '@/app/(app)/negocios/negocio-v2-actions'
import { telefonoCoincide } from '@/lib/busqueda/telefono'
import { ORIGENES_NEGOCIO, origenNegocioLabel } from '@/lib/catalogos/constants'
import { marcaCondicionLabel } from '@/lib/negocios/constants'
import { segmentarNegocios } from '@/lib/negocios/segmentador'
import { etapasEnOrdenDeOcurrencia, type EtapaDelSegmentador } from '@/lib/negocios/linea-de-flujo'
import { contarCoincidenciasFuera } from '@/lib/negocios/coincidencias-fuera'
import { agruparPorLlegada } from '@/lib/negocios/agrupar-por-dia'
import { agruparPorCita } from '@/lib/negocios/agrupar-por-cita'
import { agruparApartandoCerrados } from '@/lib/negocios/agrupar-con-cerrados'
import { motivoCierreDeEstado } from '@/lib/negocios/motivo-cierre'
import { filtroDesdeSearchParams, type SearchParams } from '@/lib/filtros/url-estado'

// ── Parámetros (viven en la URL) ─────────────────────────────────────────────

export type FaseFilter = 'todos' | 'venta' | 'ejecucion' | 'cobro' | 'cerrados'
/** Filtro de motivo de la pestaña Cerrados: los tres desenlaces de `motivo-cierre.ts` + 'todos'. */
export type MotivoCierre = 'todos' | 'exitoso' | 'perdido' | 'cancelado'
/**
 * Orden de la lista. Default: por llegada a la etapa, agrupado por día. 'reciente' no es
 * `created_at desc`: dentro de una etapa lo que importa es qué cayó hoy y qué lleva parado.
 */
export type SortKey = 'reciente' | 'atraso' | 'cita'

// Valores admisibles desde la URL: un `?fase=basura` no puede dejar la lista vacía sin explicación.
export const FASES_VALIDAS: readonly FaseFilter[] = ['todos', 'venta', 'ejecucion', 'cobro', 'cerrados']
export const MOTIVOS_VALIDOS: readonly MotivoCierre[] = ['todos', 'exitoso', 'perdido', 'cancelado']
export const SORT_VALIDOS: readonly SortKey[] = ['reciente', 'atraso', 'cita']

/** Valor del filtro para los negocios sin origen registrado (previos a la captura). */
export const SIN_ORIGEN = 'sin_origen'
/**
 * Valor del filtro para los negocios sin servicio contratado. No es un error: el bloque que
 * lo pregunta vive en una etapa concreta; los que YA la pasaron y siguen vacíos son justo
 * los que hay que poder aislar.
 */
export const SIN_SERVICIO = 'sin_servicio'

/**
 * Tarjetas por página. Con ~0,8 KB por tarjeta compacta son ~25 KB: la primera carga
 * de SOENA queda bajo los 60 KB y un celular ve 4-5 tarjetas por pantalla.
 */
export const TAMANO_PAGINA = 30

export type ParametrosLista = {
  fase: FaseFilter
  etapa: number | null
  cierre: MotivoCierre
  q: string
  seccional: string
  responsable: string
  /** Valor de ORIGENES_NEGOCIO, 'todos', o SIN_ORIGEN. */
  origen: string
  /** Valor crudo del servicio contratado, 'todos', o SIN_SERVICIO. */
  servicio: string
  atrasados: boolean
  orden: SortKey
}

/** Default de cada parámetro (el de `fase` depende del área del usuario: `page.tsx`). */
export function parametrosPorDefecto(defaultStage: FaseFilter): ParametrosLista {
  return {
    fase: defaultStage,
    etapa: null,
    cierre: 'todos',
    q: '',
    seccional: 'todas',
    responsable: 'todos',
    origen: 'todos',
    servicio: 'todos',
    atrasados: false,
    orden: 'reciente',
  }
}

/** Lee los parámetros de la URL con los mismos admisibles que usaba la pantalla. */
export function leerParametrosLista(sp: SearchParams | undefined, defaultStage: FaseFilter): ParametrosLista {
  const d = parametrosPorDefecto(defaultStage)
  return {
    fase: filtroDesdeSearchParams(sp, 'fase', d.fase, FASES_VALIDAS),
    etapa: filtroDesdeSearchParams<number | null>(sp, 'etapa', null),
    cierre: filtroDesdeSearchParams(sp, 'cierre', d.cierre, MOTIVOS_VALIDOS),
    q: filtroDesdeSearchParams(sp, 'q', d.q),
    seccional: filtroDesdeSearchParams(sp, 'seccional', d.seccional),
    responsable: filtroDesdeSearchParams(sp, 'responsable', d.responsable),
    origen: filtroDesdeSearchParams(sp, 'origen', d.origen),
    servicio: filtroDesdeSearchParams(sp, 'servicio', d.servicio),
    atrasados: filtroDesdeSearchParams(sp, 'atrasados', d.atrasados),
    orden: filtroDesdeSearchParams(sp, 'orden', d.orden, SORT_VALIDOS),
  }
}

// ── Filtros (copiados de negocios-client.tsx sin cambiar la regla) ───────────

/** ¿Pasó el SLA de su etapa? false si la etapa no tiene SLA. */
export const estaAtrasado = (n: Pick<NegocioResumen, 'sla_exceso_horas'>) =>
  n.sla_exceso_horas !== null && n.sla_exceso_horas > 0

/**
 * Origen que se muestra y se filtra. Misma regla que el badge de la tarjeta: un negocio
 * marcado por la integración de Meta cuenta como 'meta' mientras el backfill no esté.
 */
const origenEfectivo = (n: NegocioResumen): string | null =>
  n.origen ?? (n.es_meta_lead ? 'meta' : null)

type FiltrosTransversales = {
  seccional: string
  responsable: string
  origen: string
  servicio: string
  /** Ya normalizado (trim + lowercase); vacío = sin búsqueda. */
  term: string
  soloAtrasados: boolean
}

/** Fuente única del filtrado (antes copiada en tres `useMemo`, con contadores que no cuadraban). */
export function aplicarFiltros(lista: NegocioResumen[], f: FiltrosTransversales): NegocioResumen[] {
  let res = lista
  if (f.soloAtrasados) res = res.filter(estaAtrasado)
  if (f.seccional !== 'todas') res = res.filter((n) => n.seccional_label === f.seccional)
  if (f.responsable !== 'todos') res = res.filter((n) => n.responsables.some((r) => r.id === f.responsable))
  if (f.origen !== 'todos') {
    // 'sin_origen' aísla los anteriores a la captura obligatoria: se resuelven a mano.
    res = res.filter((n) => (f.origen === SIN_ORIGEN ? !origenEfectivo(n) : origenEfectivo(n) === f.origen))
  }
  if (f.servicio !== 'todos') {
    res = res.filter((n) => (f.servicio === SIN_SERVICIO ? !n.servicio : n.servicio === f.servicio))
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
      // El teléfono va aparte: guardado con indicativo, paréntesis o pelado.
      return hay.includes(f.term) || telefonoCoincide(n.contacto_telefono, f.term)
    })
  }
  return res
}

// ── Tarjeta: lo que viaja por fila ───────────────────────────────────────────

/**
 * Campos que la tarjeta NO pinta: se usan solo para filtrar y buscar, y eso ya pasó en el
 * servidor. `almacenamiento_externo` es del workspace, viaja una vez en la vista.
 */
type SoloServidor =
  | 'contacto_telefono' | 'created_at' | 'pausado_hasta' | 'motivo_pausa' | 'ciudad_label'
  | 'numero_factura' | 'servicio' | 'etapa_stage' | 'almacenamiento_externo'

export type NegocioTarjeta = Omit<NegocioResumen, SoloServidor> & { almacenamiento_externo?: boolean }

/**
 * Valor por defecto de cada campo de la tarjeta. Lo que vale esto NO viaja (la mayoría de
 * filas tiene `null`/`false`/`[]` en casi todo) y el cliente lo repone al recibir: la
 * tarjeta compara con `!== null`, así que un `undefined` no sirve.
 */
const DEFECTOS_TARJETA = {
  codigo: null, precio_estimado: null, precio_aprobado: null, carpeta_url: null,
  stage_actual: null, estado: null, linea_nombre: null, linea_numero: null, etapa_nombre: null,
  etapa_numero: null, empresa_nombre: null, contacto_nombre: null, costos_ejecutados: 0,
  pausado: false, closed_at: null, razon_cierre: null, vehiculo_label: null, seccional_label: null,
  cedula: null, radicado: null, fecha_cita: null, cita_pendiente: false, atencion_cita: null,
  servicio_label: null, responsables: [], extras: [], es_meta_lead: false, reproceso: null,
  desenlaces: [], origen: null, aliado_nombre: null, marcas: [], etapa_cambiada_at: null,
  etapa_sla_horas: null, horas_habiles_en_etapa: null, sla_exceso_horas: null,
} satisfies Omit<NegocioTarjeta, 'id' | 'nombre' | 'almacenamiento_externo'>

/** Fila tal como viaja: solo `id`, `nombre` y lo que difiere del defecto. */
export type TarjetaCompacta = Pick<NegocioTarjeta, 'id' | 'nombre'> & Partial<NegocioTarjeta>

const esDefecto = (v: unknown, d: unknown) =>
  v === d || (Array.isArray(v) && Array.isArray(d) && v.length === 0 && d.length === 0) || v === undefined

/** Horas con dos decimales: la tarjeta pinta días u horas enteras; el resto era ruido. */
const redondearHoras = (h: number | null) => (h === null ? null : Math.round(h * 100) / 100)

export function compactarTarjeta(n: NegocioResumen): TarjetaCompacta {
  const fuente: NegocioTarjeta = {
    ...n,
    horas_habiles_en_etapa: redondearHoras(n.horas_habiles_en_etapa),
    sla_exceso_horas: redondearHoras(n.sla_exceso_horas),
  }
  const out: TarjetaCompacta = { id: n.id, nombre: n.nombre }
  for (const k of Object.keys(DEFECTOS_TARJETA) as Array<keyof typeof DEFECTOS_TARJETA>) {
    const v = fuente[k]
    if (!esDefecto(v, DEFECTOS_TARJETA[k])) (out as Record<string, unknown>)[k] = v
  }
  return out
}

export function expandirTarjeta(c: TarjetaCompacta, almacenamientoExterno: boolean): NegocioTarjeta {
  return {
    ...DEFECTOS_TARJETA,
    responsables: [], extras: [], desenlaces: [], marcas: [],
    ...c,
    almacenamiento_externo: almacenamientoExterno,
  } as NegocioTarjeta
}

// ── La vista ─────────────────────────────────────────────────────────────────

export type GrupoVista = {
  dia: string
  etiqueta: string
  /** Casos del grupo en TODA la lista, no solo en lo cargado. */
  total: number
  /** Posición del primer caso del grupo en la lista ordenada. */
  desde: number
}

export type OpcionFiltro = { value: string; label: string; count?: number }

/** Todo lo que la pantalla pinta, sin las tarjetas. Contado sobre el universo completo. */
export type ResumenLista = {
  totalAbiertos: number
  totalCerrados: number
  /** Largo de la lista filtrada (lo que abre el chip activo). */
  totalVista: number
  conteoFases: Record<FaseFilter, number>
  /** Contador por número de etapa de la fase activa (no se filtra a sí mismo). */
  conteoEtapas: Record<number, number>
  atrasados: number
  /** Sobre los cerrados SIN filtros, como antes. */
  conteoMotivos: Record<MotivoCierre, number>
  coincidenciasFuera: number
  /** La fase/etapa tiene negocios sin filtrar: el vacío es de la búsqueda, no de la etapa. */
  hayEnFaseEtapa: boolean
  hayCitas: boolean
  /** null = la lista no está agrupada por día. */
  grupos: GrupoVista[] | null
  opciones: {
    seccionales: OpcionFiltro[]
    responsables: OpcionFiltro[]
    origenes: OpcionFiltro[]
    servicios: OpcionFiltro[]
  }
}

export type VistaResuelta = {
  resumen: ResumenLista
  /** La lista visible completa, en el orden de la pantalla (grupos incluidos). */
  ordenados: NegocioResumen[]
}

export function resolverVistaLista(
  abiertos: NegocioResumen[],
  cerrados: NegocioResumen[],
  etapas: EtapaDelSegmentador[],
  p: ParametrosLista,
  hoyISO: string,
): VistaResuelta {
  const term = p.q.trim().toLowerCase()
  const filtros: FiltrosTransversales = {
    seccional: p.seccional, responsable: p.responsable, origen: p.origen,
    servicio: p.servicio, term, soloAtrasados: p.atrasados,
  }
  const aplicar = (xs: NegocioResumen[]) => aplicarFiltros(xs, filtros)

  // Cerrados filtrados por motivo, DERIVADO de `estado` (`cierre_motivo` está NULL siempre).
  const cerradosFiltrados =
    p.cierre === 'todos' ? cerrados : cerrados.filter((n) => motivoCierreDeEstado(n.estado) === p.cierre)

  // Lista + contadores de etapa de la misma segmentación (regla en segmentador.ts).
  const seg = segmentarNegocios(abiertos, cerradosFiltrados, p.fase, p.etapa, aplicar)
  const sinOrden = seg.lista

  // 'atraso' pone primero al más atrasado; clave finita para no comparar infinitos (NaN).
  const exceso = (n: NegocioResumen) => n.sla_exceso_horas ?? -1e9
  const filtrada = p.orden === 'atraso' ? [...sinOrden].sort((a, b) => exceso(b) - exceso(a)) : sinOrden

  // Se agrupa por día SOLO con orden de fecha y fuera de 'cerrados'.
  const agrupada = (p.orden === 'reciente' || p.orden === 'cita') && p.fase !== 'cerrados'
  // Quién es cerrado lo dice su ORIGEN (el arreglo `cerrados`), no releer `estado`.
  const idsCerrados = new Set(cerrados.map((n) => n.id))
  const gruposCompletos = agrupada
    ? agruparApartandoCerrados(
        filtrada,
        (n) => idsCerrados.has(n.id),
        (abiertosDeLaLista) =>
          p.orden === 'cita' ? agruparPorCita(abiertosDeLaLista, hoyISO) : agruparPorLlegada(abiertosDeLaLista, hoyISO),
      )
    : null

  // El orden de la pantalla: con grupos lo fijan los grupos, no la lista plana.
  const ordenados = gruposCompletos ? gruposCompletos.flatMap((g) => g.items) : filtrada
  let desde = 0
  const grupos = gruposCompletos
    ? gruposCompletos.map((g) => {
        const out = { dia: g.dia, etiqueta: g.etiqueta, total: g.items.length, desde }
        desde += g.items.length
        return out
      })
    : null

  // Contadores de fase: todos los filtros MENOS fase/etapa. "Todos" suma los cerrados
  // porque su lista los incluye.
  const negociosFiltrados = aplicar(abiertos)
  const cerradosConFiltros = aplicar(cerradosFiltrados)
  const conteoFases: Record<FaseFilter, number> = {
    todos: negociosFiltrados.length + cerradosConFiltros.length,
    venta: negociosFiltrados.filter((n) => n.stage_actual === 'venta').length,
    ejecucion: negociosFiltrados.filter((n) => n.stage_actual === 'ejecucion').length,
    cobro: negociosFiltrados.filter((n) => n.stage_actual === 'cobro').length,
    cerrados: cerradosConFiltros.length,
  }

  const conteoEtapas: Record<number, number> = {}
  if (p.fase === 'venta' || p.fase === 'ejecucion' || p.fase === 'cobro') {
    for (const e of etapasEnOrdenDeOcurrencia(etapas)) {
      if (e.stage === p.fase) conteoEtapas[e.numero] = seg.contarEtapa(e.numero)
    }
  }

  // Atrasados de la fase/etapa ignorando el propio toggle (si no, se congela).
  const atrasados = segmentarNegocios(abiertos, cerradosFiltrados, p.fase, p.etapa, (xs) =>
    aplicarFiltros(xs, { ...filtros, soloAtrasados: false }),
  ).lista.filter(estaAtrasado).length

  const conteoMotivos: Record<MotivoCierre, number> = { todos: cerrados.length, exitoso: 0, perdido: 0, cancelado: 0 }
  for (const n of cerrados) {
    const m = motivoCierreDeEstado(n.estado)
    if (m) conteoMotivos[m] += 1
  }

  // Coincidencias fuera de la pestaña: universo crudo (el motivo es una de las dimensiones).
  const coincidenciasFuera =
    term.length === 0 ? 0 : contarCoincidenciasFuera([...abiertos, ...cerrados], filtrada, aplicar)

  const hayEnFaseEtapa = segmentarNegocios(abiertos, cerradosFiltrados, p.fase, p.etapa, (xs) => xs).lista.length > 0

  return {
    ordenados,
    resumen: {
      totalAbiertos: abiertos.length,
      totalCerrados: cerrados.length,
      totalVista: filtrada.length,
      conteoFases,
      conteoEtapas,
      atrasados,
      conteoMotivos,
      coincidenciasFuera,
      hayEnFaseEtapa,
      // El orden por cita solo se ofrece donde hay bloque de cita (si no, todo cae en «Sin cita»).
      hayCitas: abiertos.some((n) => n.fecha_cita || n.cita_pendiente),
      grupos,
      opciones: opcionesDeFiltro(abiertos, cerrados),
    },
  }
}

/** Opciones de los desplegables: solo las que existen. Mismas fuentes que antes. */
function opcionesDeFiltro(abiertos: NegocioResumen[], cerrados: NegocioResumen[]): ResumenLista['opciones'] {
  // Seccionales y responsables: de los abiertos.
  const secc = new Set<string>()
  for (const n of abiertos) if (n.seccional_label) secc.add(n.seccional_label)
  const seccionales = Array.from(secc)
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((s) => ({ value: s, label: s }))

  const resp = new Map<string, string>()
  for (const n of abiertos) for (const r of n.responsables) resp.set(r.id, r.full_name)
  const responsables = Array.from(resp, ([id, full_name]) => ({ value: id, label: full_name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))

  // Orígenes y servicios: de abiertos + cerrados, con conteo.
  const todos = [...abiertos, ...cerrados]
  const conteoOrigen = new Map<string, number>()
  for (const n of todos) {
    const key = origenEfectivo(n) ?? SIN_ORIGEN
    conteoOrigen.set(key, (conteoOrigen.get(key) ?? 0) + 1)
  }
  const ordenCatalogo = ORIGENES_NEGOCIO.map((o) => o.value as string)
  const origenes = Array.from(conteoOrigen, ([value, count]) => ({
    value,
    label: value === SIN_ORIGEN ? 'Sin origen registrado' : (origenNegocioLabel(value) ?? value),
    count,
  })).sort((a, b) => {
    // Catálogo en su orden; 'sin origen' de último (residuo histórico).
    const ia = a.value === SIN_ORIGEN ? 999 : ordenCatalogo.indexOf(a.value)
    const ib = b.value === SIN_ORIGEN ? 999 : ordenCatalogo.indexOf(b.value)
    return ia - ib
  })

  // Se filtra por el valor CRUDO y se muestra la etiqueta corta (enlaces estables).
  const conteoServicio = new Map<string, { label: string; count: number }>()
  for (const n of todos) {
    const key = n.servicio ?? SIN_SERVICIO
    const label = key === SIN_SERVICIO ? 'Sin servicio definido' : (n.servicio_label ?? key)
    const prev = conteoServicio.get(key)
    conteoServicio.set(key, { label, count: (prev?.count ?? 0) + 1 })
  }
  const servicios = Array.from(conteoServicio, ([value, { label, count }]) => ({ value, label, count })).sort(
    (a, b) => (a.value === SIN_SERVICIO ? 1 : b.value === SIN_SERVICIO ? -1 : a.label.localeCompare(b.label, 'es')),
  )

  return { seccionales, responsables, origenes, servicios }
}

// ── Lo que viaja ─────────────────────────────────────────────────────────────

/** Etapa para el chip del nivel 2, ya en orden de ocurrencia (sin el routing, que pesa). */
export type EtapaChip = { numero: number; nombre: string; stage: string }

/** Lo que viaja al navegador: una página de tarjetas y el resumen ya contado. */
export type VistaLista = {
  parametros: ParametrosLista
  defaultStage: FaseFilter
  resumen: ResumenLista
  etapas: EtapaChip[]
  /** Posición de la primera tarjeta de `tarjetas` en la lista ordenada. */
  desde: number
  tarjetas: TarjetaCompacta[]
  /** Del workspace: la tarjeta no ofrece "abrir carpeta" si guarda fuera de Drive. */
  almacenamientoExterno: boolean
  hoyISO: string
}

/** Lo que el servidor lee para resolver la lista (no viaja). */
export type Universo = {
  abiertos: NegocioResumen[]
  cerrados: NegocioResumen[]
  etapas: EtapaDelSegmentador[]
  defaultStage: FaseFilter
  hoyISO: string
}

/** Rango de la página pedida, acotado (nadie pide 10.000 tarjetas de una). */
export function rangoDePagina(pagina: { desde?: number; cuantos?: number } = {}): { desde: number; cuantos: number } {
  const desde = Number.isFinite(pagina.desde) ? Math.max(0, Math.floor(pagina.desde!)) : 0
  const pedido = Number.isFinite(pagina.cuantos) ? Math.floor(pagina.cuantos!) : TAMANO_PAGINA
  return { desde, cuantos: Math.min(Math.max(1, pedido), 200) }
}

/**
 * Arma la vista para unos parámetros de URL: resumen + la página pedida, compactada.
 * Puro. Los costos de la página los pone quien llama (`cargar-vista-lista.ts`), porque
 * se leen solo para esas filas.
 */
export function armarVistaLista(
  u: Universo,
  sp: SearchParams | undefined,
  pagina: { desde?: number; cuantos?: number } = {},
): { vista: VistaLista; ordenados: NegocioResumen[] } {
  const parametros = leerParametrosLista(sp, u.defaultStage)
  const { resumen, ordenados } = resolverVistaLista(u.abiertos, u.cerrados, u.etapas, parametros, u.hoyISO)
  const { desde, cuantos } = rangoDePagina(pagina)
  const muestra = u.abiertos[0] ?? u.cerrados[0]
  return {
    ordenados,
    vista: {
      parametros,
      defaultStage: u.defaultStage,
      resumen,
      etapas: etapasEnOrdenDeOcurrencia(u.etapas).map((e) => ({ numero: e.numero, nombre: e.nombre, stage: e.stage })),
      desde,
      tarjetas: ordenados.slice(desde, desde + cuantos).map(compactarTarjeta),
      almacenamientoExterno: muestra?.almacenamiento_externo ?? false,
      hoyISO: u.hoyISO,
    },
  }
}
