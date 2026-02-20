'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { createContacto } from '@/app/(app)/directorio/actions'
import { FUENTES_ADQUISICION } from '@/lib/pipeline/constants'

export default function NuevoContactoForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await createContacto(fd)
      if (res.success) {
        toast.success('Contacto creado')
        router.push('/directorio/contactos')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/directorio/contactos"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold">Nuevo contacto</h1>
          <p className="text-xs text-muted-foreground">Registro rapido</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre *</label>
          <input
            name="nombre"
            required
            autoFocus
            placeholder="Nombre del contacto"
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Telefono</label>
          <input
            name="telefono"
            type="tel"
            placeholder="+57 300 123 4567"
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Fuente de adquisicion</label>
          <select
            name="fuente_adquisicion"
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          >
            <option value="">Seleccionar</option>
            {FUENTES_ADQUISICION.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? 'Creando...' : 'Crear contacto'}
        </button>
      </form>
    </div>
  )
}
