'use client'

interface MetricCardProps {
  label: string
  value: string | number
  subtitle?: string
  color?: string
}

export default function MetricCard({ label, value, subtitle, color }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className="mt-1 text-2xl font-bold tracking-tight"
        style={color ? { color } : undefined}
      >
        {value}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  )
}
