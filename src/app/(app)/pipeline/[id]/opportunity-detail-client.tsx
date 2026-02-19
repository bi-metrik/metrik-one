'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  Info,
  Plus,
  Building2,
  DollarSign,
  Calendar,
} from 'lucide-react'
import type { Quote } from '@/types/database'
import {
  getEstadoBadgeColor,
  ESTADO_LABELS,
  type EstadoCotizacion,
} from '@/lib/cotizaciones/state-machine'
import CotizacionesList from './cotizaciones/cotizaciones-list'
import NotesSection from '@/components/notes-section'

interface OpportunityDetailClientProps {
  opportunity: {
    id: string
    name: string
    estimated_value: number
    stage: string
    probability: number
    source: string | null
    notes: string | null
    created_at: string | null
    updated_at: string | null
    client_id: string | null
    contact_id: string | null
    clients: {
      id: string
      name: string
      person_type: string | null
      tax_regime: string | null
      gran_contribuyente: boolean
      agente_retenedor: boolean
    } | null
  }
  quotes: Quote[]
  clients: { id: string; name: string }[]
}

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  contact: 'Contacto',
  proposal: 'Propuesta',
  negotiation: 'Negociación',
  won: 'Ganada',
  lost: 'Perdida',
}

const STAGE_COLORS: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  contact: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  proposal: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  negotiation: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  won: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  lost: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

type Tab = 'info' | 'cotizaciones' | 'notas'

export default function OpportunityDetailClient({
  opportunity: opp,
  quotes: initialQuotes,
  clients,
}: OpportunityDetailClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>('cotizaciones')
  const [quotes, setQuotes] = useState(initialQuotes)

  const tabs: { key: Tab; label: string; icon: typeof Info }[] = [
    { key: 'info', label: 'Información', icon: Info },
    { key: 'cotizaciones', label: `Cotizaciones (${quotes.length})`, icon: FileText },
    { key: 'notas', label: 'Notas', icon: MessageSquare },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          href="/pipeline"
          className="mt-1 rounded-lg border p-2 hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold truncate">{opp.name}</h1>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STAGE_COLORS[opp.stage] || STAGE_COLORS.lead}`}>
              {STAGE_LABELS[opp.stage] || opp.stage}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {opp.clients && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" /> {opp.clients.name}
              </span>
            )}
            <span className="flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" /> {fmt(opp.estimated_value)}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" /> {new Date(opp.created_at ?? '').toLocaleDateString('es-CO')}
            </span>
            <span>{opp.probability}% probabilidad</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border p-1">
        {tabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'info' && (
        <div className="space-y-4 rounded-xl border bg-card p-6">
          <h3 className="font-semibold">Información de la oportunidad</h3>
          <div className="space-y-2">
            <InfoRow label="Nombre" value={opp.name} />
            <InfoRow label="Cliente" value={opp.clients?.name || 'Sin cliente'} />
            <InfoRow label="Valor estimado" value={fmt(opp.estimated_value)} />
            <InfoRow label="Etapa" value={STAGE_LABELS[opp.stage] || opp.stage} />
            <InfoRow label="Probabilidad" value={`${opp.probability}%`} />
            <InfoRow label="Fuente" value={opp.source || '—'} />
            <InfoRow label="Creada" value={new Date(opp.created_at ?? '').toLocaleDateString('es-CO')} />
          </div>
          {opp.notes && (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Notas</p>
              <p className="text-sm whitespace-pre-wrap">{opp.notes}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'cotizaciones' && (
        <CotizacionesList
          opportunityId={opp.id}
          quotes={quotes}
          onQuotesChange={setQuotes}
        />
      )}

      {activeTab === 'notas' && (
        <div className="rounded-xl border bg-card p-6">
          <NotesSection entityType="opportunity" entityId={opp.id} />
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
