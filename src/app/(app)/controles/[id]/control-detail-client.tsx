'use client'

import Link from 'next/link'
import { ArrowLeft, ShieldCheck, Check, X, User } from 'lucide-react'

const TIPO_COLORS: Record<string, string> = {
  preventivo: 'bg-blue-100 text-blue-800',
  detectivo: 'bg-purple-100 text-purple-800',
  correctivo: 'bg-gray-100 text-gray-800',
}

const ESTADO_COLORS: Record<string, string> = {
  IMPLEMENTADO: 'bg-green-100 text-green-800',
  EN_PROGRESO: 'bg-yellow-100 text-yellow-800',
  SUSPENDIDO: 'bg-red-100 text-red-800',
  PENDIENTE: 'bg-gray-100 text-gray-800',
}

const CATEGORIA_COLORS: Record<string, string> = {
  LA: 'bg-blue-100 text-blue-800',
  FT: 'bg-purple-100 text-purple-800',
  FPADM: 'bg-amber-100 text-amber-800',
  PTEE: 'bg-red-100 text-red-800',
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

const EF_FIELDS = [
  'ef_certeza', 'ef_cambios_personal', 'ef_multiples_localidades',
  'ef_juicios_significativos', 'ef_actividades_complejas',
  'ef_depende_otros', 'ef_sujeto_actualizaciones',
]

const PROB_COLORS: Record<number, string> = {
  1: 'bg-green-100 text-green-800',
  2: 'bg-yellow-100 text-yellow-800',
  3: 'bg-orange-100 text-orange-800',
  4: 'bg-red-100 text-red-700',
  5: 'bg-red-200 text-red-900',
}

function getImpactoBadgeColor(value: number): string {
  if (value <= 1.5) return 'bg-green-100 text-green-800'
  if (value <= 2.5) return 'bg-yellow-100 text-yellow-800'
  if (value <= 3.5) return 'bg-orange-100 text-orange-800'
  return 'bg-red-100 text-red-800'
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  causas: any[]
}

export default function ControlDetailClient({ control, causas }: Props) {
  const efectividad = control.ponderacion_efectividad != null
    ? Math.round(control.ponderacion_efectividad * 100)
    : null

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
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-[#10B981]">
                {control.referencia ?? '\u2014'}
              </span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${TIPO_COLORS[control.tipo_control] ?? 'bg-gray-100 text-gray-800'}`}>
                {control.tipo_control}
              </span>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${ESTADO_COLORS[control.estado] ?? 'bg-gray-100 text-gray-800'}`}>
                {control.estado}
              </span>
            </div>
            <p className="text-xs text-[#6B7280]">Detalle del control</p>
          </div>
        </div>
      </div>

      {/* Card 1: Informacion */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#10B981]" />
          <h2 className="text-sm font-semibold text-[#1A1A1A]">Informacion del control</h2>
        </div>

        <p className="text-sm font-medium text-[#1A1A1A]">{control.nombre_control}</p>

        {control.actividad_control && (
          <p className="text-xs text-[#6B7280] leading-relaxed">{control.actividad_control}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {control.clasificacion && (
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[#6B7280] capitalize">
              {control.clasificacion}
            </span>
          )}
          {control.periodicidad && (
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[#6B7280] capitalize">
              {control.periodicidad}
            </span>
          )}
          {control.responsable_nombre ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-[#6B7280]">
              <User className="h-3 w-3" />
              {control.responsable_nombre}
            </span>
          ) : (
            <span className="text-[10px] text-[#6B7280] italic">Sin asignar</span>
          )}
        </div>
      </div>

      {/* Card 2: Efectividad */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1A1A1A]">Efectividad</h2>
          {efectividad != null && (
            <span className={`inline-flex rounded-full px-4 py-1.5 text-sm font-bold ${
              efectividad >= 80 ? 'bg-green-100 text-green-800' :
              efectividad >= 60 ? 'bg-yellow-100 text-yellow-800' :
              'bg-red-100 text-red-800'
            }`}>
              {efectividad}%
            </span>
          )}
        </div>

        {/* 7 factor tags */}
        {EF_FIELDS.some(f => control[f] != null) && (
          <div className="flex flex-wrap gap-1.5">
            {EF_FIELDS.map(f => {
              const val = control[f]
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
        )}
      </div>

      {/* Card 3: Causas impactadas */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">
          Causas de riesgo impactadas ({causas.length})
        </h2>

        {causas.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#E5E7EB] bg-gray-50 p-4 text-center">
            <p className="text-xs text-[#6B7280]">Este control no tiene causas asignadas.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] font-medium uppercase tracking-wider text-[#6B7280] bg-white">
                <tr>
                  <th className="px-3 py-2">Ref</th>
                  <th className="px-3 py-2">Categoria</th>
                  <th className="px-3 py-2 min-w-[200px]">Descripcion</th>
                  <th className="px-3 py-2 text-center">Imp.</th>
                  <th className="px-3 py-2 text-center">Prob</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {causas.map((c: any) => {
                  const impPonderado = parseFloat(c.impacto_ponderado ?? 0)
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-gray-50">
                      <td className="px-3 py-2.5">
                        <Link href={`/riesgos/causa/${c.id}`} className="font-mono text-xs font-medium text-[#10B981] hover:underline">
                          {c.referencia ?? '\u2014'}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[c.riesgo_categoria] ?? 'bg-gray-100 text-gray-800'}`}>
                          {c.riesgo_categoria ?? '\u2014'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/riesgos/causa/${c.id}`} className="hover:underline">
                          <p className="text-[#1A1A1A] line-clamp-2 text-xs">{c.descripcion ?? '\u2014'}</p>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${getImpactoBadgeColor(impPonderado)}`}>
                          {impPonderado.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${PROB_COLORS[c.probabilidad ?? 1] ?? 'bg-gray-100 text-gray-800'}`}>
                          {c.probabilidad ?? 1}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
