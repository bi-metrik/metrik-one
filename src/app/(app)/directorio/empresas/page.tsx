import { Building2 } from 'lucide-react'

export default function EmpresasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Directorio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestiona tus contactos y empresas
        </p>
      </div>

      <div className="flex items-center gap-2 border-b border-border pb-3">
        <a href="/directorio/contactos" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
          Contactos
        </a>
        <span className="border-b-2 border-primary px-3 py-1.5 text-sm font-medium text-foreground">
          Empresas
        </span>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <Building2 className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-medium text-foreground">
          Las empresas se crean al registrar oportunidades
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada empresa que agregues aparecera aqui con su perfil fiscal
        </p>
      </div>
    </div>
  )
}
