# MeTRIK ONE — Changelog

> Historial de cambios por sprint y feature.

---

## 2026-02-26 — D246: Causacion Contable

### Migracion
- `20260226000001_causacion.sql` — 13 columnas nuevas en gastos/cobros, tabla causaciones_log, 4 indices, grandfather registros existentes como CAUSADO
- `20260226000002_backfill_created_by.sql` — Backfill created_by para registros existentes asignando al owner del workspace

### Roles (`src/lib/roles.ts`)
- 3 flags nuevos: `canApproveCausacion`, `canCausar`, `canViewCausacion`
- owner + admin: true | operator + read_only: false

### Movimientos — Extension
- **Tipo extendido**: `tabla`, `estado_causacion`, `rechazo_motivo` agregados a `Movimiento`
- **Filtro**: Nuevo parametro `estadoCausacion` en `getMovimientos()`
- **Server actions**: `aprobarMovimiento()` y `rechazarMovimiento()` creados
- **UI**: Badges de causacion (Pendiente rojo, Aprobado amarillo, Rechazado gris)
- **UI**: Botones Aprobar/Rechazar inline (solo owner/admin + PENDIENTE)
- **UI**: Dialog de rechazo con motivo obligatorio
- **UI**: Filtro "Estado contable" en panel de filtros avanzados
- **UI**: Badge D119 renombrado de "Pendiente" a "Pend. pago" para evitar confusion
- **UI**: Linea separada "Registrado por" con icono User + nombre del creador

### Causacion — Modulo Nuevo
- `src/app/(app)/causacion/actions.ts` — getCausacionData + causarMovimiento
- `src/app/(app)/causacion/page.tsx` — Server component
- `src/app/(app)/causacion/causacion-client.tsx` — Bandeja completa
  - Tabs: Aprobados / Causados (por mes)
  - Selector de mes con navegacion
  - Cards expandibles con formulario inline (Cuenta PUC, Centro costo, Retencion, Notas)
  - Boton "Causar" → APROBADO → CAUSADO
  - Tab causados: read-only con badges PUC/CC/Retencion
  - Empty states informativos
  - Banner info sobre rol contador futuro

### Navegacion
- Causacion separada en seccion "Contabilidad" del sidebar (debajo del nav principal)
- No aparece en mobile bottom tab bar
- Solo visible para owner/admin

### Types
- `database.ts` regenerado con aliases: CausacionLog, Empresa, Expense, ExpenseCategory, Invoice, MonthlyTarget, Note, OpportunityLegacy, Payment, ProjectLegacy, Quote, Servicio, Staff, Workspace

---

## 2026-02-25 — D119: Estado de Pago

### Migracion
- `20260326000003_estado_pago.sql` — estado_pago + fecha_pago en gastos

### Features
- Badge naranja "Pend. pago" en movimientos para gastos no pagados
- Boton "Pagado" → dialog con fecha de pago
- Server action `marcarComoPagado()`
- Filtro por estado de pago en movimientos

---

## 2026-02-25 — Proyectos Internos

### Migracion
- `20260226000000_proyectos_internos.sql` — Flag tipo: 'interno' en proyectos

### Features
- Proyectos internos para gastos operativos
- Filtro por tipo de proyecto en movimientos

---

## 2026-02-24 — Branding por Workspace

### Migracion
- `20260224000000_mi_negocio_columns.sql`
- `20260225000000_persona_natural_branding.sql`

### Features
- Color primario/secundario configurable
- Logo del workspace
- Sidebar adapta colores dinamicamente
- Luminancia automatica para contraste de texto

---

## 2026-02-23 — Sprint 3: Cotizacion Flash + Fiscal

### Migraciones
- `20260223000000_logo_storage.sql`
- `20260223000001_sprint_gaps.sql`
- `20260223000002_segmento_timer_cotizacion.sql`

### Features
- D32/D50/D86: Cotizacion Flash con 3 bloques fiscales
- D94: Parametros fiscales desde tabla (UVT $49,799)
- D93: Disclaimer fiscal obligatorio
- D85: 6 tipos de rubro en cotizacion
- D131: Link cotizacion → proyecto con herencia de rubros
- PDF cotizacion con @react-pdf/renderer
- Email cotizacion via Resend

---

## 2026-02-22 — Numeros Module

### Migracion
- `20260222000000_numeros_module.sql`

### Features
- Dashboard KPIs (P1-P5)
- Metas mensuales configurables
- Graficos con Recharts

---

## 2026-02-21 — Proyectos Module

### Migracion
- `20260221000000_proyectos_module.sql`

### Features
- D175: 6 estados de proyecto
- D141: Margen de contribucion
- Rubros presupuestados vs ejecutados
- Codigo auto-incremental (P-001, P-002...)

---

## 2026-02-20 — CRM v2

### Migracion
- `20260220000000_crm_v2_rebuild.sql`

### Features
- Pipeline kanban con @dnd-kit
- D25: Creacion rapida oportunidad
- D29: Cliente inline
- D173/D174: Reactivar/razon de perdida

---

## 2026-02-19 — Directorio

### Migracion
- `20260219000000_promoters_contacts_clients.sql`

### Features
- Empresas, contactos, promotores
- CRUD completo

---

## 2026-02-18 — Sprint 0: Schema Base

### Migracion
- `20260218000000_initial_schema.sql` — 23 tablas base, RLS policies, seed data

### Features
- Multi-tenancy con RLS
- Auth con magic link
- Subdomain routing
- Story Mode (D181)
- Onboarding 3 pasos
- FAB flotante (D43)
- App Shell (sidebar + mobile)
