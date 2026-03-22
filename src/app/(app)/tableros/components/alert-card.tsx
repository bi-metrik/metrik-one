'use client'

import { AlertTriangle } from 'lucide-react'

interface AlertCardProps {
  title: string
  items: Array<{
    label: string
    badges: Array<{ text: string; variant: 'red' | 'yellow' }>
  }>
}

const BADGE_STYLES = {
  red: 'bg-red-50 text-red-700',
  yellow: 'bg-amber-50 text-amber-700',
}

export function AlertCard({ title, items }: AlertCardProps) {
  if (items.length === 0) return null

  return (
    <div className="rounded-2xl border border-red-100 bg-red-50/50 p-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-4 w-4 text-red-500" />
        <h3 className="text-sm font-semibold text-red-700">{title}</h3>
      </div>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">{item.label}</span>
            <div className="flex gap-2">
              {item.badges.map((b, j) => (
                <span key={j} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${BADGE_STYLES[b.variant]}`}>
                  {b.text}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
