import { getContactos, getStaffParaResponsable, getMiStaffContexto, tieneModuloAliados } from '../actions'
import DirectorioTabs from '../directorio-tabs'
import ContactosList from './contactos-list'
import { getRolePermissions } from '@/lib/roles'
import type { SearchParams } from '@/lib/filtros/url-estado'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export default async function ContactosPage({
  searchParams,
}: {
  // Los filtros viajan en la URL para sobrevivir al volver atrás; el servidor los
  // resuelve aquí para que su render coincida con el del cliente al hidratar.
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const [contactos, staff, yo, showAliados] = await Promise.all([
    getContactos(),
    getStaffParaResponsable(),
    getMiStaffContexto(),
    tieneModuloAliados(),
  ])

  // Mismo flag que validan `asignarResponsableContacto` /
  // `asignarResponsableContactosMasivo` server-side: replicado en UI solo para no
  // ofrecer un control que fallaría. La barrera real está en la action.
  const canAsignar = getRolePermissions(yo.role ?? 'read_only').canAssignResponsable

  // Con `vista=lista` el contenedor se ensancha desde `md:`, el MISMO punto en el
  // que aparecen el toggle de vista y la tabla (`CONSULTA_MD`, 768 px). Ensanchar
  // solo en `lg:` dejaba la franja 768-1024 px con la tabla ya pintada dentro de
  // 672 px, y ahí los nombres de campaña se cortaban. Es el único cambio de ancho,
  // y va aquí porque este archivo es quien pone el `max-w-2xl` mobile-first.
  const anchoLista = sp.vista === 'lista' ? 'max-w-2xl md:max-w-5xl' : 'max-w-2xl'

  return (
    <div className={`mx-auto ${anchoLista} space-y-4 px-4 py-6`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Directorio</h1>
          <p className="text-xs text-muted-foreground">Gestiona tus contactos y empresas</p>
        </div>
        <Link
          href="/nuevo/contacto"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo contacto
        </Link>
      </div>

      {/* Tabs */}
      <DirectorioTabs showAliados={showAliados} />

      {/* List */}
      <ContactosList
        contactos={contactos}
        staff={staff}
        miStaffId={yo.staffId}
        miRol={yo.role}
        canAsignar={canAsignar}
        searchParams={sp}
      />
    </div>
  )
}
