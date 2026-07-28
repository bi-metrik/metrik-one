'use client'

/**
 * Control de reprocesos en el detalle del negocio.
 *
 * Dos estados:
 *  - Sin reproceso abierto → botón discreto en la barra de acciones. Es un botón de
 *    emergencia: no debe invitar a usarse, pero tiene que estar a la mano cuando la
 *    UPME o la DIAN devuelven el trabajo.
 *  - Con reproceso abierto → banner rojo arriba de todo, imposible de pasar por alto,
 *    con el ciclo, la causa y a qué etapa volvió el caso.
 */

import { useState, useTransition } from 'react'
import { RotateCcw, AlertTriangle, X } from 'lucide-react'
import { toast } from 'sonner'
import { reprocesarNegocio, cerrarReproceso, type TipoReproceso, type CausaReproceso } from '@/lib/actions/reproceso-actions'

const GERENCIAL = ['owner', 'admin', 'supervisor']

export type ReprocesoVista = {
  activo?: boolean
  tipo?: string
  ciclo?: number
  causa?: string
  detalle?: string
  etapa_retorno?: string | null
  abierto_por_nombre?: string | null
  abierto_at?: string
}

const LABEL_TIPO: Record<string, string> = {
  certificacion_upme: 'Certificación UPME',
  devolucion_dian: 'Devolución DIAN',
}

export function ReprocesoBanner({
  negocioId,
  reproceso,
  userRole,
}: {
  negocioId: string
  reproceso: ReprocesoVista | null
  userRole: string
}) {
  const [isPending, startTransition] = useTransition()
  if (!reproceso?.activo) return null

  const puedeCerrar = GERENCIAL.includes(userRole)

  return (
    <div className="mb-3 rounded-lg border border-[#DC2626]/30 bg-[#DC2626]/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[#DC2626]">
            Reproceso {reproceso.ciclo ?? 1} — {LABEL_TIPO[reproceso.tipo ?? ''] ?? reproceso.tipo}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {reproceso.etapa_retorno ? `El caso volvió a ${reproceso.etapa_retorno}. ` : ''}
            {reproceso.causa === 'error_propio' ? 'Causa: error propio.' : 'Causa: criterio del tercero.'}
            {reproceso.abierto_por_nombre ? ` Abierto por ${reproceso.abierto_por_nombre}.` : ''}
          </p>
          {reproceso.detalle && (
            <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{reproceso.detalle}&rdquo;</p>
          )}
        </div>
        {puedeCerrar && (
          <button
            onClick={() =>
              startTransition(async () => {
                const r = await cerrarReproceso(negocioId)
                if (r.ok) toast.success('Reproceso cerrado')
                else toast.error(r.error ?? 'No se pudo cerrar')
              })
            }
            disabled={isPending}
            title="Marcar el reproceso como resuelto"
            className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            {isPending ? 'Cerrando…' : 'Cerrar'}
          </button>
        )}
      </div>
    </div>
  )
}

export function ReprocesoBoton({
  negocioId,
  reprocesoActivo,
  userRole,
}: {
  negocioId: string
  reprocesoActivo: boolean
  userRole: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState<TipoReproceso>('devolucion_dian')
  const [causa, setCausa] = useState<CausaReproceso>('criterio_tercero')
  const [detalle, setDetalle] = useState('')
  const [isPending, startTransition] = useTransition()

  // Solo dirección y supervisión. El servidor lo vuelve a validar, y además exige
  // área de operaciones al supervisor; esto es únicamente para no mostrar un botón
  // que va a fallar.
  if (!GERENCIAL.includes(userRole) || reprocesoActivo) return null

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        disabled={isPending}
        title="Devolver el caso a una etapa anterior para rehacerlo"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-60"
      >
        <RotateCcw className="h-3 w-3" />
        <span className="hidden sm:inline">Reprocesar</span>
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Abrir reproceso</h2>
              <button onClick={() => setAbierto(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-3 text-xs text-muted-foreground">
              El caso vuelve a la etapa donde empieza el tramo que hay que rehacer. Lo que ya se
              había llenado queda archivado como historial, no se pierde. Se notifica a
              supervisores y owner.
            </p>

            <label className="mb-1 block text-xs font-medium">¿Qué hay que rehacer?</label>
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value as TipoReproceso)}
              className="mb-3 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="devolucion_dian">Devolución DIAN — la DIAN rechazó la solicitud</option>
              <option value="certificacion_upme">Certificación UPME — el certificado salió malo</option>
            </select>

            <label className="mb-1 block text-xs font-medium">¿De quién fue la causa?</label>
            <select
              value={causa}
              onChange={e => setCausa(e.target.value as CausaReproceso)}
              className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="criterio_tercero">Criterio del funcionario — no cuenta como falla nuestra</option>
              <option value="error_propio">Error propio — cuenta en el indicador de calidad</option>
            </select>
            <p className="mb-3 text-[10px] text-muted-foreground">
              Este dato alimenta el indicador de calidad del mes. Si la devolución fue porque el
              funcionario interpretó distinto el procedimiento, no penaliza.
            </p>

            <label className="mb-1 block text-xs font-medium">¿Qué pasó?</label>
            <textarea
              value={detalle}
              onChange={e => setDetalle(e.target.value)}
              rows={3}
              placeholder="Ej: la DIAN rechazó por la firma del solicitante."
              className="mb-3 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAbierto(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                disabled={isPending || !detalle.trim()}
                onClick={() =>
                  startTransition(async () => {
                    const r = await reprocesarNegocio(negocioId, { tipo, causa, detalle })
                    if (r.ok) {
                      toast.success(`Reproceso ${r.ciclo} abierto. El caso volvió a ${r.etapaNombre}.`)
                      setAbierto(false)
                      setDetalle('')
                    } else {
                      toast.error(r.error ?? 'No se pudo abrir el reproceso')
                    }
                  })
                }
                className="rounded-md bg-[#DC2626] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {isPending ? 'Abriendo…' : 'Abrir reproceso'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
