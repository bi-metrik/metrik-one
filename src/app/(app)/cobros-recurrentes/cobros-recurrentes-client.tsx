'use client'

import { useState, useMemo, useTransition } from 'react'
import { Receipt, ExternalLink, Filter, FileCheck2, Clock, Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { aprobarYEnviarCuentaCobro } from '@/lib/actions/cuentas-cobro-actions'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

const MESES_NOMBRES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

type Cuenta = {
  id: string
  numero: string
  anio: number
  mes: number
  monto_total: number | string
  estado: string
  fecha_emision: string
  fecha_vencimiento: string
  pdf_drive_url: string | null
  email_destinatarios: string[] | null
  email_enviado_at: string | null
  pagado_at: string | null
  conciliado_at: string | null
  empresa_id_pagador: string
  cobros_ids: string[]
  empresas: {
    id: string
    nombre: string
    razon_social: string | null
    codigo: string | null
  } | null
}

interface Props {
  cuentas: Cuenta[]
  role: string
}

const ESTADOS_INFO: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  borrador: { label: 'Borrador', color: 'text-muted-foreground', icon: FileCheck2 },
  emitida_pendiente_aprobacion: { label: 'Pendiente aprobación', color: 'text-[#F59E0B]', icon: Clock },
  aprobada_lista_envio: { label: 'Lista para envío', color: 'text-[#10B981]', icon: Send },
  enviada: { label: 'Enviada', color: 'text-blue-500', icon: Send },
  pagada: { label: 'Pagada', color: 'text-[#10B981]', icon: CheckCircle2 },
  conciliada: { label: 'Conciliada', color: 'text-[#059669]', icon: CheckCircle2 },
  anulada: { label: 'Anulada', color: 'text-destructive', icon: AlertCircle },
}

function formatCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

function formatFecha(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

export default function CobrosRecurrentesClient({ cuentas, role }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<string>('todos')
  const [filtroAnio, setFiltroAño] = useState<number>(new Date().getFullYear())
  const [aprobandoId, setAprobandoId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const handleAprobar = (cuentaId: string, numero: string, destinatarios: string[] | null) => {
    const destLabel = destinatarios && destinatarios.length > 0
      ? destinatarios.join(', ')
      : 'el cliente'
    if (!window.confirm(`Aprobar y enviar cuenta ${numero} a ${destLabel}?`)) return
    setAprobandoId(cuentaId)
    startTransition(async () => {
      const res = await aprobarYEnviarCuentaCobro(cuentaId)
      setAprobandoId(null)
      if (res.success) {
        toast.success(`Cuenta ${numero} aprobada y enviada`)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const cuentasFiltradas = useMemo(() => {
    return cuentas.filter(c => {
      if (filtroEstado !== 'todos' && c.estado !== filtroEstado) return false
      if (c.anio !== filtroAnio) return false
      return true
    })
  }, [cuentas, filtroEstado, filtroAnio])

  const stats = useMemo(() => {
    const pendientesAprobacion = cuentasFiltradas.filter(c => c.estado === 'emitida_pendiente_aprobacion').length
    const enviadas = cuentasFiltradas.filter(c => c.estado === 'enviada').length
    const pagadas = cuentasFiltradas.filter(c => c.estado === 'pagada' || c.estado === 'conciliada').length
    const totalCobrado = cuentasFiltradas
      .filter(c => c.estado === 'pagada' || c.estado === 'conciliada')
      .reduce((sum, c) => sum + Number(c.monto_total), 0)
    return { pendientesAprobacion, enviadas, pagadas, totalCobrado }
  }, [cuentasFiltradas])

  const aniosDisponibles = useMemo(() => {
    const set = new Set(cuentas.map(c => c.anio))
    set.add(new Date().getFullYear())
    return Array.from(set).sort((a, b) => b - a)
  }, [cuentas])

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" /> Cuentas de cobro
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cuentas mensuales emitidas a clientes con acuerdos recurrentes. El cron del día 15 las genera automáticamente.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 border border-border rounded-lg bg-card">
          <div className="text-xs text-muted-foreground">Pendientes aprobación</div>
          <div className="text-2xl font-bold text-[#F59E0B] mt-1">{stats.pendientesAprobacion}</div>
        </div>
        <div className="p-3 border border-border rounded-lg bg-card">
          <div className="text-xs text-muted-foreground">Enviadas</div>
          <div className="text-2xl font-bold text-blue-500 mt-1">{stats.enviadas}</div>
        </div>
        <div className="p-3 border border-border rounded-lg bg-card">
          <div className="text-xs text-muted-foreground">Pagadas/Conciliadas</div>
          <div className="text-2xl font-bold text-[#10B981] mt-1">{stats.pagadas}</div>
        </div>
        <div className="p-3 border border-border rounded-lg bg-card">
          <div className="text-xs text-muted-foreground">Total cobrado</div>
          <div className="text-base font-bold mt-1">{formatCOP(stats.totalCobrado)}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Filtros:</span>
        </div>
        <select
          value={filtroAnio}
          onChange={e => setFiltroAño(parseInt(e.target.value, 10))}
          className="px-2 py-1 border border-border rounded-md text-xs bg-background"
        >
          {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
          className="px-2 py-1 border border-border rounded-md text-xs bg-background"
        >
          <option value="todos">Todos los estados</option>
          {Object.entries(ESTADOS_INFO).map(([key, info]) => (
            <option key={key} value={key}>{info.label}</option>
          ))}
        </select>
      </div>

      {/* Tabla */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">No.</th>
                <th className="text-left px-3 py-2 font-medium">Cliente</th>
                <th className="text-left px-3 py-2 font-medium">Período</th>
                <th className="text-right px-3 py-2 font-medium">Monto</th>
                <th className="text-left px-3 py-2 font-medium">Estado</th>
                <th className="text-left px-3 py-2 font-medium">Emisión</th>
                <th className="text-left px-3 py-2 font-medium">Vence</th>
                <th className="text-left px-3 py-2 font-medium">PDF</th>
                <th className="text-left px-3 py-2 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {cuentasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Sin cuentas para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                cuentasFiltradas.map(c => {
                  const estadoInfo = ESTADOS_INFO[c.estado] ?? ESTADOS_INFO.borrador
                  const EstadoIcon = estadoInfo.icon
                  const empresaLabel = c.empresas?.razon_social ?? c.empresas?.nombre ?? '?'
                  return (
                    <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs">{c.numero}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{empresaLabel}</div>
                        {c.cobros_ids.length > 1 && (
                          <div className="text-xs text-muted-foreground">
                            {c.cobros_ids.length} conceptos
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">{MESES_NOMBRES[c.mes]} {c.anio}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCOP(Number(c.monto_total))}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${estadoInfo.color}`}>
                          <EstadoIcon className="h-3 w-3" />
                          {estadoInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{formatFecha(c.fecha_emision)}</td>
                      <td className="px-3 py-2 text-xs">{formatFecha(c.fecha_vencimiento)}</td>
                      <td className="px-3 py-2">
                        {c.pdf_drive_url ? (
                          <a
                            href={c.pdf_drive_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                          >
                            Abrir <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {role === 'owner' && c.estado === 'emitida_pendiente_aprobacion' ? (
                          <button
                            type="button"
                            onClick={() => handleAprobar(c.id, c.numero, c.email_destinatarios)}
                            disabled={aprobandoId === c.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#10B981] text-white hover:bg-[#059669] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                          >
                            {aprobandoId === c.id ? (
                              <><Loader2 className="h-3 w-3 animate-spin" /> Enviando…</>
                            ) : (
                              <><Send className="h-3 w-3" /> Aprobar y enviar</>
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nota informativa */}
      <p className="text-xs text-muted-foreground">
        El cron diario evalúa cobros del mes y, el día 15, emite automáticamente las cuentas agrupando por empresa pagadora.
        Las cuentas se notifican para aprobación antes de enviar por email al cliente.
        {role !== 'owner' && role !== 'admin' && (
          <span className="block mt-1">Solo owner y admin pueden aprobar y enviar.</span>
        )}
      </p>
    </div>
  )
}
