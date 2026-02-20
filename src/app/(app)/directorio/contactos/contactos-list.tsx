'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Phone, Mail, Search, Users, Trash2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import EntityCard from '@/components/entity-card'
import { FUENTES_ADQUISICION, ROLES_CONTACTO } from '@/lib/pipeline/constants'
import { deleteContacto } from '../actions'
import type { Contacto } from '@/types/database'

interface Props {
  contactos: Contacto[]
}

export default function ContactosList({ contactos }: Props) {
  const [search, setSearch] = useState('')
  const [rolFilter, setRolFilter] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const filtered = contactos.filter(c => {
    const matchSearch = !search || c.nombre.toLowerCase().includes(search.toLowerCase())
    const matchRol = !rolFilter || c.rol === rolFilter
    return matchSearch && matchRol
  })

  const handleDelete = (id: string, nombre: string) => {
    if (!confirm(`Eliminar contacto "${nombre}"?`)) return
    startTransition(async () => {
      const res = await deleteContacto(id)
      if (res.success) {
        toast.success('Contacto eliminado')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const getFuenteLabel = (value: string | null) =>
    FUENTES_ADQUISICION.find(f => f.value === value)?.label ?? value ?? ''

  const getRolLabel = (value: string | null) =>
    ROLES_CONTACTO.find(r => r.value === value)?.label ?? ''

  const getRolChip = (value: string | null) => {
    if (!value) return undefined
    const colors: Record<string, string> = {
      promotor: 'bg-purple-100 text-purple-700',
      decisor: 'bg-blue-100 text-blue-700',
      influenciador: 'bg-amber-100 text-amber-700',
      operativo: 'bg-gray-100 text-gray-600',
    }
    return colors[value] ?? 'bg-gray-100 text-gray-600'
  }

  const timeAgo = (date: string | null) => {
    if (!date) return undefined
    const diff = Date.now() - new Date(date).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Hoy'
    if (days === 1) return 'Ayer'
    if (days < 30) return `Hace ${days} dias`
    if (days < 365) return `Hace ${Math.floor(days / 30)} meses`
    return `Hace ${Math.floor(days / 365)} anos`
  }

  if (contactos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <Users className="h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-base font-medium">
          Registra tus contactos para nunca perder un negocio
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Los contactos que agregues apareceran aqui
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Search + filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar contacto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          <button
            onClick={() => setRolFilter(null)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !rolFilter ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            Todos ({contactos.length})
          </button>
          {ROLES_CONTACTO.map(r => {
            const count = contactos.filter(c => c.rol === r.value).length
            if (count === 0) return null
            return (
              <button
                key={r.value}
                onClick={() => setRolFilter(rolFilter === r.value ? null : r.value)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  rolFilter === r.value ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {r.label} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {filtered.map(c => (
          <EntityCard
            key={c.id}
            href={`/directorio/contacto/${c.id}`}
            title={c.nombre}
            subtitle={getFuenteLabel(c.fuente_adquisicion)}
            statusLabel={getRolLabel(c.rol) || undefined}
            statusColor={getRolChip(c.rol)}
            isComplete={!!c.email}
            summaryLines={[
              ...(c.telefono ? [{ icon: <Phone className="h-3 w-3" />, text: c.telefono }] : []),
              ...(c.email ? [{ icon: <Mail className="h-3 w-3" />, text: c.email }] : []),
            ]}
            timeAgo={timeAgo(c.created_at)}
            actions={[
              { label: 'Editar', icon: <Pencil className="h-3 w-3" />, onClick: () => router.push(`/directorio/contacto/${c.id}`) },
              { label: 'Eliminar', icon: <Trash2 className="h-3 w-3" />, variant: 'destructive', onClick: () => handleDelete(c.id, c.nombre) },
            ]}
          />
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron contactos
          </p>
        )}
      </div>
    </div>
  )
}
