'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, X, Flame } from 'lucide-react'
import { toast } from 'sonner'
import { crearProyectoInterno } from './actions-v2'

interface Props {
  onClose: () => void
}

export default function NuevoInternoDialog({ onClose }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState<1 | 2>(1)

  // Form state
  const [nombre, setNombre] = useState('')
  const [presupuesto, setPresupuesto] = useState('')
  const [fechaInicio, setFechaInicio] = useState(new Date().toISOString().split('T')[0])
  const [fechaFin, setFechaFin] = useState('')
  const [carpetaUrl, setCarpetaUrl] = useState('')

  const handleSubmit = () => {
    if (!nombre.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    startTransition(async () => {
      const res = await crearProyectoInterno({
        nombre: nombre.trim(),
        presupuesto_total: presupuesto ? parseFloat(presupuesto) : undefined,
        fecha_inicio: fechaInicio || undefined,
        fecha_fin_estimada: fechaFin || undefined,
        carpeta_url: carpetaUrl || undefined,
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
        className="relative z-10 w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-background p-6 shadow-xl animate-in slide-in-from-bottom-4"
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

              {/* Presupuesto */}
              <div>
                <label className="block text-xs font-medium mb-1">Presupuesto estimado</label>
                <input
                  type="number"
                  value={presupuesto}
                  onChange={e => setPresupuesto(e.target.value)}
                  placeholder="Opcional — COP"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
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
