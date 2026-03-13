'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

const GREEN = '#10B981'
const GREEN_LIGHT = '#D1FAE5'
const GRAY = '#6B7280'

interface TrendChartProps {
  data: { date: string; count: number }[]
  color?: string
  label: string
}

export function TrendChart({ data, color = GREEN, label }: TrendChartProps) {
  const formatted = data.map(d => ({
    ...d,
    label: d.date.slice(5), // MM-DD
  }))

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-xs font-medium text-muted-foreground">{label}</p>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={formatted}>
          <defs>
            <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: GRAY }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: GRAY }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' }}
            labelStyle={{ color: '#1A1A1A', fontWeight: 600 }}
          />
          <Area type="monotone" dataKey="count" stroke={color} fill={`url(#grad-${label})`} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

interface FunnelChartProps {
  data: { plan: string; count: number; pct: number }[]
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  personal: 'Personal',
  mi_negocio: 'Mi Negocio',
  mi_negocio_plus: 'Plus',
}

const PLAN_COLORS: Record<string, string> = {
  free: '#9CA3AF',
  personal: '#60A5FA',
  mi_negocio: GREEN,
  mi_negocio_plus: '#8B5CF6',
}

export function FunnelChart({ data }: FunnelChartProps) {
  const formatted = data.map(d => ({
    ...d,
    label: PLAN_LABELS[d.plan] ?? d.plan,
    fill: PLAN_COLORS[d.plan] ?? GREEN,
  }))

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-xs font-medium text-muted-foreground">Funnel de planes</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={formatted} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: GRAY }} tickLine={false} axisLine={false} />
          <YAxis dataKey="label" type="category" tick={{ fontSize: 11, fill: '#1A1A1A' }} tickLine={false} axisLine={false} width={80} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any, _name: any, props: any) => [`${value} (${props?.payload?.pct?.toFixed(1) ?? 0}%)`, 'Usuarios']}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {formatted.map((entry, i) => (
              <rect key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

interface TopFeaturesProps {
  data: { feature: string; count: number }[]
}

export function TopFeaturesChart({ data }: TopFeaturesProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">Features mas usados</p>
        <p className="mt-4 text-sm text-muted-foreground">Sin datos</p>
      </div>
    )
  }

  const max = data[0]?.count ?? 1

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-xs font-medium text-muted-foreground">Features mas usados</p>
      <div className="space-y-2">
        {data.map(d => (
          <div key={d.feature} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-xs text-foreground">{d.feature}</span>
            <div className="flex-1 h-4 rounded bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded"
                style={{
                  width: `${(d.count / max) * 100}%`,
                  backgroundColor: GREEN_LIGHT,
                  borderRight: `2px solid ${GREEN}`,
                }}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground w-8 text-right">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
