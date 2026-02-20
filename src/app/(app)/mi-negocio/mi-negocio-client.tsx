'use client'

import { useState } from 'react'
import { ChevronRight, Briefcase, Palette, Package, Receipt, Landmark, UsersRound, Target } from 'lucide-react'
import type { ExpenseCategory, FixedExpense, FiscalProfile, Staff, BankAccount, MonthlyTarget, Servicio } from '@/types/database'

// Existing config sections — reused via import
import WizardFelipe from '../config/wizard-felipe'
import StaffSection from '../config/staff-section'
import BankAccountsSection from '../config/bank-accounts-section'
import MonthlyTargetsSection from '../config/monthly-targets-section'
import ServiciosSection from '../config/servicios-section'

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
    title: 'Tu Operacion',
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
  progressPct,
  currentUserRole,
  sectionScores,
}: MiNegocioClientProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null)

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
          Configura tu negocio paso a paso para que tus numeros sean mas precisos.
        </p>
      </div>

      {/* ── Progress Bar (sticky) ── */}
      <div className="sticky top-0 z-10 bg-background pb-2 pt-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">Progreso de configuracion</span>
          <span className="text-xs font-bold text-primary">{progressPct}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* ── Onboarding Welcome (first visit, no progress) ── */}
      {progressPct === 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-sm font-medium">
            👋 Bienvenido a <span className="font-bold">Mi Negocio</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Completa cada seccion para que MeTRIK ONE calcule tus numeros con precision.
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
        <MonthlyTargetsSection
          initialData={props.monthlyTargets}
          initialYear={new Date().getFullYear()}
        />
      )

    default:
      return <p className="text-sm text-muted-foreground">Seccion no encontrada</p>
  }
}
