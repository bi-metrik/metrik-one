'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'

interface AlertItem {
  label: string
  badges: Array<{ text: string; variant: 'red' | 'yellow' | 'blue' }>
  /** Segunda linea bajo el titulo (modo bandeja). */
  detail?: string
  /**
   * Con `href` y `action` la fila pasa a ser una fila de bandeja: UN boton que lleva al
   * negocio, la cuota o el gasto exacto. Sin ellos, la fila se pinta como siempre.
   */
  href?: string
  action?: string
}

interface AlertCardProps {
  title: string
  items: AlertItem[]
  emptyMessage?: string
}

const BADGE_STYLES = {
  red: 'bg-red-50 text-red-700',
  yellow: 'bg-amber-50 text-amber-700',
  blue: 'bg-blue-50 text-blue-700',
}

export function AlertCard({ title, items, emptyMessage }: AlertCardProps) {
  if (items.length === 0) {
    if (!emptyMessage) return null
    return (
      <div className="rounded-2xl border border-green-100 bg-green-50/50 p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          <h3 className="text-sm font-semibold text-green-700">{title}</h3>
        </div>
        <p className="text-sm text-green-700 mt-2 ml-6">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-red-100 bg-red-50/50 p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-4 w-4 text-red-500" />
        <h3 className="text-sm font-semibold text-red-700">{title}</h3>
      </div>
      <div className="space-y-3">
        {items.map((item, i) =>
          item.href && item.action ? (
            <FilaAccion key={i} item={item as AlertItem & { href: string; action: string }} />
          ) : (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-gray-900 truncate">{item.label}</span>
              <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                {item.badges.map((b, j) => (
                  <span key={j} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${BADGE_STYLES[b.variant]}`}>
                    {b.text}
                  </span>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

/**
 * Fila de bandeja. En celular se apila (texto arriba, boton a todo el ancho abajo) para
 * que el boton se toque con el pulgar; desde `sm` queda en una sola linea.
 */
function FilaAccion({ item }: { item: AlertItem & { href: string; action: string } }) {
  return (
    <div className="rounded-xl bg-white border border-gray-100 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{item.label}</span>
          {item.badges.map((b, j) => (
            <span key={j} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${BADGE_STYLES[b.variant]}`}>
              {b.text}
            </span>
          ))}
        </div>
        {item.detail && <p className="text-xs text-gray-500 mt-0.5">{item.detail}</p>}
      </div>
      <Link
        href={item.href}
        className="inline-flex items-center justify-center gap-1 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-700 shrink-0 w-full sm:w-auto"
      >
        {item.action}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  )
}
