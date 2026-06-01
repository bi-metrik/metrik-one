'use client'

import { useState, useTransition, useMemo } from 'react'
import { Download, FileText, CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { formatCOP } from '@/lib/contacts/constants'
import {
  generarVersionPropuesta,
  aprobarVersionPropuesta,
} from '@/lib/actions/propuesta-economica-actions'

interface PropuestaVersion {
  n: number
  descuento_pct_plan1: number
  descuento_pct_plan2: number
  valor_final_plan1: number
  valor_final_plan2: number
  pdf_drive_id: string | null
  pdf_url: string | null
  generated_at: string
  generated_by: string | null
}

interface PropuestaData {
  precio_base_con_iva?: number
  iva_pct?: number
  descuento_pct_plan1?: number
  descuento_pct_plan2?: number
  valor_final_plan1?: number
  valor_final_plan2?: number
  versiones?: PropuestaVersion[]
  version_activa?: number | null
  aprobado_at?: string | null
  aprobado_por?: string | null
  aprobado_version?: number | null
  aprobado_plan?: 1 | 2 | null
}

interface ConfigExtra {
  cap_descuento_pct?: number
  servicio_id?: string
  template_slug?: string
}

interface BloqueInstancia {
  id: string
  completado: boolean
  data: PropuestaData | null
}

interface Props {
  negocioBloqueId: string
  instancia: BloqueInstancia | null
  modo: 'editable' | 'visible'
  configExtra: ConfigExtra
}

function formatFechaCorta(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function BloquePropuestaEconomica({
  negocioBloqueId,
  instancia,
  modo,
  configExtra,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const data = (instancia?.data ?? {}) as PropuestaData
  const precioBase = data.precio_base_con_iva ?? 0
  const versiones = (data.versiones ?? []).slice().sort((a, b) => b.n - a.n)
  const aprobada = !!data.aprobado_at
  const cap = configExtra.cap_descuento_pct ?? 50

  // Inputs — defaults desde ultima version o desde data inicial
  const ultimaVersion = versiones[0]
  const [desc1Input, setDesc1Input] = useState<string>(
    String(ultimaVersion?.descuento_pct_plan1 ?? data.descuento_pct_plan1 ?? 0),
  )
  const [desc2Input, setDesc2Input] = useState<string>(
    String(ultimaVersion?.descuento_pct_plan2 ?? data.descuento_pct_plan2 ?? 0),
  )
  const [planSeleccionado, setPlanSeleccionado] = useState<1 | 2>(2)

  // Recalculo en vivo
  const calc = useMemo(() => {
    const d1 = Math.max(0, Number(desc1Input) || 0)
    const d2 = Math.max(0, Number(desc2Input) || 0)
    const plan1 = Math.round(precioBase * (1 - d1 / 100))
    const plan2 = Math.round(precioBase * (1 - d2 / 100))
    return {
      base: precioBase,
      plan1,
      plan2,
      plan1_anticipo: Math.round(plan1 / 2),
      plan1_exito_iva: Math.round(plan1 / 2),
      ahorro_plan1: precioBase - plan1,
      ahorro_plan2: precioBase - plan2,
      desc1: d1,
      desc2: d2,
      over1: d1 > cap,
      over2: d2 > cap,
    }
  }, [desc1Input, desc2Input, precioBase, cap])

  const overCap = calc.over1 || calc.over2

  // Detectar cambio vs ultima version
  const hayCambios = useMemo(() => {
    if (!ultimaVersion) return true
    return (
      Math.abs(ultimaVersion.descuento_pct_plan1 - calc.desc1) > 0.001 ||
      Math.abs(ultimaVersion.descuento_pct_plan2 - calc.desc2) > 0.001
    )
  }, [ultimaVersion, calc.desc1, calc.desc2])

  const handleGenerar = () => {
    if (overCap) {
      toast.error(`Cada descuento debe ser ≤ ${cap}%`)
      return
    }
    startTransition(async () => {
      const res = await generarVersionPropuesta(negocioBloqueId, {
        descuento_pct_plan1: calc.desc1,
        descuento_pct_plan2: calc.desc2,
      })
      if (res.ok) {
        if (res.warning) {
          toast.warning(`Versión v${res.version?.n} guardada (sin PDF)`, {
            description: res.warning,
            duration: 6000,
          })
        } else {
          toast.success(`Versión v${res.version?.n} generada`)
        }
      } else {
        toast.error(res.error ?? 'Error generando PDF')
      }
    })
  }

  const handleAprobar = () => {
    const versionActiva = data.version_activa ?? ultimaVersion?.n
    if (!versionActiva || !ultimaVersion) {
      toast.error('No hay versión para aprobar')
      return
    }
    const valorPlan =
      planSeleccionado === 1 ? ultimaVersion.valor_final_plan1 : ultimaVersion.valor_final_plan2
    if (
      !confirm(
        `¿Aprobar v${versionActiva} con Plan ${planSeleccionado} por ${formatCOP(valorPlan)}? Esto cerrará el bloque y establecerá el precio del negocio.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await aprobarVersionPropuesta(negocioBloqueId, versionActiva, planSeleccionado)
      if (res.ok) {
        toast.success(`Propuesta aprobada — Plan ${planSeleccionado}`)
      } else {
        toast.error(res.error ?? 'Error aprobando propuesta')
      }
    })
  }

  // ── Render solo lectura (modo visible o aprobada) ─────────────────────────
  if (modo === 'visible' || aprobada) {
    const versionMostrar = aprobada
      ? versiones.find(v => v.n === data.aprobado_version) ?? ultimaVersion
      : ultimaVersion
    const planAprobado = data.aprobado_plan
    const valorAprobado = versionMostrar
      ? planAprobado === 1
        ? versionMostrar.valor_final_plan1
        : versionMostrar.valor_final_plan2
      : null
    return (
      <div className="space-y-3">
        {aprobada && versionMostrar && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              Aprobada v{data.aprobado_version} — Plan {planAprobado} ·{' '}
              <strong>{valorAprobado !== null ? formatCOP(valorAprobado) : ''}</strong>
              {data.aprobado_at && ` · ${formatFechaCorta(data.aprobado_at)}`}
            </span>
          </div>
        )}
        {versiones.length > 0 ? (
          <VersionList
            versiones={versiones}
            aprobadaN={data.aprobado_version}
            planAprobado={data.aprobado_plan ?? null}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Sin versiones generadas.</p>
        )}
      </div>
    )
  }

  // ── Render editable ───────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {precioBase === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            Sin precio base disponible. Verifica que la línea de negocio tenga un servicio
            asociado con <code>precio_estandar</code> configurado.
          </span>
        </div>
      ) : (
        <>
          {/* Tarifa base de referencia */}
          <div className="flex items-baseline justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Tarifa base con IVA</span>
            <span className="font-medium">{formatCOP(precioBase)}</span>
          </div>

          {/* Inputs de descuento por plan */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Descuento Plan 1 (tarifa plena)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={cap}
                  value={desc1Input}
                  onChange={e => setDesc1Input(e.target.value)}
                  className={`w-full rounded-md border bg-background py-2 pl-3 pr-7 text-sm ${
                    calc.over1 ? 'border-red-500' : ''
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Cap: {cap}% · Default 0% (sin descuento)
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Descuento Plan 2 (pago anticipado)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={cap}
                  value={desc2Input}
                  onChange={e => setDesc2Input(e.target.value)}
                  className={`w-full rounded-md border bg-background py-2 pl-3 pr-7 text-sm ${
                    calc.over2 ? 'border-red-500' : ''
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Cap: {cap}%</p>
            </div>
          </div>

          {overCap && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Cada descuento debe estar entre 0% y {cap}%</span>
            </div>
          )}

          {/* Resumen calculado */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">
                  Plan 1 — Tarifa plena{calc.desc1 > 0 ? ` · ${calc.desc1}% desc.` : ''}
                </p>
                <p className="text-base font-medium">{formatCOP(calc.plan1)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Anticipo 50%: {formatCOP(calc.plan1_anticipo)}
                  <br />
                  Éxito IVA 50%: {formatCOP(calc.plan1_exito_iva)}
                  {calc.desc1 > 0 && (
                    <>
                      <br />
                      <span className="text-green-700">Ahorro: {formatCOP(calc.ahorro_plan1)}</span>
                    </>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Plan 2 — Pago anticipado{calc.desc2 > 0 ? ` · ${calc.desc2}% desc.` : ''}
                </p>
                <p className="text-base font-medium text-green-700">{formatCOP(calc.plan2)}</p>
                <p className="mt-1 text-xs text-green-700">
                  Ahorro: {formatCOP(calc.ahorro_plan2)}
                </p>
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerar}
              disabled={isPending || overCap || (!hayCambios && versiones.length > 0)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : versiones.length === 0 ? (
                <FileText className="h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {versiones.length === 0
                ? 'Generar PDF v1'
                : hayCambios
                  ? `Generar PDF v${(ultimaVersion?.n ?? 0) + 1}`
                  : `Sin cambios vs v${ultimaVersion?.n}`}
            </button>
            {versiones.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <fieldset className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs">
                  <legend className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Plan a aprobar
                  </legend>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="plan-aprobar"
                      value={1}
                      checked={planSeleccionado === 1}
                      onChange={() => setPlanSeleccionado(1)}
                    />
                    <span>Plan 1 · {formatCOP(ultimaVersion!.valor_final_plan1)}</span>
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="plan-aprobar"
                      value={2}
                      checked={planSeleccionado === 2}
                      onChange={() => setPlanSeleccionado(2)}
                    />
                    <span>Plan 2 · {formatCOP(ultimaVersion!.valor_final_plan2)}</span>
                  </label>
                </fieldset>
                <button
                  onClick={handleAprobar}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-green-600 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Aprobar v{ultimaVersion?.n} con Plan {planSeleccionado}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Lista de versiones */}
      {versiones.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Historial de versiones
          </p>
          <VersionList
            versiones={versiones}
            aprobadaN={data.aprobado_version}
            planAprobado={data.aprobado_plan ?? null}
          />
        </div>
      )}
    </div>
  )
}

function VersionList({
  versiones,
  aprobadaN,
  planAprobado,
}: {
  versiones: PropuestaVersion[]
  aprobadaN?: number | null
  planAprobado: 1 | 2 | null
}) {
  return (
    <ul className="space-y-1.5">
      {versiones.map(v => {
        const isAprobada = aprobadaN === v.n
        const valorAprobado =
          isAprobada && planAprobado
            ? planAprobado === 1
              ? v.valor_final_plan1
              : v.valor_final_plan2
            : null
        return (
          <li
            key={v.n}
            className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
              isAprobada ? 'border-green-300 bg-green-50' : ''
            }`}
          >
            <span className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded-md bg-foreground/10 px-2 text-xs font-mono">
              v{v.n}
            </span>
            <div className="min-w-0 flex-1">
              {isAprobada && valorAprobado !== null ? (
                <p className="font-medium">
                  Plan {planAprobado} · {formatCOP(valorAprobado)}
                </p>
              ) : (
                <p className="font-medium">
                  Plan 1: {formatCOP(v.valor_final_plan1)} · Plan 2: {formatCOP(v.valor_final_plan2)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                P1 {v.descuento_pct_plan1}% · P2 {v.descuento_pct_plan2}% ·{' '}
                {formatFechaCorta(v.generated_at)}
                {isAprobada && <span className="ml-2 text-green-700">· Aprobada</span>}
              </p>
            </div>
            {v.pdf_url ? (
              <a
                href={v.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
              >
                <Download className="h-3.5 w-3.5" />
                PDF
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">Sin PDF</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
