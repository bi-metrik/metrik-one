'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { ExperienciaCatalogo } from '@/lib/funciones/datos'
import { guardarExperienciaAction } from './actions'

/**
 * Alta mínima de una experiencia dentro del mismo flujo. La ficha se crea en ONE y ONE es la única fuente de verdad
 * (Mauricio, 2026-10-22): nada la pre-llena desde un PDF ni desde un mensaje pegado.
 */
export function AltaExperiencia({ onCreada }: { onCreada: (e: ExperienciaCatalogo) => void }) {
  const [pendiente, empezar] = useTransition()
  const [nombre, setNombre] = useState('')
  const [minutos, setMinutos] = useState('')
  return (
    <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm">
      <p className="font-medium">Nueva experiencia</p>
      <label className="block">
        <span className="text-xs text-[#6B7280]">Nombre</span>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-0.5 w-full rounded border border-[#E5E7EB] px-2 py-1" />
      </label>
      <label className="block">
        <span className="text-xs text-[#6B7280]">Minutos que dura un apartado sin pago (si aún no se sabe, déjalo vacío: no se podrá apartar)</span>
        <input type="number" min={1} value={minutos} onChange={(e) => setMinutos(e.target.value)} className="mt-0.5 w-32 rounded border px-2 py-1" />
      </label>
      <button
        type="button"
        disabled={pendiente || !nombre.trim()}
        onClick={() =>
          empezar(async () => {
            const m = minutos.trim() ? Number(minutos) : null
            const r = await guardarExperienciaAction({ id: null, nombre, minutos_apartado: m })
            if (!r.ok) return void toast.error(r.error)
            toast.success('Experiencia creada.')
            onCreada({ id: r.dato!, nombre: nombre.trim(), minutos_apartado: m, activa: true })
          })
        }
        className="rounded bg-[#10B981] px-3 py-1 text-white disabled:opacity-50"
      >
        Crear experiencia
      </button>
    </div>
  )
}
