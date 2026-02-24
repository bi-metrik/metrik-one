'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { addHoras } from '../actions-v2'

interface StaffOption {
  id: string
  full_name: string
  tipo_vinculo: string | null
  es_principal: boolean | null
}

interface Props {
  proyectoId: string
  staffList?: StaffOption[]
  onClose: () => void
}

const VINCULO_LABEL: Record<string, string> = {
  empleado: 'Empleado',
  contratista: 'Contratista',
  freelance: 'Freelance',
}

export default function HorasDialog({ proyectoId, staffList = [], onClose }: Props) {
  const [isPending, startTransition] = useTransition()
  const [horas, setHoras] = useState('1')
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [staffId, setStaffId] = useState(
    staffList.find(s => s.es_principal)?.id ?? staffList[0]?.id ?? ''
  )

  const handleSubmit = () => {
    const horasNum = parseFloat(horas)
    if (!horasNum || horasNum <= 0) {
      toast.error('Ingresa horas validas')
      return
    }
    startTransition(async () => {
      const res = await addHoras(proyectoId, {
        fecha,
        horas: horasNum,
        descripcion: descripcion.trim() || undefined,
        staff_id: staffId || undefined,
      })
      if (res.success) {
        toast.success(`${horasNum}h registradas`)
        onClose()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl space-y-4">
        <h3 className="text-sm font-bold">Registrar horas</h3>

        {/* Staff selector */}
        {staffList.length > 1 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Persona *</label>
            <select
              value={staffId}
              onChange={e => setStaffId(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            >
              {staffList.map(s => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                  {s.tipo_vinculo ? ` (${VINCULO_LABEL[s.tipo_vinculo] ?? s.tipo_vinculo})` : ''}
                  {s.es_principal ? ' ★' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Single staff indicator */}
        {staffList.length === 1 && (
          <p className="text-xs text-muted-foreground">
            Persona: <span className="font-medium text-foreground">{staffList[0].full_name}</span>
          </p>
        )}

        {/* Horas */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Horas *</label>
          <input
            type="number"
            value={horas}
            onChange={e => setHoras(e.target.value)}
            step="0.5"
            min="0.5"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            autoFocus
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

        {/* Descripcion */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Descripcion</label>
          <input
            type="text"
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Que hiciste?"
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
            disabled={isPending || !horas}
            className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
