'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { addCobro } from '../../proyectos/actions-v2'
import { formatCOP } from '@/lib/contacts/constants'

interface FacturaPendiente {
  id: string
  numero_factura: string
  proyecto_nombre: string
  monto_total: number
  saldo_pendiente: number
}

interface Props {
  facturas: FacturaPendiente[]
}

export default function NuevoCobroForm({ facturas }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [facturaId, setFacturaId] = useState(facturas.length === 1 ? facturas[0].id : '')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [notas, setNotas] = useState('')

  const selected = facturas.find(f => f.id === facturaId)
  const montoNum = parseFloat(monto) || 0
  const excede = selected && montoNum > selected.saldo_pendiente + 0.01

  const handleFacturaChange = (id: string) => {
    setFacturaId(id)
    const fac = facturas.find(f => f.id === id)
    if (fac) setMonto(String(fac.saldo_pendiente))
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
        router.back()
      } else {
        toast.error(res.error)
      }
    })
  }

  // Group facturas by project
  const grouped = new Map<string, FacturaPendiente[]>()
  facturas.forEach(f => {
    const key = f.proyecto_nombre
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(f)
  })

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold">Registrar cobro</h1>
          <p className="text-xs text-muted-foreground">Registro rapido de cobro a factura</p>
        </div>
      </div>

      {facturas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground space-y-2">
          <p className="font-medium">No tienes facturas pendientes de cobro</p>
          <p className="text-xs">Crea facturas desde tus proyectos para registrar cobros</p>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border p-4">
          {/* Factura selector */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Factura *</label>
            <select
              value={facturaId}
              onChange={e => handleFacturaChange(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
            >
              <option value="">Seleccionar factura</option>
              {[...grouped.entries()].map(([proyecto, facs]) => (
                <optgroup key={proyecto} label={proyecto}>
                  {facs.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.numero_factura} — Pendiente: {formatCOP(f.saldo_pendiente)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selected && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Total factura: {formatCOP(selected.monto_total)} · Pendiente: {formatCOP(selected.saldo_pendiente)}
              </p>
            )}
          </div>

          {/* Monto */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Monto *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                type="number"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                placeholder="0"
                className="w-full rounded-md border bg-background py-2.5 pl-7 pr-3 text-sm"
              />
            </div>
            {excede && (
              <p className="mt-1 text-[10px] text-red-600">
                El cobro supera el saldo pendiente ({formatCOP(selected!.saldo_pendiente)})
              </p>
            )}
          </div>

          {/* Fecha */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Fecha</label>
            <input
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
            />
          </div>

          {/* Notas */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Notas</label>
            <input
              type="text"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Opcional"
              className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isPending || !facturaId || !monto}
            className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isPending ? 'Registrando...' : 'Registrar cobro'}
          </button>
        </div>
      )}
    </div>
  )
}
