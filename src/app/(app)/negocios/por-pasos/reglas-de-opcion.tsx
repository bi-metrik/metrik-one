'use client'

import { useState } from 'react'

import { BTN, BTN_PRIM, INPUT, LINK } from '@/components/viaje/estilo'
import { pesos, porcentaje } from '@/lib/cotizaciones/tarjeta-opcion'
import { MAX_MOTIVO_DESCUENTO, motivoDescuentoInvalido, textoColchon } from '@/lib/cotizaciones/reglas-margen'
import type { ReglasDeLinea } from '@/lib/cotizaciones/totales'
import type { DescuentoClienteGuardado } from '@/lib/cotizaciones/tarifa-pasajero'
import { parseMontoCop } from '@/lib/negocios/monto-cop'
import { motivoComisionInvalida, type ComisionEscrita } from '@/lib/cotizaciones/tarifa-publica'

/**
 * Lo que las reglas de margen (brief del 2026-10-27) agregan a la tarjeta de UNA opción, debajo
 * del margen:
 *
 *  · **Vuelo**: de dónde sale su margen, el colchón por tiquete. Se edita en «Ajustar», como
 *    cualquier margen; escrito a mano, deja de seguir el colchón.
 *  · **Hotel**: el descuento que el cliente ve en esta opción, con su motivo, en % (puntos de
 *    margen que se ceden) o en pesos.
 *  · **Pública**: la comisión de la agencia, en % o en pesos (`CampoComision`). Obligatoria (D3 de
 *    Mauricio, 2026-10-29): sin ella el margen general no se puede medir y la cotización no se envía.
 *
 * Solo en la cotización por pasos y solo con reglas: sin ellas la tarjeta es la de siempre (la
 * comisión de una Pública sí se pide igual, con `CampoComision` suelto).
 */
export function ReglasDeOpcion({
  reglas,
  descuento,
  comision,
  publica,
  editable,
  ocupado,
  onDescuento,
  onComision,
}: {
  reglas: ReglasDeLinea
  /** El descuento guardado en la opción (`tarifa_pax.descuentoCliente`). */
  descuento: DescuentoClienteGuardado | null
  /** La comisión guardada en la decisión de Pública, en % o en pesos. */
  comision: ComisionEscrita | null
  publica: boolean
  editable: boolean
  ocupado: boolean
  onDescuento: (d: { motivo: string; tipo: 'pct' | 'monto'; valor: number } | null) => void
  onComision: (c: ComisionEscrita | null) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState(descuento?.motivo ?? '')
  const [tipo, setTipo] = useState<'pct' | 'monto'>(descuento?.tipo ?? 'pct')
  const [valor, setValor] = useState(descuento ? String(descuento.valor).replace('.', ',') : '')
  const [error, setError] = useState<string | null>(null)

  const guardarDescuento = () => {
    const n = tipo === 'pct' ? Number(valor.replace(',', '.')) : parseMontoCop(valor)
    const d = { motivo: motivo.trim(), tipo, valor: Number(n) }
    const invalido = motivoDescuentoInvalido(d)
    if (invalido) { setError(invalido); return }
    setError(null)
    setAbierto(false)
    onDescuento(d)
  }

  if (reglas.tipo === 'vuelo' && reglas.colchon) {
    const c = reglas.colchon
    return (
      <div className="flex flex-col gap-0.5 rounded-lg border border-[#E2DED5] bg-[#F8F7F3] px-3 py-2 text-xs text-[#6E6A62]" data-colchon-vuelo>
        <span><b className="text-[#191713]">{textoColchon(c)}</b> = {pesos(c.colchon)}</span>
        <span>Es el margen de este vuelo: cubre lo que se mueva el precio hasta la reserva. Cámbialo en «Ajustar».</span>
        {c.sinReconocer.length > 0 && (
          <span className="text-[#9A5F0C]" data-colchon-dudoso>No reconocí {c.sinReconocer.join(' ni ')}: lo tomé como internacional.</span>
        )}
      </div>
    )
  }

  if (publica) return <CampoComision comision={comision} editable={editable} ocupado={ocupado} onComision={onComision} />

  if (reglas.tipo !== 'hotel') return null
  const d = reglas.descuento
  return (
    <div className="flex flex-col gap-2" data-descuento-hotel>
      {d && !abierto && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E9C98F] bg-[#FBF1E2] px-3 py-2 text-[13px]" data-descuento-actual>
          <span className="min-w-0 flex-1">
            <b>Descuento para el cliente</b> · {d.motivo}: <b className="tabular-nums">−{pesos(d.valor)}</b>
            <span className="block text-xs text-[#6E6A62]">
              Antes {pesos(d.precioSinDescuento)}{descuento?.tipo === 'pct' ? ` · cede ${porcentaje(descuento.valor)} de margen` : ''}. El cliente lo ve en esta opción.
            </span>
          </span>
          {editable && (
            <span className="flex gap-2">
              <button type="button" className={`${LINK} text-xs`} disabled={ocupado} onClick={() => setAbierto(true)}>Cambiar</button>
              <button type="button" className={`${LINK} text-xs`} disabled={ocupado} onClick={() => onDescuento(null)} data-quitar-descuento>Quitar</button>
            </span>
          )}
        </div>
      )}
      {!d && !abierto && editable && (
        <button type="button" className={`${LINK} self-start text-[13px]`} disabled={ocupado} onClick={() => setAbierto(true)} data-agregar-descuento>
          + Descuento para el cliente
        </button>
      )}
      {abierto && editable && (
        <div className="flex flex-col gap-2 rounded-lg border border-[#CFCAC0] bg-[#F8F7F3] p-3" data-form-descuento>
          <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
            <span>Motivo (lo ve el cliente)</span>
            <input
              type="text"
              className={INPUT}
              maxLength={MAX_MOTIVO_DESCUENTO}
              value={motivo}
              placeholder="Ej.: Reserva esta semana"
              onChange={e => setMotivo(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <span role="radiogroup" aria-label="Tipo de descuento" className="inline-flex overflow-hidden rounded-md border border-[#CFCAC0]">
              {(['pct', 'monto'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={tipo === t}
                  onClick={() => setTipo(t)}
                  className={`border-0 px-2.5 py-1 text-xs font-semibold ${tipo === t ? 'bg-[#191713] text-[#F3F1EC]' : 'bg-white text-[#191713]'} ${t === 'monto' ? 'border-l border-[#CFCAC0]' : ''}`}
                >
                  {t === 'pct' ? '% de margen' : '$ pesos'}
                </button>
              ))}
            </span>
            <label className="flex flex-col gap-0.5 text-xs text-[#6E6A62]">
              <span>{tipo === 'pct' ? 'Puntos de margen' : 'Pesos'}</span>
              <input
                type="text"
                inputMode={tipo === 'pct' ? 'decimal' : 'numeric'}
                className={`${INPUT} w-[110px] tabular-nums`}
                value={valor}
                onChange={e => setValor(e.target.value)}
              />
            </label>
          </div>
          {error && <p className="m-0 text-xs text-[#B3382C]">{error}</p>}
          <p className="m-0 text-xs text-[#6E6A62]">
            {tipo === 'pct'
              ? 'Un hotel al 15 % con 3 de descuento queda al 12 %. Por debajo del mínimo de hotel, la cotización pide autorización.'
              : 'Se resta del precio de esta opción.'}
          </p>
          <span className="flex gap-2">
            <button type="button" className={BTN_PRIM} disabled={ocupado} onClick={guardarDescuento}>Guardar descuento</button>
            <button type="button" className={BTN} onClick={() => { setAbierto(false); setError(null) }}>Cancelar</button>
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * «Comisión de la agencia» de una opción Pública (D3 de Mauricio, 2026-10-29): la asesora la escribe a
 * mano, en % del precio público o en pesos por toda la opción. Siempre visible y obligatoria: sin ella
 * la cotización no se puede enviar y el PDF sale como borrador. Avisa con `onComision` al salir de la
 * casilla; quien la usa decide si eso la guarda (la línea y el paquete ya guardado) o si espera a
 * «Guardar paquete» (el paquete nuevo), y lo dice con `nota`.
 */
export function CampoComision({
  comision,
  editable,
  ocupado,
  onComision,
  etiqueta = 'Comisión de la agencia',
  nota = null,
}: {
  comision: ComisionEscrita | null
  editable: boolean
  ocupado: boolean
  onComision: (c: ComisionEscrita | null) => void
  etiqueta?: string
  /**
   * Cuándo queda guardada (QA del #1342): «al salir de la casilla» si se guarda sola, o «con
   * “Guardar paquete”» si espera al botón. `null` = no se dice.
   */
  nota?: string | null
}) {
  const [tipo, setTipo] = useState<'pct' | 'monto'>(comision?.tipo ?? 'pct')
  const [escrito, setEscrito] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const guardado = comision && comision.tipo === tipo ? comision.valor : null
  const visible = escrito ?? (guardado === null ? '' : tipo === 'pct' ? String(guardado).replace('.', ',') : guardado.toLocaleString('es-CO'))

  const guardar = (t: 'pct' | 'monto', texto: string | null) => {
    if (texto === null) return
    setEscrito(null)
    const limpio = texto.trim()
    // Vaciar la casilla quita la comisión (y la cotización vuelve a no poder enviarse).
    if (limpio === '') { setError(null); if (comision) onComision(null); return }
    const valor = t === 'pct' ? Number(limpio.replace(',', '.')) : Number(parseMontoCop(limpio))
    const c = { tipo: t, valor }
    const invalida = motivoComisionInvalida(c)
    if (invalida) { setError(invalida); return }
    setError(null)
    if (comision && comision.tipo === c.tipo && comision.valor === c.valor) return
    onComision(c)
  }

  return (
    <div className="flex flex-col gap-1 text-[13px] text-[#191713]" data-comision-publica>
      <span className="flex flex-wrap items-center gap-2">
        <span>{etiqueta}</span>
        <span role="radiogroup" aria-label="Comisión en % o en pesos" className="inline-flex overflow-hidden rounded-md border border-[#CFCAC0]">
          {(['pct', 'monto'] as const).map(t => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tipo === t}
              disabled={!editable || ocupado}
              onClick={() => { setTipo(t); setEscrito(null); setError(null) }}
              className={`border-0 px-2 py-0.5 text-xs font-semibold ${tipo === t ? 'bg-[#191713] text-[#F3F1EC]' : 'bg-white text-[#191713]'} ${t === 'monto' ? 'border-l border-[#CFCAC0]' : ''}`}
              data-comision-tipo={t}
            >
              {t === 'pct' ? '%' : '$'}
            </button>
          ))}
        </span>
        <input
          type="text"
          inputMode={tipo === 'pct' ? 'decimal' : 'numeric'}
          aria-label={tipo === 'pct' ? 'Comisión de la agencia en %' : 'Comisión de la agencia en pesos'}
          className={`${INPUT.replace('w-full ', '')} ${tipo === 'pct' ? 'w-[70px]' : 'w-[120px]'} tabular-nums`}
          placeholder={tipo === 'pct' ? '—' : '$'}
          value={visible}
          onChange={e => setEscrito(e.target.value)}
          onBlur={() => guardar(tipo, escrito)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          disabled={!editable || ocupado}
        />
        {tipo === 'pct' && <span>%</span>}
      </span>
      {error && <span className="text-xs text-[#B3382C]" data-comision-error>{error}</span>}
      <span className={`text-xs ${comision ? 'text-[#6E6A62]' : 'font-semibold text-[#B3382C]'}`} data-comision-estado={comision ? 'escrita' : 'falta'}>
        {/* La ayuda sigue a la casilla (brief del 2026-10-29): al pasar de $ a % la casilla queda
            vacía, y decir «menos $300.000» ahí habla de algo que ya no se ve. */}
        {comision && comision.tipo === tipo
          ? `Entra al margen de la cotización: la agencia paga el precio público menos ${comision.tipo === 'pct' ? porcentaje(comision.valor) : pesos(comision.valor)}.`
          : comision
            ? `Escribe la comisión ${tipo === 'pct' ? 'en %' : 'en pesos'}: al guardarla reemplaza la que está ${comision.tipo === 'pct' ? 'en %' : 'en pesos'}.`
            : 'Escribe la comisión: sin ella la cotización no se puede enviar y el PDF sale como borrador.'}
      </span>
      {nota && <span className="text-xs text-[#6E6A62]" data-comision-nota>{nota}</span>}
    </div>
  )
}
