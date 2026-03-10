'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Flame, Building2, User, Search, Clock, Trophy, X, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import EntityCard from '@/components/entity-card'
import { ETAPA_CONFIG, ETAPAS_ACTIVAS, TODAS_ETAPAS, RAZONES_PERDIDA } from '@/lib/pipeline/constants'
import { formatCOP } from '@/lib/contacts/constants'
import { moveOportunidad, ganarOportunidad, perderOportunidad } from './actions-v2'
import type { EtapaPipeline } from '@/lib/pipeline/constants'

interface OportunidadRow {
  id: string
  codigo: string
  descripcion: string | null
  etapa: string | null
  probabilidad: number | null
  valor_estimado: number | null
  created_at: string | null
  ultima_accion: string | null
  ultima_accion_fecha: string | null
  contactos: { nombre: string } | null
  empresas: { nombre: string; numero_documento: string | null; tipo_documento: string | null; tipo_persona: string | null; regimen_tributario: string | null; gran_contribuyente: boolean | null; agente_retenedor: boolean | null } | null
}

interface Props {
  oportunidades: OportunidadRow[]
}

export default function PipelineList({ oportunidades }: Props) {
  const [search, setSearch] = useState('')
  const [etapaFilter, setEtapaFilter] = useState<string | null>('activas')
  const [isPending, startTransition] = useTransition()
  const [lostModal, setLostModal] = useState<{ id: string; name: string } | null>(null)
  const [selectedReason, setSelectedReason] = useState('')
  const router = useRouter()

  const cycleEtapa = (id: string, currentEtapa: string | null) => {
    const current = currentEtapa ?? 'lead_nuevo'
    const currentIdx = ETAPAS_ACTIVAS.indexOf(current as EtapaPipeline)
    if (currentIdx === -1) return // terminal state — don't cycle
    const nextIdx = (currentIdx + 1) % ETAPAS_ACTIVAS.length
    const next = ETAPAS_ACTIVAS[nextIdx]
    const nextLabel = ETAPA_CONFIG[next]?.label ?? next

    startTransition(async () => {
      const res = await moveOportunidad(id, next)
      if (res.success) {
        toast.success(`Etapa: ${nextLabel}`)
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error')
      }
    })
  }

  const handleGanar = (id: string) => {
    startTransition(async () => {
      const res = await ganarOportunidad(id)
      if (res.success) {
        toast.success('¡Oportunidad ganada! Proyecto creado.')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error al marcar como ganada')
      }
    })
  }

  const handlePerder = () => {
    if (!lostModal || !selectedReason) return
    const id = lostModal.id
    setLostModal(null)
    setSelectedReason('')
    startTransition(async () => {
      const res = await perderOportunidad(id, selectedReason)
      if (res.success) {
        toast.info('Oportunidad marcada como perdida')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error')
      }
    })
  }

  const getNextEtapa = (current: string | null): EtapaPipeline | null => {
    const idx = ETAPAS_ACTIVAS.indexOf((current ?? 'lead_nuevo') as EtapaPipeline)
    if (idx === -1 || idx >= ETAPAS_ACTIVAS.length - 1) return null
    return ETAPAS_ACTIVAS[idx + 1]
  }

  const filtered = oportunidades.filter(o => {
    const matchSearch = !search ||
      o.descripcion?.toLowerCase().includes(search.toLowerCase()) ||
      (o.contactos as { nombre: string } | null)?.nombre?.toLowerCase().includes(search.toLowerCase()) ||
      (o.empresas as { nombre: string } | null)?.nombre?.toLowerCase().includes(search.toLowerCase())
    const matchEtapa = !etapaFilter
      || (etapaFilter === 'activas' && ETAPAS_ACTIVAS.includes(o.etapa as EtapaPipeline))
      || o.etapa === etapaFilter
    return matchSearch && matchEtapa
  })

  const diasSinActividad = (fecha: string | null) => {
    if (!fecha) return null
    const diff = Date.now() - new Date(fecha).getTime()
    return Math.floor(diff / 86400000)
  }

  const timeAgo = (date: string | null) => {
    if (!date) return undefined
    const diff = Date.now() - new Date(date).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Hoy'
    if (days === 1) return 'Ayer'
    if (days < 30) return `Hace ${days} días`
    if (days < 365) return `Hace ${Math.floor(days / 30)} meses`
    return `Hace ${Math.floor(days / 365)} años`
  }

  // Value pipeline summary
  const activeOps = oportunidades.filter(o => ETAPAS_ACTIVAS.includes(o.etapa as EtapaPipeline))
  const totalPipeline = activeOps.reduce((sum, o) => sum + (o.valor_estimado ?? 0), 0)
  const totalPonderado = activeOps.reduce((sum, o) => {
    const prob = (o.probabilidad ?? 0) / 100
    return sum + (o.valor_estimado ?? 0) * prob
  }, 0)

  if (oportunidades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <Flame className="h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-base font-medium">
          Aún no tienes oportunidades
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea tu primera oportunidad para empezar a vender
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Pipeline summary */}
      <div className="flex gap-3 rounded-lg bg-muted/50 p-3">
        <div className="flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total oportunidades</p>
          <p className="text-sm font-bold">{formatCOP(totalPipeline)}</p>
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Ponderado</p>
          <p className="text-sm font-bold text-green-600">{formatCOP(totalPonderado)}</p>
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Activas</p>
          <p className="text-sm font-bold">{activeOps.length}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar oportunidad..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
        />
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setEtapaFilter('activas')}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            etapaFilter === 'activas' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >
          Activas ({activeOps.length})
        </button>
        <button
          onClick={() => setEtapaFilter(null)}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !etapaFilter ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >
          Todas ({oportunidades.length})
        </button>
        {TODAS_ETAPAS.map(e => {
          const config = ETAPA_CONFIG[e]
          const count = oportunidades.filter(o => o.etapa === e).length
          if (count === 0) return null
          return (
            <button
              key={e}
              onClick={() => setEtapaFilter(etapaFilter === e ? null : e)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                etapaFilter === e ? config.chipClass : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
              {config.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {filtered.map(o => {
          const etapaConfig = ETAPA_CONFIG[o.etapa as EtapaPipeline]
          const empresa = o.empresas as { nombre: string } | null
          const contacto = o.contactos as { nombre: string } | null
          const dias = diasSinActividad(o.ultima_accion_fecha ?? o.created_at)
          const stale = dias !== null && dias > 7

          const isActive = ETAPAS_ACTIVAS.includes(o.etapa as EtapaPipeline)
          const nextEtapa = getNextEtapa(o.etapa)

          return (
            <EntityCard
              key={o.id}
              href={`/pipeline/${o.id}`}
              title={o.descripcion || 'Sin descripcion'}
              titlePrefix={o.codigo ? `O ${o.codigo}` : undefined}
              subtitle={[empresa?.nombre, contacto?.nombre].filter(Boolean).join(' · ')}
              value={o.valor_estimado ? formatCOP(o.valor_estimado) : undefined}
              summaryLines={[
                ...(empresa ? [{ icon: <Building2 className="h-3 w-3" />, text: empresa.nombre }] : []),
                ...(contacto ? [{ icon: <User className="h-3 w-3" />, text: contacto.nombre }] : []),
                ...(stale ? [{ icon: <Clock className="h-3 w-3 text-amber-500" />, text: `${dias} días sin actividad` }] : []),
              ]}
              badges={etapaConfig ? [{
                label: etapaConfig.label,
                className: etapaConfig.chipClass,
                ...(isActive ? { onClick: () => cycleEtapa(o.id, o.etapa) } : {}),
              }] : undefined}
              timeAgo={timeAgo(o.created_at)}
              footerContent={isActive ? (
                <div className="flex items-center gap-1.5">
                  {/* Advance to next stage */}
                  {nextEtapa && (
                    <button
                      onClick={() => cycleEtapa(o.id, o.etapa)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                    >
                      {ETAPA_CONFIG[nextEtapa].label}
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                  {/* Won */}
                  <button
                    onClick={() => handleGanar(o.id)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2.5 py-1.5 text-xs font-medium text-green-600 transition-colors hover:bg-green-500/20 disabled:opacity-50 dark:text-green-400"
                  >
                    <Trophy className="h-3 w-3" />
                    Ganada
                  </button>
                  {/* Lost */}
                  <button
                    onClick={() => setLostModal({ id: o.id, name: o.descripcion || 'Sin descripcion' })}
                    disabled={isPending}
                    className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                    Perdida
                  </button>
                </div>
              ) : undefined}
            />
          )
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron oportunidades
          </p>
        )}
      </div>

      {/* Lost Reason Modal */}
      {lostModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
            <h3 className="text-lg font-semibold">¿Por qué se perdió?</h3>
            <p className="mt-1 text-sm text-muted-foreground">{lostModal.name}</p>
            <div className="mt-4 space-y-2">
              {RAZONES_PERDIDA.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelectedReason(r.value)}
                  className={`flex w-full items-center rounded-lg border px-4 py-3 text-sm transition-colors ${
                    selectedReason === r.value
                      ? 'border-destructive bg-destructive/5 font-medium text-destructive'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => { setLostModal(null); setSelectedReason('') }}
                className="flex h-10 flex-1 items-center justify-center rounded-lg border border-input bg-background text-sm font-medium transition-colors hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={handlePerder}
                disabled={!selectedReason || isPending}
                className="flex h-10 flex-1 items-center justify-center rounded-lg bg-destructive text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
