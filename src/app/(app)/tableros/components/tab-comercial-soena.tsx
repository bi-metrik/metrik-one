'use client'

import { Fragment, useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, Target } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from 'recharts'
import type {
  ComercialResumenRow,
  ComercialVendedorMes,
  ComercialMesResponse,
  ComercialSerieResponse,
  ComercialOrigenMes,
  ComercialSeccionalFila,
  ComercialSeccionalMes,
  ComercialPlanPagoFila,
  ComercialPlanPagoMes,
  CapacidadPunto,
  CapacidadSeccional,
  MetaComercial,
} from '../../equipo/comercial-types'
import { MESES_ES, planPagoLabel } from '../../equipo/comercial-types'
import {
  getComercialMes,
  getComercialOrigenMes,
  getComercialSeccionalMes,
  getComercialPlanPagoMes,
} from '../../equipo/comercial-actions'
import MetasModal from '../../equipo/metas-modal'
import { VentasDrawer, type CifraSeleccionada } from './ventas-drawer'
import { PerdidosDrawer } from './perdidos-drawer'
import { origenNegocioLabel } from '@/lib/catalogos/constants'

const GREEN = '#059669'
const BLUE = '#2563EB'
const GRAY = '#9CA3AF'

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
  metasIniciales: MetaComercial[]
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
  metasIniciales,
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

  /** Salta a un mes concreto. El navegador de flechas y el histórico usan lo mismo. */
  function irAlMes(na: number, nm: number) {
    setMes(nm)
    setAnio(na)
    const prev = nm === 1 ? { a: na - 1, m: 12 } : { a: na, m: nm - 1 }
    startTransition(async () => {
      // Las tres consultas van juntas: si la comparación llegara después, el panel
      // mostraría por un instante los deltas del mes anterior sobre las cifras nuevas.
      const [d, p, o, sec, plan] = await Promise.all([
        getComercialMes(na, nm),
        getComercialMes(prev.a, prev.m),
        getComercialOrigenMes(na, nm),
        getComercialSeccionalMes(na, nm),
        getComercialPlanPagoMes(na, nm),
      ])
      setMesData(d)
      setMesPrevio(p)
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
    irAlMes(na, nm)
  }

  const kpis = mesData?.kpis
  const kpisPrev = mesPrevio?.kpis
  const ventasPorDia = mesData?.porDia ?? []

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

  // Quien lidera el equipo toma casos especiales pero no compite: va listado aparte,
  // debajo, para no mezclarlo con la comparacion entre quienes ejecutan. Sus cifras
  // SI cuentan en los totales del equipo, que son del equipo entero.
  const porVendedor = mesData?.porVendedor ?? []
  const vendedoresMes = porVendedor.filter((v) => !v.es_lider)
  const lideresMes = porVendedor.filter((v) => v.es_lider)
  const equipoEjecuta = equipo.filter((v) => !v.es_lider)
  const equipoLidera = equipo.filter((v) => v.es_lider)

  const totalHonorario = equipo.reduce((s, v) => s + v.honorario_recaudado, 0)
  const totalTarifa = equipo.reduce((s, v) => s + v.tarifa_recaudada, 0)
  const totalAprobado = equipo.reduce((s, v) => s + v.valor_aprobado, 0)

  const serieData = serie?.serie ?? []

  // Clic en cualquier punto del histórico = ir a ese mes. El `label` es lo único que
  // recharts devuelve al hacer clic, así que se resuelve contra la serie en vez de
  // parsearlo: el formato de la etiqueta lo decide la RPC y puede cambiar.
  const irAlMesDeLaSerie = (estado: { activeLabel?: string | number } | null) => {
    const etiqueta = estado?.activeLabel
    if (etiqueta === undefined || etiqueta === null) return
    const punto = serieData.find((p) => p.label === String(etiqueta))
    if (!punto || (punto.anio === anio && punto.mes === mes)) return
    irAlMes(punto.anio, punto.mes)
  }
  const propsSerie = { style: { cursor: 'pointer' }, onClick: irAlMesDeLaSerie }

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
            <Target className="h-4 w-4" /> Metas del mes
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
      {capacidad && <SeccionCapacidad cap={capacidad} />}

      {/* Tabla por vendedor del mes */}
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
                  <th className="hidden px-4 py-3 text-right lg:table-cell">2o pago</th>
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
                      vendedor: es exactamente el conjunto que suma. */}
                  <tr className="border-t border-gray-100 bg-gray-50/40 font-bold text-gray-900">
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
                    <CeldaAbrible className="hidden px-4 py-3 text-right tabular-nums lg:table-cell"
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
              <h2 className="text-sm font-bold text-gray-900">Historico mensual</h2>
              <p className="text-[11px] text-gray-400">Clic en un mes para verlo en detalle arriba</p>
            </div>
            {serie?.tasa_recaudo_global !== null && serie?.tasa_recaudo_global !== undefined && (
              <span className="text-xs text-gray-500">
                Tasa de recaudo global: <span className="font-semibold text-gray-700">{serie.tasa_recaudo_global}%</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Ventas por mes">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={serieData} margin={{ left: -10, right: 12, top: 8 }} {...propsSerie}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip formatter={(v) => [`${v}`, 'Ventas']} />
                  <Line type="monotone" dataKey="num_ventas" stroke={GREEN} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Valor de negocio por mes (sin IVA)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serieData} margin={{ left: -4, right: 12, top: 8 }} {...propsSerie}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
                  <Tooltip formatter={(v) => [fmtCOP(Number(v)), 'Valor sin IVA']} />
                  <Bar dataKey="valor_sin_iva" fill={GREEN} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Recaudo por mes (honorario)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serieData} margin={{ left: -4, right: 12, top: 8 }} {...propsSerie}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
                  <Tooltip formatter={(v) => [fmtCOP(Number(v)), 'Recaudo']} />
                  <Bar dataKey="honorario_recaudado" fill={BLUE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Primer vs segundo pago por mes">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serieData} margin={{ left: -4, right: 12, top: 8 }} {...propsSerie}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
                  <Tooltip formatter={(v, name) => [fmtCOP(Number(v)), name === 'primer_pago' ? '1er pago' : '2o pago']} />
                  <Bar dataKey="primer_pago" stackId="p" fill={GREEN} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="segundo_pago" stackId="p" fill={GRAY} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </section>
      )}

      {/* Totales historicos + embudo por vendedor */}
      <section>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ResumenTotal label="Valor aprobado historico (sin IVA)" value={fmtCOP(totalAprobado)} />
          <ResumenTotal label="Honorario recaudado" value={fmtCOP(totalHonorario)} color={GREEN} />
          <ResumenTotal label="Tarifa UPME (terceros)" value={fmtCOP(totalTarifa)} muted />
        </div>
        <h2 className="mb-3 text-sm font-bold text-gray-900">Embudo por vendedor (todo el historico)</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {equipoEjecuta.map((v) => (
            <div
              key={v.responsable_id ?? 'sin-responsable'}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
            >
              <div className="mb-4">
                <p className="truncate font-semibold text-gray-900">
                  {v.sin_responsable ? 'Sin responsable' : nombreCorto(v.nombre)}
                </p>
                <p className="truncate text-xs text-gray-400">
                  {v.sin_responsable ? 'Negocios sin asignar' : v.position ?? 'Comercial'}
                </p>
              </div>
              <div className="mb-4 grid grid-cols-3 gap-2">
                <StageCount label="Venta" n={v.en_venta} />
                <StageCount label="Ejecucion" n={v.en_ejecucion} />
                <StageCount label="Cobro" n={v.en_cobro} />
              </div>
              <div className="space-y-2 border-t border-gray-50 pt-3">
                <Row label="Negocios activos" value={String(v.negocios_abiertos)} />
                <Row label="Valor aprobado (sin IVA)" value={fmtCOP(v.valor_aprobado)} />
                <Row label="Honorario recaudado" value={fmtCOP(v.honorario_recaudado)} strong color={GREEN} />
                <Row label="Tarifa UPME (terceros)" value={fmtCOP(v.tarifa_recaudada)} muted />
              </div>
            </div>
          ))}
        </div>

        {/* Los casos de quienes lideran no se esconden: sin esta linea, la suma de las
            tarjetas no coincide con los totales de arriba y nadie sabe por que. */}
        {equipoLidera.length > 0 && (
          <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
              Casos que llevan los lideres · fuera de la comparacion
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {equipoLidera.map((v) => (
                <span key={v.responsable_id ?? 'lider'} className="text-gray-600">
                  {nombreCorto(v.nombre)}{' '}
                  <span className="font-semibold text-gray-900 tabular-nums">{v.negocios_abiertos}</span>
                  <span className="text-gray-400"> activos · {fmtCOP(v.honorario_recaudado)}</span>
                </span>
              ))}
            </div>
          </div>
        )}
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

      {verPerdidos && (
        <PerdidosDrawer
          key={`perdidos-${anio}-${mes}`}
          anio={anio}
          mes={mes}
          titulo={`Casos perdidos · ${MESES_ES[mes - 1]} ${anio}`}
          onClose={() => setVerPerdidos(false)}
        />
      )}

      {metasModalOpen && (
        <MetasModal
          anio={anio}
          mes={mes}
          equipo={equipo}
          metasIniciales={metasIniciales}
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
function FilaVendedor({ v, onAbrir }: {
  v: ComercialVendedorMes
  /** Abre los casos de este vendedor, con el subconjunto de la celda. */
  onAbrir: (alcance: AlcanceCelda) => void
}) {
  // Todas las columnas de dinero describen las MISMAS ventas de la fila, así que
  // abren la misma lista. Sin ventas no hay nada que abrir.
  const abrirTodas = v.num_ventas > 0 ? () => onAbrir('todas') : undefined
  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50">

                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">
                        {v.sin_responsable ? 'Sin responsable' : nombreCorto(v.nombre)}
                      </span>
                    </td>
                    <CeldaAbrible
                      className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums"
                      onAbrir={abrirTodas}
                      title="Ver estas ventas"
                    >
                      {v.num_ventas}
                      {v.meta_num_ventas ? <span className="ml-1 text-[10px] text-gray-400">/{v.meta_num_ventas}</span> : null}
                    </CeldaAbrible>
                    <CeldaAbrible
                      className="px-4 py-3 text-right font-semibold tabular-nums"
                      style={{ color: GREEN }}
                      onAbrir={abrirTodas}
                      title="Ver las ventas que suman este valor"
                    >
                      {fmtCOP(v.valor_sin_iva)}
                    </CeldaAbrible>
                    <CeldaAbrible
                      className="hidden px-4 py-3 text-right text-gray-500 tabular-nums md:table-cell"
                      onAbrir={abrirTodas}
                      title="Ver las ventas que suman este valor"
                    >
                      {fmtCOP(v.valor_con_iva)}
                    </CeldaAbrible>
                    <CeldaAbrible
                      className="hidden px-4 py-3 text-right text-gray-600 tabular-nums sm:table-cell"
                      onAbrir={abrirTodas}
                      title="Ver las ventas de las que salió este recaudo"
                    >
                      {fmtCOP(v.primer_pago)}
                    </CeldaAbrible>
                    <CeldaAbrible
                      className="hidden px-4 py-3 text-right text-gray-600 tabular-nums lg:table-cell"
                      onAbrir={abrirTodas}
                      title="Ver las ventas de las que salió este recaudo"
                    >
                      {fmtCOP(v.segundo_pago)}
                    </CeldaAbrible>
                    {/* Bonificables: la columna que decide el bono (#13/#31). Raya
                        cuando la línea no declaró umbral — un 0 diría "no completó
                        ninguna", que es una afirmación que nadie midió. */}
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {v.bonificables === null ? (
                        <span className="text-gray-300" title="La línea de estos negocios no declaró desde qué etapa una venta bonifica: no se pudo medir">—</span>
                      ) : v.bonificables > 0 ? (
                        <button
                          type="button"
                          onClick={() => onAbrir('bonificables')}
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
                          onClick={() => onAbrir('completos')}
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
                    <CeldaAbrible
                      className="hidden px-4 py-3 text-right tabular-nums text-gray-600 sm:table-cell"
                      onAbrir={abrirTodas}
                      title="Ver las ventas que dan esta participación"
                    >
                      {pct(v.participacion_pct)}
                    </CeldaAbrible>
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

function StageCount({ label, n }: { label: string; n: number }) {
  return (
    <div className="rounded-lg bg-gray-50 py-2 text-center">
      <p className="text-lg font-bold leading-none tabular-nums text-gray-900">{n}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
    </div>
  )
}

function Row({ label, value, strong, muted, color }: { label: string; value: string; strong?: boolean; muted?: boolean; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span
        className={`tabular-nums whitespace-nowrap ${strong ? 'font-bold' : muted ? 'text-sm text-gray-400' : 'text-sm font-semibold text-gray-900'}`}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
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
function SeccionCapacidad({ cap }: { cap: CapacidadSeccional }) {
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
