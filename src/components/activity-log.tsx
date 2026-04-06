'use client'

import { useState, useEffect, useTransition, useRef } from 'react'
import {
  MessageSquare, Send, Trash2, Link as LinkIcon, AtSign,
  ArrowRight, X, CheckCircle2, XCircle, Shield, Banknote,
  CheckSquare, FolderOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import { getActivityLog, addComment, deleteActivity } from '@/app/(app)/activity-actions'

interface StaffOption {
  id: string
  full_name: string
}

interface ActivityEntry {
  id: string
  tipo: string
  contenido: string | null
  campo_modificado: string | null
  valor_anterior: string | null
  valor_nuevo: string | null
  link_url: string | null
  created_at: string | null
  autor: { id: string; full_name: string } | null
  mencion: { id: string; full_name: string } | null
}

interface ActivityLogProps {
  entidadTipo: 'oportunidad' | 'proyecto' | 'negocio'
  entidadId: string
  staffList: StaffOption[]
  oportunidadId?: string | null
}

const CAMPO_LABELS: Record<string, string> = {
  etapa: 'Etapa',
  estado: 'Estado',
  responsable: 'Responsable',
  responsable_id: 'Responsable',
  responsable_ejecucion_id: 'Resp. ejecucion',
  avance_porcentaje: 'Avance',
  valor_estimado: 'Valor estimado',
  probabilidad: 'Probabilidad',
  bloque: 'Bloque',
  bloque_datos: 'Datos bloque',
  aprobacion: 'Aprobacion',
  checklist_item: 'Checklist',
  precio_aprobado: 'Precio aprobado',
  carpeta_url: 'Carpeta Drive',
  cobro_confirmado: 'Cobro confirmado',
}

function formatCOP(value: string | null) {
  if (!value) return '--'
  const num = parseFloat(value)
  if (isNaN(num)) return value
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num)
}

function formatFieldChange(campo: string, valorAnterior: string | null, valorNuevo: string | null) {
  const label = CAMPO_LABELS[campo] || campo.replace(/_/g, ' ')
  const from = valorAnterior || '—'
  const to = valorNuevo || '—'
  return { label, from, to }
}

function timeAgo(dateStr: string) {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `hace ${days}d`
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

export default function ActivityLog({ entidadTipo, entidadId, staffList, oportunidadId }: ActivityLogProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  // Form state
  const [content, setContent] = useState('')
  const [mencionId, setMencionId] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [showMention, setShowMention] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    async function load() {
      const data = await getActivityLog(entidadTipo, entidadId, oportunidadId)
      setEntries(data as ActivityEntry[])
      setLoading(false)
    }
    load()
  }, [entidadTipo, entidadId, oportunidadId])

  const handleSubmit = () => {
    if (!content.trim()) return
    startTransition(async () => {
      const res = await addComment(entidadTipo, entidadId, content.trim(), mencionId, linkUrl || null)
      if (res.success) {
        // Reload to get full entry with joins
        const data = await getActivityLog(entidadTipo, entidadId, oportunidadId)
        setEntries(data as ActivityEntry[])
        setContent('')
        setMencionId(null)
        setLinkUrl('')
        setShowMention(false)
        setShowLink(false)
        toast.success('Comentario agregado')
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await deleteActivity(id)
      if (res.success) {
        setEntries(prev => prev.filter(e => e.id !== id))
        toast.success('Comentario eliminado')
      }
    })
  }

  const selectedMencion = staffList.find(s => s.id === mencionId)

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-20 rounded bg-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Compose ── */}
      <div className="space-y-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value.slice(0, 280))}
            placeholder="Escribe un comentario..."
            rows={2}
            className="w-full rounded-lg border bg-background px-3 py-2 pr-10 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={isPending || !content.trim()}
            className="absolute right-2 bottom-2 rounded-md p-1.5 text-primary hover:bg-primary/10 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {/* Char count + action buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setShowMention(!showMention); setShowLink(false) }}
              className={`rounded-md p-1.5 text-xs transition-colors ${
                showMention || mencionId ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'text-muted-foreground hover:bg-accent'
              }`}
              title="Mencionar equipo"
            >
              <AtSign className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { setShowLink(!showLink); setShowMention(false) }}
              className={`rounded-md p-1.5 text-xs transition-colors ${
                showLink || linkUrl ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'text-muted-foreground hover:bg-accent'
              }`}
              title="Agregar enlace"
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <span className={`text-[10px] tabular-nums ${content.length > 260 ? 'text-red-500' : 'text-muted-foreground'}`}>
            {content.length}/280
          </span>
        </div>

        {/* Mention selector */}
        {showMention && (
          <div className="rounded-lg border bg-background p-2 space-y-1">
            {selectedMencion && (
              <div className="flex items-center justify-between rounded-md bg-blue-50 px-2 py-1 dark:bg-blue-900/20">
                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">@{selectedMencion.full_name}</span>
                <button onClick={() => setMencionId(null)} className="text-blue-500 hover:text-blue-700">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {staffList.filter(s => s.id !== mencionId).map(s => (
                <button
                  key={s.id}
                  onClick={() => { setMencionId(s.id); setShowMention(false) }}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
                >
                  {s.full_name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Link input */}
        {showLink && (
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 rounded-md border px-2 py-1.5 text-xs bg-background"
              autoFocus
            />
            {linkUrl && (
              <button onClick={() => { setLinkUrl(''); setShowLink(false) }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground/30" />
          <p className="mt-1 text-xs text-muted-foreground">Sin actividad aun. Agrega el primer comentario.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map(entry => (
            <div key={entry.id}>
              {entry.tipo === 'comentario' ? (
                <CommentEntry entry={entry} onDelete={handleDelete} />
              ) : (
                <ChangeEntry entry={entry} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Comment entry ──

function CommentEntry({ entry, onDelete }: { entry: ActivityEntry; onDelete: (id: string) => void }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {entry.autor && (
            <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              {entry.autor.full_name.split(' ').map(w => w[0]).join('').slice(0, 2)}
            </span>
          )}
          <div className="min-w-0">
            <span className="text-xs font-medium">{entry.autor?.full_name ?? 'Sistema'}</span>
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              {entry.created_at ? timeAgo(entry.created_at) : ''}
            </span>
          </div>
        </div>
        <button
          onClick={() => onDelete(entry.id)}
          className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent transition-opacity"
        >
          <Trash2 className="h-3 w-3 text-red-500" />
        </button>
      </div>

      <p className="mt-1.5 text-sm whitespace-pre-wrap">{entry.contenido}</p>

      {/* Mention badge */}
      {entry.mencion && (
        <span className="mt-1.5 inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          <AtSign className="h-2.5 w-2.5" />
          {entry.mencion.full_name}
        </span>
      )}

      {/* Link */}
      {entry.link_url && (
        <a
          href={entry.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline"
        >
          <LinkIcon className="h-2.5 w-2.5" />
          {(() => {
            try { return new URL(entry.link_url).hostname } catch { return 'Enlace' }
          })()}
        </a>
      )}
    </div>
  )
}

// ── Change entry (system/automatic) ──

function ChangeEntry({ entry }: { entry: ActivityEntry }) {
  const autorName = entry.autor?.full_name
  const timestamp = entry.created_at ? timeAgo(entry.created_at) : ''

  // Cambio de etapa: flecha verde + nombre destino
  if (entry.tipo === 'cambio_etapa') {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
        <ArrowRight className="h-3.5 w-3.5 text-primary/70 shrink-0" />
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {autorName && <span className="font-medium text-foreground">{autorName}</span>}
          <span>avanzo a</span>
          <span className="font-medium text-foreground">{entry.valor_nuevo ?? entry.contenido}</span>
          {entry.contenido && (
            <span className="italic text-muted-foreground/60">({entry.contenido})</span>
          )}
          <span className="text-[10px]">{timestamp}</span>
        </div>
      </div>
    )
  }

  // Cambio de estado: icono diferenciado por tipo
  if (entry.tipo === 'cambio_estado') {
    const valorNuevo = (entry.valor_nuevo ?? '').toLowerCase()
    const isCompletado = valorNuevo === 'completado'
    const isCierre = ['cerrado', 'cancelado', 'perdido'].includes(valorNuevo)

    let Icon = ArrowRight
    let iconClass = 'text-primary/70'
    let labelClass = 'text-foreground'
    let verbo = 'cambio estado a'

    if (isCompletado) {
      Icon = CheckCircle2
      iconClass = 'text-green-500'
      labelClass = 'text-green-600'
    } else if (isCierre) {
      Icon = XCircle
      iconClass = 'text-red-500'
      labelClass = 'text-red-600'
      verbo = 'cerro como'
    }

    // Use contenido as display text if available, else valor_nuevo
    const displayText = entry.contenido || entry.valor_nuevo || '--'

    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {autorName && <span className="font-medium text-foreground">{autorName}</span>}
          <span className={`font-medium ${labelClass}`}>
            {displayText}
          </span>
          <span className="text-[10px]">{timestamp}</span>
        </div>
      </div>
    )
  }

  // tipo === 'cambio' — render segun campo_modificado
  const campo = entry.campo_modificado ?? ''

  // Bloque completado
  if (campo === 'bloque') {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {autorName && <span className="font-medium text-foreground">{autorName}</span>}
          <span>completo</span>
          <span className="font-medium text-foreground">{entry.contenido ?? entry.valor_nuevo ?? 'bloque'}</span>
          <span className="text-[10px]">{timestamp}</span>
        </div>
      </div>
    )
  }

  // Aprobacion de bloque
  if (campo === 'aprobacion') {
    const aprobado = (entry.valor_nuevo ?? '').toLowerCase() === 'aprobado'
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
        <Shield className={`h-3.5 w-3.5 shrink-0 ${aprobado ? 'text-primary' : 'text-red-500'}`} />
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {autorName && <span className="font-medium text-foreground">{autorName}</span>}
          <span className={aprobado ? 'text-primary' : 'text-red-500'}>
            {aprobado ? 'aprobo' : 'rechazo'}
          </span>
          {entry.contenido && <span className="font-medium text-foreground">{entry.contenido}</span>}
          <span className="text-[10px]">{timestamp}</span>
        </div>
      </div>
    )
  }

  // Precio aprobado — formato moneda
  if (campo === 'precio_aprobado') {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
        <Banknote className="h-3.5 w-3.5 text-primary shrink-0" />
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {autorName && <span className="font-medium text-foreground">{autorName}</span>}
          <span>cambio precio</span>
          <span className="inline-flex items-center gap-1">
            <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{formatCOP(entry.valor_anterior)}</span>
            <ArrowRight className="h-2.5 w-2.5" />
            <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium">{formatCOP(entry.valor_nuevo)}</span>
          </span>
          <span className="text-[10px]">{timestamp}</span>
        </div>
      </div>
    )
  }

  // Cobro confirmado
  if (campo === 'cobro_confirmado') {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
        <Banknote className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {autorName && <span className="font-medium text-foreground">{autorName}</span>}
          <span>confirmo pago</span>
          {entry.valor_nuevo && (
            <span className="font-medium text-emerald-600">{formatCOP(entry.valor_nuevo)}</span>
          )}
          {entry.contenido && <span className="text-muted-foreground/70">({entry.contenido})</span>}
          <span className="text-[10px]">{timestamp}</span>
        </div>
      </div>
    )
  }

  // Checklist item
  if (campo === 'checklist_item') {
    const checked = (entry.valor_nuevo ?? '').toLowerCase() === 'true' || entry.valor_nuevo === '1'
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
        <CheckSquare className={`h-3.5 w-3.5 shrink-0 ${checked ? 'text-primary' : 'text-muted-foreground/50'}`} />
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {autorName && <span className="font-medium text-foreground">{autorName}</span>}
          <span>{checked ? 'completo' : 'desmarco'}</span>
          <span className="font-medium text-foreground">{entry.contenido ?? 'item'}</span>
          <span className="text-[10px]">{timestamp}</span>
        </div>
      </div>
    )
  }

  // Carpeta URL — solo indicar que se actualizo
  if (campo === 'carpeta_url') {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {autorName && <span className="font-medium text-foreground">{autorName}</span>}
          <span>actualizo carpeta Drive</span>
          <span className="text-[10px]">{timestamp}</span>
        </div>
      </div>
    )
  }

  // Bloque datos actualizados
  if (campo === 'bloque_datos') {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
        <div className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {autorName && <span className="font-medium text-foreground">{autorName}</span>}
          <span>actualizo datos de bloque</span>
          {entry.contenido && <span className="font-medium text-foreground">{entry.contenido}</span>}
          <span className="text-[10px]">{timestamp}</span>
        </div>
      </div>
    )
  }

  // Default: render generico campo anterior → nuevo
  const { label, from, to } = formatFieldChange(campo, entry.valor_anterior, entry.valor_nuevo)

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
      <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        {autorName && <span className="font-medium text-foreground">{autorName}</span>}
        <span>cambio</span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{from}</span>
          <ArrowRight className="h-2.5 w-2.5" />
          <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{to}</span>
        </span>
        <span className="text-[10px]">{timestamp}</span>
      </div>
    </div>
  )
}
