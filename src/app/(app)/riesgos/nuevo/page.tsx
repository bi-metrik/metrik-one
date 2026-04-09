import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { crearRiesgo } from '@/lib/actions/riesgos'
import NuevoRiesgoForm from './nuevo-riesgo-form'

export default function NuevoRiesgoPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/riesgos"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[#E5E7EB] transition-colors hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4 text-[#6B7280]" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Nuevo riesgo</h1>
          <p className="text-sm text-[#6B7280]">Registrar un nuevo riesgo en la matriz</p>
        </div>
      </div>

      <NuevoRiesgoForm action={crearRiesgo} />
    </div>
  )
}
