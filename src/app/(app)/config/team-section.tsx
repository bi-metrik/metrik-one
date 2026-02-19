'use client'

import { useState, useTransition, useEffect } from 'react'
import { Users, Mail, Shield, Eye, Wrench, Crown, Loader2, X, UserPlus, Clock, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  inviteTeamMember,
  getTeamMembers,
  revokeInvitation,
  changeTeamMemberRole,
  removeTeamMember,
} from './team-actions'
import type { RoleKey } from '@/lib/roles'

type InviteRole = 'admin' | 'operator' | 'read_only'

// ── Types ──────────────────────────────────────────────

interface TeamMember {
  id: string
  full_name: string | null
  role: string
  avatar_url: string | null
  created_at: string
}

interface TeamInvitation {
  id: string
  email: string
  role: string
  status: string
  created_at: string
  expires_at: string | null
}

interface TeamSectionProps {
  currentUserRole: string
}

const ROLE_OPTIONS: { value: InviteRole; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'admin', label: 'Admin', icon: Shield, description: 'Todo excepto config fiscal e invitar' },
  { value: 'operator', label: 'Operador', icon: Wrench, description: 'Proyectos asignados + gastos + horas' },
  { value: 'read_only', label: 'Lectura', icon: Eye, description: 'Números (solo lectura) + exportar CSV' },
]

const ROLE_ICONS: Record<string, React.ElementType> = {
  owner: Crown,
  admin: Shield,
  operator: Wrench,
  read_only: Eye,
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Admin',
  operator: 'Operador',
  read_only: 'Lectura',
}

// ── Component ──────────────────────────────────────────

export default function TeamSection({ currentUserRole }: TeamSectionProps) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<TeamInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('operator')
  const [isPending, startTransition] = useTransition()

  const isOwner = currentUserRole === 'owner'

  // Load team data
  useEffect(() => {
    const load = async () => {
      const result = await getTeamMembers()
      if (result.success) {
        setMembers(result.members)
        setInvitations(result.invitations)
      }
      setLoading(false)
    }
    load()
  }, [])

  const handleInvite = () => {
    if (!inviteEmail.trim()) {
      toast.error('Ingresa un email')
      return
    }

    startTransition(async () => {
      const result = await inviteTeamMember({ email: inviteEmail.trim(), role: inviteRole })
      if (result.success) {
        toast.success(`Invitación enviada a ${inviteEmail}`)
        setInviteEmail('')
        setShowInviteForm(false)
        // Refresh
        const updated = await getTeamMembers()
        if (updated.success) {
          setInvitations(updated.invitations)
        }
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleRevoke = (id: string) => {
    startTransition(async () => {
      const result = await revokeInvitation(id)
      if (result.success) {
        setInvitations(prev => prev.filter(i => i.id !== id))
        toast.success('Invitación revocada')
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleRoleChange = (memberId: string, newRole: RoleKey) => {
    startTransition(async () => {
      const result = await changeTeamMemberRole(memberId, newRole)
      if (result.success) {
        setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m))
        toast.success('Rol actualizado')
      } else {
        toast.error(result.error)
      }
    })
  }

  const handleRemove = (memberId: string, memberName: string | null) => {
    if (!confirm(`¿Eliminar a ${memberName || 'este miembro'} del equipo?`)) return

    startTransition(async () => {
      const result = await removeTeamMember(memberId)
      if (result.success) {
        setMembers(prev => prev.filter(m => m.id !== memberId))
        toast.success('Miembro eliminado del equipo')
      } else {
        toast.error(result.error)
      }
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Mi equipo</h3>
          <p className="text-sm text-muted-foreground">
            {members.length} miembro{members.length !== 1 ? 's' : ''}
            {invitations.length > 0 && ` · ${invitations.length} pendiente${invitations.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {showInviteForm ? <X className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
            {showInviteForm ? 'Cancelar' : 'Invitar'}
          </button>
        )}
      </div>

      {/* Invite Form */}
      {showInviteForm && (
        <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <input
            type="email"
            placeholder="Email del nuevo miembro"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
          />

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Rol:</p>
            {ROLE_OPTIONS.map((opt) => {
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  onClick={() => setInviteRole(opt.value)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    inviteRole === opt.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/50'
                  }`}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  </div>
                  <div className={`h-4 w-4 rounded-full border-2 ${
                    inviteRole === opt.value ? 'border-primary bg-primary' : 'border-input'
                  }`} />
                </button>
              )
            })}
          </div>

          <button
            onClick={handleInvite}
            disabled={isPending}
            className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar invitación'}
          </button>
        </div>
      )}

      {/* Current Members */}
      <div className="space-y-2">
        {members.map((member) => {
          const RoleIcon = ROLE_ICONS[member.role] || Eye
          const isOwnRole = member.role === 'owner'
          return (
            <div
              key={member.id}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {(member.full_name || '?')
                  .split(' ')
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium">{member.full_name || 'Sin nombre'}</p>
                <div className="flex items-center gap-1.5">
                  <RoleIcon className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{ROLE_LABELS[member.role] || member.role}</span>
                </div>
              </div>

              {/* Role change dropdown — only owner can change, and can't change owner */}
              {isOwner && !isOwnRole && (
                <div className="flex items-center gap-1">
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.id, e.target.value as RoleKey)}
                    className="h-8 rounded border border-input bg-background px-2 text-xs"
                    disabled={isPending}
                  >
                    <option value="admin">Admin</option>
                    <option value="operator">Operador</option>
                    <option value="read_only">Lectura</option>
                  </select>
                  <button
                    onClick={() => handleRemove(member.id, member.full_name)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Eliminar del equipo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {isOwnRole && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  Tú
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pendientes</p>
          {invitations.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center gap-3 rounded-lg border border-dashed p-3"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm">{inv.email}</p>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABELS[inv.role] || inv.role} · Pendiente
                  </span>
                </div>
              </div>
              {isOwner && (
                <button
                  onClick={() => handleRevoke(inv.id)}
                  disabled={isPending}
                  className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Revocar invitación"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* D97: Permission table info */}
      {!isOwner && (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Solo el dueño del workspace puede invitar y administrar miembros del equipo.
          </p>
        </div>
      )}
    </div>
  )
}
