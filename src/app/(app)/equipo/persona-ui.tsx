'use client'

import { Trophy } from 'lucide-react'

/**
 * Piezas de presentacion de la hoja por persona de `/equipo`.
 *
 * Se extrajeron de `equipo-comercial-personas-client.tsx` SIN cambiar una sola
 * clase ni un solo pixel: son exactamente las mismas que ya usa el equipo
 * comercial en produccion. La razon de sacarlas es que otro modulo necesita la
 * misma tarjeta de persona con otros datos, y duplicar el marcado habria dejado
 * dos tarjetas que se parecen hasta que alguien toca una.
 *
 * Lo que se comparte es la PRESENTACION. Los datos no: cada modulo trae los
 * suyos y arma la tarjeta con estas piezas.
 */

export const GREEN = '#059669'
export const GOLD = '#D97706'

/** "JUAN PEREZ" → "Juan Perez". */
export function nombreCorto(s: string): string {
  return s.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}

/** "Juan Perez" → "JP". Avatar sin foto. */
export function iniciales(s: string): string {
  const p = s.split(' ').filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()
}

export function RankBadge({ rank, total }: { rank: number; total: number }) {
  if (!rank) return null
  const esPrimero = rank === 1
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold"
      style={{
        backgroundColor: esPrimero ? '#FEF3C7' : '#F3F4F6',
        color: esPrimero ? GOLD : '#6B7280',
      }}
      title={`Posicion ${rank} de ${total} en ventas`}
    >
      {esPrimero && <Trophy className="h-3 w-3" />}
      #{rank} de {total}
    </span>
  )
}

export function Mini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-gray-900" style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  )
}

export function RankRow({
  label,
  value,
  rank,
  total,
  strong,
}: {
  label: string
  value: string
  rank: number
  total: number
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`tabular-nums whitespace-nowrap text-sm ${strong ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>
          {value}
        </span>
        {rank > 0 && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 tabular-nums" title={`Posicion ${rank} de ${total}`}>
            #{rank}
          </span>
        )}
      </div>
    </div>
  )
}
