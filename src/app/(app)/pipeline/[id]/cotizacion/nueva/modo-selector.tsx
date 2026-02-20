'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Zap, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import { createCotizacionFlash, createCotizacionDetallada } from '../../cotizaciones/actions-v2'

interface Props {
  oportunidadId: string
}

export default function ModoSelector({ oportunidadId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showFlash, setShowFlash] = useState(false)
  const [flashDesc, setFlashDesc] = useState('')
  const [flashValor, setFlashValor] = useState('')

  const handleFlashCreate = () => {
    if (!flashDesc.trim() || Number(flashValor) <= 0) return
    startTransition(async () => {
      const res = await createCotizacionFlash(oportunidadId, flashDesc, Number(flashValor))
      if (res.success) {
        toast.success('Cotizacion flash creada')
        router.push(`/pipeline/${oportunidadId}/cotizacion/${res.id}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDetalladaCreate = () => {
    startTransition(async () => {
      const res = await createCotizacionDetallada(oportunidadId)
      if (res.success) {
        toast.success('Cotizacion detallada creada')
        router.push(`/pipeline/${oportunidadId}/cotizacion/${res.id}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/pipeline/${oportunidadId}`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold">Nueva cotizacion</h1>
          <p className="text-xs text-muted-foreground">Selecciona el tipo</p>
        </div>
      </div>

      {!showFlash ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Flash */}
          <button
            onClick={() => setShowFlash(true)}
            disabled={isPending}
            className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
              <Zap className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Flash</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Rapida: solo descripcion y valor total
              </p>
            </div>
          </button>

          {/* Detallada */}
          <button
            onClick={handleDetalladaCreate}
            disabled={isPending}
            className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <ListChecks className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Detallada</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Items, rubros, costos y margen
              </p>
            </div>
          </button>
        </div>
      ) : (
        /* Flash inline form */
        <div className="space-y-4 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Cotizacion flash</h2>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Descripcion *</label>
            <textarea
              value={flashDesc}
              onChange={e => setFlashDesc(e.target.value)}
              placeholder="Describe el trabajo cotizado"
              rows={2}
              autoFocus
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Valor total *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                type="number"
                value={flashValor}
                onChange={e => setFlashValor(e.target.value)}
                placeholder="8000000"
                min="0"
                className="w-full rounded-md border bg-background py-2 pl-7 pr-3 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFlash(false)}
              className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              onClick={handleFlashCreate}
              disabled={isPending || !flashDesc.trim() || Number(flashValor) <= 0}
              className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? 'Creando...' : 'Crear cotizacion flash'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
