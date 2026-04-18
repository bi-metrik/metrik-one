'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Clock, ChevronLeft, ChevronRight, Filter, ShieldCheck, ShieldX,
  RotateCcw, AlertTriangle, FolderKanban, User, CheckCircle2,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { getRolePermissions } from '@/lib/roles'
import { formatCOP } from '@/lib/contacts/constants'
import type { HoraEntry } from './actions'
import {
  aprobarHora, rechazarHora, revertirHora, aprobarTodasHoras, getStaffResumen,
} from './actions'

// ── Props ──────────────────────────────────────────────

interface Props {
  horas: HoraEntry[]
  totales: { totalHoras: number; totalCosto: number; pendientes: number }
  filtroMes: string
  filtroStaff: string
  filtroProyecto: string
  filtroEstado: string
  staffList: { id: string; nombre: string }[]
  proyectos: { id: string; nombre: string; codigo: string }[]
  role: string
}

// ── Component ──────────────────────────────────────────

export default function EquipoClient({
  horas, totales, filtroMes, filtroStaff, filtroProyecto, filtroEstado,
  staffList, proyectos, role,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [showFilters, setShowFilters] = useState(
    filtroStaff !== 'todos' || filtroProyecto !== 'todos' || filtroEstado !== 'todos'
  )

  // Dialogs
  const [rechazoDialog, setRechazoDialog] = useState<{ id: string } | null>(null)
  const [rechazoMotivo, setRechazoMotivo] = useState('')
  const [revertirDialog, setRevertirDialog] = useState<{ id: string } | null>(null)
  const [revertirMotivo, setRevertirMotivo] = useState('')

  // Staff profile sheet
  const [staffProfile, setStaffProfile] = useState<Awaited<ReturnType<typeof getStaffResumen>> | null>(null)
  const [staffProfileOpen, setStaffProfileOpen] = useState(false)

  const perms = getRolePermissions(role)
  const canApprove = perms.canApproveCausacion
  const canRevert = perms.canRevertApproval

  // ── Navigation ──────────────────────────────────────

  function navigate(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'todos') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    router.push(`/equipo?${params.toString()}`)
  }

  function changeMonth(delta: number) {
    const [y, m] = filtroMes.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    navigate('mes', d.toISOString().slice(0, 7))
  }

  const mesLabel = new Date(filtroMes + '-15').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })

  // Active filter count
  const activeFilterCount = [filtroStaff, filtroProyecto, filtroEstado].filter(f => f !== 'todos').length

  // ── Actions ─────────────────────────────────────────

  function handleAprobar(id: string) {
    startTransition(async () => {
      const res = await aprobarHora(id)
      if (res.success) toast.success('Hora aprobada')
      else toast.error(res.error)
    })
  }

  function handleRechazar() {
    if (!rechazoDialog || !rechazoMotivo.trim()) return
    startTransition(async () => {
      const res = await rechazarHora(rechazoDialog.id, rechazoMotivo)
      if (res.success) { toast.success('Hora rechazada'); setRechazoDialog(null); setRechazoMotivo('') }
      else toast.error(res.error)
    })
  }

  function handleRevertir() {
    if (!revertirDialog || !revertirMotivo.trim()) return
    startTransition(async () => {
      const res = await revertirHora(revertirDialog.id, revertirMotivo)
      if (res.success) { toast.success('Aprobacion revertida'); setRevertirDialog(null); setRevertirMotivo('') }
      else toast.error(res.error)
    })
  }

  function handleAprobarTodas() {
    const pendientes = horas.filter(h => h.estado_aprobacion === 'PENDIENTE')
    if (pendientes.length === 0) return
    startTransition(async () => {
      const res = await aprobarTodasHoras(pendientes.map(h => h.id))
      if (res.success) toast.success(`${res.count} horas aprobadas`)
      else toast.error(res.error)
    })
  }

  function handleOpenStaffProfile(staffId: string) {
    startTransition(async () => {
      const data = await getStaffResumen(staffId, filtroMes)
      if (data) {
        setStaffProfile(data)
        setStaffProfileOpen(true)
      }
    })
  }

  // ── Render ──────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Equipo</h1>
      </div>

      {/* Month selector */}
      <div className="flex items-center justify-between">
        <button onClick={() => changeMonth(-1)} className="p-1.5 rounded-lg hover:bg-muted">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold capitalize">{mesLabel}</span>
        <button onClick={() => changeMonth(1)} className="p-1.5 rounded-lg hover:bg-muted">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Horas</p>
          <p className="text-lg font-bold tabular-nums">{totales.totalHoras.toFixed(1)}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Costo</p>
          <p className="text-lg font-bold tabular-nums">{formatCOP(totales.totalCosto)}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Pendientes</p>
          <p className={`text-lg font-bold tabular-nums ${totales.pendientes > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
            {totales.pendientes}
          </p>
        </div>
      </div>

      {/* Filters toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Filter className="h-3.5 w-3.5" />
          Filtros
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>
        {canApprove && totales.pendientes > 0 && (
          <button
            onClick={handleAprobarTodas}
            disabled={isPending}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Aprobar todas ({totales.pendientes})
          </button>
        )}
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={filtroStaff}
              onChange={e => navigate('staff', e.target.value)}
              className="rounded-md border px-2 py-1.5 text-xs bg-background"
            >
              <option value="todos">Todos los miembros</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <select
              value={filtroProyecto}
              onChange={e => navigate('proyecto', e.target.value)}
              className="rounded-md border px-2 py-1.5 text-xs bg-background"
            >
              <option value="todos">Todos los proyectos</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.codigo} {p.nombre}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filtroEstado}
              onChange={e => navigate('estado', e.target.value)}
              className="rounded-md border px-2 py-1.5 text-xs bg-background"
            >
              <option value="todos">Todos los estados</option>
              <option value="PENDIENTE">Pendientes</option>
              <option value="APROBADO">Aprobadas</option>
              <option value="RECHAZADO">Rechazadas</option>
            </select>
            {activeFilterCount > 0 && (
              <button
                onClick={() => router.push(`/equipo?mes=${filtroMes}`)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hours list */}
      <div className="space-y-2">
        {horas.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Sin horas registradas este mes</p>
          </div>
        ) : (
          horas.map(h => (
            <div
              key={h.id}
              className={`rounded-lg border p-3 space-y-1.5 ${
                h.estado_aprobacion === 'PENDIENTE' ? 'border-amber-200 bg-amber-50/30 dark:border-amber-900/30 dark:bg-amber-950/10' : ''
              }`}
            >
              {/* Line 1: horas + descripcion + costo */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock className="h-4 w-4 shrink-0 text-blue-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {h.descripcion || 'Horas registradas'}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{h.horas}h</p>
                  {h.costo > 0 && (
                    <p className="text-[10px] text-muted-foreground tabular-nums">{formatCOP(h.costo)}</p>
                  )}
                </div>
              </div>

              {/* Line 2: proyecto + fecha */}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {h.proyecto_codigo && (
                  <>
                    <FolderKanban className="h-3 w-3 shrink-0" />
                    <span className="font-medium text-foreground">{h.proyecto_codigo}</span>
                    <span className="truncate">{h.proyecto_nombre}</span>
                  </>
                )}
                <span className="ml-auto shrink-0">{new Date(h.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</span>
              </div>

              {/* Line 3: staff */}
              {h.staff_name && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <User className="h-3 w-3 shrink-0" />
                  <button
                    onClick={() => h.staff_id && handleOpenStaffProfile(h.staff_id)}
                    className="truncate hover:text-foreground hover:underline"
                  >
                    {h.staff_name}
                  </button>
                </div>
              )}

              {/* Badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {h.estado_aprobacion === 'RECHAZADO' && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 text-[10px]">
                    Rechazada{h.rechazo_motivo && `: ${h.rechazo_motivo}`}
                  </span>
                )}
                {h.estado_aprobacion === 'APROBADO' && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 text-[10px]">
                    Aprobada
                  </span>
                )}
                {h.estado_aprobacion === 'PENDIENTE' && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 text-[10px]">
                    Pendiente
                  </span>
                )}
              </div>

              {/* Action buttons */}
              {(canApprove || canRevert) && (
                <div className="flex items-center gap-2 border-t pt-2 mt-1">
                  {canApprove && h.estado_aprobacion === 'PENDIENTE' && (
                    <>
                      <button
                        onClick={() => handleAprobar(h.id)}
                        disabled={isPending}
                        className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Aprobar
                      </button>
                      <button
                        onClick={() => { setRechazoDialog({ id: h.id }); setRechazoMotivo('') }}
                        disabled={isPending}
                        className="flex items-center gap-1 text-[11px] font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
                      >
                        <ShieldX className="h-3.5 w-3.5" />
                        Rechazar
                      </button>
                    </>
                  )}
                  {canRevert && h.estado_aprobacion === 'APROBADO' && (
                    <button
                      onClick={() => { setRevertirDialog({ id: h.id }); setRevertirMotivo('') }}
                      disabled={isPending}
                      className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-red-600 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Revertir
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Rechazo Dialog ── */}
      <Dialog open={!!rechazoDialog} onOpenChange={open => !open && setRechazoDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="text-base font-semibold">Rechazar horas</DialogTitle>
          <p className="text-sm text-muted-foreground">Indica el motivo del rechazo.</p>
          <textarea
            value={rechazoMotivo}
            onChange={e => setRechazoMotivo(e.target.value)}
            placeholder="Motivo del rechazo..."
            className="w-full rounded-md border px-3 py-2 text-sm min-h-[80px] bg-background"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setRechazoDialog(null)} className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted">
              Cancelar
            </button>
            <button
              onClick={handleRechazar}
              disabled={!rechazoMotivo.trim() || isPending}
              className="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              Rechazar
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Revertir Dialog ── */}
      <Dialog open={!!revertirDialog} onOpenChange={open => !open && setRevertirDialog(null)}>
        <DialogContent className="max-w-sm">
          <div className="flex items-center gap-2 mb-1">
            <div className="rounded-full bg-amber-100 p-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            </div>
            <DialogTitle className="text-base font-semibold">Revertir aprobacion</DialogTitle>
          </div>
          <p className="text-sm text-muted-foreground">Esta accion devolvera las horas a estado rechazado. Indica el motivo.</p>
          <textarea
            value={revertirMotivo}
            onChange={e => setRevertirMotivo(e.target.value)}
            placeholder="Motivo de la reversion..."
            className="w-full rounded-md border px-3 py-2 text-sm min-h-[80px] bg-background"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setRevertirDialog(null)} className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted">
              Cancelar
            </button>
            <button
              onClick={handleRevertir}
              disabled={!revertirMotivo.trim() || isPending}
              className="px-3 py-1.5 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Revertir
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Staff Profile Dialog ── */}
      <Dialog open={staffProfileOpen} onOpenChange={setStaffProfileOpen}>
        <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
          {staffProfile && (
            <>
              <DialogTitle className="text-base font-semibold">{staffProfile.staff.nombre}</DialogTitle>
              <p className="text-xs text-muted-foreground capitalize">{staffProfile.staff.tipo_vinculo ?? 'Staff'} {staffProfile.staff.es_principal && ' — Principal'}</p>

              {/* Monthly metrics */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="rounded-lg border p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Aprobadas</p>
                  <p className="text-sm font-bold text-emerald-600">{staffProfile.horas.aprobadas.toFixed(1)}h</p>
                </div>
                <div className="rounded-lg border p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Pendientes</p>
                  <p className="text-sm font-bold text-amber-600">{staffProfile.horas.pendientes.toFixed(1)}h</p>
                </div>
                <div className="rounded-lg border p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Rechazadas</p>
                  <p className="text-sm font-bold text-red-500">{staffProfile.horas.rechazadas.toFixed(1)}h</p>
                </div>
              </div>

              {/* Capacity bar */}
              {staffProfile.staff.horas_disponibles && staffProfile.staff.horas_disponibles > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Capacidad del mes</span>
                    <span className="font-medium tabular-nums">
                      {staffProfile.horas.aprobadas.toFixed(1)} / {staffProfile.staff.horas_disponibles}h
                      <span className="text-muted-foreground ml-1">
                        ({Math.round((staffProfile.horas.aprobadas / staffProfile.staff.horas_disponibles) * 100)}%)
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        staffProfile.horas.aprobadas / staffProfile.staff.horas_disponibles > 0.9
                          ? 'bg-red-500'
                          : staffProfile.horas.aprobadas / staffProfile.staff.horas_disponibles > 0.7
                            ? 'bg-yellow-500'
                            : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min((staffProfile.horas.aprobadas / staffProfile.staff.horas_disponibles) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Cost */}
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Costo del mes</span>
                <span className="font-semibold tabular-nums">{formatCOP(staffProfile.costo)}</span>
              </div>
              {staffProfile.staff.tarifa_hora > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Tarifa/hora</span>
                  <span className="tabular-nums">{formatCOP(staffProfile.staff.tarifa_hora)}</span>
                </div>
              )}

              {/* By project */}
              {staffProfile.porProyecto.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium mb-2">Distribucion por proyecto</p>
                  <div className="space-y-1.5">
                    {staffProfile.porProyecto.map((p, i) => {
                      const totalAprobadas = staffProfile!.horas.aprobadas || 1
                      const pct = Math.round((p.horas / totalAprobadas) * 100)
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="truncate">
                              {p.codigo && <span className="font-medium mr-1">{p.codigo}</span>}
                              {p.nombre}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{p.horas.toFixed(1)}h ({pct}%)</span>
                          </div>
                          <div className="h-1 rounded-full bg-muted overflow-hidden mt-0.5">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
