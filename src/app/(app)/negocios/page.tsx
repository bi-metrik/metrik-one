import Link from 'next/link'
import { Plus } from 'lucide-react'
import { getNegocios } from './negocios-actions'
import NegociosClient from './negocios-client'

export default async function NegociosPage() {
  const data = await getNegocios()
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Negocios</h1>
          <p className="text-xs text-muted-foreground">Todas tus oportunidades y proyectos</p>
        </div>
        <Link
          href="/negocios/nuevo"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo negocio
        </Link>
      </div>
      <NegociosClient
        propuestas={data.propuestas}
        enCurso={data.enCurso}
        porCobrar={data.porCobrar}
        historial={data.historial}
        totales={data.totales}
      />
    </div>
  )
}
