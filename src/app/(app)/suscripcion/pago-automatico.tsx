'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CreditCard } from 'lucide-react'
import { useIntencion } from '@/hooks/use-intencion'
import { formatCOP } from '@/lib/cobros/format'
import { TEXTO_SOLO_ESTE_MES, type MesPorEnlace } from '@/lib/valida-cda/pago-unico'
import {
  TEXTO_ACEPTA_V15,
  TEXTO_CONFIRMAR_QUITAR,
  TEXTO_PENDIENTE_CON_ENLACE,
  TEXTO_SIN_TARJETA,
  type VistaPagoAutomatico,
  type VistaPendiente,
} from '@/lib/valida-cda/tarjeta-cda'
import { pagarPendienteConTarjeta, pagarSoloEsteMes, quitarTarjetaPagoAutomatico } from './acciones'

/**
 * El bloque «Pagar» de la pestaña Pagos de `/suscripcion` (brief del 2026-11-03): UN solo bloque con dos
 * opciones que se excluyen, para que nadie pague el mismo período dos veces.
 *
 *   - Principal: «Pago automático con tarjeta» (Términos v1.5, 2.4; diseño del 2026-10-30).
 *   - Secundaria: «Pagar solo este mes (PSE u otro medio)»: abre el enlace de la cuota o lo pide en ese
 *     momento. Con la tarjeta activa solo aparece si la tarjeta no cobra esa cuota (lo atrasado) o ya la
 *     rechazó (`mesPorEnlace`).
 *
 * Lo ve solo la persona designada (D1): la página no lo pinta para nadie más y las acciones lo vuelven a
 * exigir.
 *
 *   - Sin la v1.5 aceptada (D2): lleva a aceptarla, sin formulario.
 *   - Sin tarjeta: «Registrar tarjeta» lleva a `/suscripcion/tarjeta`, la única página del espacio con la
 *     política de contenido de ePayco (los datos de la tarjeta van del navegador a ePayco).
 *   - Con tarjeta: el resumen, el aviso de un cobro rechazado, «Cambiar tarjeta», «Quitar tarjeta» (con
 *     confirmación) y, si hay algo atrasado, la pregunta con su propio botón y su confirmación (D3).
 */

const BOTON = 'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50'

export function PagoAutomatico({ vista, mes = null, soloLectura }: { vista: VistaPagoAutomatico; mes?: MesPorEnlace | null; soloLectura: boolean }) {
  return (
    <section data-bloque-pagar data-pago-automatico={vista.tipo} className="space-y-3 rounded-lg border border-border bg-white p-4">
      <p className="text-sm font-semibold text-tinta">Pagar</p>
      <p className="flex items-center gap-2 text-sm font-semibold text-tinta">
        <CreditCard className="h-4 w-4 shrink-0 text-acento" />
        Pago automático con tarjeta
      </p>
      {vista.tipo === 'acepta_v15' && (
        <>
          <p className="text-sm text-tinta">{TEXTO_ACEPTA_V15}</p>
          <Link
            href="/valida?modificacion=1"
            data-aceptar-v15
            className={`${BOTON} w-full border border-acento text-acento sm:w-auto ${soloLectura ? 'pointer-events-none opacity-50' : ''}`}
          >
            Revisar y aceptar la versión 1.5
          </Link>
        </>
      )}
      {vista.tipo === 'sin_tarjeta' && (
        <>
          <p className="text-sm text-tinta-suave">{TEXTO_SIN_TARJETA}</p>
          <Link
            href="/suscripcion/tarjeta"
            data-registrar-tarjeta
            className={`${BOTON} w-full bg-acento text-white sm:w-auto ${soloLectura ? 'pointer-events-none opacity-50' : ''}`}
          >
            Registrar tarjeta
          </Link>
        </>
      )}
      {vista.tipo === 'activa' && <TarjetaActiva vista={vista} soloLectura={soloLectura} />}
      {mes && <SoloEsteMes mes={mes} soloLectura={soloLectura} />}
    </section>
  )
}

/** La opción secundaria: el enlace de la cuota (PSE u otro medio), el vigente o uno pedido en el momento. */
function SoloEsteMes({ mes, soloLectura }: { mes: MesPorEnlace; soloLectura: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  const etiqueta = `${TEXTO_SOLO_ESTE_MES} · ${formatCOP(mes.saldo)}`
  return (
    <div data-solo-este-mes className="space-y-1 border-t border-border pt-3">
      {mes.enlace ? (
        <a
          href={mes.enlace}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BOTON} w-full border border-border text-tinta sm:w-auto ${soloLectura ? 'pointer-events-none opacity-50' : ''}`}
        >
          {etiqueta}
        </a>
      ) : (
        <button
          type="button"
          disabled={soloLectura || pendiente}
          onClick={() =>
            iniciar(async () => {
              setError(null)
              const r = await pagarSoloEsteMes()
              if (r.ok) window.location.assign(r.url)
              else setError(r.error)
            })
          }
          className={`${BOTON} w-full border border-border text-tinta sm:w-auto`}
        >
          {pendiente ? 'Preparando el pago…' : etiqueta}
        </button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

function TarjetaActiva({ vista, soloLectura }: { vista: Extract<VistaPagoAutomatico, { tipo: 'activa' }>; soloLectura: boolean }) {
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)
  const [pendiente, iniciar] = useTransition()

  function quitar() {
    iniciar(async () => {
      const r = await quitarTarjetaPagoAutomatico()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setConfirmarQuitar(false)
      toast.success('Quitaste la tarjeta. Los próximos períodos se pagan con el enlace de pago.')
    })
  }

  return (
    <>
      <p data-tarjeta-activa className="text-sm text-emerald-800">
        {vista.resumen}
      </p>
      {vista.fallo && (
        <p data-fallo-tarjeta role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {vista.fallo}
        </p>
      )}
      {confirmarQuitar ? (
        <div data-confirmar-quitar className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm text-tinta">{TEXTO_CONFIRMAR_QUITAR}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-quitar-tarjeta-si disabled={soloLectura || pendiente} onClick={quitar} className={`${BOTON} border border-border text-tinta`}>
              {pendiente ? 'Quitando…' : 'Sí, quitar la tarjeta'}
            </button>
            <button type="button" onClick={() => setConfirmarQuitar(false)} className={`${BOTON} text-tinta-suave`}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/suscripcion/tarjeta"
            data-cambiar-tarjeta
            className={`${BOTON} border border-acento text-acento ${soloLectura ? 'pointer-events-none opacity-50' : ''}`}
          >
            Cambiar tarjeta
          </Link>
          <button type="button" data-quitar-tarjeta disabled={soloLectura} onClick={() => setConfirmarQuitar(true)} className={`${BOTON} border border-border text-tinta`}>
            Quitar tarjeta
          </button>
        </div>
      )}
      {vista.pendiente && <Pendiente pendiente={vista.pendiente} soloLectura={soloLectura} />}
    </>
  )
}

/** D3: lo atrasado nunca se cobra solo. Pregunta, botón aparte y confirmación con lo que se cobra. */
export function Pendiente({ pendiente: p, soloLectura, abiertoInicial = false }: { pendiente: VistaPendiente; soloLectura: boolean; abiertoInicial?: boolean }) {
  const [confirmar, setConfirmar] = useState(abiertoInicial)
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null)
  const [enCurso, iniciar] = useTransition()
  const intencion = useIntencion()

  if (!p.cobrable) {
    return (
      <div data-pendiente-tarjeta="enlace" className="space-y-1 border-t border-border pt-3 text-sm text-tinta">
        <p>{p.texto}</p>
        <p className="text-tinta-suave">{TEXTO_PENDIENTE_CON_ENLACE}</p>
      </div>
    )
  }

  function cobrar() {
    if (!p.cobrable) return
    iniciar(async () => {
      const r = await pagarPendienteConTarjeta({ huella: p.huella }, intencion.clave())
      intencion.cerrar()
      setResultado(r.ok ? { ok: true, texto: r.texto } : { ok: false, texto: r.error })
    })
  }

  return (
    <div data-pendiente-tarjeta="tarjeta" className="space-y-2 border-t border-border pt-3 text-sm text-tinta">
      <p>
        {p.texto} {p.pregunta}
      </p>
      {resultado ? (
        <p role="status" data-resultado-pendiente className={resultado.ok ? 'text-emerald-800' : 'text-red-600'}>
          {resultado.texto}
        </p>
      ) : confirmar ? (
        <div data-confirmar-pendiente className="space-y-2 rounded-md border border-border p-3">
          <p>{p.confirmacion}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-pagar-pendiente-si disabled={soloLectura || enCurso} onClick={cobrar} className={`${BOTON} bg-acento text-white`}>
              {enCurso ? 'Cobrando…' : 'Confirmar y cobrar'}
            </button>
            <button type="button" onClick={() => setConfirmar(false)} className={`${BOTON} text-tinta-suave`}>
              Ahora no
            </button>
          </div>
        </div>
      ) : (
        <button type="button" data-pagar-pendiente disabled={soloLectura} onClick={() => setConfirmar(true)} className={`${BOTON} border border-acento text-acento`}>
          Pagarlo ahora con esta tarjeta
        </button>
      )}
    </div>
  )
}
