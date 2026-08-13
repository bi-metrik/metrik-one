'use client'

import Link from 'next/link'
import { MonitorPlay } from 'lucide-react'
import { StatHero } from './stat-hero'
import { ChartCard } from './chart-card'
import { AlertCard } from './alert-card'
import { MiniTable } from './mini-table'
import { DISCLAIMER_BANDERAS, type DuenoData } from '../../calidad/types'
import { formatBogotaFechaCorta } from '@/lib/dates/bogota'

/**
 * Recaudo y riesgo: lo vendido contra lo que de verdad entra.
 *
 * El tablero que se proyecta en el televisor muestra ventas. Pero la venta no
 * termina cuando el agente cierra: termina en la cuota 6.
 *
 * VIVE EN TABLEROS Y NO EN UNA RUTA PROPIA DEL MODULO. Dinero, embudo de cobro
 * y riesgo son decisiones de dueño de empresa, y ONE ya tiene el sitio para
 * eso; crear `/calidad/dueno` era inventar un modulo paralelo al que ya
 * existia. Sigue siendo la unica superficie del modulo que lleva plata, y por
 * eso el guard sigue estando: la pestaña solo se arma para quien puede verla.
 *
 * SE PINTA CON LOS COMPONENTES DE TABLEROS (`StatHero`, `ChartCard`,
 * `AlertCard`, `MiniTable`), no con los del modulo de calidad. Una pestaña que
 * se ve distinta a las de al lado se lee como otra aplicacion; que los datos
 * sean llamadas en vez de negocios no cambia como se ve un indicador.
 *
 * Aqui tambien vive el acceso al MURO, por la misma razon: el muro es una
 * pantalla de indicadores, y esta es la pantalla de indicadores. No es
 * navegacion diaria — se abre una vez y se deja puesta en un televisor.
 */

const GREEN = '#10B981'
const RED = '#EF4444'
const BLUE = '#3B82F6'

const usd = (n: number) => `US$${Math.round(n).toLocaleString('es-CO')}`

const fmtDia = (iso: string) => formatBogotaFechaCorta(iso) ?? iso

export default function TabCalidad({ datos }: { datos: DuenoData }) {
  const dejadoDeRecaudar = datos.vendidoUsd - datos.recaudadoUsd
  const pctLlegan =
    datos.aCuotas.n > 0 ? Math.round((datos.llegaronCuota6 / datos.aCuotas.n) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-gray-500">
          Es la unica superficie del modulo que lleva dinero, y no se proyecta: el muro muestra
          ventas, esto muestra lo que de verdad entra. Periodo: {fmtDia(datos.desde)} a{' '}
          {fmtDia(datos.hasta)}.
        </p>
        <Link
          href="/calidad/muro"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
        >
          <MonitorPlay className="h-4 w-4" />
          Proyectar el muro
        </Link>
      </div>

      {/* Los cuatro numeros de la decision */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ChartCard title="Ventas cerradas" accentColor={BLUE}>
          <StatHero label="" value={datos.ventasCerradas.toLocaleString('es-CO')} />
          <p className="mt-2 text-xs text-gray-400">
            {datos.deUnaVez.n} pagaron completo · {datos.aCuotas.n} a 6 cuotas
          </p>
        </ChartCard>

        <ChartCard title="Llegan a la cuota 6" accentColor={RED}>
          <StatHero label="" value={datos.llegaronCuota6.toLocaleString('es-CO')} />
          <p className="mt-2 text-xs text-gray-400">
            {pctLlegan}% de las {datos.aCuotas.n} a cuotas
          </p>
        </ChartCard>

        <ChartCard title="Recaudo efectivo" accentColor={RED}>
          <StatHero label="" value={`${datos.recaudoPct}%`} />
          <p className="mt-2 text-xs text-gray-400">de lo vendido en el periodo</p>
        </ChartCard>

        <ChartCard title="Dejado de recaudar" accentColor={RED}>
          <StatHero label="" value={usd(dejadoDeRecaudar)} />
          <p className="mt-2 text-xs text-gray-400">de {usd(datos.vendidoUsd)} vendidos</p>
        </ChartCard>
      </div>

      {/* La caida, cuota por cuota */}
      <ChartCard
        title="La caida, cuota por cuota"
        subtitle="Barra gris: lo que deberia entrar. Barra de color: lo que entra de verdad."
      >
        <div className="space-y-4">
          {datos.cuotas.map((c) => {
            const pctRec = c.esperadoUsd > 0 ? (c.entraUsd / c.esperadoUsd) * 100 : 0
            const color = pctRec >= 85 ? GREEN : pctRec >= 60 ? '#F59E0B' : RED
            return (
              <div key={c.cuota}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-gray-900">
                    Cuota {c.cuota}{' '}
                    <span className="text-gray-400">
                      · {c.ventas} de {datos.aCuotas.n} pagan
                    </span>
                  </span>
                  <span className="tabular-nums text-gray-900">
                    {usd(c.entraUsd)} <span className="text-gray-400">de {usd(c.esperadoUsd)}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(pctRec, 100)}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <p className="mt-5 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
          La venta no termina cuando el agente cierra: termina en la cuota 6. El tablero que se
          proyecta en el piso muestra ventas, no plata recaudada. Las{' '}
          <b className="text-gray-700">{datos.ventasCerradas.toLocaleString('es-CO')}</b> ventas y los{' '}
          {usd(datos.vendidoUsd)} son los mismos del muro, contados sobre las llamadas del periodo. De
          esas, <b className="text-gray-700">{datos.deUnaVez.n}</b> pagaron completo (
          {usd(datos.deUnaVez.usd)}) y no aparecen arriba: esa plata ya entro. Las{' '}
          <b className="text-gray-700">{datos.aCuotas.n}</b> restantes se cobran en seis debitos, y en
          cada uno se cae el <b className="text-gray-700">{Math.round(datos.tasaCaida * 100)}%</b> que
          rebota y nadie recupera, segun el recobro real de abajo. El muro reparte con esta misma
          regla.
        </p>
      </ChartCard>

      {/* Debitos que rebotaron */}
      <ChartCard
        title="Debitos que rebotaron"
        subtitle="Un debito que rebota por fondos insuficientes no es operacion del dia, es cobranza."
      >
        {datos.recobro.dias === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">
            Sin debitos rebotados registrados.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {/* Las dos escalas juntas: el dia solo no deja ver el tamaño del
                hueco, y el acumulado solo esconde si hoy fue un mal dia.
                `hoy` es HOY: antes se tomaba la fila mas reciente de la tabla y,
                con la historia sembrada hasta el dia de la presentacion, esa
                fila era del futuro. */}
            <StatHero
              label="Rebotaron hoy"
              value={datos.recobro.hoy ? String(datos.recobro.hoy.debitosRebotados) : '—'}
            />
            <StatHero
              label="Rebotaron en total"
              value={String(datos.recobro.acumulado.debitosRebotados)}
              suffix={`en ${datos.recobro.dias} ${datos.recobro.dias === 1 ? 'dia' : 'dias'}`}
            />
            <StatHero
              label="En riesgo"
              value={usd(datos.recobro.acumulado.montoEnRiesgoUsd)}
            />
          </div>
        )}
        <p className="mt-5 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
          {datos.recobro.hoy
            ? `${datos.recobro.hoy.pendientesRecobro} sin volver a llamar hoy · `
            : 'Sin registro del dia · '}
          {datos.recobro.acumulado.pendientesRecobro} pendientes de recobro en total. Cuando el debito
          no pasa por fondos insuficientes, alguien tiene que volver a llamar. Si nadie llama, el
          cliente deja de pagar y el servicio se suspende: la venta no solo deja de recaudar, se cae.
        </p>
      </ChartCard>

      {/* Banderas criticas abiertas */}
      <AlertCard
        title="Banderas criticas abiertas"
        items={datos.criticasAbiertas.map((b) => ({
          label: `${b.codigo} · ${b.titulo}`,
          badges: [{ text: `${b.veces} veces`, variant: 'red' as const }],
        }))}
        emptyMessage="Sin banderas criticas registradas en el periodo."
      />

      {datos.criticasAbiertas.length > 0 && (
        <ChartCard title="Por que concentra la exposicion" subtitle="">
          <MiniTable
            columns={[
              { key: 'codigo', label: 'Codigo' },
              { key: 'titulo', label: 'Hallazgo' },
              { key: 'veces', label: 'Veces', align: 'right' },
            ]}
            data={datos.criticasAbiertas.map((b) => ({
              codigo: b.codigo,
              titulo: b.titulo,
              veces: b.veces.toLocaleString('es-CO'),
            }))}
          />
          <p className="mt-4 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
            La llamada se anuncia como grabada, y esa misma grabacion es la que contiene los datos de
            tarjeta. El registro que se conserva para protegerse concentra la exposicion.
          </p>
        </ChartCard>
      )}

      <p className="border-t border-gray-100 pt-4 text-xs text-gray-400">
        {DISCLAIMER_BANDERAS} Cifras de demostracion.
      </p>
    </div>
  )
}
