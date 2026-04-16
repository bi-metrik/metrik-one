'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ShieldAlert, ShieldCheck, Pencil, Save, X, Loader2, Check } from 'lucide-react'
import { actualizarCausa } from '@/lib/actions/riesgos'

const NIVEL_COLORS: Record<string, string> = {
  BAJO: 'bg-green-100 text-green-800',
  MODERADO: 'bg-yellow-100 text-yellow-800',
  ALTO: 'bg-orange-100 text-orange-800',
  EXTREMO: 'bg-red-100 text-red-800',
}

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

function calcImpactoPonderado(l: number, r: number, o: number, c: number): number {
  return l * 0.3 + r * 0.4 + o * 0.2 + c * 0.1
}

interface Props {
  causaId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  causa: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  riesgo: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controles: any[]
  canEdit: boolean
}

export default function CausaDetailClient({ causaId, causa, riesgo, controles, canEdit }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Editable fields
  const [descripcion, setDescripcion] = useState(causa.descripcion ?? '')
  const [contexto, setContexto] = useState(causa.contexto ?? '')
  const [factorRiesgo, setFactorRiesgo] = useState(causa.factor_riesgo ?? '')
  const [impLegal, setImpLegal] = useState(causa.impacto_legal ?? 1)
  const [impReputacional, setImpReputacional] = useState(causa.impacto_reputacional ?? 1)
  const [impOperativo, setImpOperativo] = useState(causa.impacto_operativo ?? 1)
  const [impContagio, setImpContagio] = useState(causa.impacto_contagio ?? 1)
  const [probOcurrencia, setProbOcurrencia] = useState(causa.probabilidad_ocurrencia ?? 1)
  const [probFrecuencia, setProbFrecuencia] = useState(causa.probabilidad_frecuencia ?? 1)

  const impPonderado = editing
    ? calcImpactoPonderado(impLegal, impReputacional, impOperativo, impContagio)
    : parseFloat(causa.impacto_ponderado ?? 0)

  const probResultante = editing
    ? Math.max(probOcurrencia, probFrecuencia)
    : (causa.probabilidad ?? 1)

  function cancelEdit() {
    setEditing(false)
    setError(null)
    setDescripcion(causa.descripcion ?? '')
    setContexto(causa.contexto ?? '')
    setFactorRiesgo(causa.factor_riesgo ?? '')
    setImpLegal(causa.impacto_legal ?? 1)
    setImpReputacional(causa.impacto_reputacional ?? 1)
    setImpOperativo(causa.impacto_operativo ?? 1)
    setImpContagio(causa.impacto_contagio ?? 1)
    setProbOcurrencia(causa.probabilidad_ocurrencia ?? 1)
    setProbFrecuencia(causa.probabilidad_frecuencia ?? 1)
  }

  async function handleSave() {
    if (!descripcion.trim()) {
      setError('La descripcion es requerida')
      return
    }
    setSaving(true)
    setError(null)

    const result = await actualizarCausa(causaId, {
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

    if (result.success) {
      setEditing(false)
      router.refresh()
    } else {
      setError(result.error ?? 'Error al guardar')
    }
  }

  // Score selector for 1-5
  function ScoreSelect({ value, onChange, label }: { value: number; onChange: (v: number) => void; label?: string }) {
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
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-[#10B981]">{causa.referencia}</span>
              {!editing && causa.factor_riesgo && (
                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[#6B7280] capitalize">
                  {causa.factor_riesgo}
                </span>
              )}
              {editing && (
                <select
                  value={factorRiesgo}
                  onChange={e => setFactorRiesgo(e.target.value)}
                  className="rounded-md border border-[#E5E7EB] px-2 py-0.5 text-[10px] font-medium capitalize focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
                >
                  <option value="">Sin factor</option>
                  {FACTORES.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              )}
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${getImpactoBadgeColor(impPonderado)}`}>
                Impacto: {impPonderado.toFixed(1)}
              </span>
            </div>
            <p className="text-xs text-[#6B7280]">
              Causa del evento{' '}
              {riesgo && (
                <>
                  <Link href={`/riesgos/${riesgo.id}`} className="text-[#10B981] hover:underline font-medium">
                    {riesgo.codigo}
                  </Link>
                  {' '}
                  <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${CATEGORIA_COLORS[riesgo.categoria]}`}>
                    {riesgo.categoria}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Edit/Save buttons */}
        {canEdit && (
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[#6B7280] hover:bg-gray-100 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#10B981] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#6B7280] transition-colors hover:bg-gray-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Causa description */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-orange-500" />
          <h2 className="text-sm font-semibold text-[#1A1A1A]">Descripcion de la causa</h2>
        </div>
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm leading-relaxed focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981] resize-none"
              placeholder="Descripcion de la causa"
            />
            <div>
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Contexto adicional</label>
              <textarea
                value={contexto}
                onChange={e => setContexto(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-xs leading-relaxed focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981] resize-none"
                placeholder="Contexto adicional (opcional)"
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-[#1A1A1A] leading-relaxed">{causa.descripcion}</p>
            {causa.contexto && (
              <p className="text-xs text-[#6B7280] italic leading-relaxed border-t border-[#E5E7EB] pt-2">{causa.contexto}</p>
            )}
          </>
        )}
      </div>

      {/* Scoring: 4 impact dimensions + probability */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Evaluacion de riesgo</h2>

        {/* 4 dimensions grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { key: 'impacto_legal', label: 'Legal', peso: '30%', value: impLegal, setter: setImpLegal },
            { key: 'impacto_reputacional', label: 'Reputacional', peso: '40%', value: impReputacional, setter: setImpReputacional },
            { key: 'impacto_operativo', label: 'Operativo', peso: '20%', value: impOperativo, setter: setImpOperativo },
            { key: 'impacto_contagio', label: 'Contagio', peso: '10%', value: impContagio, setter: setImpContagio },
          ]).map(dim => {
            const val = editing ? dim.value : (causa[dim.key] ?? 1)
            const nivel = IMPACTO_NIVEL[val] ?? IMPACTO_NIVEL[1]
            return (
              <div key={dim.key} className="rounded-lg border border-[#E5E7EB] p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-[#6B7280]">{dim.label}</span>
                  <span className="text-[10px] text-[#6B7280]">Peso: {dim.peso}</span>
                </div>
                <div className="flex items-center gap-2">
                  {editing ? (
                    <ScoreSelect value={dim.value} onChange={dim.setter} label={dim.label} />
                  ) : (
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${nivel.color}`}>
                      {val}
                    </span>
                  )}
                  <span className="text-xs text-[#6B7280]">{nivel.label}</span>
                </div>
                {!editing && causa[dim.key + '_detalle'] && (
                  <p className="text-[10px] text-[#6B7280] italic mt-1">{causa[dim.key + '_detalle']}</p>
                )}
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
            = L:{editing ? impLegal : (causa.impacto_legal ?? 1)}×0.3 + R:{editing ? impReputacional : (causa.impacto_reputacional ?? 1)}×0.4 + O:{editing ? impOperativo : (causa.impacto_operativo ?? 1)}×0.2 + C:{editing ? impContagio : (causa.impacto_contagio ?? 1)}×0.1
          </span>
        </div>

        {/* Probability */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#E5E7EB] p-3 space-y-1">
            <span className="text-[10px] font-medium text-[#6B7280]">Probabilidad por ocurrencia</span>
            <div className="flex items-center gap-2">
              {editing ? (
                <ScoreSelect value={probOcurrencia} onChange={setProbOcurrencia} label="Probabilidad ocurrencia" />
              ) : (
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${IMPACTO_NIVEL[causa.probabilidad_ocurrencia ?? 1]?.color ?? 'bg-gray-100 text-gray-800'}`}>
                  {causa.probabilidad_ocurrencia ?? '—'}
                </span>
              )}
              <span className="text-xs text-[#6B7280]">{PROB_LABELS[editing ? probOcurrencia : (causa.probabilidad_ocurrencia ?? 1)]}</span>
            </div>
            {!editing && causa.probabilidad_ocurrencia_detalle && (
              <p className="text-[10px] text-[#6B7280] italic">{causa.probabilidad_ocurrencia_detalle}</p>
            )}
          </div>
          <div className="rounded-lg border border-[#E5E7EB] p-3 space-y-1">
            <span className="text-[10px] font-medium text-[#6B7280]">Probabilidad por frecuencia</span>
            <div className="flex items-center gap-2">
              {editing ? (
                <ScoreSelect value={probFrecuencia} onChange={setProbFrecuencia} label="Probabilidad frecuencia" />
              ) : (
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${IMPACTO_NIVEL[causa.probabilidad_frecuencia ?? 1]?.color ?? 'bg-gray-100 text-gray-800'}`}>
                  {causa.probabilidad_frecuencia ?? '—'}
                </span>
              )}
              <span className="text-xs text-[#6B7280]">{PROB_LABELS[editing ? probFrecuencia : (causa.probabilidad_frecuencia ?? 1)]}</span>
            </div>
            {!editing && causa.probabilidad_frecuencia_detalle && (
              <p className="text-[10px] text-[#6B7280] italic">{causa.probabilidad_frecuencia_detalle}</p>
            )}
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

      {/* Parent riesgo context */}
      {riesgo && (
        <div className="rounded-lg border border-[#E5E7EB] bg-gray-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Evento de riesgo</span>
            <Link href={`/riesgos/${riesgo.id}`} className="font-mono text-xs font-bold text-[#10B981] hover:underline">
              {riesgo.codigo}
            </Link>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[riesgo.categoria]}`}>
              {riesgo.categoria}
            </span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[riesgo.nivel_riesgo]}`}>
              {riesgo.nivel_riesgo}
            </span>
          </div>
          <p className="text-xs text-[#1A1A1A] leading-relaxed">{riesgo.descripcion}</p>
        </div>
      )}

      {/* Controls assigned to this causa (read-only, managed from /controles) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#10B981]" />
            <h2 className="text-base font-semibold text-[#1A1A1A]">
              Controles asignados
              <span className="ml-2 text-sm font-normal text-[#6B7280]">({controles.length})</span>
            </h2>
          </div>
          <Link
            href="/controles/nuevo"
            className="text-xs font-medium text-[#10B981] hover:underline"
          >
            Gestionar controles
          </Link>
        </div>

        {controles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-gray-50 p-6 text-center">
            <p className="text-xs text-[#6B7280]">Sin controles asignados a esta causa.</p>
            <Link href="/controles/nuevo" className="mt-2 inline-block text-xs font-medium text-[#10B981] hover:underline">
              Crear un control
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {controles.map((ctrl: any) => {
              const efectividad = ctrl.ponderacion_efectividad != null ? Math.round(ctrl.ponderacion_efectividad * 100) : null
              return (
                <Link key={ctrl.id} href={`/controles/${ctrl.id}`} className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-2 transition-colors hover:border-[#10B981]/30">
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
                        {ctrl.periodicidad && (
                          <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[#6B7280] capitalize">
                            {ctrl.periodicidad}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-[#1A1A1A]">{ctrl.nombre_control}</p>
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
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
