import { getEmpresas, tieneModuloAliados } from '../actions'
import DirectorioTabs from '../directorio-tabs'
import EmpresasList from './empresas-list'
import type { SearchParams } from '@/lib/filtros/url-estado'

export default async function EmpresasPage({
  searchParams,
}: {
  // El toggle de personas naturales viaja en la URL para sobrevivir al volver
  // atras; el servidor lo resuelve aqui para que su render coincida con el del
  // cliente al hidratar (si no, la lista parpadea de 6 a 180 filas).
  searchParams: Promise<SearchParams>
}) {
  const [sp, empresas, showAliados] = await Promise.all([
    searchParams,
    getEmpresas(),
    tieneModuloAliados(),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold">Directorio</h1>
        <p className="text-xs text-muted-foreground">Gestiona tus contactos y empresas</p>
      </div>

      {/* Tabs */}
      <DirectorioTabs showAliados={showAliados} />

      {/* List */}
      <EmpresasList empresas={empresas} searchParams={sp} />
    </div>
  )
}
