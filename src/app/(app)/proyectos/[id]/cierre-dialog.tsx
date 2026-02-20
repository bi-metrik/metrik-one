'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cambiarEstadoProyecto } from '../actions-v2'
import { formatCOP } from '@/lib/contacts/constants'

interface Financiero {
  presupuesto_total: number | null
  costo_acumulado: number | null
  horas_estimadas: number | null
  horas_reales: number | null
  facturado: number | null
  cobrado: number | null
  cartera: number | null
  ganancia_estimada: number | null
  ganancia_real: number | null
}

interface Props {
  proyectoId: string
  financiero: Financiero
  onClose: () => void
}

export default function CierreDialog({ proyectoId, financiero: f, onClose }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [lecciones, setLecciones] = useState('')

  const handleConfirm = () => {
    startTransition(async () => {
      const res = await cambiarEstadoProyecto(proyectoId, 'cerrado', lecciones.trim() || undefined)
      if (res.success) {
        toast.success('Proyecto cerrado exitosamente')
        onClose()
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-background p-5 shadow-xl space-y-4">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map(s => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${
                s <= step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Confirmation */}
        {step === 1 && (
          <>
            <h3 className="text-sm font-bold">Cerrar proyecto</h3>
            <p className="text-xs text-muted-foreground">
              Al cerrar el proyecto se genera un snapshot financiero comparativo.
              No podras registrar mas horas, gastos ni facturas. Los cobros pendientes aun se podran registrar.
            </p>
            {(f.cartera ?? 0) > 0 && (
              <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-700 dark:border-yellow-900 dark:bg-yellow-950/20">
                Tienes {formatCOP(f.cartera ?? 0)} en cartera pendiente. Aun podras registrar cobros despues del cierre.
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-accent">
                Cancelar
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Continuar
              </button>
            </div>
          </>
        )}

        {/* Step 2: Lecciones aprendidas */}
        {step === 2 && (
          <>
            <h3 className="text-sm font-bold">Que aprendiste?</h3>
            <p className="text-xs text-muted-foreground">
              Opcional pero util. Estas notas te ayudaran en futuros proyectos similares.
            </p>
            <textarea
              value={lecciones}
              onChange={e => setLecciones(e.target.value)}
              placeholder="Que salio bien? Que harias diferente? Algo que quieras recordar..."
              rows={4}
              className="w-full rounded-md border px-3 py-2 text-sm resize-none"
              autoFocus
            />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setStep(1)} className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-accent">
                Atras
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Ver resumen
              </button>
            </div>
          </>
        )}

        {/* Step 3: Comparative snapshot */}
        {step === 3 && (
          <>
            <h3 className="text-sm font-bold">Resumen final del proyecto</h3>
            <div className="space-y-1.5">
              <CompareRow label="Presupuesto" value={formatCOP(f.presupuesto_total ?? 0)} />
              <CompareRow label="Costo acumulado" value={formatCOP(f.costo_acumulado ?? 0)} />
              <CompareRow
                label="Horas"
                value={`${f.horas_reales ?? 0}h${f.horas_estimadas ? ` / ${f.horas_estimadas}h est.` : ''}`}
              />
              <CompareRow label="Facturado" value={formatCOP(f.facturado ?? 0)} />
              <CompareRow label="Cobrado" value={formatCOP(f.cobrado ?? 0)} />
              <CompareRow label="Cartera pendiente" value={formatCOP(f.cartera ?? 0)} />
              <div className="border-t pt-1.5 mt-1.5">
                <CompareRow
                  label="Ganancia real"
                  value={`${(f.ganancia_real ?? 0) >= 0 ? '+' : ''}${formatCOP(f.ganancia_real ?? 0)}`}
                  highlight={f.ganancia_real ?? 0}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setStep(2)} className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-accent">
                Atras
              </button>
              <button
                onClick={handleConfirm}
                disabled={isPending}
                className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isPending ? 'Cerrando...' : 'Confirmar cierre'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CompareRow({ label, value, highlight }: { label: string; value: string; highlight?: number }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${
        highlight !== undefined
          ? highlight >= 0 ? 'text-green-600' : 'text-red-600'
          : ''
      }`}>
        {value}
      </span>
    </div>
  )
}
