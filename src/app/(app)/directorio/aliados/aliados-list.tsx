'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Handshake, Mail, Pencil, Phone, Plus, Power, Search, User } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PhoneInput } from '@/components/phone-input'
import {
  crearAliado,
  actualizarAliado,
  cambiarEstadoAliado,
  type Aliado,
} from './actions'

interface Props {
  aliados: Aliado[]
  /** Guard de UI. La barrera real vive en las server actions (canGestionarAliados). */
  puedeGestionar: boolean
}

const emptyForm = {
  nombre: '',
  nit: '',
  contacto_nombre: '',
  email: '',
  telefono: '',
  notas: '',
}

type FormState = typeof emptyForm

export default function AliadosList({ aliados, puedeGestionar }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [estadoFilter, setEstadoFilter] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [, startTransition] = useTransition()

  const abrirNuevo = () => {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  const abrirEdicion = (a: Aliado) => {
    setEditingId(a.id)
    setForm({
      nombre: a.nombre,
      nit: a.nit ?? '',
      contacto_nombre: a.contacto_nombre ?? '',
      email: a.email ?? '',
      telefono: a.telefono ?? '',
      notas: a.notas ?? '',
    })
    setDialogOpen(true)
  }

  const guardar = async () => {
    if (!form.nombre.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    setSaving(true)
    const res = editingId
      ? await actualizarAliado(editingId, form)
      : await crearAliado(form)
    setSaving(false)

    if (res.success) {
      toast.success(editingId ? 'Aliado actualizado' : 'Aliado creado')
      setDialogOpen(false)
      setEditingId(null)
      setForm(emptyForm)
      router.refresh()
    } else {
      toast.error(res.error ?? 'Error')
    }
  }

  const alternarEstado = (a: Aliado) => {
    const siguiente = a.estado === 'activo' ? 'inactivo' : 'activo'
    startTransition(async () => {
      const res = await cambiarEstadoAliado(a.id, siguiente)
      if (res.success) {
        toast.success(siguiente === 'activo' ? 'Aliado activado' : 'Aliado desactivado')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error')
      }
    })
  }

  const activos = aliados.filter(a => a.estado === 'activo').length
  const inactivos = aliados.length - activos

  const filtered = aliados.filter(a => {
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      a.nombre.toLowerCase().includes(q) ||
      (a.nit ?? '').toLowerCase().includes(q) ||
      (a.contacto_nombre ?? '').toLowerCase().includes(q)
    const matchEstado = !estadoFilter || a.estado === estadoFilter
    return matchSearch && matchEstado
  })

  const formulario = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Editar aliado' : 'Nuevo aliado'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="aliado-nombre">Nombre *</Label>
            <Input
              id="aliado-nombre"
              value={form.nombre}
              onChange={e => setForm({ ...form, nombre: e.target.value })}
              placeholder="Razón social del aliado"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aliado-nit">NIT</Label>
            <Input
              id="aliado-nit"
              value={form.nit}
              onChange={e => setForm({ ...form, nit: e.target.value })}
              placeholder="900123456"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aliado-contacto">Persona de contacto</Label>
            <Input
              id="aliado-contacto"
              value={form.contacto_nombre}
              onChange={e => setForm({ ...form, contacto_nombre: e.target.value })}
              placeholder="Nombre de quien atiende la relación"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aliado-email">Email</Label>
            <Input
              id="aliado-email"
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="contacto@aliado.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Teléfono</Label>
            <PhoneInput
              value={form.telefono}
              onChange={v => setForm({ ...form, telefono: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aliado-notas">Notas</Label>
            <Textarea
              id="aliado-notas"
              value={form.notas}
              onChange={e => setForm({ ...form, notas: e.target.value })}
              placeholder="Condiciones del acuerdo, contexto de la alianza..."
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={saving}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear aliado'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )

  if (aliados.length === 0) {
    return (
      <div className="space-y-3">
        {puedeGestionar && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={abrirNuevo}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo aliado
            </button>
          </div>
        )}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
          <Handshake className="h-12 w-12 text-muted-foreground/30" />
          <h3 className="mt-4 text-base font-medium">
            Registra las contrapartes con las que tienes acuerdo
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Los aliados que agregues aparecerán aquí
          </p>
        </div>
        {formulario}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Search + accion */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar aliado..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
          />
        </div>
        {puedeGestionar && (
          <button
            type="button"
            onClick={abrirNuevo}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-1.5 overflow-x-auto">
        <button
          onClick={() => setEstadoFilter(null)}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !estadoFilter ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >
          Todos ({aliados.length})
        </button>
        <button
          onClick={() => setEstadoFilter(estadoFilter === 'activo' ? null : 'activo')}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            estadoFilter === 'activo' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >
          Activos ({activos})
        </button>
        {inactivos > 0 && (
          <button
            onClick={() => setEstadoFilter(estadoFilter === 'inactivo' ? null : 'inactivo')}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              estadoFilter === 'inactivo' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            Inactivos ({inactivos})
          </button>
        )}
      </div>

      {/* Cards (calcado del patron de /directorio/contactos) */}
      <div className="space-y-2">
        {filtered.map(a => {
          const activo = a.estado === 'activo'
          return (
            <div
              key={a.id}
              className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {/* Fila 1: badges */}
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        activo ? 'bg-[#10B981]/10 text-[#059669]' : 'bg-[#F5F4F2] text-[#6B7280]'
                      }`}
                    >
                      {activo ? 'Activo' : 'Inactivo'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[10px] font-medium text-[#6B7280]">
                      <Handshake className="h-2.5 w-2.5" />
                      Aliado
                    </span>
                  </div>

                  <p className="truncate text-sm font-semibold leading-tight text-[#1A1A1A]">
                    {a.nombre}
                  </p>
                  {a.nit && <p className="truncate text-[11px] text-[#6B7280]">NIT {a.nit}</p>}

                  {/* Contacto */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {a.contacto_nombre && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <User className="h-3 w-3" /> {a.contacto_nombre}
                      </span>
                    )}
                    {a.telefono && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <Phone className="h-3 w-3" /> {a.telefono}
                      </span>
                    )}
                    {a.email && (
                      <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-[#6B7280]">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{a.email}</span>
                      </span>
                    )}
                  </div>

                  {a.notas && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-[#6B7280]">{a.notas}</p>
                  )}
                </div>

                {/* Acciones */}
                {puedeGestionar && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => abrirEdicion(a)}
                      className="rounded p-1 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#1A1A1A]"
                      title="Editar"
                      aria-label="Editar aliado"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => alternarEstado(a)}
                      className={`rounded p-1 transition-colors hover:bg-[#F5F4F2] ${
                        activo ? 'text-[#6B7280] hover:text-[#EF4444]' : 'text-[#6B7280] hover:text-[#059669]'
                      }`}
                      title={activo ? 'Desactivar' : 'Activar'}
                      aria-label={activo ? 'Desactivar aliado' : 'Activar aliado'}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron aliados
          </p>
        )}
      </div>

      {formulario}
    </div>
  )
}
