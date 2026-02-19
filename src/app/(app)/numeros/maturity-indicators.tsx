'use client'

import {
  BarChart3,
  FolderCheck,
  Wallet,
  Users,
  Receipt,
  Lock,
  Check,
} from 'lucide-react'

/**
 * Sprint 12 — D82: Indicadores de madurez
 * Triggers progresivos, NO gates
 *
 * Features unlock based on data maturity:
 * - 5 preguntas completas → comparativo mensual
 * - ≥3 proyectos cerrados → retroalimentación rentabilidad
 * - ≥3 categorías gastos fijos → desviación presupuestal
 * - ≥2 colaboradores WA → métricas campo
 * - ≥3 cobros registrados → tasa conversión pipeline
 */

interface MaturityData {
  questionsComplete: number   // out of 5
  projectsClosed: number
  fixedExpenseCategories: number
  waCollaborators: number
  invoicesRegistered: number
}

interface MaturityIndicatorsProps {
  data: MaturityData
}

const INDICATORS = [
  {
    key: 'comparativo',
    label: 'Comparativo mensual',
    description: 'Tendencias mes a mes de tus indicadores clave',
    icon: BarChart3,
    test: (d: MaturityData) => d.questionsComplete >= 5,
    progress: (d: MaturityData) => `${d.questionsComplete}/5 preguntas`,
    threshold: 5,
    getValue: (d: MaturityData) => d.questionsComplete,
  },
  {
    key: 'retroalimentacion',
    label: 'Retroalimentación rentabilidad',
    description: 'Feedback automático al cerrar proyectos',
    icon: FolderCheck,
    test: (d: MaturityData) => d.projectsClosed >= 3,
    progress: (d: MaturityData) => `${d.projectsClosed}/3 proyectos cerrados`,
    threshold: 3,
    getValue: (d: MaturityData) => d.projectsClosed,
  },
  {
    key: 'desviacion',
    label: 'Desviación presupuestal',
    description: 'Compara gastos reales vs presupuestados',
    icon: Wallet,
    test: (d: MaturityData) => d.fixedExpenseCategories >= 3,
    progress: (d: MaturityData) => `${d.fixedExpenseCategories}/3 categorías de gastos fijos`,
    threshold: 3,
    getValue: (d: MaturityData) => d.fixedExpenseCategories,
  },
  {
    key: 'campo',
    label: 'Métricas de campo',
    description: 'Datos de colaboradores vía WhatsApp',
    icon: Users,
    test: (d: MaturityData) => d.waCollaborators >= 2,
    progress: (d: MaturityData) => `${d.waCollaborators}/2 colaboradores WA`,
    threshold: 2,
    getValue: (d: MaturityData) => d.waCollaborators,
  },
  {
    key: 'conversion',
    label: 'Tasa de conversión pipeline',
    description: 'Cuántas oportunidades se convierten en proyectos',
    icon: Receipt,
    test: (d: MaturityData) => d.invoicesRegistered >= 3,
    progress: (d: MaturityData) => `${d.invoicesRegistered}/3 cobros registrados`,
    threshold: 3,
    getValue: (d: MaturityData) => d.invoicesRegistered,
  },
]

export default function MaturityIndicators({ data }: MaturityIndicatorsProps) {
  const unlockedCount = INDICATORS.filter(i => i.test(data)).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Madurez de tus datos</h3>
          <p className="text-xs text-muted-foreground">
            {unlockedCount}/{INDICATORS.length} features desbloqueadas
          </p>
        </div>
        {/* Progress bar */}
        <div className="flex gap-1">
          {INDICATORS.map((ind) => (
            <div
              key={ind.key}
              className={`h-2 w-6 rounded-full ${
                ind.test(data) ? 'bg-green-500' : 'bg-muted-foreground/20'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {INDICATORS.map((ind) => {
          const unlocked = ind.test(data)
          const Icon = ind.icon
          const currentValue = ind.getValue(data)
          const progressPct = Math.min(100, (currentValue / ind.threshold) * 100)

          return (
            <div
              key={ind.key}
              className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                unlocked ? 'border-green-200 bg-green-50/50 dark:border-green-900/30 dark:bg-green-950/10' : ''
              }`}
            >
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                unlocked
                  ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {unlocked ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${unlocked ? '' : 'text-muted-foreground'}`}>
                  {ind.label}
                </p>
                <p className="text-xs text-muted-foreground">{ind.description}</p>
                {!unlocked && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted-foreground/10">
                      <div
                        className="h-full rounded-full bg-primary/50 transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{ind.progress(data)}</span>
                  </div>
                )}
              </div>
              {!unlocked && <Lock className="h-3.5 w-3.5 text-muted-foreground/40" />}
            </div>
          )
        })}
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        D82: Estos indicadores son triggers, no bloqueos. Tu app funciona igual sin ellos.
      </p>
    </div>
  )
}
