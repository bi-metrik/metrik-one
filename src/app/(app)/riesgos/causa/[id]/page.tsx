import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck, ShieldAlert, Check, X } from 'lucide-react'
import { getCausa } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'

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

export default async function CausaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { role } = await getWorkspace()
  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canViewRiesgos) redirect('/')

  const result = await getCausa(id)
  if (!result) notFound()

  const { causa, riesgo, controles } = result
  const impPonderado = parseFloat(causa.impacto_ponderado ?? 0)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
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
            {causa.factor_riesgo && (
              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[#6B7280] capitalize">
                {causa.factor_riesgo}
              </span>
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

      {/* Causa description */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-orange-500" />
          <h2 className="text-sm font-semibold text-[#1A1A1A]">Descripcion de la causa</h2>
        </div>
        <p className="text-sm text-[#1A1A1A] leading-relaxed">{causa.descripcion}</p>
        {causa.contexto && (
          <p className="text-xs text-[#6B7280] italic leading-relaxed border-t border-[#E5E7EB] pt-2">{causa.contexto}</p>
        )}
      </div>

      {/* Scoring: 4 impact dimensions + probability */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Evaluacion de riesgo</h2>

        {/* 4 dimensions grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { key: 'impacto_legal', label: 'Legal', peso: '30%' },
            { key: 'impacto_reputacional', label: 'Reputacional', peso: '40%' },
            { key: 'impacto_operativo', label: 'Operativo', peso: '20%' },
            { key: 'impacto_contagio', label: 'Contagio', peso: '10%' },
          ].map(dim => {
            const val = causa[dim.key] ?? 1
            const nivel = IMPACTO_NIVEL[val] ?? IMPACTO_NIVEL[1]
            return (
              <div key={dim.key} className="rounded-lg border border-[#E5E7EB] p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-[#6B7280]">{dim.label}</span>
                  <span className="text-[10px] text-[#6B7280]">Peso: {dim.peso}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${nivel.color}`}>
                    {val}
                  </span>
                  <span className="text-xs text-[#6B7280]">{nivel.label}</span>
                </div>
                {causa[dim.key + '_detalle'] && (
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
            = L:{causa.impacto_legal ?? 1}×0.3 + R:{causa.impacto_reputacional ?? 1}×0.4 + O:{causa.impacto_operativo ?? 1}×0.2 + C:{causa.impacto_contagio ?? 1}×0.1
          </span>
        </div>

        {/* Probability */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#E5E7EB] p-3 space-y-1">
            <span className="text-[10px] font-medium text-[#6B7280]">Probabilidad por ocurrencia</span>
            <div className="flex items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${IMPACTO_NIVEL[causa.probabilidad_ocurrencia ?? 1]?.color ?? 'bg-gray-100 text-gray-800'}`}>
                {causa.probabilidad_ocurrencia ?? '—'}
              </span>
              {causa.probabilidad_ocurrencia && (
                <span className="text-xs text-[#6B7280]">{PROB_LABELS[causa.probabilidad_ocurrencia]}</span>
              )}
            </div>
            {causa.probabilidad_ocurrencia_detalle && (
              <p className="text-[10px] text-[#6B7280] italic">{causa.probabilidad_ocurrencia_detalle}</p>
            )}
          </div>
          <div className="rounded-lg border border-[#E5E7EB] p-3 space-y-1">
            <span className="text-[10px] font-medium text-[#6B7280]">Probabilidad por frecuencia</span>
            <div className="flex items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${IMPACTO_NIVEL[causa.probabilidad_frecuencia ?? 1]?.color ?? 'bg-gray-100 text-gray-800'}`}>
                {causa.probabilidad_frecuencia ?? '—'}
              </span>
              {causa.probabilidad_frecuencia && (
                <span className="text-xs text-[#6B7280]">{PROB_LABELS[causa.probabilidad_frecuencia]}</span>
              )}
            </div>
            {causa.probabilidad_frecuencia_detalle && (
              <p className="text-[10px] text-[#6B7280] italic">{causa.probabilidad_frecuencia_detalle}</p>
            )}
          </div>
        </div>

        {/* Probability result */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E5E7EB] bg-gray-50 px-4 py-3">
          <span className="text-sm font-medium text-[#6B7280]">Probabilidad resultante:</span>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${IMPACTO_NIVEL[causa.probabilidad ?? 1]?.color ?? 'bg-gray-100 text-gray-800'}`}>
            {causa.probabilidad ?? 1} — {PROB_LABELS[causa.probabilidad ?? 1]}
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

      {/* Controls assigned to this causa */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#10B981]" />
          <h2 className="text-base font-semibold text-[#1A1A1A]">
            Controles asignados
            <span className="ml-2 text-sm font-normal text-[#6B7280]">({controles.length})</span>
          </h2>
        </div>

        {controles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-gray-50 p-6 text-center">
            <p className="text-xs text-[#6B7280]">Sin controles asignados a esta causa.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {controles.map((ctrl: any) => {
              const efectividad = ctrl.ponderacion_efectividad != null ? Math.round(ctrl.ponderacion_efectividad * 100) : null
              const efFactors = [
                'ef_certeza', 'ef_cambios_personal', 'ef_multiples_localidades',
                'ef_juicios_significativos', 'ef_actividades_complejas',
                'ef_depende_otros', 'ef_sujeto_actualizaciones',
              ]
              return (
                <div key={ctrl.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#10B981]">{ctrl.referencia ?? '—'}</span>
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
                  {efFactors.some(f => ctrl[f] != null) && (
                    <div className="border-t border-[#E5E7EB] pt-2">
                      <span className="text-[10px] font-medium text-[#6B7280] block mb-1.5">Factores de efectividad</span>
                      <div className="flex flex-wrap gap-1.5">
                        {efFactors.map(f => {
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
      </div>
    </div>
  )
}
