import { getContactos } from '../actions'
import DirectorioTabs from '../directorio-tabs'
import ContactosList from './contactos-list'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export default async function ContactosPage() {
  const contactos = await getContactos()

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
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
      <DirectorioTabs />

      {/* List */}
      <ContactosList contactos={contactos} />
    </div>
  )
}
