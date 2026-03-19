'use client'

import { CreditCard, Check, MessageCircle, Users } from 'lucide-react'
import type { WorkspaceFeature } from '@/types/database'
import { PRICING, FEATURE_CATALOG } from '@/lib/pricing'

interface Props {
  licenseUsed: number
  licenseMax: number
  workspaceFeatures: WorkspaceFeature[]
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function PlanSection({ licenseUsed, licenseMax, workspaceFeatures }: Props) {
  const activeFeatures = workspaceFeatures.filter(f => f.is_active)
  const extraUsers = Math.max(0, licenseMax - 1)
  const featuresTotal = activeFeatures.reduce((sum, f) => sum + (f.price_cop ?? 0), 0)
  const monthlyTotal = PRICING.BASE_LICENSE_COP + (extraUsers * PRICING.EXTRA_USER_COP) + featuresTotal

  const usagePct = licenseMax > 0 ? Math.round((licenseUsed / licenseMax) * 100) : 0
  const barColor = usagePct >= 100 ? 'bg-red-500' : usagePct >= 80 ? 'bg-amber-500' : 'bg-primary'

  const waLink = `https://wa.me/573159509103?text=${encodeURIComponent('Hola, quiero ajustar mi plan en MéTRIK ONE')}`

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Mi Plan</h3>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-semibold text-primary">
          MéTRIK ONE
        </span>
      </div>

      {/* Licencias */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="h-4 w-4" /> Licencias
          </span>
          <span className="font-medium">
            {licenseUsed} de {licenseMax} usada{licenseMax !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className={`h-2 rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(usagePct, 100)}%` }}
          />
        </div>
      </div>

      {/* Features activas */}
      {activeFeatures.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add-ons activos</p>
          <div className="space-y-1.5">
            {activeFeatures.map(f => {
              const info = FEATURE_CATALOG[f.feature_key]
              return (
                <div key={f.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{info?.label || f.feature_key}</p>
                      {info?.description && (
                        <p className="text-[10px] text-muted-foreground">{info.description}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium shrink-0">{fmt(f.price_cop)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Desglose mensual */}
      <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Resumen mensual</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Licencia base (1 usuario)</span>
            <span>{fmt(PRICING.BASE_LICENSE_COP)}</span>
          </div>
          {extraUsers > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{extraUsers} usuario{extraUsers !== 1 ? 's' : ''} adicional{extraUsers !== 1 ? 'es' : ''}</span>
              <span>{fmt(extraUsers * PRICING.EXTRA_USER_COP)}</span>
            </div>
          )}
          {activeFeatures.map(f => (
            <div key={f.id} className="flex justify-between">
              <span className="text-muted-foreground">{FEATURE_CATALOG[f.feature_key]?.label || f.feature_key}</span>
              <span>{fmt(f.price_cop)}</span>
            </div>
          ))}
          <div className="border-t pt-2 mt-2 flex justify-between font-semibold">
            <span>Total mensual</span>
            <span className="text-primary">{fmt(monthlyTotal)}</span>
          </div>
        </div>
      </div>

      {/* CTA */}
      <a
        href={waLink}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/20 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 transition-colors"
      >
        <MessageCircle className="h-4 w-4" />
        Ajustar mi plan
      </a>
    </div>
  )
}
