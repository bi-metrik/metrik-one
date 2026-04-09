'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { updateLineaActiva } from './actions'

interface Linea {
  id: string
  nombre: string
  descripcion: string | null
  tipo: string
}

export default function FlujoSection({
  lineas,
  lineaActivaId,
}: {
  lineas: Linea[]
  lineaActivaId: string | null
}) {
  const [selected, setSelected] = useState(lineaActivaId ?? '')
  const [isPending, startTransition] = useTransition()

  const handleSelect = (lineaId: string) => {
    setSelected(lineaId)
    startTransition(async () => {
      const result = await updateLineaActiva(lineaId)
      if (result.success) {
        toast.success('Flujo actualizado')
      } else {
        toast.error(result.error ?? 'Error al guardar')
        setSelected(lineaActivaId ?? '')
      }
    })
  }

  if (lineas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay flujos disponibles. Contacta a MéTRIK.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Elige como organizas tu trabajo. Cada negocio nuevo usara las etapas de este flujo.
      </p>
      <div className="space-y-2">
        {lineas.map(linea => {
          const isSelected = selected === linea.id
          return (
            <button
              key={linea.id}
              type="button"
              onClick={() => handleSelect(linea.id)}
              disabled={isPending}
              className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40 hover:bg-accent/50'
              } disabled:opacity-60`}
            >
              <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
              }`}>
                {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{linea.nombre}</p>
                {linea.descripcion && (
                  <p className="text-xs text-muted-foreground mt-0.5">{linea.descripcion}</p>
                )}
              </div>
              {isPending && isSelected && (
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              )}
            </button>
          )
        })}
      </div>
      {!selected && (
        <p className="text-xs text-amber-600">
          Selecciona un flujo para poder crear negocios.
        </p>
      )}
    </div>
  )
}
