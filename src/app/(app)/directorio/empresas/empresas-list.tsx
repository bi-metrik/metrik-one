'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Search, Trash2, Pencil, ShieldCheck, ShieldAlert, Flame, User } from 'lucide-react'
import { toast } from 'sonner'
import EntityCard from '@/components/entity-card'
import { formatNit } from '@/lib/contacts/constants'
import { esEspejoDeContacto } from '@/lib/contactos/empresa-espejo'
import { useEstadoUrl } from '@/hooks/use-estado-url'
import { filtroDesdeSearchParams, type SearchParams } from '@/lib/filtros/url-estado'
import { deleteEmpresa } from '../actions'
import type { Empresa } from '@/types/database'

interface Props {
  empresas: Empresa[]
  searchParams?: SearchParams
}

function isPerfilFiscalCompleto(e: Empresa): boolean {
  return !!(e.numero_documento && e.tipo_documento && e.tipo_persona && e.regimen_tributario && e.gran_contribuyente !== null && e.agente_retenedor !== null)
}

export default function EmpresasList({ empresas, searchParams }: Props) {
  const [search, setSearch] = useState('')
  const [fiscalFilter, setFiscalFilter] = useState<'all' | 'completo' | 'incompleto'>('all')
  // El toggle vive en la URL (`useEstadoUrl`), no solo en estado de React: quien lo
  // enciende para corregir un dato fiscal entra a la ficha y vuelve, y perderlo ahi
  // obliga a re-encenderlo cada vez. El `inicial` lo resuelve el servidor desde los
  // searchParams (ver `page.tsx`) para que los dos renders coincidan al hidratar.
  const [mostrarEspejos, setMostrarEspejos] = useEstadoUrl<boolean>(
    'espejos',
    false,
    { inicial: filtroDesdeSearchParams(searchParams, 'espejos', false) },
  )
  const [, startTransition] = useTransition()
  const router = useRouter()

  // Las personas naturales que son el espejo fiscal de un contacto NO se listan por
  // defecto: ya estan en el directorio de contactos, que es donde vive su ficha. La
  // fila de `empresas` sigue intacta y sigue alimentando contrato, cotizacion y
  // cuenta de cobro (ver `esEspejoDeContacto`); lo unico que cambia es esta lista.
  const espejos = empresas.filter(esEspejoDeContacto)
  const visibles = mostrarEspejos ? empresas : empresas.filter(e => !esEspejoDeContacto(e))

  const filtered = visibles.filter(e => {
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

  const getPersonaBadge = (e: Empresa) => {
    // La persona natural solo se ve con el toggle encendido, y entonces tiene que
    // entenderse que no es una empresa: chip explicito en vez de la sigla "PN".
    if (esEspejoDeContacto(e)) return { label: 'Persona natural', color: 'bg-purple-100 text-purple-700' }
    if (e.tipo_persona === 'juridica') return { label: 'PJ', color: 'bg-blue-100 text-blue-700' }
    if (e.tipo_persona === 'natural') return { label: 'PN', color: 'bg-purple-100 text-purple-700' }
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

  // Los conteos del encabezado cuentan lo VISIBLE: con el toggle apagado, "Todas"
  // son las empresas de verdad y no las 180 filas de la tabla.
  const completeCount = visibles.filter(isPerfilFiscalCompleto).length
  const incompleteCount = visibles.length - completeCount

  const etiquetaEspejos = espejos.length === 1
    ? (mostrarEspejos ? '1 persona natural visible' : '1 persona natural oculta')
    : `${espejos.length} personas naturales ${mostrarEspejos ? 'visibles' : 'ocultas'}`

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
            const label = f === 'all' ? `Todas (${visibles.length})` : f === 'completo' ? `Completas (${completeCount})` : `Incompletas (${incompleteCount})`
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
          const badge = getPersonaBadge(e)
          const espejo = esEspejoDeContacto(e)
          return (
            <EntityCard
              key={e.id}
              // La persona natural enlaza a SU CONTACTO, que es donde esta toda la
              // informacion y a donde ya manda el panel del negocio. El perfil
              // fiscal de la fila `empresas` sigue alcanzable por el menu.
              href={espejo ? `/directorio/contacto/${e.contacto_id}` : `/directorio/empresa/${e.id}`}
              title={e.nombre}
              subtitle={[e.codigo, e.sector].filter(Boolean).join(' · ') || undefined}
              statusLabel={badge?.label}
              statusColor={badge?.color}
              isComplete={completo}
              showGreenCheck
              summaryLines={[
                ...(e.numero_documento ? [{ text: `${e.tipo_documento || 'Doc'}: ${formatNit(e.numero_documento)}` }] : []),
                {
                  icon: completo
                    ? <ShieldCheck className="h-3 w-3 text-green-500" />
                    : <ShieldAlert className="h-3 w-3 text-red-500" />,
                  text: completo ? 'Perfil fiscal completo' : 'Perfil fiscal incompleto',
                },
              ]}
              quickAction={{
                tooltip: 'Crear negocio',
                icon: <Flame className="h-4 w-4" />,
                onClick: () => router.push(`/negocios/nuevo?empresa_id=${e.id}&empresa_nombre=${encodeURIComponent(e.nombre)}`),
              }}
              actions={[
                {
                  label: espejo ? 'Perfil fiscal' : 'Editar',
                  icon: espejo ? <User className="h-3 w-3" /> : <Pencil className="h-3 w-3" />,
                  onClick: () => router.push(`/directorio/empresa/${e.id}`),
                },
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

      {/* Salida hacia las personas naturales escondidas: alguien va a necesitar
          entrar a una para corregir un dato fiscal y esta lista es el unico camino. */}
      {espejos.length > 0 && (
        <button
          type="button"
          onClick={() => setMostrarEspejos(!mostrarEspejos)}
          className="w-full text-balance px-2 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {etiquetaEspejos} · <span className="underline underline-offset-2">{mostrarEspejos ? 'Ocultar' : 'Mostrar'}</span>
        </button>
      )}
    </div>
  )
}
