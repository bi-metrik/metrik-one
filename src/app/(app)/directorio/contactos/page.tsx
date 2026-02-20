import { Users } from 'lucide-react'

export default function ContactosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Directorio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestiona tus contactos y empresas
        </p>
      </div>

      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="border-b-2 border-primary px-3 py-1.5 text-sm font-medium text-foreground">
          Contactos
        </span>
        <a href="/directorio/empresas" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
          Empresas
        </a>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <Users className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-medium text-foreground">
          Registra tus contactos para nunca perder un negocio
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Los contactos que agregues apareceran aqui
        </p>
        <a
          href="/nuevo/contacto"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Nuevo contacto
        </a>
      </div>
    </div>
  )
}
