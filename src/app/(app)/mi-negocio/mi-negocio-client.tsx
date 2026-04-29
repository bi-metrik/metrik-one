'use client'

import { useState, useEffect, useTransition } from 'react'
import { Briefcase, Palette, Package, Receipt, UsersRound, Target, Sparkles, CreditCard, Workflow, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { ExpenseCategory, FixedExpense, FiscalProfile, Staff, MonthlyTarget, Servicio, Workspace, WorkspaceFeature } from '@/types/database'

// Existing config sections — reused via import
import MonthlyTargetsSection from '../config/monthly-targets-section'
import ServiciosSection from '../config/servicios-section'

// Actions

// New sections
import PerfilFiscalExtended from './perfil-fiscal-extended'
import MarcaSection from './marca-section'
import GastosFijosSection from './gastos-fijos-section'
import EquipoSection from './equipo-section'
import PlanSection from './plan-section'
import FlujoSection from './flujo-section'
import ReglasValidacionSection from './reglas-validacion-section'

// ── Types ──────────────────────────────────────────

type FixedExpenseWithCategory = FixedExpense & { categoryName: string | null }

interface MiNegocioClientProps {
  workspace: Workspace | null
  modules?: Record<string, boolean>
  fiscalProfile: FiscalProfile | null
  staffMembers: Staff[]
  monthlyTargets: MonthlyTarget[]
  fixedExpenses: FixedExpenseWithCategory[]
  categories: ExpenseCategory[]
  servicios: Servicio[]
  staffNomina: { nombre: string; salario: number }[]
  progressPct: number
  currentUserRole: string
  licenseUsed: number
  licenseMax: number
  workspaceFeatures: WorkspaceFeature[]
  workspaceTipo: 'nativo' | 'clarity'
  lineasDisponibles: { id: string; nombre: string; descripcion: string | null; tipo: string }[]
  lineaActivaId: string | null
  sectionScores: {
    fiscal: number
    marca: number
    servicios: number
    gastos: number
    equipo: number
    metas: number
  }
}

// ── Section definitions (flat) ──────────────────────────────

interface SectionDef {
  key: string
  label: string
  icon: React.ElementType
  maxScore: number
  scoreKey: keyof MiNegocioClientProps['sectionScores']
  roles: string[]
  modules?: string[] // Si definido, solo visible cuando alguno de estos módulos está activo. Vacío = siempre visible.
  wsTipo?: 'nativo' | 'clarity' // Si definido, solo visible para ese tipo de workspace
}

const SECTIONS: SectionDef[] = [
  { key: 'mi-plan', label: 'Mi plan', icon: CreditCard, maxScore: 1, scoreKey: 'fiscal', roles: ['owner'], modules: ['business'] },
  { key: 'mi-flujo', label: 'Mi flujo', icon: Workflow, maxScore: 0, scoreKey: 'fiscal', roles: ['owner', 'admin'], modules: ['business'], wsTipo: 'nativo' },
  { key: 'perfil-fiscal', label: 'Mi perfil fiscal', icon: Briefcase, maxScore: 3, scoreKey: 'fiscal', roles: ['owner', 'admin'], modules: ['business'] },
  { key: 'mi-marca', label: 'Mi marca', icon: Palette, maxScore: 1, scoreKey: 'marca', roles: ['owner', 'admin'] },
  { key: 'mis-servicios', label: 'Mis servicios', icon: Package, maxScore: 2, scoreKey: 'servicios', roles: ['owner', 'admin', 'supervisor'], modules: ['business'] },
  { key: 'gastos-fijos', label: 'Mis gastos fijos', icon: Receipt, maxScore: 3, scoreKey: 'gastos', roles: ['owner', 'admin'], modules: ['business'] },
  { key: 'mi-equipo', label: 'Mi equipo', icon: UsersRound, maxScore: 2, scoreKey: 'equipo', roles: ['owner', 'admin'] },
  { key: 'metas-mensuales', label: 'Mis metas', icon: Target, maxScore: 3, scoreKey: 'metas', roles: ['owner', 'admin'], modules: ['business'] },
  { key: 'reglas-validacion', label: 'Reglas de validación', icon: ShieldCheck, maxScore: 0, scoreKey: 'marca', roles: ['owner', 'admin'], modules: ['compliance'] },
]

// ── Component ──────────────────────────────────────

export default function MiNegocioClient({
  workspace,
  modules,
  fiscalProfile,
  staffMembers,
  monthlyTargets,
  fixedExpenses,
  categories,
  servicios,
  staffNomina,
  progressPct,
  currentUserRole,
  licenseUsed,
  licenseMax,
  workspaceFeatures,
  lineasDisponibles = [],
  lineaActivaId = null,
  sectionScores,
  workspaceTipo,
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

  const getMainValue = (key: string): string => {
    switch (key) {
      case 'mi-plan':
        return `${licenseUsed}/${licenseMax} licencias`
      case 'mi-flujo': {
        const activa = lineasDisponibles.find(l => l.id === lineaActivaId)
        return activa ? activa.nombre : 'Sin configurar'
      }
      case 'perfil-fiscal':
        return fiscalProfile?.is_complete ? 'Completo' : 'Pendiente'
      case 'mi-marca':
        return workspace?.name || 'Pendiente'
      case 'mis-servicios': {
        const active = servicios.filter(s => s.activo !== false)
        return active.length > 0 ? `${active.length} servicio${active.length !== 1 ? 's' : ''}` : 'Pendiente'
      }
      case 'gastos-fijos': {
        const active = fixedExpenses.filter(f => f.is_active)
        if (active.length === 0) return 'Pendiente'
        const total = active.reduce((s, f) => s + f.monthly_amount, 0)
        if (total >= 1_000_000) {
          return `$${(total / 1_000_000).toFixed(1).replace('.0', '')}M/mes`
        }
        return `$${total.toLocaleString('es-CO')}/mes`
      }
      case 'mi-equipo': {
        const withSalary = staffMembers.filter(s => (s.salary ?? 0) > 0)
        return withSalary.length > 0 ? `${staffMembers.length} persona${staffMembers.length !== 1 ? 's' : ''}` : 'Pendiente'
      }
      case 'metas-mensuales':
        return monthlyTargets.length > 0 ? `${monthlyTargets.length} meses` : 'Pendiente'
      case 'reglas-validacion':
        return 'Listas cautelares'
      default:
        return ''
    }
  }

  const toggleSection = (key: string) => {
    setActiveSection(prev => prev === key ? null : key)
  }

  const totalFixed = fixedExpenses.filter(f => f.is_active).reduce((s, f) => s + f.monthly_amount, 0)

  const mod = modules ?? { business: true }
  const visibleSections = SECTIONS.filter(s => {
    if (!s.roles.includes(currentUserRole)) return false
    // Filtro por tipo de workspace (nativo vs clarity)
    if (s.wsTipo && s.wsTipo !== workspaceTipo) return false
    // Si la sección define módulos requeridos, al menos uno debe estar activo
    if (s.modules && s.modules.length > 0) {
      return s.modules.some(m => mod[m])
    }
    return true // Sin módulos definidos = siempre visible
  })
  const activeSectionDef = SECTIONS.find(s => s.key === activeSection)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">Mi Negocio</h1>
          <p className="text-xs text-muted-foreground">Configura tu negocio para numeros mas precisos</p>
        </div>
        <div className="h-8 w-8 rounded-full border-2 border-primary flex items-center justify-center">
          <span className="text-xs font-bold text-primary">{progressPct}%</span>
        </div>
      </div>

      {/* ── Celebration at 100% ── */}
      {progressPct === 100 && (
        <div className={`rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/20 transition-all ${showCelebration ? 'animate-pulse' : ''}`}>
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-green-600 dark:text-green-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-green-700 dark:text-green-300">Tu negocio esta listo!</p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Todos los ajustes completos. Tus numeros son 100% precisos.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Onboarding Welcome ── */}
      {progressPct === 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm font-medium">Bienvenido a <span className="font-bold">Mi Negocio</span></p>
          <p className="mt-1 text-xs text-muted-foreground">Completa cada seccion para numeros mas precisos. Avanza a tu ritmo.</p>
        </div>
      )}

      {/* ── Mobile: accordion (cards expand inline) ── */}
      <div className="sm:hidden space-y-1.5">
        {visibleSections.map((section) => {
          const score = sectionScores[section.scoreKey]
          const isComplete = section.key === 'mi-plan' || score >= section.maxScore
          const isActive = activeSection === section.key
          const Icon = section.icon
          const mainValue = getMainValue(section.key)
          const pctScore = section.key === 'mi-plan' ? 1 : (section.maxScore > 0 ? score / section.maxScore : 0)
          const badgeColor = pctScore >= 1 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : pctScore > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            : 'bg-muted text-muted-foreground'

          return (
            <div key={section.key}>
              <button
                onClick={() => toggleSection(section.key)}
                className={`flex w-full items-center gap-3 rounded-lg border-l-3 px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? 'bg-primary/5 border-l-primary'
                    : 'hover:bg-accent/40 border-l-transparent'
                }`}
                style={!isActive ? { borderLeftColor: isComplete ? '#10B981' : '#F59E0B' } : undefined}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isActive ? 'text-primary' : ''}`}>{section.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{mainValue}</p>
                </div>
                {section.maxScore > 0 && (
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${badgeColor}`}>
                    {Math.min(score, section.maxScore)}/{section.maxScore}
                  </span>
                )}
              </button>
              {isActive && (
                <div className="mt-1.5 rounded-xl border bg-card p-4">
                  {renderSection(section.key, {
                    workspace, fiscalProfile, staffMembers, monthlyTargets,
                    fixedExpenses, categories, servicios, staffNomina,
                    totalFixed, currentUserRole, licenseUsed, licenseMax, workspaceFeatures,
                    lineasDisponibles, lineaActivaId,
                    onClose: () => setActiveSection(null),
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Desktop: sidebar + content panel ── */}
      <div className="hidden sm:flex gap-4">
        {/* ── Sidebar ── */}
        <div className="w-56 shrink-0 space-y-1.5">
          {visibleSections.map((section) => {
            const score = sectionScores[section.scoreKey]
            const isComplete = section.key === 'mi-plan' || score >= section.maxScore
            const isActive = activeSection === section.key
            const Icon = section.icon
            const mainValue = getMainValue(section.key)
            const pctScore = section.key === 'mi-plan' ? 1 : (section.maxScore > 0 ? score / section.maxScore : 0)
            const badgeColor = pctScore >= 1 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : pctScore > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-muted text-muted-foreground'

            return (
              <button
                key={section.key}
                onClick={() => toggleSection(section.key)}
                className={`flex w-full items-center gap-3 rounded-lg border-l-3 px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? 'bg-primary/5 border-l-primary'
                    : 'hover:bg-accent/40 border-l-transparent'
                }`}
                style={!isActive ? { borderLeftColor: isComplete ? '#10B981' : '#F59E0B' } : undefined}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isActive ? 'text-primary' : ''}`}>{section.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{mainValue}</p>
                </div>
                {section.maxScore > 0 && (
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${badgeColor}`}>
                    {Math.min(score, section.maxScore)}/{section.maxScore}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ── Content panel ── */}
        <div className="flex-1 min-w-0">
          {activeSection && activeSectionDef ? (
            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {(() => { const Icon = activeSectionDef.icon; return <Icon className="h-4 w-4 text-primary" /> })()}
                  <h3 className="text-sm font-semibold">{activeSectionDef.label}</h3>
                </div>
              </div>
              {renderSection(activeSection, {
                workspace, fiscalProfile, staffMembers, monthlyTargets,
                fixedExpenses, categories, servicios, staffNomina,
                totalFixed, currentUserRole, licenseUsed, licenseMax, workspaceFeatures,
                lineasDisponibles, lineaActivaId,
                onClose: () => setActiveSection(null),
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">Selecciona una seccion para ver o editar</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Section Renderer ──────────────────────────────────

function renderSection(
  key: string,
  props: {
    workspace: Workspace | null
    fiscalProfile: FiscalProfile | null
    staffMembers: Staff[]
    monthlyTargets: MonthlyTarget[]
    fixedExpenses: (FixedExpense & { categoryName: string | null })[]
    categories: ExpenseCategory[]
    servicios: Servicio[]
    staffNomina: { nombre: string; salario: number }[]
    totalFixed: number
    currentUserRole: string
    licenseUsed: number
    licenseMax: number
    workspaceFeatures: WorkspaceFeature[]
    lineasDisponibles: { id: string; nombre: string; descripcion: string | null; tipo: string }[]
    lineaActivaId: string | null
    onClose: () => void
  },
) {
  switch (key) {
    case 'mi-plan':
      return (
        <PlanSection
          workspaceFeatures={props.workspaceFeatures}
          licenseUsed={props.licenseUsed}
          licenseMax={props.licenseMax}
        />
      )

    case 'mi-flujo':
      return (
        <FlujoSection
          lineas={props.lineasDisponibles}
          lineaActivaId={props.lineaActivaId}
        />
      )

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

    case 'mi-equipo':
      return (
        <EquipoSection
          workspace={props.workspace}
          staffMembers={props.staffMembers}
          licenseUsed={props.licenseUsed}
          licenseMax={props.licenseMax}
          currentUserRole={props.currentUserRole}
        />
      )

    case 'metas-mensuales':
      return (
        <div className="space-y-6">
          <MonthlyTargetsSection
            initialData={props.monthlyTargets}
            initialYear={new Date().getFullYear()}
          />
          <MargenContribucionSection />
        </div>
      )

    case 'reglas-validacion':
      return <ReglasValidacionSection workspaceId={props.workspace?.id} />

    default:
      return <p className="text-sm text-muted-foreground">Seccion no encontrada</p>
  }
}

// 2026-04-28: Margen de contribucion ahora se calcula automaticamente del PyL del mes
// (decision producto 2026-04-23). Esta seccion es informativa.

function MargenContribucionSection() {
  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <h4 className="text-sm font-semibold">Margen de contribucion</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Ingresos del mes menos costos variables. Se calcula automaticamente.
        </p>
      </div>

      <div className="rounded-lg border border-[#E5E7EB] bg-[#F5F4F2] p-3">
        <p className="text-xs text-[#6B7280]">
          Tu MC% se calcula del PyL del mes en <strong>Mis Numeros</strong>. Para verla con detalle, abre el drill-down de &quot;Estoy ganando?&quot;.
        </p>
        <p className="mt-1 text-[10px] text-[#6B7280]">
          Cada gasto se clasifica como variable / fijo / no operativo al registrarlo.
        </p>
      </div>
    </div>
  )
}
