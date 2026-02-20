'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { addGastoDirecto } from '../actions-v2'
import { formatCOP } from '@/lib/contacts/constants'
import { CATEGORIAS_GASTO } from '@/lib/pipeline/constants'

interface Props {
  proyectoId: string
  rubrosLista: { id: string; nombre: string; presupuestado: number | null }[]
  onClose: () => void
}

export default function GastoDialog({ proyectoId, rubrosLista, onClose }: Props) {
  const [isPending, startTransition] = useTransition()
  const [monto, setMonto] = useState('')
  const [rubroId, setRubroId] = useState(rubrosLista.length === 1 ? rubrosLista[0].id : '')
  const [categoria, setCategoria] = useState('otros')
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])

  const selectedRubro = rubrosLista.find(r => r.id === rubroId)

  const handleSubmit = () => {
    const montoNum = parseFloat(monto)
    if (!montoNum || montoNum <= 0) {
      toast.error('Ingresa un monto valido')
      return
    }
    startTransition(async () => {
      const res = await addGastoDirecto(proyectoId, {
        monto: montoNum,
        rubro_id: rubroId || undefined,
        descripcion: descripcion.trim() || undefined,
        categoria,
        fecha,
      })
      if (res.success) {
        toast.success('Gasto registrado')
        onClose()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl space-y-4">
        <h3 className="text-sm font-bold">Registrar gasto</h3>

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
        </div>

        {/* Rubro (hidden if only 1) */}
        {rubrosLista.length > 1 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Rubro</label>
            <select
              value={rubroId}
              onChange={e => setRubroId(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Sin rubro</option>
              {rubrosLista.map(r => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
            {selectedRubro && selectedRubro.presupuestado && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Presupuesto del rubro: {formatCOP(selectedRubro.presupuestado)}
              </p>
            )}
          </div>
        )}

        {/* Categoria */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Categoria</label>
          <select
            value={categoria}
            onChange={e => setCategoria(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          >
            {CATEGORIAS_GASTO.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Descripcion */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Descripcion</label>
          <input
            type="text"
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Opcional"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          />
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
