'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { X, Flame } from 'lucide-react'
import { actualizarSaldo } from './actions-v2'
import { formatCOP } from '@/lib/contacts/constants'

interface Props {
  onClose: () => void
}

export default function SaldoDialog({ onClose }: Props) {
  const [isPending, startTransition] = useTransition()
  const [monto, setMonto] = useState('')
  const [nota, setNota] = useState('')
  const [result, setResult] = useState<{ saldoTeorico: number; diferencia: number } | null>(null)

  const handleAmountChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '')
    if (!digits) { setMonto(''); return }
    const num = parseInt(digits, 10)
    setMonto(num.toLocaleString('es-CO'))
  }

  const montoNum = parseInt(monto.replace(/[^0-9]/g, ''), 10) || 0

  const handleSubmit = () => {
    if (montoNum <= 0) {
      toast.error('Ingresa un monto valido')
      return
    }

    startTransition(async () => {
      const res = await actualizarSaldo(montoNum, nota.trim() || undefined)
      if (res.success) {
        setResult({
          saldoTeorico: res.saldoTeorico!,
          diferencia: res.diferencia!,
        })
        toast.success('Saldo actualizado')
      } else {
        toast.error(res.error)
      }
    })
  }

  // After success — show comparison
  if (result) {
    const absDiff = Math.abs(result.diferencia)
    const tolerance = Math.max(50000, montoNum * 0.02)
    const cuadra = absDiff <= tolerance

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">Saldo actualizado</h3>
            <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Tu saldo</span>
              <span className="font-medium">{formatCOP(montoNum)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Mi calculo</span>
              <span className="font-medium">{formatCOP(result.saldoTeorico)}</span>
            </div>
            <div className="border-t pt-2">
              {cuadra ? (
                <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                  <span>✅</span>
                  <span>Cuadra perfecto</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Diferencia</span>
                    <span className={`font-medium ${result.diferencia >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {result.diferencia >= 0 ? '+' : ''}{formatCOP(result.diferencia)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {result.diferencia < 0
                      ? 'Hubo un gasto que no registraste?'
                      : 'Hubo un ingreso que no registraste?'
                    }
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-1 text-xs text-orange-600 dark:text-orange-400">
            <Flame className="h-3.5 w-3.5" />
            <span>Racha actualizada</span>
          </div>

          <button
            onClick={onClose}
            className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Listo
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Actualizar saldo bancario</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <p className="text-xs text-muted-foreground">
          Revisa tu app del banco y escribe tu saldo actual. Esto mantiene tus numeros precisos.
        </p>

        {/* Monto */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Saldo actual *</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={monto}
              onChange={e => handleAmountChange(e.target.value)}
              placeholder="0"
              className="w-full rounded-md border pl-7 pr-3 py-2 text-sm"
              autoFocus
            />
          </div>
        </div>

        {/* Nota */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Nota (opcional)</label>
          <input
            type="text"
            value={nota}
            onChange={e => setNota(e.target.value)}
            placeholder="Ej: Revise Bancolombia"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || montoNum <= 0}
            className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? 'Guardando...' : 'Actualizar'}
          </button>
        </div>
      </div>
    </div>
  )
}
