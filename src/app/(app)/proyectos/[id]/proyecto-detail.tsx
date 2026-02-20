'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, FolderOpen, Clock, Receipt, Banknote, Pause, Play,
  Lock, Plus, TrendingUp, TrendingDown, FileText, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { updateAvance, cambiarEstadoProyecto } from '../actions-v2'
import { formatCOP } from '@/lib/contacts/constants'
import { ESTADO_PROYECTO_CONFIG } from '@/lib/pipeline/constants'
import type { EstadoProyecto } from '@/lib/pipeline/constants'
import ProyectoAlertas from './proyecto-alertas'
import GastoDialog from './gasto-dialog'
import HorasDialog from './horas-dialog'
import FacturaDialog from './factura-dialog'
import CobroDialog from './cobro-dialog'
import CierreDialog from './cierre-dialog'

// ── Types ─────────────────────────────────────────────

interface Financiero {
  proyecto_id: string | null
  nombre: string | null
  estado: string | null
  presupuesto_total: number | null
  avance_porcentaje: number | null
  presupuesto_consumido_pct: number | null
  costo_acumulado: number | null
  costo_horas: number | null
  gastos_directos: number | null
  facturado: number | null
  cobrado: number | null
  cartera: number | null
  por_facturar: number | null
  ganancia_real: number | null
  ganancia_estimada: number | null
  horas_estimadas: number | null
  horas_reales: number | null
  empresa_nombre: string | null
  contacto_nombre: string | null
  carpeta_url: string | null
  oportunidad_id: string | null
}

interface Rubro {
  rubro_id: string | null
  rubro_nombre: string | null
  rubro_tipo: string | null
  presupuestado: number | null
  gastado_real: number | null
  diferencia: number | null
  consumido_pct: number | null
}

interface Factura {
  factura_id: string | null
  numero_factura: string | null
  monto: number | null
  cobrado: number | null
  saldo_pendiente: number | null
  estado_pago: string | null
  dias_antiguedad: number | null
  fecha_emision: string | null
}

interface TimelineEntry {
  id: string
  tipo: 'horas' | 'gasto' | 'cobro'
  fecha: string
  descripcion: string
  valor: number
}

interface RubroLista {
  id: string
  nombre: string
  tipo: string | null
  presupuestado: number | null
}

interface Props {
  financiero: Financiero
  rubros: Rubro[]
  facturas: Factura[]
  timeline: TimelineEntry[]
  rubrosLista: RubroLista[]
}

// ── Component ─────────────────────────────────────────

export default function ProyectoDetail({
  financiero: f,
  rubros,
  facturas,
  timeline,
  rubrosLista,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [avance, setAvance] = useState(f.avance_porcentaje ?? 0)
  const [dialog, setDialog] = useState<'gasto' | 'horas' | 'factura' | 'cobro' | 'cierre' | null>(null)

  const estado = (f.estado ?? 'en_ejecucion') as EstadoProyecto
  const config = ESTADO_PROYECTO_CONFIG[estado]
  const isCerrado = estado === 'cerrado'
  const isPausado = estado === 'pausado'
  const proyectoId = f.proyecto_id ?? ''

  const consumo = Math.min(f.presupuesto_consumido_pct ?? 0, 150)
  const semaforoBar = consumo > 90 ? 'bg-red-500' : consumo > 70 ? 'bg-yellow-500' : 'bg-green-500'
  const ganancia = f.ganancia_real ?? 0

  const handleAvanceChange = (newVal: number) => {
    setAvance(newVal)
    startTransition(async () => {
      const res = await updateAvance(proyectoId, newVal)
      if (!res.success) toast.error(res.error)
    })
  }

  const handleEstado = (nuevoEstado: 'pausado' | 'en_ejecucion') => {
    startTransition(async () => {
      const res = await cambiarEstadoProyecto(proyectoId, nuevoEstado)
      if (res.success) {
        toast.success(nuevoEstado === 'pausado' ? 'Proyecto pausado' : 'Proyecto reanudado')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-3">
        <Link
          href="/proyectos"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-lg font-bold">{f.nombre ?? 'Sin nombre'}</h1>
          <div className="flex items-center gap-2">
            {config && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${config.chipClass}`}>
                {config.label}
              </span>
            )}
            {f.empresa_nombre && (
              <span className="text-xs text-muted-foreground">{f.empresa_nombre}</span>
            )}
          </div>
        </div>
        {f.carpeta_url && (
          <a
            href={f.carpeta_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Abrir carpeta"
          >
            <FolderOpen className="h-5 w-5" />
          </a>
        )}
      </div>

      {/* ─── Alertas ─── */}
      <ProyectoAlertas financiero={f} facturas={facturas} />

      {/* ─── Barras duales ─── */}
      <div className="space-y-3 rounded-lg border p-4">
        {/* Avance slider (editable only if not cerrado) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium">Avance del proyecto</span>
            <span className="text-xs font-semibold">{avance}%</span>
          </div>
          {!isCerrado ? (
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={avance}
              onChange={e => handleAvanceChange(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none bg-muted accent-blue-500"
            />
          ) : (
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${avance}%` }} />
            </div>
          )}
        </div>

        {/* Presupuesto consumido (read-only) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium">Presupuesto consumido</span>
            <span className="text-xs font-semibold">{consumo}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${semaforoBar}`} style={{ width: `${Math.min(consumo, 100)}%` }} />
          </div>
        </div>
      </div>

      {/* ─── Resumen financiero ─── */}
      <div className="grid grid-cols-2 gap-2">
        <FinCard label="Presupuesto" value={f.presupuesto_total} />
        <FinCard label="Costo acumulado" value={f.costo_acumulado} warning={consumo > 90} />
        <FinCard label="Facturado" value={f.facturado} />
        <FinCard label="Cobrado" value={f.cobrado} />
        <FinCard label="Cartera" value={f.cartera} />
        <FinCard label="Por facturar" value={f.por_facturar} />
        <div className="col-span-2 rounded-lg border p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {ganancia >= 0
              ? <TrendingUp className="h-4 w-4 text-green-600" />
              : <TrendingDown className="h-4 w-4 text-red-600" />}
            <span className="text-xs font-medium">Ganancia actual</span>
          </div>
          <span className={`text-sm font-bold ${ganancia >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {ganancia >= 0 ? '+' : ''}{formatCOP(ganancia)}
          </span>
        </div>
      </div>

      {/* ─── Presupuesto vs Real por rubro ─── */}
      {rubros.length > 1 && (
        <div className="space-y-2 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Presupuesto vs Real por rubro</h2>
          <div className="space-y-2">
            {rubros.map(r => {
              const pct = r.consumido_pct ?? 0
              const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500'
              return (
                <div key={r.rubro_id}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate font-medium">{r.rubro_nombre}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatCOP(r.gastado_real ?? 0)} / {formatCOP(r.presupuestado ?? 0)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── Facturas ─── */}
      <div className="space-y-2 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Facturas ({facturas.length})</h2>
          {!isCerrado && (
            <button
              onClick={() => setDialog('factura')}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3 w-3" />
              Factura
            </button>
          )}
        </div>
        {facturas.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">Sin facturas</p>
        ) : (
          <div className="space-y-1.5">
            {facturas.map(fac => {
              const estadoPago = fac.estado_pago ?? 'pendiente'
              const estadoColor = estadoPago === 'pagada'
                ? 'bg-green-100 text-green-700'
                : estadoPago === 'parcial'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-600'
              const dias = fac.dias_antiguedad ?? 0

              return (
                <div
                  key={fac.factura_id}
                  className="flex items-center justify-between rounded-md border p-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      <span className="text-xs font-medium truncate">
                        {fac.numero_factura || 'Sin numero'}
                      </span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${estadoColor}`}>
                        {estadoPago === 'pagada' ? 'Pagada' : estadoPago === 'parcial' ? 'Parcial' : 'Pendiente'}
                      </span>
                      {dias > 60 && estadoPago !== 'pagada' && (
                        <span title={`${dias} dias`}>
                          <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatCOP(fac.cobrado ?? 0)} cobrado de {formatCOP(fac.monto ?? 0)}
                    </p>
                  </div>
                  {estadoPago !== 'pagada' && (
                    <button
                      onClick={() => setDialog('cobro')}
                      className="shrink-0 rounded-md p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                      title="Registrar cobro"
                    >
                      <Banknote className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Últimos registros (timeline) ─── */}
      <div className="space-y-2 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Ultimos registros</h2>
        {timeline.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">Sin registros</p>
        ) : (
          <div className="space-y-1.5">
            {timeline.map(t => {
              const icon = t.tipo === 'horas'
                ? <Clock className="h-3.5 w-3.5 text-blue-500" />
                : t.tipo === 'gasto'
                  ? <Receipt className="h-3.5 w-3.5 text-orange-500" />
                  : <Banknote className="h-3.5 w-3.5 text-green-500" />
              const valueText = t.tipo === 'horas'
                ? `${t.valor}h`
                : formatCOP(t.valor)

              return (
                <div key={t.id} className="flex items-center justify-between rounded-md p-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {icon}
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{t.descripcion}</p>
                      <p className="text-[10px] text-muted-foreground">{t.fecha}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-medium">{valueText}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Bottom action bar ─── */}
      <div className="flex items-center gap-2 rounded-lg border p-3">
        {!isCerrado && !isPausado && (
          <>
            <button
              onClick={() => setDialog('gasto')}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              <Receipt className="h-3.5 w-3.5" />
              Gasto
            </button>
            <button
              onClick={() => setDialog('horas')}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              <Clock className="h-3.5 w-3.5" />
              Horas
            </button>
          </>
        )}
        {!isCerrado && (
          <>
            <button
              onClick={() => setDialog('cobro')}
              disabled={isPending || facturas.length === 0}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
              title={facturas.length === 0 ? 'Primero crea una factura' : 'Registrar cobro'}
            >
              <Banknote className="h-3.5 w-3.5" />
              Cobro
            </button>
            {isPausado ? (
              <button
                onClick={() => handleEstado('en_ejecucion')}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                Reanudar
              </button>
            ) : (
              <button
                onClick={() => handleEstado('pausado')}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-200 px-3 py-2 text-xs font-medium text-yellow-700 hover:bg-yellow-50 disabled:opacity-50"
              >
                <Pause className="h-3.5 w-3.5" />
                Pausar
              </button>
            )}
            <button
              onClick={() => setDialog('cierre')}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 px-3 py-2 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
            >
              <Lock className="h-3.5 w-3.5" />
              Cerrar
            </button>
          </>
        )}
        {/* Cobro allowed on closed projects */}
        {isCerrado && facturas.some(f => f.estado_pago !== 'pagada') && (
          <button
            onClick={() => setDialog('cobro')}
            disabled={isPending}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Banknote className="h-3.5 w-3.5" />
            Registrar cobro pendiente
          </button>
        )}
      </div>

      {/* ─── Dialogs ─── */}
      {dialog === 'gasto' && (
        <GastoDialog
          proyectoId={proyectoId}
          rubrosLista={rubrosLista}
          onClose={() => { setDialog(null); router.refresh() }}
        />
      )}
      {dialog === 'horas' && (
        <HorasDialog
          proyectoId={proyectoId}
          onClose={() => { setDialog(null); router.refresh() }}
        />
      )}
      {dialog === 'factura' && (
        <FacturaDialog
          proyectoId={proyectoId}
          presupuesto={f.presupuesto_total ?? 0}
          facturado={f.facturado ?? 0}
          onClose={() => { setDialog(null); router.refresh() }}
        />
      )}
      {dialog === 'cobro' && (
        <CobroDialog
          facturas={facturas.filter(fa => fa.estado_pago !== 'pagada')}
          onClose={() => { setDialog(null); router.refresh() }}
        />
      )}
      {dialog === 'cierre' && (
        <CierreDialog
          proyectoId={proyectoId}
          financiero={f}
          onClose={() => { setDialog(null); router.refresh() }}
        />
      )}
    </div>
  )
}

// ── Financial summary card ────────────────────────────

function FinCard({ label, value, warning }: { label: string; value: number | null; warning?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warning ? 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20' : ''}`}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold mt-0.5">{formatCOP(value ?? 0)}</p>
    </div>
  )
}
