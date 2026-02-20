'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { CATEGORIAS_GASTO } from '@/lib/pipeline/constants'
import { createGasto } from './gasto-action'

export default function NuevoGastoForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await createGasto(fd)
      if (res.success) {
        toast.success('Gasto registrado')
        router.push('/numeros')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link href="/numeros" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold">Registrar gasto</h1>
          <p className="text-xs text-muted-foreground">Registro rapido</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Monto *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input name="monto" type="number" required min="1" autoFocus placeholder="50000" className="w-full rounded-md border bg-background py-2.5 pl-7 pr-3 text-sm" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Categoria</label>
          <select name="categoria" defaultValue="otros" className="w-full rounded-md border bg-background px-3 py-2.5 text-sm">
            {CATEGORIAS_GASTO.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Fecha</label>
          <input name="fecha" type="date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full rounded-md border bg-background px-3 py-2.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Descripcion</label>
          <input name="descripcion" placeholder="Describe el gasto" className="w-full rounded-md border bg-background px-3 py-2.5 text-sm" />
        </div>
        <label className="flex items-center gap-2">
          <input name="deducible" type="checkbox" value="true" className="rounded border" />
          <span className="text-sm">Deducible de impuestos</span>
        </label>
        <button type="submit" disabled={isPending} className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {isPending ? 'Registrando...' : 'Registrar gasto'}
        </button>
      </form>
    </div>
  )
}
