/**
 * Props de `NegociosClient` a partir del universo, como las arma el servidor
 * (`armarVistaLista`). Las pruebas de render de `/negocios` pintan así el camino real:
 * resolver en el servidor + pintar en el cliente.
 */
import { armarVistaLista, type FaseFilter } from '@/lib/negocios/vista-lista'
import type { NegocioResumen } from '@/app/(app)/negocios/negocio-v2-actions'
import type { EtapaDelSegmentador } from '@/lib/negocios/linea-de-flujo'

export function propsLista(e: {
  negocios: NegocioResumen[]
  cerrados: NegocioResumen[]
  stagesActivos: string[]
  etapas: EtapaDelSegmentador[]
  searchParams: Record<string, string>
  hoyISO: string
  defaultStage?: FaseFilter
  pagina?: { desde?: number; cuantos?: number }
}) {
  const { vista } = armarVistaLista(
    {
      abiertos: e.negocios,
      cerrados: e.cerrados,
      etapas: e.etapas,
      defaultStage: e.defaultStage ?? 'todos',
      hoyISO: e.hoyISO,
    },
    e.searchParams,
    e.pagina,
  )
  return { vista, stagesActivos: e.stagesActivos }
}
