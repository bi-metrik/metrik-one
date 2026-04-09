'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'

const CATEGORIAS = [
  { value: 'LA', label: 'LA — Lavado de Activos' },
  { value: 'FT', label: 'FT — Financiacion del Terrorismo' },
  { value: 'FPADM', label: 'FPADM — Financiacion Proliferacion ADM' },
  { value: 'PTEE', label: 'PTEE — Personas Exp. Politicamente' },
]

const FACTORES = [
  { value: 'clientes', label: 'Clientes' },
  { value: 'proveedores', label: 'Proveedores' },
  { value: 'empleados', label: 'Empleados' },
  { value: 'canales', label: 'Canales' },
  { value: 'jurisdicciones', label: 'Jurisdicciones' },
  { value: 'productos', label: 'Productos' },
  { value: 'operaciones', label: 'Operaciones' },
]

const FUENTES = [
  { value: 'cliente_nuevo', label: 'Cliente nuevo' },
  { value: 'transaccion_atipica', label: 'Transaccion atipica' },
  { value: 'lista_internacional', label: 'Lista internacional' },
  { value: 'reporte_interno', label: 'Reporte interno' },
  { value: 'auditoria', label: 'Auditoria' },
  { value: 'otro', label: 'Otro' },
]

const PROB_LABELS: Record<number, string> = {
  1: 'Raro',
  2: 'Improbable',
  3: 'Posible',
  4: 'Probable',
  5: 'Casi seguro',
}

const IMPACTO_LABELS: Record<number, string> = {
  1: 'Insignificante',
  2: 'Menor',
  3: 'Moderado',
  4: 'Mayor',
  5: 'Catastrofico',
}

function calcNivel(prob: number, imp: number): { label: string; color: string } {
  const score = prob * imp
  if (score >= 20) return { label: 'CRITICO', color: 'bg-red-100 text-red-800' }
  if (score >= 12) return { label: 'ALTO', color: 'bg-orange-100 text-orange-800' }
  if (score >= 6) return { label: 'MEDIO', color: 'bg-yellow-100 text-yellow-800' }
  return { label: 'BAJO', color: 'bg-green-100 text-green-800' }
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[#10B981] px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#059669] disabled:opacity-50"
    >
      {pending ? 'Guardando...' : 'Crear riesgo'}
    </button>
  )
}

export default function NuevoRiesgoForm({ action }: { action: (formData: FormData) => Promise<{ success: boolean; error?: string }> }) {
  const [probabilidad, setProbabilidad] = useState(3)
  const [impacto, setImpacto] = useState(3)
  const [error, setError] = useState<string | null>(null)

  const nivel = calcNivel(probabilidad, impacto)

  async function handleSubmit(formData: FormData) {
    setError(null)
    // action is a server action that redirects on success
    const result = await action(formData)
    if (result && !result.success) {
      setError(result.error ?? 'Error desconocido')
    }
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Categoria */}
      <div className="space-y-1.5">
        <label htmlFor="categoria" className="block text-sm font-medium text-[#1A1A1A]">
          Categoria <span className="text-red-500">*</span>
        </label>
        <select
          id="categoria"
          name="categoria"
          required
          className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
        >
          <option value="">Seleccionar...</option>
          {CATEGORIAS.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Descripcion */}
      <div className="space-y-1.5">
        <label htmlFor="descripcion" className="block text-sm font-medium text-[#1A1A1A]">
          Descripcion <span className="text-red-500">*</span>
        </label>
        <textarea
          id="descripcion"
          name="descripcion"
          required
          rows={3}
          placeholder="Describa el riesgo identificado..."
          className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B7280] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
        />
      </div>

      {/* Factor de riesgo */}
      <div className="space-y-1.5">
        <label htmlFor="factor_riesgo" className="block text-sm font-medium text-[#1A1A1A]">
          Factor de riesgo <span className="text-red-500">*</span>
        </label>
        <select
          id="factor_riesgo"
          name="factor_riesgo"
          required
          className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
        >
          <option value="">Seleccionar...</option>
          {FACTORES.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Probabilidad & Impacto side by side */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Probabilidad */}
        <div className="space-y-1.5">
          <label htmlFor="probabilidad" className="block text-sm font-medium text-[#1A1A1A]">
            Probabilidad <span className="text-red-500">*</span>
          </label>
          <select
            id="probabilidad"
            name="probabilidad"
            required
            value={probabilidad}
            onChange={e => setProbabilidad(parseInt(e.target.value))}
            className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
          >
            {[1, 2, 3, 4, 5].map(v => (
              <option key={v} value={v}>{v} — {PROB_LABELS[v]}</option>
            ))}
          </select>
        </div>

        {/* Impacto */}
        <div className="space-y-1.5">
          <label htmlFor="impacto" className="block text-sm font-medium text-[#1A1A1A]">
            Impacto <span className="text-red-500">*</span>
          </label>
          <select
            id="impacto"
            name="impacto"
            required
            value={impacto}
            onChange={e => setImpacto(parseInt(e.target.value))}
            className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
          >
            {[1, 2, 3, 4, 5].map(v => (
              <option key={v} value={v}>{v} — {IMPACTO_LABELS[v]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Nivel preview */}
      <div className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] bg-gray-50 px-4 py-3">
        <span className="text-sm font-medium text-[#6B7280]">Nivel calculado:</span>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${nivel.color}`}>
          {nivel.label}
        </span>
        <span className="text-xs text-[#6B7280]">(Probabilidad {probabilidad} x Impacto {impacto} = {probabilidad * impacto})</span>
      </div>

      {/* Fuente de identificacion */}
      <div className="space-y-1.5">
        <label htmlFor="fuente_identificacion" className="block text-sm font-medium text-[#1A1A1A]">
          Fuente de identificacion
        </label>
        <select
          id="fuente_identificacion"
          name="fuente_identificacion"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
        >
          <option value="">Sin especificar</option>
          {FUENTES.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Notas */}
      <div className="space-y-1.5">
        <label htmlFor="notas" className="block text-sm font-medium text-[#1A1A1A]">
          Notas
        </label>
        <textarea
          id="notas"
          name="notas"
          rows={2}
          placeholder="Observaciones adicionales (opcional)"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B7280] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)]"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t border-[#E5E7EB] pt-4">
        <a
          href="/riesgos"
          className="rounded-lg border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#6B7280] transition-colors hover:bg-gray-50"
        >
          Cancelar
        </a>
        <SubmitButton />
      </div>
    </form>
  )
}
