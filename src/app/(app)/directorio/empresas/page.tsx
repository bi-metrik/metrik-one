import { getEmpresas, tieneModuloAliados } from '../actions'
import DirectorioTabs from '../directorio-tabs'
import EmpresasList from './empresas-list'

export default async function EmpresasPage() {
  const [empresas, showAliados] = await Promise.all([getEmpresas(), tieneModuloAliados()])

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
      <EmpresasList empresas={empresas} />
    </div>
  )
}
