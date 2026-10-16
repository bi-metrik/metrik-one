'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { pesos } from '@/lib/cotizaciones/tarjeta-opcion'
import type { RenglonQueSuma } from '@/lib/cotizaciones/por-pasos-vista'

import { ubicarPastilla, type Caja, type RenglonPastilla, type TextoPastilla, type UbicacionPastilla } from './ubicar-pastilla'

/**
 * «Lo que suma» (diseño, secciones 1 y 10): cada servicio con lo que aporta a la Recomendada, lo
 * que no suma tachado con su razón, y el total de la cotización. En pantalla ancha es una columna
 * fija a la izquierda; en celular, una barra abajo con el total que abre la lista en una hoja.
 *
 * La cifra es la del servidor (P2 y P3): sale de la misma cascada que guarda `valor_total`.
 *
 * Se puede ocultar (brief del 2026-10-16): cerrada, la cotización usa todo el ancho y en el
 * encabezado del negocio queda una pastilla «Total $X · margen Y %» que abre la lista como panel
 * ENCIMA de la cotización (no la empuja). Por defecto cerrada en todo escritorio (decisión de Noor,
 * 2026-10-16: no hay tres columnas, así que abierta deja la cotización en 404 px a cualquier ancho);
 * quien la quiera la deja fija, y lo que cada persona elija («Ocultar» en la columna o «Dejar fija»
 * en el panel) se guarda en este navegador.
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
 * Lo que eligió la persona para la columna. `null` = no ha elegido (o no se pudo leer): cerrada.
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

// Otra pestaña que cambia la preferencia avisa por `storage`; esta pestaña avisa a mano.
const oyentes = new Set<() => void>()
function suscribir(avisar: () => void) {
  oyentes.add(avisar)
  window.addEventListener('storage', avisar)
  return () => {
    oyentes.delete(avisar)
    window.removeEventListener('storage', avisar)
  }
}

/**
 * La preferencia de la columna. El servidor no la conoce (`null`): el primer pintado es el de
 * siempre (cerrada), igual en los dos lados, y después manda lo guardado. Si no se puede guardar, lo
 * elegido vale mientras la pantalla esté abierta.
 */
export function usePreferenciaLoQueSuma() {
  const guardada = useSyncExternalStore(suscribir, leerPreferencia, () => null)
  const [elegida, setElegida] = useState<PreferenciaLoQueSuma>(null)
  const elegir = (p: 'abierta' | 'cerrada') => {
    setElegida(p)
    try {
      window.localStorage.setItem(CLAVE_LO_QUE_SUMA, p)
      for (const avisar of oyentes) avisar()
    } catch { /* sin almacenamiento: vale por esta visita */ }
  }
  return { preferencia: elegida ?? guardada, elegir }
}

/**
 * Las clases que dependen de la preferencia. Columna y rejilla van SIEMPRE juntas: con la columna
 * escondida y la rejilla de dos columnas, la cotización caería en la de 260 px.
 */
export function clasesLoQueSuma(p: PreferenciaLoQueSuma) {
  if (p === 'abierta') return { rejilla: 'lg:grid-cols-[260px_minmax(0,1fr)]', columna: 'lg:flex', pastilla: 'hidden' }
  // Cerrada, elegida o por defecto: la pastilla solo en escritorio (celular tiene su barra).
  return { rejilla: '', columna: '', pastilla: 'hidden lg:block' }
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

/**
 * En celular el «+» del shell (`fab.tsx`: botón `fixed bottom-20 right-6 z-50` y sus menús, que van
 * con las mismas clases) quedaba ENCIMA del botón «Lo que suma» de la barra (observación de Vera en
 * V10, 2026-10-16). Mientras la barra existe, el «+» y sus menús suben lo que haga falta para quedar
 * 12 px por encima de ella: la barra va a 3.5rem del borde y el «+», a 5rem.
 *
 * Es una regla de CSS que pinta la propia barra, así que solo existe en la cotización por pasos: con
 * el interruptor apagado el «+» no cambia ni de lugar ni de marcado. Si se cambian esas clases del
 * FAB, la prueba `por-pasos-boton-mas-dom.test.ts` avisa.
 */
export const SELECTOR_BOTON_MAS = '.fixed.right-6.z-50'
/** Alto de la barra medido en Chromium a 390 px (px). Lo corrige la medida real al montar. */
const ALTO_BARRA_INICIAL = 65
export function reglaBotonMas(altoBarra: number): string {
  return `@media (width < 64rem) { ${SELECTOR_BOTON_MAS} { translate: 0 calc(5rem - 3.5rem - ${Math.round(altoBarra)}px - 0.75rem); } }`
}

const TITULO = <>Lo que suma <span className="text-xs font-semibold text-[#6E6A62]">Recomendada</span></>
const BOTON_SUAVE = 'shrink-0 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-xs font-semibold text-[#6E6A62] hover:bg-[#F3F1EC] hover:text-[#191713]'

export function LoQueSuma({
  datos,
  preferencia = null,
  onElegir = () => {},
  encabezado,
}: {
  datos: DatosLoQueSuma
  preferencia?: PreferenciaLoQueSuma
  onElegir?: (p: 'abierta' | 'cerrada') => void
  /**
   * El encabezado fijo del negocio, donde va la pastilla: `undefined` = sin marco (la pastilla va
   * arriba de la cotización); `null` = el marco todavía no lo montó.
   */
  encabezado?: HTMLElement | null
}) {
  const [abierta, setAbierta] = useState(false)
  const clases = clasesLoQueSuma(preferencia)
  // El alto real de la barra de celular (crece si el texto de abajo se parte): el «+» sube sobre ella.
  const barra = useRef<HTMLDivElement>(null)
  const [altoBarra, setAltoBarra] = useState(ALTO_BARRA_INICIAL)
  useEffect(() => {
    const el = barra.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (el.offsetHeight > 0) setAltoBarra(el.offsetHeight) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
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
      <div ref={barra} className="fixed inset-x-0 bottom-14 z-40 flex items-center gap-3 border-t border-[#E2DED5] bg-white px-4 py-2 lg:hidden" data-barra-suma>
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
      <style data-boton-mas-sobre-barra>{reglaBotonMas(altoBarra)}</style>
      {abierta && (
        // Abajo deja libre lo que el «+», ya subido, le tapa a la hoja: el total no queda debajo de él.
        <div
          className="fixed inset-x-0 bottom-[7.5rem] z-40 flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-t-2xl border border-[#E2DED5] bg-white p-4 shadow-[0_-10px_30px_rgba(0,0,0,.2)] lg:hidden"
          style={{ paddingBottom: Math.round(altoBarra) + 12 }}
          data-hoja-suma
        >
          <h2 className="m-0 text-[15px] font-bold">{TITULO}</h2>
          <Lista d={datos} />
        </div>
      )}
    </>
  )
}


/** Alto de la pastilla en el encabezado: el del renglón del viaje (brief del 2026-10-16). */
const ALTO_PASTILLA = 20

/** Lo que se ve en el encabezado y la pastilla no puede tapar: líneas de texto y cajas pintadas. */
function obstaculosDelEncabezado(encabezado: HTMLElement, pastilla: HTMLElement): Caja[] {
  const cajas: Caja[] = []
  const agregar = (r: DOMRect) => { if (r.width > 0 && r.height > 0) cajas.push({ x: r.left, y: r.top, r: r.right, b: r.bottom }) }
  const textos = document.createTreeWalker(encabezado, NodeFilter.SHOW_TEXT)
  for (let n = textos.nextNode(); n; n = textos.nextNode()) {
    if (!n.textContent?.trim() || pastilla.contains(n)) continue
    const rango = document.createRange()
    rango.selectNodeContents(n)
    // La caja de una línea de texto trae el aire de la fuente arriba y abajo; lo que se ve cabe en
    // su caja «em» (alto = tamaño de letra), centrada.
    const tamano = parseFloat(getComputedStyle(n.parentElement ?? encabezado).fontSize) || 0
    for (const r of rango.getClientRects()) {
      const aire = Math.max(0, (r.height - tamano) / 2)
      agregar(new DOMRect(r.left, r.top + aire, r.width, r.height - 2 * aire))
    }
  }
  for (const el of encabezado.querySelectorAll<HTMLElement>('*')) {
    if (pastilla.contains(el)) continue
    const e = getComputedStyle(el)
    const pintada = e.backgroundColor !== 'rgba(0, 0, 0, 0)' && e.backgroundColor !== 'transparent'
    const borde = parseFloat(e.borderTopWidth) > 0 || parseFloat(e.borderLeftWidth) > 0
    if (pintada || borde || el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'svg') agregar(el.getBoundingClientRect())
  }
  return cajas
}

/**
 * La altura en la que se centra la pastilla dentro de un renglón: el centro de su caja si el texto
 * va en una línea; el de su última línea si se partió.
 */
function centroDelRenglon(el: HTMLElement): number {
  const caja = el.getBoundingClientRect()
  const rango = document.createRange()
  rango.selectNodeContents(el)
  const lineas = [...rango.getClientRects()].filter(r => r.width > 0 && r.height > 0)
  const ultima = lineas.reduce<DOMRect | null>((a, b) => (!a || b.bottom > a.bottom ? b : a), null)
  const enUnaLinea = !ultima || lineas.every(l => l.top < ultima.bottom && l.bottom > ultima.top)
  return enUnaLinea ? (caja.top + caja.bottom) / 2 : (ultima.top + ultima.bottom) / 2
}

/**
 * Mide el encabezado y decide dónde va la pastilla (`ubicarPastilla`). `null` = no hay hueco, o el
 * encabezado no tiene la forma que se espera.
 */
interface PastillaUbicada {
  renglon: UbicacionPastilla['renglon']
  texto: TextoPastilla
  /** Posición dentro del encabezado (px desde su esquina de arriba a la izquierda). */
  left: number
  top: number
  /** Dónde arranca el panel, respecto de la pastilla: alineado a su derecha, sin salirse del encabezado. */
  panelIzquierda: number
}

/** Ancho del panel de «Lo que suma» (px), el de la clase `w-[340px]`. */
const ANCHO_PANEL = 340

/** El ancho de la pastilla con cada texto: su marco (borde, relleno, punto) más el texto medido. */
function medirAnchos(boton: HTMLElement, reglas: Record<TextoPastilla, HTMLElement | null>): Record<TextoPastilla, number> | null {
  const visible = boton.querySelector<HTMLElement>('[data-texto-pastilla]')
  if (!visible || boton.offsetWidth === 0) return null
  const marco = boton.offsetWidth - visible.offsetWidth
  return {
    largo: marco + (reglas.largo?.offsetWidth ?? 0),
    corto: marco + (reglas.corto?.offsetWidth ?? 0),
    total: marco + (reglas.total?.offsetWidth ?? 0),
  }
}

/** La fila de arriba del encabezado, [estado | botones], y la caja de los botones. */
function filaDeBotones(encabezado: HTMLElement): { fila: HTMLElement; botones: HTMLElement } | null {
  const fila = encabezado.firstElementChild as HTMLElement | null
  if (!fila || fila.hasAttribute('data-pastilla-suma') || fila.children.length < 2) return null
  return { fila, botones: fila.lastElementChild as HTMLElement }
}

/** Decide dónde va la pastilla (`pastilla` no cuenta como obstáculo). `null` = no hay hueco. */
function medirUbicacion(encabezado: HTMLElement, pastilla: HTMLElement, anchos: Record<TextoPastilla, number>): PastillaUbicada | null {
  const enc = encabezado.getBoundingClientRect()
  const estilo = getComputedStyle(encabezado)
  const izquierda = enc.left + parseFloat(estilo.paddingLeft || '0')
  const derecha = enc.right - parseFloat(estilo.paddingRight || '0')
  // Dentro del encabezado, sin pisar su borde de abajo.
  const techo = enc.top + 2
  const piso = enc.bottom - parseFloat(estilo.borderBottomWidth || '0') - 2

  const renglones: RenglonPastilla[] = []
  // Su renglón: el del viaje; si el negocio no lo tiene (V8), el del título.
  const propio = encabezado.querySelector<HTMLElement>('[data-encabezado-viaje]') ?? encabezado.querySelector<HTMLElement>('h1')
  if (propio) {
    const r = propio.getBoundingClientRect()
    const siguiente = propio.nextElementSibling
    const esUltimo = !siguiente || siguiente === pastilla || pastilla.contains(siguiente) || siguiente.hasAttribute('data-pastilla-suma')
    renglones.push({ nombre: 'inicio', derecha, centro: centroDelRenglon(propio), arriba: Math.max(techo, r.top - 2), abajo: esUltimo ? piso : r.bottom + 2 })
  }
  // El de los botones: la primera fila del encabezado es [estado | botones].
  const filaB = filaDeBotones(encabezado)
  if (filaB) {
    const f = filaB.fila.getBoundingClientRect()
    const b = filaB.botones.getBoundingClientRect()
    renglones.push({ nombre: 'botones', derecha: b.left - 8, centro: (b.top + b.bottom) / 2, arriba: Math.max(techo, f.top - 2), abajo: f.bottom + 2 })
  }
  const u = ubicarPastilla({ anchos, alto: ALTO_PASTILLA, renglones, obstaculos: obstaculosDelEncabezado(encabezado, pastilla), izquierda })
  if (!u) return null
  return {
    renglon: u.renglon,
    texto: u.texto,
    left: u.x - enc.left,
    top: u.y - enc.top,
    panelIzquierda: Math.max(izquierda - u.x, u.ancho - ANCHO_PANEL),
  }
}

/**
 * La pastilla del encabezado y su panel. El panel es no modal: se cierra con ✕, con Esc o con un
 * clic afuera, y al cerrarse con ✕ o Esc el foco vuelve a la pastilla.
 *
 * En el encabezado va ENCIMA (posición absoluta), en el hueco libre que elige `ubicarPastilla`:
 * así el encabezado fijo mide lo mismo con ella que sin ella (D1 y D2 de Vera, 2026-10-16). Mide
 * 20 px, como el renglón del viaje.
 *
 * Si no hay hueco en ningún renglón, flota a la derecha al final del encabezado, como en #1193 (y
 * el encabezado crece). Medido el 2026-10-16: solo pasa SIN línea de viaje (V8) entre ~1040 y
 * ~1080 px. Meterla en el flujo de la fila de los botones, como pide la regla, monta la etiqueta de
 * la etapa debajo de la pastilla (la fila de estado se encoge por debajo de su mínimo).
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
  encabezado: HTMLElement | null | undefined
  onFijar: () => void
  children: ReactNode
}) {
  const [panel, setPanel] = useState(false)
  const destino = encabezado ?? null
  const caja = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const botonCerrar = useRef<HTMLButtonElement>(null)
  const reglaLarga = useRef<HTMLSpanElement>(null)
  const reglaCorta = useRef<HTMLSpanElement>(null)
  const reglaTotal = useRef<HTMLSpanElement>(null)
  const id = useId()

  // `undefined` = sin medir todavía; `null` = medido y sin hueco (flota al final, como en #1193).
  const [ubicacion, setUbicacion] = useState<PastillaUbicada | null | undefined>(undefined)
  useLayoutEffect(() => {
    if (!destino || typeof ResizeObserver === 'undefined') return
    let cuadro = 0
    const medir = () => {
      const c = caja.current
      const b = boton.current
      if (!c || !b) return
      const anchos = medirAnchos(b, { largo: reglaLarga.current, corto: reglaCorta.current, total: reglaTotal.current })
      if (!anchos) return // escondida (celular): no hay nada que ubicar
      // Se mide el encabezado con la pastilla FUERA del flujo aunque esté flotando: si no, el que se
      // mide es el que ella misma agrandó.
      const antes = c.style.position
      c.style.position = 'absolute'
      const u = medirUbicacion(destino, c, anchos)
      c.style.position = antes
      setUbicacion(prev => (
        prev && u && prev.renglon === u.renglon && prev.texto === u.texto && Math.abs(prev.left - u.left) < 0.5 && Math.abs(prev.top - u.top) < 0.5 ? prev : u
      ))
    }
    const pedir = () => { cancelAnimationFrame(cuadro); cuadro = requestAnimationFrame(medir) }
    medir()
    const ro = new ResizeObserver(pedir)
    ro.observe(destino)
    for (const hijo of destino.children) if (!hijo.hasAttribute('data-pastilla-suma')) ro.observe(hijo)
    if (caja.current) ro.observe(caja.current)
    window.addEventListener('resize', pedir)
    document.fonts?.addEventListener?.('loadingdone', pedir)
    return () => {
      cancelAnimationFrame(cuadro)
      ro.disconnect()
      window.removeEventListener('resize', pedir)
      document.fonts?.removeEventListener?.('loadingdone', pedir)
    }
  }, [destino])

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

  // El punto, con los colores de la barra y la lista (decisión de Noor, 2026-10-16): rojo si algo
  // impide enviar (el conteo H7); ámbar si solo hay pantallazos sin aceptar. Con los dos, rojo.
  const punto = datos.rojos > 0 ? 'rojo' : datos.pantallazosEnBandeja > 0 ? 'ambar' : null
  const conRojo = punto !== null
  const porQueRojo = [
    datos.rojos > 0 ? `${datos.rojos} ${datos.rojos === 1 ? 'cosa impide' : 'cosas impiden'} enviar` : null,
    datos.pantallazosEnBandeja > 0 ? `${datos.pantallazosEnBandeja} ${datos.pantallazosEnBandeja === 1 ? 'pantallazo' : 'pantallazos'} sin aceptar` : null,
  ].filter(Boolean).join(' · ')

  const margen = datos.margenPct !== null ? margenTexto(datos.margenPct) : null
  // En el encabezado el texto sale de la medida (antes de pintar). Sin hueco, «$X · Y %», como en
  // #1193; sin encabezado (o sin medir, como en el servidor), el largo.
  const texto: TextoPastilla = ubicacion === null ? 'corto' : ubicacion?.texto ?? 'largo'
  const enEncabezado = destino !== null
  const encima = enEncabezado && ubicacion !== null
  const posicion = encima ? { left: ubicacion?.left ?? 0, top: ubicacion?.top ?? 0 } : undefined
  const panelIzquierda = encima && ubicacion ? ubicacion.panelIzquierda : undefined

  const pastilla = (
    <div
      ref={caja}
      className={
        !enEncabezado ? `relative justify-self-end ${clase}`
          : encima ? `absolute z-10 ${ubicacion === undefined ? 'invisible' : ''} ${clase}`
            : `relative z-10 float-right ml-3 mt-1 ${clase}`
      }
      style={posicion}
      data-pastilla-suma
      data-renglon={enEncabezado && ubicacion !== undefined ? (ubicacion?.renglon ?? 'sin-hueco') : undefined}
    >
      <button
        ref={boton}
        type="button"
        onClick={() => setPanel(v => !v)}
        aria-expanded={panel}
        aria-controls={panel ? id : undefined}
        aria-haspopup="dialog"
        title={porQueRojo || undefined}
        className={`relative items-center gap-1.5 whitespace-nowrap rounded-full border bg-white text-[#191713] shadow-[0_1px_2px_rgba(25,23,19,.06)] hover:bg-[#F8F7F3] ${enEncabezado ? 'flex h-5 px-2.5 text-xs leading-4' : 'inline-flex px-3 py-1 text-[13px]'} ${panel ? 'border-[#0E5C43]' : 'border-[#CFCAC0]'}`}
      >
        {punto && <span className={`h-2 w-2 shrink-0 rounded-full ${punto === 'rojo' ? 'bg-[#B3382C]' : 'bg-[#D08A1C]'}`} data-punto={punto} aria-hidden />}
        {texto === 'largo' ? (
          <span data-texto-pastilla="largo">
            Total <b className="tabular-nums">{pesos(datos.total)}</b>
            {margen !== null && <> · margen <b className="tabular-nums">{margen}</b></>}
          </span>
        ) : texto === 'corto' ? (
          <span data-texto-pastilla="corto">
            <span className="sr-only">Total </span><b className="tabular-nums">{pesos(datos.total)}</b>
            {margen !== null && <> · <span className="sr-only">margen </span><b className="tabular-nums">{margen}</b></>}
          </span>
        ) : (
          <span data-texto-pastilla="total">
            <span className="sr-only">Total </span><b className="tabular-nums">{pesos(datos.total)}</b>
            {margen !== null && <span className="sr-only">, margen {margen}</span>}
          </span>
        )}
        {/* Los tres textos, invisibles, para medir cuál cabe. */}
        <span ref={reglaLarga} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap">
          Total <b>{pesos(datos.total)}</b>{margen !== null && <> · margen <b>{margen}</b></>}
        </span>
        <span ref={reglaCorta} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap">
          <b>{pesos(datos.total)}</b>{margen !== null && <> · <b>{margen}</b></>}
        </span>
        <span ref={reglaTotal} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap">
          <b>{pesos(datos.total)}</b>
        </span>
        {conRojo && <span className="sr-only">. {porQueRojo}</span>}
      </button>
      {panel && (
        <div
          id={id}
          role="dialog"
          aria-label="Lo que suma"
          className={`absolute top-[calc(100%+8px)] flex max-h-[calc(100dvh-var(--alto-encabezado-negocio,0px)-2rem)] w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#E2DED5] bg-white p-3 text-left shadow-[0_10px_30px_rgba(0,0,0,.18)] ${panelIzquierda === undefined ? 'right-0' : ''}`}
          style={panelIzquierda === undefined ? undefined : { left: panelIzquierda }}
          data-panel-suma
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="m-0 flex items-baseline gap-2 whitespace-nowrap text-[15px] font-bold">{TITULO}</h2>
            <span className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => { setPanel(false); onFijar() }} className={BOTON_SUAVE} data-fijar-suma>
                Dejar fija
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
  // En el encabezado va ENCIMA, en el hueco que se midió. Sin hueco, flota a la derecha al final
  // (el `clear` hace que el encabezado la contenga).
  if (destino) return createPortal(<>{pastilla}{ubicacion === null && <div className="clear-both" aria-hidden />}</>, destino)
  // Con marco, hasta tener el encabezado no se pinta: pintada en la rejilla, saltaría al encabezado.
  return encabezado === null ? null : pastilla
}
