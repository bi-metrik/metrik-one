'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  Plus, X, Trash2, Loader2, ChevronDown, ChevronUp,
  ArrowRight, ToggleLeft, ToggleRight, GitBranch
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getWorkspaceStages,
  createCustomStage,
  deleteCustomStage,
  getTransitionRules,
  createTransitionRule,
  toggleTransitionRule,
} from './workflow-actions'
import type { WorkspaceStage, TransitionRule, CreateRuleInput } from './workflow-actions'

// ── Colores predefinidos ─────────────────────────────────────────────────────

const PRESET_COLORS = [
  { value: '#6B7280', label: 'Gris' },
  { value: '#3B82F6', label: 'Azul' },
  { value: '#8B5CF6', label: 'Violeta' },
  { value: '#EC4899', label: 'Rosa' },
  { value: '#F59E0B', label: 'Ámbar' },
  { value: '#10B981', label: 'Verde' },
  { value: '#EF4444', label: 'Rojo' },
  { value: '#0EA5E9', label: 'Cian' },
]

const CONDICION_LABELS: Record<string, string> = {
  all_required_fields: 'Todos los campos requeridos llenos',
  checklist_complete: 'Checklist completo',
  custom_field_value: 'Campo con valor específico',
}

// ── Sub-componente: Lista de etapas ──────────────────────────────────────────

interface StagesListProps {
  entidad: 'oportunidad' | 'proyecto'
  label: string
}

function StagesList({ entidad, label }: StagesListProps) {
  const [stages, setStages] = useState<WorkspaceStage[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newNombre, setNewNombre] = useState('')
  const [newColor, setNewColor] = useState('#6B7280')
  const [insertarDespuesDeId, setInsertarDespuesDeId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    getWorkspaceStages(entidad).then(data => {
      setStages(data)
      setLoading(false)
    })
  }, [entidad])

  const handleAdd = () => {
    const nombre = newNombre.trim()
    if (!nombre) { toast.error('Ingresa un nombre para la etapa'); return }

    startTransition(async () => {
      const result = await createCustomStage({ entidad, nombre, color: newColor, insertarDespuesDeId })
      if (result.success) {
        toast.success('Etapa creada')
        setNewNombre('')
        setNewColor('#6B7280')
        setInsertarDespuesDeId(null)
        setShowAddForm(false)
        const updated = await getWorkspaceStages(entidad)
        setStages(updated)
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleDelete = (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar la etapa "${nombre}"? Se desactivará pero los registros existentes no cambiarán.`)) return

    startTransition(async () => {
      const result = await deleteCustomStage(id)
      if (result.success) {
        setStages(prev => prev.filter(s => s.id !== id))
        toast.success('Etapa eliminada')
      } else {
        toast.error(result.error)
      }
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          {showAddForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showAddForm ? 'Cancelar' : 'Agregar etapa'}
        </button>
      </div>

      {/* Lista de etapas */}
      <div className="space-y-1.5">
        {stages.map((stage) => (
          <div
            key={stage.id}
            className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
          >
            {/* Punto de color */}
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: stage.color }}
            />
            <span className="flex-1 text-sm truncate">{stage.nombre}</span>
            {stage.es_sistema && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Sistema
              </span>
            )}
            {stage.es_terminal && !stage.es_sistema && (
              <span className="shrink-0 rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 text-[10px] font-medium">
                Terminal
              </span>
            )}
            {!stage.es_sistema && (
              <button
                onClick={() => handleDelete(stage.id, stage.nombre)}
                disabled={isPending}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                title="Eliminar etapa"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {stages.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">Sin etapas configuradas</p>
        )}
      </div>

      {/* Formulario agregar */}
      {showAddForm && (
        <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Nombre de la etapa</label>
            <input
              type="text"
              placeholder="Ej: En revisión"
              value={newNombre}
              onChange={(e) => setNewNombre(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Color</label>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setNewColor(c.value)}
                  className={`h-6 w-6 rounded-full transition-all ${newColor === c.value ? 'ring-2 ring-offset-1 ring-foreground scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Insertar después de</label>
            <select
              value={insertarDespuesDeId ?? ''}
              onChange={(e) => setInsertarDespuesDeId(e.target.value || null)}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Al final</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleAdd}
            disabled={isPending || !newNombre.trim()}
            className="flex h-9 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Crear etapa'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Sub-componente: Lista de reglas ──────────────────────────────────────────

interface RulesListProps {
  entidad: 'oportunidad' | 'proyecto'
  label: string
}

function RulesList({ entidad, label }: RulesListProps) {
  const [rules, setRules] = useState<TransitionRule[]>([])
  const [stages, setStages] = useState<WorkspaceStage[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Form state
  const [fromStageId, setFromStageId] = useState<string>('')
  const [toStageId, setToStageId] = useState<string>('')
  const [condTipo, setCondTipo] = useState<CreateRuleInput['condicion_tipo']>('all_required_fields')
  const [fieldSlug, setFieldSlug] = useState('')
  const [fieldValue, setFieldValue] = useState('')

  useEffect(() => {
    Promise.all([
      getTransitionRules(entidad),
      getWorkspaceStages(entidad),
    ]).then(([rulesData, stagesData]) => {
      setRules(rulesData)
      setStages(stagesData)
      setLoading(false)
    })
  }, [entidad])

  const handleToggle = (id: string, activo: boolean) => {
    startTransition(async () => {
      const result = await toggleTransitionRule(id, !activo)
      if (result.success) {
        setRules(prev => prev.map(r => r.id === id ? { ...r, activo: !activo } : r))
        toast.success(!activo ? 'Regla activada' : 'Regla desactivada')
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleAddRule = () => {
    if (!toStageId) { toast.error('Selecciona la etapa destino'); return }

    const condConfig: Record<string, unknown> = {}
    if (condTipo === 'custom_field_value' || condTipo === 'checklist_complete') {
      if (!fieldSlug.trim()) { toast.error('Ingresa el slug del campo'); return }
      condConfig.field_slug = fieldSlug.trim()
      if (condTipo === 'custom_field_value') {
        if (!fieldValue.trim()) { toast.error('Ingresa el valor esperado'); return }
        condConfig.value = fieldValue.trim()
      }
    }

    startTransition(async () => {
      const result = await createTransitionRule({
        entidad,
        desde_stage_id: fromStageId || null,
        hasta_stage_id: toStageId,
        condicion_tipo: condTipo,
        condicion_config: condConfig,
      })
      if (result.success) {
        toast.success('Regla creada')
        setFromStageId('')
        setToStageId('')
        setCondTipo('all_required_fields')
        setFieldSlug('')
        setFieldValue('')
        setShowAddForm(false)
        const updated = await getTransitionRules(entidad)
        setRules(updated)
      } else {
        toast.error(result.error)
      }
    })
  }

  const getStageName = (id: string | null) => {
    if (!id) return 'Cualquier etapa'
    return stages.find(s => s.id === id)?.nombre ?? id
  }

  const describeCondicion = (rule: TransitionRule) => {
    if (!rule.condicion_tipo) return ''
    const label = CONDICION_LABELS[rule.condicion_tipo] ?? rule.condicion_tipo
    const config = rule.condicion_config
    if (rule.condicion_tipo === 'custom_field_value') {
      return `${label}: ${config.field_slug} = "${config.value}"`
    }
    if (rule.condicion_tipo === 'checklist_complete') {
      return `${label}: ${config.field_slug}`
    }
    return label
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          {showAddForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showAddForm ? 'Cancelar' : 'Agregar regla'}
        </button>
      </div>

      {/* Lista de reglas */}
      <div className="space-y-1.5">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${!rule.activo ? 'opacity-50' : ''}`}
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground">{getStageName(rule.desde_stage_id)}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium">{getStageName(rule.hasta_stage_id)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {describeCondicion(rule)}
              </p>
            </div>
            <button
              onClick={() => handleToggle(rule.id, rule.activo)}
              disabled={isPending}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title={rule.activo ? 'Desactivar' : 'Activar'}
            >
              {rule.activo
                ? <ToggleRight className="h-4 w-4 text-primary" />
                : <ToggleLeft className="h-4 w-4" />
              }
            </button>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">Sin reglas configuradas</p>
        )}
      </div>

      {/* Formulario agregar regla */}
      {showAddForm && (
        <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Desde etapa</label>
              <select
                value={fromStageId}
                onChange={(e) => setFromStageId(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Cualquier etapa</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Mover a etapa</label>
              <select
                value={toStageId}
                onChange={(e) => setToStageId(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Seleccionar...</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Condición de activación</label>
            <select
              value={condTipo}
              onChange={(e) => setCondTipo(e.target.value as CreateRuleInput['condicion_tipo'])}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all_required_fields">Todos los campos requeridos llenos</option>
              <option value="checklist_complete">Checklist completo</option>
              <option value="custom_field_value">Campo con valor específico</option>
            </select>
          </div>

          {(condTipo === 'checklist_complete' || condTipo === 'custom_field_value') && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Slug del campo</label>
              <input
                type="text"
                placeholder="Ej: estado_aprobacion"
                value={fieldSlug}
                onChange={(e) => setFieldSlug(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}

          {condTipo === 'custom_field_value' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Valor esperado</label>
              <input
                type="text"
                placeholder="Ej: aprobado"
                value={fieldValue}
                onChange={(e) => setFieldValue(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}

          <button
            onClick={handleAddRule}
            disabled={isPending || !toStageId}
            className="flex h-9 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Crear regla'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

interface WorkflowSectionProps {
  currentUserRole: string
}

export default function WorkflowSection({ currentUserRole }: WorkflowSectionProps) {
  const isOwner = currentUserRole === 'owner'

  const [openPipeline, setOpenPipeline] = useState(true)
  const [openProyectos, setOpenProyectos] = useState(false)
  const [openReglas, setOpenReglas] = useState(false)

  if (!isOwner) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Solo el dueño del workspace puede configurar el flujo de trabajo.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Etapas del pipeline */}
      <div className="rounded-lg border">
        <button
          onClick={() => setOpenPipeline(!openPipeline)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-medium">Etapas del pipeline (oportunidades)</span>
          {openPipeline ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {openPipeline && (
          <div className="border-t px-4 py-3">
            <StagesList entidad="oportunidad" label="Etapas de oportunidades" />
          </div>
        )}
      </div>

      {/* Etapas de proyectos */}
      <div className="rounded-lg border">
        <button
          onClick={() => setOpenProyectos(!openProyectos)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-medium">Etapas de proyectos</span>
          {openProyectos ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {openProyectos && (
          <div className="border-t px-4 py-3">
            <StagesList entidad="proyecto" label="Etapas de proyectos" />
          </div>
        )}
      </div>

      {/* Reglas de transición automática */}
      <div className="rounded-lg border">
        <button
          onClick={() => setOpenReglas(!openReglas)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-medium">Reglas de transición automática</span>
          {openReglas ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {openReglas && (
          <div className="border-t px-4 py-3 space-y-4">
            <RulesList entidad="oportunidad" label="Reglas para oportunidades" />
            <div className="border-t pt-4">
              <RulesList entidad="proyecto" label="Reglas para proyectos" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
