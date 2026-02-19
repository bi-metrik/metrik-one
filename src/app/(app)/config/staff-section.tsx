'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Phone, Briefcase, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import type { Staff } from '@/types/database'
import { createStaffMember, updateStaffMember, deleteStaffMember } from './staff-actions'

interface StaffSectionProps {
  initialData: Staff[]
}

const CONTRACT_TYPES = [
  { value: 'fijo', label: 'Contrato fijo' },
  { value: 'prestacion', label: 'Prestación de servicios' },
  { value: 'obra', label: 'Obra labor' },
  { value: 'otro', label: 'Otro' },
]

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function StaffSection({ initialData }: StaffSectionProps) {
  const router = useRouter()
  const [staff, setStaff] = useState<Staff[]>(initialData)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    position: '',
    department: '',
    contract_type: 'fijo',
    salary: 0,
    phone_whatsapp: '',
  })

  const resetForm = () => {
    setForm({ full_name: '', position: '', department: '', contract_type: 'fijo', salary: 0, phone_whatsapp: '' })
    setShowForm(false)
    setEditingId(null)
  }

  const handleCreate = async () => {
    if (!form.full_name.trim()) return
    setSaving(true)
    const res = await createStaffMember(form)
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
      department: form.department || null,
      contract_type: form.contract_type,
      salary: form.salary,
      phone_whatsapp: form.phone_whatsapp || null,
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

  const startEdit = (s: Staff) => {
    setForm({
      full_name: s.full_name,
      position: s.position || '',
      department: s.department || '',
      contract_type: s.contract_type,
      salary: s.salary,
      phone_whatsapp: s.phone_whatsapp || '',
    })
    setEditingId(s.id)
    setShowForm(true)
  }

  const activeStaff = staff.filter(s => s.is_active)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Personal</h3>
          <p className="text-xs text-muted-foreground">
            {activeStaff.length} miembro{activeStaff.length !== 1 ? 's' : ''} activo{activeStaff.length !== 1 ? 's' : ''}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre completo *</label>
              <input
                type="text"
                value={form.full_name}
                onChange={e => setForm({ ...form, full_name: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Juan Pérez"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Cargo</label>
              <input
                type="text"
                value={form.position}
                onChange={e => setForm({ ...form, position: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Diseñador"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Departamento</label>
              <input
                type="text"
                value={form.department}
                onChange={e => setForm({ ...form, department: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Diseño"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo contrato</label>
              <select
                value={form.contract_type}
                onChange={e => setForm({ ...form, contract_type: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CONTRACT_TYPES.map(ct => (
                  <option key={ct.value} value={ct.value}>{ct.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Salario / Honorario</label>
              <input
                type="number"
                value={form.salary || ''}
                onChange={e => setForm({ ...form, salary: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="0"
              />
            </div>
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
          </div>
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
          <p className="text-sm text-muted-foreground">No has registrado personal aún.</p>
          <p className="mt-1 text-xs text-muted-foreground">Registra tu equipo para tener mejor control de costos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeStaff.map(s => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {s.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.full_name}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {s.position && (
                    <span className="flex items-center gap-0.5">
                      <Briefcase className="h-3 w-3" /> {s.position}
                    </span>
                  )}
                  {s.phone_whatsapp && (
                    <span className="flex items-center gap-0.5">
                      <Phone className="h-3 w-3" /> {s.phone_whatsapp}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{fmt(s.salary)}</p>
                <p className="text-[10px] text-muted-foreground">
                  {CONTRACT_TYPES.find(ct => ct.value === s.contract_type)?.label || s.contract_type}
                </p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(s)} className="rounded p-1 hover:bg-accent">
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => handleDelete(s.id)} className="rounded p-1 hover:bg-accent">
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
