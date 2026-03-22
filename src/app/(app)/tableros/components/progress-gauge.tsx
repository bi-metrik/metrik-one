'use client'

interface ProgressGaugeProps {
  label: string
  value: number    // 0-100+
  size?: 'sm' | 'md'
}

function getColor(pct: number): string {
  if (pct <= 70) return '#10B981'  // green
  if (pct <= 90) return '#F59E0B'  // yellow
  return '#EF4444'                  // red
}

function getBg(pct: number): string {
  if (pct <= 70) return '#D1FAE5'
  if (pct <= 90) return '#FEF3C7'
  return '#FEE2E2'
}

export function ProgressGauge({ label, value, size = 'md' }: ProgressGaugeProps) {
  const color = getColor(value)
  const bg = getBg(value)
  const capped = Math.min(value, 100)

  return (
    <div className={size === 'sm' ? '' : 'min-w-[140px]'}>
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value.toFixed(0)}%</p>
      <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ backgroundColor: bg }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${capped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
