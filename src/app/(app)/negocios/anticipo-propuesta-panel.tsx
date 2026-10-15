'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { guardarAnticipoPropuesta } from '@/app/(app)/negocios/documento-cliente-actions'
import { MAX_TEXTO_ANTICIPO, type AnticipoPropuesta } from '@/lib/cotizaciones/propuesta/anticipo'
import { pesos } from '@/lib/viaje/plan-pagos'

/**
 * «Para apartar» (decisión de Mauricio del 2026-10-14, punto 3): la asesora asigna a mano el
 * anticipo de ESTA cotización, un monto y una línea. Sin monto, la propuesta no dice ninguna
 * cifra y el botón solo abre su WhatsApp. Guardarlo no registra ningún pago.
 */
export default function AnticipoPropuestaPanel({
  cotizacionId,
  inicial,
  editable,
}: {
  cotizacionId: string
  inicial: AnticipoPropuesta | null
  editable: boolean
}) {
  const [guardado, setGuardado] = useState<AnticipoPropuesta | null>(inicial)
  const [monto, setMonto] = useState(inicial ? String(inicial.monto) : '')
  const [texto, setTexto] = useState(inicial?.texto ?? '')
  const [guardando, startGuardar] = useTransitionTolerante()

  const montoLimpio = monto.replace(/[^\d]/g, '')
  const cambios = montoLimpio !== (guardado ? String(guardado.monto) : '') || texto.trim() !== (guardado?.texto ?? '')

  const guardar = (quitar = false) => {
    startGuardar(async () => {
      const res = await guardarAnticipoPropuesta(cotizacionId, quitar ? null : { monto: montoLimpio, texto })
      if (!res.success) {
        toast.error(res.error)
        return
      }
      const nuevo = res.panel.anticipo ?? null
      setGuardado(nuevo)
      setMonto(nuevo ? String(nuevo.monto) : '')
      setTexto(nuevo?.texto ?? '')
      toast.success(nuevo ? 'Anticipo guardado: sale en la propuesta.' : 'Sin anticipo: la propuesta no dice cifra para apartar.')
    })
  }

  return (
    <div className="space-y-1.5 border-t pt-3" data-anticipo-propuesta>
      <p className="text-xs font-semibold">Para apartar</p>
      <p className="text-[11px] text-muted-foreground">
        Sale en la propuesta, junto al botón de WhatsApp. Sin monto, no se imprime ninguna cifra. No registra ningún pago.
      </p>
      {editable ? (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Monto para apartar"
              inputMode="numeric"
              value={montoLimpio ? pesos(Number(montoLimpio)) : ''}
              onChange={e => setMonto(e.target.value)}
              placeholder="$ 0"
              className="w-36 rounded-md border px-2 py-1 text-xs tabular-nums"
            />
            <input
              aria-label="Línea para el cliente"
              value={texto}
              maxLength={MAX_TEXTO_ANTICIPO}
              onChange={e => setTexto(e.target.value)}
              placeholder="Con esto les bloqueamos los hoteles"
              className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            {guardado && (
              <button
                type="button"
                onClick={() => guardar(true)}
                disabled={guardando}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                Quitar
              </button>
            )}
            <button
              type="button"
              onClick={() => guardar()}
              disabled={guardando || !cambios}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
              Guardar anticipo
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs">{guardado ? `${pesos(guardado.monto)}${guardado.texto ? ` · ${guardado.texto}` : ''}` : '—'}</p>
      )}
    </div>
  )
}
