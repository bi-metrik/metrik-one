'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Star, X, Check, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import type { BankAccount } from '@/types/database'
import { createBankAccount, updateBankAccount, deleteBankAccount, recordBalance } from './bank-accounts-actions'

interface BankAccountsSectionProps {
  initialData: BankAccount[]
}

const ACCOUNT_TYPES = [
  { value: 'ahorros', label: 'Ahorros' },
  { value: 'corriente', label: 'Corriente' },
  { value: 'digital', label: 'Digital (Nequi, Daviplata)' },
]

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function BankAccountsSection({ initialData }: BankAccountsSectionProps) {
  const router = useRouter()
  const [accounts, setAccounts] = useState<BankAccount[]>(initialData)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [balanceForm, setBalanceForm] = useState<{ accountId: string; balance: string; notes: string } | null>(null)
  const [form, setForm] = useState({
    bank_name: '',
    account_name: 'Principal',
    account_type: 'ahorros',
    is_primary: false,
  })

  const resetForm = () => {
    setForm({ bank_name: '', account_name: 'Principal', account_type: 'ahorros', is_primary: false })
    setShowForm(false)
    setEditingId(null)
  }

  const handleCreate = async () => {
    if (!form.bank_name.trim()) return
    setSaving(true)
    const res = await createBankAccount(form)
    if (res.success) {
      toast.success('Cuenta creada')
      resetForm()
      router.refresh()
    } else {
      toast.error(res.error || 'Error al crear cuenta')
    }
    setSaving(false)
  }

  const handleUpdate = async () => {
    if (!editingId || !form.bank_name.trim()) return
    setSaving(true)
    const res = await updateBankAccount(editingId, form)
    if (res.success) {
      toast.success('Cuenta actualizada')
      resetForm()
      router.refresh()
    } else {
      toast.error(res.error || 'Error al actualizar')
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta cuenta bancaria?')) return
    const res = await deleteBankAccount(id)
    if (res.success) {
      setAccounts(prev => prev.filter(a => a.id !== id))
      toast.success('Cuenta eliminada')
    } else {
      toast.error(res.error || 'Error al eliminar')
    }
  }

  const handleRecordBalance = async () => {
    if (!balanceForm) return
    const balanceValue = parseFloat(balanceForm.balance.replace(/[^0-9.-]/g, ''))
    if (isNaN(balanceValue)) {
      toast.error('Ingresa un saldo válido')
      return
    }
    setSaving(true)
    const res = await recordBalance({
      account_id: balanceForm.accountId,
      balance: balanceValue,
      notes: balanceForm.notes || undefined,
    })
    if (res.success) {
      toast.success('Saldo registrado')
      setBalanceForm(null)
      router.refresh()
    } else {
      toast.error(res.error || 'Error al registrar saldo')
    }
    setSaving(false)
  }

  const startEdit = (a: BankAccount) => {
    setForm({
      bank_name: a.bank_name,
      account_name: a.account_name,
      account_type: a.account_type,
      is_primary: a.is_primary,
    })
    setEditingId(a.id)
    setShowForm(true)
  }

  const activeAccounts = accounts.filter(a => a.is_active)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Cuentas bancarias</h3>
          <p className="text-xs text-muted-foreground">
            {activeAccounts.length} cuenta{activeAccounts.length !== 1 ? 's' : ''} registrada{activeAccounts.length !== 1 ? 's' : ''}
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
              <label className="text-xs font-medium text-muted-foreground">Banco *</label>
              <input
                type="text"
                value={form.bank_name}
                onChange={e => setForm({ ...form, bank_name: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Bancolombia"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre cuenta</label>
              <input
                type="text"
                value={form.account_name}
                onChange={e => setForm({ ...form, account_name: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Principal"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <select
                value={form.account_type}
                onChange={e => setForm({ ...form, account_type: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {ACCOUNT_TYPES.map(at => (
                  <option key={at.value} value={at.value}>{at.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_primary}
                  onChange={e => setForm({ ...form, is_primary: e.target.checked })}
                  className="rounded"
                />
                Cuenta principal
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              <X className="h-3 w-3" /> Cancelar
            </button>
            <button
              onClick={editingId ? handleUpdate : handleCreate}
              disabled={saving || !form.bank_name.trim()}
              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> {editingId ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {/* Balance recording form */}
      {balanceForm && (
        <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900/30 dark:bg-blue-950/10">
          <p className="text-sm font-medium">Registrar saldo</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Saldo actual *</label>
              <input
                type="number"
                value={balanceForm.balance}
                onChange={e => setBalanceForm({ ...balanceForm, balance: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nota (opcional)</label>
              <input
                type="text"
                value={balanceForm.notes}
                onChange={e => setBalanceForm({ ...balanceForm, notes: e.target.value })}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Saldo corte mensual"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setBalanceForm(null)} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              <X className="h-3 w-3" /> Cancelar
            </button>
            <button
              onClick={handleRecordBalance}
              disabled={saving || !balanceForm.balance}
              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> Registrar
            </button>
          </div>
        </div>
      )}

      {/* Accounts list */}
      {activeAccounts.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">No has registrado cuentas bancarias aún.</p>
          <p className="mt-1 text-xs text-muted-foreground">Registra tus cuentas para hacer seguimiento a tu caja.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeAccounts.map(a => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                {a.is_primary ? <Star className="h-4 w-4" /> : <span className="text-sm font-bold">{a.bank_name.charAt(0)}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{a.bank_name}</p>
                  {a.is_primary && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                      Principal
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {a.account_name} &middot; {ACCOUNT_TYPES.find(at => at.value === a.account_type)?.label || a.account_type}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setBalanceForm({ accountId: a.id, balance: '', notes: '' })}
                  className="rounded p-1 hover:bg-accent"
                  title="Registrar saldo"
                >
                  <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
                </button>
                <button onClick={() => startEdit(a)} className="rounded p-1 hover:bg-accent">
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => handleDelete(a.id)} className="rounded p-1 hover:bg-accent">
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
