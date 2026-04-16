'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Trash2, ShieldCheck, AlertTriangle, Check, X } from 'lucide-react'
import { actualizarRiesgo, eliminarRiesgo } from '@/lib/actions/riesgos'
import type { Riesgo } from '@/lib/actions/riesgos'
import { toast } from 'sonner'

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

const CATEGORIA_LABELS: Record<string, string> = {
  LA: 'Lavado de Activos',
  FT: 'Financiacion del Terrorismo',
  FPADM: 'Financiacion Proliferacion ADM',
  PTEE: 'Personas Exp. Politicamente',
}

const ESTADOS = [
  { value: 'ABIERTO', label: 'Abierto' },
  { value: 'BAJO_CONTROL', label: 'Bajo control' },
  { value: 'MONITOREADO', label: 'Monitoreado' },
  { value: 'MITIGADO', label: 'Mitigado' },
  { value: 'REPORTADO', label: 'Reportado' },
  { value: 'CERRADO', label: 'Cerrado' },
]

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

function getImpactoBadgeColor(value: number): string {
  if (value <= 1.5) return 'bg-green-100 text-green-800'
  if (value <= 2.5) return 'bg-yellow-100 text-yellow-800'
  if (value <= 3.5) return 'bg-orange-100 text-orange-800'
  return 'bg-red-100 text-red-800'
}

const EF_FACTOR_LABELS: Record<string, string> = {
  ef_certeza: 'Certeza',
  ef_cambios_personal: 'Cambios personal',
  ef_multiples_localidades: 'Localidades',
  ef_juicios_significativos: 'Juicios',
  ef_actividades_complejas: 'Complejidad',
  ef_depende_otros: 'Dependencia',
  ef_sujeto_actualizaciones: 'Actualizaciones',
}

interface Props {
  riesgo: Riesgo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controles: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  causas: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlesFull: any[]
  equipo: { id: string; full_name: string; role: string | null }[]
  canEdit: boolean
  canDelete: boolean
}

export default function RiesgoDetail({ riesgo, controles, equipo, causas, controlesFull, canEdit, canDelete }: Props) {
  const [isPending, startTransition] = useTransition()
  const [estado, setEstado] = useState(riesgo.estado)
  const [responsableId, setResponsableId] = useState(riesgo.responsable_id ?? '')
  const [notas, setNotas] = useState(riesgo.notas ?? '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  function handleSave() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('estado', estado)
      fd.set('responsable_id', responsableId)
      fd.set('notas', notas)
      fd.set('probabilidad', String(riesgo.probabilidad))
      fd.set('impacto', String(riesgo.impacto))

      const result = await actualizarRiesgo(riesgo.id, fd)
      if (result.success) {
        toast.success('Riesgo actualizado')
      } else {
        toast.error(result.error ?? 'Error al actualizar')
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      await eliminarRiesgo(riesgo.id)
    })
  }

  // Group controls by causa_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlesByCausa = new Map<string, any[]>()
  for (const ctrl of controlesFull) {
    if (!ctrl.causa_id) continue
    const list = controlesByCausa.get(ctrl.causa_id) ?? []
    list.push(ctrl)
    controlesByCausa.set(ctrl.causa_id, list)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unassignedControls = controlesFull.filter((c: any) => !c.causa_id)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
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
              <span className="font-mono text-sm font-bold text-[#10B981]">{riesgo.codigo}</span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[riesgo.categoria]}`}>
                {riesgo.categoria}
              </span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[riesgo.nivel_riesgo]}`}>
                Inherente: {riesgo.nivel_riesgo}
              </span>
              {riesgo.nivel_riesgo_residual && (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[riesgo.nivel_riesgo_residual]}`}>
                  Residual: {riesgo.nivel_riesgo_residual}
                </span>
              )}
            </div>
            <p className="text-xs text-[#6B7280]">{CATEGORIA_LABELS[riesgo.categoria]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-[#10B981] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#059669] disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isPending ? 'Guardando...' : 'Guardar'}
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {!canEdit && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-gray-50 px-3 py-2 text-xs font-medium text-[#6B7280]">
              Solo lectura
            </span>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Eliminar este riesgo permanentemente?</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Si, eliminar
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-lg border border-[#E5E7EB] px-4 py-1.5 text-sm font-medium text-[#6B7280] hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Evento de riesgo summary */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Evento de riesgo</h2>
        <p className="text-sm text-[#1A1A1A] leading-relaxed">{riesgo.descripcion}</p>
        {riesgo.evento_riesgo && (
          <p className="text-xs text-[#6B7280] italic leading-relaxed">{riesgo.evento_riesgo}</p>
        )}

        {/* Estado + Responsable + Nivel inline */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 pt-2 border-t border-[#E5E7EB]">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#6B7280]">Estado</label>
            <select
              value={estado}
              onChange={e => setEstado(e.target.value)}
              disabled={!canEdit}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)] disabled:bg-gray-50 disabled:text-[#6B7280]"
            >
              {ESTADOS.map(e => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#6B7280]">Responsable</label>
            <select
              value={responsableId}
              onChange={e => setResponsableId(e.target.value)}
              disabled={!canEdit}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)] disabled:bg-gray-50 disabled:text-[#6B7280]"
            >
              <option value="">Sin asignar</option>
              {equipo.map(m => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#6B7280]">Riesgo inherente</label>
            <div className="flex items-center gap-2 h-[34px]">
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${NIVEL_COLORS[riesgo.nivel_riesgo]}`}>
                {riesgo.nivel_riesgo}
              </span>
              <span className="text-xs text-[#6B7280]">P:{riesgo.probabilidad} × I:{riesgo.impacto}</span>
            </div>
          </div>
        </div>

        {/* Notas */}
        <div className="space-y-1 pt-2">
          <label className="block text-xs font-medium text-[#6B7280]">Notas</label>
          <textarea
            value={notas}
            onChange={e => setNotas(e.target.value)}
            rows={2}
            disabled={!canEdit}
            placeholder="Observaciones adicionales..."
            className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#6B7280] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[rgba(16,185,129,0.15)] disabled:bg-gray-50 disabled:text-[#6B7280]"
          />
        </div>
      </div>

      {/* ── CAUSAS (primary sections) ─────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          <h2 className="text-base font-semibold text-[#1A1A1A]">
            Causas identificadas
            <span className="ml-2 text-sm font-normal text-[#6B7280]">({causas.length})</span>
          </h2>
        </div>

        {causas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-gray-50 p-6 text-center">
            <p className="text-xs text-[#6B7280]">Sin causas identificadas.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {causas.map((c: any) => {
              const impPonderado = parseFloat(c.impacto_ponderado ?? 0)
              const causaControles = controlesByCausa.get(c.id) ?? []

              return (
                <div key={c.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  {/* Causa header */}
                  <div className="px-5 py-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#10B981]">{c.referencia}</span>
                          {c.factor_riesgo && (
                            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[#6B7280] capitalize">
                              {c.factor_riesgo}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[#1A1A1A] leading-relaxed">{c.descripcion}</p>
                        {c.contexto && (
                          <p className="text-xs text-[#6B7280] italic leading-relaxed">{c.contexto}</p>
                        )}
                      </div>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold shrink-0 ${getImpactoBadgeColor(impPonderado)}`}>
                        Imp: {impPonderado.toFixed(1)}
                      </span>
                    </div>

                    {/* Scoring row */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* 4 dimensiones */}
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { key: 'impacto_legal', label: 'Legal', peso: '0.3' },
                          { key: 'impacto_reputacional', label: 'Reputac.', peso: '0.4' },
                          { key: 'impacto_operativo', label: 'Operativo', peso: '0.2' },
                          { key: 'impacto_contagio', label: 'Contagio', peso: '0.1' },
                        ].map(dim => {
                          const val = c[dim.key] ?? 1
                          const nivel = IMPACTO_NIVEL[val] ?? IMPACTO_NIVEL[1]
                          return (
                            <span
                              key={dim.key}
                              title={`${dim.label} (peso ${dim.peso}): ${val} — ${nivel.label}`}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${nivel.color}`}
                            >
                              {dim.label}: {val}
                            </span>
                          )
                        })}
                      </div>

                      <div className="border-l border-[#E5E7EB] h-4" />

                      {/* Probabilidad */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[#6B7280]">Prob:</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${IMPACTO_NIVEL[c.probabilidad ?? 1]?.color ?? 'bg-gray-100 text-gray-800'}`}>
                          {c.probabilidad ?? 1} — {PROB_LABELS[c.probabilidad ?? 1]}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Controls for this causa */}
                  {causaControles.length > 0 && (
                    <div className="border-t border-gray-100 bg-gray-50/50">
                      <div className="px-5 py-2">
                        <div className="flex items-center gap-1.5 mb-2">
                          <ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                            Control{causaControles.length > 1 ? 'es' : ''} ({causaControles.length})
                          </span>
                        </div>
                        <div className="space-y-2">
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {causaControles.map((ctrl: any) => {
                            const efectividad = ctrl.ponderacion_efectividad != null ? Math.round(ctrl.ponderacion_efectividad * 100) : null
                            const efFactors = [
                              'ef_certeza', 'ef_cambios_personal', 'ef_multiples_localidades',
                              'ef_juicios_significativos', 'ef_actividades_complejas',
                              'ef_depende_otros', 'ef_sujeto_actualizaciones',
                            ]
                            return (
                              <div key={ctrl.id} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                                <div className="flex items-start justify-between">
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-[10px] font-bold text-[#10B981]">{ctrl.referencia ?? '—'}</span>
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
                                    </div>
                                    <p className="text-xs font-medium text-[#1A1A1A]">{ctrl.nombre_control}</p>
                                    {ctrl.actividad_control && (
                                      <p className="text-[11px] text-[#6B7280] leading-relaxed">{ctrl.actividad_control}</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {efectividad != null && (
                                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                        efectividad >= 80 ? 'bg-green-100 text-green-800' :
                                        efectividad >= 60 ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-red-100 text-red-800'
                                      }`}>
                                        {efectividad}%
                                      </span>
                                    )}
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
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
                                {efFactors.some(f => ctrl[f] != null) && (
                                  <div className="flex flex-wrap gap-1">
                                    {efFactors.map(f => {
                                      const val = ctrl[f]
                                      if (val == null) return null
                                      const isGood = val === 3
                                      return (
                                        <span
                                          key={f}
                                          title={EF_FACTOR_LABELS[f]}
                                          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                            isGood ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                                          }`}
                                        >
                                          {isGood ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                                          {EF_FACTOR_LABELS[f]}
                                        </span>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {causaControles.length === 0 && (
                    <div className="border-t border-gray-100 px-5 py-2 bg-gray-50/50">
                      <p className="text-[10px] text-[#6B7280] italic flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        Sin control asignado
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Unassigned controls */}
      {unassignedControls.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#6B7280]" />
            <h2 className="text-sm font-semibold text-[#6B7280]">
              Controles sin causa asignada ({unassignedControls.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {unassignedControls.map((ctrl: any) => (
              <div key={ctrl.id} className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold text-[#6B7280]">{ctrl.referencia ?? '—'}</span>
                  <span className="text-xs text-[#1A1A1A]">{ctrl.nombre_control}</span>
                </div>
                {ctrl.actividad_control && (
                  <p className="text-[11px] text-[#6B7280]">{ctrl.actividad_control}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-2">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Informacion</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
          <div>
            <span className="text-[#6B7280]">Referencia:</span>{' '}
            <span className="text-[#1A1A1A] font-medium">{riesgo.referencia ?? '—'}</span>
          </div>
          <div>
            <span className="text-[#6B7280]">Factor de riesgo:</span>{' '}
            <span className="text-[#1A1A1A] font-medium capitalize">{riesgo.factor_riesgo}</span>
          </div>
          <div>
            <span className="text-[#6B7280]">Fecha identificacion:</span>{' '}
            <span className="text-[#1A1A1A] font-medium">{riesgo.fecha_identificacion ?? '—'}</span>
          </div>
          <div>
            <span className="text-[#6B7280]">Fecha evaluacion:</span>{' '}
            <span className="text-[#1A1A1A] font-medium">{riesgo.fecha_evaluacion ?? '—'}</span>
          </div>
          <div>
            <span className="text-[#6B7280]">Creado:</span>{' '}
            <span className="text-[#1A1A1A] font-medium">{new Date(riesgo.created_at).toLocaleDateString('es-CO')}</span>
          </div>
          <div>
            <span className="text-[#6B7280]">Actualizado:</span>{' '}
            <span className="text-[#1A1A1A] font-medium">{new Date(riesgo.updated_at).toLocaleDateString('es-CO')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
