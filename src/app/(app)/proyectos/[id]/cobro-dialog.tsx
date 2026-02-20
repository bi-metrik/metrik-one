'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { addCobro } from '../actions-v2'
import { formatCOP } from '@/lib/contacts/constants'

interface Factura {
  factura_id: string | null
  numero_factura: string | null
  monto: number | null
  saldo_pendiente: number | null
  estado_pago: string | null
}

interface Props {
  facturas: Factura[]
  onClose: () => void
}

export default function CobroDialog({ facturas, onClose }: Props) {
  const [isPending, startTransition] = useTransition()
  const [facturaId, setFacturaId] = useState(facturas.length === 1 ? (facturas[0].factura_id ?? '') : '')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [notas, setNotas] = useState('')

  const selectedFactura = facturas.find(f => f.factura_id === facturaId)
  const saldo = selectedFactura?.saldo_pendiente ?? 0
  const montoNum = parseFloat(monto) || 0
  const excede = montoNum > Number(saldo) + 0.01

  // Pre-fill monto when selecting a factura
  const handleFacturaChange = (id: string) => {
    setFacturaId(id)
    const fac = facturas.find(f => f.factura_id === id)
    if (fac?.saldo_pendiente) {
      setMonto(String(fac.saldo_pendiente))
    }
  }

  const handleSubmit = () => {
    if (!facturaId) {
      toast.error('Selecciona una factura')
      return
    }
    if (!montoNum || montoNum <= 0) {
      toast.error('Ingresa un monto valido')
      return
    }
    startTransition(async () => {
      const res = await addCobro(facturaId, {
        monto: montoNum,
        fecha,
        notas: notas.trim() || undefined,
      })
      if (res.success) {
        toast.success('Cobro registrado')
        onClose()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl space-y-4">
        <h3 className="text-sm font-bold">Registrar cobro</h3>

        {/* Factura select */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Factura *</label>
          <select
            value={facturaId}
            onChange={e => handleFacturaChange(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Seleccionar factura</option>
            {facturas.map(f => (
              <option key={f.factura_id} value={f.factura_id ?? ''}>
                {f.numero_factura || 'Sin numero'} — Saldo: {formatCOP(Number(f.saldo_pendiente ?? 0))}
              </option>
            ))}
          </select>
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
          />
          {excede && (
            <p className="mt-1 text-[10px] text-red-600">
              El cobro supera el saldo pendiente ({formatCOP(Number(saldo))})
            </p>
          )}
        </div>

        {/* Fecha */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Fecha</label>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
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
            disabled={isPending || !facturaId || !monto}
            className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Registrar cobro
          </button>
        </div>
      </div>
    </div>
  )
}
