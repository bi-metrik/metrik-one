'use client'

import { useState, useTransition, useEffect } from 'react'
import { CheckSquare, Square } from 'lucide-react'
import { toast } from 'sonner'
import { marcarBloqueItem, marcarBloqueCompleto, inicializarBloqueItems } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface ChecklistItemTemplate {
  label: string
  tipo: string
}

interface BloqueItem {
  id: string
  label: string
  completado: boolean
  completado_por: string | null
  completado_at: string | null
  link_url?: string | null
}

interface BloqueChecklistProps {
  negocioId: string
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  itemTemplates?: ChecklistItemTemplate[]
  initialItems?: BloqueItem[]
  withSupport?: boolean
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function BloqueChecklist({
  negocioBloqueId,
  instancia,
  modo,
  itemTemplates = [],
  initialItems = [],
  withSupport = false,
}: BloqueChecklistProps) {
  const [items, setItems] = useState<BloqueItem[]>(initialItems)
  const [linkValues, setLinkValues] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()
  const [initializing, setInitializing] = useState(false)

  useEffect(() => {
    if (initialItems.length > 0) setItems(initialItems)
  }, [initialItems.length])

  // Inicializar items desde templates si no existen en DB
  useEffect(() => {
    if (initialItems.length === 0 && itemTemplates.length > 0 && negocioBloqueId) {
      setInitializing(true)
      inicializarBloqueItems(negocioBloqueId, itemTemplates).then(result => {
        setInitializing(false)
        if (result.error) {
          toast.error('Error inicializando checklist: ' + result.error)
        } else {
          setItems(result.items)
        }
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allComplete = items.length > 0 && items.every(i => {
    if (withSupport) return i.completado && i.link_url
    return i.completado
  })

  function handleToggle(item: BloqueItem) {
    if (item.id.startsWith('_tmp_')) return
    const newCompleted = !item.completado
    startTransition(async () => {
      const result = await marcarBloqueItem(item.id, newCompleted)
      if (result.error) {
        toast.error(result.error)
      } else {
        const nextItems = items.map(i =>
          i.id === item.id
            ? { ...i, completado: newCompleted, completado_at: newCompleted ? new Date().toISOString() : null }
            : i
        )
        setItems(nextItems)
        // Verificar si ahora todos están completos
        const nowAllComplete = nextItems.every(i => {
          if (withSupport) return i.completado && i.link_url
          return i.completado
        })
        if (nowAllComplete && negocioBloqueId) {
          await marcarBloqueCompleto(negocioBloqueId, { completado_via: 'checklist' })
        }
      }
    })
  }

  function handleLinkChange(itemId: string, url: string) {
    setLinkValues(prev => ({ ...prev, [itemId]: url }))
  }

  function handleLinkSave(item: BloqueItem) {
    const url = linkValues[item.id] ?? item.link_url ?? ''
    if (!url.trim()) return
    startTransition(async () => {
      // Auto-marcar como completado al guardar link (sin fricción)
      const result = await marcarBloqueItem(item.id, true, url)
      if (result.error) toast.error(result.error)
      else {
        const nextItems = items.map(i => i.id === item.id ? { ...i, link_url: url, completado: true, completado_at: new Date().toISOString() } : i)
        setItems(nextItems)
        // Verificar si ahora todos están completos
        const nowAllComplete = nextItems.every(i => i.completado && i.link_url)
        if (nowAllComplete && negocioBloqueId) {
          await marcarBloqueCompleto(negocioBloqueId, { completado_via: 'checklist' })
        }
      }
    })
  }

  if (initializing) {
    return <p className="text-xs text-[#6B7280]">Cargando checklist...</p>
  }

  if (items.length === 0) {
    return (
      <p className="text-xs text-[#6B7280]">
        Sin ítems configurados. MéTRIK los configura via{' '}
        <code className="rounded bg-slate-100 px-1 text-[10px]">/configure-gates</code>
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.id} className="rounded-lg border border-[#E5E7EB] p-2.5">
          <div className="flex items-start gap-2">
            <button
              onClick={() => handleToggle(item)}
              disabled={isPending || modo === 'visible' || item.id.startsWith('_tmp_')}
              className="mt-0.5 shrink-0 disabled:cursor-default"
            >
              {item.completado ? (
                <CheckSquare className="h-4 w-4 text-[#10B981]" />
              ) : (
                <Square className="h-4 w-4 text-[#6B7280]/40" />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <p className={`text-xs ${item.completado ? 'text-[#6B7280] line-through' : 'text-[#1A1A1A]'}`}>
                {item.label}
              </p>
              {item.completado && item.completado_at && (
                <p className="text-[10px] text-[#6B7280]">{fmtDate(item.completado_at)}</p>
              )}
              {withSupport && modo === 'editable' && !item.id.startsWith('_tmp_') && (
                <div className="mt-1.5 flex items-center gap-1">
                  <input
                    type="url"
                    placeholder="URL del soporte..."
                    value={linkValues[item.id] ?? item.link_url ?? ''}
                    onChange={e => handleLinkChange(item.id, e.target.value)}
                    className="flex-1 rounded border border-[#E5E7EB] px-2 py-1 text-[11px] focus:border-[#10B981] focus:outline-none"
                  />
                  <button
                    onClick={() => handleLinkSave(item)}
                    disabled={isPending}
                    className="rounded bg-[#10B981]/10 px-2 py-1 text-[11px] font-medium text-[#10B981] hover:bg-[#10B981]/20 disabled:opacity-60"
                  >
                    Guardar
                  </button>
                </div>
              )}
              {withSupport && item.link_url && modo === 'visible' && (
                <a
                  href={item.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-[11px] text-[#10B981] underline underline-offset-2"
                >
                  Ver soporte
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-[#6B7280]">
          {items.filter(i => i.completado).length}/{items.length} completados
        </span>
        {allComplete && (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
            ¡Listo!
          </span>
        )}
      </div>
    </div>
  )
}
