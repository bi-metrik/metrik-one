import { ArrowLeft, Receipt } from 'lucide-react'
import Link from 'next/link'

export default function NuevoGastoPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/numeros"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Registrar gasto</h1>
          <p className="text-sm text-muted-foreground">Registro rapido de gasto</p>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <Receipt className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-medium text-foreground">
          Formulario en construccion
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Monto + Categoria + Descripcion + Proyecto (opcional) + Soporte
        </p>
      </div>
    </div>
  )
}
