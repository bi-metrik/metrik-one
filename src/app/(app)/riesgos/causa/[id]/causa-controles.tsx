'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Plus, Check, X, Loader2 } from 'lucide-react'
import { crearControlCausa } from '@/lib/actions/riesgos'

const EF_FACTOR_LABELS: Record<string, string> = {
  ef_certeza: 'Certeza',
  ef_cambios_personal: 'Cambios personal',
  ef_multiples_localidades: 'Localidades',
  ef_juicios_significativos: 'Juicios',
  ef_actividades_complejas: 'Complejidad',
  ef_depende_otros: 'Dependencia',
  ef_sujeto_actualizaciones: 'Actualizaciones',
}

const EF_FIELDS = [
  'ef_certeza', 'ef_cambios_personal', 'ef_multiples_localidades',
  'ef_juicios_significativos', 'ef_actividades_complejas',
  'ef_depende_otros', 'ef_sujeto_actualizaciones',
]

interface Props {
  causaId: string
  riesgoId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controles: any[]
  canEdit: boolean
}

export default function CausaControles({ causaId, riesgoId, controles, canEdit }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [efValues, setEfValues] = useState<Record<string, number>>({
    ef_certeza: 1,
    ef_cambios_personal: 1,
    ef_multiples_localidades: 1,
    ef_juicios_significativos: 1,
    ef_actividades_complejas: 1,
    ef_depende_otros: 1,
    ef_sujeto_actualizaciones: 1,
  })

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const form = e.currentTarget
    const formData = new FormData(form)
    formData.set('causa_id', causaId)
    formData.set('riesgo_id', riesgoId)

    // Add effectiveness factors
    for (const f of EF_FIELDS) {
      formData.set(f, String(efValues[f]))
    }

    const result = await crearControlCausa(formData)
    setSaving(false)

    if (result.success) {
      setShowForm(false)
      setEfValues({
        ef_certeza: 1,
        ef_cambios_personal: 1,
        ef_multiples_localidades: 1,
        ef_juicios_significativos: 1,
        ef_actividades_complejas: 1,
        ef_depende_otros: 1,
        ef_sujeto_actualizaciones: 1,
      })
      router.refresh()
    } else {
      setError(result.error ?? 'Error al crear el control')
    }
  }

  function toggleEf(field: string) {
    setEfValues(prev => ({
      ...prev,
      [field]: prev[field] === 3 ? 1 : 3,
    }))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#10B981]" />
          <h2 className="text-base font-semibold text-[#1A1A1A]">
            Controles asignados
            <span className="ml-2 text-sm font-normal text-[#6B7280]">({controles.length})</span>
          </h2>
        </div>
        {canEdit && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#059669]"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar control
          </button>
        )}
      </div>

      {/* Existing controls */}
      {controles.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-gray-50 p-6 text-center">
          <p className="text-xs text-[#6B7280]">Sin controles asignados a esta causa.</p>
          {canEdit && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-2 text-xs font-medium text-[#10B981] hover:underline"
            >
              Agregar el primer control
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {controles.map((ctrl: any) => {
            const efectividad = ctrl.ponderacion_efectividad != null ? Math.round(ctrl.ponderacion_efectividad * 100) : null
            return (
              <div key={ctrl.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#10B981]">{ctrl.referencia ?? '\u2014'}</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        ctrl.tipo_control === 'preventivo' ? 'bg-blue-100 text-blue-800' :
                        ctrl.tipo_control === 'detectivo' ? 'bg-purple-100 text-purple-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {ctrl.tipo_control}
                      </span>
                      {ctrl.clasificacion && (
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[#6B7280] capitalize">
                          {ctrl.clasificacion}
                        </span>
                      )}
                      {ctrl.periodicidad && (
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[#6B7280] capitalize">
                          {ctrl.periodicidad}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-[#1A1A1A]">{ctrl.nombre_control}</p>
                    {ctrl.actividad_control && (
                      <p className="text-xs text-[#6B7280] leading-relaxed">{ctrl.actividad_control}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {efectividad != null && (
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                        efectividad >= 80 ? 'bg-green-100 text-green-800' :
                        efectividad >= 60 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {efectividad}%
                      </span>
                    )}
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                      ctrl.estado === 'IMPLEMENTADO' ? 'bg-green-100 text-green-800' :
                      ctrl.estado === 'EN_PROGRESO' ? 'bg-yellow-100 text-yellow-800' :
                      ctrl.estado === 'SUSPENDIDO' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {ctrl.estado}
                    </span>
                  </div>
                </div>

                {/* 7 effectiveness factors */}
                {EF_FIELDS.some(f => ctrl[f] != null) && (
                  <div className="border-t border-[#E5E7EB] pt-2">
                    <span className="text-[10px] font-medium text-[#6B7280] block mb-1.5">Factores de efectividad</span>
                    <div className="flex flex-wrap gap-1.5">
                      {EF_FIELDS.map(f => {
                        const val = ctrl[f]
                        if (val == null) return null
                        const isGood = val === 3
                        return (
                          <span
                            key={f}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium ${
                              isGood ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {isGood ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                            {EF_FACTOR_LABELS[f]}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add control form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border-2 border-[#10B981]/30 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1A1A1A]">Nuevo control</h3>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null) }}
              className="text-xs text-[#6B7280] hover:text-[#1A1A1A]"
            >
              Cancelar
            </button>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Row 1: Referencia + Tipo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Referencia</label>
              <input
                name="referencia"
                type="text"
                placeholder="Ej: CAM-LAFT-01"
                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Tipo de control *</label>
              <select
                name="tipo_control"
                required
                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
              >
                <option value="preventivo">Preventivo</option>
                <option value="detectivo">Detectivo</option>
                <option value="correctivo">Correctivo</option>
              </select>
            </div>
          </div>

          {/* Nombre del control */}
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Nombre del control *</label>
            <input
              name="nombre_control"
              type="text"
              required
              placeholder="Nombre descriptivo del control"
              className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
            />
          </div>

          {/* Actividad */}
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Actividad de control</label>
            <textarea
              name="actividad_control"
              rows={2}
              placeholder="Descripcion de la actividad de control"
              className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981] resize-none"
            />
          </div>

          {/* Row 2: Clasificacion + Periodicidad */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Clasificacion</label>
              <select
                name="clasificacion"
                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
              >
                <option value="manual">Manual</option>
                <option value="automatico">Automatico</option>
                <option value="hibrido">Hibrido</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Periodicidad</label>
              <select
                name="periodicidad"
                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
              >
                <option value="">-- Sin definir --</option>
                <option value="continuo">Continuo</option>
                <option value="diaria">Diaria</option>
                <option value="semanal">Semanal</option>
                <option value="mensual">Mensual</option>
                <option value="trimestral">Trimestral</option>
                <option value="semestral">Semestral</option>
                <option value="anual">Anual</option>
                <option value="evento">Por evento</option>
              </select>
            </div>
          </div>

          {/* 7 Effectiveness factors as toggles */}
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] mb-2">Factores de efectividad</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {EF_FIELDS.map(f => {
                const isGood = efValues[f] === 3
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleEf(f)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                      isGood
                        ? 'bg-green-50 text-green-700 border border-green-300'
                        : 'bg-red-50 text-red-700 border border-red-300'
                    }`}
                  >
                    {isGood ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {EF_FACTOR_LABELS[f]}
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-[#6B7280] mt-1">
              Click para alternar Si/No. Efectividad: {Math.round((EF_FIELDS.reduce((acc, f) => acc + efValues[f], 0) / 21) * 100)}%
            </p>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E7EB]">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null) }}
              className="rounded-md px-4 py-2 text-xs font-medium text-[#6B7280] hover:bg-gray-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#10B981] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {saving ? 'Guardando...' : 'Crear control'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
