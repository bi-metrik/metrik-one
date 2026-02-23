'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, X, Flame, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatCOP } from '@/lib/contacts/constants'
import { TIPOS_RUBRO } from '@/lib/pipeline/constants'
import { crearProyectoInterno } from './actions-v2'

interface RubroLine {
  id: string
  tipo: string
  nombre: string
  cantidad: string
  unidad: string
  valor_unitario: string
}

interface Props {
  onClose: () => void
}

let rubroCounter = 0

export default function NuevoInternoDialog({ onClose }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState<1 | 2>(1)

  // Form state
  const [nombre, setNombre] = useState('')
  const [fechaInicio, setFechaInicio] = useState(new Date().toISOString().split('T')[0])
  const [fechaFin, setFechaFin] = useState('')
  const [carpetaUrl, setCarpetaUrl] = useState('')
  const [rubros, setRubros] = useState<RubroLine[]>([])

  const addRubro = () => {
    rubroCounter++
    const defaultTipo = TIPOS_RUBRO[0]
    setRubros(prev => [...prev, {
      id: `new-${rubroCounter}`,
      tipo: defaultTipo.value,
      nombre: defaultTipo.label,
      cantidad: '',
      unidad: defaultTipo.unidadDefault,
      valor_unitario: '',
    }])
  }

  const updateRubro = (id: string, field: keyof RubroLine, value: string) => {
    setRubros(prev => prev.map(r => {
      if (r.id !== id) return r
      if (field === 'tipo') {
        const t = TIPOS_RUBRO.find(t => t.value === value)
        return { ...r, tipo: value, nombre: t?.label ?? value, unidad: t?.unidadDefault ?? 'unidades' }
      }
      return { ...r, [field]: value }
    }))
  }

  const removeRubro = (id: string) => {
    setRubros(prev => prev.filter(r => r.id !== id))
  }

  const rubroTotal = (r: RubroLine) => (parseFloat(r.cantidad) || 0) * (parseFloat(r.valor_unitario) || 0)
  const totalPresupuesto = rubros.reduce((sum, r) => sum + rubroTotal(r), 0)

  const handleSubmit = () => {
    if (!nombre.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    startTransition(async () => {
      const rubrosData = rubros
        .filter(r => rubroTotal(r) > 0)
        .map(r => ({
          nombre: r.nombre,
          tipo: r.tipo,
          cantidad: parseFloat(r.cantidad) || 0,
          unidad: r.unidad,
          valor_unitario: parseFloat(r.valor_unitario) || 0,
          presupuestado: rubroTotal(r),
        }))

      const res = await crearProyectoInterno({
        nombre: nombre.trim(),
        fecha_inicio: fechaInicio || undefined,
        fecha_fin_estimada: fechaFin || undefined,
        carpeta_url: carpetaUrl || undefined,
        rubros: rubrosData.length > 0 ? rubrosData : undefined,
      })
      if (res.success && res.proyectoId) {
        toast.success('Proyecto interno creado')
        onClose()
        router.push(`/proyectos/${res.proyectoId}`)
      } else {
        toast.error('error' in res ? res.error : 'Error al crear proyecto')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50" />
      <div
        onClick={e => e.stopPropagation()}
        className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-background p-6 shadow-xl animate-in slide-in-from-bottom-4"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>

        {step === 1 ? (
          /* ── Step 1: Friction / Educational ── */
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
              </div>
              <h2 className="text-base font-bold">Proyecto interno</h2>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Este proyecto <strong className="text-foreground">no genera ingresos facturables</strong>.
                Los costos se registrarán como inversión operativa.
              </p>
              <p>
                Si este trabajo es para un cliente, créalo desde Pipeline para poder cotizar, facturar y cobrar.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => { onClose(); router.push('/nuevo/oportunidad') }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-xs font-medium hover:bg-accent transition-colors"
              >
                <Flame className="h-3.5 w-3.5" />
                Ir a Pipeline
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex-1 rounded-lg bg-primary py-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Entendido, es interno
              </button>
            </div>
          </div>
        ) : (
          /* ── Step 2: Creation Form ── */
          <div className="space-y-4">
            <h2 className="text-base font-bold">Nuevo proyecto interno</h2>

            <div className="space-y-3">
              {/* Nombre */}
              <div>
                <label className="block text-xs font-medium mb-1">Nombre *</label>
                <input
                  type="text"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Ej: Rediseño sitio web, Capacitación equipo"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  autoFocus
                />
              </div>

              {/* Presupuesto por rubros */}
              <div>
                <label className="block text-xs font-medium mb-1">Presupuesto estimado</label>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Clasifica el presupuesto por rubro para hacer seguimiento detallado.
                </p>

                {rubros.length > 0 && (
                  <div className="space-y-3 mb-2">
                    {rubros.map(r => {
                      const total = rubroTotal(r)
                      return (
                        <div key={r.id} className="rounded-lg border bg-muted/30 p-2.5 space-y-2">
                          <div className="flex items-center gap-2">
                            <select
                              value={r.tipo}
                              onChange={e => updateRubro(r.id, 'tipo', e.target.value)}
                              className="flex-1 rounded-lg border bg-background px-2 py-1.5 text-xs outline-none"
                            >
                              {TIPOS_RUBRO.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => removeRubro(r.id)}
                              className="shrink-0 rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[10px] text-muted-foreground mb-0.5">Cantidad</label>
                              <input
                                type="number"
                                value={r.cantidad}
                                onChange={e => updateRubro(r.id, 'cantidad', e.target.value)}
                                placeholder="0"
                                min="0"
                                className="w-full rounded-lg border bg-background px-2 py-1.5 text-xs outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-muted-foreground mb-0.5">Unidad</label>
                              <input
                                type="text"
                                value={r.unidad}
                                onChange={e => updateRubro(r.id, 'unidad', e.target.value)}
                                className="w-full rounded-lg border bg-background px-2 py-1.5 text-xs outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-muted-foreground mb-0.5">Vr. unitario</label>
                              <input
                                type="number"
                                value={r.valor_unitario}
                                onChange={e => updateRubro(r.id, 'valor_unitario', e.target.value)}
                                placeholder="$0"
                                min="0"
                                className="w-full rounded-lg border bg-background px-2 py-1.5 text-xs text-right outline-none"
                              />
                            </div>
                          </div>
                          {total > 0 && (
                            <div className="text-right text-[10px] text-muted-foreground">
                              Subtotal: <span className="font-semibold text-foreground">{formatCOP(total)}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Total */}
                    {totalPresupuesto > 0 && (
                      <div className="flex items-center justify-between rounded-md bg-muted px-3 py-1.5 text-xs">
                        <span className="text-muted-foreground">Total presupuesto</span>
                        <span className="font-semibold">{formatCOP(totalPresupuesto)}</span>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={addRubro}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  Agregar rubro
                </button>
              </div>

              {/* Dates row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Fecha inicio</label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={e => setFechaInicio(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Fecha fin estimada</label>
                  <input
                    type="date"
                    value={fechaFin}
                    onChange={e => setFechaFin(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
              </div>

              {/* Carpeta URL */}
              <div>
                <label className="block text-xs font-medium mb-1">Carpeta del proyecto</label>
                <input
                  type="url"
                  value={carpetaUrl}
                  onChange={e => setCarpetaUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep(1)}
                className="flex-1 rounded-lg border py-2.5 text-xs font-medium hover:bg-accent transition-colors"
              >
                Atrás
              </button>
              <button
                onClick={handleSubmit}
                disabled={!nombre.trim() || isPending}
                className="flex-1 rounded-lg bg-primary py-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isPending ? 'Creando...' : 'Crear proyecto'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
