'use client'

/**
 * Pestaña Marketplace de Tableros: los totales generales del piloto Dimpro x MeTRIK.
 *
 * El detalle por publicación vive en `/ferreteria`; aquí va lo agregado. Todo el cálculo sale de
 * `@/lib/tableros/ferreteria` (puro y probado) y de las metas de `@/lib/ferreteria/metas`: este
 * componente solo pinta. El periodo se cambia en el navegador, sobre los mismos datos.
 */

import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart, ReferenceLine,
} from 'recharts'
import { ChevronRight } from 'lucide-react'
import { ChartCard } from './chart-card'
import { StatHero } from './stat-hero'
import { PALETA } from '@/lib/marca/paleta'
import {
  PERIODOS, armarTablero, mesConMeta, variacion,
  type ClavePeriodo, type IndicadorMes, type PuntoSerie,
} from '@/lib/tableros/ferreteria'
import {
  TASAS_META, TEXTO_ALARMA_CIERRE, TEXTO_PISO_ALARMA, TEXTO_SIN_META_CLIC_CONVERSACION,
  alarmaCierre, type Semaforo,
} from '@/lib/ferreteria/metas'
import { formatoPesosConSigno, nombreMes, sentidoLiquidacion } from '@/lib/ferreteria/liquidacion'
import type { PilotoMarketplaceData } from '../ferreteria-actions'

const ACENTO = PALETA.acento
const SUAVE = PALETA.tintaSuave
const GRIS = '#CBD5E1'

const pesos = (n: number) => formatoPesosConSigno(n)
const entero = (n: number) => Math.round(n).toLocaleString('es-CO')
const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`)
const diaCorto = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`

const COLOR_SEMAFORO: Record<Semaforo, string> = {
  verde: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amarillo: 'bg-amber-50 text-amber-700 border-amber-200',
  rojo: 'bg-red-50 text-red-700 border-red-200',
}

export default function TabFerreteria({ inicial }: { inicial: PilotoMarketplaceData }) {
  const { datos, hoy } = inicial
  const [clave, setClave] = useState<ClavePeriodo>('30d')
  const t = useMemo(() => armarTablero(datos, clave, hoy), [datos, clave, hoy])
  const m = useMemo(() => mesConMeta(datos, hoy), [datos, hoy])

  // Sin comparación, el delta no se pinta: comparar contra días antes del piloto daría un
  // "+100 %" que solo dice que antes no existía.
  const delta = (a: number | null, b: number | null) => (t.sinComparacion ? undefined : variacion(a, b) ?? undefined)
  const faltan = new Set(t.diasSinMedicion)
  const hoyEstados = t.estados.at(-1)
  const ayerEstados = t.estados.at(-2)
  const cierre = m.conversaciones && m.ventas ? alarmaCierre(m.conversaciones.acumulado, m.ventas.acumulado) : false

  return (
    <div className="space-y-6">
      {/* Periodo */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          Del {diaCorto(t.rango.desde)} al {diaCorto(t.rango.hasta)}
          {t.sinComparacion
            ? ' · sin comparación: el periodo anterior cae antes del piloto'
            : ` · contra el ${diaCorto(t.anterior.desde)} al ${diaCorto(t.anterior.hasta)}`}
        </p>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <button
              key={p.clave}
              onClick={() => setClave(p.clave)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                clave === p.clave ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* Alarmas */}
      {(m.alarmaPisoOctubre || cierre || m.bajoPisoActivas) && (
        <div className="space-y-2">
          {m.alarmaPisoOctubre && <Aviso tono="rojo">{TEXTO_PISO_ALARMA} Octubre cerró con menos de 3 ventas.</Aviso>}
          {cierre && <Aviso tono="rojo">{TEXTO_ALARMA_CIERRE} Menos de 5 % de las conversaciones del mes terminan en venta.</Aviso>}
          {m.bajoPisoActivas && m.meta && (
            <Aviso tono="amarillo">
              Hay {m.activasHoy} publicaciones activas; el piso del mes es {m.meta.activasPiso}.
            </Aviso>
          )}
        </div>
      )}

      {/* Embudo */}
      <ChartCard title="Embudo del periodo" subtitle="De la publicación a la ganancia">
        <div className="flex flex-wrap items-center gap-2">
          <Paso etiqueta="Publicaciones activas" valor={entero(t.actual.activas)} />
          <Flecha tasa={null} />
          <Paso etiqueta="Clics" valor={entero(t.actual.clics)} />
          <Flecha tasa={t.actual.tasaConversacion} />
          <Paso etiqueta="Conversaciones" valor={entero(t.actual.conversaciones)} />
          <Flecha tasa={t.actual.tasaVenta} />
          <Paso etiqueta="Ventas" valor={entero(t.actual.ventas)} />
          <Flecha tasa={null} />
          <Paso etiqueta="Ganancia" valor={pesos(t.actual.ganancia)} />
        </div>
      </ChartCard>

      {/* Dirección: cada indicador contra el periodo anterior */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {[
          { label: 'Publicaciones activas', value: entero(t.actual.activas), d: delta(t.actual.activas, t.previo.activas) },
          { label: 'Clics', value: entero(t.actual.clics), d: delta(t.actual.clics, t.previo.clics) },
          { label: 'Conversaciones', value: entero(t.actual.conversaciones), d: delta(t.actual.conversaciones, t.previo.conversaciones) },
          { label: 'Ventas', value: entero(t.actual.ventas), d: delta(t.actual.ventas, t.previo.ventas) },
          { label: 'Ingreso', value: pesos(t.actual.ingreso), d: delta(t.actual.ingreso, t.previo.ingreso) },
          { label: 'Ganancia', value: pesos(t.actual.ganancia), d: delta(t.actual.ganancia, t.previo.ganancia) },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <StatHero label={s.label} value={s.value} delta={s.d} deltaLabel="vs periodo anterior" />
          </div>
        ))}
      </div>

      {/* El mes contra la meta */}
      <ChartCard
        title={`${nombreMes(m.mes)[0].toUpperCase()}${nombreMes(m.mes).slice(1)} contra la meta`}
        subtitle={m.meta ? 'Acumulado real contra la meta prorrateada por día' : undefined}
        accentColor={ACENTO}
      >
        {m.meta && m.ventas && m.ganancia && m.conversaciones ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <CurvaMeta titulo="Ventas" ind={m.ventas} fmt={entero} />
            <CurvaMeta titulo="Ganancia" ind={m.ganancia} fmt={pesos} />
            <CurvaMeta titulo="Conversaciones" ind={m.conversaciones} fmt={entero} />
          </div>
        ) : (
          <p className="text-sm text-gray-500">El piloto arranca el 1 de octubre: este mes no tiene meta y los datos se muestran solos.</p>
        )}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Progreso titulo="Ventas del piloto (oct-dic)" real={m.totalPiloto.ventas} meta={m.totalPiloto.metaVentas} fmt={entero} />
          <Progreso titulo="Ganancia del piloto (oct-dic)" real={m.totalPiloto.ganancia} meta={m.totalPiloto.metaGanancia} fmt={pesos} />
        </div>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <p className="text-gray-600">
            Conversación a venta: <b>{pct(t.actual.tasaVenta)}</b>
            <span className="text-gray-400"> · meta {pct(TASAS_META.conversacionAVenta)}</span>
          </p>
          <p className="text-gray-600">
            Clic a conversación: <b>{pct(t.actual.tasaConversacion)}</b>
            <span className="text-gray-400"> · {TASAS_META.clicAConversacion == null ? TEXTO_SIN_META_CLIC_CONVERSACION : `meta ${pct(TASAS_META.clicAConversacion)}`}</span>
          </p>
        </div>
      </ChartCard>

      {/* ── Marketing ─────────────────────────────────────────────────────────── */}
      <h2 className="pt-2 text-base font-semibold text-gray-900">Marketing</h2>

      <ChartCard
        title="Publicaciones por estado"
        subtitle={
          hoyEstados
            ? `Hoy: ${hoyEstados.activa} activas${cambio(hoyEstados.activa, ayerEstados?.activa)}, ${hoyEstados.en_revision} en revisión${cambio(hoyEstados.en_revision, ayerEstados?.en_revision)}, ${hoyEstados.agotada} agotadas${cambio(hoyEstados.agotada, ayerEstados?.agotada)}`
            : undefined
        }
      >
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={t.estados} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="fecha" tickFormatter={diaCorto} tick={{ fontSize: 11, fill: SUAVE }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: SUAVE }} tickLine={false} axisLine={false} width={32} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }} labelFormatter={(f) => diaCorto(String(f))} />
              <Bar dataKey="activa" name="Activas" stackId="e" fill={ACENTO} />
              <Bar dataKey="en_revision" name="En revisión" stackId="e" fill={PALETA.advertencia} />
              <Bar dataKey="agotada" name="Agotadas" stackId="e" fill={GRIS} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SerieCard
          titulo="Clics por día"
          subtitulo={`${entero(t.actual.clics)} en el periodo${t.diasSinMedicion.length ? ` · ${t.diasSinMedicion.length} días sin medición (líneas grises): sus clics caen el día que se volvió a medir` : ''}${t.reinicios ? ` · ${t.reinicios} reinicios de contador` : ''}`}
          serie={t.clics}
          marcas={[...faltan]}
          fmt={entero}
        />
        <SerieCard titulo="Conversaciones por día" subtitulo={`${entero(t.actual.conversaciones)} en el periodo`} serie={t.conversaciones} fmt={entero} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Dato titulo="Tasa conversaciones / clics" valor={pct(t.actual.tasaConversacion)} />
        <Dato titulo="Clics por publicación activa" valor={t.actual.clicsPorActiva == null ? '—' : t.actual.clicsPorActiva.toLocaleString('es-CO', { maximumFractionDigits: 1 })} nota="En el periodo, sobre las activas promedio por día" />
        <Dato titulo="Sin clics en 7 días" valor={entero(t.sinClics7d)} nota="Publicaciones activas ya medidas que no sumaron un clic" />
      </div>

      {/* ── Ventas ────────────────────────────────────────────────────────────── */}
      <h2 className="pt-2 text-base font-semibold text-gray-900">Ventas</h2>
      <p className="-mt-4 text-xs text-gray-400">Una venta cuenta el día en que se paga.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <SerieCard titulo="Ventas por día" subtitulo={`${entero(t.actual.ventas)} en el periodo`} serie={t.ventas} fmt={entero} />
        <SerieCard titulo="Ganancia por día" subtitulo={`${pesos(t.actual.ganancia)} en el periodo · ingreso ${pesos(t.actual.ingreso)}`} serie={t.ganancia} fmt={pesos} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Dato titulo="Tasa ventas / conversaciones" valor={pct(t.actual.tasaVenta)} />
        <Dato titulo="Ticket promedio" valor={t.actual.ticketPromedio == null ? '—' : pesos(t.actual.ticketPromedio)} />
        <Dato titulo="Ganancia promedio" valor={t.actual.gananciaPromedio == null ? '—' : pesos(t.actual.gananciaPromedio)} />
        <Dato
          titulo="Por cobrar"
          valor={pesos(t.porCobrar.valor)}
          nota={`${t.porCobrar.ventas} ${t.porCobrar.ventas === 1 ? 'venta contra entrega sin pagar' : 'ventas contra entrega sin pagar'} · no entran en ninguna liquidación`}
        />
      </div>

      <ChartCard title={`Liquidación de ${nombreMes(hoy.slice(0, 7))}`} subtitle="Mes abierto: sigue sumando ventas hasta que cierre">
        {t.mesEnCurso ? (
          <div className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Linea titulo="Ventas" valor={entero(t.mesEnCurso.ventas)} />
            <Linea titulo="Ingreso" valor={pesos(t.mesEnCurso.ingreso)} />
            <Linea titulo="Costo" valor={pesos(t.mesEnCurso.costo)} />
            <Linea titulo="Ganancia" valor={pesos(t.mesEnCurso.ganancia)} />
            <Linea titulo="Parte Dimpro" valor={pesos(t.mesEnCurso.parteDimpro)} />
            <Linea
              titulo={sentidoLiquidacion(t.mesEnCurso.parteMetrik).texto}
              valor={pesos(sentidoLiquidacion(t.mesEnCurso.parteMetrik).valor)}
            />
          </div>
        ) : (
          <p className="text-sm text-gray-500">Todavía no hay ventas pagadas este mes.</p>
        )}
      </ChartCard>
    </div>
  )
}

function cambio(hoy: number, ayer: number | undefined): string {
  if (ayer == null || hoy === ayer) return ''
  return ` (${hoy > ayer ? '+' : ''}${hoy - ayer} vs ayer)`
}

function Aviso({ tono, children }: { tono: 'rojo' | 'amarillo'; children: React.ReactNode }) {
  const c = tono === 'rojo' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'
  return <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${c}`}>{children}</div>
}

function Paso({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-[110px] flex-1 rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-500">{etiqueta}</p>
      <p className="text-xl font-bold text-gray-900">{valor}</p>
    </div>
  )
}

function Flecha({ tasa }: { tasa: number | null }) {
  return (
    <div className="flex flex-col items-center text-gray-400">
      <ChevronRight className="h-4 w-4" />
      {tasa != null && <span className="text-[10px]">{pct(tasa)}</span>}
    </div>
  )
}

function Dato({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{titulo}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{valor}</p>
      {nota && <p className="mt-1 text-xs text-gray-400">{nota}</p>}
    </div>
  )
}

function Linea({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className="font-semibold text-gray-900">{valor}</p>
    </div>
  )
}

function Progreso({ titulo, real, meta, fmt }: { titulo: string; real: number; meta: number; fmt: (n: number) => string }) {
  const avance = meta > 0 ? Math.max(0, Math.min(1, real / meta)) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-gray-600">{titulo}</span>
        <span className="text-gray-900"><b>{fmt(real)}</b> <span className="text-gray-400">de {fmt(meta)}</span></span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-gray-100">
        <div className="h-2 rounded-full" style={{ width: `${avance * 100}%`, background: ACENTO }} />
      </div>
    </div>
  )
}

function CurvaMeta({ titulo, ind, fmt }: { titulo: string; ind: IndicadorMes; fmt: (n: number) => string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{titulo}</p>
        {ind.ritmo && (
          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${COLOR_SEMAFORO[ind.ritmo.semaforo]}`}>
            {Math.round(ind.ritmo.ritmo * 100)} % del ritmo
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {fmt(ind.acumulado)} de {fmt(ind.metaAHoy)} a hoy · meta del mes {fmt(ind.metaMes)}
      </p>
      <div className="mt-2 h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={ind.curva} margin={{ left: 0, right: 8 }}>
            <CartesianGrid vertical={false} stroke="#F3F4F6" />
            <XAxis dataKey="dia" tick={{ fontSize: 10, fill: SUAVE }} tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
              formatter={(v, n) => [v == null ? '—' : fmt(Number(v)), n === 'real' ? 'Real' : 'Meta']}
              labelFormatter={(d) => `Día ${d}`}
            />
            <Line dataKey="meta" name="meta" stroke={GRIS} strokeDasharray="4 4" dot={false} />
            <Line dataKey="real" name="real" stroke={ACENTO} strokeWidth={2} dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function SerieCard({
  titulo, subtitulo, serie, fmt, marcas = [],
}: { titulo: string; subtitulo: string; serie: PuntoSerie[]; fmt: (n: number) => string; marcas?: string[] }) {
  return (
    <ChartCard title={titulo} subtitle={subtitulo}>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={serie} margin={{ left: 0, right: 8 }}>
            <CartesianGrid vertical={false} stroke="#F3F4F6" />
            <XAxis dataKey="fecha" tickFormatter={diaCorto} tick={{ fontSize: 11, fill: SUAVE }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="d" tick={{ fontSize: 11, fill: SUAVE }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => fmt(Number(v))} />
            <YAxis yAxisId="a" orientation="right" hide />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #E5E7EB' }}
              labelFormatter={(f) => `${diaCorto(String(f))}${marcas.includes(String(f)) ? ' · sin medición' : ''}`}
              formatter={(v, n) => [fmt(Number(v)), n === 'acumulado' ? 'Acumulado' : 'Del día']}
            />
            {marcas.map((f) => (
              <ReferenceLine key={f} x={f} yAxisId="d" stroke={GRIS} strokeDasharray="2 3" />
            ))}
            <Bar yAxisId="d" dataKey="valor" name="valor" fill={ACENTO} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Line yAxisId="a" dataKey="acumulado" name="acumulado" stroke={PALETA.advertencia} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
