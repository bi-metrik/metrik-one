'use client'

import { useState, type ReactNode } from 'react'

import { BTN, BTN_PRIM, INPUT, LINK } from '@/components/viaje/estilo'
import { ItemMenu, MenuAcciones, SeparadorMenu } from '@/components/viaje/menu-acciones'
import { causasBajoMinimo } from '@/lib/cotizaciones/causas-margen'
import { MOTIVOS_COMBINACION } from '@/lib/cotizaciones/motivo-combinacion'
import { pesos } from '@/lib/cotizaciones/tarjeta-opcion'
import type { ServicioDelViaje, TarifaCalculada } from '@/lib/cotizaciones/por-pasos-vista'

/**
 * Paso 2 · TARIFAS (diseño, Paso 2, «Cómo se ve», rehecho el 2026-10-12).
 *
 * Una pregunta arriba; una tarifa a la vez, con pestañas que llevan su total y si se manda; las
 * opciones de cada servicio como tarjetas que se tocan (radio); el margen, uno para las tres, con
 * el margen real de cada tarifa y la autorización bajo el mínimo; «Comparar» como vista
 * secundaria. Todo se calcula en el navegador (`por-pasos-vista.ts`): tocar otra opción cambia el
 * total en el acto y la escritura va detrás.
 *
 * Lo que la tabla de hoy tenía y no se pierde (N12): «Renombrar», «Eliminar esta tarifa» y «Por
 * qué esta combinación» en el «⋯» de cada tarifa; «Ver el cálculo» (la cascada, con el descuento
 * comercial) y el rastro del margen, plegados.
 */

export interface ServicioConOpciones extends ServicioDelViaje {
  /** Las opciones que compiten en el precio (las que una tarifa puede escoger). */
  candidatas: string[]
}

/** Las reglas de margen de la cotización (brief del 2026-10-27, `reglas-margen.ts`). */
export interface ReglasEnTarifas {
  puntosExtra: number
  puntosMax: number
  /** `aplicaA`: el id de UNA tarifa (2026-10-29); ausente o `null` = a todas. */
  descuentos: { id: string; descripcion: string; pct: number; aplicaA?: string | null }[]
  pisoHotelPct: number
}

export interface AutorizacionVista {
  /** Bajo el mínimo y sin autorización vigente: no se envía. */
  bloquea: boolean
  dueno: string | null
  esDueno: boolean
  vigente: { por: string; motivo: string } | null
  perdida: boolean
  /** Por qué ya no vale (`textoDePerdida`). Ausente = el texto de siempre. */
  textoPerdida?: string | null
  pedido: { por: string | null } | null
  disponible: boolean
}

const pct = (v: number | null) => (v === null ? '—' : `${String(Math.round(v * 10) / 10).replace('.', ',')} %`)

export function TarifasPorPasos({
  tarifas,
  servicios,
  iguales,
  opcionales,
  noVan,
  nombreDeOpcion,
  detalleDeOpcion,
  cabeEnTarifa = () => true,
  precioDeOpcion,
  margenPct,
  pisoPct,
  avisoPct,
  editable,
  ocupado,
  autorizacion,
  verElCalculo,
  rastro,
  onElegir,
  onMandar,
  onMargen,
  propios = [],
  onSeguirMargen,
  onPedir,
  onAutorizar,
  onRetirar,
  onReponer,
  onVerEnElViaje,
  onRenombrar,
  onEliminarTarifa,
  onMotivo,
  onSeguir,
  reglas = null,
  onPuntos,
  onDescuentos,
  delTotal = null,
}: {
  tarifas: TarifaCalculada[]
  servicios: ServicioConOpciones[]
  iguales: { grupo: string; nombre: string; opcion: string; precio: number }[]
  opcionales: { grupo: string; nombre: string }[]
  noVan: { grupo: string; nombre: string }[]
  nombreDeOpcion: (id: string) => string
  detalleDeOpcion: (id: string) => string | null
  /** El traslado que va con otro hotel no cabe en esta tarifa (`va-con-hotel.ts`). */
  cabeEnTarifa?: (tarifaId: string, itemId: string) => boolean
  precioDeOpcion: (id: string) => number
  margenPct: number
  pisoPct: number
  avisoPct: number
  editable: boolean
  ocupado: boolean
  autorizacion: AutorizacionVista | null
  verElCalculo: ReactNode
  rastro: ReactNode
  onElegir: (tarifaId: string, grupo: string, itemId: string) => void
  onMandar: (tarifaId: string, va: boolean) => void
  onMargen: (pct: number) => void
  /**
   * Las opciones Netas con margen propio: no cambian con el margen de la cotización (punto 2 de la
   * reunión del 2026-10-22, `margen-propio.ts`).
   */
  propios?: { id: string; nombre: string; margen: number }[]
  onSeguirMargen?: () => void
  onPedir: () => void
  onAutorizar: (motivo: string) => void
  onRetirar: () => void
  onReponer: (grupo: string) => void
  onVerEnElViaje: (grupo: string, itemId: string) => void
  onRenombrar: (tarifaId: string, nombre: string) => void
  onEliminarTarifa: (tarifaId: string) => void
  onMotivo: (tarifaId: string, codigo: string | null) => void
  onSeguir: (paso: 1 | 3) => void
  /**
   * Las reglas de margen. Con ellas la casilla es el margen de los HOTELES, se suman puntos extra y
   * descuentos sobre el total, y se juzga el margen global. Ausente, la pantalla de siempre.
   */
  reglas?: ReglasEnTarifas | null
  onPuntos?: (puntos: number) => void
  onDescuentos?: (descuentos: { id?: string; descripcion: string; pct: number; aplicaA?: string | null }[]) => void
  /**
   * El margen del total, el MISMO que pinta el encabezado (`margenDelEncabezado`). Sin tarifas que
   * vayan al cliente (un solo hotel, nada que escoger) es lo único que hay que medir: sin él, el
   * rótulo «Margen global (no se edita):» quedaba vacío (falla 1 del brief del 2026-10-28).
   */
  delTotal?: { margenPct: number | null; exenta: boolean; hotelesBajoPiso: { id: string | undefined; margenPct: number }[] } | null
}) {
  // Un paquete de bloqueo se margina como hotel (`tipoParaMargen`): la casilla lo nombra.
  const conPaquete = servicios.some(s => s.tipo === 'paquete')
  const soloRecomendada = servicios.length > 0 && !servicios.some(s => s.tipo === 'vuelo' || s.tipo === 'hotel')
  const visibles = servicios.length === 0 || soloRecomendada ? tarifas.filter(t => t.canon === 'Recomendada' || t.esPrincipal) : tarifas
  const [ver, setVer] = useState<string>(() => (visibles.find(t => t.canon === 'Recomendada') ?? visibles[0])?.id ?? 'comparar')
  const actual = visibles.find(t => t.id === ver) ?? null
  const [margenEscrito, setMargenEscrito] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [autorizando, setAutorizando] = useState(false)
  const [renombrando, setRenombrando] = useState<string | null>(null)
  const [verCalculo, setVerCalculo] = useState(false)
  const vanAlCliente = (t: TarifaCalculada) => t.esPrincipal || (t.vaEnPropuesta && !t.igualA)
  /** Los hoteles de una tarifa que, con su descuento, quedaron bajo el piso de hotel (reglas). */
  const hotelesBajos = (t: TarifaCalculada) => t.cascada?.reglas?.hotelesBajoPiso ?? []
  /**
   * Lo que se mide: las tarifas que van al cliente o, sin ninguna, el total (el que pinta el
   * encabezado). Cada uno con su margen y sus hoteles bajo el piso.
   */
  const medidos: { id: string; nombre: string | null; margenReal: number | null; exenta: boolean; hoteles: { id: string | undefined; margenPct: number }[]; tarifa: TarifaCalculada | null }[] =
    tarifas.some(vanAlCliente)
      ? tarifas.filter(vanAlCliente).map(t => ({ id: t.id, nombre: t.nombre, margenReal: t.margenReal, exenta: t.exenta, hoteles: hotelesBajos(t), tarifa: t }))
      : delTotal
        ? [{ id: 'total', nombre: null, margenReal: delTotal.margenPct, exenta: delTotal.exenta, hoteles: delTotal.hotelesBajoPiso, tarifa: null }]
        : []
  const globalBajo = (t: { exenta: boolean; margenReal: number | null }) => !t.exenta && t.margenReal !== null && t.margenReal < pisoPct
  const bajoMinimo = medidos.filter(t => globalBajo(t) || t.hoteles.length > 0)
  /** Por qué pide la autorización, cada causa por separado (`causas-margen.ts`). */
  const causasDe = (t: (typeof medidos)[number]) => causasBajoMinimo({
    nombre: t.nombre,
    margenPct: t.exenta ? null : t.margenReal,
    hoteles: t.hoteles.map(h => ({ nombre: nombreDeOpcion(h.id ?? ''), margenPct: h.margenPct })),
    pisoHotelPct: reglas?.pisoHotelPct ?? 0,
  }, pisoPct)
  /** El margen real de una tarifa, dicho con las líneas de tarifa pública que no cuenta. */
  const margenDeTarifa = (t: { exenta: boolean; margenReal: number | null }) => (t.exenta ? 'solo tarifa pública' : pct(t.margenReal))
  // Con reglas, las Públicas CON comisión sí cuentan: la nota nombra solo las que no.
  const sinContar = (t: TarifaCalculada) => (reglas ? t.cascada?.reglas?.publicasSinComision ?? 0 : t.publicas)
  const notaPublicas = (t: TarifaCalculada) => {
    const n = sinContar(t)
    if (t.exenta || n === 0) return ''
    return reglas
      ? ` (sin ${n === 1 ? '1 pública sin comisión' : `${n} públicas sin comisión`})`
      : ` (sin ${n === 1 ? '1 de tarifa pública' : `${n} de tarifa pública`})`
  }
  const [puntosEscritos, setPuntosEscritos] = useState<string | null>(null)
  const [nuevoDescuento, setNuevoDescuento] = useState<{ descripcion: string; pct: string; aplicaA: string } | null>(null)
  /** A qué tarifa aplica un descuento, como se lee en su chip (`aplicaA` vacío = todas). */
  const aplicaATexto = (aplicaA: string | null | undefined) => {
    if (!aplicaA) return 'Todas las tarifas'
    const t = tarifas.find(x => x.id === aplicaA)
    return t ? `Solo ${t.nombre ?? 'esta tarifa'}` : 'Su tarifa ya no existe: no se aplica'
  }

  const pregunta = (() => {
    const que = [...new Set(servicios.map(s => s.tipo === 'hotel' ? 'qué hotel' : s.tipo === 'vuelo' ? 'qué vuelo' : s.tipo === 'traslado' ? 'qué traslado' : `qué opción de ${s.nombre}`))]
    const lista = que.length <= 1 ? que.join('') : `${que.slice(0, -1).join(', ')} y ${que[que.length - 1]}`
    const t = `¿${lista} va${visibles.length > 1 ? ' en cada tarifa' : ''}?`
    return t.charAt(0) + t.charAt(1).toUpperCase() + t.slice(2)
  })()

  const totalTab = (t: TarifaCalculada) => (
    <>
      <span className="text-[12.5px] font-bold">{t.nombre ?? 'Tarifa'}{t.canon === 'Recomendada' ? ' · el total' : ''}</span>
      <b className={`text-sm tabular-nums ${vanAlCliente(t) ? '' : 'line-through opacity-70'}`}>{pesos(t.precio)}</b>
      <small className="text-[11px] opacity-75">
        {t.canon === 'Recomendada' ? 'siempre se manda' : vanAlCliente(t) ? 'se manda al cliente' : 'no se manda'}
      </small>
      {/* N12 (H8) · una tarifa que no es Económica, Recomendada ni Premium lo dice: no es una pestaña más. */}
      {t.canon === null && <small className="text-[10.5px] font-semibold opacity-75" data-tarifa-extra>No es una de las tres tarifas</small>}
    </>
  )

  const margenYAutorizacion = (
    <div className="flex flex-col gap-2 rounded-xl border border-[#E2DED5] bg-white p-3" data-margen-unico>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{reglas ? (conPaquete ? 'Margen de hoteles y paquetes' : 'Margen de hoteles') : 'Margen'}</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={reglas ? (conPaquete ? 'Margen de los hoteles y paquetes' : 'Margen de los hoteles') : 'Margen de la cotización'}
          disabled={!editable || ocupado}
          value={margenEscrito ?? String(margenPct).replace('.', ',')}
          onChange={e => setMargenEscrito(e.target.value)}
          onBlur={() => {
            if (margenEscrito === null) return
            const v = Number(margenEscrito.replace(',', '.'))
            setMargenEscrito(null)
            if (Number.isFinite(v) && v !== margenPct) onMargen(v)
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className={`${INPUT} !w-[70px] text-right tabular-nums`}
        />
        <span>%</span>
        <span className="text-xs text-[#6E6A62]">
          {reglas
            ? `vuelos con su colchón · lo demás arranca en 0 % · margen global mínimo ${pct(pisoPct)}`
            : `uno para las tres tarifas · mínimo ${pct(pisoPct)}`}
        </span>
      </label>
      {reglas && (
        <div className="flex flex-col gap-2 border-t border-[#E2DED5] pt-2" data-reglas-total>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Puntos extra</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Puntos extra de margen"
              disabled={!editable || ocupado}
              value={puntosEscritos ?? String(reglas.puntosExtra).replace('.', ',')}
              onChange={e => setPuntosEscritos(e.target.value)}
              onBlur={() => {
                if (puntosEscritos === null) return
                const v = puntosEscritos.trim() === '' ? 0 : Number(puntosEscritos.replace(',', '.'))
                setPuntosEscritos(null)
                if (Number.isFinite(v) && v >= 0 && v <= reglas.puntosMax && v !== reglas.puntosExtra) onPuntos?.(v)
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className={`${INPUT} !w-[70px] text-right tabular-nums`}
              data-puntos-extra
            />
            <span className="text-xs text-[#6E6A62]">de 0 a {String(reglas.puntosMax).replace('.', ',')} puntos sobre el total · van en el precio de hoteles{conPaquete ? ', paquetes' : ''} y planes, nunca en los vuelos</span>
          </label>
          <div className="flex flex-col gap-1.5" data-descuentos-total>
            <span className="text-sm font-semibold">Descuentos sobre el total <span className="text-xs font-normal text-[#6E6A62]">· el cliente los ve con su descripción</span></span>
            {reglas.descuentos.map(d => (
              <span key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E2DED5] bg-[#F8F7F3] px-2.5 py-1.5 text-[13px]" data-descuento-total={d.id}>
                <span className="min-w-0 flex-1">{d.descripcion}</span>
                <b className="tabular-nums">{pct(d.pct)}</b>
                {/* A qué tarifa aplica (2026-10-29): después de la cifra, para que «descripción %» se lea junto. */}
                {editable ? (
                  <select
                    aria-label={`A qué tarifa aplica «${d.descripcion}»`}
                    className={`${INPUT} !w-auto !py-0.5 text-xs`}
                    disabled={ocupado}
                    value={d.aplicaA ?? ''}
                    onChange={e => onDescuentos?.(reglas.descuentos.map(x => (x.id === d.id ? { ...x, aplicaA: e.target.value || null } : x)))}
                    data-aplica-a={d.aplicaA ?? 'todas'}
                  >
                    <option value="">Todas las tarifas</option>
                    {tarifas.map(t => <option key={t.id} value={t.id}>Solo {t.nombre ?? 'esta tarifa'}</option>)}
                    {d.aplicaA && !tarifas.some(t => t.id === d.aplicaA) && <option value={d.aplicaA}>Su tarifa ya no existe: no se aplica</option>}
                  </select>
                ) : (
                  <small className="text-xs text-[#6E6A62]" data-aplica-a={d.aplicaA ?? 'todas'}>{aplicaATexto(d.aplicaA)}</small>
                )}
                {editable && (
                  <button
                    type="button"
                    className={`${LINK} text-xs`}
                    disabled={ocupado}
                    onClick={() => onDescuentos?.(reglas.descuentos.filter(x => x.id !== d.id))}
                  >
                    Quitar
                  </button>
                )}
              </span>
            ))}
            {editable && (nuevoDescuento ? (
              <span className="flex flex-wrap items-end gap-2" data-nuevo-descuento>
                <label className="flex min-w-[180px] flex-1 flex-col gap-0.5 text-xs text-[#6E6A62]">
                  <span>Descripción</span>
                  <input
                    autoFocus
                    type="text"
                    maxLength={80}
                    className={INPUT}
                    placeholder="Ej.: Cliente recurrente"
                    value={nuevoDescuento.descripcion}
                    onChange={e => setNuevoDescuento({ ...nuevoDescuento, descripcion: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
                  <span>%</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={`${INPUT} !w-[70px] text-right tabular-nums`}
                    value={nuevoDescuento.pct}
                    onChange={e => setNuevoDescuento({ ...nuevoDescuento, pct: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
                  <span>Aplica a</span>
                  <select
                    className={`${INPUT} !w-auto`}
                    value={nuevoDescuento.aplicaA}
                    onChange={e => setNuevoDescuento({ ...nuevoDescuento, aplicaA: e.target.value })}
                    data-nuevo-aplica-a
                  >
                    <option value="">Todas las tarifas</option>
                    {tarifas.map(t => <option key={t.id} value={t.id}>Solo {t.nombre ?? 'esta tarifa'}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className={BTN_PRIM}
                  disabled={ocupado}
                  onClick={() => {
                    const v = Number(nuevoDescuento.pct.replace(',', '.'))
                    if (!nuevoDescuento.descripcion.trim() || !Number.isFinite(v) || v <= 0 || v >= 100) return
                    onDescuentos?.([...reglas.descuentos, { descripcion: nuevoDescuento.descripcion.trim(), pct: v, ...(nuevoDescuento.aplicaA ? { aplicaA: nuevoDescuento.aplicaA } : {}) }])
                    setNuevoDescuento(null)
                  }}
                >
                  Agregar
                </button>
                <button type="button" className={BTN} onClick={() => setNuevoDescuento(null)}>Cancelar</button>
              </span>
            ) : (
              <button type="button" className={`${LINK} self-start text-[13px]`} disabled={ocupado} onClick={() => setNuevoDescuento({ descripcion: '', pct: '', aplicaA: '' })} data-agregar-descuento-total>
                + Descuento sobre el total
              </button>
            ))}
          </div>
        </div>
      )}
      {propios.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-[#F0D9B5] bg-[#FBF1E2] p-2.5 text-[13px]" data-margen-propio>
          <span>
            <b>{propios.length === 1 ? '1 opción tiene su propio margen' : `${propios.length} opciones tienen su propio margen`}</b> y no cambia{propios.length === 1 ? '' : 'n'} con este:{' '}
            {propios.slice(0, 4).map(x => `${x.nombre} ${pct(x.margen)}`).join(' · ')}{propios.length > 4 ? ` y ${propios.length - 4} más` : ''}.
          </span>
          <span className="text-xs text-[#6E6A62]">Si su precio ya trae tu comisión, márcala «Pública» en su tarjeta en vez de dejarle 0 %.</span>
          {editable && onSeguirMargen && (
            <button type="button" className={`${BTN} self-start !text-xs`} disabled={ocupado} onClick={onSeguirMargen} data-seguir-margen>
              Que usen el margen de la cotización
            </button>
          )}
        </div>
      )}
      <p className="m-0 text-[13px]" data-margenes-reales>
        {reglas ? 'Margen global (no se edita):' : 'Margen real:'}{' '}
        {medidos.map((t, i) => (
          <span key={t.id}>
            {i > 0 && ' · '}
            <b className={`whitespace-nowrap ${t.exenta ? '' : t.margenReal !== null && t.margenReal < pisoPct ? 'text-[#B3382C]' : t.margenReal !== null && t.margenReal < avisoPct ? 'text-[#9A5F0C]' : ''}`} data-margen-medido={t.id}>
              {t.nombre ? `${t.nombre} ` : ''}{margenDeTarifa(t)}
            </b>
            {t.tarifa && notaPublicas(t.tarifa) && <span className="text-xs text-[#6E6A62]">{notaPublicas(t.tarifa)}</span>}
          </span>
        ))}
      </p>
      {bajoMinimo.length > 0 && autorizacion && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-[#EBC1BB] bg-[#FBEDEB] p-2.5 text-[13px]" data-autorizacion>
          <span className="font-semibold text-[#B3382C]">{[bajoMinimo.map(t => t.nombre).filter(Boolean).join(' y '), 'Bajo el mínimo'].filter(Boolean).join(' · ')}</span>
          {/* Brief del 2026-10-28 · la causa real: el hotel con su nombre, el global solo si lo es. */}
          {bajoMinimo.flatMap(t => causasDe(t).map((c, i) => (
            <span key={`${t.id}-${i}`} className="text-xs text-[#B3382C]" data-causa-margen={i < t.hoteles.length ? 'hotel' : 'global'}>
              {c}
            </span>
          )))}
          {autorizacion.vigente ? (
            <>
              <span className="font-semibold text-[#0E5C43]">✓ Autorizado por {autorizacion.vigente.por} · «{autorizacion.vigente.motivo}»</span>
              <span className="text-xs text-[#6E6A62]">Si cambia el margen o un costo, se pierde.</span>
              {autorizacion.esDueno && <button type="button" className={`${LINK} self-start text-xs`} onClick={onRetirar}>Retirar la autorización</button>}
            </>
          ) : (
            <>
              {autorizacion.perdida && <span className="text-xs text-[#B3382C]">{autorizacion.textoPerdida ?? 'La autorización se perdió: cambió el margen o un costo.'}</span>}
              {autorizacion.esDueno ? (
                autorizando ? (
                  <span className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold">Motivo (obligatorio)
                      <textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Por qué se envía bajo el mínimo" className={`${INPUT} mt-1`} />
                    </label>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[#B3382C] bg-white px-2.5 py-1 text-xs font-semibold text-[#B3382C]"
                        onClick={() => {
                          if (motivo.trim().length < 3) { onAutorizar(''); return }
                          onAutorizar(motivo.trim())
                          setAutorizando(false)
                          setMotivo('')
                        }}
                      >
                        {bajoMinimo[0] && globalBajo(bajoMinimo[0]) ? `Autorizar ${pct(bajoMinimo[0].margenReal)}` : 'Autorizar'}
                      </button>
                      <button type="button" className={BTN} onClick={() => setAutorizando(false)}>Cancelar</button>
                    </span>
                  </span>
                ) : (
                  <button type="button" disabled={!autorizacion.disponible} className="self-start rounded-lg border border-[#B3382C] bg-white px-2.5 py-1 text-xs font-semibold text-[#B3382C]" onClick={() => setAutorizando(true)}>
                    Autorizar bajo el mínimo
                  </button>
                )
              ) : autorizacion.pedido ? (
                <span className="text-xs font-semibold text-[#B3382C]">Pedido a {autorizacion.dueno ?? 'quien autoriza'} · esperando</span>
              ) : (
                <button type="button" className={`${BTN} self-start !text-xs`} onClick={onPedir} disabled={ocupado}>
                  Pedir autorización a {autorizacion.dueno ?? 'quien autoriza'}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <span className="self-start rounded-full bg-[#EEEBE4] px-2 py-0.5 text-[11px] text-[#6E6A62]">Margen distinto por tarifa: segunda entrega</span>
    </div>
  )

  const menuTarifa = (t: TarifaCalculada) => editable ? (
    <MenuAcciones
      etiqueta={`Más de la tarifa ${t.nombre ?? ''}`}
      contenido={cerrar => (
        <>
          <ItemMenu onClick={() => { cerrar(); setRenombrando(t.id) }}>Renombrar</ItemMenu>
          <span className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6E6A62]">Por qué esta combinación</span>
          {MOTIVOS_COMBINACION.map(m => (
            <ItemMenu key={m.codigo} onClick={() => { cerrar(); onMotivo(t.id, m.codigo) }}>{m.etiqueta}</ItemMenu>
          ))}
          <ItemMenu onClick={() => { cerrar(); onMotivo(t.id, null) }}>Sin motivo</ItemMenu>
          {t.canon !== 'Recomendada' && (
            <>
              <SeparadorMenu />
              <ItemMenu peligro onClick={() => { cerrar(); onEliminarTarifa(t.id) }}>Eliminar esta tarifa</ItemMenu>
            </>
          )}
        </>
      )}
    />
  ) : null

  const unaTarifa = (t: TarifaCalculada) => (
    <div className="flex flex-col gap-3 rounded-xl border border-[#E2DED5] bg-white p-3" data-tarifa-abierta={t.id}>
      <div className="flex items-center gap-2">
        {renombrando === t.id ? (
          <input
            autoFocus
            defaultValue={t.nombre ?? ''}
            aria-label="Nombre de la tarifa"
            className={`${INPUT} !w-auto`}
            onBlur={e => { setRenombrando(null); if (e.target.value.trim() && e.target.value.trim() !== t.nombre) onRenombrar(t.id, e.target.value.trim()) }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
        ) : (
          <span className="text-[13px] text-[#6E6A62]">Escoge lo que va en la <b className="text-[#191713]">{t.nombre}</b></span>
        )}
        <span className="ml-auto">{menuTarifa(t)}</span>
      </div>
      {servicios.map(s => {
        const elegida = t.opcionPorServicio[s.grupo] ?? null
        return (
          <div key={s.grupo} className="flex flex-col gap-1.5" data-servicio-tarifa={s.grupo}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase text-white" style={{ backgroundColor: `var(--tipo-${s.tipo})` }}>{s.tipo}</span>
              <b className="text-sm">{s.nombre}</b>
              {elegida && <button type="button" className={`${LINK} ml-auto text-xs`} onClick={() => onVerEnElViaje(s.grupo, elegida)}>Ver en el viaje ›</button>}
            </div>
            <div role="radiogroup" aria-label={`${s.nombre} en ${t.nombre}`} className="flex flex-col gap-1.5">
              {s.candidatas.map(id => {
                const on = id === elegida
                const cabe = cabeEnTarifa(t.id, id)
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!editable || ocupado || !cabe}
                    title={cabe ? undefined : 'Va con otro hotel: no cabe en esta tarifa'}
                    onClick={() => { if (!on) onElegir(t.id, s.grupo, id) }}
                    data-opcion-tarifa={id}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left ${on ? 'border-[#0E5C43] bg-[#EAF1EE]' : 'border-[#E2DED5] bg-white hover:bg-[#F8F7F3]'}`}
                  >
                    <span aria-hidden className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${on ? 'border-[#0E5C43] bg-[#0E5C43] shadow-[inset_0_0_0_2px_white]' : 'border-[#CFCAC0]'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{nombreDeOpcion(id)}</span>
                      {detalleDeOpcion(id) && <small className="block truncate text-xs text-[#6E6A62]">{detalleDeOpcion(id)}</small>}
                    </span>
                    <b className="tabular-nums">{pesos(precioDeOpcion(id))}</b>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {iguales.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-semibold">
            Van igual en todas las tarifas <span className="font-normal text-[#6E6A62]">({iguales.length} servicios · {pesos(iguales.reduce((a, s) => a + s.precio, 0))})</span>
          </summary>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
            {iguales.map(s => (
              <li key={s.grupo} className="flex justify-between gap-2">
                <span>{s.nombre} <span className="text-[#6E6A62]">· {s.opcion}</span></span>
                <span className="tabular-nums">{pesos(s.precio)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {(opcionales.length > 0 || noVan.length > 0) && (
        <div className="flex flex-col gap-1 text-[13px] text-[#6E6A62]">
          {opcionales.length > 0 && <span>Se ofrecen aparte (no suman): {opcionales.map(s => s.nombre).join(', ')}.</span>}
          {noVan.map(s => (
            <span key={s.grupo} className="flex flex-wrap items-center gap-2">
              <span className="line-through">{s.nombre}</span> no va
              {editable && <button type="button" className={`${LINK} text-xs`} onClick={() => onReponer(s.grupo)}>Volver a ponerlo</button>}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 border-t-2 border-[#191713] pt-2" data-total-tarifa>
        <span className="min-w-0 flex-1">
          <small className="block text-[11px] font-bold uppercase tracking-wide text-[#6E6A62]">Total {t.nombre}</small>
          <small className="block text-xs text-[#6E6A62] tabular-nums">costo {pesos(t.costo)} · ganas {pesos(t.precio - t.costo)} · margen {reglas ? 'global' : 'real'} {margenDeTarifa(t)}{notaPublicas(t)}</small>
          {reglas && t.cascada?.reglas && (t.cascada.reglas.puntosPesos > 0 || t.cascada.reglas.descuentos.length > 0) && (
            <small className="block text-xs text-[#6E6A62] tabular-nums" data-desglose-tarifa>
              {t.cascada.reglas.puntosPesos > 0 ? `incluye ${pesos(t.cascada.reglas.puntosPesos)} de puntos extra · ` : ''}
              subtotal {pesos(t.cascada.reglas.subtotal)}
              {t.cascada.reglas.descuentos.map(d => ` · ${d.descripcion} −${pesos(d.valor)}`).join('')}
            </small>
          )}
          {t.canon === 'Recomendada' ? (
            <span className="text-[12.5px] font-semibold text-[#0E5C43]">✓ Siempre se manda: es el total de la cotización</span>
          ) : (
            <span className="flex flex-col">
              <label className="inline-flex items-center gap-1.5 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={vanAlCliente(t)}
                  disabled={!editable || ocupado || !!t.igualA}
                  onChange={e => onMandar(t.id, e.target.checked)}
                />
                Mandarla al cliente
              </label>
              {t.igualA && <span className="text-[11.5px] font-semibold text-[#9A5F0C]">Quedó igual a la {t.igualA}: no se manda. Cambia una opción para mandarla.</span>}
            </span>
          )}
        </span>
        <b className="text-xl tabular-nums">{pesos(t.precio)}</b>
      </div>
    </div>
  )

  const comparar = (
    <div className="overflow-x-auto rounded-xl border border-[#E2DED5] bg-white" data-comparar>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[#F8F7F3] text-left text-xs text-[#6E6A62]">
            <th className="px-2.5 py-2">Servicio</th>
            {visibles.map(t => (
              <th key={t.id} className="px-2.5 py-2">
                <button type="button" className="border-0 bg-transparent p-0 font-bold text-[#191713]" onClick={() => setVer(t.id)}>{t.nombre}{t.canon === 'Recomendada' ? ' ★' : ''}</button>
                <b className={`block tabular-nums text-[#191713] ${vanAlCliente(t) ? '' : 'line-through'}`}>{pesos(t.precio)}</b>
                <small>{t.canon === 'Recomendada' ? 'el total' : vanAlCliente(t) ? 'se manda' : 'no se manda'}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {servicios.map(s => (
            <tr key={s.grupo} className="border-t border-[#E2DED5] align-top">
              <td className="px-2.5 py-2 font-semibold">{s.nombre}</td>
              {visibles.map(t => {
                const o = t.opcionPorServicio[s.grupo]
                return (
                  <td key={t.id} className="px-2.5 py-2">
                    <select
                      value={o ?? ''}
                      disabled={!editable || ocupado}
                      aria-label={`${s.nombre} en ${t.nombre}`}
                      onChange={e => onElegir(t.id, s.grupo, e.target.value)}
                      className={`${INPUT} !py-1`}
                    >
                      {s.candidatas.map(id => <option key={id} value={id}>{nombreDeOpcion(id)}</option>)}
                    </select>
                    <span className="block text-xs text-[#6E6A62] tabular-nums">{o ? pesos(precioDeOpcion(o)) : ''}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="flex flex-col gap-3" id="tarifas" data-paso-tarifas>
      <h2 className="m-0 text-base font-bold">2 · Tarifas</h2>
      {servicios.length === 0 ? (
        <p className="m-0 rounded-xl border border-[#E2DED5] bg-white p-3 text-[13px]">
          <b>No hay nada que escoger.</b> Cada servicio tiene una sola opción, así que al cliente le llega una sola tarifa, la Recomendada
          {actual ? <>: <b className="tabular-nums">{pesos(actual.precio)}</b></> : ''}. Este paso se salta solo; aquí solo queda el margen.
        </p>
      ) : (
        <>
          <p className="m-0 text-lg font-bold">{pregunta}</p>
          <p className="m-0 text-[13px] text-[#6E6A62]">
            {visibles.length > 1
              ? 'El cliente recibe hasta tres maneras de hacer el mismo viaje: Económica, Recomendada y Premium. Escoge, para cada una, cuál opción va. La Recomendada es el total de la cotización.'
              : `Una sola tarifa: la Recomendada. Vuelos y hoteles tienen una sola manera; las opciones son solo de ${servicios.map(s => s.nombre).join(' y ')}. Escoge aquí cuál va: no se crean Económica ni Premium, y el PDF conserva el «Día a día».`}
          </p>
        </>
      )}
      {visibles.length > 0 && (
        <div role="tablist" aria-label="Tarifas" className="sticky top-[118px] z-10 flex gap-1.5 overflow-x-auto bg-[#F3F1EC] pb-0.5">
          {visibles.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={ver === t.id}
              onClick={() => setVer(t.id)}
              data-tab-tarifa={t.id}
              className={`flex min-w-[104px] flex-1 flex-col gap-px rounded-[10px] border px-2.5 py-1.5 text-left ${ver === t.id ? 'border-[#191713] bg-[#191713] text-[#F3F1EC]' : 'border-[#CFCAC0] bg-white'}`}
            >
              {totalTab(t)}
            </button>
          ))}
          {visibles.length > 1 && servicios.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={ver === 'comparar'}
              onClick={() => setVer('comparar')}
              className={`flex min-w-[104px] flex-col gap-px rounded-[10px] border px-2.5 py-1.5 text-left max-sm:hidden ${ver === 'comparar' ? 'border-[#191713] bg-[#191713] text-[#F3F1EC]' : 'border-[#CFCAC0] bg-white'}`}
            >
              <span className="text-[12.5px] font-bold">Comparar</span>
              <small className="text-[11px] opacity-75">las tres lado a lado</small>
            </button>
          )}
        </div>
      )}
      {margenYAutorizacion}
      {ver === 'comparar' ? comparar : actual ? unaTarifa(actual) : null}
      <div className="flex flex-col gap-2">
        <button type="button" className={`${LINK} self-start text-[13px]`} onClick={() => setVerCalculo(v => !v)} aria-expanded={verCalculo}>
          {verCalculo ? '▾' : '▸'} Ver el cálculo (costo, margen, descuento comercial)
        </button>
        {verCalculo && <div data-ver-calculo>{verElCalculo}{rastro}</div>}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN} onClick={() => onSeguir(1)}>← Armar el viaje</button>
        <button type="button" className={BTN_PRIM} onClick={() => onSeguir(3)}>Seguir a Revisar y enviar →</button>
      </div>
    </div>
  )
}
