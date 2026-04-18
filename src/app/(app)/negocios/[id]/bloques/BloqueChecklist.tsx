'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { CheckSquare, Square, ExternalLink } from 'lucide-react'
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
  modo,
  itemTemplates = [],
  initialItems = [],
  withSupport = false,
}: BloqueChecklistProps) {
  const [items, setItems] = useState<BloqueItem[]>(initialItems)
  const [isPending, startTransition] = useTransition()
  const [initializing, setInitializing] = useState(false)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

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

  // ── Checklist normal: toggle manual ──
  function handleToggle(item: BloqueItem) {
    if (item.id.startsWith('_tmp_') || withSupport) return
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
        const nowAllComplete = nextItems.every(i => i.completado)
        if (nowAllComplete && negocioBloqueId) {
          await marcarBloqueCompleto(negocioBloqueId, { completado_via: 'checklist' })
        }
      }
    })
  }

  // ── withSupport: pegar link → auto-save + auto-check ──
  function handleLinkInput(itemId: string, url: string) {
    // Actualizar UI inmediatamente
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, link_url: url } : i))

    // Debounce auto-save
    if (saveTimers.current[itemId]) clearTimeout(saveTimers.current[itemId])
    saveTimers.current[itemId] = setTimeout(() => {
      if (!url.trim()) return
      startTransition(async () => {
        const result = await marcarBloqueItem(itemId, true, url.trim())
        if (result.error) {
          toast.error(result.error)
        } else {
          const nextItems = items.map(i =>
            i.id === itemId
              ? { ...i, link_url: url.trim(), completado: true, completado_at: new Date().toISOString() }
              : i
          )
          setItems(nextItems)
          const nowAllComplete = nextItems.every(i => i.completado && i.link_url)
          if (nowAllComplete && negocioBloqueId) {
            await marcarBloqueCompleto(negocioBloqueId, { completado_via: 'checklist' })
          }
        }
      })
    }, 600)
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
      {items.map(item => {
        const hasLink = !!(item.link_url?.trim())

        return (
          <div key={item.id} className="rounded-lg border border-[#E5E7EB] p-2.5">
            <div className="flex items-start gap-2">
              {/* Icono: check automático si tiene link (withSupport) o manual */}
              <div className="mt-0.5 shrink-0">
                {withSupport ? (
                  hasLink ? (
                    <CheckSquare className="h-4 w-4 text-[#10B981]" />
                  ) : (
                    <Square className="h-4 w-4 text-[#6B7280]/40" />
                  )
                ) : (
                  <button
                    onClick={() => handleToggle(item)}
                    disabled={isPending || modo === 'visible' || item.id.startsWith('_tmp_')}
                    className="disabled:cursor-default"
                  >
                    {item.completado ? (
                      <CheckSquare className="h-4 w-4 text-[#10B981]" />
                    ) : (
                      <Square className="h-4 w-4 text-[#6B7280]/40" />
                    )}
                  </button>
                )}
              </div>

              <div className="flex-1 min-w-0">
                {/* Label */}
                <p className={`text-xs ${(withSupport ? hasLink : item.completado) ? 'text-[#6B7280]' : 'text-[#1A1A1A]'}`}>
                  {item.label}
                </p>

                {/* withSupport: input o hipervínculo según estado */}
                {withSupport && modo === 'editable' && !item.id.startsWith('_tmp_') && (
                  hasLink ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <a
                        href={item.link_url!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-[#10B981] underline underline-offset-2 truncate"
                      >
                        {item.link_url}
                      </a>
                      <button
                        onClick={() => {
                          setItems(prev => prev.map(i => i.id === item.id ? { ...i, link_url: '', completado: false } : i))
                        }}
                        className="shrink-0 text-[10px] text-[#6B7280] hover:text-red-500"
                        title="Cambiar link"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <input
                      type="url"
                      placeholder="Pega el link de Google Drive..."
                      value={item.link_url ?? ''}
                      onChange={e => handleLinkInput(item.id, e.target.value)}
                      onPaste={e => {
                        // Capturar paste para guardado inmediato
                        const pasted = e.clipboardData.getData('text')
                        if (pasted.trim()) {
                          e.preventDefault()
                          handleLinkInput(item.id, pasted.trim())
                        }
                      }}
                      disabled={isPending}
                      className="mt-1 w-full rounded border border-[#E5E7EB] px-2 py-1 text-[11px] placeholder:text-[#6B7280]/50 focus:border-[#10B981] focus:outline-none disabled:opacity-60"
                    />
                  )
                )}

                {/* withSupport: modo visible — hipervínculo */}
                {withSupport && modo === 'visible' && hasLink && (
                  <a
                    href={item.link_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#10B981] underline underline-offset-2"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Ver documento
                  </a>
                )}

                {/* Fecha de completado (solo checklist normal) */}
                {!withSupport && item.completado && item.completado_at && (
                  <p className="text-[10px] text-[#6B7280]">{fmtDate(item.completado_at)}</p>
                )}
              </div>
            </div>
          </div>
        )
      })}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-[#6B7280]">
          {items.filter(i => withSupport ? !!(i.link_url?.trim()) : i.completado).length}/{items.length} completados
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
