'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Loader2, Check, X } from 'lucide-react'
import { crearControl } from '@/lib/actions/riesgos'

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

const CATEGORIA_COLORS: Record<string, string> = {
  LA: 'bg-blue-100 text-blue-800',
  FT: 'bg-purple-100 text-purple-800',
  FPADM: 'bg-amber-100 text-amber-800',
  PTEE: 'bg-red-100 text-red-800',
}

const CATEGORIAS_ORDER = ['LA', 'FT', 'FPADM', 'PTEE']

interface CausaSelector {
  id: string
  referencia: string | null
  descripcion: string | null
  riesgo_codigo: string | null
  riesgo_categoria: string | null
}

interface EquipoMember {
  id: string
  full_name: string
  role: string | null
}

interface Props {
  causas: CausaSelector[]
  equipo: EquipoMember[]
}

export default function NuevoControlForm({ causas, equipo }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [referencia, setReferencia] = useState('')
  const [tipoControl, setTipoControl] = useState('preventivo')
  const [nombreControl, setNombreControl] = useState('')
  const [actividadControl, setActividadControl] = useState('')
  const [clasificacion, setClasificacion] = useState('manual')
  const [periodicidad, setPeriodicidad] = useState('')
  const [responsableId, setResponsableId] = useState('')
  const [selectedCausas, setSelectedCausas] = useState<Set<string>>(new Set())

  // Effectiveness factors
  const [efValues, setEfValues] = useState<Record<string, number>>({
    ef_certeza: 1,
    ef_cambios_personal: 1,
    ef_multiples_localidades: 1,
    ef_juicios_significativos: 1,
    ef_actividades_complejas: 1,
    ef_depende_otros: 1,
    ef_sujeto_actualizaciones: 1,
  })

  function toggleEf(field: string) {
    setEfValues(prev => ({
      ...prev,
      [field]: prev[field] === 3 ? 1 : 3,
    }))
  }

  function toggleCausa(causaId: string) {
    setSelectedCausas(prev => {
      const next = new Set(prev)
      if (next.has(causaId)) next.delete(causaId)
      else next.add(causaId)
      return next
    })
  }

  const efectividad = Math.round((EF_FIELDS.reduce((acc, f) => acc + efValues[f], 0) / 21) * 100)

  // Group causas by riesgo_categoria
  const causasByCategoria: Record<string, CausaSelector[]> = {}
  for (const c of causas) {
    const cat = c.riesgo_categoria ?? 'Sin categoria'
    if (!causasByCategoria[cat]) causasByCategoria[cat] = []
    causasByCategoria[cat].push(c)
  }

  async function handleSubmit() {
    if (!nombreControl.trim()) {
      setError('El nombre del control es requerido')
      return
    }
    if (selectedCausas.size === 0) {
      setError('Selecciona al menos una causa de riesgo')
      return
    }

    setSaving(true)
    setError(null)

    const result = await crearControl({
      referencia: referencia || null,
      nombre_control: nombreControl,
      tipo_control: tipoControl,
      actividad_control: actividadControl || null,
      clasificacion: clasificacion || undefined,
      periodicidad: periodicidad || undefined,
      responsable_id: responsableId || undefined,
      causa_ids: Array.from(selectedCausas),
      ef_certeza: efValues.ef_certeza,
      ef_cambios_personal: efValues.ef_cambios_personal,
      ef_multiples_localidades: efValues.ef_multiples_localidades,
      ef_juicios_significativos: efValues.ef_juicios_significativos,
      ef_actividades_complejas: efValues.ef_actividades_complejas,
      ef_depende_otros: efValues.ef_depende_otros,
      ef_sujeto_actualizaciones: efValues.ef_sujeto_actualizaciones,
    })

    setSaving(false)

    if (result.success && result.controlId) {
      router.push(`/controles/${result.controlId}`)
    } else {
      setError(result.error ?? 'Error al crear el control')
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/controles"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#E5E7EB] transition-colors hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4 text-[#6B7280]" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">Nuevo control</h1>
            <p className="text-sm text-[#6B7280]">Registrar un nuevo control de riesgo</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/controles"
            className="rounded-md px-3 py-1.5 text-xs font-medium text-[#6B7280] hover:bg-gray-100 transition-colors"
          >
            Cancelar
          </Link>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#10B981] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {saving ? 'Creando...' : 'Crear control'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Section 1: Informacion del control */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Informacion del control</h2>

        {/* Row 1: Referencia + Tipo */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Referencia</label>
            <input
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
              type="text"
              placeholder="Ej: CAM-LAFT-01"
              className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm font-mono focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] mb-1">
              Tipo de control <span className="text-red-500">*</span>
            </label>
            <select
              value={tipoControl}
              onChange={e => setTipoControl(e.target.value)}
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
          <label className="block text-[10px] font-medium text-[#6B7280] mb-1">
            Nombre del control <span className="text-red-500">*</span>
          </label>
          <input
            value={nombreControl}
            onChange={e => setNombreControl(e.target.value)}
            type="text"
            placeholder="Nombre descriptivo del control"
            className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
          />
        </div>

        {/* Actividad de control */}
        <div>
          <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Actividad de control</label>
          <textarea
            value={actividadControl}
            onChange={e => setActividadControl(e.target.value)}
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
              value={clasificacion}
              onChange={e => setClasificacion(e.target.value)}
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
              value={periodicidad}
              onChange={e => setPeriodicidad(e.target.value)}
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

        {/* Responsable */}
        <div>
          <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Responsable</label>
          <select
            value={responsableId}
            onChange={e => setResponsableId(e.target.value)}
            className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
          >
            <option value="">Sin asignar</option>
            {equipo.map(m => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Section 2: Causas de riesgo impactadas */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[#1A1A1A]">
            Causas que impacta este control <span className="text-red-500">*</span>
          </h2>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Selecciona las causas de riesgo que este control mitiga</p>
        </div>

        {causas.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#E5E7EB] bg-gray-50 p-4 text-center">
            <p className="text-xs text-[#6B7280]">No hay causas de riesgo registradas. Crea una causa primero.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {CATEGORIAS_ORDER.filter(cat => causasByCategoria[cat]?.length).map(cat => (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[cat] ?? 'bg-gray-100 text-gray-800'}`}>
                    {cat}
                  </span>
                  <span className="text-[10px] text-[#6B7280]">{causasByCategoria[cat].length} causa{causasByCategoria[cat].length !== 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-1">
                  {causasByCategoria[cat].map(c => (
                    <label
                      key={c.id}
                      className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                        selectedCausas.has(c.id)
                          ? 'border-[#10B981] bg-green-50/50'
                          : 'border-[#E5E7EB] hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCausas.has(c.id)}
                        onChange={() => toggleCausa(c.id)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-[#E5E7EB] text-[#10B981] focus:ring-[#10B981]"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-xs">
                          <span className="font-mono font-medium text-[#10B981]">{c.referencia ?? '?'}</span>
                          {' '}
                          <span className="text-[#6B7280]">({c.riesgo_codigo} {c.riesgo_categoria})</span>
                          {' \u2014 '}
                          <span className="text-[#1A1A1A]">{(c.descripcion ?? '').length > 80 ? (c.descripcion ?? '').slice(0, 80) + '...' : (c.descripcion ?? '')}</span>
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {/* Causas sin categoria conocida */}
            {Object.entries(causasByCategoria)
              .filter(([cat]) => !CATEGORIAS_ORDER.includes(cat))
              .map(([cat, items]) => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-800">
                      {cat}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {items.map(c => (
                      <label
                        key={c.id}
                        className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                          selectedCausas.has(c.id)
                            ? 'border-[#10B981] bg-green-50/50'
                            : 'border-[#E5E7EB] hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCausas.has(c.id)}
                          onChange={() => toggleCausa(c.id)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-[#E5E7EB] text-[#10B981] focus:ring-[#10B981]"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-xs">
                            <span className="font-mono font-medium text-[#10B981]">{c.referencia ?? '?'}</span>
                            {' \u2014 '}
                            <span className="text-[#1A1A1A]">{(c.descripcion ?? '').length > 80 ? (c.descripcion ?? '').slice(0, 80) + '...' : (c.descripcion ?? '')}</span>
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        <p className="text-[10px] text-[#6B7280]">
          {selectedCausas.size} causa{selectedCausas.size !== 1 ? 's' : ''} seleccionada{selectedCausas.size !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Section 3: Factores de efectividad */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Factores de efectividad</h2>

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

        <div className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] bg-gray-50 px-4 py-3">
          <span className="text-sm font-medium text-[#6B7280]">Efectividad:</span>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
            efectividad >= 80 ? 'bg-green-100 text-green-800' :
            efectividad >= 60 ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }`}>
            {efectividad}%
          </span>
          <p className="text-[10px] text-[#6B7280]">Click para alternar Si (3) / No (1)</p>
        </div>
      </div>
    </div>
  )
}
