/**
 * Sprint 9 — D97/D166: Role permissions
 * Shared constants — NOT a server action file
 */

export const ROLE_PERMISSIONS = {
  owner: {
    label: 'Dueño',
    canInvite: true,
    canDeleteRecords: true,
    canConfigFiscal: true,
    canViewNumbers: true,
    canViewPipeline: true,
    canViewProjects: true,
    canViewAllProjects: true,
    canUseFab: true,
    canRegisterExpense: true,
    canRegisterHours: true,
    canRegisterCobro: true,
    canExportCSV: true,
    canManageTeam: true,
  },
  admin: {
    label: 'Admin',
    canInvite: false,
    canDeleteRecords: true,
    canConfigFiscal: false,
    canViewNumbers: true,
    canViewPipeline: true,
    canViewProjects: true,
    canViewAllProjects: true,
    canUseFab: true,
    canRegisterExpense: true,
    canRegisterHours: true,
    canRegisterCobro: true,
    canExportCSV: true,
    canManageTeam: false,
  },
  operator: {
    label: 'Operador',
    canInvite: false,
    canDeleteRecords: false,
    canConfigFiscal: false,
    canViewNumbers: false,
    canViewPipeline: false,
    canViewProjects: true,
    canViewAllProjects: false,
    canUseFab: true,
    canRegisterExpense: true,
    canRegisterHours: true,
    canRegisterCobro: false,
    canExportCSV: false,
    canManageTeam: false,
  },
  read_only: {
    label: 'Lectura',
    canInvite: false,
    canDeleteRecords: false,
    canConfigFiscal: false,
    canViewNumbers: true,
    canViewPipeline: false,
    canViewProjects: false,
    canViewAllProjects: false,
    canUseFab: false,
    canRegisterExpense: false,
    canRegisterHours: false,
    canRegisterCobro: false,
    canExportCSV: true,
    canManageTeam: false,
  },
} as const

export type RoleKey = keyof typeof ROLE_PERMISSIONS

export function getRolePermissions(role: string) {
  return ROLE_PERMISSIONS[role as RoleKey] || ROLE_PERMISSIONS.read_only
}
