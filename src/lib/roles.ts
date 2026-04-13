/**
 * Sprint 9 — D97/D166: Role permissions
 * Sprint 10: Agrega supervisor (5) y contador (6)
 * 2026-04-10: Agrega permisos compliance (canViewRiesgos, canEditRiesgos, etc.)
 *
 * Matriz completa por rol — ver documentacion al final del archivo
 *
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
    canToggleDeducible: true,    // Marcar/desmarcar deducible fiscal en gastos
    // ── Compliance (modulo SARLAFT) ─────────────────────────
    canViewRiesgos: true,             // Ver /riesgos y /matriz
    canEditRiesgos: true,             // Crear y editar riesgos
    canDeleteRiesgos: true,           // Eliminar riesgos permanentemente
    canImportRiesgos: true,           // Importar desde Excel (bulk insert)
    canExportRiesgos: true,           // Descargar plantilla + exportar datos
    canConfigReglasValidacion: true,  // Configurar listas cautelares / reglas vinculantes
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
    canToggleDeducible: true,
    // Compliance
    canViewRiesgos: true,
    canEditRiesgos: true,
    canDeleteRiesgos: true,
    canImportRiesgos: true,
    canExportRiesgos: true,
    canConfigReglasValidacion: true,
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
    canToggleDeducible: false,
    // Compliance — supervisor = oficial de cumplimiento operativo
    canViewRiesgos: true,
    canEditRiesgos: true,          // Arma la matriz en el dia a dia
    canDeleteRiesgos: false,       // No elimina — solo cambia estado (trazabilidad)
    canImportRiesgos: true,        // Puede subir Excel del oficial
    canExportRiesgos: true,
    canConfigReglasValidacion: false, // Reglas vinculantes solo owner/admin
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
    canToggleDeducible: false,
    // Compliance — operator no ve matriz (rol operativo de negocios)
    canViewRiesgos: false,
    canEditRiesgos: false,
    canDeleteRiesgos: false,
    canImportRiesgos: false,
    canExportRiesgos: false,
    canConfigReglasValidacion: false,
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
    canToggleDeducible: true,     // SI puede marcar/desmarcar deducible fiscal
    // Compliance — contador no ve compliance (rol financiero)
    canViewRiesgos: false,
    canEditRiesgos: false,
    canDeleteRiesgos: false,
    canImportRiesgos: false,
    canExportRiesgos: false,
    canConfigReglasValidacion: false,
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
    canToggleDeducible: false,
    // Compliance — read_only = auditor (ve todo, no modifica)
    canViewRiesgos: true,
    canEditRiesgos: false,
    canDeleteRiesgos: false,
    canImportRiesgos: false,
    canExportRiesgos: true,        // Puede descargar plantilla y exportar (auditoria)
    canConfigReglasValidacion: false,
  },
} as const

// ── Matriz de permisos compliance (documentacion) ───────────────────────────
//
// | Accion                        | owner | admin | supervisor | operator | contador | read_only |
// |-------------------------------|:-----:|:-----:|:----------:|:--------:|:--------:|:---------:|
// | Ver riesgos / matriz          |   ✓   |   ✓   |     ✓      |    —     |    —     |     ✓     |
// | Crear / editar riesgo         |   ✓   |   ✓   |     ✓      |    —     |    —     |     —     |
// | Eliminar riesgo               |   ✓   |   ✓   |     —      |    —     |    —     |     —     |
// | Importar Excel                |   ✓   |   ✓   |     ✓      |    —     |    —     |     —     |
// | Exportar / descargar plantilla|   ✓   |   ✓   |     ✓      |    —     |    —     |     ✓     |
// | Configurar reglas validacion  |   ✓   |   ✓   |     —      |    —     |    —     |     —     |
//
// Logica:
// - owner/admin: control total (incluye eliminacion + reglas vinculantes)
// - supervisor:  oficial de cumplimiento operativo — arma matriz, importa, NO elimina ni cambia reglas
// - operator:    rol operativo de negocios — no ve compliance
// - contador:    rol financiero — no ve compliance
// - read_only:   auditor interno/externo — ve todo, exporta, no modifica nada
//
// Cambios: editar ROLE_PERMISSIONS arriba y los guards en src/lib/actions/riesgos.ts

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
  // contador: pausado en ONE nativo. Se activa via Clarity con modules.causacion.
  // read_only: pausado en ONE nativo. Se activa por workspace via Clarity.
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
