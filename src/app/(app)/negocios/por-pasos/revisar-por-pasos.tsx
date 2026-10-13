'use client'

import { useState, type ReactNode } from 'react'

import { BTN, BTN_PRIM } from '@/components/viaje/estilo'
import { pesos } from '@/lib/cotizaciones/tarjeta-opcion'

/**
 * Paso 3 · REVISAR Y ENVIAR (diseño, Paso 3). Arriba lo que hay que resolver; luego el documento;
 * abajo, fija, la barra de envío con el total de la cotización (la Recomendada: la misma cifra del
 * PDF y del panel del negocio) y «Enviar al cliente».
 *
 * «Enviar al cliente» es lo ÚNICO que pide confirmación (decisión G, criterio D3), con el monto:
 * todo lo demás se hace de una vez y se deshace.
 */
export function RevisarPorPasos({
  total,
  enviada,
  editable,
  ocupado,
  motivoParaNoEnviar,
  lista,
  documento,
  onDescargar,
  onEnviar,
  onSeguir,
}: {
  total: number
  enviada: boolean
  editable: boolean
  ocupado: boolean
  /** Por qué no se puede enviar (lo mismo que el servidor rechaza). `null` = se puede. */
  motivoParaNoEnviar: string | null
  /** Lo que hay que revisar antes de enviar. */
  lista: ReactNode
  /** El documento: el texto para el cliente y lo que imprime el PDF. */
  documento: ReactNode
  onDescargar: () => void
  onEnviar: () => void
  onSeguir: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  return (
    <div className="flex flex-col gap-3" data-paso-revisar>
      <h2 className="m-0 text-base font-bold">3 · Revisar y enviar</h2>
      <p className="m-0 text-[13px] text-[#6E6A62]">Esto es lo que le llega al cliente. Lo que falte está en esta lista.</p>
      {enviada && (
        <p className="m-0 rounded-xl border border-[#E2DED5] bg-white p-3 text-[13px]" data-enviada>
          Esta cotización está enviada y no se puede editar. Para cambiarla, duplícala.
        </p>
      )}
      <div id="lista" className="flex flex-col gap-2">{lista}</div>
      <div id="doc" className="flex flex-col gap-3">{documento}</div>
      <div
        className="sticky bottom-[7.5rem] z-10 flex flex-wrap items-center gap-2.5 rounded-xl border border-[#E2DED5] bg-white p-3 shadow-[0_-4px_14px_rgba(25,23,19,.06)] lg:bottom-2"
        data-barra-envio
      >
        <span className="min-w-[200px] flex-1">
          <b className="block text-xl tabular-nums">{pesos(total)}</b>
          <small className="text-xs text-[#6E6A62]">
            Total de la cotización (Recomendada). Es la cifra del PDF y del panel del negocio; la lista de negocios muestra el valor estimado hasta que se aprueba.
          </small>
        </span>
        <button type="button" className={BTN} onClick={onDescargar} disabled={ocupado}>Descargar PDF</button>
        {editable && !enviada && (
          <button
            type="button"
            className={BTN_PRIM}
            disabled={ocupado || !!motivoParaNoEnviar}
            title={motivoParaNoEnviar ?? undefined}
            onClick={() => setConfirmando(true)}
            data-enviar
          >
            Enviar al cliente
          </button>
        )}
        {motivoParaNoEnviar && editable && !enviada && (
          <p className="m-0 w-full text-xs text-[#B3382C]">{motivoParaNoEnviar}</p>
        )}
        {confirmando && (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-[#CFCAC0] bg-[#F8F7F3] p-2.5 text-[13px]" role="alertdialog" aria-label="Confirmar el envío" data-confirmar-envio>
            <span className="min-w-0 flex-1">
              ¿Enviar al cliente la cotización por <b className="tabular-nums">{pesos(total)}</b>? Es lo único que no se puede deshacer: queda enviada y ya no se edita.
            </span>
            <button type="button" className={BTN_PRIM} disabled={ocupado} onClick={() => { setConfirmando(false); onEnviar() }}>Sí, enviar</button>
            <button type="button" className={BTN} onClick={() => setConfirmando(false)}>Cancelar</button>
          </div>
        )}
      </div>
      <div className="flex justify-start">
        <button type="button" className={BTN} onClick={onSeguir}>← Tarifas</button>
      </div>
    </div>
  )
}
