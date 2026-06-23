'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Upload, FileText, AlertTriangle, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { uploadPlanillaPila, deletePlanillaPila, listPlanillasPila, type PlanillaPilaRow } from './pila-actions'
import { useFileDrop } from '@/hooks/use-file-drop'

const MESES_NOMBRES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

interface PilaSectionProps {
  anioActual?: number
}

type EstadoMes = 'vacio' | 'cargado' | 'vencido' | 'mes_futuro'

function estadoDelMes(anio: number, mes: number, planilla: PlanillaPilaRow | undefined): EstadoMes {
  if (planilla) return 'cargado'
  const hoy = new Date()
  const anio_hoy = hoy.getFullYear()
  const mes_hoy = hoy.getMonth() + 1 // 1-12
  if (anio > anio_hoy) return 'mes_futuro'
  if (anio === anio_hoy && mes > mes_hoy) return 'mes_futuro'
  // Mes pasado o actual sin planilla → vencido si pasó día 15 + 30 días, sino vacio
  const fechaLimite = new Date(anio, mes - 1, 15)
  fechaLimite.setDate(fechaLimite.getDate() + 30)
  if (hoy > fechaLimite) return 'vencido'
  return 'vacio'
}

export default function PilaSection({ anioActual = new Date().getFullYear() }: PilaSectionProps) {
  const [anio, setAnio] = useState(anioActual)
  const [planillas, setPlanillas] = useState<PlanillaPilaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [mesAbierto, setMesAbierto] = useState<number | null>(null)
  const [monto, setMonto] = useState<string>('')
  const [pending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [droppedName, setDroppedName] = useState<string | null>(null)

  // Drop en el modal: escribe el archivo soltado en el <input name="file"> via
  // DataTransfer para que el form-submit existente lo recoja igual que el picker.
  const pilaDrop = useFileDrop({
    onFiles: files => {
      if (fileInputRef.current) {
        const dt = new DataTransfer()
        dt.items.add(files[0])
        fileInputRef.current.files = dt.files
        setDroppedName(files[0].name)
      }
    },
    disabled: pending,
  })

  // Recarga planillas cuando cambia el anio
  useEffect(() => {
    setLoading(true)
    listPlanillasPila(anio)
      .then(setPlanillas)
      .finally(() => setLoading(false))
  }, [anio])

  // Refresh helper post-upload o delete
  function refresh() {
    listPlanillasPila(anio).then(setPlanillas)
  }

  // Mapa mes → planilla del anio actual
  const planillaPorMes = new Map(planillas.map(p => [p.mes, p]))

  function abrirUpload(mes: number) {
    setMesAbierto(mes)
    setMonto(planillaPorMes.get(mes)?.monto_aportado?.toString() ?? '')
  }

  function cerrarUpload() {
    setMesAbierto(null)
    setMonto('')
    setDroppedName(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (mesAbierto === null) return
    const formData = new FormData(e.currentTarget)
    formData.append('anio', String(anio))
    formData.append('mes', String(mesAbierto))
    if (monto) formData.append('monto_aportado', monto)

    startTransition(async () => {
      const r = await uploadPlanillaPila(formData)
      if (r.success) {
        toast.success(`PILA ${MESES_NOMBRES[mesAbierto - 1]} ${anio} cargada`)
        cerrarUpload()
        refresh()
      } else {
        toast.error(r.error)
      }
    })
  }

  async function handleEliminar(id: string, mes: number) {
    if (!confirm(`¿Eliminar referencia de PILA ${MESES_NOMBRES[mes - 1]} ${anio}? El archivo en Drive no se borra.`)) {
      return
    }
    startTransition(async () => {
      const r = await deletePlanillaPila(id)
      if (r.success) {
        toast.success('Referencia eliminada')
        refresh()
      } else {
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Selector de anio */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Carga la PILA mensual una sola vez. Cada cuenta de cobro emitida ese mes la referencia automáticamente como soporte.
        </div>
        <select
          value={anio}
          onChange={e => setAnio(parseInt(e.target.value, 10))}
          className="px-3 py-1.5 border border-border rounded-md text-sm bg-background"
        >
          {[anioActual + 1, anioActual, anioActual - 1].map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Cargando planillas...
        </div>
      )}

      {/* Grid 12 meses */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {MESES_NOMBRES.map((nombre, idx) => {
          const mes = idx + 1
          const planilla = planillaPorMes.get(mes)
          const estado = estadoDelMes(anio, mes, planilla)
          const colorClass =
            estado === 'cargado' ? 'border-[#10B981] bg-[#10B981]/5' :
            estado === 'vencido' ? 'border-[#F59E0B] bg-[#F59E0B]/5' :
            estado === 'mes_futuro' ? 'border-border bg-muted/30 opacity-60' :
            'border-border bg-card'

          const Icon =
            estado === 'cargado' ? CheckCircle2 :
            estado === 'vencido' ? AlertTriangle :
            FileText
          const iconColor =
            estado === 'cargado' ? 'text-[#10B981]' :
            estado === 'vencido' ? 'text-[#F59E0B]' :
            'text-muted-foreground'

          return (
            <div
              key={mes}
              className={`p-3 border rounded-lg ${colorClass} flex flex-col gap-2`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{nombre}</span>
                <Icon className={`h-4 w-4 ${iconColor}`} />
              </div>

              {planilla ? (
                <>
                  {planilla.monto_aportado !== null && (
                    <div className="text-xs text-muted-foreground">
                      ${Number(planilla.monto_aportado).toLocaleString('es-CO')}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <a
                      href={planilla.file_drive_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      Ver <ExternalLink className="h-3 w-3" />
                    </a>
                    <button
                      type="button"
                      onClick={() => abrirUpload(mes)}
                      className="text-xs text-muted-foreground hover:text-foreground ml-auto"
                    >
                      Reemplazar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEliminar(planilla.id, mes)}
                      className="text-xs text-destructive hover:underline"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => abrirUpload(mes)}
                  disabled={estado === 'mes_futuro'}
                  className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-background hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed mt-1 self-start"
                >
                  <Upload className="h-3 w-3" /> Cargar
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Modal upload */}
      {mesAbierto !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-lg max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">
                PILA {MESES_NOMBRES[mesAbierto - 1]} {anio}
              </h3>
              <button
                type="button"
                onClick={cerrarUpload}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleUpload} className="space-y-3">
              <div
                {...pilaDrop.dropProps}
                className={`rounded-md border border-dashed p-3 transition-colors ${
                  pilaDrop.isDragging ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <label className="text-xs font-medium block mb-1">Archivo (PDF o imagen)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  name="file"
                  accept="application/pdf,image/*"
                  required
                  className="text-xs w-full"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  {droppedName ? `Archivo: ${droppedName}` : pilaDrop.isDragging ? 'Suelta el archivo aquí' : 'Toca o arrastra · Máx 10MB'}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1">
                  Monto aportado <span className="text-muted-foreground">(opcional)</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={monto}
                  onChange={e => setMonto(e.target.value)}
                  placeholder="ej. 508148"
                  className="w-full px-3 py-1.5 border border-border rounded-md text-sm bg-background"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Subir
                </button>
                <button
                  type="button"
                  onClick={cerrarUpload}
                  className="px-3 py-1.5 border border-border rounded-md text-sm hover:bg-accent"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
