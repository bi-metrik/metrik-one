'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RotateCcw, PlusCircle } from 'lucide-react'
import {
  reabrirNegocio,
  crearNegocioDesdeCerrado,
} from '@/lib/actions/reapertura'

interface ReabrirNegocioModalProps {
  negocioId: string
  cierreMotivo: 'perdido' | 'cancelado' | 'exitoso'
  closedAt: string | null
  onClose: () => void
}

function diasDesde(iso: string | null): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

export default function ReabrirNegocioModal({
  negocioId,
  cierreMotivo,
  closedAt,
  onClose,
}: ReabrirNegocioModalProps) {
  const router = useRouter()
  const [choice, setChoice] = useState<'mismas' | 'cambiaron' | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    if (!choice) return
    startTransition(async () => {
      if (choice === 'mismas') {
        const res = await reabrirNegocio(negocioId)
        if (res.ok) {
          toast.success(`Negocio reabierto en etapa ${res.etapaNombre ?? ''}`)
          onClose()
          router.refresh()
        } else {
          toast.error(res.error ?? 'Error al reabrir')
        }
      } else {
        const res = await crearNegocioDesdeCerrado(negocioId)
        if (res.ok && res.nuevoNegocioId) {
          toast.success('Negocio nuevo creado con datos pre-llenados')
          onClose()
          router.push(`/negocios/${res.nuevoNegocioId}?prefilled=true`)
        } else {
          toast.error(res.error ?? 'Error al crear nuevo')
        }
      }
    })
  }

  const dias = diasDesde(closedAt)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="text-base font-semibold text-[#1A1A1A]">Reabrir negocio</h3>
        <p className="mt-1 text-xs text-[#6B7280]">
          Este negocio se cerro como {cierreMotivo}{' '}
          {dias > 0 ? `hace ${dias} dia${dias !== 1 ? 's' : ''}` : 'hoy'}.
        </p>
        <p className="mt-3 text-sm font-medium text-[#1A1A1A]">
          Las condiciones del cierre se mantienen?
        </p>

        <div className="mt-3 space-y-2">
          <RadioCard
            checked={choice === 'mismas'}
            onSelect={() => setChoice('mismas')}
            icon={RotateCcw}
            title="Si, las mismas condiciones"
            description="Vuelve al stage y etapa donde estaba antes del cierre. Conserva precio, cronograma y responsables actuales."
          />
          <RadioCard
            checked={choice === 'cambiaron'}
            onSelect={() => setChoice('cambiaron')}
            icon={PlusCircle}
            title="No, cambiaron"
            description="Recomendamos crear un negocio nuevo con los datos pre-llenados de este. El cerrado queda como historico."
          />
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-md border border-[#E5E7EB] py-2 text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4F2] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!choice || isPending}
            className="flex-1 rounded-md bg-[#10B981] py-2 text-sm font-medium text-white hover:bg-[#059669] disabled:opacity-50"
          >
            {isPending ? 'Procesando...' : 'Continuar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RadioCard({
  checked,
  onSelect,
  icon: Icon,
  title,
  description,
}: {
  checked: boolean
  onSelect: () => void
  icon: typeof RotateCcw
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        checked
          ? 'border-[#10B981] bg-[#10B981]/5'
          : 'border-[#E5E7EB] hover:bg-[#F5F4F2]'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          checked ? 'border-[#10B981]' : 'border-[#6B7280]/40'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#10B981]" />}
      </span>
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          checked ? 'text-[#10B981]' : 'text-[#6B7280]'
        }`}
      />
      <span className="flex-1">
        <span className="block text-sm font-medium text-[#1A1A1A]">{title}</span>
        <span className="mt-0.5 block text-xs text-[#6B7280]">{description}</span>
      </span>
    </button>
  )
}
