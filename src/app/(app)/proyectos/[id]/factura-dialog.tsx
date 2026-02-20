'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { addFactura } from '../actions-v2'
import { formatCOP } from '@/lib/contacts/constants'

interface Props {
  proyectoId: string
  presupuesto: number
  facturado: number
  onClose: () => void
}

export default function FacturaDialog({ proyectoId, presupuesto, facturado, onClose }: Props) {
  const [isPending, startTransition] = useTransition()
  const [monto, setMonto] = useState('')
  const [fechaEmision, setFechaEmision] = useState(new Date().toISOString().split('T')[0])
  const [numeroFactura, setNumeroFactura] = useState('')
  const [notas, setNotas] = useState('')

  const porFacturar = presupuesto - facturado
  const montoNum = parseFloat(monto) || 0
  const excede = montoNum > porFacturar && porFacturar > 0

  const handleSubmit = () => {
    if (!montoNum || montoNum <= 0) {
      toast.error('Ingresa un monto valido')
      return
    }
    startTransition(async () => {
      const res = await addFactura(proyectoId, {
        monto: montoNum,
        fecha_emision: fechaEmision,
        numero_factura: numeroFactura.trim() || undefined,
        notas: notas.trim() || undefined,
      })
      if (res.success) {
        toast.success('Factura registrada')
        onClose()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl space-y-4">
        <h3 className="text-sm font-bold">Registrar factura</h3>

        {/* Context bar */}
        <div className="flex gap-2 text-[10px]">
          <div className="flex-1 rounded-md bg-muted p-2 text-center">
            <p className="text-muted-foreground">Presupuesto</p>
            <p className="font-semibold">{formatCOP(presupuesto)}</p>
          </div>
          <div className="flex-1 rounded-md bg-muted p-2 text-center">
            <p className="text-muted-foreground">Facturado</p>
            <p className="font-semibold">{formatCOP(facturado)}</p>
          </div>
          <div className="flex-1 rounded-md bg-muted p-2 text-center">
            <p className="text-muted-foreground">Disponible</p>
            <p className="font-semibold">{formatCOP(Math.max(porFacturar, 0))}</p>
          </div>
        </div>

        {/* Monto */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Monto *</label>
          <input
            type="number"
            value={monto}
            onChange={e => setMonto(e.target.value)}
            placeholder="0"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            autoFocus
          />
          {excede && (
            <p className="mt-1 text-[10px] text-yellow-600">
              El monto supera lo disponible por facturar ({formatCOP(porFacturar)})
            </p>
          )}
        </div>

        {/* Fecha emision */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Fecha emision</label>
          <input
            type="date"
            value={fechaEmision}
            onChange={e => setFechaEmision(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        {/* Numero factura */}
        <div>
          <label className="text-xs font-medium text-muted-foreground"># Factura (opcional)</label>
          <input
            type="text"
            value={numeroFactura}
            onChange={e => setNumeroFactura(e.target.value)}
            placeholder="FV-001"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        {/* Notas */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Notas</label>
          <input
            type="text"
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Opcional"
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
            disabled={isPending || !monto}
            className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
