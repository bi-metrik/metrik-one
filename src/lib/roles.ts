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
    // 2026-04-27: causacion → revision (flag binario, sin formularios fiscales)
    canMarcarRevisado: true,
    canViewRevision: true,
    canExportRevision: true,
    canToggleDeducible: true,    // Marcar/desmarcar deducible fiscal en gastos
    // ── Compliance (modulo SARLAFT) ─────────────────────────
    canViewRiesgos: true,             // Ver /riesgos y /matriz
    canViewControlesAsignados: false, // N/A — ya ve todo via canViewRiesgos
    canEditRiesgos: true,             // Crear y editar riesgos
    canDeleteRiesgos: true,           // Eliminar riesgos permanentemente
    canImportRiesgos: true,           // Importar desde Excel (bulk insert)
    canExportRiesgos: true,           // Descargar plantilla + exportar datos
    canConfigReglasValidacion: true,  // Configurar listas cautelares / reglas vinculantes
    // ── Flujo (vista de proceso del workspace) ──────────────
    canViewFlujo: true,
    canConfigSlaEtapas: true,         // owner y admin configuran SLA
    canViewSlaLog: true,              // owner/admin/supervisor ven historial de SLA
    // ── Calidad de llamadas (modulo calidad_llamadas) ───────
    canViewCalidad: true,             // Entrar a /calidad
    canViewCalidadTodos: true,        // Ver las llamadas de TODOS los agentes
    canViewCalidadDinero: true,       // Vista de dueno: vendido vs recaudado
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
    canMarcarRevisado: true,
    canViewRevision: true,
    canExportRevision: true,
    canToggleDeducible: true,
    // Compliance
    canViewRiesgos: true,
    canViewControlesAsignados: false,
    canEditRiesgos: true,
    canDeleteRiesgos: true,
    canImportRiesgos: true,
    canExportRiesgos: true,
    canConfigReglasValidacion: true,
    canViewFlujo: true,
    // Los tiempos maximos por etapa los define el equipo que opera el proceso, no
    // solo el dueno: la sesion donde se acuerdan la lidera quien administra la
    // operacion. Decision de Mauricio, 2026-08-12.
    canConfigSlaEtapas: true,
    canViewSlaLog: true,
    // Calidad — admin ve toda la operacion pero no la plata del dueno
    canViewCalidad: true,
    canViewCalidadTodos: true,
    canViewCalidadDinero: false,
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
    canMarcarRevisado: false,
    canViewRevision: false,
    canExportRevision: false,
    canToggleDeducible: false,
    // Compliance — supervisor: solo lectura (edicion solo owner/admin desde 2026-05-31)
    canViewRiesgos: true,
    canViewControlesAsignados: false,
    canEditRiesgos: false,
    canDeleteRiesgos: false,
    canImportRiesgos: false,
    canExportRiesgos: true,
    canConfigReglasValidacion: false,
    canViewFlujo: true,
    // El supervisor de cada área configura SU proceso: los tiempos máximos de cada
    // etapa y a quién se le avisa al entrar un caso (al equipo y al cliente). Los dos
    // controles cuelgan de este permiso porque son la misma decisión: cómo se opera
    // la etapa. Sin él, quien lleva el día a día tiene que pedirle cada ajuste al
    // dueño, y la configuración se queda vieja — que es justo lo que pasó en SOENA:
    // Daniela y Deisy definieron en la capacitación qué se notifica en cada etapa y
    // no podían activarlo. Sigue fuera de su alcance el resto de la configuración
    // del flujo (etapas, bloques, gates), que es de owner/admin.
    canConfigSlaEtapas: true,
    canViewSlaLog: true,
    // Calidad — el supervisor de calidad es quien audita: ve todos los agentes,
    // no ve el dinero (esa vista es exclusiva del dueno).
    canViewCalidad: true,
    canViewCalidadTodos: true,
    canViewCalidadDinero: false,
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
    canMarcarRevisado: true,
    canViewRevision: true,
    canExportRevision: false,
    canToggleDeducible: false,
    // Compliance — operator: solo controles donde es responsable (filtro server-side)
    canViewRiesgos: false,
    canViewControlesAsignados: true,
    canEditRiesgos: false,
    canDeleteRiesgos: false,
    canImportRiesgos: false,
    canExportRiesgos: false,
    canConfigReglasValidacion: false,
    canViewFlujo: false,              // Operador ve negocios directamente, no necesita vista de proceso
    canConfigSlaEtapas: false,
    canViewSlaLog: false,
    // Calidad — el ejecutor (agente) entra a /calidad pero SOLO ve sus propias
    // llamadas. El filtro es server-side por agente_staff_id, en la lista Y en
    // el detalle (ver src/app/(app)/calidad/actions.ts).
    canViewCalidad: true,
    canViewCalidadTodos: false,
    canViewCalidadDinero: false,
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
    canMarcarRevisado: true,
    canViewRevision: true,
    canExportRevision: true,
    canToggleDeducible: true,     // SI puede marcar/desmarcar deducible fiscal
    // Compliance — contador: solo controles donde es responsable (filtro server-side)
    canViewRiesgos: false,
    canViewControlesAsignados: true,
    canEditRiesgos: false,
    canDeleteRiesgos: false,
    canImportRiesgos: false,
    canExportRiesgos: false,
    canConfigReglasValidacion: false,
    canViewFlujo: false,
    canConfigSlaEtapas: false,
    canViewSlaLog: false,
    // Calidad — el contador no tiene nada que hacer en auditoria de llamadas
    canViewCalidad: false,
    canViewCalidadTodos: false,
    canViewCalidadDinero: false,
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
    canMarcarRevisado: false,
    canViewRevision: true,
    canExportRevision: true,        // Auditor puede exportar para revisar
    canToggleDeducible: false,
    // Compliance — read_only = auditor (ve todo, no modifica)
    canViewRiesgos: true,
    canViewControlesAsignados: false,
    canEditRiesgos: false,
    canDeleteRiesgos: false,
    canImportRiesgos: false,
    canExportRiesgos: true,        // Puede descargar plantilla y exportar (auditoria)
    canConfigReglasValidacion: false,
    canViewFlujo: false,
    canConfigSlaEtapas: false,
    canViewSlaLog: false,
    // Calidad — auditor: ve todas las llamadas, no ve la plata
    canViewCalidad: true,
    canViewCalidadTodos: true,
    canViewCalidadDinero: false,
  },
} as const

// ── Matriz de permisos compliance (documentacion) ───────────────────────────
//
// | Accion                        | owner | admin | supervisor | operator | contador | read_only |
// |-------------------------------|:-----:|:-----:|:----------:|:--------:|:--------:|:---------:|
// | Ver riesgos / matriz          |   ✓   |   ✓   |     ✓      |    *     |    *     |     ✓     |
// | Crear / editar riesgo/causa/  |   ✓   |   ✓   |     —      |    —     |    —     |     —     |
// | control                       |       |       |            |          |          |           |
// | Eliminar                      |   ✓   |   ✓   |     —      |    —     |    —     |     —     |
// | Importar Excel                |   ✓   |   ✓   |     —      |    —     |    —     |     —     |
// | Exportar / descargar plantilla|   ✓   |   ✓   |     ✓      |    —     |    —     |     ✓     |
// | Configurar reglas validacion  |   ✓   |   ✓   |     —      |    —     |    —     |     —     |
//
// (*) operator/contador: lectura SOLO de controles donde son responsable (Fase C, filtro server-side)
//
// Logica (vigente 2026-05-31):
// - owner/admin: control total (edicion exclusiva)
// - supervisor:  solo lectura — antes editaba, ahora delegado a owner/admin
// - operator:    rol operativo — ve solo controles asignados (filtro por responsable_id)
// - contador:    rol financiero — ve solo controles asignados (filtro por responsable_id)
// - read_only:   auditor interno/externo — ve todo, exporta, no modifica
//
// Cambios: editar ROLE_PERMISSIONS arriba y los guards en src/lib/actions/riesgos.ts

export type RoleKey = keyof typeof ROLE_PERMISSIONS

export function getRolePermissions(role: string) {
  return ROLE_PERMISSIONS[role as RoleKey] || ROLE_PERMISSIONS.read_only
}

// ── Corrección de documentos (fuente única) ─────────────────────────────────
//
// Roles que pueden corregir un documento (campos extraídos, reprocesar,
// re-subir) aunque el bloque ya no esté en su etapa activa. El literal
// ['owner','admin','supervisor'] estaba duplicado en varios sitios; aquí queda
// una sola definición para que el criterio no se desincronice.
//
// OJO: NO confundir con `esGerencial()` de src/lib/permissions/guard-negocio.ts,
// que significa owner|admin (sin supervisor) y sirve para overrides de gate.

export const ROLES_CORRECCION_DOCUMENTOS = ['owner', 'admin', 'supervisor'] as const

export function puedeCorregirDocumentos(role?: string | null): boolean {
  return (ROLES_CORRECCION_DOCUMENTOS as readonly string[]).includes(role ?? '')
}

// ── Marcas de condición económica del negocio ───────────────────────────────
//
// Quién puede marcar un negocio como "con descuento" / "sin honorario". Mismo
// trío de roles que la corrección de documentos, pero es OTRA decisión: aquí se
// está afirmando algo sobre la plata del negocio, no corrigiendo un dato mal
// extraído. Si mañana el negocio decide que un supervisor no puede declarar un
// descuento, se cambia aquí sin tocar el flujo de documentos — por eso no se
// reusa `puedeCorregirDocumentos` aunque hoy la lista coincida.
//
// Un operator NO marca: la condición económica es una afirmación de dirección
// que la financiera después cuenta.

export const ROLES_MARCAS_NEGOCIO = ['owner', 'admin', 'supervisor'] as const

export function puedeMarcarCondicionNegocio(role?: string | null): boolean {
  return (ROLES_MARCAS_NEGOCIO as readonly string[]).includes(role ?? '')
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

// ── Descarga a Excel de la tabla de negocios ────────────────────────────────
//
// Quién puede bajarse la lista de `/negocios` (con los filtros puestos) como Excel.
// Compromiso con SOENA (Acta, cláusula SEXTA numeral 2), decidido el 2026-09-03:
// owner, admin y supervisor. Ni operator, ni read_only, ni contador.
//
// Fuente única: la consumen el gate de la ruta (`api/negocios/export`, que es el
// control real) y la lista (que decide si pinta el botón). Copiada en los dos lados
// se desincroniza sin ruido: un botón que aparece y falla, o un permiso que existe
// y nadie puede usar.

export const ROLES_DESCARGA_NEGOCIOS = ['owner', 'admin', 'supervisor'] as const

export function puedeDescargarNegocios(role?: string | null): boolean {
  return (ROLES_DESCARGA_NEGOCIOS as readonly string[]).includes(role ?? '')
}
