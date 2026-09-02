'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Target, X } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, LabelList,
} from 'recharts'
import type {
  ComercialResumenRow,
  ComercialVendedorMes,
  ComercialMesResponse,
  ComercialSerieResponse,
  ComercialOrigenMes,
  ComercialSeccionalFila,
  ComercialSerieSeccionalResponse,
  ComercialSerieSeccionalPunto,
  ComercialSerieVendedorResponse,
  ComercialSerieVendedorPunto,
  ComercialSeccionalMes,
  ComercialPlanPagoFila,
  ComercialPlanPagoMes,
  CapacidadPunto,
  CapacidadSeccional,
} from '../../equipo/comercial-types'
import { MESES_ES, planPagoLabel } from '../../equipo/comercial-types'
import {
  getComercialMes,
  getComercialOrigenMes,
  getComercialSeccionalMes,
  getComercialPlanPagoMes,
  type RecorteVendedor,
} from '../../equipo/comercial-actions'
import MetasAnioModal from './metas-anio-modal'
import { canonizarSeccional } from '@/lib/dian/seccionales'
import { VentasDrawer, type CifraSeleccionada } from './ventas-drawer'
import { PerdidosDrawer } from './perdidos-drawer'
import { PagosDrawer, type MesSeleccionado } from './pagos-drawer'
import { origenNegocioLabel } from '@/lib/catalogos/constants'

/**
 * El vendedor elegido en la tabla. `id` null + `sinResponsable` true es el bucket de los
 * negocios sin comercial atribuido, que es una respuesta legitima y no la ausencia de
 * filtro — por eso son dos campos y no uno.
 */
type VendedorSel = { id: string | null; nombre: string; sinResponsable: boolean }

const GREEN = '#059669'
const BLUE = '#2563EB'
// El segundo pago necesita color propio y CONTRASTADO: en gris sobre el verde del
// primero, $850.000 al lado de $25,9M eran unos seis pixeles indistinguibles.
const OCRE = '#D97706'

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}
function nombreCorto(s: string): string {
  return s.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
function pct(n: number | null): string {
  return n === null ? 'sin dato' : `${n}%`
}

/**
 * Cómo se titula el panel según la celda que se abrió.
 *
 * Los tres títulos son distintos a propósito: hasta ahora dos cifras distintas se
 * llamaban "ventas" y "casos completos" sin decir qué medía cada una, y el bono
 * hablaba de una tercera. El título del panel es donde el usuario confirma qué está
 * mirando (punto #13).
 */
const TITULO_CELDA: Record<AlcanceCelda, string> = {
  todas: 'Ventas',
  completos: 'Honorario cubierto',
  bonificables: 'Ventas bonificables',
}

/**
 * Variación contra el mismo indicador del mes anterior (punto #41).
 *
 * Devuelve `null` —y la pantalla no pinta nada— en los dos casos en que un número
 * mentiría: cuando falta alguno de los dos valores, y cuando el mes anterior fue
 * CERO. Un salto desde cero no tiene porcentaje; escribir "+∞%" o "+100%" ahí es
 * inventar una magnitud. En su lugar se dice de dónde venía.
 */
function delta(
  actual: number | null | undefined,
  previo: number | null | undefined,
  opciones?: { menosEsMejor?: boolean },
): { texto: string; bueno: boolean | null } | null {
  if (actual === null || actual === undefined) return null
  if (previo === null || previo === undefined) return null
  if (actual === previo) return { texto: 'igual que el mes anterior', bueno: null }
  if (previo === 0) return { texto: 'el mes anterior fue 0', bueno: null }
  const variacion = ((actual - previo) / Math.abs(previo)) * 100
  const sube = actual > previo
  const bueno = opciones?.menosEsMejor ? !sube : sube
  return { texto: `${sube ? '+' : ''}${variacion.toFixed(0)}% vs mes anterior`, bueno }
}

export interface TabComercialSoenaProps {
  equipo: ComercialResumenRow[]
  mesInicial: ComercialMesResponse | null
  /** El mes anterior al inicial, para la comparación automática (punto #41). */
  mesAnteriorInicial: ComercialMesResponse | null
  origenInicial: ComercialOrigenMes | null
  /** Corte del mes por seccional DIAN (punto #22). `null` = no se pudo traer. */
  seccionalInicial: ComercialSeccionalMes | null
  /** Corte del mes por plan de pago (50/50, 100% anticipado, sin declarar). */
  planPagoInicial: ComercialPlanPagoMes | null
  /**
   * Capacidad mensual por seccional (punto #43). `null` = la linea no declaro de
   * donde sale cada serie, y entonces la seccion no se dibuja.
   */
  capacidad: CapacidadSeccional | null
  serie: ComercialSerieResponse | null
  /**
   * El mismo historico abierto por seccional DIAN. `null` = no se pudo traer y el
   * filtro sencillamente no se dibuja; las graficas siguen mostrando el total.
   */
  serieSeccional: ComercialSerieSeccionalResponse | null
  /**
   * El mismo historico abierto por vendedor. `null` = no se pudo traer y el filtro por
   * persona sencillamente no recorta las graficas; la tabla se sigue dibujando.
   */
  serieVendedor: ComercialSerieVendedorResponse | null
  anioInicial: number
  mesNumInicial: number
  /**
   * 'YYYY-MM' del mes en curso EN BOGOTÁ, resuelto en el servidor. Sirve para saber
   * si el mes que se está mirando va a medias: comparar un mes incompleto contra uno
   * cerrado y no decirlo es la forma más fácil de que el tablero mienta sin errores.
   */
  mesEnCurso: string
  /** Día del mes en Bogotá. Solo se usa para declarar cuánto lleva corrido el mes. */
  diaEnCurso: number
  puedeEditarMetas: boolean
}

export function TabComercialSoena({
  equipo,
  mesInicial,
  mesAnteriorInicial,
  origenInicial,
  seccionalInicial,
  planPagoInicial,
  capacidad,
  serie,
  serieSeccional,
  serieVendedor,
  anioInicial,
  mesNumInicial,
  mesEnCurso,
  diaEnCurso,
  puedeEditarMetas,
}: TabComercialSoenaProps) {
  const [anio, setAnio] = useState(anioInicial)
  const [mes, setMes] = useState(mesNumInicial)
  const [mesData, setMesData] = useState<ComercialMesResponse | null>(mesInicial)
  const [mesPrevio, setMesPrevio] = useState<ComercialMesResponse | null>(mesAnteriorInicial)
  const [origen, setOrigen] = useState<ComercialOrigenMes | null>(origenInicial)
  const [seccional, setSeccional] = useState<ComercialSeccionalMes | null>(seccionalInicial)
  const [planPago, setPlanPago] = useState<ComercialPlanPagoMes | null>(planPagoInicial)
  const [metasModalOpen, setMetasModalOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  // Qué cifra se abrió. `null` = panel cerrado. Se monta con `key` para que al pasar de
  // una cifra a otra el panel se remonte y no muestre por un instante la lista anterior.
  const [cifra, setCifra] = useState<CifraSeleccionada | null>(null)
  const [verPerdidos, setVerPerdidos] = useState(false)
  // Que mes de recaudo se abrio. Va aparte de `cifra` porque su unidad es el COBRO y no
  // el negocio: mezclarlos obligaria al panel a adivinar cual de las dos listas pintar.
  const [pagosDe, setPagosDe] = useState<MesSeleccionado | null>(null)
  /**
   * Que seccional se esta mirando en el historico. `undefined` = todas (el default);
   * `null` = el bucket "sin registrar", que es una respuesta legitima y no la ausencia
   * de filtro. Por eso son tres estados y no dos.
   */
  const [filtroSeccional, setFiltroSeccional] = useState<string | null | undefined>(undefined)
  /**
   * Que vendedor se esta mirando. `null` = todo el equipo.
   *
   * Es el mando del tablero: la fila elegida en la tabla recorta TODO lo que va debajo.
   * Guarda el nombre y no solo el id porque la etiqueta tiene que sobrevivir un cambio
   * de mes — si el vendedor no vendio en el mes nuevo, su fila desaparece de la tabla y
   * el filtro se quedaria sin como llamarse.
   */
  const [filtroVendedor, setFiltroVendedor] = useState<VendedorSel | null>(null)

  /**
   * Salta a un mes concreto, con el recorte por vendedor que este puesto.
   *
   * `recorte` viaja como argumento y no se lee del estado: `setFiltroVendedor` no ha
   * surtido efecto todavia cuando el clic en una fila dispara la recarga, asi que leer
   * `filtroVendedor` aqui traeria el filtro ANTERIOR y la pantalla quedaria un mes
   * entero mostrando el corte de otra persona.
   *
   * `getComercialMes` va SIN recorte a proposito: es quien alimenta la tabla que hace de
   * mando. Filtrarla dejaria una sola fila en pantalla y no habria forma de cambiar de
   * vendedor ni de quitar el filtro.
   */
  function irAlMes(na: number, nm: number, recorte?: RecorteVendedor) {
    setMes(nm)
    setAnio(na)
    const prev = nm === 1 ? { a: na - 1, m: 12 } : { a: na, m: nm - 1 }
    startTransition(async () => {
      // Las tres consultas van juntas: si la comparación llegara después, el panel
      // mostraría por un instante los deltas del mes anterior sobre las cifras nuevas.
      const [d, p, o, sec, plan] = await Promise.all([
        getComercialMes(na, nm),
        getComercialMes(prev.a, prev.m),
        getComercialOrigenMes(na, nm, recorte),
        getComercialSeccionalMes(na, nm, recorte),
        getComercialPlanPagoMes(na, nm, recorte),
      ])
      setMesData(d)
      setMesPrevio(p)
      setOrigen(o)
      setSeccional(sec)
      setPlanPago(plan)
    })
  }

  /** Si esta fila de la tabla es la que esta recortando el tablero. */
  const esteVendedorFiltra = (v: ComercialVendedorMes) =>
    filtroVendedor !== null
    && filtroVendedor.id === v.responsable_id
    && filtroVendedor.sinResponsable === v.sin_responsable

  /** El recorte vigente, en la forma que entienden las acciones. */
  const recorteActual: RecorteVendedor | undefined = filtroVendedor
    ? { responsableId: filtroVendedor.id, sinResponsable: filtroVendedor.sinResponsable }
    : undefined

  /**
   * Elige (o suelta) un vendedor y recarga los tres cortes del mes con ese recorte.
   *
   * Volver a hacer clic en la fila que ya estaba elegida SUELTA el filtro: sin eso, la
   * unica salida seria el aspa, y quien acaba de hacer clic en una fila espera que el
   * segundo clic la deshaga.
   *
   * Elegir vendedor SUELTA la seccional, y viceversa. No es una limitacion de pantalla:
   * el historico llega abierto por seccional Y abierto por vendedor, pero nunca por la
   * combinacion de las dos, asi que cruzarlas obligaria a inventar un dato que nadie
   * calculo. Antes que mentir con un cruce inventado, se sostiene un filtro a la vez.
   */
  function elegirVendedor(sel: VendedorSel | null) {
    const mismo = sel !== null && filtroVendedor !== null
      && filtroVendedor.id === sel.id && filtroVendedor.sinResponsable === sel.sinResponsable
    const siguiente = mismo ? null : sel
    setFiltroVendedor(siguiente)
    if (siguiente) setFiltroSeccional(undefined)
    const recorte: RecorteVendedor | undefined = siguiente
      ? { responsableId: siguiente.id, sinResponsable: siguiente.sinResponsable }
      : undefined
    startTransition(async () => {
      const [o, sec, plan] = await Promise.all([
        getComercialOrigenMes(anio, mes, recorte),
        getComercialSeccionalMes(anio, mes, recorte),
        getComercialPlanPagoMes(anio, mes, recorte),
      ])
      setOrigen(o)
      setSeccional(sec)
      setPlanPago(plan)
    })
  }

  function cambiarMes(delta: number) {
    let nm = mes + delta
    let na = anio
    if (nm < 1) { nm = 12; na -= 1 }
    if (nm > 12) { nm = 1; na += 1 }
    irAlMes(na, nm, recorteActual)
  }

  const kpis = mesData?.kpis
  const kpisPrev = mesPrevio?.kpis
  // Sin filtro se usa `porDia` tal cual. Con filtro se reconstruye desde el desglose
  // por persona, que suma exactamente lo mismo: la barra recortada nunca puede pasarse
  // de la barra entera. Los dias sin ventas de esa persona se mantienen EN CERO y no se
  // borran — un dia que desaparece del eje se lee como "ese dia no existio".
  const ventasPorDia = useMemo(() => {
    const todos = mesData?.porDia ?? []
    if (!filtroVendedor) return todos
    const suyas = new Map<string, number>()
    for (const d of mesData?.porDiaVendedor ?? []) {
      const esSuyo = filtroVendedor.sinResponsable
        ? d.responsable_id === null
        : d.responsable_id === filtroVendedor.id
      if (esSuyo) suyas.set(d.dia, (suyas.get(d.dia) ?? 0) + d.ventas)
    }
    return todos.map((d) => ({ ...d, ventas: suyas.get(d.dia) ?? 0 }))
  }, [mesData, filtroVendedor])

  // El mes en curso va a medias: su comparación contra un mes cerrado siempre pierde.
  // No se oculta el delta, se declara — esconderlo obligaría a adivinar por qué el mes
  // actual "va mal" todos los días hasta el 30.
  const periodoActual = `${anio}-${String(mes).padStart(2, '0')}`
  const esMesEnCurso = periodoActual === mesEnCurso
  const mesPrevioLabel = mes === 1 ? `${MESES_ES[11]} ${anio - 1}` : `${MESES_ES[mes - 2]} ${anio}`

  /** Abre las ventas del mes con el alcance de la celda en la que se hizo clic. */
  const abrirVentas = (extra: Partial<CifraSeleccionada> & { titulo: string }) =>
    setCifra({ anio, mes, ...extra })

  const abrirTodasDelMes = kpis && kpis.num_ventas > 0
    ? () => abrirVentas({ titulo: `Ventas · ${MESES_ES[mes - 1]} ${anio}` })
    : undefined
  const abrirCompletosDelMes = kpis && kpis.casos_completos > 0
    ? () => abrirVentas({
        titulo: `Honorario cubierto · ${MESES_ES[mes - 1]} ${anio}`,
        soloCompletos: true, alcance: 'el honorario aprobado quedó cubierto',
      })
    : undefined
  const abrirBonificablesDelMes = kpis && kpis.bonificables
    ? () => abrirVentas({
        titulo: `Ventas bonificables · ${MESES_ES[mes - 1]} ${anio}`,
        soloBonificables: true, alcance: 'pasaron el umbral que declara la línea',
      })
    : undefined

  /**
   * Las ventas 50/50 del mes: son las ÚNICAS que pueden tener un segundo pago.
   *
   * Sin este dato, la casilla "2º pago" en cero se lee como "nadie pagó su segunda
   * mitad" cuando casi siempre significa "ninguna venta de este mes tenía segunda
   * mitad". En julio de 2026 hubo $850.000 de segundos pagos (V0025 y V0099) y el
   * tablero no los mostraba en ninguna parte visible.
   */
  const filaPlan1 = planPago?.filas.find((f) => f.plan_pago === 1) ?? null
  const mesSinVentas5050 = filaPlan1 !== null && filaPlan1.ventas === 0

  // Quien lidera el equipo toma casos especiales pero no compite: va listado aparte, al
  // pie de la tabla, para no mezclarlo con la comparacion entre quienes ejecutan. Sus
  // cifras SI cuentan en el TOTAL, que es el del equipo entero.
  const porVendedor = mesData?.porVendedor ?? []
  const vendedoresMes = porVendedor.filter((v) => !v.es_lider)
  const lideresMes = porVendedor.filter((v) => v.es_lider)

  const totalHonorario = equipo.reduce((s, v) => s + v.honorario_recaudado, 0)
  const totalTarifa = equipo.reduce((s, v) => s + v.tarifa_recaudada, 0)
  const totalAprobado = equipo.reduce((s, v) => s + v.valor_aprobado, 0)

  // En `useMemo` y no suelto: `?? []` crea un arreglo nuevo en cada render, y como es
  // dependencia de la serie filtrada, sin memo esa se recalcularia siempre.
  const serieTotal = useMemo(() => serie?.serie ?? [], [serie])

  /**
   * El historico por seccional, ya canonizado y agrupado.
   *
   * La RPC devuelve la seccional CRUDA a proposito: el catalogo canonico vive en
   * TypeScript (`canonizarSeccional`) y copiarlo a SQL crearia una segunda fuente que se
   * desincroniza el dia que la DIAN cambie una. Aqui se colapsa, igual que hace el corte
   * del mes. Un texto que el catalogo no reconoce se conserva tal cual en vez de caer al
   * bucket de "sin registrar": no saber como se llama una seccional no es lo mismo que
   * no tenerla, y mezclarlas escondería el caso raro justo donde hay que verlo.
   */
  const historicoSeccional = useMemo(() => {
    const filas = serieSeccional?.serie ?? []
    const porClave = new Map<string, ComercialSerieSeccionalPunto & { clave: string | null }>()
    for (const f of filas) {
      const canonica = f.seccional_cruda === null
        ? null
        : canonizarSeccional(f.seccional_cruda) ?? f.seccional_cruda
      const clave = `${f.anio}-${f.mes}-${canonica ?? ''}`
      const previo = porClave.get(clave)
      if (!previo) {
        porClave.set(clave, { ...f, clave: canonica, negocio_ids: [...f.negocio_ids], cobro_ids: [...f.cobro_ids] })
        continue
      }
      previo.num_ventas += f.num_ventas
      previo.valor_sin_iva += f.valor_sin_iva
      previo.valor_con_iva += f.valor_con_iva
      previo.honorario_recaudado += f.honorario_recaudado
      previo.primer_pago += f.primer_pago
      previo.segundo_pago += f.segundo_pago
      previo.tarifa_recaudada += f.tarifa_recaudada
      previo.negocio_ids.push(...f.negocio_ids)
      previo.cobro_ids.push(...f.cobro_ids)
    }
    return [...porClave.values()]
  }, [serieSeccional])

  /**
   * Las seccionales que se pueden elegir, ordenadas por peso historico.
   *
   * "Sin registrar" va SIEMPRE de ultima y nunca se esconde ni se reparte entre las
   * demas: es la misma regla que cerro Mauricio el 2026-08-22 para el corte del mes.
   */
  const opcionesSeccional = useMemo(() => {
    const acumulado = new Map<string, { clave: string | null; ventas: number }>()
    for (const f of historicoSeccional) {
      const k = f.clave ?? ''
      const previo = acumulado.get(k) ?? { clave: f.clave, ventas: 0 }
      previo.ventas += f.num_ventas
      acumulado.set(k, previo)
    }
    return [...acumulado.values()].sort((a, b) => {
      if (a.clave === null) return 1
      if (b.clave === null) return -1
      return b.ventas - a.ventas || (a.clave ?? '').localeCompare(b.clave ?? '')
    })
  }, [historicoSeccional])

  /**
   * Elegir seccional SUELTA el vendedor, por la misma razon que al reves: el historico
   * no llega abierto por la combinacion de los dos. Ademas hay que devolver los cortes
   * del mes a su version entera — si no, el tablero diria "todas las seccionales"
   * mientras las cifras de abajo siguen siendo las de una sola persona.
   */
  function elegirSeccional(clave: string | null | undefined) {
    setFiltroSeccional(clave)
    if (filtroVendedor) elegirVendedor(null)
  }

  /**
   * El historico por vendedor, indexado por mes.
   *
   * No hay nada que canonizar aqui —a diferencia de la seccional, la clave es un id— asi
   * que solo se agrupa. Cada punto ya trae `negocio_ids` y `cobro_ids`, que son los
   * conjuntos EXACTOS que suman sus cifras: el drill abre eso y no una consulta paralela.
   */
  const historicoVendedor = useMemo(() => serieVendedor?.serie ?? [], [serieVendedor])

  const hayFiltroSeccional = filtroSeccional !== undefined
  const hayFiltroVendedor = filtroVendedor !== null
  // Los dos nunca estan puestos a la vez (`elegirVendedor` y `elegirSeccional` se sueltan
  // mutuamente), asi que de aqui para abajo el resto del tablero solo necesita saber si
  // HAY filtro y cual es su fila del mes — le da igual de que tipo sea.
  const hayFiltro = hayFiltroSeccional || hayFiltroVendedor
  const etiquetaFiltro = hayFiltroVendedor
    ? filtroVendedor.nombre
    : filtroSeccional === null ? 'Sin seccional registrada' : filtroSeccional ?? ''

  /** La fila del filtro vigente en un mes concreto, si la hubo. Sirve para los dos. */
  const filaDelMes = (a: number, m: number): { negocio_ids: string[]; cobro_ids: string[] } | null => {
    if (hayFiltroVendedor) {
      return historicoVendedor.find((f) => f.anio === a && f.mes === m && (
        filtroVendedor.sinResponsable ? f.responsable_id === null : f.responsable_id === filtroVendedor.id
      )) ?? null
    }
    if (hayFiltroSeccional) {
      return historicoSeccional.find((f) => f.anio === a && f.mes === m && f.clave === filtroSeccional) ?? null
    }
    return null
  }

  /**
   * Lo que dibujan las cuatro graficas.
   *
   * El EJE lo sigue definiendo la serie total: si se recortara a los meses en que esa
   * seccional tuvo movimiento, un mes en cero desapareceria del grafico en vez de
   * dibujarse como el cero que es, y "Bogota no vendio en junio" se leeria igual que
   * "junio no existe".
   */
  const serieData = useMemo(() => {
    if (!hayFiltro) return serieTotal
    const recorte = (p: { anio: number; mes: number }): ComercialSerieVendedorPunto | ComercialSerieSeccionalPunto | undefined =>
      filtroVendedor
        ? historicoVendedor.find((x) => x.anio === p.anio && x.mes === p.mes && (
            filtroVendedor.sinResponsable ? x.responsable_id === null : x.responsable_id === filtroVendedor.id
          ))
        : historicoSeccional.find((x) => x.anio === p.anio && x.mes === p.mes && x.clave === filtroSeccional)
    return serieTotal.map((p) => {
      const f = recorte(p)
      return {
        ...p,
        num_ventas: f?.num_ventas ?? 0,
        valor_sin_iva: f?.valor_sin_iva ?? 0,
        valor_con_iva: f?.valor_con_iva ?? 0,
        honorario_recaudado: f?.honorario_recaudado ?? 0,
        primer_pago: f?.primer_pago ?? 0,
        segundo_pago: f?.segundo_pago ?? 0,
        tarifa_recaudada: f?.tarifa_recaudada ?? 0,
      }
    })
  }, [hayFiltro, serieTotal, historicoSeccional, filtroSeccional, historicoVendedor, filtroVendedor])

  // Clic en cualquier punto del histórico = ir a ese mes. El `label` es lo único que
  // recharts devuelve al hacer clic, así que se resuelve contra la serie en vez de
  // parsearlo: el formato de la etiqueta lo decide la RPC y puede cambiar.
  const puntoDeLaSerie = (estado: { activeLabel?: string | number } | null) => {
    const etiqueta = estado?.activeLabel
    if (etiqueta === undefined || etiqueta === null) return null
    return serieData.find((p) => p.label === String(etiqueta)) ?? null
  }

  /**
   * El mismo clic, encadenado: primero lleva al mes, y ya parado ahi abre los negocios
   * que suman la barra.
   *
   * Encadenar es lo unico que funciona con el dedo. La alternativa era repartir el clic
   * por zonas —la barra abre la lista, la etiqueta del eje navega—, pero esa etiqueta
   * mide doce pixeles de alto y el area util del grafico es la tarjeta entera.
   * Ademas el segundo clic no le quita nada a nadie: hasta hoy, volver a hacer clic
   * sobre el mes en el que ya estabas no hacia absolutamente nada.
   *
   * Va SOLO en los dos graficos cuya barra se puede reconstruir con una lista de ventas.
   * Recaudo y 1o vs 2o pago se quedan solo con la navegacion: cuentan plata RECIBIDA en
   * el mes, que viene de ventas de cualquier mes anterior, asi que la lista de las
   * ventas de ESTE mes entregaria un conjunto distinto del que dibujo la barra. Esos dos
   * necesitan una consulta de pagos que hoy no existe.
   */
  const irAlMesOAbrirVentas = (estado: { activeLabel?: string | number } | null) => {
    const punto = puntoDeLaSerie(estado)
    if (!punto) return
    if (punto.anio !== anio || punto.mes !== mes) {
      irAlMes(punto.anio, punto.mes)
      return
    }
    // Con filtro puesto la barra ya NO es el mes entero, asi que abrir "todas las del
    // mes" contradiria la cifra en la que se hizo clic. Se abren los negocios exactos que
    // sumaron la barra — el mismo contrato de `negocioIds` que usa el corte del mes.
    const fila = filaDelMes(punto.anio, punto.mes)
    if (hayFiltro) {
      if (!fila || fila.negocio_ids.length === 0) return
      abrirVentas({
        titulo: `Ventas · ${MESES_ES[mes - 1]} ${anio}`,
        negocioIds: fila.negocio_ids,
        alcance: etiquetaFiltro,
      })
      return
    }
    // Se reusa el mismo abridor que la cifra de "ventas del mes" de arriba, no una copia:
    // asi la barra y el KPI no pueden abrir dos listas distintas con el mismo nombre.
    // Cuando es `undefined` el mes no tuvo ventas y no se abre nada — un panel vacio se
    // lee como boton roto, no como "ese mes no vendio".
    abrirTodasDelMes?.()
  }
  const propsSerieConLista = { style: { cursor: 'pointer' }, onClick: irAlMesOAbrirVentas }

  /**
   * Las dos barras de RECAUDO, con el mismo encadenado y otra lista.
   *
   * Cuentan plata recibida en el mes, que viene de ventas de cualquier mes anterior, asi
   * que la unidad de la respuesta es el cobro y no el negocio. Por eso abre `PagosDrawer`
   * y no el panel de ventas: una lista de las ventas de ESTE mes sumaria otra cosa.
   */
  const irAlMesOAbrirPagos = (estado: { activeLabel?: string | number } | null) => {
    const punto = puntoDeLaSerie(estado)
    if (!punto) return
    if (punto.anio !== anio || punto.mes !== mes) {
      irAlMes(punto.anio, punto.mes)
      return
    }
    // Con filtro puesto se abren los cobros exactos que sumaron la barra, por la misma
    // razon que en ventas: la lista no puede sumar algo distinto de la cifra.
    if (hayFiltro) {
      const fila = filaDelMes(punto.anio, punto.mes)
      if (!fila || fila.cobro_ids.length === 0) return
      setPagosDe({ anio, mes, cobroIds: fila.cobro_ids, alcance: etiquetaFiltro })
      return
    }
    // El panel se abre aunque el mes no tenga recaudo propio: puede haber entrado plata
    // que sea toda tarifa de terceros, y ese caso es precisamente el que hay que poder
    // mirar. Si no entro NADA, el panel lo dice con sus palabras.
    setPagosDe({ anio, mes })
  }
  const propsSerieConPagos = { style: { cursor: 'pointer' }, onClick: irAlMesOAbrirPagos }

  /**
   * Etiqueta del tooltip: dice que va a hacer el clic donde el dedo ya esta.
   *
   * Es el unico lugar donde la pista aparece en el momento exacto en que sirve. En tactil
   * el primer toque abre el tooltip y dispara el clic a la vez, asi que la pista se lee
   * despues de navegar — justo cuando el siguiente toque si abre la lista.
   */
  const pistaDeLaSerie = (label: unknown) => {
    const punto = serieData.find((p) => p.label === String(label))
    const esElMesEnPantalla = punto ? punto.anio === anio && punto.mes === mes : false
    if (!esElMesEnPantalla) return `${label} — clic para verlo arriba`
    if (hayFiltro) {
      const fila = punto ? filaDelMes(punto.anio, punto.mes) : null
      return fila && fila.negocio_ids.length > 0 ? `${label} — clic para ver los negocios` : String(label)
    }
    return kpis && kpis.num_ventas > 0 ? `${label} — clic para ver los negocios` : String(label)
  }

  const pistaDeRecaudo = (label: unknown) => {
    const punto = serieData.find((p) => p.label === String(label))
    const esElMesEnPantalla = punto ? punto.anio === anio && punto.mes === mes : false
    if (!esElMesEnPantalla) return `${label} — clic para verlo arriba`
    if (hayFiltro) {
      const fila = punto ? filaDelMes(punto.anio, punto.mes) : null
      return fila && fila.cobro_ids.length > 0 ? `${label} — clic para ver los pagos` : String(label)
    }
    return `${label} — clic para ver los pagos`
  }

  return (
    <div>
      {/* Encabezado interno de la pestana + accion de metas */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          El recaudo es honorario (ingreso real); la tarifa UPME se reporta aparte como plata de terceros.
        </p>
        {puedeEditarMetas && (
          <button
            onClick={() => setMetasModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Target className="h-4 w-4" /> Metas del año
          </button>
        )}
      </div>

      {/* Selector de mes */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={() => cambiarMes(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          aria-label="Mes anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[9rem] text-center text-sm font-bold text-gray-900">
          {MESES_ES[mes - 1]} {anio}
        </span>
        <button
          onClick={() => cambiarMes(1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          aria-label="Mes siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {pending && <span className="text-xs text-gray-400">Actualizando...</span>}
      </div>

      {/* Comparación automática contra el mes anterior (punto #41). Va ARRIBA de las
          cifras porque quien mira tiene que saber contra qué se está comparando ANTES
          de leer los deltas — y si el mes va a medias, saberlo antes de juzgarlos. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        {kpisPrev ? (
          <span>Comparado contra <span className="font-semibold text-gray-700">{mesPrevioLabel}</span></span>
        ) : (
          <span>Sin datos de {mesPrevioLabel}: no hay contra qué comparar.</span>
        )}
        {esMesEnCurso && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
            {MESES_ES[mes - 1]} va por el día {diaEnCurso}: la comparación es contra un mes completo
          </span>
        )}
      </div>

      {/* Panel KPIs del mes. Las cifras que representan un conjunto de casos concretos
          abren la lista; las derivadas (ticket, promedios, proyección) no, porque detrás
          de ellas no hay una lista que mostrar. */}
      {kpis && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {/* ⚠️ Tres cifras que se parecen y NO son la misma (punto #13). Cada una
              dice en su subtítulo qué está contando, porque hasta ahora el tablero
              decía "ventas" y el bono medía otra cosa con el mismo nombre. */}
          <Kpi label="Ventas del mes" value={String(kpis.num_ventas)}
               sub={kpis.meta_num_ventas
                 ? `entró dinero · meta ${kpis.meta_num_ventas} · ${pct(kpis.cumplimiento_num)}`
                 : 'entró dinero'}
               delta={delta(kpis.num_ventas, kpisPrev?.num_ventas)}
               onAbrir={kpis.num_ventas > 0 ? () => abrirVentas({
                 titulo: `Ventas · ${MESES_ES[mes - 1]} ${anio}`,
                 alcance: 'venta = entró dinero (primer pago)',
               }) : undefined} />
          <Kpi label="Valor vendido (sin IVA)" value={fmtCompact(kpis.valor_sin_iva)} color={GREEN}
               sub={kpis.meta_valor ? `meta ${fmtCompact(kpis.meta_valor)} · ${pct(kpis.cumplimiento_valor)}` : undefined}
               delta={delta(kpis.valor_sin_iva, kpisPrev?.valor_sin_iva)}
               onAbrir={kpis.num_ventas > 0 ? () => abrirVentas({
                 titulo: `Valor vendido · ${MESES_ES[mes - 1]} ${anio}`,
               }) : undefined} />
          {/* ⚠️ El segundo pago existía, se calculaba bien y no estaba en ninguna parte
              donde alguien fuera a buscarlo: en julio de 2026 entraron $850.000 (V0025 y
              V0099) y el tablero dejó leer "no hubo segundos pagos". Se muestra al lado
              del valor vendido, y en RAYA cuando el mes no tuvo ni una venta 50/50 —
              ahí un $0 no mide nada, porque no había segundo tramo que pagar. */}
          <Kpi label="2º pago" value={mesSinVentas5050 ? '—' : fmtCompact(kpis.segundo_pago)}
               color={mesSinVentas5050 ? undefined : OCRE}
               sub={mesSinVentas5050
                 ? 'ninguna venta 50/50 este mes'
                 : filaPlan1
                   ? `de ${filaPlan1.ventas} venta${filaPlan1.ventas === 1 ? '' : 's'} 50/50`
                   : 'solo las ventas 50/50 tienen segundo tramo'}
               delta={mesSinVentas5050 ? null : delta(kpis.segundo_pago, kpisPrev?.segundo_pago)}
               onAbrir={filaPlan1 && filaPlan1.ventas > 0 ? () => abrirVentas({
                 titulo: `Ventas 50/50 · ${MESES_ES[mes - 1]} ${anio}`,
                 alcance: 'las únicas que pueden tener un segundo pago',
                 negocioIds: filaPlan1.negocio_ids,
               }) : undefined} />
          <Kpi label="Ticket promedio" value={fmtCompact(kpis.ticket_promedio)}
               delta={delta(kpis.ticket_promedio, kpisPrev?.ticket_promedio)} />
          <Kpi label="Ventas bonificables" value={kpis.bonificables === null ? '—' : String(kpis.bonificables)}
               sub={kpis.bonificables === null
                 ? 'la línea no declaró desde qué etapa bonifica'
                 : `pasó el umbral del proceso · ${pct(kpis.tasa_bonificables)}${
                     kpis.bonificable_sin_medir > 0 ? ` · ${kpis.bonificable_sin_medir} sin medir` : ''}`}
               delta={kpis.bonificables === null ? null : delta(kpis.bonificables, kpisPrev?.bonificables)}
               onAbrir={kpis.bonificables ? () => abrirVentas({
                 titulo: `Ventas bonificables · ${MESES_ES[mes - 1]} ${anio}`,
                 soloBonificables: true, alcance: 'pasaron el umbral que declara la línea',
               }) : undefined} />
          <Kpi label="Honorario cubierto" value={`${kpis.casos_completos}`}
               sub={`el recaudo cubre lo aprobado · ${pct(kpis.tasa_casos_completos)}`}
               delta={delta(kpis.casos_completos, kpisPrev?.casos_completos)}
               onAbrir={kpis.casos_completos > 0 ? () => abrirVentas({
                 titulo: `Honorario cubierto · ${MESES_ES[mes - 1]} ${anio}`,
                 soloCompletos: true, alcance: 'el honorario aprobado quedó cubierto',
               }) : undefined} />
          <Kpi label="Mejor dia" value={kpis.mejor_dia ? kpis.mejor_dia.slice(8) + '/' + kpis.mejor_dia.slice(5, 7) : 'sin dato'}
               sub={kpis.mejor_dia_ventas ? `${kpis.mejor_dia_ventas} ventas` : undefined}
               onAbrir={kpis.mejor_dia ? () => abrirVentas({
                 titulo: `Ventas del ${kpis.mejor_dia!.slice(8)}/${kpis.mejor_dia!.slice(5, 7)}`,
                 dia: kpis.mejor_dia, alcance: 'el mejor día del mes',
               }) : undefined} />
          <Kpi label="Promedio ventas/dia" value={String(kpis.promedio_ventas_dia)}
               delta={delta(kpis.promedio_ventas_dia, kpisPrev?.promedio_ventas_dia)} />
          <Kpi label="Ventas proyectadas" value={String(kpis.ventas_proyectadas)} sub="run-rate del mes" />
          {/* La tasa se compara; la lista se abre por los casos, que es lo accionable. */}
          <Kpi label="Tasa cancelacion" value={pct(kpis.tasa_cancelacion)} sub={`${kpis.n_perdidos} perdidos`}
               delta={delta(kpis.tasa_cancelacion, kpisPrev?.tasa_cancelacion, { menosEsMejor: true })}
               onAbrir={kpis.n_perdidos > 0 ? () => setVerPerdidos(true) : undefined} />
        </div>
      )}

      {/* La tabla por vendedor. Es el MANDO del tablero y por eso va arriba del todo:
          el nombre lleva al perfil de la persona y la fila recorta todo lo que sigue.
          Debajo de las graficas —donde vivia— el filtro quedaba fuera de la vista de
          quien ya habia bajado a mirarlas, que es justo cuando se quiere usar. */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold text-gray-900">
          Por vendedor · {MESES_ES[mes - 1]} {anio}
        </h2>
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 text-left">Vendedor</th>
                  <th className="px-4 py-3 text-right">Ventas</th>
                  <th className="px-4 py-3 text-right">Valor (sin IVA)</th>
                  <th className="hidden px-4 py-3 text-right md:table-cell">Valor (con IVA)</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">1er pago</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">2o pago</th>
                  <th className="px-4 py-3 text-right" title="Ventas que pasaron el umbral del proceso: es la cifra que bonifica">Bonificables</th>
                  <th className="hidden px-4 py-3 text-right md:table-cell" title="Ventas cuyo honorario aprobado ya quedó cubierto por el recaudo">Hon. cubierto</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Particip.</th>
                </tr>
              </thead>
              <tbody>
                {vendedoresMes.map((v) => (
                  <FilaVendedor
                    key={v.responsable_id ?? 'sin'}
                    v={v}
                    seleccionado={esteVendedorFiltra(v)}
                    onElegir={() => elegirVendedor({
                      id: v.responsable_id,
                      nombre: v.sin_responsable ? 'Sin responsable' : nombreCorto(v.nombre),
                      sinResponsable: v.sin_responsable,
                    })}
                    onAbrir={(alcanceCelda) => setCifra({
                      anio, mes,
                      titulo: `${TITULO_CELDA[alcanceCelda]} · ${MESES_ES[mes - 1]} ${anio}`,
                      responsableId: v.responsable_id,
                      sinResponsable: v.sin_responsable,
                      soloCompletos: alcanceCelda === 'completos' ? true : null,
                      soloBonificables: alcanceCelda === 'bonificables' ? true : null,
                      alcance: v.sin_responsable ? 'sin comercial atribuido' : nombreCorto(v.nombre),
                    })}
                  />
                ))}
                {lideresMes.length > 0 && (
                  <tr className="border-b border-gray-50 bg-gray-50/40">
                    <td colSpan={9} className="px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      Lideres · fuera de la comparacion
                    </td>
                  </tr>
                )}
                {lideresMes.map((v) => (
                  <FilaVendedor
                    key={v.responsable_id ?? 'sin-lider'}
                    v={v}
                    seleccionado={esteVendedorFiltra(v)}
                    onElegir={() => elegirVendedor({
                      id: v.responsable_id,
                      nombre: v.sin_responsable ? 'Sin responsable' : nombreCorto(v.nombre),
                      sinResponsable: v.sin_responsable,
                    })}
                    onAbrir={(alcanceCelda) => setCifra({
                      anio, mes,
                      titulo: `${TITULO_CELDA[alcanceCelda]} · ${MESES_ES[mes - 1]} ${anio}`,
                      responsableId: v.responsable_id,
                      sinResponsable: v.sin_responsable,
                      soloCompletos: alcanceCelda === 'completos' ? true : null,
                      soloBonificables: alcanceCelda === 'bonificables' ? true : null,
                      alcance: v.sin_responsable ? 'sin comercial atribuido' : nombreCorto(v.nombre),
                    })}
                  />
                ))}
                {porVendedor.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">
                      Sin ventas registradas este mes.
                    </td>
                  </tr>
                )}
              </tbody>
              {kpis && porVendedor.length > 0 && (
                                <tfoot>
                  {/* La fila de totales abre las ventas del mes entero, sin filtrar por
                      vendedor: es exactamente el conjunto que suma. Y con un filtro puesto
                      es tambien la salida — TOTAL es, literalmente, "todos". */}
                  <tr
                    className={`border-t border-gray-100 bg-gray-50/40 font-bold text-gray-900 ${
                      hayFiltroVendedor ? 'cursor-pointer hover:bg-gray-100' : ''
                    }`}
                    onClick={hayFiltroVendedor ? () => elegirVendedor(null) : undefined}
                    title={hayFiltroVendedor ? 'Clic para volver a todo el equipo' : undefined}
                  >
                    <td className="px-4 py-3">TOTAL</td>
                    <CeldaAbrible className="px-4 py-3 text-right tabular-nums"
                      onAbrir={abrirTodasDelMes} title="Ver todas las ventas del mes">
                      {kpis.num_ventas}
                    </CeldaAbrible>
                    <CeldaAbrible className="px-4 py-3 text-right tabular-nums" style={{ color: GREEN }}
                      onAbrir={abrirTodasDelMes} title="Ver todas las ventas del mes">
                      {fmtCOP(kpis.valor_sin_iva)}
                    </CeldaAbrible>
                    <CeldaAbrible className="hidden px-4 py-3 text-right tabular-nums md:table-cell"
                      onAbrir={abrirTodasDelMes} title="Ver todas las ventas del mes">
                      {fmtCOP(kpis.valor_con_iva)}
                    </CeldaAbrible>
                    <CeldaAbrible className="hidden px-4 py-3 text-right tabular-nums sm:table-cell"
                      onAbrir={abrirTodasDelMes} title="Ver todas las ventas del mes">
                      {fmtCOP(kpis.primer_pago)}
                    </CeldaAbrible>
                    <CeldaAbrible className="hidden px-4 py-3 text-right tabular-nums sm:table-cell"
                      onAbrir={abrirTodasDelMes} title="Ver todas las ventas del mes">
                      {fmtCOP(kpis.segundo_pago)}
                    </CeldaAbrible>
                    <CeldaAbrible className="px-4 py-3 text-right tabular-nums"
                      onAbrir={abrirBonificablesDelMes} title="Ver las ventas que pasaron el umbral del proceso">
                      {kpis.bonificables === null ? <span className="text-gray-300">—</span> : kpis.bonificables}
                    </CeldaAbrible>
                    <CeldaAbrible className="hidden px-4 py-3 text-right tabular-nums md:table-cell"
                      onAbrir={abrirCompletosDelMes} title="Ver los casos con el honorario cubierto">
                      {kpis.casos_completos}
                    </CeldaAbrible>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">100%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </section>

      {/* Que el tablero esta recortado se dice UNA vez, aqui, y no en cada seccion: es
          el sitio por donde se pasa al bajar desde la tabla que puso el filtro. Lo que
          NO se recorta se declara en la misma frase — una seccion que se queda entera
          sin avisar es exactamente como el tablero deja de creerse. */}
      {hayFiltroVendedor && (
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
          <span className="text-sm text-emerald-900">
            Todo lo que sigue es solo de <span className="font-bold">{filtroVendedor.nombre}</span>.
          </span>
          <span className="text-[11px] text-emerald-800/80">
            El panel de cifras de arriba y «Capacidad por seccional» siguen siendo de toda la linea.
          </span>
          <button
            type="button"
            onClick={() => elegirVendedor(null)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            <X className="h-3.5 w-3.5" /> Ver todo el equipo
          </button>
        </div>
      )}

      {/* De dónde vinieron las ventas (punto #23). El origen decide la comisión. */}
      {origen && origen.total > 0 && (
        <SeccionOrigen
          origen={origen}
          mesLabel={`${MESES_ES[mes - 1]} ${anio}`}
          onAbrirCampana={(campana, etiqueta) => abrirVentas({
            titulo: `Ventas · ${etiqueta}`,
            campana,
            alcance: `${MESES_ES[mes - 1]} ${anio}`,
          })}
        />
      )}

      {/* El mes abierto por seccional DIAN (punto #22). Mauricio: seccional tal cual,
          sin agrupar en regiones. */}
      {seccional && seccional.total_ventas > 0 && (
        <SeccionSeccional
          datos={seccional}
          mesLabel={`${MESES_ES[mes - 1]} ${anio}`}
          onAbrir={(f) => abrirVentas({
            titulo: `Ventas · ${f.seccional ?? 'Sin seccional registrada'}`,
            alcance: `${MESES_ES[mes - 1]} ${anio}`,
            // El conjunto EXACTO que sumó la fila: la lista no puede discrepar.
            negocioIds: f.negocio_ids,
          })}
        />
      )}

      {/* El mes abierto por plan de pago. Es lo que da sentido a la casilla "2o pago":
          en plan 2 vale cero PORQUE no existe el tramo, no porque nadie haya pagado. */}
      {planPago && planPago.total_ventas > 0 && (
        <SeccionPlanPago
          datos={planPago}
          mesLabel={`${MESES_ES[mes - 1]} ${anio}`}
          onAbrir={(f) => abrirVentas({
            titulo: `Ventas · ${planPagoLabel(f.plan_pago)}`,
            alcance: `${MESES_ES[mes - 1]} ${anio}`,
            // El conjunto EXACTO que sumó la fila: la lista no puede discrepar.
            negocioIds: f.negocio_ids,
          })}
        />
      )}

      {/* Capacidad por seccional (punto #43). No depende del mes elegido: es una
          ventana propia, porque la pregunta es "cuánto cabe", no "cuánto se vendió". */}
      {capacidad && <SeccionCapacidad cap={capacidad} sinRecorte={hayFiltroVendedor} />}

      {/* Ventas por dia del mes (Daniela: "diariamente cuantas ventas llevamos") */}
      {ventasPorDia.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold text-gray-900">
            Ventas por dia · {MESES_ES[mes - 1]} {anio}
          </h2>
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <ResponsiveContainer width="100%" height={200}>
              {/* Cada barra abre las ventas de ese día. El cursor cambia sobre el área
                  del gráfico porque recharts no expone la barra individual como botón. */}
              <BarChart
                data={ventasPorDia}
                margin={{ left: -20, right: 12, top: 8 }}
                style={{ cursor: 'pointer' }}
                onClick={(estado) => {
                  const dia = (estado?.activeLabel ?? null) as string | null
                  if (!dia) return
                  abrirVentas({
                    titulo: `Ventas del ${dia.slice(8)}/${dia.slice(5, 7)}`,
                    dia,
                    alcance: `${MESES_ES[mes - 1]} ${anio}`,
                  })
                }}
              >
                <CartesianGrid vertical={false} stroke="#F3F4F6" />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(d: string) => d.slice(8)}
                />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip formatter={(v) => [`${v}`, 'Ventas']} labelFormatter={(l) => `Dia ${String(l).slice(8)} — clic para ver los casos`} />
                <Bar dataKey="ventas" fill={GREEN} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Series historicas */}
      {serieData.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900">
                Historico mensual{hayFiltro ? ` · ${etiquetaFiltro}` : ''}
              </h2>
              <p className="text-[11px] text-gray-400">
                Clic en un mes para verlo en detalle arriba; un segundo clic sobre ese mes abre
                lo que hay detras — los negocios en «Ventas» y «Valor de negocio», los pagos en
                los dos de recaudo.
              </p>
            </div>
            {/* La tasa de recaudo global es de TODA la linea. Con una seccional elegida
                seguiria diciendo el mismo numero al lado de unas barras que ya no son
                las suyas, asi que se retira en vez de repetirse fuera de contexto. */}
            {!hayFiltro && serie?.tasa_recaudo_global !== null && serie?.tasa_recaudo_global !== undefined && (
              <span className="text-xs text-gray-500">
                Tasa de recaudo global: <span className="font-semibold text-gray-700">{serie.tasa_recaudo_global}%</span>
              </span>
            )}
          </div>
          {/* Filtro por seccional. Va en fichas y no en un <select> porque en el celular
              —de donde viene la mayor parte del uso— un desplegable nativo tapa el
              grafico entero mientras se elige, y aqui la gracia es ver como cambia.
              Cada ficha pasa los 44px de alto tactil con el padding vertical. */}
          {opcionesSeccional.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <FichaSeccional
                activa={!hayFiltroSeccional}
                onClick={() => elegirSeccional(undefined)}
                label="Todas"
              />
              {opcionesSeccional.map((o) => (
                <FichaSeccional
                  key={o.clave ?? '__sin__'}
                  activa={hayFiltroSeccional && filtroSeccional === o.clave}
                  onClick={() => elegirSeccional(o.clave)}
                  label={o.clave ?? 'Sin registrar'}
                  ventas={o.ventas}
                  atenuada={o.clave === null}
                />
              ))}
            </div>
          )}
          {hayFiltro && (
            <p className="mb-3 text-[11px] text-gray-500">
              Solo {etiquetaFiltro}. Los meses sin movimiento {hayFiltroVendedor ? 'de esta persona' : 'de esta seccional'} se
              dibujan en cero, no se saltan.
            </p>
          )}
          {hayFiltroVendedor && !serieVendedor && (
            <p className="mb-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              No se pudo traer el historico abierto por vendedor: estas cuatro graficas siguen
              siendo las de toda la linea, no las de {etiquetaFiltro}.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Ventas por mes">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={serieData} margin={{ left: -10, right: 12, top: 8 }} {...propsSerieConLista}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip formatter={(v) => [`${v}`, 'Ventas']} labelFormatter={pistaDeLaSerie} />
                  <Line type="monotone" dataKey="num_ventas" stroke={GREEN} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Valor de negocio por mes (sin IVA)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serieData} margin={{ left: -4, right: 12, top: 8 }} {...propsSerieConLista}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
                  <Tooltip formatter={(v) => [fmtCOP(Number(v)), 'Valor sin IVA']} labelFormatter={pistaDeLaSerie} />
                  <Bar dataKey="valor_sin_iva" fill={GREEN} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Recaudo por mes (honorario sin IVA)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serieData} margin={{ left: -4, right: 12, top: 8 }} {...propsSerieConPagos}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
                  <Tooltip formatter={(v) => [fmtCOP(Number(v)), 'Recaudo']} labelFormatter={pistaDeRecaudo} />
                  <Bar dataKey="honorario_recaudado" fill={BLUE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            {/* ⚠️ Apilado y en gris, el segundo pago era invisible: $850.000 encima de
                $25,9M en 220px de alto son unos seis pixeles pegados al borde de la
                barra verde. Ahora va en barra APARTE, en ocre, y con su cifra escrita
                encima en los meses en que hubo alguno — una barra de seis pixeles con
                su numero al lado si se puede leer; cambiar la escala para agrandarla
                mentiria sobre la proporcion, que es real. */}
            <ChartCard title="Primer vs segundo pago por mes">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serieData} margin={{ left: -4, right: 12, top: 18 }} {...propsSerieConPagos}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
                  <Tooltip
                    formatter={(v, name) => [fmtCOP(Number(v)), name === 'primer_pago' ? '1er pago' : '2o pago']}
                    labelFormatter={pistaDeRecaudo}
                  />
                  <Bar dataKey="primer_pago" fill={GREEN} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="segundo_pago" fill={OCRE} radius={[4, 4, 0, 0]}>
                    {/* Solo donde hubo: una fila de ceros escritos sobre cada mes seria
                        ruido, y ademas afirmaria "cero" en meses sin ventas 50/50, donde
                        no habia segundo tramo que pagar. */}
                    <LabelList
                      dataKey="segundo_pago"
                      position="top"
                      formatter={(v: unknown) => (Number(v) > 0 ? fmtCompact(Number(v)) : '')}
                      style={{ fontSize: 10, fill: OCRE, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-1 text-[11px] text-gray-500">
                Solo las ventas 50/50 tienen segundo pago; en las de 100% anticipado no hay
                segundo tramo que cobrar.
              </p>
            </ChartCard>
          </div>
        </section>
      )}

      {/* Totales historicos de toda la linea. El desglose por persona ya no vive
          aqui: la tabla de arriba lo dice del mes, y el nombre abre el perfil, que
          es donde estaba el embudo por etapas con TODO su historico. */}
      <section>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ResumenTotal label="Valor aprobado historico (sin IVA)" value={fmtCOP(totalAprobado)} />
          <ResumenTotal label="Honorario recaudado (sin IVA)" value={fmtCOP(totalHonorario)} color={GREEN} />
          <ResumenTotal label="Tarifa UPME (terceros)" value={fmtCOP(totalTarifa)} muted />
        </div>
      </section>

      {/* `key` por cifra: al pasar de una celda a otra el panel se remonta y arranca
          cargando, en vez de mostrar por un instante la lista de la cifra anterior. */}
      {cifra && (
        <VentasDrawer
          key={`${cifra.anio}-${cifra.mes}-${cifra.responsableId ?? 'todos'}-${cifra.sinResponsable ? 'sr' : ''}-${String(cifra.soloCompletos)}-${cifra.dia ?? ''}-${cifra.campana ?? 'todas'}`}
          cifra={cifra}
          onClose={() => setCifra(null)}
        />
      )}

      {pagosDe && (
        <PagosDrawer
          key={`pagos-${pagosDe.anio}-${pagosDe.mes}`}
          periodo={pagosDe}
          onClose={() => setPagosDe(null)}
        />
      )}

      {verPerdidos && (
        <PerdidosDrawer
          key={`perdidos-${anio}-${mes}`}
          anio={anio}
          mes={mes}
          titulo={`Casos perdidos · ${MESES_ES[mes - 1]} ${anio}`}
          onClose={() => setVerPerdidos(false)}
        />
      )}

      {/* Metas del AÑO: carga sus propias cifras por año y alcance. El modal
          anterior recibía el mes desde el estado de esta pantalla y las cifras
          desde el servidor, cargadas solo para el mes en curso: al navegar de
          mes, guardaba las metas de un mes encima de otro. */}
      {metasModalOpen && (
        <MetasAnioModal
          anioInicial={anio}
          equipo={equipo}
          onClose={() => setMetasModalOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * Una celda de la tabla que abre los casos que hay detrás.
 *
 * Cualquier cifra que represente el MISMO conjunto de casos de la fila abre la
 * misma lista: el valor, el primer pago y la participación son cortes de dinero
 * sobre las mismas ventas, así que ofrecerlas como no clicables obligaba a bajar a
 * buscar la columna de "Ventas" para ver de qué estaban hechas.
 */
function CeldaAbrible({ children, onAbrir, title, className, style }: {
  children: React.ReactNode
  onAbrir?: () => void
  title: string
  className?: string
  style?: React.CSSProperties
}) {
  if (!onAbrir) return <td className={className} style={style}>{children}</td>
  return (
    <td className={className} style={style}>
      <button
        type="button"
        onClick={onAbrir}
        className="underline decoration-dotted underline-offset-4 hover:text-[#059669]"
        title={title}
      >
        {children}
      </button>
    </td>
  )
}

/** Qué subconjunto de las ventas de un vendedor abre la celda en la que se hizo clic. */
export type AlcanceCelda = 'todas' | 'completos' | 'bonificables'

/** Fila de la tabla por vendedor. Compartida por la lista de ejecutores y la de lideres. */
/**
 * Una fila de la tabla por vendedor. Hace TRES cosas distintas y cada una en su sitio.
 *
 * - El NOMBRE lleva al perfil de la persona. Es donde vive su embudo por etapas y todo
 *   su historico, que es justo lo que dejo de estar en esta pestaña.
 * - Las cifras subrayadas abren la lista de casos que hay detras de ese numero.
 * - El RESTO de la fila recorta el tablero entero a esa persona.
 *
 * Las dos primeras cortan la propagacion: sin eso, abrir la lista de alguien ademas
 * recortaria el tablero a esa persona, y son dos intenciones distintas sobre el mismo
 * pixel. Las columnas de dinero, que antes abrian la MISMA lista que «Ventas», ya no son
 * clicables — no perdieron nada y a cambio le devuelven a la fila el area que necesita
 * para ser un boton de verdad, sobre todo con el dedo.
 */
function FilaVendedor({ v, seleccionado, onElegir, onAbrir }: {
  v: ComercialVendedorMes
  /** Esta fila es la que esta recortando el tablero. */
  seleccionado: boolean
  /** Pone (o suelta) el recorte por esta persona. */
  onElegir: () => void
  /** Abre los casos de este vendedor, con el subconjunto de la celda. */
  onAbrir: (alcance: AlcanceCelda) => void
}) {
  const abrirTodas = v.num_ventas > 0 ? () => onAbrir('todas') : undefined
  const detener = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation()
  const etiqueta = v.sin_responsable ? 'Sin responsable' : nombreCorto(v.nombre)
  // El perfil del bucket sin responsable existe: la ruta entiende ese literal y la RPC lo
  // traduce a "los negocios que no tienen comercial atribuido".
  const perfil = `/equipo/comercial/${v.sin_responsable ? 'sin-responsable' : v.responsable_id}`
  return (
    <tr
      role="button"
      tabIndex={0}
      aria-pressed={seleccionado}
      onClick={onElegir}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onElegir() } }}
      title={seleccionado ? 'Clic para dejar de filtrar por esta persona' : `Clic para ver todo el tablero solo de ${etiqueta}`}
      className={`cursor-pointer border-b border-gray-50 transition ${
        seleccionado ? 'bg-emerald-50/70 hover:bg-emerald-50' : 'hover:bg-gray-50/50'
      }`}
    >
      <td className="px-4 py-3">
        <span className="flex items-center gap-2">
          {/* La barrita verde es lo unico que distingue la fila elegida cuando la tabla
              se lee en una pantalla angosta y el fondo casi no se ve. */}
          <span className={`h-4 w-1 rounded-full ${seleccionado ? 'bg-[#059669]' : 'bg-transparent'}`} />
          <Link
            href={perfil}
            onClick={detener}
            onKeyDown={detener}
            className="font-medium text-gray-900 underline decoration-dotted underline-offset-4 hover:text-[#059669]"
            title={`Ver el perfil de ${etiqueta}`}
          >
            {etiqueta}
          </Link>
        </span>
      </td>
      <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
        {abrirTodas ? (
          <button
            type="button"
            onClick={(e) => { detener(e); abrirTodas() }}
            className="underline decoration-dotted underline-offset-4 hover:text-[#059669]"
            title="Ver estas ventas"
          >
            {v.num_ventas}
          </button>
        ) : (
          v.num_ventas
        )}
        {v.meta_num_ventas ? <span className="ml-1 text-[10px] text-gray-400">/{v.meta_num_ventas}</span> : null}
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums" style={{ color: GREEN }}>
        {fmtCOP(v.valor_sin_iva)}
      </td>
      <td className="hidden px-4 py-3 text-right text-gray-500 tabular-nums md:table-cell">
        {fmtCOP(v.valor_con_iva)}
      </td>
      <td className="hidden px-4 py-3 text-right text-gray-600 tabular-nums sm:table-cell">
        {fmtCOP(v.primer_pago)}
      </td>
      <td className="hidden px-4 py-3 text-right text-gray-600 tabular-nums sm:table-cell">
        {fmtCOP(v.segundo_pago)}
      </td>
      {/* Bonificables: la columna que decide el bono (#13/#31). Raya cuando la línea no
          declaró umbral — un 0 diría "no completó ninguna", que es una afirmación que
          nadie midió. */}
      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
        {v.bonificables === null ? (
          <span className="text-gray-300" title="La línea de estos negocios no declaró desde qué etapa una venta bonifica: no se pudo medir">—</span>
        ) : v.bonificables > 0 ? (
          <button
            type="button"
            onClick={(e) => { detener(e); onAbrir('bonificables') }}
            className="underline decoration-dotted underline-offset-4 hover:text-[#059669]"
            title="Ver las ventas que pasaron el umbral del proceso"
          >
            {v.bonificables}
          </button>
        ) : (
          v.bonificables
        )}
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-gray-700 md:table-cell">
        {v.casos_completos > 0 ? (
          <button
            type="button"
            onClick={(e) => { detener(e); onAbrir('completos') }}
            className="underline decoration-dotted underline-offset-4 hover:text-[#059669]"
            title="Ver los casos con el honorario cubierto"
          >
            {v.casos_completos}
          </button>
        ) : (
          v.casos_completos
        )}
        <span className="ml-1 text-[10px] text-gray-400">{pct(v.tasa_casos_completos)}</span>
      </td>
      <td className="hidden px-4 py-3 text-right tabular-nums text-gray-600 sm:table-cell">
        {pct(v.participacion_pct)}
      </td>
    </tr>
  )
}

function Kpi({ label, value, sub, color, delta: variacion, onAbrir }: {
  label: string
  value: string
  sub?: string
  color?: string
  delta?: { texto: string; bueno: boolean | null } | null
  onAbrir?: () => void
}) {
  const contenido = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-gray-900" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
      {/* Sin comparable no se pinta nada: una raya o un 0% se leerían como "no cambió". */}
      {variacion && (
        <p
          className="mt-0.5 text-[11px] font-medium"
          style={{ color: variacion.bueno === null ? '#9CA3AF' : variacion.bueno ? GREEN : '#B91C1C' }}
        >
          {variacion.texto}
        </p>
      )}
    </>
  )
  // Sin `onAbrir` queda como estaba: una tarjeta, no un botón. Pintar como clicable algo
  // que no abre nada es peor que no ofrecerlo.
  if (!onAbrir) {
    return <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">{contenido}</div>
  }
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-gray-200 hover:bg-gray-50/60 focus:outline-none focus:ring-2 focus:ring-[#10B981]/20"
      title="Ver los casos detrás de esta cifra"
    >
      {contenido}
    </button>
  )
}

/**
 * De dónde vinieron las ventas del mes (punto #23).
 *
 * Dos lecturas que NO se mezclan: lo que alguien DECLARÓ al crear el negocio, y el
 * RASTRO verificable de Meta con su campaña. Cuando no coinciden se marca, porque
 * de eso depende si la comisión se liquida como marketing o como directo — y esa
 * decisión es de una persona, no del tablero.
 */
function SeccionOrigen({ origen, mesLabel, onAbrirCampana }: {
  origen: ComercialOrigenMes
  mesLabel: string
  onAbrirCampana: (campana: string | null, etiqueta: string) => void
}) {
  const sinRastro = origen.sin_rastro
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900">Origen del lead · {mesLabel}</h2>
        <p className="text-xs text-gray-500">
          {origen.con_rastro_meta} de {origen.total} con rastro de Meta
          {origen.meta_sin_campana > 0 && ` · ${origen.meta_sin_campana} sin campaña atribuida`}
        </p>
      </div>

      {/* ⚠️ Dos avisos separados a propósito (punto #46). El de abajo es un desacuerdo
          de atribución interna; el de arriba es plata que sale hacia un tercero, y
          mientras esté ahí la comisión NO se liquida. Mezclarlos en un solo contador
          ámbar haría que el caso grave se leyera con el mismo peso que el leve. */}
      {origen.comision_retenida > 0 && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          <strong>Comisión retenida en {origen.comision_retenida}</strong>{' '}
          {origen.comision_retenida === 1 ? 'venta' : 'ventas'} por {fmtCOP(origen.comision_retenida_valor)} sin
          IVA: se declararon como <strong>promotor</strong> (20% a un tercero) y el lead entró
          por Meta (16% de marketing). No se liquida hasta que alguien decida cuál de los dos
          orígenes vale — el sistema no elige. Aparecen marcadas al abrir cualquier cifra.
        </p>
      )}

      {origen.en_conflicto > origen.comision_retenida && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>{origen.en_conflicto - origen.comision_retenida}</strong>{' '}
          {origen.en_conflicto - origen.comision_retenida === 1 ? 'venta más tiene' : 'ventas más tienen'} el
          origen declarado en desacuerdo con el rastro, sin que ningún tercero cobre por ellas
          (declaradas Meta sin rastro, o con rastro y declaradas de otra forma). No frenan
          ninguna liquidación, pero ensucian la atribución por campaña.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <p className="border-b border-gray-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-400">
            Por origen declarado
          </p>
          <table className="w-full text-sm">
            <tbody>
              {origen.por_origen.map((o) => (
                <tr key={o.origen ?? 'sin-declarar'} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2">
                    <span className={o.origen ? 'text-gray-900' : 'italic text-gray-400'}>
                      {origenNegocioLabel(o.origen) ?? 'Sin declarar'}
                    </span>
                    {/* Lo declarado no se respalda solo: se dice cuánto de eso tiene rastro. */}
                    {o.con_rastro_meta > 0 && (
                      <span className="ml-1.5 text-[10px] text-gray-400">
                        {o.con_rastro_meta} con rastro
                      </span>
                    )}
                    {o.comision_retenida > 0 && (
                      <span
                        className="ml-1.5 rounded bg-red-50 px-1 py-0.5 text-[10px] font-semibold text-red-700"
                        title="Un tercero cobraría por un lead que entró por Meta: la comisión de estos casos está retenida"
                      >
                        {o.comision_retenida} retenida{o.comision_retenida === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">{o.ventas}</td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: GREEN }}>
                    {fmtCompact(o.valor_sin_iva)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <p className="border-b border-gray-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-400">
            Por campaña de Meta
          </p>
          {origen.por_campana.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-gray-400">
              Ninguna venta de este mes tiene rastro de Meta.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {origen.por_campana.map((c) => (
                  <tr key={c.campana ?? 'sin-campana'} className="border-b border-gray-50 last:border-0">
                    <td className="max-w-0 px-4 py-2">
                      <button
                        type="button"
                        onClick={() => onAbrirCampana(
                          c.campana ?? '',
                          c.campana ?? 'Meta sin campaña atribuida',
                        )}
                        className="block w-full truncate text-left underline decoration-dotted underline-offset-4 hover:text-[#059669]"
                        title={c.campana ?? 'Vinieron de Meta y la interacción no trae campaña'}
                      >
                        <span className={c.campana ? 'text-gray-900' : 'italic text-amber-800'}>
                          {c.campana ?? 'Sin campaña atribuida'}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">{c.ventas}</td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ color: GREEN }}>
                      {fmtCompact(c.valor_sin_iva)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* La cobertura se declara con palabras, no se deja implícita en la resta. */}
      {sinRastro > 0 && (
        <p className="mt-2 text-[11px] text-gray-400">
          Las otras {sinRastro} {sinRastro === 1 ? 'venta no dejó' : 'ventas no dejaron'} rastro
          de Meta. Eso no dice que no hayan venido de Meta: dice que no hay con qué
          atribuirlas, así que quedan fuera del cálculo por campaña en vez de contarse
          como directas.
        </p>
      )}
    </section>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">{title}</p>
      {children}
    </div>
  )
}

function ResumenTotal({ label, value, color, muted }: { label: string; value: string; color?: string; muted?: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-xl tabular-nums ${muted ? 'font-semibold text-gray-500' : 'font-bold text-gray-900'}`} style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  )
}

/**
 * El mes abierto por SECCIONAL DIAN (punto #22).
 *
 * Mauricio cerró el 2026-08-22 que el corte es por seccional tal cual, sin agrupar en
 * regiones: cero traducción sobre el catálogo canónico que ONE ya escribe.
 *
 * ⚠️ El bucket "sin registrar" va ABAJO, visible y con su propia explicación. Medido
 * el 2026-08-22: 96 de 289 negocios de la línea no tienen seccional, y en las ventas
 * de agosto ese bucket es el MÁS GRANDE (16 de 38). Repartirlo a prorrata inventaría
 * una distribución que nadie midió; esconderlo dejaría las columnas sin sumar el total
 * sin decir por qué.
 */
function SeccionSeccional({ datos, mesLabel, onAbrir }: {
  datos: ComercialSeccionalMes
  mesLabel: string
  onAbrir: (fila: ComercialSeccionalFila) => void
}) {
  const conSeccional = datos.filas.filter((f) => f.seccional !== null)
  const sinRegistrar = datos.filas.find((f) => f.seccional === null) ?? null
  const cubiertas = conSeccional.reduce((s, f) => s + f.ventas, 0)

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900">Por seccional DIAN · {mesLabel}</h2>
        <p className="text-xs text-gray-500">
          {cubiertas} de {datos.total_ventas} ventas con seccional registrada
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 text-left">Seccional</th>
                <th className="px-4 py-3 text-right">Cierres</th>
                <th className="px-4 py-3 text-right">1er pago</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell">2o pago</th>
                <th className="px-4 py-3 text-right">Venta total</th>
                <th className="hidden px-4 py-3 text-right md:table-cell">Bonificables</th>
              </tr>
            </thead>
            <tbody>
              {conSeccional.map((f) => (
                <FilaSeccional key={f.seccional} f={f} onAbrir={onAbrir} />
              ))}
              {sinRegistrar && (
                <>
                  <tr className="border-b border-gray-50 bg-amber-50/40">
                    <td colSpan={6} className="px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                      Sin seccional registrada · no se reparte entre las de arriba
                    </td>
                  </tr>
                  <FilaSeccional f={sinRegistrar} onAbrir={onAbrir} />
                </>
              )}
              {datos.filas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                    Sin ventas este mes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {sinRegistrar && (
        <p className="mt-2 text-[11px] text-gray-500">
          La seccional sale de la casilla 12 del RUT. {sinRegistrar.ventas} de{' '}
          {datos.total_ventas} ventas de este mes no la tienen: no significa que sean de
          otra ciudad, significa que el dato no está.
        </p>
      )}
    </section>
  )
}

/**
 * Una ficha del filtro por seccional del historico.
 *
 * `atenuada` es para "Sin registrar": se ve distinta de una seccional real porque no lo
 * es —es la ausencia del dato— pero sigue siendo elegible, que es justo lo que permite
 * ir a ver cuales son y arreglarlos.
 */
function FichaSeccional({ activa, onClick, label, ventas, atenuada }: {
  activa: boolean
  onClick: () => void
  label: string
  ventas?: number
  atenuada?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`rounded-full border px-3 py-2 text-[11px] leading-none transition-colors ${
        activa
          ? 'border-gray-900 bg-gray-900 font-semibold text-white'
          : atenuada
            ? 'border-gray-200 bg-white italic text-gray-400 hover:border-gray-300'
            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
      }`}
    >
      {label}
      {ventas !== undefined && <span className="ml-1 opacity-60">{ventas}</span>}
    </button>
  )
}

function FilaSeccional({ f, onAbrir }: {
  f: ComercialSeccionalFila
  onAbrir: (fila: ComercialSeccionalFila) => void
}) {
  const abrir = f.ventas > 0 ? () => onAbrir(f) : undefined
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
      <td className="px-4 py-3">
        <span className={f.seccional ? 'font-medium text-gray-900' : 'italic text-gray-400'}>
          {f.seccional ?? 'Sin registrar'}
        </span>
      </td>
      <CeldaAbrible className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900"
        onAbrir={abrir} title="Ver estos casos">
        {f.ventas}
      </CeldaAbrible>
      <CeldaAbrible className="px-4 py-3 text-right tabular-nums text-gray-600"
        onAbrir={abrir} title="Ver los casos de los que salió este recaudo">
        {fmtCOP(f.primer_pago)}
      </CeldaAbrible>
      <CeldaAbrible className="hidden px-4 py-3 text-right tabular-nums text-gray-600 sm:table-cell"
        onAbrir={abrir} title="Ver los casos de los que salió este recaudo">
        {fmtCOP(f.segundo_pago)}
      </CeldaAbrible>
      <CeldaAbrible className="px-4 py-3 text-right font-semibold tabular-nums"
        style={{ color: GREEN }} onAbrir={abrir} title="Ver los casos que suman este valor">
        {fmtCOP(f.valor_sin_iva)}
      </CeldaAbrible>
      <td className="hidden px-4 py-3 text-right tabular-nums text-gray-700 md:table-cell">
        {f.bonificables === null
          ? <span className="text-gray-300" title="La línea no declaró desde qué etapa una venta bonifica">—</span>
          : f.bonificables}
      </td>
    </tr>
  )
}

/**
 * El mes cortado por plan de pago.
 *
 * Existe porque la casilla "2o pago" del tablero no se puede leer sin saber el plan:
 *
 *   Plan 1 (50/50)             tiene segundo tramo. Un $0 ahí significa "no ha pagado".
 *   Plan 2 (100% anticipado)   NO tiene segundo tramo. Un $0 ahí no mide nada.
 *   Sin plan declarado         no se sabe si lo tiene. Un $0 ahí miente dos veces.
 *
 * Por eso la columna va en RAYA fuera del plan 1, y el grupo sin declarar va aparte y
 * nunca plegado a plan 2 — que es lo que `v_negocio_valor` hacía en silencio a través
 * de un `else`, dejando a esos negocios sin posibilidad de tener un segundo pago aunque
 * el dinero entrara.
 *
 * Medido el 2026-08-22 sobre las 93 ventas históricas de la línea: 8 son plan 1, 77 son
 * plan 2 y 8 no tienen plan declarado. De las 8 de plan 1 solo dos han pagado su segundo
 * 50%: V0025 y V0099, $425.000 cada una.
 */
function SeccionPlanPago({ datos, mesLabel, onAbrir }: {
  datos: ComercialPlanPagoMes
  mesLabel: string
  onAbrir: (fila: ComercialPlanPagoFila) => void
}) {
  const sinDeclarar = datos.filas.find((f) => f.plan_pago === null) ?? null
  const declarados = datos.filas.filter((f) => f.plan_pago !== null)
  const conPlan = declarados.reduce((s, f) => s + f.ventas, 0)

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900">Por plan de pago · {mesLabel}</h2>
        <p className="text-xs text-gray-500">
          {conPlan} de {datos.total_ventas} ventas con plan declarado
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 text-left">Plan</th>
                <th className="px-4 py-3 text-right">Cierres</th>
                <th className="px-4 py-3 text-right">1er pago</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell" title="Solo el plan 1 tiene segundo tramo; en los demás no hay nada que medir">
                  2o pago
                </th>
                <th className="px-4 py-3 text-right">Venta total</th>
                <th className="hidden px-4 py-3 text-right md:table-cell">Hon. cubierto</th>
              </tr>
            </thead>
            <tbody>
              {declarados.map((f) => (
                <FilaPlanPago key={f.plan_pago} f={f} onAbrir={onAbrir} />
              ))}
              {sinDeclarar && (
                <>
                  <tr className="border-b border-gray-50 bg-amber-50/40">
                    <td colSpan={6} className="px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                      Sin plan declarado · no se cuenta como 100% anticipado
                    </td>
                  </tr>
                  <FilaPlanPago f={sinDeclarar} onAbrir={onAbrir} />
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-gray-500">
        El plan se declara al aprobar la propuesta económica.{' '}
        {sinDeclarar
          ? `${sinDeclarar.ventas} de ${datos.total_ventas} ventas de este mes no lo tienen: hasta que alguien lo declare no se sabe si les falta un segundo pago, y su segundo tramo no puede aparecer aunque el dinero entre.`
          : 'Todas las ventas de este mes lo tienen.'}
      </p>
    </section>
  )
}

function FilaPlanPago({ f, onAbrir }: {
  f: ComercialPlanPagoFila
  onAbrir: (fila: ComercialPlanPagoFila) => void
}) {
  const abrir = f.ventas > 0 ? () => onAbrir(f) : undefined
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
      <td className="px-4 py-3">
        <span className={f.plan_pago === null ? 'italic text-gray-400' : 'font-medium text-gray-900'}>
          {f.plan_pago === null ? 'Sin declarar' : planPagoLabel(f.plan_pago)}
        </span>
      </td>
      <CeldaAbrible className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900"
        onAbrir={abrir} title="Ver estos casos">
        {f.ventas}
      </CeldaAbrible>
      <CeldaAbrible className="px-4 py-3 text-right tabular-nums text-gray-600"
        onAbrir={abrir} title="Ver los casos de los que salió este recaudo">
        {fmtCOP(f.primer_pago)}
      </CeldaAbrible>
      {/* La raya, y no un $0: fuera del plan 1 el segundo tramo no existe o no se sabe
          si existe, y en ninguno de los dos casos hay algo medido que valga cero. */}
      <td className="hidden px-4 py-3 text-right tabular-nums text-gray-600 sm:table-cell">
        {f.segundo_pago === null ? (
          <span
            className="text-gray-300"
            title={f.plan_pago === 2
              ? 'El plan 2 se paga completo por adelantado: no hay segundo tramo que medir.'
              : 'Sin plan declarado no se sabe si existe un segundo tramo. No es cero: es que no se puede medir.'}
          >
            —
          </span>
        ) : (
          fmtCOP(f.segundo_pago)
        )}
      </td>
      <CeldaAbrible className="px-4 py-3 text-right font-semibold tabular-nums"
        style={{ color: GREEN }} onAbrir={abrir} title="Ver los casos que suman este valor">
        {fmtCOP(f.valor_sin_iva)}
      </CeldaAbrible>
      <CeldaAbrible className="hidden px-4 py-3 text-right tabular-nums text-gray-700 md:table-cell"
        onAbrir={abrir} title="Ver los casos con el honorario cubierto">
        {f.casos_completos}
      </CeldaAbrible>
    </tr>
  )
}

/**
 * Capacidad mensual por seccional (punto #43).
 *
 * JD: "si en Bogotá sacamos 18 citas al mes, el equipo comercial tiene cabida para 18
 * clientes de Bogotá". Por eso la tabla es POR SECCIONAL y el total va al final, no al
 * revés: el total no dice nada sobre dónde se puede vender.
 *
 * ⚠️ Las series NO tienen el mismo respaldo y la pantalla lo dice en vez de dibujarlas
 * todas iguales. La de certificados CON ERROR no se dibuja: no hay un solo registro, y
 * una línea en cero se leería como "calidad perfecta".
 */
function SeccionCapacidad({ cap, sinRecorte }: { cap: CapacidadSeccional; sinRecorte?: boolean }) {
  // Los meses que de verdad tienen algún dato, en orden. No se rellenan los vacíos:
  // un mes sin citas y un mes sin medir se verían igual, y no son lo mismo.
  const meses = [...new Set([
    ...cap.citas.map((p) => p.mes),
    ...cap.certificaciones.map((p) => p.mes),
    ...cap.finalizados.map((p) => p.mes),
  ])].sort()

  const seccionales = [...new Set([
    ...cap.citas.map((p) => p.seccional),
    ...cap.certificaciones.map((p) => p.seccional),
    ...cap.finalizados.map((p) => p.seccional),
  ])]
  // Sin registrar al final: es un hueco de dato, no una plaza del ranking.
  seccionales.sort((a, b) => {
    if ((a === null) !== (b === null)) return a === null ? 1 : -1
    return (a ?? '').localeCompare(b ?? '')
  })

  const busca = (serie: CapacidadPunto[], sec: string | null, mes: string): number | null => {
    const p = serie.find((x) => x.seccional === sec && x.mes === mes)
    return p ? p.n : null
  }

  if (meses.length === 0) return null

  const cob = cap.certificaciones_cobertura
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-bold text-gray-900">Capacidad por seccional</h2>
      <p className="mb-3 text-xs text-gray-500">
        Cuántas citas da la DIAN y cuántos certificados salen cada mes en cada seccional.
        Es el techo de lo que el equipo comercial puede vender ahí.
      </p>
      {/* Se dice donde se lee la tabla, y no solo en el aviso de arriba: quien llega
          hasta aqui desplazandose ya perdio de vista aquella frase, y una tabla que
          parece filtrada y no lo esta es peor que una que no filtra. */}
      {sinRecorte && (
        <p className="mb-3 text-xs text-amber-800">
          Esta seccion NO se recorta por vendedor: mide la agenda de la DIAN, que no es de
          nadie del equipo en particular.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 text-left">Seccional</th>
                {meses.map((m) => (
                  <th key={m} colSpan={3} className="border-l border-gray-100 px-3 py-3 text-center">
                    {m}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-gray-100 bg-gray-50/40 text-[10px] uppercase tracking-wide text-gray-400">
                <th />
                {meses.map((m) => (
                  <Fragment key={m}>
                    <th className="border-l border-gray-100 px-2 py-1.5 text-right font-medium" title="Citas de la DIAN con fecha en este mes">Citas</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="Casos que entraron a Certificación en este mes">Cert.</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="Casos que quedaron en estado completado en este mes">Final.</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {seccionales.map((sec) => (
                <tr key={sec ?? 'sin'} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    <span className={sec ? 'font-medium text-gray-900' : 'italic text-gray-400'}>
                      {sec ?? 'Sin registrar'}
                    </span>
                  </td>
                  {meses.map((m) => (
                    <Fragment key={m}>
                      <CeldaCapacidad n={busca(cap.citas, sec, m)} borde />
                      <CeldaCapacidad n={busca(cap.certificaciones, sec, m)} />
                      <CeldaCapacidad n={busca(cap.finalizados, sec, m)} />
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lo que la tabla NO puede afirmar, dicho donde se lee la tabla. */}
      <ul className="mt-2 space-y-1 text-[11px] text-gray-500">
        <li>
          <strong>Citas</strong>: se cuentan por la fecha de la propia cita, que es lo que
          mide el cupo del mes. Un caso sin fecha registrada no aparece.
        </li>
        <li>
          <strong>Certificaciones</strong>: salen del rastro de cambios de etapa, que cubre{' '}
          <strong>{cob.con_rastro} de {cob.con_evidencia}</strong> casos con evidencia de haber
          pasado por ahí. Los que llegaron cargados ya avanzados no dejaron rastro
          {cap.rastro_etapas_desde && <> (el rastro arranca en {cap.rastro_etapas_desde})</>}.
        </li>
        <li>
          <strong>Finalizados</strong>: cuenta el estado <em>completado</em>. Todavía no es la
          definición acordada de finalizado (IVA devuelto o certificado entregado y sin saldo).
        </li>
        {cap.errores_sin_fuente && (
          <li className="text-amber-700">
            <strong>Certificados con error</strong>: no se dibuja porque no hay ni un reproceso
            registrado. No es cero errores — es que nadie los ha registrado todavía.
          </li>
        )}
      </ul>
    </section>
  )
}

/** Una celda de capacidad. Sin dato va en raya, no en cero. */
function CeldaCapacidad({ n, borde }: { n: number | null; borde?: boolean }) {
  return (
    <td className={`px-2 py-2.5 text-right tabular-nums ${borde ? 'border-l border-gray-100' : ''}`}>
      {n === null
        ? <span className="text-gray-300" title="Sin dato en este mes">—</span>
        : <span className="text-gray-800">{n}</span>}
    </td>
  )
}
