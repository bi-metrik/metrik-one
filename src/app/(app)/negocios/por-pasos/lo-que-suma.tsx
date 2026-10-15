'use client'

import { useState } from 'react'

import { pesos } from '@/lib/cotizaciones/tarjeta-opcion'
import type { RenglonQueSuma } from '@/lib/cotizaciones/por-pasos-vista'

/**
 * «Lo que suma» (diseño, secciones 1 y 10): cada servicio con lo que aporta a la Recomendada, lo
 * que no suma tachado con su razón, y el total de la cotización. En pantalla ancha es una columna
 * fija a la izquierda; en celular, una barra abajo con el total que abre la lista en una hoja.
 *
 * La cifra es la del servidor (P2 y P3): sale de la misma cascada que guarda `valor_total`.
 */

export interface DatosLoQueSuma {
  renglones: RenglonQueSuma[]
  nombreDeOpcion: (id: string) => string
  faltaPrecio: (id: string) => string | null
  total: number
  costo: number
  margenPct: number | null
  otrasQueVan: { nombre: string; precio: number }[]
  pantallazosEnBandeja: number
  incompleto: boolean
}

function Lista({ d }: { d: DatosLoQueSuma }) {
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {d.renglones.map(r => {
          const falta = r.opcionId ? d.faltaPrecio(r.opcionId) : null
          // H8 · cada otra opción en su línea y con la tarifa ADELANTE: los nombres ya traen « · ciudad»,
          // y pegados con otro «·» se leían como una sola cosa («POSADA · PROVIDENCIA · CABAÑAS…»).
          const otras = r.otras.map(o => (o.tarifas.length > 0
            ? `En ${o.tarifas.join(' y ')}: ${d.nombreDeOpcion(o.opcionId)}`
            : `En ninguna tarifa: ${d.nombreDeOpcion(o.opcionId)}`))
          return (
            <li key={r.grupo} className="text-[13px]" data-renglon-suma={r.grupo} data-no-suma={r.noSuma ? 'si' : undefined}>
              <span className="flex items-baseline justify-between gap-2">
                <span className={`flex min-w-0 items-center gap-1.5 ${r.noSuma ? 'text-[#6E6A62] line-through' : 'text-[#191713]'}`}>
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--tipo-${r.tipo})` }} />
                  <span className="truncate">{r.nombre}</span>
                </span>
                <span className={`shrink-0 tabular-nums ${r.noSuma ? 'text-[#6E6A62] line-through' : 'font-semibold'}`}>
                  {r.sinCosto ? <b className="text-[#B3382C]">sin costo</b> : pesos(r.precio)}
                </span>
              </span>
              <small className="block pl-3.5 text-[11.5px] text-[#6E6A62]">
                {r.noSuma ?? (r.opcionId ? d.nombreDeOpcion(r.opcionId) : '')}
                {falta && <span className="font-semibold text-[#B3382C]"> · {falta}</span>}
                {!r.noSuma && otras.map(o => <span key={o} className="block" data-otra-opcion>{o}</span>)}
              </small>
            </li>
          )
        })}
      </ul>
      {d.pantallazosEnBandeja > 0 && (
        <p className="m-0 rounded-lg bg-[#FBF1E2] px-2.5 py-1.5 text-xs text-[#9A5F0C]">
          {d.pantallazosEnBandeja} {d.pantallazosEnBandeja === 1 ? 'pantallazo' : 'pantallazos'} en la bandeja todavía no suman.
        </p>
      )}
      <div className="flex items-baseline justify-between gap-2 border-t-2 border-[#191713] pt-2" data-total-suma>
        <span className="text-sm font-semibold">
          Total de la cotización
          {d.incompleto && <small className="block text-[11px] font-semibold text-[#B3382C]">incompleto: falta un precio</small>}
        </span>
        <b className="text-lg tabular-nums">{pesos(d.total)}</b>
      </div>
      <p className="m-0 text-xs text-[#6E6A62]">
        {d.margenPct !== null && `Margen ${String(Math.round(d.margenPct * 10) / 10).replace('.', ',')} % · `}costo {pesos(d.costo)}
        {d.otrasQueVan.length > 0 && <><br />También van: {d.otrasQueVan.map(o => `${o.nombre} ${pesos(o.precio)}`).join(' · ')}</>}
      </p>
    </>
  )
}

export function LoQueSuma({ datos }: { datos: DatosLoQueSuma }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      {/* Pantalla ancha: columna fija a la izquierda. */}
      <aside
        aria-label="Lo que suma"
        data-lo-que-suma
        className="sticky top-2 hidden max-h-[calc(100vh-1rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#E2DED5] bg-white p-3 lg:flex"
      >
        <h2 className="m-0 flex items-baseline gap-2 text-[15px] font-bold">
          Lo que suma <span className="text-xs font-semibold text-[#6E6A62]">Recomendada</span>
        </h2>
        {datos.renglones.length === 0
          ? <p className="m-0 text-[13px] text-[#6E6A62]">Cada servicio que aceptes aparece aquí con lo que aporta a la Recomendada. Lo que no suma sale tachado, con la razón.</p>
          : <Lista d={datos} />}
      </aside>
      {/* Celular: barra abajo con el total; «Lo que suma» abre la hoja. */}
      <div className="fixed inset-x-0 bottom-14 z-40 flex items-center gap-3 border-t border-[#E2DED5] bg-white px-4 py-2 lg:hidden" data-barra-suma>
        <span className="min-w-0 flex-1">
          <b className="block text-base tabular-nums">{pesos(datos.total)}</b>
          <small className="text-xs text-[#6E6A62]">
            Total · Recomendada{datos.pantallazosEnBandeja > 0 ? ` · ${datos.pantallazosEnBandeja} sin aceptar` : ''}
          </small>
        </span>
        <button type="button" onClick={() => setAbierta(a => !a)} className="rounded-lg border border-[#CFCAC0] bg-white px-3 py-1.5 text-[13px] font-semibold">
          {abierta ? 'Cerrar' : 'Lo que suma'}
        </button>
      </div>
      {abierta && (
        <div className="fixed inset-x-0 bottom-[7.5rem] z-40 flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-t-2xl border border-[#E2DED5] bg-white p-4 shadow-[0_-10px_30px_rgba(0,0,0,.2)] lg:hidden">
          <h2 className="m-0 text-[15px] font-bold">Lo que suma <span className="text-xs font-semibold text-[#6E6A62]">Recomendada</span></h2>
          <Lista d={datos} />
        </div>
      )}
    </>
  )
}
