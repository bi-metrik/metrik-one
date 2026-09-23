'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Info, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { autorizarBajoElMinimo, type SalidaVista } from '@/app/(app)/negocios/margen-salida-actions'
import { etiquetaDeMotivo } from '@/lib/cotizaciones/motivos-borrador'
import { notaDeMargen } from '@/lib/cotizaciones/nota-margen'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «22-sep», en hora de Bogotá. */
export function fechaCorta(iso: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const dia = Number(partes.find(p => p.type === 'day')?.value ?? '0')
  const mes = Number(partes.find(p => p.type === 'month')?.value ?? '1')
  return `${dia}-${MESES[mes - 1] ?? ''}`
}

/**
 * El margen mínimo en la salida, dentro del editor de la cotización.
 *
 * Tres estados, y solo donde la línea exige el piso en la salida (`salida.aplica`):
 *
 *  · **Bajo el mínimo, sin autorización:** dice por qué no sale —tarifa, margen y
 *    mínimo— y que el PDF lleva marca de agua. El dueño ve «Autorizar bajo el mínimo».
 *  · **Autorizada:** «Autorizada por Edgar el 22-sep: <motivo>».
 *  · **En el mínimo o encima:** nada. La pantalla de siempre.
 *
 * Y dos que NO son «bajo el mínimo» aunque el servidor frene igual (P1 del ensayo del
 * 2026-09-23, `nota-margen.ts`): una cotización **vacía** no lleva nota —el botón de enviar
 * dice por qué está apagado—, y una con **líneas sin costo** lleva un aviso neutro que dice
 * cuántas faltan. El rojo queda para el margen que de verdad se midió.
 *
 * El botón es solo la puerta visible: `autorizarBajoElMinimo` vuelve a comprobar en el
 * servidor que quien firma es el dueño.
 */
export default function PanelMargenSalida({
  cotizacionId,
  salida,
}: {
  cotizacionId: string
  salida: SalidaVista | null | undefined
}) {
  const router = useRouter()
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [isPending, startTransition] = useTransition()

  if (!salida || !salida.aplica) return null
  const nota = notaDeMargen(salida)
  if (nota.tipo === 'sin_lineas' || nota.tipo === 'nada') return null

  if (nota.tipo === 'incompleta') {
    return (
      <div
        role="alert"
        data-nota="incompleta"
        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          {nota.texto} No se puede enviar; el PDF sale como borrador incompleto.
        </p>
      </div>
    )
  }

  if (nota.tipo === 'faltan_costos') {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{nota.texto}</p>
      </div>
    )
  }

  if (salida.excepcion) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          <strong>
            Autorizada por {salida.excepcion.autorizadaPor} el {fechaCorta(salida.excepcion.autorizadaAt)}:
          </strong>{' '}
          {salida.excepcion.motivo}
          <span className="mt-1 block text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
            Sale bajo el margen mínimo. Si cambia un precio, un costo o un margen, la autorización se pierde.
          </span>
        </p>
      </div>
    )
  }

  if (!salida.bloquea) return null

  const autorizar = () => {
    startTransition(async () => {
      const res = await autorizarBajoElMinimo(cotizacionId, motivo)
      if (res.success) {
        toast.success('Autorizada bajo el margen mínimo')
        setPidiendoMotivo(false)
        setMotivo('')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">
            {nota.tipo === 'bajo_minimo'
              ? `${nota.titulo} No se puede enviar ni aprobar.`
              : 'Bajo el margen mínimo: no se puede enviar ni aprobar'}
          </p>
          <p>{salida.mensaje}</p>
          <p className="text-[11px] text-red-800/80 dark:text-red-300/80">
            El PDF se descarga como borrador, con la marca «{etiquetaDeMotivo('margen')}».
          </p>
          {salida.perdida && (
            <p className="text-[11px] text-red-800/80 dark:text-red-300/80">
              La autorización de {salida.perdida.autorizadaPor} del {fechaCorta(salida.perdida.autorizadaAt)} se
              perdió: {salida.perdida.causa}
            </p>
          )}
        </div>
      </div>

      {salida.puedeAutorizar && !pidiendoMotivo && (
        <button
          type="button"
          onClick={() => setPidiendoMotivo(true)}
          className="rounded-md border border-red-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-transparent dark:text-red-200"
        >
          Autorizar bajo el mínimo
        </button>
      )}

      {salida.puedeAutorizar && pidiendoMotivo && (
        <div className="space-y-2">
          <label className="block text-[11px] font-medium" htmlFor={`motivo-${cotizacionId}`}>
            Motivo (obligatorio)
          </label>
          <textarea
            id={`motivo-${cotizacionId}`}
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Por qué sale bajo el mínimo"
            className="w-full rounded-md border border-red-200 bg-white px-2 py-1.5 text-xs text-foreground dark:border-red-900 dark:bg-background"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={autorizar}
              disabled={isPending || motivo.trim().length < 3}
              className="rounded-md bg-red-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              Autorizar
            </button>
            <button
              type="button"
              onClick={() => { setPidiendoMotivo(false); setMotivo('') }}
              disabled={isPending}
              className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
