import { getNegocios } from './negocios-actions'
import NegociosClient from './negocios-client'

export default async function NegociosPage() {
  const data = await getNegocios()
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-lg font-bold">Negocios</h1>
        <p className="text-xs text-muted-foreground">Todas tus oportunidades y proyectos</p>
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
