'use client'

import { useState, useTransition } from 'react'
import { Download, FileText, CheckCircle2, AlertCircle, Loader2, RefreshCw, Lock } from 'lucide-react'
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
  /** Descuentos sobre este % requieren aprobación de rol gerencial. */
  umbral_aprobacion_pct?: number
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
  userRole?: string
}

function formatFechaCorta(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Redondeo a 2 decimales — SOLO para mostrar el % en pantalla / historial.
// El precio se mantiene exacto porque el descuento canónico conserva precisión.
function pct2(n: number): number {
  return Math.round(n * 100) / 100
}
// String limpio del % para el input (sin ceros de más): 40 → "40", 41.176 → "41.18"
function pctStr(n: number): string {
  return String(pct2(n))
}

export default function BloquePropuestaEconomica({
  negocioBloqueId,
  instancia,
  modo,
  configExtra,
  userRole,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const data = (instancia?.data ?? {}) as PropuestaData
  const precioBase = data.precio_base_con_iva ?? 0
  const versiones = (data.versiones ?? []).slice().sort((a, b) => b.n - a.n)
  const aprobada = !!data.aprobado_at
  const cap = configExtra.cap_descuento_pct ?? 50
  // Gate de descuento alto: sobre el umbral, aprobar requiere rol gerencial.
  const umbralAprobacion = configExtra.umbral_aprobacion_pct ?? null
  const puedeAprobarAlto = ['owner', 'admin', 'supervisor'].includes(userRole ?? '')

  // Rango de precio válido según el cap de descuento (con IVA).
  const precioMin = Math.round(precioBase * (1 - cap / 100)) // descuento = cap
  const precioMax = Math.round(precioBase)                    // descuento = 0
  // Conversores base ↔ % ↔ precio. El % conserva precisión (precio exacto manda).
  const valorDeDesc = (d: number) => Math.round(precioBase * (1 - d / 100))
  const descDeValor = (v: number) =>
    precioBase > 0 ? Math.round((1 - v / precioBase) * 100 * 1e6) / 1e6 : 0

  // Inputs — defaults desde ultima version o desde data inicial
  const ultimaVersion = versiones[0]
  // Descuento canónico (número, precisión completa) — fuente de verdad interna.
  const [desc1, setDesc1] = useState<number>(
    ultimaVersion?.descuento_pct_plan1 ?? data.descuento_pct_plan1 ?? 0,
  )
  const [desc2, setDesc2] = useState<number>(
    ultimaVersion?.descuento_pct_plan2 ?? data.descuento_pct_plan2 ?? 0,
  )
  // Strings visibles de los 4 inputs (permiten teclear libremente).
  const [desc1Str, setDesc1Str] = useState<string>(pctStr(desc1))
  const [desc2Str, setDesc2Str] = useState<string>(pctStr(desc2))
  const [valor1Str, setValor1Str] = useState<string>(String(valorDeDesc(desc1)))
  const [valor2Str, setValor2Str] = useState<string>(String(valorDeDesc(desc2)))
  const [planSeleccionado, setPlanSeleccionado] = useState<1 | 2>(2)

  // ── Handlers de edición bidireccional (%↔precio) ─────────────────────────
  // Editar el % recalcula el precio; editar el precio recalcula el %.
  // El campo que el usuario teclea conserva su texto; solo se reescribe el otro.
  const onDesc = (plan: 1 | 2, raw: string) => {
    const d = Number(raw) || 0
    if (plan === 1) {
      setDesc1Str(raw)
      setDesc1(d)
      setValor1Str(String(valorDeDesc(d)))
    } else {
      setDesc2Str(raw)
      setDesc2(d)
      setValor2Str(String(valorDeDesc(d)))
    }
  }
  const onValor = (plan: 1 | 2, raw: string) => {
    const v = Number(raw) || 0
    const d = descDeValor(v)
    if (plan === 1) {
      setValor1Str(raw)
      setDesc1(d)
      setDesc1Str(pctStr(d))
    } else {
      setValor2Str(raw)
      setDesc2(d)
      setDesc2Str(pctStr(d))
    }
  }

  // ¿El plan elegido supera el umbral y el usuario no es gerencial?
  const descPlanSeleccionado = (planSeleccionado === 1
    ? ultimaVersion?.descuento_pct_plan1
    : ultimaVersion?.descuento_pct_plan2) ?? 0
  const requiereAprobacionAlta = umbralAprobacion != null && descPlanSeleccionado > umbralAprobacion
  const aprobacionBloqueada = requiereAprobacionAlta && !puedeAprobarAlto

  // Recalculo en vivo (desde el descuento canónico). El React Compiler lo
  // auto-memoiza; no usamos useMemo manual (rompe con los helpers de conversión).
  const plan1Valor = Math.round(precioBase * (1 - desc1 / 100))
  const plan2Valor = Math.round(precioBase * (1 - desc2 / 100))
  const calc = {
    base: precioBase,
    plan1: plan1Valor,
    plan2: plan2Valor,
    plan1_anticipo: Math.round(plan1Valor / 2),
    plan1_exito_iva: Math.round(plan1Valor / 2),
    ahorro_plan1: precioBase - plan1Valor,
    ahorro_plan2: precioBase - plan2Valor,
    desc1,
    desc2,
    // Fuera de rango: descuento negativo (precio > base) o sobre el cap.
    invalid1: desc1 < 0 || desc1 > cap,
    invalid2: desc2 < 0 || desc2 > cap,
  }

  const invalido = calc.invalid1 || calc.invalid2

  // Detectar cambio vs ultima version
  const hayCambios = !ultimaVersion
    || Math.abs(ultimaVersion.descuento_pct_plan1 - desc1) > 0.0001
    || Math.abs(ultimaVersion.descuento_pct_plan2 - desc2) > 0.0001

  const handleGenerar = () => {
    if (invalido) {
      toast.error(`El precio de cada plan debe estar entre ${formatCOP(precioMin)} y ${formatCOP(precioMax)} (descuento 0%–${cap}%)`)
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

          {/* Editor por plan: descuento % ↔ precio final (con IVA), sincronizados */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PlanEditor
              titulo="Plan 1 (tarifa plena)"
              descStr={desc1Str}
              valorStr={valor1Str}
              onDesc={raw => onDesc(1, raw)}
              onValor={raw => onValor(1, raw)}
              cap={cap}
              precioMin={precioMin}
              precioMax={precioMax}
              invalid={calc.invalid1}
            />
            <PlanEditor
              titulo="Plan 2 (pago anticipado)"
              descStr={desc2Str}
              valorStr={valor2Str}
              onDesc={raw => onDesc(2, raw)}
              onValor={raw => onValor(2, raw)}
              cap={cap}
              precioMin={precioMin}
              precioMax={precioMax}
              invalid={calc.invalid2}
            />
          </div>

          {invalido && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                El precio de cada plan debe estar entre {formatCOP(precioMin)} y {formatCOP(precioMax)}{' '}
                (descuento entre 0% y {cap}%).
              </span>
            </div>
          )}

          {/* Resumen calculado */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">
                  Plan 1 — Tarifa plena{calc.desc1 > 0 ? ` · ${pct2(calc.desc1)}% desc.` : ''}
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
                  Plan 2 — Pago anticipado{calc.desc2 > 0 ? ` · ${pct2(calc.desc2)}% desc.` : ''}
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
              disabled={isPending || invalido || (!hayCambios && versiones.length > 0)}
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
                  disabled={isPending || aprobacionBloqueada}
                  title={aprobacionBloqueada ? `Descuentos sobre ${umbralAprobacion}% requieren aprobación gerencial` : undefined}
                  className="inline-flex items-center gap-1.5 rounded-md border border-green-600 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Aprobar v{ultimaVersion?.n} con Plan {planSeleccionado}
                </button>
              </div>
            )}
            {aprobacionBloqueada && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                El Plan {planSeleccionado} tiene {pct2(descPlanSeleccionado)}% de descuento — supera {umbralAprobacion}% y requiere aprobación de un supervisor, administrador o dueño.
              </p>
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

// ── Editor de un plan: descuento % ↔ precio final, enlazados ────────────────
function PlanEditor({
  titulo,
  descStr,
  valorStr,
  onDesc,
  onValor,
  cap,
  precioMin,
  precioMax,
  invalid,
}: {
  titulo: string
  descStr: string
  valorStr: string
  onDesc: (raw: string) => void
  onValor: (raw: string) => void
  cap: number
  precioMin: number
  precioMax: number
  invalid: boolean
}) {
  const borde = invalid ? 'border-red-500' : ''
  return (
    <div className="rounded-md border bg-background/50 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{titulo}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Descuento</label>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={descStr}
              onChange={e => onDesc(e.target.value)}
              className={`w-full rounded-md border bg-background py-2 pl-3 pr-7 text-sm ${borde}`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Precio final</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <input
              type="number"
              step="1000"
              inputMode="numeric"
              value={valorStr}
              onChange={e => onValor(e.target.value)}
              className={`w-full rounded-md border bg-background py-2 pl-6 pr-3 text-sm ${borde}`}
            />
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Edita el % o el precio: se sincronizan. Rango {formatCOP(precioMin)}–{formatCOP(precioMax)} · desc. máx {cap}%.
      </p>
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
                P1 {pct2(v.descuento_pct_plan1)}% · P2 {pct2(v.descuento_pct_plan2)}% ·{' '}
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
