'use client'

import Link from 'next/link'
import { ArrowRight, MonitorPlay, TrendingDown } from 'lucide-react'
import { MiniTable } from '../tableros/components/mini-table'
import { GREEN, iniciales, nombreCorto, Mini, RankBadge, RankRow } from './persona-ui'
import {
  leerTendencia,
  slugAgente,
  type AgenteEquipo,
  type EquipoCalidad,
  type FilaRanking,
  type LecturaTendencia,
} from '../calidad/types'

/**
 * Equipo, para quien gestiona un piso de agentes.
 *
 * ES LA MISMA PANTALLA QUE YA EXISTE, con otros datos. La tarjeta de persona,
 * el badge de posicion, los mini-indicadores y las filas con ranking son
 * exactamente los del equipo comercial (`persona-ui.tsx`), y la tabla es la
 * `MiniTable` de Tableros. Lo unico propio es de donde salen los numeros:
 * ninguno de los otros clientes de `/equipo` mide llamadas.
 *
 * DOS EJES QUE NO SE PROMEDIAN, como en todo el modulo. La tecnica da score; el
 * cumplimiento levanta banderas. Un agente puede tener la mejor tecnica del
 * equipo y estar en rojo de cumplimiento, y esa contradiccion es justamente lo
 * que hay que ver.
 *
 * LA TENDENCIA ES LO QUE EL RANKING NO PUEDE DECIR. El ranking dice donde esta
 * cada uno hoy; no dice hacia donde va. "Viene bajando" es lo que decide a
 * quien se sienta esta semana, y sale del mismo criterio que el perfil.
 */

const RED = '#DC2626'

const LECTURA: Record<LecturaTendencia, { corto: string; color?: string }> = {
  alza: { corto: 'Viene subiendo', color: GREEN },
  baja: { corto: 'Viene bajando', color: RED },
  estable: { corto: 'Estable' },
  sin_datos: { corto: 'Sin datos' },
}

const usd = (n: number) => `US$${Math.round(n).toLocaleString('es-CO')}`

const fecha = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })

/** Vacio seguro: si un agente no trajera extra, la fila se degrada, no tumba. */
function extraDe(mapa: Map<string, AgenteEquipo>, agente: string): AgenteEquipo {
  return (
    mapa.get(agente) ?? {
      agente,
      vendidoUsd: 0,
      tendencia: { n: 0, porSemana: null, t: null, primeraMitad: null, segundaMitad: null },
    }
  )
}

export default function EquipoCalidadClient({ datos }: { datos: EquipoCalidad }) {
  const { filas, umbrales } = datos.ranking
  const total = filas.length

  // Se une por NOMBRE COMPLETO, la clave con la que la RPC devuelve las dos
  // mitades. Por eso este ranking no corta el apellido y el del muro si: alli
  // el nombre es privacidad, aqui es la llave y el enlace al perfil.
  const extra = new Map(datos.agentes.map((a) => [a.agente, a]))

  // Posiciones por eje, para los mismos badges "#N" del equipo comercial. El
  // ranking primario es cierres, igual que en el muro.
  const posiciones = (valor: (f: FilaRanking) => number, mayorEsMejor = true) => {
    const orden = [...filas].sort((a, b) => (mayorEsMejor ? valor(b) - valor(a) : valor(a) - valor(b)))
    return new Map(orden.map((f, i) => [f.agente, i + 1]))
  }
  const rankCierres = posiciones((f) => f.cierres)
  const rankTecnica = posiciones((f) => f.tecnica)
  const rankBanderas = posiciones((f) => f.banderas, false)

  // Terciles del propio equipo, no umbrales escritos a mano. Sin dispersion no
  // se pinta nada: no hay a quien señalar.
  const hayDispersionTecnica = umbrales.tecnicaAlta > umbrales.tecnicaBaja
  const hayDispersionBanderas = umbrales.banderasAlta > umbrales.banderasBaja
  const colorTecnica = (v: number) =>
    !hayDispersionTecnica ? undefined : v >= umbrales.tecnicaAlta ? GREEN : v <= umbrales.tecnicaBaja ? RED : undefined
  const colorBanderas = (v: number) =>
    !hayDispersionBanderas ? undefined : v >= umbrales.banderasAlta ? RED : v <= umbrales.banderasBaja ? GREEN : undefined

  // A quien sentar primero. Es la unica lista que no ordena por ventas, y por
  // eso va en su propio bloque: no compite con el ranking.
  const bajando = filas
    .filter((f) => leerTendencia(extraDe(extra, f.agente).tendencia) === 'baja')
    .sort((a, b) => b.llamadas - a.llamadas)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Equipo de calidad</h1>
          {/* La pantalla dice QUE muestra. Sin esta linea, dos pantallas con
              cifras distintas parecen una contradiccion y son dos periodos. */}
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            El mismo ranking que se proyecta en el muro, sobre los ultimos 30 dias ({fecha(datos.desde)} a{' '}
            {fecha(datos.hasta)}), con nombre completo y con la tendencia de cada uno.
          </p>
        </div>

        {/* El muro salio del menu y su acceso principal quedo en Tableros, que
            el supervisor no ve. Pero el muro es la pantalla del PISO y el piso
            lo lleva el supervisor. */}
        <Link
          href="/calidad/muro"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
        >
          <MonitorPlay className="h-4 w-4" />
          Proyectar el muro
        </Link>
      </div>

      {/* A quien sentar primero */}
      {bajando.length > 0 && (
        <div className="mb-6 rounded-2xl border border-red-100 bg-red-50/50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-500" />
            <h3 className="text-sm font-semibold text-red-700">
              {bajando.length === 1 ? 'Viene bajando' : 'Vienen bajando'}
            </h3>
          </div>
          <div className="space-y-3">
            {bajando.map((f) => {
              const a = extraDe(extra, f.agente)
              return (
                <div key={f.agente} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/calidad/agente/${slugAgente(f.agente)}`}
                    className="truncate text-sm font-medium text-gray-900 hover:underline"
                  >
                    {nombreCorto(f.agente)}
                  </Link>
                  <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 tabular-nums">
                    {a.tendencia.porSemana} pts/semana
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-red-700/80">
            La caida es mayor que la variacion normal de la propia persona, no una mala racha de un dia.
          </p>
        </div>
      )}

      {/* Tarjetas por agente — la misma tarjeta del equipo comercial */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filas.map((f) => {
          const a = extraDe(extra, f.agente)
          const lect = leerTendencia(a.tendencia)
          return (
            <Link
              key={f.agente}
              href={`/calidad/agente/${slugAgente(f.agente)}`}
              className="group rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:border-gray-200 hover:shadow-md"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1A1A1A] text-xs font-bold text-white">
                  {iniciales(f.agente)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-gray-900">{nombreCorto(f.agente)}</p>
                  <p className="truncate text-xs" style={{ color: LECTURA[lect].color ?? '#9CA3AF' }}>
                    {LECTURA[lect].corto}
                    {a.tendencia.porSemana !== null && (
                      <>
                        {' · '}
                        {a.tendencia.porSemana > 0 ? '+' : ''}
                        {a.tendencia.porSemana} pts/semana
                      </>
                    )}
                  </p>
                </div>
                <RankBadge rank={rankCierres.get(f.agente) ?? 0} total={total} />
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2">
                <Mini label="Ventas cerradas" value={f.cierres.toLocaleString('es-CO')} />
                <Mini label="Vendido" value={usd(a.vendidoUsd)} color={GREEN} />
              </div>

              <div className="space-y-2 border-t border-gray-50 pt-3">
                <RankRow
                  label="Llamadas auditadas"
                  value={f.llamadas.toLocaleString('es-CO')}
                  rank={0}
                  total={total}
                />
                <RankRow
                  label="Tecnica promedio"
                  value={String(f.tecnica)}
                  rank={rankTecnica.get(f.agente) ?? 0}
                  total={total}
                  strong
                />
                <RankRow
                  label="Errores criticos"
                  value={f.banderas.toLocaleString('es-CO')}
                  rank={rankBanderas.get(f.agente) ?? 0}
                  total={total}
                />
              </div>

              <div className="mt-4 flex items-center justify-end text-xs font-semibold text-[#059669]">
                Ver su perfil
                <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          )
        })}
      </div>

      {/* Ranking — MiniTable de Tableros */}
      <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Ranking</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Ordenado por ventas cerradas, como se lee un ranking comercial. La tecnica y las banderas
            confirman o desmienten ese orden, no lo deciden.
          </p>
        </div>
        <MiniTable
          columns={[
            {
              key: 'agente',
              label: 'Agente',
              render: (v: string) => (
                <Link href={`/calidad/agente/${slugAgente(v)}`} className="hover:underline">
                  {nombreCorto(v)}
                </Link>
              ),
            },
            { key: 'llamadas', label: 'Llamadas', align: 'right' },
            { key: 'cierres', label: 'Cierres', align: 'right' },
            { key: 'pctCierre', label: '% cierre', align: 'right', render: (v: number) => `${v}%` },
            {
              key: 'tecnica',
              label: 'Tecnica',
              align: 'right',
              render: (v: number) => <span style={{ color: colorTecnica(v) }}>{v}</span>,
            },
            {
              key: 'banderas',
              label: 'Banderas',
              align: 'right',
              render: (v: number) => (
                <span style={{ color: colorBanderas(v) }}>{v.toLocaleString('es-CO')}</span>
              ),
            },
            {
              key: 'tendencia',
              label: 'Tendencia',
              align: 'right',
              render: (v: LecturaTendencia) => (
                <span style={{ color: LECTURA[v].color }}>{LECTURA[v].corto}</span>
              ),
            },
          ]}
          data={filas.map((f) => ({
            agente: f.agente,
            llamadas: f.llamadas.toLocaleString('es-CO'),
            cierres: f.cierres.toLocaleString('es-CO'),
            pctCierre: f.pctCierre,
            tecnica: f.tecnica,
            banderas: f.banderas,
            tendencia: leerTendencia(extraDe(extra, f.agente).tendencia),
          }))}
          emptyMessage="Aun no hay llamadas auditadas en el periodo."
        />
        <p className="mt-3 text-xs text-gray-400">
          El color sale de los terciles del propio equipo en el periodo, no de un umbral escrito a mano.
        </p>
      </div>
    </div>
  )
}
