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
  descuento_pct: number
  valor_final: number
  pdf_drive_id: string | null
  pdf_url: string | null
  generated_at: string
  generated_by: string | null
}

interface PropuestaData {
  precio_base_con_iva?: number
  iva_pct?: number
  descuento_pct?: number
  valor_final?: number
  versiones?: PropuestaVersion[]
  version_activa?: number | null
  aprobado_at?: string | null
  aprobado_por?: string | null
  aprobado_version?: number | null
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

  // Inputs sincronizados — defaults: ultima version o descuento 0
  const ultimaVersion = versiones[0]
  const [descPctInput, setDescPctInput] = useState<string>(
    String(ultimaVersion?.descuento_pct ?? data.descuento_pct ?? 0),
  )
  const [valorFinalInput, setValorFinalInput] = useState<string>(
    String(ultimaVersion?.valor_final ?? data.valor_final ?? precioBase),
  )

  // Recalculo en vivo
  const calc = useMemo(() => {
    const descPct = Math.max(0, Number(descPctInput) || 0)
    const plan1 = precioBase
    const plan2 = Math.round(plan1 * (1 - descPct / 100))
    return {
      plan1,
      plan2,
      anticipo: Math.round(plan1 / 2),
      exito_iva: Math.round(plan1 / 2),
      ahorro: plan1 - plan2,
      descuento_pct: descPct,
      over_cap: descPct > cap,
    }
  }, [descPctInput, precioBase, cap])

  // Detectar cambio vs ultima version
  const hayCambios = useMemo(() => {
    if (!ultimaVersion) return true
    return Math.abs(ultimaVersion.descuento_pct - calc.descuento_pct) > 0.001
  }, [ultimaVersion, calc.descuento_pct])

  const onChangeDescuento = (val: string) => {
    setDescPctInput(val)
    const pct = Math.max(0, Number(val) || 0)
    const nuevoFinal = Math.round(precioBase * (1 - pct / 100))
    setValorFinalInput(String(nuevoFinal))
  }

  const onChangeValorFinal = (val: string) => {
    setValorFinalInput(val)
    const vf = Math.max(0, Number(val) || 0)
    if (precioBase > 0) {
      const pct = (1 - vf / precioBase) * 100
      setDescPctInput(String(Math.round(pct * 100) / 100))
    }
  }

  const handleGenerar = () => {
    if (calc.over_cap) {
      toast.error(`Descuento máximo permitido: ${cap}%`)
      return
    }
    startTransition(async () => {
      const res = await generarVersionPropuesta(negocioBloqueId, {
        descuento_pct: calc.descuento_pct,
      })
      if (res.ok) {
        toast.success(`Versión v${res.version?.n} generada`)
      } else {
        toast.error(res.error ?? 'Error generando PDF')
      }
    })
  }

  const handleAprobar = () => {
    const versionActiva = data.version_activa ?? ultimaVersion?.n
    if (!versionActiva) {
      toast.error('No hay versión para aprobar')
      return
    }
    if (!confirm(`¿Aprobar versión v${versionActiva} por ${formatCOP(ultimaVersion!.valor_final)}? Esto cerrará el bloque y establecerá el precio del negocio.`)) {
      return
    }
    startTransition(async () => {
      const res = await aprobarVersionPropuesta(negocioBloqueId, versionActiva)
      if (res.ok) {
        toast.success('Propuesta aprobada')
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
    return (
      <div className="space-y-3">
        {aprobada && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              Aprobada v{data.aprobado_version} —{' '}
              <strong>{versionMostrar ? formatCOP(versionMostrar.valor_final) : ''}</strong>
              {data.aprobado_at && ` · ${formatFechaCorta(data.aprobado_at)}`}
            </span>
          </div>
        )}
        {versiones.length > 0 ? (
          <VersionList versiones={versiones} aprobadaN={data.aprobado_version} />
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
          {/* Inputs sincronizados */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Descuento %
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={cap}
                  value={descPctInput}
                  onChange={e => onChangeDescuento(e.target.value)}
                  className={`w-full rounded-md border bg-background py-2 pl-3 pr-7 text-sm ${
                    calc.over_cap ? 'border-red-500' : ''
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Cap: {cap}%</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Valor final con IVA
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={valorFinalInput}
                  onChange={e => onChangeValorFinal(e.target.value)}
                  className={`w-full rounded-md border bg-background py-2 pl-7 pr-3 text-sm ${
                    calc.over_cap ? 'border-red-500' : ''
                  }`}
                />
              </div>
            </div>
          </div>

          {calc.over_cap && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Descuento {calc.descuento_pct}% excede el cap permitido ({cap}%)</span>
            </div>
          )}

          {/* Resumen calculado */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Plan 1 — Tarifa plena</p>
                <p className="text-base font-medium">{formatCOP(calc.plan1)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Anticipo 50%: {formatCOP(calc.anticipo)}
                  <br />
                  Éxito IVA 50%: {formatCOP(calc.exito_iva)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Plan 2 — Con {calc.descuento_pct}% descuento
                </p>
                <p className="text-base font-medium text-green-700">
                  {formatCOP(calc.plan2)}
                </p>
                <p className="mt-1 text-xs text-green-700">
                  Ahorro: {formatCOP(calc.ahorro)}
                </p>
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleGenerar}
              disabled={isPending || calc.over_cap || (!hayCambios && versiones.length > 0)}
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
              <button
                onClick={handleAprobar}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-green-600 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                Aprobar v{ultimaVersion?.n}
              </button>
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
          <VersionList versiones={versiones} aprobadaN={data.aprobado_version} />
        </div>
      )}
    </div>
  )
}

function VersionList({
  versiones,
  aprobadaN,
}: {
  versiones: PropuestaVersion[]
  aprobadaN?: number | null
}) {
  return (
    <ul className="space-y-1.5">
      {versiones.map(v => (
        <li
          key={v.n}
          className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
            aprobadaN === v.n ? 'border-green-300 bg-green-50' : ''
          }`}
        >
          <span className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded-md bg-foreground/10 px-2 text-xs font-mono">
            v{v.n}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{formatCOP(v.valor_final)}</p>
            <p className="text-xs text-muted-foreground">
              {v.descuento_pct}% descuento · {formatFechaCorta(v.generated_at)}
              {aprobadaN === v.n && (
                <span className="ml-2 text-green-700">· Aprobada</span>
              )}
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
      ))}
    </ul>
  )
}
