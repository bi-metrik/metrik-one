'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Phone, Mail, Save, Flame, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { updateContacto } from '../../actions'
import { FUENTES_ADQUISICION, ROLES_CONTACTO, SEGMENTOS_CONTACTO } from '@/lib/pipeline/constants'
import { formatCOP } from '@/lib/contacts/constants'
import type { Contacto } from '@/types/database'
import NotesSection from '@/components/notes-section'

interface NegocioRow {
  id: string
  nombre: string | null
  codigo: string | null
  estado: string | null
  stage_actual: string | null
  precio_estimado: number | null
  created_at: string | null
  empresas: { nombre: string } | null
}

const STAGE_CHIP: Record<string, { label: string; class: string }> = {
  venta: { label: 'Venta', class: 'bg-blue-50 text-blue-700' },
  ejecucion: { label: 'Ejecución', class: 'bg-orange-50 text-orange-700' },
  cobro: { label: 'Cobro', class: 'bg-green-50 text-green-700' },
  cierre: { label: 'Cierre', class: 'bg-slate-100 text-slate-700' },
}

interface Props {
  contacto: Contacto
  empresaVinculada: { id: string; nombre: string } | null
  negocios: NegocioRow[]
}

export default function Contacto360({ contacto, empresaVinculada, negocios }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState({
    nombre: contacto.nombre,
    telefono: contacto.telefono ?? '',
    email: contacto.email ?? '',
    fuente_adquisicion: contacto.fuente_adquisicion ?? '',
    rol: contacto.rol ?? '',
    segmento: contacto.segmento ?? 'sin_contactar',
    comision_porcentaje: contacto.comision_porcentaje?.toString() ?? '',
  })

  const handleSave = () => {
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => fd.set(k, v))
    startTransition(async () => {
      const res = await updateContacto(contacto.id, fd)
      if (res.success) {
        toast.success('Contacto actualizado')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold">{contacto.nombre}</h1>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Vista 360 del contacto</p>
            {empresaVinculada && (
              <Link href={`/directorio/empresa/${empresaVinculada.id}`} className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 hover:bg-purple-200">
                <Building2 className="h-3 w-3" /> {empresaVinculada.nombre} (PN)
              </Link>
            )}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          Guardar
        </button>
      </div>

      {/* Edit form */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Datos del contacto</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre *</label>
            <input
              value={form.nombre}
              onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Teléfono</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={form.telefono}
                onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))}
                className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Fuente</label>
            <select
              value={form.fuente_adquisicion}
              onChange={e => setForm(p => ({ ...p, fuente_adquisicion: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Sin fuente</option>
              {FUENTES_ADQUISICION.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Rol</label>
            <select
              value={form.rol}
              onChange={e => setForm(p => ({ ...p, rol: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Sin rol</option>
              {ROLES_CONTACTO.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Segmento</label>
            <select
              value={form.segmento}
              onChange={e => setForm(p => ({ ...p, segmento: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {SEGMENTOS_CONTACTO.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          {form.rol === 'promotor' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Comision %</label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={form.comision_porcentaje}
                onChange={e => setForm(p => ({ ...p, comision_porcentaje: e.target.value }))}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          )}
        </div>
      </div>

      {/* Negocios */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Negocios ({negocios.length})</h2>
        {negocios.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Sin negocios</p>
        ) : (
          <div className="space-y-2">
            {negocios.map(n => {
              const chip = STAGE_CHIP[n.stage_actual ?? '']
              return (
                <Link
                  key={n.id}
                  href={`/negocios/${n.id}`}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Flame className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      <span className="text-xs text-muted-foreground font-medium">{n.codigo}</span>
                      <span className="truncate text-sm font-medium">{n.nombre || 'Sin nombre'}</span>
                    </div>
                    {n.empresas && (
                      <p className="ml-5.5 text-xs text-muted-foreground">{(n.empresas as { nombre: string }).nombre}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {n.precio_estimado != null && <span className="text-xs font-medium">{formatCOP(n.precio_estimado)}</span>}
                    {chip && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chip.class}`}>{chip.label}</span>}
                    {n.estado === 'completado' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">Cerrado</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Notas */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Notas</h2>
        <NotesSection entityType="contacto" entityId={contacto.id} />
      </div>
    </div>
  )
}
