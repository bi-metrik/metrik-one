'use client'

import { useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import MetricCard from './metric-card'
import { TrendChart, FunnelChart, TopFeaturesChart } from './charts'
import type { MiBolsilloMetrics } from '@/types/mibolsillo'
import { getMiBolsilloMetrics } from './actions'

interface Props {
  initialData: MiBolsilloMetrics
}

function formatCOP(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

export default function MiBolsilloClient({ initialData }: Props) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  const refresh = () => {
    startTransition(async () => {
      const fresh = await getMiBolsilloMetrics()
      if (fresh) setData(fresh)
    })
  }

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Mi Bolsillo — Admin</h1>
          <p className="text-xs text-muted-foreground">Dashboard de metricas en tiempo real</p>
        </div>
        <button
          onClick={refresh}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* ── Usuarios ── */}
      <Section title="Usuarios">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Total usuarios" value={data.totalUsers} />
          <MetricCard label="Nuevos hoy" value={data.newUsersToday} color="#10B981" />
          <MetricCard label="Nuevos esta semana" value={data.newUsersWeek} />
          <MetricCard label="Onboarding completado" value={pct(data.onboardingRate)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(['free', 'personal', 'mi_negocio', 'mi_negocio_plus'] as const).map(plan => (
            <MetricCard
              key={plan}
              label={plan.replace(/_/g, ' ')}
              value={data.usersByPlan[plan] ?? 0}
              subtitle={data.totalUsers > 0 ? pct((data.usersByPlan[plan] ?? 0) / data.totalUsers) : '0%'}
            />
          ))}
        </div>
        <div className="mt-3">
          <TrendChart data={data.dailySignups} label="Registros diarios (14d)" />
        </div>
      </Section>

      {/* ── Revenue ── */}
      <Section title="Revenue">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="MRR total" value={formatCOP(data.mrrTotal)} color="#10B981" />
          <MetricCard label="Suscripciones activas" value={data.activeSubscriptions} />
          <MetricCard label="ARPU" value={formatCOP(data.arpu)} />
          <MetricCard label="MRR Personal" value={formatCOP(data.mrrByPlan['personal'] ?? 0)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-2">
          <MetricCard label="MRR Mi Negocio" value={formatCOP(data.mrrByPlan['mi_negocio'] ?? 0)} />
          <MetricCard label="MRR Plus" value={formatCOP(data.mrrByPlan['mi_negocio_plus'] ?? 0)} />
        </div>
      </Section>

      {/* ── Engagement ── */}
      <Section title="Engagement">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Mensajes hoy" value={data.messagesToday} />
          <MetricCard label="Mensajes semana" value={data.messagesWeek} />
          <MetricCard label="Transacciones hoy" value={data.transactionsToday} />
          <MetricCard label="Transacciones semana" value={data.transactionsWeek} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TrendChart data={data.dailyMessages} label="Mensajes diarios (14d)" color="#60A5FA" />
          <TrendChart data={data.dailyTransactions} label="Transacciones diarias (14d)" color="#F59E0B" />
        </div>
        <div className="mt-3">
          <TopFeaturesChart data={data.topFeatures} />
        </div>
      </Section>

      {/* ── Retencion ── */}
      <Section title="Retencion">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <MetricCard label="DAU" value={data.dau} />
          <MetricCard label="WAU" value={data.wau} />
          <MetricCard label="MAU" value={data.mau} />
          <MetricCard
            label="Inactivos >7d"
            value={data.inactiveOver7d}
            color={data.inactiveOver7d > data.totalUsers * 0.3 ? '#EF4444' : undefined}
          />
          <MetricCard
            label="Churn >30d"
            value={data.churnOver30d}
            color={data.churnOver30d > 0 ? '#EF4444' : '#10B981'}
          />
        </div>
        {data.totalUsers > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard label="DAU/MAU" value={data.mau > 0 ? pct(data.dau / data.mau) : '—'} subtitle="Stickiness" />
            <MetricCard label="WAU/MAU" value={data.mau > 0 ? pct(data.wau / data.mau) : '—'} />
            <MetricCard label="Tasa retencion 30d" value={pct(1 - (data.churnOver30d / data.totalUsers))} />
          </div>
        )}
      </Section>

      {/* ── Funnel ── */}
      <Section title="Funnel">
        <FunnelChart data={data.funnel} />
        <div className="mt-3 grid grid-cols-3 gap-3">
          {data.funnel.length >= 2 && (
            <MetricCard
              label="Free → Personal"
              value={data.funnel[0].count > 0 ? pct(data.funnel[1].count / data.funnel[0].count) : '—'}
              subtitle="Conversion"
            />
          )}
          {data.funnel.length >= 3 && (
            <MetricCard
              label="Personal → Mi Negocio"
              value={data.funnel[1].count > 0 ? pct(data.funnel[2].count / data.funnel[1].count) : '—'}
              subtitle="Conversion"
            />
          )}
          {data.funnel.length >= 4 && (
            <MetricCard
              label="Mi Negocio → Plus"
              value={data.funnel[2].count > 0 ? pct(data.funnel[3].count / data.funnel[2].count) : '—'}
              subtitle="Conversion"
            />
          )}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}
