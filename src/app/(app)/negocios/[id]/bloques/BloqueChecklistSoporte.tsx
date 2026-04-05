// Re-exports BloqueChecklist with withSupport=true
'use client'

import BloqueChecklist from './BloqueChecklist'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface BloqueItem {
  id: string
  label: string
  completado: boolean
  completado_por: string | null
  completado_at: string | null
  link_url?: string | null
}

interface Props {
  negocioId: string
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  itemTemplates?: { label: string; tipo: string }[]
  initialItems?: BloqueItem[]
}

export default function BloqueChecklistSoporte(props: Props) {
  return <BloqueChecklist {...props} withSupport />
}
