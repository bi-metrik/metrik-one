'use client'

import { useState, useEffect, useTransition } from 'react'
import { ChevronRight, Briefcase, Palette, Package, Receipt, Landmark, UsersRound, Target, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { ExpenseCategory, FixedExpense, FiscalProfile, Staff, BankAccount, MonthlyTarget, Servicio } from '@/types/database'

// Existing config sections — reused via import
import WizardFelipe from '../config/wizard-felipe'
import StaffSection from '../config/staff-section'
import BankAccountsSection from '../config/bank-accounts-section'
import MonthlyTargetsSection from '../config/monthly-targets-section'
import ServiciosSection from '../config/servicios-section'

// Actions
import { updateMargenEstimado } from './actions'

// New sections
import PerfilFiscalExtended from './perfil-fiscal-extended'
import MarcaSection from './marca-section'
import GastosFijosSection from './gastos-fijos-section'
import EquipoSection from './equipo-section'

// ── Types ──────────────────────────────────────────

type FixedExpenseWithCategory = FixedExpense & { categoryName: string | null }

interface MiNegocioClientProps {
  workspace: any
  fiscalProfile: FiscalProfile | null
  staffMembers: Staff[]
  bankAccounts: BankAccount[]
  monthlyTargets: MonthlyTarget[]
  fixedExpenses: FixedExpenseWithCategory[]
  categories: ExpenseCategory[]
  servicios: Servicio[]
  staffNomina: { nombre: string; salario: number }[]
  configFinanciera: { margen_contribucion_estimado: number | null; margen_fuente: string | null; n_proyectos_margen: number | null } | null
  progressPct: number
  currentUserRole: string
  sectionScores: {
    fiscal: number
    marca: number
    servicios: number
    gastos: number
    banco: number
    equipo: number
    metas: number
  }
}

// ── Section definitions ──────────────────────────────

interface SectionDef {
  key: string
  label: string
  icon: React.ElementType
  maxScore: number
  scoreKey: keyof MiNegocioClientProps['sectionScores']
}

const CHAPTERS: { title: string; emoji: string; sections: SectionDef[] }[] = [
  {
    title: 'Tu Identidad',
    emoji: '1',
    sections: [
      { key: 'perfil-fiscal', label: 'Mi perfil fiscal', icon: Briefcase, maxScore: 3, scoreKey: 'fiscal' },
      { key: 'mi-marca', label: 'Mi marca', icon: Palette, maxScore: 1, scoreKey: 'marca' },
    ],
  },
  {
    title: 'Tu Operación',
    emoji: '2',
    sections: [
      { key: 'mis-servicios', label: 'Mis servicios', icon: Package, maxScore: 2, scoreKey: 'servicios' },
      { key: 'gastos-fijos', label: 'Mis gastos fijos', icon: Receipt, maxScore: 3, scoreKey: 'gastos' },
      { key: 'cuentas-bancarias', label: 'Mi cuenta bancaria', icon: Landmark, maxScore: 2, scoreKey: 'banco' },
    ],
  },
  {
    title: 'Tu Equipo',
    emoji: '3',
    sections: [
      { key: 'mi-equipo', label: 'Mi equipo', icon: UsersRound, maxScore: 2, scoreKey: 'equipo' },
    ],
  },
  {
    title: 'Tus Metas',
    emoji: '4',
    sections: [
      { key: 'metas-mensuales', label: 'Mis metas', icon: Target, maxScore: 3, scoreKey: 'metas' },
    ],
  },
]

// ── Component ──────────────────────────────────────

export default function MiNegocioClient({
  workspace,
  fiscalProfile,
  staffMembers,
  bankAccounts,
  monthlyTargets,
  fixedExpenses,
  categories,
  servicios,
  staffNomina,
  configFinanciera,
  progressPct,
  currentUserRole,
  sectionScores,
}: MiNegocioClientProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [showCelebration, setShowCelebration] = useState(false)

  useEffect(() => {
    if (progressPct === 100) {
      setShowCelebration(true)
      const timer = setTimeout(() => setShowCelebration(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [progressPct])

  const getStatusEmoji = (score: number, max: number) => {
    if (score >= max) return '✅'
    if (score > 0) return '🟡'
    return '⬜'
  }

  const getStatusBadge = (key: string) => {
    switch (key) {
      case 'perfil-fiscal':
        return fiscalProfile?.is_complete
          ? 'Completo'
          : fiscalProfile?.is_estimated
          ? 'Estimado'
          : 'Pendiente'
      case 'mi-marca':
        return workspace?.logo_url || (workspace?.color_primario !== '#10B981') ? 'Configurado' : 'Pendiente'
      case 'mis-servicios': {
        const active = servicios.filter(s => s.activo !== false)
        return active.length > 0 ? `${active.length} servicio${active.length !== 1 ? 's' : ''}` : 'Pendiente'
      }
      case 'gastos-fijos': {
        const active = fixedExpenses.filter(f => f.is_active)
        if (active.length === 0) return 'Pendiente'
        const total = active.reduce((s, f) => s + f.monthly_amount, 0)
        return `$${total.toLocaleString('es-CO')}/mes`
      }
      case 'cuentas-bancarias': {
        const active = bankAccounts.filter(a => a.is_active)
        return active.length > 0 ? `${active.length} cuenta${active.length !== 1 ? 's' : ''}` : 'Pendiente'
      }
      case 'mi-equipo': {
        const withSalary = staffMembers.filter(s => (s.salary ?? 0) > 0)
        return withSalary.length > 0 ? `${staffMembers.length} persona${staffMembers.length !== 1 ? 's' : ''}` : 'Pendiente'
      }
      case 'metas-mensuales':
        return monthlyTargets.length > 0 ? `${monthlyTargets.length} meses` : 'Pendiente'
      default:
        return ''
    }
  }

  const toggleSection = (key: string) => {
    setActiveSection(prev => prev === key ? null : key)
  }

  const totalFixed = fixedExpenses.filter(f => f.is_active).reduce((s, f) => s + f.monthly_amount, 0)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold">Mi Negocio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura tu negocio paso a paso para que tus números sean más precisos.
        </p>
      </div>

      {/* ── Progress Bar (sticky) ── */}
      <div className="sticky top-0 z-10 bg-background pb-2 pt-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">Progreso de configuración</span>
          <span className="text-xs font-bold text-primary">{progressPct}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* ── Celebration at 100% ── */}
      {progressPct === 100 && (
        <div className={`rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/20 transition-all ${showCelebration ? 'animate-pulse' : ''}`}>
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-green-600 dark:text-green-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-green-700 dark:text-green-300">
                🎉 ¡Tu negocio esta listo!
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                Has completado toda la configuración. Tus números ahora son 100% precisos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Onboarding Welcome (first visit, no progress) ── */}
      {progressPct === 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-sm font-medium">
            👋 Bienvenido a <span className="font-bold">Mi Negocio</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Completa cada sección para que MeTRIK ONE calcule tus números con precisión.
            No necesitas hacerlo todo hoy — puedes avanzar a tu ritmo.
          </p>
        </div>
      )}

      {/* ── Chapters & Sections ── */}
      {CHAPTERS.map((chapter) => (
        <div key={chapter.title} className="space-y-2">
          {/* Chapter header */}
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
              {chapter.emoji}
            </span>
            {chapter.title}
          </h2>

          {/* Section cards */}
          {chapter.sections.map((section) => {
            const score = sectionScores[section.scoreKey]
            const isOpen = activeSection === section.key
            const Icon = section.icon
            const badge = getStatusBadge(section.key)
            const isPending = badge === 'Pendiente'

            return (
              <div key={section.key}>
                <button
                  onClick={() => toggleSection(section.key)}
                  className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/50"
                >
                  <span className="text-base">{getStatusEmoji(score, section.maxScore)}</span>
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{section.label}</p>
                  </div>
                  <span className={`text-xs font-medium ${
                    isPending ? 'text-muted-foreground' : 'text-green-600'
                  }`}>
                    {badge}
                  </span>
                  <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    isOpen ? 'rotate-90' : ''
                  }`} />
                </button>

                {/* Expanded section content */}
                {isOpen && (
                  <div className="mt-2 rounded-xl border bg-card p-5">
                    {renderSection(section.key, {
                      workspace,
                      fiscalProfile,
                      staffMembers,
                      bankAccounts,
                      monthlyTargets,
                      fixedExpenses,
                      categories,
                      servicios,
                      staffNomina,
                      configFinanciera,
                      totalFixed,
                      currentUserRole,
                      onClose: () => setActiveSection(null),
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Section Renderer ──────────────────────────────────

function renderSection(
  key: string,
  props: {
    workspace: any
    fiscalProfile: FiscalProfile | null
    staffMembers: Staff[]
    bankAccounts: BankAccount[]
    monthlyTargets: MonthlyTarget[]
    fixedExpenses: (FixedExpense & { categoryName: string | null })[]
    categories: ExpenseCategory[]
    servicios: Servicio[]
    staffNomina: { nombre: string; salario: number }[]
    configFinanciera: { margen_contribucion_estimado: number | null; margen_fuente: string | null; n_proyectos_margen: number | null } | null
    totalFixed: number
    currentUserRole: string
    onClose: () => void
  },
) {
  switch (key) {
    case 'perfil-fiscal':
      return (
        <PerfilFiscalExtended
          fiscalProfile={props.fiscalProfile}
          onClose={props.onClose}
        />
      )

    case 'mi-marca':
      return (
        <MarcaSection
          workspace={props.workspace}
        />
      )

    case 'mis-servicios':
      return (
        <ServiciosSection initialData={props.servicios} />
      )

    case 'gastos-fijos':
      return (
        <GastosFijosSection
          fixedExpenses={props.fixedExpenses}
          categories={props.categories}
          totalFixed={props.totalFixed}
          staffNomina={props.staffNomina}
        />
      )

    case 'cuentas-bancarias':
      return (
        <BankAccountsSection initialData={props.bankAccounts} />
      )

    case 'mi-equipo':
      return (
        <EquipoSection
          workspace={props.workspace}
          staffMembers={props.staffMembers}
        />
      )

    case 'metas-mensuales':
      return (
        <div className="space-y-6">
          <MonthlyTargetsSection
            initialData={props.monthlyTargets}
            initialYear={new Date().getFullYear()}
          />
          <MargenContribucionSection configFinanciera={props.configFinanciera} />
        </div>
      )

    default:
      return <p className="text-sm text-muted-foreground">Seccion no encontrada</p>
  }
}

// ── D130: Margen de Contribución Section ──────────────

const MARGEN_OPTIONS = [
  { label: 'Casi nada — vendo mi tiempo', value: 0.95 },
  { label: 'Alrededor del 20-30%', value: 0.75 },
  { label: 'Alrededor del 40-50%', value: 0.55 },
  { label: 'Mas del 60%', value: 0.35 },
] as const

function MargenContribucionSection({ configFinanciera }: {
  configFinanciera: { margen_contribucion_estimado: number | null; margen_fuente: string | null; n_proyectos_margen: number | null } | null
}) {
  const currentMargen = Number(configFinanciera?.margen_contribucion_estimado ?? 0.95)
  const [selected, setSelected] = useState<number>(currentMargen)
  const [customValue, setCustomValue] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    const margen = useCustom ? (1 - (parseInt(customValue) || 0) / 100) : selected
    if (margen < 0.01 || margen > 0.99) {
      toast.error('El margen debe estar entre 1% y 99%')
      return
    }
    startTransition(async () => {
      const result = await updateMargenEstimado(margen)
      if (result.success) toast.success('Margen actualizado')
      else toast.error(result.error ?? 'Error')
    })
  }

  const fuente = configFinanciera?.margen_fuente ?? 'estimado'
  const nProyectos = configFinanciera?.n_proyectos_margen ?? 0

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <h4 className="text-sm font-semibold">Margen de contribucion</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          ¿Que porcentaje de lo que vendes se lo llevan los costos directos del proyecto? (materiales, subcontratistas, etc.)
        </p>
      </div>

      {fuente === 'calculado' ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/20">
          <p className="text-xs text-green-700 dark:text-green-400">
            ✅ Tu margen se calcula automaticamente con datos de {nProyectos} proyecto{nProyectos !== 1 ? 's' : ''} cerrado{nProyectos !== 1 ? 's' : ''}: <strong>{Math.round((1 - currentMargen) * 100)}% costo directo</strong> → <strong>{Math.round(currentMargen * 100)}% margen</strong>
          </p>
        </div>
      ) : (
        <>
          {fuente === 'mixto' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Tu margen combina tu estimado con {nProyectos} proyecto{nProyectos !== 1 ? 's' : ''} cerrado{nProyectos !== 1 ? 's' : ''}. Con 3+ proyectos sera 100% automatico.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {MARGEN_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="margen"
                  checked={!useCustom && selected === opt.value}
                  onChange={() => { setSelected(opt.value); setUseCustom(false) }}
                  className="h-4 w-4 text-primary accent-primary"
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="margen"
                checked={useCustom}
                onChange={() => setUseCustom(true)}
                className="h-4 w-4 text-primary accent-primary"
              />
              <span className="text-sm">Valor exacto:</span>
              {useCustom && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={customValue}
                    onChange={e => setCustomValue(e.target.value)}
                    className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
                    placeholder="30"
                  />
                  <span className="text-sm text-muted-foreground">% costo directo</span>
                </div>
              )}
            </label>
          </div>

          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? 'Guardando...' : 'Guardar margen'}
          </button>
        </>
      )}
    </div>
  )
}
