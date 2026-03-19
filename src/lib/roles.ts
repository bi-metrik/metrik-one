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
    canApproveCausacion: true,   // D246: aprobar PENDIENTE → APROBADO
    canCausar: true,             // D246: causar APROBADO → CAUSADO
    canViewCausacion: true,      // D246: ver /causacion
    canRevertApproval: true,     // Revertir APROBADO → RECHAZADO (solo owner)
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
    canApproveCausacion: true,
    canCausar: true,
    canViewCausacion: true,
    canRevertApproval: false,
  },
  supervisor: {
    label: 'Supervisor',
    canInvite: false,
    canDeleteRecords: false,
    canConfigFiscal: false,
    canViewNumbers: false,
    canViewPipeline: true,
    canViewProjects: true,
    canViewAllProjects: true,
    canUseFab: false,
    canRegisterExpense: false,
    canRegisterHours: false,
    canRegisterCobro: false,
    canExportCSV: false,
    canManageTeam: false,
    canApproveCausacion: false,
    canCausar: false,
    canViewCausacion: false,
    canRevertApproval: false,
  },
  operator: {
    label: 'Ejecutor',
    canInvite: false,
    canDeleteRecords: false,
    canConfigFiscal: false,
    canViewNumbers: false,
    canViewPipeline: true,
    canViewProjects: true,
    canViewAllProjects: false,
    canUseFab: true,
    canRegisterExpense: true,
    canRegisterHours: true,
    canRegisterCobro: false,
    canExportCSV: false,
    canManageTeam: false,
    canApproveCausacion: false,
    canCausar: false,
    canViewCausacion: false,
    canRevertApproval: false,
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
    canApproveCausacion: false,
    canCausar: false,
    canViewCausacion: false,
    canRevertApproval: false,
  },
} as const

export type RoleKey = keyof typeof ROLE_PERMISSIONS

export function getRolePermissions(role: string) {
  return ROLE_PERMISSIONS[role as RoleKey] || ROLE_PERMISSIONS.read_only
}
