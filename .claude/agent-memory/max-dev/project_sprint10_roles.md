---
name: sprint-10 supervisor y contador
description: Patrones y decisiones del sprint que agrego roles supervisor y contador a metrik-one
type: project
---

## Sprint 10 — Roles supervisor (5) y contador (6)

### Commit
efd8ded feat: [sprint-10] agregar roles supervisor y contador

### Patron para agregar roles nuevos
1. Migration SQL: DROP/ADD CHECK en profiles + team_invitations. Agregar columnas (area, display_role) si aplica.
2. roles.ts: agregar entrada en ROLE_PERMISSIONS con todos los permisos en false por defecto, luego activar los que aplican. Exportar ROLE_UI_CONFIG y AREA_UI_CONFIG para UI.
3. app-shell.tsx: agregar a arrays de roles en ALL_NAV_ITEMS, CONTABILIDAD_NAV_ITEMS, MOBILE_PRIMARY_HREFS, ROLE_LABELS.
4. middleware.ts: actualizar ROLES_WITH_NUMBERS y getLanding() para el nuevo rol.
5. Crons: pasar area en el select de profiles, filtrar por area al buscar supervisores.
6. staff-actions.ts: actualizar roleMap en inviteStaffToPlataform.
7. accept-invite: actualizar getLandingForRole().

### Contador — acceso exclusivo
- Sidebar: solo ve seccion Contabilidad (causacion). navItems vacio porque ningun item de ALL_NAV_ITEMS tiene 'contador'.
- Guard: middleware redirige /cualquier-ruta → /causacion si role === 'contador'.
- Landing: /causacion.
- No consume licencias (isContador bypass en getLicenseInfo check).
- canCausar: true. canApproveCausacion: false.

### Supervisor — full access sin causacion
- canViewNumbers: true (supervisor es el primer rol que tiene esto sin ser owner/admin/read_only).
- canViewAllProjects: true.
- canAssignResponsable, canCreateOportunidad, canCreateCotizacion: true.
- canExportCSV: true.
- Sin: canDeleteRecords, canConfigFiscal, canInvite, canManageTeam, canApproveCausacion, canCausar.

### Campo area en profiles
- Valores: 'comercial' | 'operaciones' | 'administrativo' | null
- Solo afecta routing N1 y N7 (no permisos).
- N1 busca supervisores con area='comercial' OR area IS NULL.
- N7 busca supervisores con area='operaciones' OR area IS NULL.
- area=null significa "ambas areas" — recibe alertas de ambos crons.

### Campo display_role
- En profiles.display_role: se muestra en sidebar user section en vez del label generico.
- En staff.display_role: se guarda al crear el staff. Se copia a profiles via user_metadata en inviteUserByEmail.
- Solo se muestra el input de display_role en el form cuando rol_plataforma === 'supervisor'.

### Gotcha: tipos TypeScript
- Cada vez que se agrega una columna nueva a una tabla que tiene tipos generados, hay que correr gen types y re-agregar los ~26 aliases al final de database.ts.
- Patron temporal hasta migrar: `(supabase as any).from('tabla').select('nueva_col')`.
