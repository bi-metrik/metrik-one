'use client'

import { Activity } from 'lucide-react'

interface BloqueEjecucionProps {
  negocioId: string
  hasProyecto?: boolean
}

export default function BloqueEjecucion({ hasProyecto }: BloqueEjecucionProps) {
  if (!hasProyecto) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Activity className="h-8 w-8 text-[#6B7280]/20" />
        <p className="text-xs text-[#6B7280]">Disponible al iniciar ejecución</p>
        <p className="text-[11px] text-[#6B7280]/60">
          Se mostrará gastos y horas una vez que se vincule un proyecto a este negocio
        </p>
      </div>
    )
  }

  // Cuando haya proyecto vinculado: mostrar gastos + horas
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-50 border border-[#E5E7EB] p-3 text-center">
        <Activity className="h-5 w-5 text-[#6B7280]/30 mx-auto mb-1" />
        <p className="text-xs text-[#6B7280]">Datos de ejecución del proyecto vinculado</p>
        <p className="text-[10px] text-[#6B7280]/60 mt-0.5">Gastos y horas pendientes de migrar proyectos</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 text-[#6B7280]" />
        <span className="text-[10px] text-[#6B7280]">Solo visualización</span>
      </div>
    </div>
  )
}
