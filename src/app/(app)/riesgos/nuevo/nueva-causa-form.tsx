'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ShieldAlert, Plus, Loader2 } from 'lucide-react'
import { crearCausa } from '@/lib/actions/riesgos'

const CATEGORIA_COLORS: Record<string, string> = {
  LA: 'bg-blue-100 text-blue-800',
  FT: 'bg-purple-100 text-purple-800',
  FPADM: 'bg-amber-100 text-amber-800',
  PTEE: 'bg-red-100 text-red-800',
}

const PROB_LABELS: Record<number, string> = {
  1: 'Raro',
  2: 'Improbable',
  3: 'Posible',
  4: 'Probable',
  5: 'Casi seguro',
}

const IMPACTO_NIVEL: Record<number, { label: string; color: string }> = {
  1: { label: 'Insignificante', color: 'bg-green-100 text-green-800' },
  2: { label: 'Menor', color: 'bg-yellow-100 text-yellow-800' },
  3: { label: 'Moderado', color: 'bg-orange-100 text-orange-800' },
  4: { label: 'Mayor', color: 'bg-red-100 text-red-700' },
  5: { label: 'Catastrofico', color: 'bg-red-200 text-red-900' },
}

const FACTORES = ['clientes', 'proveedores', 'empleados', 'canales', 'jurisdicciones', 'productos', 'operaciones']

function getImpactoBadgeColor(value: number): string {
  if (value <= 1.5) return 'bg-green-100 text-green-800'
  if (value <= 2.5) return 'bg-yellow-100 text-yellow-800'
  if (value <= 3.5) return 'bg-orange-100 text-orange-800'
  return 'bg-red-100 text-red-800'
}

interface Props {
  riesgos: { id: string; codigo: string; categoria: string; descripcion: string }[]
}

export default function NuevaCausaForm({ riesgos }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [riesgoId, setRiesgoId] = useState('')
  const [referencia, setReferencia] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [contexto, setContexto] = useState('')
  const [factorRiesgo, setFactorRiesgo] = useState('')
  const [impLegal, setImpLegal] = useState(1)
  const [impReputacional, setImpReputacional] = useState(1)
  const [impOperativo, setImpOperativo] = useState(1)
  const [impContagio, setImpContagio] = useState(1)
  const [probOcurrencia, setProbOcurrencia] = useState(1)
  const [probFrecuencia, setProbFrecuencia] = useState(1)

  const impPonderado = impLegal * 0.3 + impReputacional * 0.4 + impOperativo * 0.2 + impContagio * 0.1
  const probResultante = Math.max(probOcurrencia, probFrecuencia)
  const selectedRiesgo = riesgos.find(r => r.id === riesgoId)

  async function handleSubmit() {
    if (!riesgoId) {
      setError('Selecciona un evento de riesgo')
      return
    }
    if (!descripcion.trim()) {
      setError('La descripcion es requerida')
      return
    }

    setSaving(true)
    setError(null)

    const result = await crearCausa({
      riesgo_id: riesgoId,
      referencia: referencia || null,
      descripcion,
      contexto: contexto || null,
      factor_riesgo: factorRiesgo || null,
      impacto_legal: impLegal,
      impacto_reputacional: impReputacional,
      impacto_operativo: impOperativo,
      impacto_contagio: impContagio,
      probabilidad_ocurrencia: probOcurrencia,
      probabilidad_frecuencia: probFrecuencia,
    })

    setSaving(false)

    if (result.success && result.causaId) {
      router.push(`/riesgos/causa/${result.causaId}`)
    } else {
      setError(result.error ?? 'Error al crear la causa')
    }
  }

  function ScoreSelect({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
    return (
      <select
        value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        className="rounded-md border border-[#E5E7EB] px-2 py-1 text-xs font-bold focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
        aria-label={label}
      >
        {[1, 2, 3, 4, 5].map(v => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/riesgos"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#E5E7EB] transition-colors hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4 text-[#6B7280]" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">Nueva causa</h1>
            <p className="text-sm text-[#6B7280]">Registrar una nueva causa de riesgo</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/riesgos"
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
            {saving ? 'Creando...' : 'Crear causa'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Parent riesgo selector */}
      <div className="rounded-lg border border-[#E5E7EB] bg-gray-50 p-4 space-y-3">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
          Evento de riesgo <span className="text-red-500">*</span>
        </label>
        <select
          value={riesgoId}
          onChange={e => setRiesgoId(e.target.value)}
          className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
        >
          <option value="">Seleccionar evento de riesgo...</option>
          {riesgos.map(r => (
            <option key={r.id} value={r.id}>
              {r.codigo} ({r.categoria}) — {r.descripcion}
            </option>
          ))}
        </select>
        {selectedRiesgo && (
          <div className="flex items-center gap-2 pt-1">
            <span className="font-mono text-xs font-bold text-[#10B981]">{selectedRiesgo.codigo}</span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[selectedRiesgo.categoria]}`}>
              {selectedRiesgo.categoria}
            </span>
            <span className="text-xs text-[#6B7280] truncate">{selectedRiesgo.descripcion}</span>
          </div>
        )}
      </div>

      {/* Causa description */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-orange-500" />
          <h2 className="text-sm font-semibold text-[#1A1A1A]">Descripcion de la causa</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Referencia</label>
            <input
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
              type="text"
              placeholder="Ej: LA-C04"
              className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Factor de riesgo</label>
            <select
              value={factorRiesgo}
              onChange={e => setFactorRiesgo(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm capitalize focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
            >
              <option value="">Sin factor</option>
              {FACTORES.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-medium text-[#6B7280] mb-1">
            Descripcion <span className="text-red-500">*</span>
          </label>
          <textarea
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            rows={3}
            placeholder="Describa la causa del riesgo..."
            className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm leading-relaxed focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981] resize-none"
          />
        </div>

        <div>
          <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Contexto adicional</label>
          <textarea
            value={contexto}
            onChange={e => setContexto(e.target.value)}
            rows={2}
            placeholder="Contexto adicional (opcional)"
            className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-xs leading-relaxed focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981] resize-none"
          />
        </div>
      </div>

      {/* Scoring: 4 impact dimensions + probability */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Evaluacion de riesgo</h2>

        {/* 4 dimensions grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { label: 'Legal', peso: '30%', value: impLegal, setter: setImpLegal },
            { label: 'Reputacional', peso: '40%', value: impReputacional, setter: setImpReputacional },
            { label: 'Operativo', peso: '20%', value: impOperativo, setter: setImpOperativo },
            { label: 'Contagio', peso: '10%', value: impContagio, setter: setImpContagio },
          ]).map(dim => {
            const nivel = IMPACTO_NIVEL[dim.value] ?? IMPACTO_NIVEL[1]
            return (
              <div key={dim.label} className="rounded-lg border border-[#E5E7EB] p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-[#6B7280]">{dim.label}</span>
                  <span className="text-[10px] text-[#6B7280]">Peso: {dim.peso}</span>
                </div>
                <div className="flex items-center gap-2">
                  <ScoreSelect value={dim.value} onChange={dim.setter} label={dim.label} />
                  <span className="text-xs text-[#6B7280]">{nivel.label}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Impact ponderado summary */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E5E7EB] bg-gray-50 px-4 py-3">
          <span className="text-sm font-medium text-[#6B7280]">Impacto ponderado:</span>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${getImpactoBadgeColor(impPonderado)}`}>
            {impPonderado.toFixed(1)}
          </span>
          <span className="text-xs text-[#6B7280]">
            = L:{impLegal}×0.3 + R:{impReputacional}×0.4 + O:{impOperativo}×0.2 + C:{impContagio}×0.1
          </span>
        </div>

        {/* Probability */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#E5E7EB] p-3 space-y-1">
            <span className="text-[10px] font-medium text-[#6B7280]">Probabilidad por ocurrencia</span>
            <div className="flex items-center gap-2">
              <ScoreSelect value={probOcurrencia} onChange={setProbOcurrencia} label="Probabilidad ocurrencia" />
              <span className="text-xs text-[#6B7280]">{PROB_LABELS[probOcurrencia]}</span>
            </div>
          </div>
          <div className="rounded-lg border border-[#E5E7EB] p-3 space-y-1">
            <span className="text-[10px] font-medium text-[#6B7280]">Probabilidad por frecuencia</span>
            <div className="flex items-center gap-2">
              <ScoreSelect value={probFrecuencia} onChange={setProbFrecuencia} label="Probabilidad frecuencia" />
              <span className="text-xs text-[#6B7280]">{PROB_LABELS[probFrecuencia]}</span>
            </div>
          </div>
        </div>

        {/* Probability result */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E5E7EB] bg-gray-50 px-4 py-3">
          <span className="text-sm font-medium text-[#6B7280]">Probabilidad resultante:</span>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${IMPACTO_NIVEL[probResultante]?.color ?? 'bg-gray-100 text-gray-800'}`}>
            {probResultante} — {PROB_LABELS[probResultante]}
          </span>
          <span className="text-xs text-[#6B7280]">= max(ocurrencia, frecuencia)</span>
        </div>
      </div>
    </div>
  )
}
