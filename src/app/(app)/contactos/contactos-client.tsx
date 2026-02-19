'use client'

import { useState } from 'react'
import {
  Plus,
  Search,
  Phone,
  Mail,
  Building2,
  ArrowRight,
  X,
  Check,
  Trash2,
  Pencil,
  LayoutGrid,
  List,
  Funnel,
} from 'lucide-react'
import { toast } from 'sonner'
import { createContact, updateContact, deleteContact, createOpportunityFromContact } from './actions'

// ── Types ─────────────────────────────────────
type ContactWithClient = {
  id: string
  workspace_id: string
  client_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  company: string | null
  position: string | null
  contact_type: string
  source: string | null
  city: string | null
  notes: string | null
  status: string
  created_at: string
  updated_at: string
  clients: { name: string } | null
}

interface ContactosClientProps {
  initialContacts: ContactWithClient[]
  clients: { id: string; name: string }[]
}

// ── Constants ─────────────────────────────────

const CONTACT_STATUSES = [
  { value: 'sin_contactar', label: 'Sin contactar', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  { value: 'en_conversacion', label: 'En conversación', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  { value: 'interesado', label: 'Interesado', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'convertido', label: 'Convertido', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
]

const CONTACT_TYPES = [
  { value: 'cliente', label: 'Cliente' },
  { value: 'prospecto', label: 'Prospecto' },
  { value: 'referido', label: 'Referido' },
  { value: 'proveedor', label: 'Proveedor' },
  { value: 'aliado', label: 'Aliado' },
]

const SOURCES = [
  { value: 'referido', label: 'Referido' },
  { value: 'web', label: 'Web' },
  { value: 'redes', label: 'Redes sociales' },
  { value: 'evento', label: 'Evento' },
  { value: 'llamada', label: 'Llamada fría' },
  { value: 'otro', label: 'Otro' },
]

// ── Component ─────────────────────────────────

export default function ContactosClient({ initialContacts, clients }: ContactosClientProps) {
  const [contacts, setContacts] = useState(initialContacts)
  const [view, setView] = useState<'kanban' | 'table'>('kanban')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', company: '', position: '',
    contact_type: 'prospecto', source: '', city: '', notes: '', client_id: '',
  })

  const resetForm = () => {
    setForm({ full_name: '', email: '', phone: '', company: '', position: '', contact_type: 'prospecto', source: '', city: '', notes: '', client_id: '' })
    setShowForm(false)
    setEditingId(null)
  }

  const handleCreate = async () => {
    if (!form.full_name.trim()) { toast.error('Nombre es requerido'); return }
    setSaving(true)
    const res = await createContact(form)
    if (res.success) {
      setContacts(prev => [{
        id: crypto.randomUUID(), workspace_id: '', client_id: form.client_id || null,
        full_name: form.full_name, email: form.email || null, phone: form.phone || null,
        company: form.company || null, position: form.position || null,
        contact_type: form.contact_type, source: form.source || null,
        city: form.city || null, notes: form.notes || null, status: 'sin_contactar',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        clients: form.client_id ? clients.find(c => c.id === form.client_id) ? { name: clients.find(c => c.id === form.client_id)!.name } : null : null,
      }, ...prev])
      toast.success('Contacto creado')
      resetForm()
    } else {
      toast.error(res.error)
    }
    setSaving(false)
  }

  const handleUpdate = async () => {
    if (!editingId) return
    setSaving(true)
    const res = await updateContact(editingId, {
      full_name: form.full_name,
      email: form.email || null, phone: form.phone || null,
      company: form.company || null, position: form.position || null,
      contact_type: form.contact_type, source: form.source || null,
      city: form.city || null, notes: form.notes || null,
      client_id: form.client_id || null,
    })
    if (res.success) {
      setContacts(prev => prev.map(c => c.id === editingId ? { ...c, ...form, email: form.email || null, phone: form.phone || null, company: form.company || null, position: form.position || null, source: form.source || null, city: form.city || null, notes: form.notes || null, client_id: form.client_id || null } : c))
      toast.success('Contacto actualizado')
      resetForm()
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este contacto?')) return
    const res = await deleteContact(id)
    if (res.success) {
      setContacts(prev => prev.filter(c => c.id !== id))
      toast.success('Contacto eliminado')
    }
  }

  const handleStatusChange = async (id: string, newStatus: string) => {
    const res = await updateContact(id, { status: newStatus })
    if (res.success) {
      setContacts(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c))
    }
  }

  const handleConvertToOpportunity = async (id: string) => {
    const res = await createOpportunityFromContact(id)
    if (res.success) {
      setContacts(prev => prev.map(c => c.id === id ? { ...c, status: 'en_conversacion' } : c))
      toast.success('Oportunidad creada en Pipeline')
    } else {
      toast.error(res.error)
    }
  }

  const startEdit = (c: ContactWithClient) => {
    setForm({
      full_name: c.full_name, email: c.email || '', phone: c.phone || '',
      company: c.company || '', position: c.position || '',
      contact_type: c.contact_type, source: c.source || '',
      city: c.city || '', notes: c.notes || '', client_id: c.client_id || '',
    })
    setEditingId(c.id)
    setShowForm(true)
  }

  const filtered = contacts.filter(c =>
    c.full_name.toLowerCase().includes(search.toLowerCase()) ||
    c.company?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  )

  const getStatusConfig = (status: string) =>
    CONTACT_STATUSES.find(s => s.value === status) || CONTACT_STATUSES[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contactos</h1>
          <p className="text-sm text-muted-foreground">{contacts.length} contacto{contacts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
            />
          </div>
          <div className="flex rounded-lg border">
            <button
              onClick={() => setView('kanban')}
              className={`p-2 ${view === 'kanban' ? 'bg-accent' : ''}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView('table')}
              className={`p-2 ${view === 'table' ? 'bg-accent' : ''}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Contacto
          </button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">{editingId ? 'Editar contacto' : 'Nuevo contacto'}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input type="text" placeholder="Nombre completo *" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} className="rounded-md border bg-background px-3 py-2 text-sm" />
            <input type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="rounded-md border bg-background px-3 py-2 text-sm" />
            <input type="text" placeholder="Teléfono" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="rounded-md border bg-background px-3 py-2 text-sm" />
            <input type="text" placeholder="Empresa" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} className="rounded-md border bg-background px-3 py-2 text-sm" />
            <input type="text" placeholder="Cargo" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} className="rounded-md border bg-background px-3 py-2 text-sm" />
            <input type="text" placeholder="Ciudad" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="rounded-md border bg-background px-3 py-2 text-sm" />
            <select value={form.contact_type} onChange={e => setForm({ ...form, contact_type: e.target.value })} className="rounded-md border bg-background px-3 py-2 text-sm">
              {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="">Fuente (opcional)</option>
              {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="">Vincular cliente (opcional)</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <textarea placeholder="Notas" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              <X className="h-3 w-3" /> Cancelar
            </button>
            <button onClick={editingId ? handleUpdate : handleCreate} disabled={saving} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Check className="h-3 w-3" /> {editingId ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {/* Kanban View */}
      {view === 'kanban' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CONTACT_STATUSES.map(status => {
            const cards = filtered.filter(c => c.status === status.value)
            return (
              <div key={status.value} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.color}`}>
                    {status.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{cards.length}</span>
                </div>
                <div className="space-y-2">
                  {cards.map(c => (
                    <div key={c.id} className="rounded-lg border bg-card p-3 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium">{c.full_name}</p>
                          {c.company && <p className="text-xs text-muted-foreground">{c.company}</p>}
                        </div>
                        <div className="flex gap-0.5">
                          <button onClick={() => startEdit(c)} className="rounded p-1 hover:bg-accent">
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <button onClick={() => handleDelete(c.id)} className="rounded p-1 hover:bg-accent">
                            <Trash2 className="h-3 w-3 text-red-500" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        {c.phone && <span className="flex items-center gap-0.5"><Phone className="h-2.5 w-2.5" />{c.phone}</span>}
                        {c.email && <span className="flex items-center gap-0.5"><Mail className="h-2.5 w-2.5" />{c.email}</span>}
                        {c.clients?.name && <span className="flex items-center gap-0.5"><Building2 className="h-2.5 w-2.5" />{c.clients.name}</span>}
                      </div>
                      {status.value !== 'convertido' && (
                        <div className="flex gap-1">
                          {CONTACT_STATUSES.filter(s => s.value !== c.status).map(s => (
                            <button
                              key={s.value}
                              onClick={() => handleStatusChange(c.id, s.value)}
                              className="rounded border px-1.5 py-0.5 text-[9px] hover:bg-accent"
                            >
                              {s.label}
                            </button>
                          ))}
                          <button
                            onClick={() => handleConvertToOpportunity(c.id)}
                            className="flex items-center gap-0.5 rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[9px] text-primary hover:bg-primary/10"
                          >
                            <Funnel className="h-2.5 w-2.5" /> Pipeline
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {cards.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                      Sin contactos
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Table View */}
      {view === 'table' && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Nombre</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Empresa</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Contacto</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Estado</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Tipo</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const sc = getStatusConfig(c.status)
                return (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-accent/30">
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{c.full_name}</p>
                      {c.position && <p className="text-xs text-muted-foreground">{c.position}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{c.company || c.clients?.name || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {c.email && <span>{c.email}</span>}
                        {c.phone && <span>{c.phone}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sc.color}`}>{sc.label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground capitalize">{c.contact_type}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleConvertToOpportunity(c.id)} className="rounded p-1 hover:bg-accent" title="Crear oportunidad">
                          <ArrowRight className="h-3.5 w-3.5 text-primary" />
                        </button>
                        <button onClick={() => startEdit(c)} className="rounded p-1 hover:bg-accent">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button onClick={() => handleDelete(c.id)} className="rounded p-1 hover:bg-accent">
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
