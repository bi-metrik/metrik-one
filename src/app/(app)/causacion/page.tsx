import { getCausacionData } from './actions'
import CausacionClient from './causacion-client'

interface Props {
  searchParams: Promise<{ tab?: string; mes?: string }>
}

export default async function CausacionPage({ searchParams }: Props) {
  const params = await searchParams
  const tab = (params.tab as 'aprobados' | 'causados') ?? 'aprobados'
  const mes = params.mes ?? new Date().toISOString().slice(0, 7)

  const { items, counts } = await getCausacionData(tab, mes)

  return (
    <CausacionClient
      items={items}
      counts={counts}
      activeTab={tab}
      mes={mes}
    />
  )
}
