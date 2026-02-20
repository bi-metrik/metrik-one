import { getOportunidades } from './actions-v2'
import PipelineList from './pipeline-list-v2'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export default async function PipelinePage() {
  const oportunidades = await getOportunidades()

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Pipeline</h1>
          <p className="text-xs text-muted-foreground">
            {oportunidades.length} oportunidad{oportunidades.length !== 1 ? 'es' : ''}
          </p>
        </div>
        <Link
          href="/nuevo/oportunidad"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva oportunidad
        </Link>
      </div>

      {/* List */}
      <PipelineList oportunidades={oportunidades} />
    </div>
  )
}
