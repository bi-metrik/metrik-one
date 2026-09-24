'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'

import { ajustarOpcion, elegirMonedaDeTarifa, confirmarTarifaPorPasajero } from '@/app/(app)/negocios/tarifa-pax-actions'
import { agregarAdicional, actualizarAdicional, eliminarAdicional } from '@/app/(app)/negocios/adicional-actions'
import { AlertaDecision } from '@/components/viaje/alerta-decision'
import { BTN, BTN_PRIM, BTN_X, INPUT, LINK } from '@/components/viaje/estilo'
import { precioDerivadoDeAdicional, type FilaAdicional } from '@/lib/cotizaciones/adicionales'
import { margenParaPrecio, precioConMargen, type ConvencionMargen } from '@/lib/cotizaciones/precio-item'
import { MENSAJE_MONEDA_ASUMIDA, type MonedaDeTarifa, type PreciosAMano, type TarifaConfirmada } from '@/lib/cotizaciones/tarifa-pasajero'
import {
  filasDeCosto,
  mil,
  pesos,
  porcentaje,
  precioDeLineaConManuales,
  totalesDeFilas,
  type FilaCosto,
} from '@/lib/cotizaciones/tarjeta-opcion'
import { parseMontoCop } from '@/lib/negocios/monto-cop'

/**
 * «Costo y precio» de la tarjeta (prototipo del 2026-09-24): UNA tabla (Pasajero / Cant. /
 * Costo c/u / Precio c/u / Precio total), los adicionales como filas, el total y el margen, y
 * UN «Ajustar» que edita en la misma tabla el margen de la opción, la cantidad y el precio de
 * cada fila.
 *
 * Mientras se escribe en «Ajustar» la tabla se recalcula en la pantalla con la MISMA regla que
 * el servidor (`precioDeLineaConManuales`); al salir de cada casilla se guarda y la página se
 * refresca con lo que quedó.
 *
 * La cantidad de las filas de pasajeros y habitaciones es la del grupo: se ve pero no se
 * cambia aquí (cambiarla sería cotizar para otros pasajeros). La de un adicional, sí.
 */
export default function TarjetaCosto({
  itemId,
  editable,
  confirmada,
  preciosAMano,
  precioLinea,
  costoLinea,
  margenAplicado,
  convencion,
  administrativosPct,
  pisoPct,
  adicionales,
  adicionalesDisponible,
  margenCotizacion,
  moneda,
  onCambio,
}: {
  itemId: string
  editable: boolean
  /** Solo si sigue vigente: con un costo viejo no hay filas. */
  confirmada: TarifaConfirmada | null
  preciosAMano: PreciosAMano | undefined
  /** El precio de la línea que calculó la cascada, sin adicionales. */
  precioLinea: number
  costoLinea: number
  margenAplicado: number
  convencion: ConvencionMargen
  administrativosPct: number
  pisoPct: number
  adicionales: FilaAdicional[]
  adicionalesDisponible: boolean
  margenCotizacion: { margenPct: number | null; convencion: ConvencionMargen | null }
  moneda: MonedaDeTarifa
  onCambio: () => void
}) {
  const [ajustando, setAjustando] = useState(false)
  const [conAdicional, setConAdicional] = useState(false)
  const [info, setInfo] = useState(false)
  const [editandoMoneda, setEditandoMoneda] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Lo que la persona está escribiendo en «Ajustar», antes de guardar.
  const [margenEscrito, setMargenEscrito] = useState<string | null>(null)
  const [preciosEscritos, setPreciosEscritos] = useState<Record<string, string>>({})
  const [cantidadesEscritas, setCantidadesEscritas] = useState<Record<string, string>>({})

  const margenVivo = margenEscrito !== null && Number.isFinite(Number(margenEscrito.replace(',', '.')))
    ? Number(margenEscrito.replace(',', '.'))
    : margenAplicado
  const preciosVivos: PreciosAMano = { ...(preciosAMano ?? {}) }
  for (const [k, v] of Object.entries(preciosEscritos)) {
    if (k.startsWith('adicional:')) continue
    const n = parseMontoCop(v)
    if (v.trim() === '') delete preciosVivos[k]
    else if (n !== null) preciosVivos[k] = { precio: n, por: null, porId: null, en: '' }
  }
  const adicionalesVivos = adicionales.map(a => {
    const k = `adicional:${a.id}`
    const cant = cantidadesEscritas[k]
    const precio = preciosEscritos[k]
    const n = precio !== undefined ? parseMontoCop(precio) : null
    return {
      ...a,
      ...(cant !== undefined && Number.isInteger(Number(cant)) && Number(cant) > 0 ? { cantidad: Number(cant) } : {}),
      ...(precio !== undefined && precio.trim() !== '' && n !== null ? { precio: n, precio_manual: true } : {}),
      ...(precio !== undefined && precio.trim() === ''
        ? { precio: precioDerivadoDeAdicional(Number(a.costo) || 0, a.moneda ?? 'COP', margenCotizacion), precio_manual: false }
        : {}),
    }
  })

  // El precio de la línea que se está viendo: el de la cascada, o el que sale de lo escrito.
  const hayManuales = Object.keys(preciosVivos).length > 0
  const tocado = margenEscrito !== null || Object.keys(preciosEscritos).some(k => !k.startsWith('adicional:'))
  const precioVivo = !tocado
    ? precioLinea
    : confirmada && hayManuales
      ? precioDeLineaConManuales({ confirmada, preciosAMano: preciosVivos, margenPct: margenVivo, convencion, administrativosPct }) ?? precioLinea
      : Math.round(precioConMargen(costoLinea * (1 + administrativosPct / 100), margenVivo, convencion))

  const filas = filasDeCosto({ confirmada, precioLinea: precioVivo, preciosAMano: preciosVivos, adicionales: adicionalesVivos })
  const T = totalesDeFilas(filas)
  const costoTotal = filas.length > 0 ? T.costo : costoLinea
  const precioTotal = filas.length > 0 ? T.precio : precioVivo
  const margenReal = margenParaPrecio(costoTotal, precioTotal, convencion)
  const bajo = margenReal !== null && margenReal < pisoPct

  function guardar(fn: () => Promise<{ success: boolean; error?: string }>, limpiar: () => void) {
    startTransition(async () => {
      const r = await fn()
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar'); return }
      limpiar()
      onCambio()
    })
  }

  function guardarMargen() {
    if (margenEscrito === null) return
    const t = margenEscrito.trim()
    const v = t === '' ? null : Number(t.replace(',', '.'))
    if (v !== null && !Number.isFinite(v)) { setMargenEscrito(null); return }
    if (v === margenAplicado) { setMargenEscrito(null); return }
    guardar(() => ajustarOpcion(itemId, { margenPct: v }), () => setMargenEscrito(null))
  }

  function guardarPrecio(f: FilaCosto) {
    const escrito = preciosEscritos[f.clave]
    if (escrito === undefined) return
    const limpiar = () => setPreciosEscritos(p => { const n = { ...p }; delete n[f.clave]; return n })
    const n = escrito.trim() === '' ? null : parseMontoCop(escrito)
    if (escrito.trim() !== '' && n === null) { limpiar(); return }
    if (f.adicionalId) {
      guardar(() => actualizarAdicional(f.adicionalId!, { precio: n, confirmarPrecioBajo: true }), limpiar)
      return
    }
    guardar(() => ajustarOpcion(itemId, { precios: { [f.clave]: n } }), limpiar)
  }

  function guardarCantidad(f: FilaCosto) {
    const escrito = cantidadesEscritas[f.clave]
    if (escrito === undefined || !f.adicionalId) return
    const limpiar = () => setCantidadesEscritas(p => { const n = { ...p }; delete n[f.clave]; return n })
    const n = Number(escrito)
    if (!Number.isInteger(n) || n < 1 || n === f.cantidad) { limpiar(); return }
    guardar(() => actualizarAdicional(f.adicionalId!, { cantidad: n }), limpiar)
  }

  function volverAlCalculo() {
    guardar(async () => {
      const r = await ajustarOpcion(itemId, { volverACalculado: true })
      if (!r.success) return r
      // Los adicionales con precio a mano también vuelven al margen.
      for (const a of adicionales.filter(x => x.precio_manual !== false && x.id)) {
        const ra = await actualizarAdicional(a.id as string, { precio: null })
        if (!ra.success) return ra
      }
      return { success: true }
    }, () => { setMargenEscrito(null); setPreciosEscritos({}); setCantidadesEscritas({}) })
  }

  function quitarPrecioAMano(f: FilaCosto) {
    if (f.adicionalId) {
      guardar(() => actualizarAdicional(f.adicionalId!, { precio: null }), () => {})
      return
    }
    guardar(() => ajustarOpcion(itemId, { precios: { [f.clave]: null } }), () => {})
  }

  function cambiarMoneda(m: string) {
    setEditandoMoneda(false)
    guardar(async () => {
      const r = await elegirMonedaDeTarifa(itemId, m)
      if (!r.success) return r
      // La moneda cambia el costo: se confirma otra vez. Si falta la tasa, lo pide la opción.
      await confirmarTarifaPorPasajero(itemId, null)
      return { success: true }
    }, () => {})
  }

  const fila = 'grid grid-cols-[minmax(0,1.6fr)_60px_repeat(3,minmax(0,1fr))] items-center gap-2 border-t border-[#E2DED5] px-3 py-[9px] max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-2.5 max-sm:gap-y-0.5'
  const num = 'text-right tabular-nums max-sm:hidden'

  return (
    <section aria-label="Costo y precio" className="flex flex-col gap-2.5" data-costo-precio>
      <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.08em] text-[#6E6A62]">
        Costo y precio<span className="h-px flex-1 bg-[#E2DED5]" />
      </p>
      <div role="table" className="overflow-hidden rounded-lg border border-[#E2DED5]">
        <div role="row" className={`${fila} border-t-0 bg-[#F8F7F3] text-xs font-semibold text-[#6E6A62] max-sm:hidden`}>
          <span>Pasajero</span><span className="text-right">Cant.</span><span className="text-right">Costo c/u</span><span className="text-right">Precio c/u</span><span className="text-right">Precio total</span>
        </div>
        {filas.map(f => (
          <div role="row" key={f.clave} className={fila} data-fila-costo={f.clave}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{f.nombre}</span>
              {f.det && <span className="shrink-0 rounded bg-[#EEEBE4] px-[5px] py-px text-[11px] font-semibold text-[#6E6A62]">{f.det}</span>}
              {f.extra && <span className="shrink-0 rounded bg-[#EEEBE4] px-[5px] py-px text-[11px] font-semibold text-[#6E6A62]">Adicional</span>}
              {f.aMano && <span className="shrink-0 rounded bg-[#FBF1E2] px-[5px] py-px text-[11px] font-semibold text-[#9A5F0C]">a mano</span>}
              {f.bajoCosto && (
                <AlertaDecision tip="Este precio queda por debajo del costo">
                  <p className="m-0">Con {pesos(f.precioUnitario)} por {f.nombre.toLowerCase()}, esta fila vende por debajo de lo que cuesta. Súbelo o confirma que es a propósito.</p>
                  {editable && f.aMano && (
                    <span className="mt-1 flex flex-wrap gap-2">
                      <button type="button" className={BTN} onClick={() => quitarPrecioAMano(f)}>Volver al precio de ONE</button>
                    </span>
                  )}
                </AlertaDecision>
              )}
              {f.extra && editable && f.adicionalId && (
                <button
                  type="button"
                  aria-label="Quitar adicional"
                  className={BTN_X}
                  onClick={() => guardar(() => eliminarAdicional(f.adicionalId!), () => {})}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </span>
            <span className={num}>{f.cantidad}</span>
            <span className={num}>{mil(f.costoUnitario)}</span>
            <span className={num}>{mil(f.precioUnitario)}</span>
            <span className="text-right tabular-nums"><b>{mil(f.precioTotal)}</b></span>
            <span className="col-span-2 hidden text-[12.5px] tabular-nums text-[#6E6A62] max-sm:block">
              ×{f.cantidad} · {mil(f.costoUnitario)} → {mil(f.precioUnitario)} c/u
            </span>
          </div>
        ))}
        <div role="row" className={`${fila} bg-[#F8F7F3] font-bold`} data-fila-total>
          <span>Total</span>
          <span className="max-sm:hidden" />
          <span className={num}>{mil(costoTotal)}</span>
          <span className="max-sm:hidden" />
          <span className="text-right tabular-nums">{pesos(precioTotal)}</span>
          <span className="col-span-2 hidden text-[12.5px] font-normal tabular-nums text-[#6E6A62] max-sm:block">
            Costo {mil(costoTotal)} → precio {mil(precioTotal)}
          </span>
        </div>
      </div>

      {conAdicional && editable && (
        <FormAdicional
          itemId={itemId}
          margenCotizacion={margenCotizacion}
          onListo={() => { setConAdicional(false); onCambio() }}
          onCancelar={() => setConAdicional(false)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="flex items-center gap-1.5">
          {editable && adicionalesDisponible && (
            <button type="button" className={LINK} onClick={() => setConAdicional(v => !v)}>+ Adicional</button>
          )}
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-label="Qué es un adicional"
              aria-expanded={info}
              onClick={() => setInfo(v => !v)}
              className="rounded-full border-0 bg-transparent p-0.5 leading-none text-[#6E6A62]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            </button>
            {!info && (
              <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+6px)] left-0 z-40 hidden w-max max-w-[240px] rounded-md bg-[#191713] px-2 py-1.5 text-xs font-medium text-[#F3F1EC] [@media(hover:hover)]:group-hover:block">
                Solo para esta opción: no acompañan a las otras opciones.
              </span>
            )}
            {info && (
              <span className="absolute left-0 top-[calc(100%+6px)] z-[31] w-[min(300px,calc(100vw-40px))] rounded-[10px] border border-[#CFCAC0] bg-white p-3 text-[13px] shadow-[0_10px_30px_rgba(0,0,0,.18)]">
                Solo para esta opción: no acompañan a las otras opciones.
              </span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-[#6E6A62]">
          Margen <b className="tabular-nums text-[#191713]">{margenReal === null ? '—' : porcentaje(margenReal)}</b>
          {bajo && (
            <AlertaDecision tip="Con este margen necesitas autorización para enviar">
              <p className="m-0">Con un margen menor al {porcentaje(pisoPct)} la cotización no se puede enviar sin la autorización de Edgar. Súbelo o pídele la autorización.</p>
            </AlertaDecision>
          )}
          {editable && (
            <button type="button" className={BTN} aria-expanded={ajustando} onClick={() => setAjustando(v => !v)}>
              {ajustando ? 'Listo' : 'Ajustar'}
            </button>
          )}
        </span>
      </div>

      {ajustando && editable && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-[#CFCAC0] bg-[#F8F7F3] p-3" data-panel-ajustar>
          <label className="flex flex-wrap items-center gap-2 text-sm text-[#191713]">
            <span>Margen de esta opción</span>
            <input
              type="text"
              inputMode="decimal"
              className={`${INPUT} w-[70px] tabular-nums`}
              value={margenEscrito ?? String(margenAplicado).replace('.', ',')}
              onChange={e => setMargenEscrito(e.target.value)}
              onBlur={guardarMargen}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              disabled={isPending}
              aria-label="Margen de esta opción"
            />
            %
          </label>
          <div className="flex max-w-[520px] flex-col gap-1.5">
            {filas.map(f => (
              <div key={f.clave} className="grid grid-cols-[minmax(0,1.5fr)_80px_minmax(0,1fr)] items-end gap-2 max-sm:grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)]" data-ajuste-fila={f.clave}>
                <span className="pb-[7px] font-semibold">{f.nombre}</span>
                <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
                  <span>Cant.</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={`${INPUT} tabular-nums`}
                    value={cantidadesEscritas[f.clave] ?? String(f.cantidad)}
                    readOnly={!f.adicionalId}
                    onChange={e => setCantidadesEscritas(p => ({ ...p, [f.clave]: e.target.value }))}
                    onBlur={() => guardarCantidad(f)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    disabled={isPending}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
                  <span>Precio c/u</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={`${INPUT} tabular-nums`}
                    value={preciosEscritos[f.clave] ?? (f.aMano ? String(Math.round(f.precioUnitario)) : '')}
                    placeholder={String(Math.round(f.precioUnitario))}
                    onChange={e => setPreciosEscritos(p => ({ ...p, [f.clave]: e.target.value }))}
                    onBlur={() => guardarPrecio(f)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    disabled={isPending}
                  />
                </label>
              </div>
            ))}
          </div>
          <p className="m-0 text-xs text-[#6E6A62]">
            Deja el precio vacío y ONE lo saca del costo con el margen.{' '}
            <button type="button" className={LINK} onClick={volverAlCalculo} disabled={isPending}>Volver a lo que calculó ONE</button>
          </p>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-xs text-[#6E6A62]" data-moneda>
        {editandoMoneda && editable ? (
          <select
            aria-label="Moneda"
            autoFocus
            defaultValue={moneda.moneda}
            onChange={e => cambiarMoneda(e.target.value)}
            onBlur={() => setEditandoMoneda(false)}
            className="rounded-[5px] border border-[#CFCAC0] bg-white px-1 py-0.5 text-xs"
          >
            <option>COP</option>
            <option>USD</option>
          </select>
        ) : (
          <>
            <span>{moneda.moneda}{moneda.asumida ? '' : ` · ${moneda.origen === 'persona' ? 'la elegiste tú' : 'leída del pantallazo'}`}</span>
            {moneda.asumida && (
              <AlertaDecision tip={MENSAJE_MONEDA_ASUMIDA} izquierda>
                <p className="m-0">{MENSAJE_MONEDA_ASUMIDA}</p>
              </AlertaDecision>
            )}
            {editable && (
              <button type="button" aria-label="Cambiar moneda" onClick={() => setEditandoMoneda(true)} className="rounded border-0 bg-transparent p-0.5 leading-none text-[#6E6A62] hover:text-[#191713]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/** «+ Adicional»: qué es, cuántos y cuánto cuesta. El precio sale del margen de la cotización. */
function FormAdicional({
  itemId,
  margenCotizacion,
  onListo,
  onCancelar,
}: {
  itemId: string
  margenCotizacion: { margenPct: number | null; convencion: ConvencionMargen | null }
  onListo: () => void
  onCancelar: () => void
}) {
  const [nombre, setNombre] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [costo, setCosto] = useState('')
  const [isPending, startTransition] = useTransition()
  const costoNum = parseMontoCop(costo) ?? 0
  const precio = precioDerivadoDeAdicional(costoNum, 'COP', margenCotizacion)

  function agregar(e: React.FormEvent) {
    e.preventDefault()
    const cant = Math.max(1, Math.trunc(Number(cantidad) || 1))
    if (!nombre.trim() || !costoNum) return
    startTransition(async () => {
      const r = await agregarAdicional(itemId, { nombre: nombre.trim(), cantidad: cant, costo: costoNum, precio: null, moneda: 'COP' })
      if (!r.success) { toast.error(r.error ?? 'No se pudo agregar'); return }
      onListo()
    })
  }

  return (
    <form onSubmit={agregar} className="flex flex-col gap-2.5 rounded-lg border border-[#CFCAC0] bg-[#F8F7F3] p-3" data-form-adicional>
      <div className="grid grid-cols-[2fr_70px_1fr_1fr] gap-2 max-sm:grid-cols-2">
        <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62] max-sm:col-span-2">
          <span>Qué es</span>
          <input className={INPUT} placeholder="Ej.: traslado aeropuerto al hotel" value={nombre} onChange={e => setNombre(e.target.value)} required autoFocus />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
          <span>Cant.</span>
          <input className={`${INPUT} tabular-nums`} inputMode="numeric" value={cantidad} onChange={e => setCantidad(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
          <span>Costo c/u</span>
          <input className={`${INPUT} tabular-nums`} inputMode="numeric" placeholder="0" value={costo} onChange={e => setCosto(e.target.value)} required />
        </label>
        <div className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
          <span>Precio c/u (margen {porcentaje(Number(margenCotizacion.margenPct) || 0)})</span>
          <span className="py-1.5 text-sm font-semibold tabular-nums text-[#191713]">{pesos(precio)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BTN_PRIM} disabled={isPending}>Agregar</button>
        <button type="button" className={BTN} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  )
}
