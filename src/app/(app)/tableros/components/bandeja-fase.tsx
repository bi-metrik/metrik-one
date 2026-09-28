'use client'

import type { Bandeja, NumeroContexto } from '@/lib/tableros/bandejas'
import { StatHero } from './stat-hero'
import { AlertCard } from './alert-card'

/**
 * Una bandeja operativa: hasta tres numeros de contexto y debajo la lista de pendientes.
 *
 * Arma lo que ya existia en Tableros (StatHero + AlertCard) en vez de un componente
 * nuevo. Mobile first: los tres numeros caben en una fila de 360 px y cada pendiente
 * trae su boton a todo el ancho. Bandeja vacia = la tarjeta verde de AlertCard.
 */
export function BandejaFase({ bandeja, titulo }: { bandeja: Bandeja; titulo: string }) {
  const n = bandeja.filas.length
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 rounded-2xl border border-gray-100 bg-white p-4 sm:p-6">
        {bandeja.contexto.slice(0, 3).map((c) => (
          <StatHero key={c.etiqueta} label={c.etiqueta} value={c.texto ?? formatear(c)} note={c.nota} compact muted={Boolean(c.texto)} />
        ))}
      </div>
      <AlertCard
        title={n === 0 ? titulo : `${titulo} (${n})`}
        emptyMessage={bandeja.vacia}
        items={bandeja.filas.map((f) => ({
          label: f.titulo,
          detail: f.detalle,
          href: f.href,
          action: f.accion,
          badges: [],
        }))}
      />
    </div>
  )
}

function formatear(c: NumeroContexto): string {
  if (c.valor == null) return '—'
  if (c.formato === 'pct') return `${Math.round(c.valor)}%`
  if (c.formato === 'entero') return String(c.valor)
  const v = c.valor
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })}M`
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000).toLocaleString('es-CO')}K`
  return `$${Math.round(v).toLocaleString('es-CO')}`
}
