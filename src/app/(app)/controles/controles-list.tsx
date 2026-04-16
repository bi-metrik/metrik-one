'use client'

import Link from 'next/link'
import { ShieldCheck, User } from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ControlWithCausas = any

const TIPO_COLORS: Record<string, string> = {
  preventivo: 'bg-blue-100 text-blue-800',
  detectivo: 'bg-purple-100 text-purple-800',
  correctivo: 'bg-gray-100 text-gray-800',
}

const CATEGORIA_COLORS: Record<string, string> = {
  LA: 'bg-blue-100 text-blue-800',
  FT: 'bg-purple-100 text-purple-800',
  FPADM: 'bg-amber-100 text-amber-800',
  PTEE: 'bg-red-100 text-red-800',
}

const ESTADO_COLORS: Record<string, string> = {
  IMPLEMENTADO: 'bg-green-100 text-green-800',
  EN_PROGRESO: 'bg-yellow-100 text-yellow-800',
  SUSPENDIDO: 'bg-red-100 text-red-800',
  PENDIENTE: 'bg-gray-100 text-gray-800',
}

function getEfectividadColor(pct: number): string {
  if (pct >= 80) return 'bg-green-100 text-green-800'
  if (pct >= 60) return 'bg-yellow-100 text-yellow-800'
  return 'bg-red-100 text-red-800'
}

interface Props {
  controles: ControlWithCausas[]
}

export default function ControlesList({ controles }: Props) {
  if (controles.length === 0) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-12 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-[#6B7280] mb-3" />
        <p className="text-sm font-medium text-[#1A1A1A]">Sin controles registrados</p>
        <p className="mt-1 text-xs text-[#6B7280]">Agrega el primer control para mitigar riesgos.</p>
        <Link
          href="/controles/nuevo"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#10B981] hover:underline"
        >
          Crear primer control
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {controles.map((ctrl: ControlWithCausas) => {
        const efectividad = ctrl.ponderacion_efectividad != null
          ? Math.round(ctrl.ponderacion_efectividad * 100)
          : null
        const causas = ctrl.causas_asignadas ?? []

        return (
          <Link
            key={ctrl.id}
            href={`/controles/${ctrl.id}`}
            className="block rounded-lg border border-[#E5E7EB] bg-white p-4 transition-colors hover:bg-gray-50"
          >
            {/* Row 1: Ref, nombre, badges */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-[#10B981]">
                    {ctrl.referencia ?? '\u2014'}
                  </span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${TIPO_COLORS[ctrl.tipo_control] ?? 'bg-gray-100 text-gray-800'}`}>
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
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${ESTADO_COLORS[ctrl.estado] ?? 'bg-gray-100 text-gray-800'}`}>
                    {ctrl.estado}
                  </span>
                </div>
                <p className="text-sm font-medium text-[#1A1A1A] line-clamp-1">{ctrl.nombre_control}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {efectividad != null && (
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${getEfectividadColor(efectividad)}`}>
                    {efectividad}%
                  </span>
                )}
              </div>
            </div>

            {/* Row 2: Responsable + causas count */}
            <div className="mt-2 flex items-center gap-3">
              {ctrl.responsable_nombre && (
                <span className="inline-flex items-center gap-1 text-[10px] text-[#6B7280]">
                  <User className="h-3 w-3" />
                  {ctrl.responsable_nombre}
                </span>
              )}
              {causas.length > 0 && (
                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-[#6B7280]">
                  {causas.length} causa{causas.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Row 3: Causa pills */}
            {causas.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {causas.map((c: any) => (
                  <span
                    key={c.id}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${CATEGORIA_COLORS[c.riesgo_categoria] ?? 'bg-gray-100 text-gray-800'}`}
                  >
                    {c.referencia ?? '?'} ({c.riesgo_categoria ?? '?'})
                  </span>
                ))}
              </div>
            )}
          </Link>
        )
      })}
    </div>
  )
}
