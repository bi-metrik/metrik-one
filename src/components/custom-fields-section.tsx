'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { Settings2, Tag, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  getCustomFields, getLabels, getEntityLabels,
  updateCustomData, toggleEntityLabel,
} from '@/app/(app)/custom-fields-actions'

type Entidad = 'oportunidad' | 'proyecto' | 'contacto' | 'empresa'

interface CondicionVisibilidad {
  campo: string
  valor: unknown
}

interface FieldDef {
  id: string
  nombre: string
  slug: string
  tipo: string
  opciones: string[] | null
  obligatorio: boolean
  condicion_visibilidad?: CondicionVisibilidad | null
}

interface LabelDef {
  id: string
  nombre: string
  color: string
}

interface Props {
  entidad: Entidad
  entidadId: string
  initialCustomData?: Record<string, unknown>
}

// Evalúa si un campo debe mostrarse dada la condicion_visibilidad y los valores actuales
function campoEsVisible(field: FieldDef, currentValues: Record<string, unknown>): boolean {
  if (!field.condicion_visibilidad) return true
  const { campo, valor } = field.condicion_visibilidad
  return currentValues[campo] === valor
}

export default function CustomFieldsSection({ entidad, entidadId, initialCustomData }: Props) {
  const [fields, setFields] = useState<FieldDef[]>([])
  const [labels, setLabels] = useState<LabelDef[]>([])
  const [appliedLabelIds, setAppliedLabelIds] = useState<Set<string>>(new Set())
  const [values, setValues] = useState<Record<string, unknown>>(initialCustomData ?? {})
  const [dirty, setDirty] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let mounted = true
    async function load() {
      const [f, l, el] = await Promise.all([
        getCustomFields(entidad),
        getLabels(entidad),
        getEntityLabels(entidad, entidadId),
      ])
      if (!mounted) return
      setFields(f as FieldDef[])
      setLabels(l as LabelDef[])
      setAppliedLabelIds(new Set(el.map((e: { label_id: string }) => e.label_id)))
    }
    load()
    return () => { mounted = false }
  }, [entidad, entidadId])

  const handleFieldChange = useCallback((slug: string, value: unknown) => {
    setValues(prev => ({ ...prev, [slug]: value }))
    setDirty(true)
  }, [])

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateCustomData(entidad, entidadId, values)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Campos guardados')
        setDirty(false)
      }
    })
  }

  const handleToggleLabel = (labelId: string) => {
    const isApplied = appliedLabelIds.has(labelId)
    const action = isApplied ? 'remove' : 'add'

    setAppliedLabelIds(prev => {
      const next = new Set(prev)
      if (isApplied) next.delete(labelId)
      else next.add(labelId)
      return next
    })

    startTransition(async () => {
      const result = await toggleEntityLabel(entidad, entidadId, labelId, action)
      if (result.error) {
        toast.error(result.error)
        setAppliedLabelIds(prev => {
          const next = new Set(prev)
          if (isApplied) next.add(labelId)
          else next.delete(labelId)
          return next
        })
      }
    })
  }

  const visibleFields = fields.filter(f => campoEsVisible(f, values))
  if (visibleFields.length === 0 && labels.length === 0) return null

  return (
    <div className="space-y-4">
      {labels.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" />
            Etiquetas
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {labels.map(label => {
              const isActive = appliedLabelIds.has(label.id)
              return (
                <button
                  key={label.id}
                  onClick={() => handleToggleLabel(label.id)}
                  disabled={isPending}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'ring-1 ring-offset-1 ring-current'
                      : 'opacity-50 hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: `${label.color}20`,
                    color: label.color,
                  }}
                >
                  {isActive && <Check className="w-3 h-3" />}
                  {label.nombre}
                  {isActive && <X className="w-3 h-3 ml-0.5" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {visibleFields.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5" />
            Campos adicionales
          </h3>
          <div className="space-y-3">
            {visibleFields.map(field => (
              <CustomFieldInput
                key={field.id}
                field={field}
                value={values[field.slug]}
                onChange={(val) => handleFieldChange(field.slug, val)}
              />
            ))}
          </div>
          {dirty && (
            <button
              onClick={handleSave}
              disabled={isPending}
              className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Guardando...' : 'Guardar campos'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef
  value: unknown
  onChange: (val: unknown) => void
}) {
  const baseClass = 'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm'

  switch (field.tipo) {
    case 'text':
      return (
        <div>
          <label className="block text-sm font-medium mb-1">
            {field.nombre}
            {field.obligatorio && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <input
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className={baseClass}
          />
        </div>
      )

    case 'number':
      return (
        <div>
          <label className="block text-sm font-medium mb-1">
            {field.nombre}
            {field.obligatorio && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <input
            type="number"
            value={(value as number) ?? ''}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
            className={baseClass}
          />
        </div>
      )

    case 'select':
      return (
        <div>
          <label className="block text-sm font-medium mb-1">
            {field.nombre}
            {field.obligatorio && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <select
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            className={baseClass}
          >
            <option value="">Seleccionar...</option>
            {(field.opciones ?? []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(!(value as boolean))}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              value ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                value ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
          <label className="text-sm font-medium">
            {field.nombre}
            {field.obligatorio && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        </div>
      )

    case 'date':
      return (
        <div>
          <label className="block text-sm font-medium mb-1">
            {field.nombre}
            {field.obligatorio && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <input
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            className={baseClass}
          />
        </div>
      )

    default:
      return null
  }
}
