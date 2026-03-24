'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Phone, X, Check, ChevronDown, ChevronUp, Mail, UserPlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Staff } from '@/types/database'
import { createStaffMember, updateStaffMember, deleteStaffMember, inviteStaffToPlataform } from './staff-actions'

interface StaffSectionProps {
  initialData: Staff[]
  licenseUsed: number
  licenseMax: number
  currentUserRole: string
}

const TIPO_VINCULO = [
  { value: 'empleado', label: 'Empleado', defaultHoras: 160 },
  { value: 'contratista', label: 'Contratista', defaultHoras: 0 },
  { value: 'freelance', label: 'Freelance', defaultHoras: 0 },
  { value: 'obra', label: 'Obra labor', defaultHoras: 0 },
]

const ROL_OPTIONS = [
  { value: 'administrador', label: 'Administrador', desc: 'Maneja finanzas, contabilidad y equipo. Acceso total excepto config fiscal.' },
  { value: 'supervisor', label: 'Supervisor', desc: 'Ve todo el trabajo. Asigna responsables, crea oportunidades y cotizaciones.' },
  { value: 'ejecutor', label: 'Ejecutor', desc: 'Trabaja en oportunidades y proyectos asignados. Registra gastos y horas.' },
  { value: 'contador', label: 'Contador', desc: 'Solo acceso al modulo de causacion contable. Ilimitado, no afecta el plan.' },
  { value: 'campo', label: 'Campo', desc: 'Solo reporta via WhatsApp. Registra gastos y horas en proyectos activos.' },
]

// Display labels for all roles (including dueno which is not in the form dropdown)
const ROL_DISPLAY: Record<string, string> = {
  dueno: 'Empresario',
  administrador: 'Administrador',
  supervisor: 'Supervisor',
  ejecutor: 'Ejecutor',
  contador: 'Contador',
  campo: 'Campo',
}

// Color classes per role — Ren's palette
const ROL_COLORS: Record<string, string> = {
  dueno: 'bg-primary/10 text-primary',
  administrador: 'bg-violet-100 text-violet-700',
  supervisor: 'bg-amber-100 text-amber-700',
  ejecutor: 'bg-sky-100 text-sky-700',
  campo: 'bg-orange-100 text-orange-700',
}

const AREA_OPTIONS = [
  { value: 'comercial', label: 'Comercial', desc: 'Ventas, atención al cliente, cotizaciones, seguimiento de oportunidades.' },
  { value: 'operaciones', label: 'Operaciones', desc: 'Ejecución de proyectos, coordinación de campo, producción.' },
  { value: 'admin_finanzas', label: 'Admin y Finanzas', desc: 'Contabilidad, facturación, cartera, nómina, RRHH.' },
  { value: 'direccion', label: 'Direccion', desc: 'Gerencia general, socios, decisiones estratégicas.' },
]

// Color classes per area
const AREA_COLORS: Record<string, string> = {
  comercial: 'bg-emerald-50 text-emerald-600',
  operaciones: 'bg-slate-100 text-slate-600',
  admin_finanzas: 'bg-blue-50 text-blue-600',
  direccion: 'bg-primary/10 text-primary',
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function StaffSection({ initialData, licenseUsed, licenseMax, currentUserRole }: StaffSectionProps) {
  const router = useRouter()
  const [staff, setStaff] = useState<Staff[]>(initialData)
  const [showForm, setShowForm] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    position: '',
    contract_type: 'fijo',
    salary: 0,
    phone_whatsapp: '',
    horas_disponibles_mes: 160,
    tipo_vinculo: '',
    rol_plataforma: 'ejecutor',
    area: 'operaciones',
    display_role: '',
  })

  // Sync state when server re-renders with new data
  useEffect(() => {
    setStaff(initialData)
  }, [initialData])

  const resetForm = () => {
    setForm({ full_name: '', position: '', contract_type: 'fijo', salary: 0, phone_whatsapp: '', horas_disponibles_mes: 160, tipo_vinculo: '', rol_plataforma: 'ejecutor', area: 'operaciones', display_role: '' })
    setShowForm(false)
    setShowDetails(false)
    setEditingId(null)
  }

  const handleCreate = async () => {
    if (!form.full_name.trim()) return
    setSaving(true)
    const res = await createStaffMember({
      ...form,
      display_role: form.display_role.trim() || undefined,
    })
    if (res.success) {
      toast.success('Personal agregado')
      resetForm()
      router.refresh()
    } else {
      toast.error(res.error || 'Error al crear')
    }
    setSaving(false)
  }

  const handleUpdate = async () => {
    if (!editingId || !form.full_name.trim()) return
    setSaving(true)
    const res = await updateStaffMember(editingId, {
      full_name: form.full_name,
      position: form.position || null,
      department: null,
      contract_type: form.contract_type,
      salary: form.salary,
      phone_whatsapp: form.phone_whatsapp || null,
      horas_disponibles_mes: form.horas_disponibles_mes,
      tipo_vinculo: form.tipo_vinculo || null,
      rol_plataforma: form.rol_plataforma,
      area: form.area || null,
      display_role: form.display_role.trim() || null,
    })
    if (res.success) {
      toast.success('Personal actualizado')
      resetForm()
      router.refresh()
    } else {
      toast.error(res.error || 'Error al actualizar')
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este miembro del personal?')) return
    const res = await deleteStaffMember(id)
    if (res.success) {
      setStaff(prev => prev.filter(s => s.id !== id))
      toast.success('Personal eliminado')
    } else {
      toast.error(res.error || 'Error al eliminar')
    }
  }

  const handleInvite = async (staffId: string) => {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      toast.error('Ingresa un email valido')
      return
    }
    setSendingInvite(true)
    const res = await inviteStaffToPlataform(staffId, inviteEmail)
    if ('success' in res && res.success) {
      toast.success(`Magic link enviado a ${res.email}`)
      setInvitingId(null)
      setInviteEmail('')
      router.refresh()
    } else {
      toast.error(res.error || 'Error al invitar')
    }
    setSendingInvite(false)
  }

  const startEdit = (s: Staff) => {
    setForm({
      full_name: s.full_name,
      position: s.position || '',
      contract_type: s.contract_type ?? 'fijo',
      salary: s.salary ?? 0,
      phone_whatsapp: s.phone_whatsapp || '',
      horas_disponibles_mes: s.horas_disponibles_mes ?? 160,
      tipo_vinculo: s.tipo_vinculo || '',
      rol_plataforma: s.rol_plataforma || 'ejecutor',
      area: s.area || 'operaciones',
      display_role: (s as any).display_role || '',
    })
    setEditingId(s.id)
    setShowForm(true)
    // Show details if there's data in detail fields
    if (s.phone_whatsapp || (s.salary ?? 0) > 0 || s.tipo_vinculo) {
      setShowDetails(true)
    }
  }

  const handleVinculoChange = (value: string) => {
    const opt = TIPO_VINCULO.find(t => t.value === value)
    setForm(prev => ({
      ...prev,
      tipo_vinculo: value,
      // Auto-set contract_type from vinculo
      contract_type: value === 'empleado' ? 'fijo' : value === 'contratista' ? 'prestacion' : value === 'obra' ? 'obra' : prev.contract_type,
      // Auto-set horas for empleado
      ...(value === 'empleado' && !prev.horas_disponibles_mes ? { horas_disponibles_mes: 160 } : {}),
    }))
  }

  const activeStaff = staff.filter(s => s.is_active)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Personal</h3>
          <p className="text-xs text-muted-foreground">
            {activeStaff.length} miembro{activeStaff.length !== 1 ? 's' : ''} activo{activeStaff.length !== 1 ? 's' : ''}
            {' · '}
            <span className={licenseUsed >= licenseMax ? 'text-red-500 font-medium' : 'text-primary font-medium'}>
              {licenseUsed}/{licenseMax} licencia{licenseMax !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          {/* Esencial: 4 campos */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre completo *</label>
              <input
                type="text"
                value={form.full_name}
                onChange={e => setForm({ ...form, full_name: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Juan Perez"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Cargo</label>
              <input
                type="text"
                value={form.position}
                onChange={e => setForm({ ...form, position: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Disenador"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Rol en plataforma</label>
              <select
                value={form.rol_plataforma}
                onChange={e => setForm({ ...form, rol_plataforma: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {ROL_OPTIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {ROL_OPTIONS.find(r => r.value === form.rol_plataforma)?.desc}
              </p>
              {/* Nota de billing para contador */}
              {form.rol_plataforma === 'contador' && (
                <p className="mt-1 text-[10px] font-medium text-emerald-600">
                  Los usuarios Contador son ilimitados y no afectan tu plan.
                </p>
              )}
            </div>
            {/* Area — solo visible para supervisor (afecta routing N1/N7) */}
            {form.rol_plataforma === 'supervisor' ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Area del supervisor</label>
                <select
                  value={form.area}
                  onChange={e => setForm({ ...form, area: e.target.value })}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Ambas areas</option>
                  {AREA_OPTIONS.filter(a => a.value !== 'direccion').map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {form.area
                    ? AREA_OPTIONS.find(a => a.value === form.area)?.desc
                    : 'Recibe alertas de oportunidades y proyectos'}
                </p>
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Area</label>
                <select
                  value={form.area}
                  onChange={e => setForm({ ...form, area: e.target.value })}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {AREA_OPTIONS.map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {AREA_OPTIONS.find(a => a.value === form.area)?.desc}
                </p>
              </div>
            )}
          </div>

          {/* display_role — nombre personalizado opcional (solo para supervisor) */}
          {form.rol_plataforma === 'supervisor' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre personalizado (opcional)</label>
              <input
                type="text"
                value={form.display_role}
                onChange={e => setForm({ ...form, display_role: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Supervisor"
                maxLength={50}
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Ej: Supervisor Comercial, Jefe de Obra. Se muestra en vez de &quot;Supervisor&quot; en el workspace.
              </p>
            </div>
          )}

          {/* Toggle detalles */}
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showDetails ? 'Ocultar detalles' : 'Detalles (pago, contacto, vinculo)'}
          </button>

          {/* Detalles: colapsable */}
          {showDetails && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-xs font-medium text-muted-foreground">WhatsApp</label>
                <input
                  type="text"
                  value={form.phone_whatsapp}
                  onChange={e => setForm({ ...form, phone_whatsapp: e.target.value })}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="+57 300 123 4567"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Pago mensual</label>
                <input
                  type="number"
                  value={form.salary || ''}
                  onChange={e => setForm({ ...form, salary: Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Horas disponibles/mes</label>
                <input
                  type="number"
                  value={form.horas_disponibles_mes || ''}
                  onChange={e => setForm({ ...form, horas_disponibles_mes: Number(e.target.value) || 160 })}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="160"
                  min={1}
                  max={744}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tipo vinculo</label>
                <select
                  value={form.tipo_vinculo}
                  onChange={e => handleVinculoChange(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Sin especificar</option>
                  {TIPO_VINCULO.map(tv => (
                    <option key={tv.value} value={tv.value}>{tv.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Costo/hora calculado */}
          {form.salary > 0 && form.horas_disponibles_mes > 0 && (
            <p className="text-xs text-muted-foreground">
              Costo/hora: <span className="font-medium text-primary">{fmt(Math.round(form.salary / form.horas_disponibles_mes))}</span>
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={resetForm}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              <X className="h-3 w-3" /> Cancelar
            </button>
            <button
              onClick={editingId ? handleUpdate : handleCreate}
              disabled={saving || !form.full_name.trim()}
              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> {editingId ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {/* Staff list */}
      {activeStaff.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">No has registrado personal aun.</p>
          <p className="mt-1 text-xs text-muted-foreground">Registra tu equipo para tener mejor control de costos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeStaff.map(s => {
            const rol = s.rol_plataforma || 'ejecutor'
            const rolColor = ROL_COLORS[rol] || 'bg-sky-100 text-sky-700'
            const areaColor = s.area ? (AREA_COLORS[s.area] || 'bg-slate-100 text-slate-600') : ''
            return (
              <div key={s.id} className="flex gap-3 rounded-lg border p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary mt-0.5">
                  {s.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{s.full_name}</p>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => startEdit(s)} className="rounded p-1 hover:bg-accent">
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={() => handleDelete(s.id)} className="rounded p-1 hover:bg-accent">
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${rolColor}`}>
                      {ROL_DISPLAY[rol] || rol}
                    </span>
                    {s.area && (
                      <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${areaColor}`}>
                        {AREA_OPTIONS.find(a => a.value === s.area)?.label || s.area}
                      </span>
                    )}
                  </div>
                  {s.position && (
                    <p className="text-xs text-muted-foreground">{s.position}</p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    {s.phone_whatsapp ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-600">
                        <Phone className="h-3 w-3" /> {s.phone_whatsapp}
                      </span>
                    ) : <span />}
                    {(s.salary ?? 0) > 0 && (
                      <div className="text-right">
                        <span className="text-sm font-semibold">{fmt(s.salary ?? 0)}</span>
                        {(s.horas_disponibles_mes ?? 160) > 0 && (
                          <span className="ml-1.5 text-[10px] text-primary">
                            {fmt(Math.round((s.salary ?? 0) / (s.horas_disponibles_mes ?? 160)))}/h
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Invite to platform */}
                  {!s.profile_id && currentUserRole === 'owner' && (
                    <div className="pt-1 border-t mt-1">
                      {invitingId === s.id ? (
                        <div className="flex items-center gap-1.5">
                          <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
                            placeholder="email@ejemplo.com"
                            className="flex-1 min-w-0 rounded border bg-background px-2 py-1 text-xs"
                            onKeyDown={e => e.key === 'Enter' && handleInvite(s.id)}
                            autoFocus
                          />
                          <button
                            onClick={() => handleInvite(s.id)}
                            disabled={sendingInvite}
                            className="rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {sendingInvite ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Crear'}
                          </button>
                          <button
                            onClick={() => { setInvitingId(null); setInviteEmail('') }}
                            className="rounded p-1 hover:bg-accent"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setInvitingId(s.id); setInviteEmail('') }}
                          disabled={licenseUsed >= licenseMax}
                          className="flex items-center gap-1 text-[10px] text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                        >
                          <UserPlus className="h-3 w-3" />
                          {licenseUsed >= licenseMax ? 'Sin licencias disponibles' : 'Invitar a la plataforma'}
                        </button>
                      )}
                    </div>
                  )}
                  {s.profile_id && (
                    <p className="text-[10px] text-muted-foreground pt-1 border-t mt-1 flex items-center gap-1">
                      <Check className="h-3 w-3 text-primary" /> Con acceso a la plataforma
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
