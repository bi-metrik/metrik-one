'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { AlertTriangle, ImageIcon, Loader2, Package, Plane, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { crearPaqueteBloqueo, guardarPaqueteBloqueo, leerPantallazoBloqueo, type ImagenNueva } from '@/app/(app)/negocios/bloqueo-actions'
import {
  ACOMODACIONES,
  CATEGORIAS_INCLUYE,
  ETIQUETA_ACOMODACION,
  ETIQUETA_INCLUYE,
  avisosDelPaquete,
  costoDelPaquete,
  fechasDelPaquete,
  leerPaqueteBloqueo,
  paqueteVacio,
  textoDeTramo,
  type Acomodacion,
  type CategoriaIncluye,
  type PaqueteBloqueo,
  type TramoBloqueo,
  type VueloBloqueo,
} from '@/lib/cotizaciones/bloqueo-paquete'
import { leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import { todayBogotaISO } from '@/lib/dates/bogota'

/**
 * VIAJE EN BLOQUEO en la cotización por pasos (brief del 2026-10-27).
 *
 *  · `SeccionBloqueo`: arriba del Paso 1, dice que el viaje es Bloqueo (y con qué operador) y ofrece
 *    «+ Paquete».
 *  · `TarjetaPaqueteBloqueo`: la tarjeta de cada opción de la ranura «Paquete de bloqueo». Dos casillas
 *    que van juntas —Hotel y Vuelo—: la asesora une los dos pantallazos al pegarlos en el MISMO paquete
 *    (ONE no los empareja por contenido). Todo lo leído es editable antes de guardar.
 *
 * La plata de la pantalla sale de `costoDelPaquete` (la misma función que usa el servidor al guardar);
 * el precio al cliente lo calcula el recálculo de siempre con la casilla de comisión.
 */

const pesos = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `$ ${Math.round(n).toLocaleString('es-CO')}`

const CAJA = 'h-8 rounded border bg-background px-2 text-xs'
const ETIQUETA = 'flex flex-col gap-0.5 text-[11px] text-[#6E6A62]'

export function SeccionBloqueo({
  cotizacionId,
  operador,
  editable,
  onCreado,
}: {
  cotizacionId: string
  operador: string | null
  editable: boolean
  onCreado: (itemId: string) => void
}) {
  const [pendiente, empezar] = useTransition()
  return (
    <section data-seccion-bloqueo className="rounded-xl border border-[#D9E7E0] bg-[#F3F8F5] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-[#0E5C43]">
            <Package className="h-4 w-4" aria-hidden />
            Viaje en bloqueo{operador ? ` · ${operador}` : ''}
          </p>
          <p className="m-0 mt-0.5 text-xs text-[#6E6A62]">
            Cada opción es un paquete: pega el pantallazo del hotel y el del vuelo en el mismo paquete.
          </p>
        </div>
        {editable && (
          <button
            type="button"
            disabled={pendiente}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-[#10B981] px-3 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-60"
            onClick={() => empezar(async () => {
              const r = await crearPaqueteBloqueo(cotizacionId)
              if (!r.success) { toast.error(r.error); return }
              onCreado(r.itemId)
            })}
          >
            {pendiente ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Paquete
          </button>
        )}
      </div>
    </section>
  )
}

export interface PropsTarjetaPaquete {
  cotizacionId: string
  itemId: string
  tarifaPax: unknown
  /** Precio al cliente de la línea (lo que guardó el servidor). */
  precioVenta: number | null
  editable: boolean
  operador: string | null
  /** Los pasajeros de la solicitud, para el aviso de personas. */
  pasajeros: { adultos: number; ninos: number; infantes: number } | null
  /** El vuelo del primer paquete del bloqueo, para ofrecerlo en este. */
  vueloSugerido: VueloBloqueo | null
  onCambio: () => void
  onEliminar: () => void
}

type Comision = 'incluida' | 'por_incluir'

function tramoVacio(): TramoBloqueo {
  return { aerolinea: null, numeroVuelo: null, origen: null, destino: null, fecha: null, horaSalida: null, horaLlegada: null, fechaLlegada: null, escalas: 0 }
}

const vacioANulo = (v: string) => (v.trim() === '' ? null : v)
const numeroONulo = (v: string) => {
  const n = Number(v.replace(/[^\d]/g, ''))
  return v.trim() === '' || !Number.isFinite(n) ? null : n
}

export function TarjetaPaqueteBloqueo(p: PropsTarjetaPaquete) {
  const guardado = useMemo(() => leerPaqueteBloqueo(leerTarifaPax(p.tarifaPax).bloqueo), [p.tarifaPax])
  const tipoGuardado = leerTarifaPax(p.tarifaPax).tipoTarifa?.tipo ?? null
  const [abierto, setAbierto] = useState(guardado === null)
  const [paquete, setPaquete] = useState<PaqueteBloqueo>(() => guardado ?? paqueteVacio(p.operador))
  const [comision, setComision] = useState<Comision>(tipoGuardado === 'publica' ? 'incluida' : 'por_incluir')
  const [imagenes, setImagenes] = useState<{ hotel?: ImagenNueva & { vista: string }; vuelo?: ImagenNueva & { vista: string } }>({})
  const [leyendo, setLeyendo] = useState<{ hotel: boolean; vuelo: boolean }>({ hotel: false, vuelo: false })
  const [rechazo, setRechazo] = useState<{ hotel?: string; vuelo?: string }>({})
  const [guardando, empezar] = useTransition()

  const costo = costoDelPaquete(paquete)
  const fechas = fechasDelPaquete(paquete)
  const avisos = avisosDelPaquete(paquete, { hoy: todayBogotaISO(), pasajeros: p.pasajeros })
  const h = paquete.hotel

  function cambiar(f: (x: PaqueteBloqueo) => PaqueteBloqueo) {
    setPaquete(x => f(structuredClone(x)))
  }

  async function leer(cual: 'hotel' | 'vuelo', dataUrl: string) {
    setLeyendo(l => ({ ...l, [cual]: true }))
    setRechazo(r => ({ ...r, [cual]: undefined }))
    try {
      const r = await leerPantallazoBloqueo(p.cotizacionId, cual, dataUrl)
      if (!r.ok) { setRechazo(x => ({ ...x, [cual]: r.mensaje })); return }
      setImagenes(i => ({ ...i, [cual]: { dataUrl, huella: r.huella, vista: dataUrl } }))
      if (r.cual === 'hotel') cambiar(x => ({ ...x, hotel: r.hotel, incluye: r.incluye }))
      else cambiar(x => ({ ...x, vuelo: r.vuelo }))
    } catch {
      setRechazo(x => ({ ...x, [cual]: 'La lectura se interrumpió. Vuelve a pegar el pantallazo.' }))
    } finally {
      setLeyendo(l => ({ ...l, [cual]: false }))
    }
  }

  function guardar() {
    empezar(async () => {
      const r = await guardarPaqueteBloqueo(p.itemId, {
        paquete,
        imagenes: {
          hotel: imagenes.hotel ? { dataUrl: imagenes.hotel.dataUrl, huella: imagenes.hotel.huella } : null,
          vuelo: imagenes.vuelo ? { dataUrl: imagenes.vuelo.dataUrl, huella: imagenes.vuelo.huella } : null,
        },
        comision,
      })
      if (!r.success) { toast.error(r.error); return }
      setPaquete(r.paquete)
      setImagenes({})
      toast.success(r.costo === null ? 'Paquete guardado, todavía sin costo.' : 'Paquete guardado.')
      p.onCambio()
    })
  }

  const ocupado = guardando || leyendo.hotel || leyendo.vuelo
  const disponibles = ACOMODACIONES.filter(a => !h.precios.some(x => x.acomodacion === a))

  return (
    <article data-paquete-bloqueo className="rounded-lg border bg-white p-3 text-xs">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="m-0 text-sm font-semibold">{h.hotel ?? 'Paquete sin hotel'}</p>
          <p className="m-0 text-[11px] text-[#6E6A62]">
            {[h.zona, h.noches ? `${h.noches} noches` : null, fechas.salida && fechas.regreso ? `${fechas.salida} → ${fechas.regreso}` : fechas.salida, costo.personas > 0 ? `${costo.personas} personas` : null]
              .filter(Boolean).join(' · ') || 'Pega el hotel y el vuelo de este paquete.'}
          </p>
        </div>
        <div className="text-right">
          <p className="m-0 text-[11px] text-[#6E6A62]">Costo {pesos(guardado ? costoDelPaquete(guardado).total : null)}</p>
          <p className="m-0 text-sm font-semibold tabular-nums">{pesos(p.precioVenta)}</p>
        </div>
      </header>

      <div className="mt-2 flex gap-2">
        <button type="button" className="text-[11px] font-semibold text-[#0E5C43] underline" onClick={() => setAbierto(a => !a)}>
          {abierto ? 'Cerrar' : 'Ver y editar el paquete'}
        </button>
        {p.editable && (
          <button type="button" className="inline-flex items-center gap-1 text-[11px] text-red-700" onClick={p.onEliminar}>
            <Trash2 className="h-3 w-3" aria-hidden /> Quitar paquete
          </button>
        )}
      </div>

      {abierto && (
        <div className="mt-3 space-y-3">
          {p.editable && (
            <div className="grid gap-2 sm:grid-cols-2">
              <CasillaPantallazo titulo="Hotel" icono={<ImageIcon className="h-3.5 w-3.5" />} leyendo={leyendo.hotel} rechazo={rechazo.hotel}
                vista={imagenes.hotel?.vista ?? null} guardada={!!paquete.imagenes.hotel} onImagen={d => leer('hotel', d)} />
              <CasillaPantallazo titulo="Vuelo" icono={<Plane className="h-3.5 w-3.5" />} leyendo={leyendo.vuelo} rechazo={rechazo.vuelo}
                vista={imagenes.vuelo?.vista ?? null} guardada={!!paquete.imagenes.vuelo} onImagen={d => leer('vuelo', d)} />
            </div>
          )}

          {/* ── Hotel ── */}
          <fieldset disabled={!p.editable} className="space-y-2">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-[#6E6A62]">Hotel</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <Campo etiqueta="Hotel" valor={h.hotel} onCambio={v => cambiar(x => { x.hotel.hotel = vacioANulo(v); return x })} />
              <Campo etiqueta="Zona" valor={h.zona} onCambio={v => cambiar(x => { x.hotel.zona = vacioANulo(v); return x })} />
              <Campo etiqueta="Noches" tipo="number" valor={h.noches} onCambio={v => cambiar(x => { x.hotel.noches = numeroONulo(v); return x })} />
              <Campo etiqueta="Habitación" valor={h.habitacion} onCambio={v => cambiar(x => { x.hotel.habitacion = vacioANulo(v); return x })} />
              <Campo etiqueta="Alimentación" valor={h.planAlimentacion} onCambio={v => cambiar(x => { x.hotel.planAlimentacion = vacioANulo(v); return x })} />
              <Campo etiqueta="Temporada" valor={h.temporada} onCambio={v => cambiar(x => { x.hotel.temporada = vacioANulo(v); return x })} />
              <Campo etiqueta="Compra antes del" tipo="date" valor={h.compraAntesDe} onCambio={v => cambiar(x => { x.hotel.compraAntesDe = vacioANulo(v); return x })} />
              <label className="flex items-center gap-1.5 self-end text-[11px]">
                <input type="checkbox" checked={h.tarifaPromo} onChange={e => cambiar(x => { x.hotel.tarifaPromo = e.target.checked; return x })} />
                Tarifa promo
              </label>
            </div>
          </fieldset>

          {/* ── Precios por persona y distribución ── */}
          <fieldset disabled={!p.editable} className="space-y-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-[#6E6A62]">Precios por persona y habitaciones</legend>
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-[11px] text-[#6E6A62]">
                  <th className="font-medium">Acomodación</th><th className="font-medium">Precio por persona</th><th className="font-medium">Habitaciones</th><th className="font-medium">Personas</th><th className="text-right font-medium">Total</th><th />
                </tr>
              </thead>
              <tbody>
                {h.precios.map(pr => {
                  const fila = costo.filas.find(f => f.clave === pr.acomodacion)
                  return (
                    <tr key={pr.acomodacion} data-acomodacion={pr.acomodacion}>
                      <td>{ETIQUETA_ACOMODACION[pr.acomodacion]}</td>
                      <td><input aria-label={`Precio por persona ${ETIQUETA_ACOMODACION[pr.acomodacion]}`} className={`${CAJA} w-28`} inputMode="numeric" value={pr.precioPorPersona ?? ''}
                        onChange={e => cambiar(x => { x.hotel.precios.find(y => y.acomodacion === pr.acomodacion)!.precioPorPersona = numeroONulo(e.target.value); return x })} /></td>
                      <td><input aria-label={`Habitaciones ${ETIQUETA_ACOMODACION[pr.acomodacion]}`} className={`${CAJA} w-16`} type="number" min={0} value={paquete.distribucion.habitaciones[pr.acomodacion] ?? ''}
                        onChange={e => cambiar(x => { const n = numeroONulo(e.target.value); if (n) x.distribucion.habitaciones[pr.acomodacion] = n; else delete x.distribucion.habitaciones[pr.acomodacion]; return x })} /></td>
                      <td>{fila?.personas ?? 0}</td>
                      <td className="text-right">{pesos(fila?.total ?? null)}</td>
                      <td>
                        <button type="button" aria-label="Quitar acomodación" className="text-[#6E6A62]"
                          onClick={() => cambiar(x => { x.hotel.precios = x.hotel.precios.filter(y => y.acomodacion !== pr.acomodacion); delete x.distribucion.habitaciones[pr.acomodacion]; return x })}>×</button>
                      </td>
                    </tr>
                  )
                })}
                <tr data-acomodacion="nino">
                  <td>Niño{h.nino?.edadMin !== null && h.nino?.edadMin !== undefined ? ` (${h.nino.edadMin}-${h.nino.edadMax ?? '?'} años)` : ''}</td>
                  <td><input aria-label="Precio por niño" className={`${CAJA} w-28`} inputMode="numeric" value={h.nino?.precio ?? ''}
                    onChange={e => cambiar(x => { x.hotel.nino = { edadMin: x.hotel.nino?.edadMin ?? null, edadMax: x.hotel.nino?.edadMax ?? null, precio: numeroONulo(e.target.value) }; return x })} /></td>
                  <td colSpan={2}><input aria-label="Niños" className={`${CAJA} w-16`} type="number" min={0} value={paquete.distribucion.ninos || ''}
                    onChange={e => cambiar(x => { x.distribucion.ninos = numeroONulo(e.target.value) ?? 0; return x })} /> niños</td>
                  <td className="text-right">{pesos(costo.filas.find(f => f.clave === 'nino')?.total ?? null)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            {disponibles.length > 0 && p.editable && (
              <select aria-label="Agregar acomodación" className={CAJA} value=""
                onChange={e => { const a = e.target.value as Acomodacion; if (a) cambiar(x => { x.hotel.precios.push({ acomodacion: a, precioPorPersona: null }); return x }) }}>
                <option value="">+ Acomodación</option>
                {disponibles.map(a => <option key={a} value={a}>{ETIQUETA_ACOMODACION[a]}</option>)}
              </select>
            )}
            <p className="m-0 text-right text-sm font-semibold tabular-nums" data-costo-paquete>
              {costo.personas} personas · Costo del paquete {pesos(costo.total)}
            </p>
          </fieldset>

          {/* ── Qué incluye ── */}
          <fieldset disabled={!p.editable} className="space-y-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-[#6E6A62]">Qué incluye</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIAS_INCLUYE.map(c => (
                <label key={c} className={ETIQUETA}>
                  {ETIQUETA_INCLUYE[c]}
                  <select data-incluye={c} className={CAJA} value={paquete.incluye.casillas[c] === true ? 'si' : paquete.incluye.casillas[c] === false ? 'no' : ''}
                    onChange={e => cambiar(x => { x.incluye.casillas[c] = e.target.value === 'si' ? true : e.target.value === 'no' ? false : null; return x })}>
                    <option value="">Sin dato</option>
                    <option value="si">Incluido</option>
                    <option value="no">No incluido</option>
                  </select>
                </label>
              ))}
            </div>
            {paquete.incluye.sinIdentificar.map((s, i) => (
              <label key={i} className="flex items-center gap-2 text-[11px]" data-icono-sin-identificar>
                <AlertTriangle className="h-3 w-3 text-amber-700" aria-hidden />
                Ícono sin identificar: «{s.descripcion}»
                <select className={CAJA} value={s.categoria ?? ''}
                  onChange={e => cambiar(x => {
                    const v = e.target.value
                    x.incluye.sinIdentificar[i].categoria = v === '' ? null : (v as CategoriaIncluye | 'ninguna')
                    if (v !== '' && v !== 'ninguna') x.incluye.casillas[v as CategoriaIncluye] = true
                    return x
                  })}>
                  <option value="">¿Qué es?</option>
                  {CATEGORIAS_INCLUYE.map(c => <option key={c} value={c}>{ETIQUETA_INCLUYE[c]}</option>)}
                  <option value="ninguna">No es nada de esto</option>
                </select>
              </label>
            ))}
            {paquete.incluye.texto && <p className="m-0 text-[11px] text-[#6E6A62]">Dice la pantalla: «{paquete.incluye.texto}»</p>}
          </fieldset>

          {/* ── Vuelo ── */}
          <fieldset disabled={!p.editable} className="space-y-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-[#6E6A62]">Vuelo (ya va dentro del precio)</legend>
            {paquete.vuelo?.tramos.map((t, i) => (
              <div key={i} className="flex flex-wrap items-end gap-1.5" data-tramo>
                <Campo etiqueta="Aerolínea" ancho="w-24" valor={t.aerolinea} onCambio={v => cambiar(x => { x.vuelo!.tramos[i].aerolinea = vacioANulo(v); return x })} />
                <Campo etiqueta="Vuelo" ancho="w-16" valor={t.numeroVuelo} onCambio={v => cambiar(x => { x.vuelo!.tramos[i].numeroVuelo = vacioANulo(v); return x })} />
                <Campo etiqueta="De" ancho="w-16" valor={t.origen} onCambio={v => cambiar(x => { x.vuelo!.tramos[i].origen = vacioANulo(v); return x })} />
                <Campo etiqueta="A" ancho="w-16" valor={t.destino} onCambio={v => cambiar(x => { x.vuelo!.tramos[i].destino = vacioANulo(v); return x })} />
                <Campo etiqueta="Fecha" tipo="date" valor={t.fecha} onCambio={v => cambiar(x => { x.vuelo!.tramos[i].fecha = vacioANulo(v); return x })} />
                <Campo etiqueta="Sale" tipo="time" valor={t.horaSalida} onCambio={v => cambiar(x => { x.vuelo!.tramos[i].horaSalida = vacioANulo(v); return x })} />
                <Campo etiqueta="Llega" tipo="time" valor={t.horaLlegada} onCambio={v => cambiar(x => { x.vuelo!.tramos[i].horaLlegada = vacioANulo(v); return x })} />
                <label className="flex items-center gap-1 pb-2 text-[11px]">
                  <input type="checkbox" checked={t.escalas === 0} onChange={e => cambiar(x => { x.vuelo!.tramos[i].escalas = e.target.checked ? 0 : null; return x })} /> Directo
                </label>
                <button type="button" aria-label="Quitar tramo" className="pb-2 text-[#6E6A62]"
                  onClick={() => cambiar(x => { const tramos = x.vuelo!.tramos.filter((_, j) => j !== i); x.vuelo = tramos.length ? { tramos } : null; return x })}>×</button>
              </div>
            ))}
            {p.editable && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="text-[11px] font-semibold text-[#0E5C43]"
                  onClick={() => cambiar(x => { x.vuelo = { tramos: [...(x.vuelo?.tramos ?? []), tramoVacio()] }; return x })}>+ Tramo</button>
                {!paquete.vuelo && p.vueloSugerido && (
                  <button type="button" data-reusar-vuelo className="text-[11px] font-semibold text-[#0E5C43]"
                    onClick={() => cambiar(x => { x.vuelo = structuredClone(p.vueloSugerido); return x })}>
                    Usar el mismo vuelo del primer paquete ({p.vueloSugerido.tramos.map(textoDeTramo).join(' / ')})
                  </button>
                )}
              </div>
            )}
            {!paquete.vuelo && (
              <Campo etiqueta="Sin vuelo: fecha de salida (el regreso = salida + noches)" tipo="date" valor={paquete.salidaManual}
                onCambio={v => cambiar(x => { x.salidaManual = vacioANulo(v); return x })} />
            )}
            {fechas.salida && (
              <p className="m-0 text-[11px] text-[#6E6A62]" data-fechas-paquete>
                Fechas del viaje: {fechas.salida}{fechas.regreso ? ` → ${fechas.regreso}` : ''} ({fechas.origen === 'vuelo' ? 'del vuelo' : 'salida + noches'})
              </p>
            )}
          </fieldset>

          {/* ── Comisión: la casilla de siempre (Pública / Neta) ── */}
          <fieldset disabled={!p.editable} className="flex flex-wrap gap-3 text-[11px]">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-[#6E6A62]">Comisión</legend>
            <label className="flex items-center gap-1"><input type="radio" name={`comision-${p.itemId}`} checked={comision === 'incluida'} onChange={() => setComision('incluida')} /> Incluida en el precio (margen 0 %)</label>
            <label className="flex items-center gap-1"><input type="radio" name={`comision-${p.itemId}`} checked={comision === 'por_incluir'} onChange={() => setComision('por_incluir')} /> Por incluir (margen de la cotización)</label>
          </fieldset>

          {avisos.length > 0 && (
            <ul className="m-0 list-none space-y-1 p-0" data-avisos-paquete>
              {avisos.map((a, i) => (
                <li key={i} data-aviso={a.clave} className={`flex items-start gap-1.5 rounded p-1.5 text-[11px] font-medium ${a.nivel === 'rojo' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{a.texto}
                </li>
              ))}
            </ul>
          )}

          {p.editable && (
            <div className="flex justify-end">
              <button type="button" disabled={ocupado} onClick={guardar}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-[#10B981] px-4 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-60">
                {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Guardar paquete
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function Campo({ etiqueta, valor, onCambio, tipo = 'text', ancho }: { etiqueta: string; valor: string | number | null; onCambio: (v: string) => void; tipo?: string; ancho?: string }) {
  return (
    <label className={ETIQUETA}>
      {etiqueta}
      <input type={tipo} className={`${CAJA} ${ancho ?? ''}`} value={valor ?? ''} onChange={e => onCambio(e.target.value)} />
    </label>
  )
}

function CasillaPantallazo({ titulo, icono, leyendo, rechazo, vista, guardada, onImagen }: {
  titulo: string
  icono: React.ReactNode
  leyendo: boolean
  rechazo: string | undefined
  vista: string | null
  guardada: boolean
  onImagen: (dataUrl: string) => void
}) {
  const entrada = useRef<HTMLInputElement>(null)
  function desdeArchivo(archivo: File | null | undefined) {
    if (!archivo || !archivo.type.startsWith('image/')) return
    const lector = new FileReader()
    lector.onload = ev => onImagen(ev.target?.result as string)
    lector.readAsDataURL(archivo)
  }
  return (
    <div data-casilla-paquete={titulo.toLowerCase()} className="space-y-1">
      <div
        tabIndex={0}
        role="button"
        aria-label={`Pega el pantallazo del ${titulo.toLowerCase()} de este paquete`}
        onPaste={e => {
          const i = Array.from(e.clipboardData.items).find(x => x.type.startsWith('image/'))
          if (!i) return
          e.preventDefault()
          desdeArchivo(i.getAsFile())
        }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); desdeArchivo(e.dataTransfer.files?.[0]) }}
        onClick={() => entrada.current?.click()}
        className="flex min-h-[64px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed bg-[#F5F4F2] p-2 text-[11px] text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#10B981]/30"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- vista local del pantallazo pegado (data URL) */}
        {vista ? <img src={vista} alt={`Pantallazo del ${titulo.toLowerCase()}`} className="max-h-16 rounded" /> : (leyendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icono)}
        <span>{leyendo ? `Leyendo el ${titulo.toLowerCase()}…` : `${titulo}: pega (Ctrl+V / Cmd+V), arrastra o elige el pantallazo${guardada && !vista ? ' · ya hay uno guardado' : ''}`}</span>
        <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => desdeArchivo(e.target.files?.[0])} />
      </div>
      {rechazo && <p className="m-0 text-[11px] font-medium text-red-700">{rechazo}</p>}
    </div>
  )
}
