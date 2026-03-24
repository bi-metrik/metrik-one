/**
 * Sprint 9 — D97/D166: Role permissions
 * Sprint 10: Agrega supervisor (5) y contador (6)
 * Shared constants — NOT a server action file
 */

export const ROLE_PERMISSIONS = {
  owner: {
    label: 'Empresario',
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
    canAssignResponsable: true,
    canCreateOportunidad: true,
    canCreateCotizacion: true,
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
    canAssignResponsable: true,
    canCreateOportunidad: true,
    canCreateCotizacion: true,
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
    canViewNumbers: true,
    canViewPipeline: true,
    canViewProjects: true,
    canViewAllProjects: true,
    canUseFab: true,
    canRegisterExpense: true,
    canRegisterHours: true,
    canRegisterCobro: true,
    canAssignResponsable: true,
    canCreateOportunidad: true,
    canCreateCotizacion: true,
    canExportCSV: true,
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
    canAssignResponsable: false,
    canCreateOportunidad: false,
    canCreateCotizacion: false,
    canExportCSV: false,
    canManageTeam: false,
    canApproveCausacion: false,
    canCausar: false,
    canViewCausacion: false,
    canRevertApproval: false,
  },
  contador: {
    label: 'Contador',
    canInvite: false,
    canDeleteRecords: false,
    canConfigFiscal: false,
    canViewNumbers: false,
    canViewPipeline: false,
    canViewProjects: false,
    canViewAllProjects: false,
    canUseFab: false,
    canRegisterExpense: false,
    canRegisterHours: false,
    canRegisterCobro: false,
    canAssignResponsable: false,
    canCreateOportunidad: false,
    canCreateCotizacion: false,
    canExportCSV: false,
    canManageTeam: false,
    canApproveCausacion: false,   // NO puede aprobar (solo owner/admin)
    canCausar: true,              // SI puede causar (asignar PUC+CC)
    canViewCausacion: true,       // SI puede ver /causacion
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
    canAssignResponsable: false,
    canCreateOportunidad: false,
    canCreateCotizacion: false,
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

// ── UI metadata para config de equipo ────────────────────────────────────────

export const ROLE_UI_CONFIG = [
  {
    value: 'owner',
    label: 'Dueño',
    description: 'Acceso total. Solo uno por workspace.',
  },
  {
    value: 'admin',
    label: 'Administrador',
    description: 'Maneja finanzas, contabilidad y equipo.',
  },
  {
    value: 'supervisor',
    label: 'Supervisor',
    description: 'Coordina el equipo, ve todo el trabajo.',
  },
  {
    value: 'operator',
    label: 'Ejecutor',
    description: 'Realiza el trabajo: ventas, operaciones o campo.',
  },
  {
    value: 'contador',
    label: 'Contador',
    description: 'Solo acceso al modulo de causacion contable.',
  },
  {
    value: 'read_only',
    label: 'Solo lectura',
    description: 'Ve reportes, no puede modificar.',
  },
] as const

export const AREA_UI_CONFIG = [
  {
    value: null,
    label: 'Ambas areas',
    description: 'Ve oportunidades y proyectos',
  },
  {
    value: 'comercial',
    label: 'Comercial',
    description: 'Coordina el pipeline de ventas',
  },
  {
    value: 'operaciones',
    label: 'Operaciones',
    description: 'Coordina la ejecucion de proyectos',
  },
  {
    value: 'administrativo',
    label: 'Administrativo',
    description: 'Reservado para uso futuro',
  },
] as const
