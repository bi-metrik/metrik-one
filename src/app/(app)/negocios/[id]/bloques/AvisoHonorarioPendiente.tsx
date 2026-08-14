'use client'

import { AlertTriangle } from 'lucide-react'
import { MENSAJE_HONORARIO_PENDIENTE } from '@/lib/negocios/honorario-confirmado'

/**
 * Aviso que se muestra en la superficie de captura del pago cuando el negocio
 * todavía no tiene el honorario confirmado.
 *
 * Llega ANTES del formulario a propósito: el trigger de base ya rechaza el cobro,
 * pero ese rechazo aparece después de teclear referencia y valor. El control
 * existía; lo que faltaba era que llegara a tiempo.
 *
 * El texto sale de `MENSAJE_HONORARIO_PENDIENTE`, la misma constante que usa el
 * motivo del servidor: escrito dos veces, la pantalla y el rechazo terminarían
 * diciendo cosas distintas sobre el mismo bloqueo.
 */
export default function AvisoHonorarioPendiente() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex gap-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-amber-900">Falta confirmar el honorario</p>
        <p className="text-[11px] leading-relaxed text-amber-900">{MENSAJE_HONORARIO_PENDIENTE}</p>
      </div>
    </div>
  )
}
