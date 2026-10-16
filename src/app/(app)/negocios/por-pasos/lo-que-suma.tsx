'use client'

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { pesos } from '@/lib/cotizaciones/tarjeta-opcion'
import type { RenglonQueSuma } from '@/lib/cotizaciones/por-pasos-vista'

/**
 * «Lo que suma» (diseño, secciones 1 y 10): cada servicio con lo que aporta a la Recomendada, lo
 * que no suma tachado con su razón, y el total de la cotización. En pantalla ancha es una columna
 * fija a la izquierda; en celular, una barra abajo con el total que abre la lista en una hoja.
 *
 * La cifra es la del servidor (P2 y P3): sale de la misma cascada que guarda `valor_total`.
 *
 * Se puede ocultar (brief del 2026-10-16): cerrada, la cotización usa todo el ancho y en el
 * encabezado del negocio queda una pastilla «Total $X · margen Y %» que abre la lista como panel
 * ENCIMA de la cotización (no la empuja). Por defecto cerrada por debajo de 1500 px y abierta desde
 * ahí; lo que cada persona elija («Ocultar» o «Fijar a la izquierda») se guarda en este navegador.
 * En celular (< 1024 px) nada cambia: barra abajo y hoja.
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
  /** Cuántas cosas rojas impiden enviar: el MISMO conteo de la barra de pasos y la lista (H7). */
  rojos: number
}

/**
 * Lo que eligió la persona para la columna. `null` = no ha elegido (o no se pudo leer): manda el
 * ancho de la ventana, resuelto en CSS para que no haya salto al cargar.
 */
export type PreferenciaLoQueSuma = 'abierta' | 'cerrada' | null

export const CLAVE_LO_QUE_SUMA = 'one.cotizacion.lo-que-suma'

function leerPreferencia(): PreferenciaLoQueSuma {
  try {
    const v = window.localStorage.getItem(CLAVE_LO_QUE_SUMA)
    return v === 'abierta' || v === 'cerrada' ? v : null
  } catch {
    return null
  }
}

/**
 * La preferencia de la columna, leída de `localStorage` después de montar: el servidor no la
 * conoce, así que el primer pintado es el de la regla del ancho, igual en los dos lados.
 */
export function usePreferenciaLoQueSuma() {
  const [preferencia, setPreferencia] = useState<PreferenciaLoQueSuma>(null)
  useEffect(() => { setPreferencia(leerPreferencia()) }, [])
  const elegir = (p: 'abierta' | 'cerrada') => {
    setPreferencia(p)
    try { window.localStorage.setItem(CLAVE_LO_QUE_SUMA, p) } catch { /* sin almacenamiento: vale por esta visita */ }
  }
  return { preferencia, elegir }
}

/**
 * Las clases que dependen de la preferencia. Columna y rejilla van SIEMPRE juntas: con la columna
 * escondida y la rejilla de dos columnas, la cotización caería en la de 260 px.
 */
export function clasesLoQueSuma(p: PreferenciaLoQueSuma) {
  if (p === 'abierta') return { rejilla: 'lg:grid-cols-[260px_minmax(0,1fr)]', columna: 'lg:flex', pastilla: 'hidden' }
  if (p === 'cerrada') return { rejilla: '', columna: '', pastilla: 'hidden lg:block' }
  return {
    rejilla: 'min-[1500px]:grid-cols-[260px_minmax(0,1fr)]',
    columna: 'min-[1500px]:flex',
    pastilla: 'hidden lg:block min-[1500px]:hidden',
  }
}

const margenTexto = (m: number) => `${String(Math.round(m * 10) / 10).replace('.', ',')} %`

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
        {d.margenPct !== null && `Margen ${margenTexto(d.margenPct)} · `}costo {pesos(d.costo)}
        {d.otrasQueVan.length > 0 && <><br />También van: {d.otrasQueVan.map(o => `${o.nombre} ${pesos(o.precio)}`).join(' · ')}</>}
      </p>
    </>
  )
}

const TITULO = <>Lo que suma <span className="text-xs font-semibold text-[#6E6A62]">Recomendada</span></>
const BOTON_SUAVE = 'shrink-0 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-xs font-semibold text-[#6E6A62] hover:bg-[#F3F1EC] hover:text-[#191713]'

export function LoQueSuma({
  datos,
  preferencia = null,
  onElegir = () => {},
  encabezado = null,
}: {
  datos: DatosLoQueSuma
  preferencia?: PreferenciaLoQueSuma
  onElegir?: (p: 'abierta' | 'cerrada') => void
  /** El encabezado fijo del negocio, donde va la pastilla. Sin marco, la pastilla va arriba de la cotización. */
  encabezado?: RefObject<HTMLDivElement | null> | null
}) {
  const [abierta, setAbierta] = useState(false)
  const clases = clasesLoQueSuma(preferencia)
  const contenido = datos.renglones.length === 0
    ? <p className="m-0 text-[13px] text-[#6E6A62]">Cada servicio que aceptes aparece aquí con lo que aporta a la Recomendada. Lo que no suma sale tachado, con la razón.</p>
    : <Lista d={datos} />
  return (
    <>
      {/* Pantalla ancha: columna fija a la izquierda, cuando está abierta. */}
      <aside
        aria-label="Lo que suma"
        data-lo-que-suma
        className={`sticky top-2 hidden max-h-[calc(100vh-1rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#E2DED5] bg-white p-3 ${clases.columna}`}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="m-0 flex items-baseline gap-2 text-[15px] font-bold">{TITULO}</h2>
          <button type="button" onClick={() => onElegir('cerrada')} className={BOTON_SUAVE} data-ocultar-suma>
            Ocultar
          </button>
        </div>
        {contenido}
      </aside>
      <PastillaLoQueSuma datos={datos} clase={clases.pastilla} encabezado={encabezado} onFijar={() => onElegir('abierta')}>
        {contenido}
      </PastillaLoQueSuma>
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
          <h2 className="m-0 text-[15px] font-bold">{TITULO}</h2>
          <Lista d={datos} />
        </div>
      )}
    </>
  )
}

/**
 * La pastilla del encabezado y su panel. El panel es no modal: se cierra con ✕, con Esc o con un
 * clic afuera, y al cerrarse con ✕ o Esc el foco vuelve a la pastilla.
 */
function PastillaLoQueSuma({
  datos,
  clase,
  encabezado,
  onFijar,
  children,
}: {
  datos: DatosLoQueSuma
  clase: string
  encabezado: RefObject<HTMLDivElement | null> | null
  onFijar: () => void
  children: ReactNode
}) {
  const [panel, setPanel] = useState(false)
  // El encabezado existe recién después de montar: el portal espera a tenerlo.
  const [destino, setDestino] = useState<HTMLElement | null>(null)
  useEffect(() => { setDestino(encabezado?.current ?? null) }, [encabezado])
  const caja = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const botonCerrar = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!panel) return
    botonCerrar.current?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setPanel(false)
      boton.current?.focus()
    }
    const afuera = (e: Event) => { if (caja.current && !caja.current.contains(e.target as Node)) setPanel(false) }
    document.addEventListener('keydown', tecla)
    document.addEventListener('pointerdown', afuera)
    return () => {
      document.removeEventListener('keydown', tecla)
      document.removeEventListener('pointerdown', afuera)
    }
  }, [panel])

  // El punto rojo: lo rojo de la lista (el conteo H7 de la barra) y los pantallazos sin aceptar.
  const conRojo = datos.rojos > 0 || datos.pantallazosEnBandeja > 0
  const porQueRojo = [
    datos.rojos > 0 ? `${datos.rojos} ${datos.rojos === 1 ? 'cosa impide' : 'cosas impiden'} enviar` : null,
    datos.pantallazosEnBandeja > 0 ? `${datos.pantallazosEnBandeja} ${datos.pantallazosEnBandeja === 1 ? 'pantallazo' : 'pantallazos'} sin aceptar` : null,
  ].filter(Boolean).join(' · ')

  const pastilla = (
    <div
      ref={caja}
      className={destino ? `absolute bottom-2 right-0 z-10 ${clase}` : `relative justify-self-end ${clase}`}
      data-pastilla-suma
    >
      <button
        ref={boton}
        type="button"
        onClick={() => setPanel(v => !v)}
        aria-expanded={panel}
        aria-controls={panel ? id : undefined}
        aria-haspopup="dialog"
        title={porQueRojo || undefined}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-white px-3 py-1 text-[13px] text-[#191713] shadow-[0_1px_2px_rgba(25,23,19,.06)] hover:bg-[#F8F7F3] ${panel ? 'border-[#0E5C43]' : 'border-[#CFCAC0]'}`}
      >
        {conRojo && <span className="h-2 w-2 shrink-0 rounded-full bg-[#B3382C]" data-punto-rojo aria-hidden />}
        <span>
          Total <b className="tabular-nums">{pesos(datos.total)}</b>
          {datos.margenPct !== null && <> · margen <b className="tabular-nums">{margenTexto(datos.margenPct)}</b></>}
        </span>
        {conRojo && <span className="sr-only">. {porQueRojo}</span>}
      </button>
      {panel && (
        <div
          id={id}
          role="dialog"
          aria-label="Lo que suma"
          className="absolute right-0 top-[calc(100%+8px)] flex max-h-[calc(100dvh-var(--alto-encabezado-negocio,0px)-2rem)] w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#E2DED5] bg-white p-3 text-left shadow-[0_10px_30px_rgba(0,0,0,.18)]"
          data-panel-suma
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="m-0 flex items-baseline gap-2 text-[15px] font-bold">{TITULO}</h2>
            <span className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => { setPanel(false); onFijar() }} className={BOTON_SUAVE} data-fijar-suma>
                Fijar a la izquierda
              </button>
              <button
                ref={botonCerrar}
                type="button"
                aria-label="Cerrar"
                onClick={() => { setPanel(false); boton.current?.focus() }}
                className="grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-base leading-none text-[#6E6A62] hover:bg-[#F3F1EC] hover:text-[#191713]"
              >
                ✕
              </button>
            </span>
          </div>
          {children}
        </div>
      )}
    </div>
  )
  if (destino) return createPortal(pastilla, destino)
  // Con marco, hasta tener el encabezado no se pinta: pintada en la rejilla, saltaría al encabezado.
  return encabezado ? null : pastilla
}
