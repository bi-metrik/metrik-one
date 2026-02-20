'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Search, Trash2, Pencil, ShieldCheck, ShieldAlert, Flame } from 'lucide-react'
import { toast } from 'sonner'
import EntityCard from '@/components/entity-card'
import { formatNit } from '@/lib/contacts/constants'
import { deleteEmpresa } from '../actions'
import type { Empresa } from '@/types/database'

interface Props {
  empresas: Empresa[]
}

function isPerfilFiscalCompleto(e: Empresa): boolean {
  return !!(e.nit && e.tipo_persona && e.regimen_tributario && e.gran_contribuyente !== null && e.agente_retenedor !== null)
}

export default function EmpresasList({ empresas }: Props) {
  const [search, setSearch] = useState('')
  const [fiscalFilter, setFiscalFilter] = useState<'all' | 'completo' | 'incompleto'>('all')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const filtered = empresas.filter(e => {
    const matchSearch = !search || e.nombre.toLowerCase().includes(search.toLowerCase())
    const completo = isPerfilFiscalCompleto(e)
    const matchFiscal = fiscalFilter === 'all' ||
      (fiscalFilter === 'completo' && completo) ||
      (fiscalFilter === 'incompleto' && !completo)
    return matchSearch && matchFiscal
  })

  const handleDelete = (id: string, nombre: string) => {
    if (!confirm(`Eliminar empresa "${nombre}"?`)) return
    startTransition(async () => {
      const res = await deleteEmpresa(id)
      if (res.success) {
        toast.success('Empresa eliminada')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const getPersonaBadge = (tipo: string | null) => {
    if (tipo === 'juridica') return { label: 'PJ', color: 'bg-blue-100 text-blue-700' }
    if (tipo === 'natural') return { label: 'PN', color: 'bg-purple-100 text-purple-700' }
    return undefined
  }

  if (empresas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <Building2 className="h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-base font-medium">
          Las empresas se crean al registrar oportunidades
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada empresa que agregues aparecera aqui con su perfil fiscal
        </p>
      </div>
    )
  }

  const completeCount = empresas.filter(isPerfilFiscalCompleto).length
  const incompleteCount = empresas.length - completeCount

  return (
    <div className="space-y-3">
      {/* Search + filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar empresa..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex gap-1.5">
          {(['all', 'completo', 'incompleto'] as const).map(f => {
            const label = f === 'all' ? `Todas (${empresas.length})` : f === 'completo' ? `Completas (${completeCount})` : `Incompletas (${incompleteCount})`
            return (
              <button
                key={f}
                onClick={() => setFiscalFilter(f)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  fiscalFilter === f ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {filtered.map(e => {
          const completo = isPerfilFiscalCompleto(e)
          const badge = getPersonaBadge(e.tipo_persona)
          return (
            <EntityCard
              key={e.id}
              href={`/directorio/empresa/${e.id}`}
              title={e.nombre}
              subtitle={e.sector ?? undefined}
              statusLabel={badge?.label}
              statusColor={badge?.color}
              isComplete={completo}
              showGreenCheck
              summaryLines={[
                ...(e.nit ? [{ text: `NIT: ${formatNit(e.nit)}` }] : []),
                {
                  icon: completo
                    ? <ShieldCheck className="h-3 w-3 text-green-500" />
                    : <ShieldAlert className="h-3 w-3 text-red-500" />,
                  text: completo ? 'Perfil fiscal completo' : 'Perfil fiscal incompleto',
                },
              ]}
              quickAction={{
                tooltip: 'Crear oportunidad',
                icon: <Flame className="h-4 w-4" />,
                onClick: () => router.push(`/nuevo/oportunidad?empresa_id=${e.id}&empresa_nombre=${encodeURIComponent(e.nombre)}`),
              }}
              actions={[
                { label: 'Editar', icon: <Pencil className="h-3 w-3" />, onClick: () => router.push(`/directorio/empresa/${e.id}`) },
                { label: 'Eliminar', icon: <Trash2 className="h-3 w-3" />, variant: 'destructive', onClick: () => handleDelete(e.id, e.nombre) },
              ]}
            />
          )
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron empresas
          </p>
        )}
      </div>
    </div>
  )
}
