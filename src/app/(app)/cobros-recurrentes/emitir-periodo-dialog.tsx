'use client'

/**
 * Emision manual de las cuentas de cobro de un periodo.
 *
 * Existe porque hasta hoy la emision vivia SOLO dentro del cron
 * (`/api/crons/procesar-planes-cobro`, tras la guarda del dia 10). Si el cron no
 * corria ese dia, el mes se quedaba sin facturar y no habia ninguna via para
 * emitirlo desde la aplicacion. Paso en agosto de 2026.
 *
 * El flujo es en dos pasos a proposito: primero un PREVIEW (`dryRun`) que no
 * escribe nada, y solo despues la emision. Emitir crea documentos con
 * consecutivo fiscal y sube PDFs a Drive: no puede colgar de un solo clic.
 *
 * Pinta los DOS caminos por separado porque no son la misma fila: una uniforme es
 * una empresa con N cobros agrupados y una explicita es UNA cuota con su
 * vencimiento propio. El total y el contador del boton si los suman.
 */

import { useCallback, useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { CalendarPlus, Loader2, X, AlertTriangle, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { ejecutarGenerarCuentasCobroPeriodo } from '@/lib/actions/cuentas-cobro-actions'
import type { EmitirPeriodoResult, ErrorEmision } from '@/lib/cobros/resumen-emision-periodo'

const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

type DetalleExplicita = EmitirPeriodoResult['explicitas']['detalles'][number]
/** La variante con datos de la cuota (la de error solo trae el id y el mensaje). */
type CuotaResuelta = Extract<DetalleExplicita, { success: true }>

type Preview = {
  uniformes: EmitirPeriodoResult['uniformes']['detalles']
  explicitas: DetalleExplicita[]
  errores: ErrorEmision[]
}

/** Type guard: sin él, filtrar la unión no estrecha el tipo y hay que castear. */
function esCuotaEn(estado: CuotaResuelta['estado']) {
  return (d: DetalleExplicita): d is CuotaResuelta => d.success && d.estado === estado
}

function formatCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

export default function EmitirPeriodoDialog() {
  const ahora = new Date()
  const [abierto, setAbierto] = useState(false)
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [cargando, setCargando] = useState<'preview' | 'emitir' | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  // El dialogo se monta en document.body: el header de la aplicacion usa
  // backdrop-blur, que crea un containing block y atrapa cualquier `fixed inset-0`
  // montado dentro. Es el mismo fallo que ya aparecio tres veces en este repo.
  // No hace falta un guard de montaje: `abierto` nace en false, asi que el portal
  // no se evalua en el servidor y `document` solo se toca tras un clic.

  const cerrar = useCallback(() => {
    if (cargando) return
    setAbierto(false)
    setPreview(null)
  }, [cargando])

  useEffect(() => {
    if (!abierto) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [abierto, cerrar])

  // Cambiar el periodo invalida el preview: emitir con un preview de otro mes
  // seria emitir a ciegas.
  function cambiarPeriodo(nuevoAnio: number, nuevoMes: number) {
    setAnio(nuevoAnio)
    setMes(nuevoMes)
    setPreview(null)
  }

  function verPreview() {
    setCargando('preview')
    startTransition(async () => {
      const res = await ejecutarGenerarCuentasCobroPeriodo(anio, mes, { dryRun: true })
      setCargando(null)
      if (!res.success) { toast.error(res.error); return }
      setPreview({
        uniformes: res.data.uniformes.detalles,
        explicitas: res.data.explicitas.detalles,
        errores: res.data.errores,
      })
    })
  }

  function emitir() {
    if (!preview) return
    setCargando('emitir')
    startTransition(async () => {
      const res = await ejecutarGenerarCuentasCobroPeriodo(anio, mes, { dryRun: false })
      setCargando(null)
      if (!res.success) { toast.error(res.error); return }
      const { cuentasCreadas, cuentasOmitidas, errores } = res.data
      if (errores.length > 0) {
        toast.error(`${cuentasCreadas} emitida(s), ${errores.length} con error. Revisa el detalle.`)
      } else if (cuentasCreadas === 0) {
        toast.info(`Nada que emitir: ${cuentasOmitidas} cuenta(s) ya existian.`)
      } else {
        toast.success(`${cuentasCreadas} cuenta(s) emitida(s), pendientes de aprobacion.`)
      }
      setAbierto(false)
      setPreview(null)
      router.refresh()
    })
  }

  // Uniformes: la fila es una empresa con sus cobros del mes agrupados.
  const aCrearUniformes = preview?.uniformes.filter(d => d.estado === 'creada') ?? []
  // Explicitas: la fila es UNA cuota del cronograma. En dry-run el estado es
  // 'preview' (no 'creada'): el emisor explicito distingue el preview de la
  // escritura real, y confundirlos dejaria la seccion vacia justo en el paso
  // que existe para mirarla.
  const aCrearExplicitas = preview?.explicitas.filter(esCuotaEn('preview')) ?? []
  const yaExisten = [
    ...(preview?.uniformes.filter(d => d.estado === 'omitida').map(d => d.numero ?? d.empresa_nombre) ?? []),
    ...(preview?.explicitas.filter(esCuotaEn('omitida')).map(d => d.numero) ?? []),
  ]
  const totalACrear = aCrearUniformes.length + aCrearExplicitas.length
  const total =
    aCrearUniformes.reduce((s, d) => s + d.monto_total, 0) +
    aCrearExplicitas.reduce((s, d) => s + d.monto, 0)
  const anios = [ahora.getFullYear(), ahora.getFullYear() - 1]

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:border-[#10B981] hover:text-[#10B981] transition-colors"
      >
        <CalendarPlus className="h-3.5 w-3.5" /> Emitir período
      </button>

      {abierto && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 select-none"
          onClick={cerrar}
        >
          <div
            className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 p-4 border-b border-border shrink-0">
              <div>
                <h2 className="text-base font-bold">Emitir cuentas del período</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Agrupa los cobros programados del mes por empresa pagadora y emite las cuotas
                  del mes de los contratos con cronograma. Las cuentas quedan pendientes de
                  aprobación: no se envía nada al cliente.
                </p>
              </div>
              <button
                type="button"
                onClick={cerrar}
                disabled={!!cargando}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40 shrink-0"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Cuerpo */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div className="flex items-end gap-3 flex-wrap">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Mes</span>
                  <select
                    value={mes}
                    onChange={e => cambiarPeriodo(anio, parseInt(e.target.value, 10))}
                    disabled={!!cargando}
                    className="px-2 py-1.5 border border-border rounded-md text-sm bg-background disabled:opacity-60"
                  >
                    {MESES.slice(1).map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Año</span>
                  <select
                    value={anio}
                    onChange={e => cambiarPeriodo(parseInt(e.target.value, 10), mes)}
                    disabled={!!cargando}
                    className="px-2 py-1.5 border border-border rounded-md text-sm bg-background disabled:opacity-60"
                  >
                    {anios.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={verPreview}
                  disabled={!!cargando}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:border-[#10B981] hover:text-[#10B981] disabled:opacity-60 transition-colors"
                >
                  {cargando === 'preview'
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando…</>
                    : <><FileText className="h-3.5 w-3.5" /> Ver qué se emitiría</>}
                </button>
              </div>

              {!preview && (
                <p className="text-xs text-muted-foreground">
                  Revisa el detalle antes de emitir. El cálculo no escribe nada.
                </p>
              )}

              {preview && (
                <div className="space-y-3">
                  {totalACrear === 0 && yaExisten.length === 0 && preview.errores.length === 0 && (
                    <div className="p-3 border border-border rounded-md text-sm text-muted-foreground">
                      No hay cobros programados sin pagar para {MESES[mes]} {anio}. No hay nada que emitir.
                    </div>
                  )}

                  {aCrearUniformes.length > 0 && (
                    <div className="border border-border rounded-md overflow-hidden">
                      <div className="px-3 py-2 bg-muted/40 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Planes uniformes · {aCrearUniformes.length} cuenta(s)
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {aCrearUniformes.map(d => (
                            <tr key={d.empresa_id} className="border-t border-border">
                              <td className="px-3 py-2">
                                <div className="font-medium">{d.empresa_nombre}</div>
                                <div className="text-xs text-muted-foreground">
                                  {d.cobros_ids.length} cobro(s) agrupado(s)
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right font-mono">{formatCOP(d.monto_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {aCrearExplicitas.length > 0 && (
                    <div className="border border-border rounded-md overflow-hidden">
                      <div className="px-3 py-2 bg-muted/40 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Cronograma del contrato · {aCrearExplicitas.length} cuota(s)
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {aCrearExplicitas.map(d => (
                            <tr key={d.planCuotaId} className="border-t border-border">
                              <td className="px-3 py-2">
                                <div className="font-medium">{d.empresaNombre}</div>
                                <div className="text-xs text-muted-foreground">
                                  Cuota {d.numeroCuota} · vence {d.fechaVencimiento} · se fecha {d.fechaEmision}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right font-mono">{formatCOP(d.monto)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {totalACrear > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 border border-border rounded-md bg-muted/20">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Total · {totalACrear} cuenta(s)
                      </span>
                      <span className="font-mono font-bold text-sm">{formatCOP(total)}</span>
                    </div>
                  )}

                  {yaExisten.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Ya existen y no se tocan: {yaExisten.join(', ')}.
                    </div>
                  )}

                  {preview.errores.length > 0 && (
                    <div className="p-3 border border-destructive/40 bg-destructive/5 rounded-md space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" /> {preview.errores.length} problema(s)
                      </div>
                      {preview.errores.map((e, i) => (
                        <div key={i} className="text-xs text-muted-foreground">
                          {e.origen === 'explicita' ? 'Cuota' : 'Empresa'} {e.ref}: {e.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t border-border shrink-0">
              <button
                type="button"
                onClick={cerrar}
                disabled={!!cargando}
                className="px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={emitir}
                disabled={!!cargando || totalACrear === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#10B981] text-white hover:bg-[#059669] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {cargando === 'emitir'
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Emitiendo…</>
                  : <>Emitir {totalACrear > 0 ? `${totalACrear} cuenta(s)` : ''}</>}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
