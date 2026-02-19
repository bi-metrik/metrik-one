'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  Plus,
  Mail,
  Phone,
  MoreHorizontal,
  Pencil,
  Trash2,
  Users,
  TrendingUp,
  DollarSign,
} from 'lucide-react'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PROMOTER_STATUSES, formatCOP } from '@/lib/contacts/constants'
import { createPromoter, updatePromoter, deletePromoter } from './actions'

// ── Types ─────────────────────────────────────

type Promoter = {
  id: string
  workspace_id: string
  name: string
  email: string | null
  phone: string | null
  status: string
  commission_pct: number | null
  bank_name: string | null
  bank_account: string | null
  referrals_count: number | null
  won_projects: number | null
  accumulated_commission: number | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

interface PromotoresClientProps {
  promoters: Promoter[]
}

// ── Form state ────────────────────────────────

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  commission_pct: 10,
  status: 'active',
  bank_name: '',
  bank_account: '',
  notes: '',
}

// ── Status helpers ────────────────────────────

function getStatusBadge(status: string) {
  const s = PROMOTER_STATUSES.find((ps) => ps.id === status)
  if (!s) return null
  const variantMap: Record<string, 'default' | 'secondary' | 'destructive'> = {
    active: 'default',
    inactive: 'secondary',
    suspended: 'destructive',
  }
  return (
    <Badge variant={variantMap[status] ?? 'secondary'} className="text-[10px]">
      <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${s.color}`} />
      {s.label}
    </Badge>
  )
}

// ── Component ─────────────────────────────────

export default function PromotoresClient({ promoters }: PromotoresClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  // ── Computed stats ────────────────────────

  const activeCount = promoters.filter((p) => p.status === 'active').length
  const totalReferrals = promoters.reduce(
    (sum, p) => sum + (p.referrals_count ?? 0),
    0,
  )
  const totalCommission = promoters.reduce(
    (sum, p) => sum + (p.accumulated_commission ?? 0),
    0,
  )

  // ── Filtered list ─────────────────────────

  const filtered = promoters.filter((p) => {
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      (p.email && p.email.toLowerCase().includes(q))
    )
  })

  // ── Form handlers ─────────────────────────

  function openCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setDialogOpen(true)
  }

  function openEdit(p: Promoter) {
    setForm({
      name: p.name,
      email: p.email ?? '',
      phone: p.phone ?? '',
      commission_pct: p.commission_pct ?? 10,
      status: p.status,
      bank_name: p.bank_name ?? '',
      bank_account: p.bank_account ?? '',
      notes: p.notes ?? '',
    })
    setEditingId(p.id)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        await updatePromoter(editingId, {
          name: form.name,
          email: form.email,
          phone: form.phone,
          commission_pct: form.commission_pct,
          status: form.status,
          bank_name: form.bank_name,
          bank_account: form.bank_account,
          notes: form.notes,
        })
      } else {
        await createPromoter({
          name: form.name,
          email: form.email,
          phone: form.phone,
          commission_pct: form.commission_pct,
          status: form.status,
          bank_name: form.bank_name,
          bank_account: form.bank_account,
          notes: form.notes,
        })
      }
      setDialogOpen(false)
      router.refresh()
    } catch {
      // error handled by server action throw
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('¿Eliminar este promotor? Esta accion no se puede deshacer.')) return
    try {
      await deletePromoter(id)
      router.refresh()
    } catch {
      // error handled by server action throw
    }
  }

  // ── Render ────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Promotores</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona tu red de promotores y comisiones por referidos
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Promotores Activos */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <Users className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Promotores Activos</p>
              <p className="text-2xl font-bold">{activeCount}</p>
            </div>
          </div>
        </div>

        {/* Total Referidos */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <TrendingUp className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Referidos</p>
              <p className="text-2xl font-bold">{totalReferrals}</p>
            </div>
          </div>
        </div>

        {/* Comisiones Acumuladas */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <DollarSign className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Comisiones Acumuladas</p>
              <p className="text-2xl font-bold">{formatCOP(totalCommission)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search + New */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nuevo Promotor
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Nombre</TableHead>
              <TableHead className="text-xs">Contacto</TableHead>
              <TableHead className="text-xs text-right">Comision %</TableHead>
              <TableHead className="text-xs text-right">Referidos</TableHead>
              <TableHead className="text-xs text-right">Ganados</TableHead>
              <TableHead className="text-xs text-right">Acumulado</TableHead>
              <TableHead className="text-xs">Estado</TableHead>
              <TableHead className="text-xs text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  {search
                    ? 'No se encontraron promotores con ese criterio'
                    : 'No hay promotores registrados. Crea el primero.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  {/* Nombre */}
                  <TableCell className="font-medium">{p.name}</TableCell>

                  {/* Contacto */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {p.email && (
                        <a
                          href={`mailto:${p.email}`}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title={p.email}
                        >
                          <Mail className="h-4 w-4" />
                        </a>
                      )}
                      {p.phone && (
                        <a
                          href={`tel:${p.phone}`}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title={p.phone}
                        >
                          <Phone className="h-4 w-4" />
                        </a>
                      )}
                      {!p.email && !p.phone && (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </div>
                  </TableCell>

                  {/* Comision % */}
                  <TableCell className="text-right">
                    {p.commission_pct != null ? `${p.commission_pct}%` : '--'}
                  </TableCell>

                  {/* Referidos */}
                  <TableCell className="text-right">
                    {p.referrals_count ?? 0}
                  </TableCell>

                  {/* Ganados */}
                  <TableCell className="text-right">
                    {p.won_projects ?? 0}
                  </TableCell>

                  {/* Acumulado */}
                  <TableCell className="text-right">
                    {formatCOP(p.accumulated_commission ?? 0)}
                  </TableCell>

                  {/* Estado */}
                  <TableCell>{getStatusBadge(p.status)}</TableCell>

                  {/* Acciones */}
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="rounded p-1 hover:bg-accent transition-colors">
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(p)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleDelete(p.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Editar Promotor' : 'Nuevo Promotor'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Nombre */}
            <div className="grid gap-2">
              <Label htmlFor="promoter-name">Nombre *</Label>
              <Input
                id="promoter-name"
                placeholder="Nombre completo"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            {/* Email + Telefono */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="promoter-email">Email</Label>
                <Input
                  id="promoter-email"
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="promoter-phone">Telefono</Label>
                <Input
                  id="promoter-phone"
                  placeholder="+57 300 000 0000"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>

            {/* Comision + Estado */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="promoter-commission">% Comision</Label>
                <Input
                  id="promoter-commission"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.commission_pct}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      commission_pct: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Estado</Label>
                <Select
                  value={form.status}
                  onValueChange={(val) => setForm({ ...form, status: val })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMOTER_STATUSES.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${s.color}`}
                          />
                          {s.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Banco + Cuenta */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="promoter-bank">Banco</Label>
                <Input
                  id="promoter-bank"
                  placeholder="Nombre del banco"
                  value={form.bank_name}
                  onChange={(e) =>
                    setForm({ ...form, bank_name: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="promoter-account">No. Cuenta</Label>
                <Input
                  id="promoter-account"
                  placeholder="Numero de cuenta"
                  value={form.bank_account}
                  onChange={(e) =>
                    setForm({ ...form, bank_account: e.target.value })
                  }
                />
              </div>
            </div>

            {/* Notas */}
            <div className="grid gap-2">
              <Label htmlFor="promoter-notes">Notas</Label>
              <Textarea
                id="promoter-notes"
                placeholder="Notas adicionales..."
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving
                ? 'Guardando...'
                : editingId
                  ? 'Guardar Cambios'
                  : 'Crear Promotor'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
