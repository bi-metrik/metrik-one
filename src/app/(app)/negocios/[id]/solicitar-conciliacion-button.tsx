'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Scale, Check, Loader2 } from 'lucide-react'
import { solicitarConciliacionDiana } from '@/lib/actions/conciliacion-actions'

/**
 * Botón "Pedir conciliación a Diana" (F2). Un comercial etiqueta el negocio como
 * "necesita conciliación del área financiera". La etiqueta suma al badge del nav
 * y aparece en el panel de conciliación. Reusa activity_log (MVP, sin tabla nueva).
 *
 * `yaSolicitado` arranca el botón en estado "Solicitado" si ya hay una etiqueta
 * viva. El estado real lo recalcula el server en cada carga; aquí solo damos
 * feedback inmediato tras el click.
 */
export default function SolicitarConciliacionButton({
  negocioId,
  yaSolicitado = false,
}: {
  negocioId: string
  yaSolicitado?: boolean
}) {
  const [solicitado, setSolicitado] = useState(yaSolicitado)
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const res = await solicitarConciliacionDiana(negocioId)
      if (res.success) {
        setSolicitado(true)
        toast.success('Listo. El área financiera verá este negocio en su panel de conciliación.')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 shrink-0" style={{ color: '#10B981' }} />
          <div>
            <p className="text-sm font-semibold text-foreground">Conciliación de pago</p>
            <p className="text-[12px] text-muted-foreground">
              {solicitado
                ? 'Ya solicitaste la conciliación. El área financiera la verá en su panel.'
                : 'Avísale al área financiera que este pago necesita conciliación.'}
            </p>
          </div>
        </div>
        <button
          onClick={handleClick}
          disabled={pending || solicitado}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition disabled:cursor-default disabled:opacity-60"
          style={{ borderColor: '#10B981', color: solicitado ? '#6B7280' : '#10B981' }}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : solicitado ? (
            <Check className="h-4 w-4" />
          ) : (
            <Scale className="h-4 w-4" />
          )}
          {solicitado ? 'Solicitado' : 'Pedir conciliación'}
        </button>
      </div>
    </div>
  )
}
