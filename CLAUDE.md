# MéTRIK one — Contexto para Claude Code

## Proyecto

SaaS self-service para independientes y micro-PYMEs colombianas. Linea [21] de MéTRIK. Pipeline CRM + cotizaciones + proyectos + movimientos financieros + causacion contable + motor fiscal colombiano. Multi-tenant via subdomain routing.

**Repositorio git.** GitHub: `bi-metrik/metrik-one`. Auto-deploy en Vercel al push a `main`.

## Stack

| Capa | Tecnologia | Version |
|------|-----------|---------|
| Framework | Next.js (App Router) | 16.1.6 |
| UI | React | 19.2 |
| Estilos | Tailwind CSS (oklch) | 4.x |
| Backend | Supabase (PostgreSQL + Auth + Storage) | — |
| Tipos | TypeScript strict | 5.x |
| Validacion | Zod | 4.x |
| Forms | React Hook Form | 7.x |
| Charts | Recharts | 3.x |
| PDF | @react-pdf/renderer | 4.x |
| Email | Resend | 6.x |
| DnD | @dnd-kit | 6.x |
| State | Zustand | 5.x |
| UI Primitives | Radix UI | 1.4 |
| Iconos | Lucide React | 0.574 |
| Toasts | Sonner | 2.x |

## Infraestructura

| Servicio | Detalle |
|----------|---------|
| Hosting | Vercel (auto-deploy on `main` push) |
| Dominio | `metrikone.co` (wildcard SSL: `*.metrikone.co`) |
| Base de datos | Supabase PostgreSQL (ref: `yfjqscvvxetobiidnepa`) |
| Auth | Supabase Auth (magic link + Google OAuth preparado) |
| Storage | Supabase Storage (logos, soportes gastos) |
| Edge Functions | Supabase (WhatsApp webhook, evaluar-reglas) |
| GitHub | `bi-metrik/metrik-one` |

## Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL=https://yfjqscvvxetobiidnepa.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_BASE_DOMAIN=metrikone.co   # dev: localhost:3000
NEXT_PUBLIC_APP_NAME=MéTRIK ONE
```

## Comandos

```bash
# Desarrollo
npm run dev                    # Next.js dev server

# Build y lint
npm run build
npm run lint

# Supabase CLI (requiere SUPABASE_ACCESS_TOKEN env var)
npx supabase gen types typescript --project-id yfjqscvvxetobiidnepa > src/types/database.ts 2>/dev/null
# IMPORTANTE: Despues de gen types, re-agregar los ~26 type aliases al final de database.ts
# (Gasto, Proyecto, Oportunidad, Profile, Workspace, etc.)

# Migraciones
npx supabase migration new nombre_migracion
npx supabase db push
```

## Multi-Tenancy

Subdomain routing: `ana.metrikone.co` → workspace slug `"ana"`.

**Middleware** (`src/middleware.ts`):
1. Extrae slug del subdominio
2. No autenticado → `/login` en dominio marketing
3. Autenticado sin workspace → `/onboarding`
4. Autenticado con workspace → redirige a subdominio del tenant
5. Rutas protegidas validan sesion + workspace

**Aislamiento** (RLS):
- Todas las tablas tienen `workspace_id`
- RLS policies usando `current_user_workspace_id()` (funcion PostgreSQL)

**Dev local**: `localhost:3000` (marketing), no hay subdomain routing en dev — todo opera en el mismo host.

## Estructura del proyecto

```
metrik-one/
├── CLAUDE.md                    # Este archivo
├── package.json
├── src/
│   ├── app/
│   │   ├── page.tsx              # Landing marketing
│   │   ├── (marketing)/
│   │   │   ├── login/page.tsx    # Magic link + Google OAuth
│   │   │   └── registro/page.tsx # Registro nuevo usuario
│   │   ├── (onboarding)/
│   │   │   └── onboarding/page.tsx # 3 pasos: nombre → negocio+slug → profesion
│   │   ├── (app)/                # Rutas autenticadas (tenant)
│   │   │   ├── app-shell.tsx     # Sidebar + header + mobile tab bar
│   │   │   ├── fab.tsx           # Floating action button
│   │   │   ├── numeros/          # KPIs dashboard (P1-P5)
│   │   │   ├── pipeline/         # CRM kanban (5 etapas)
│   │   │   │   └── [id]/         # Detalle oportunidad + cotizaciones
│   │   │   ├── proyectos/        # Proyectos (6 estados)
│   │   │   │   └── [id]/         # Detalle proyecto
│   │   │   ├── movimientos/      # Registro transaccional
│   │   │   ├── causacion/        # Bandeja contable (D246)
│   │   │   ├── directorio/       # Empresas + contactos
│   │   │   ├── facturacion/      # Facturas
│   │   │   ├── nuevo/            # Formularios creacion (gasto, cobro, oportunidad, contacto)
│   │   │   ├── config/           # Configuracion (fiscal, equipo, banco, servicios, staff, metas)
│   │   │   ├── mi-negocio/       # Perfil empresa/marca
│   │   │   ├── promotores/       # Promotores/referidos
│   │   │   ├── semaforo/         # Score de salud (schema listo, formula pendiente)
│   │   │   ├── story-mode/       # Tutorial interactivo (7 pantallas)
│   │   │   └── dashboard/        # Dashboard bienvenida (legacy, no trackeado)
│   │   └── accept-invite/        # Aceptar invitacion de equipo
│   ├── components/
│   │   ├── ui/                   # Primitivos shadcn/ui
│   │   ├── entity-card.tsx       # Card reutilizable
│   │   ├── notes-section.tsx     # Sistema de notas generico
│   │   ├── metrik-lockup.tsx     # Logo MéTRIK one tipografico
│   │   └── timer/                # Timer flotante
│   ├── lib/
│   │   ├── actions/              # Server actions compartidos
│   │   ├── supabase/             # Clientes Supabase (client, server, middleware)
│   │   ├── fiscal/               # Motor fiscal colombiano
│   │   │   ├── constants.ts      # UVT, tasas, categorias
│   │   │   ├── calculos.ts       # Calculos fiscales base
│   │   │   └── calculos-fiscales.ts # Cotizacion Flash (3 bloques)
│   │   ├── pipeline/             # Constantes pipeline (5 etapas)
│   │   ├── projects/             # Config proyectos (6 estados)
│   │   ├── contacts/             # Constantes contactos
│   │   ├── roles.ts              # 4 roles: owner, admin, operator, read_only
│   │   ├── pdf/                  # Generacion PDF cotizaciones (@react-pdf)
│   │   └── export-csv.ts         # Exportacion CSV
│   ├── types/
│   │   └── database.ts           # Types auto-generados Supabase + 26 aliases (~3785 lineas)
│   └── middleware.ts             # Subdomain routing + auth guard
├── supabase/
│   ├── migrations/               # ~27 archivos SQL (desde 20260218)
│   └── functions/                # Edge functions (WhatsApp webhook)
└── docs/
    ├── FEATURES.md               # Features por modulo con estado
    ├── CHANGELOG.md              # Cambios por sprint
    └── ARCHITECTURE.md           # Arquitectura tecnica completa
```

## Rutas (31 paginas)

### Marketing (dominio base)
- `/` — Landing con MetrikLockup + CTA
- `/login` — Magic link + Google OAuth (deshabilitado)
- `/registro` — Registro nuevo usuario

### Onboarding
- `/onboarding` — 3 pasos: nombre → negocio+slug → profesion

### App (subdominio tenant)
- `/numeros` — KPIs: facturacion, recaudo, gastos, margen, pipeline
- `/pipeline` — Kanban CRM (@dnd-kit)
- `/pipeline/[id]` — Detalle oportunidad
- `/pipeline/[id]/cotizacion/nueva` — Nueva cotizacion
- `/pipeline/[id]/cotizacion/[cotId]` — Detalle cotizacion
- `/proyectos` — Lista proyectos
- `/proyectos/[id]` — Detalle proyecto (rubros, horas, gastos)
- `/movimientos` — Registro transaccional con filtros avanzados
- `/causacion` — Bandeja contable (Aprobados / Causados)
- `/facturacion` — Facturas
- `/directorio` — Hub empresas + contactos
- `/directorio/empresas` — Lista empresas
- `/directorio/empresa/[id]` — Detalle empresa
- `/directorio/contactos` — Lista contactos
- `/directorio/contacto/[id]` — Detalle contacto
- `/nuevo/gasto` — Formulario gasto
- `/nuevo/cobro` — Formulario cobro
- `/nuevo/oportunidad` — Formulario oportunidad
- `/nuevo/contacto` — Formulario contacto
- `/config` — Configuracion (fiscal, equipo, banco, servicios, staff, metas)
- `/mi-negocio` — Perfil empresa/marca (branding, logo, colores)
- `/promotores` — Promotores/referidos
- `/semaforo` — Score de salud del negocio
- `/story-mode` — Tutorial interactivo (7 pantallas)
- `/accept-invite` — Aceptar invitacion de equipo

## Base de datos

52 tablas + 5 vistas SQL + 4 funciones PostgreSQL. Todas las tablas con `workspace_id` + RLS.

### Tablas principales
- `workspaces` — Tenant: slug, nombre, suscripcion, branding (colores, logo)
- `profiles` — Usuarios: role, full_name, workspace_id
- `oportunidades` — Pipeline CRM (lead→prospecto→propuesta→negociacion→ganado/perdido)
- `cotizaciones` + `quote_items` — Cotizaciones con 6 tipos de rubro
- `proyectos` + `proyecto_rubros` — Proyectos (en_ejecucion, pausado, completado, rework, cancelado, cerrado)
- `gastos` — Egresos (9 categorias, deducibilidad, causacion contable, soporte foto)
- `cobros` — Ingresos/pagos recibidos
- `facturas` + `payments` — Facturacion y pagos
- `fiscal_profiles` + `fiscal_params` — Motor fiscal colombiano
- `empresas` + `contactos` — Directorio
- `causaciones_log` — Auditoria flujo contable
- `horas` + `staff` — Registro de horas y equipo interno
- `custom_fields` + `custom_field_mappings` — Campos custom por tenant + herencia entre entidades
- `labels` + `entity_labels` — Etiquetas con colores, many-to-many con entidades
- `tenant_rules` — Motor de reglas condicionales: gates, automatizaciones, notificaciones por tenant (post-MVP)
- `activity_log` — Timeline de comentarios + cambios automaticos del sistema

### Vistas
- `v_proyecto_financiero` — Resumen financiero por proyecto
- `v_facturas_estado` — Estado de facturas
- `v_gastos_fijos_mes_actual` — Gastos fijos del mes
- `v_cartera_antiguedad` — Antiguedad de cartera
- `v_proyecto_rubros_comparativo` — Presupuesto vs real

### Funciones
- `get_next_proyecto_codigo()` — Auto-incremento P-001, P-002...
- `get_next_cotizacion_consecutivo()` — Auto-incremento COT-001...
- `current_user_workspace_id()` — Helper para RLS
- `check_perfil_fiscal_completo()` — Validar perfil fiscal

## Sistema de roles

4 roles en `profiles.role`. Definidos en `src/lib/roles.ts`.

| Permiso | owner | admin | operator | read_only |
|---------|:-----:|:-----:|:--------:|:---------:|
| Invitar equipo | Si | No | No | No |
| Config fiscal | Si | No | No | No |
| Gestionar equipo | Si | No | No | No |
| Eliminar registros | Si | Si | No | No |
| Ver Numeros | Si | Si | No | Si |
| Ver Pipeline | Si | Si | No | No |
| Ver todos los proyectos | Si | Si | No | No |
| Ver proyectos propios | Si | Si | Si | No |
| Usar FAB | Si | Si | Si | No |
| Registrar gasto/horas | Si | Si | Si | No |
| Registrar cobro | Si | Si | No | No |
| Exportar CSV | Si | Si | No | Si |
| Aprobar/Causar (D246) | Si | Si | No | No |

## Motor fiscal colombiano

Ubicacion: `src/lib/fiscal/`

- **IVA:** 19%
- **Retencion en la fuente:** 11% (servicios) / 10% (compras)
- **ReteICA:** 9.66 por mil
- **ReteIVA:** 15% del IVA
- **UVT 2025:** $49,799
- **9 categorias de gasto:** materiales, transporte, servicios_profesionales, viaticos, software, impuestos_seguros, mano_de_obra, alimentacion, otros
- **Deducibilidad (D142):** Solo regimen ordinario, requiere soporte

## Flujo de causacion contable (D246)

```
Nuevo gasto/cobro → PENDIENTE → [Aprobar] → APROBADO → [Causar con PUC+CC] → CAUSADO
                              → [Rechazar con motivo] → RECHAZADO
```

Solo owner/admin. Cada accion en `causaciones_log`. Seccion "Contabilidad" en sidebar.

## Design system

- Fuente: Montserrat (var(--font-montserrat))
- Color primario: Verde MéTRIK `#10B981` (hover: `#059669`)
- Texto principal: `#1A1A1A`
- Texto secundario: `#6B7280`
- Bordes: `#E5E7EB`
- Focus ring: `rgba(16,185,129,0.15)`
- Logo: componente `MetrikLockup` — tipografico "MéTRIK one" (one en minuscula, subindice 1)
- Branding por workspace: color primario/secundario + logo configurable

## Progreso por sprint

| Sprint | Fecha | Contenido |
|--------|-------|-----------|
| 0 | 2026-02-18 | Schema base (23 tablas), auth, RLS, onboarding, Story Mode, FAB, app shell |
| 1 | 2026-02-19-20 | Directorio, CRM v2 (kanban), proyectos, numeros (KPIs) |
| 2 | 2026-02-21-22 | Proyectos module, numeros module con Recharts |
| 3 | 2026-02-23 | Cotizacion Flash + fiscal (D32/D50/D86/D94/D93), PDF, email |
| — | 2026-02-24 | Branding por workspace (colores, logo, luminancia) |
| — | 2026-02-25 | Estado de pago (D119), proyectos internos |
| — | 2026-02-26 | Causacion contable (D246), docs MVP v1.0 |
| — | 2026-03-04 | UI: splash, isotipo ONE (M₁), lockup tipografico, normalizacion ONE→one |

## Ultimo avance
**Sesion:** 2026-04-05 (sesion D — modulo negocios: fixes cotizacion + header)
**Branch:** main
**Commit:** `249c051`

Que se hizo (sesion D):
- Feat: BloqueCotizacion completo — crear detallada, aprobar, rechazar, PDF, duplicar, estado solo-lectura cuando hay aceptada
- Feat: ActivityLog en negocios — menciones @staff, link URL, 280 chars, entidad_tipo='negocio' habilitado en activity_log
- Feat: Header negocio rediseñado — boton volver, ID visible (UUID slice), precio gris=estimado/negro=aprobado
- Feat: CarpetaUrlEditor — input inline editable en header para link Drive, guarda en Enter/blur
- Feat: Links clickeables a perfil empresa y contacto en header (con IDs en join query)
- Fix (migration 008): UNIQUE INDEX `idx_una_enviada_por_negocio` — permite N borradores, bloquea 2da enviada
- Fix (migration 009): Trigger `trg_cotizacion_auto_codigo` para negocios — `WHERE oportunidad_id = NULL` siempre era FALSE, generaba SIN-C1 en todas → ahora usa consecutivo como codigo para cotizaciones sin oportunidad
- Fix (migration 010): `fn_notif_mencion` soporta `entidad_tipo='negocio'` — antes el ELSE dejaba deep_link y entidad_nombre null
- Fix: PDF `oportunidades!inner` → left join + cadena empresa (oportunidad → negocio → fallback) para cotizaciones sin oportunidad
- Fix: `duplicarCotizacion` ahora copia `negocio_id` para que la copia aparezca en el bloque correcto
- Fix: `aceptarCotizacionNegocio` actualiza `negocio_bloques.estado='completo'` al aprobar cotizacion
- Fix: Null safety en `createCotizacionDetalladaNegocio` (data null sin dbError → TypeError)
- Fix: Fallback `consecutivo` cambiado a epoch (COT-YYYY-{epoch}) para evitar colision UNIQUE si RPC falla
- Fix: `nueva/page.tsx` redirige con `?err=` param en lugar de silenciar errores; NegocioDetailClient muestra toast.error
- Fix: `actualizarCarpetaUrlNegocio` — server action con validacion workspace
- Todas las migraciones 008-010 aplicadas en produccion (verificado con `supabase db push`)

**Commits de sesion (sesion D):**
- `3b75330` fix: cotización editable en etapas 1-2 SOENA + actividad staffId
- `27287f3` fix: revalidatePath en actualizarBloqueData y marcarBloqueCompleto
- `dd21110` fix: activity_log permite entidad_tipo='negocio'
- `6884778` feat: integración completa sistema cotizaciones en módulo negocios
- `ea089b3` feat: ActivityLog completo en negocios — menciones, link, 280 chars
- `8cbc572` feat: negocio detail — bloques contraidos, botón volver, ID visible, cotización aprobable
- `ce52f23` fix: cotizaciones de negocio — trigger, PDF, duplicar, rechazar, bloque completo
- `e8c3114` fix: header negocio + notificaciones de mención
- `8b9720b` fix: null safety + carpeta_url inline editor
- `503d5b6` fix: links a perfil empresa y contacto en header
- `249c051` fix: cotización borrador — fallback único + error visible en UI

## Estado actual (2026-04-05)

- **Branch:** main
- **Produccion:** Desplegado en Vercel, dominio metrikone.co activo — commit `249c051`
- **WhatsApp bot:** Edge function `wa-webhook` deployada con --no-verify-jwt
- **Google OAuth:** Preparado en codigo, deshabilitado (`googleEnabled = false`) — pendiente credenciales en Supabase
- **CRON_SECRET:** Configurado en Vercel. Secret en `.credentials.md`
- **Workflow engine:** Activo en produccion. Tablas `workspace_stages` + `stage_transition_rules` con etapas de sistema seedeadas en todos los workspaces
- **Estado MVP:** COMPLETO — fase go-to-market + Clarity tailor-made sobre ONE
- **Modulo negocios:** Operativo con bloques, cotizaciones, activity log. Pendiente: ID formato SOE-11, header refinado per Noor, auto-cotizacion al crear oportunidad, recorrer etapas SOENA de punta a punta

## Features NO implementados (Roadmap)

| Feature | Prioridad | Estado |
|---------|-----------|--------|
| Notificaciones in-app | Alta | COMPLETADO 2026-03-24 |
| Rol supervisor (5°) | Alta | COMPLETADO 2026-03-24 |
| Rol contador (6°, solo causacion) | Alta | COMPLETADO 2026-03-24 |
| D168 Campanazo digital (confetti al cerrar deal) | Media | Post-MVP, diseno cerrado, 2-3h |
| Google OAuth | Media | Codigo listo, faltan credenciales en Supabase |
| Wizard fiscal Felipe (D234-D236) | Media | Schema listo |
| Nomina/Payroll (D129) | Media | Schema listo |
| Health Score calculo (D105) | Media | Schema listo |
| WhatsApp bot: wizard fiscal OPP_GANADA | Media | Pendiente — hard gate actual rompe flujo end-to-end |
| WhatsApp bot: templates + media (facturas) | Media | Pendiente — solo type:text implementado, falta sendTemplate() |
| Workflow engine: etapas custom + reglas automaticas | Alta | COMPLETADO 2026-03-26 — uso interno via /configure-workflow |
| Motor referidos (go-to-market) | Alta | Pendiente — /promotores existe, falta UI incentivos + tracking |
| Alegra sync (contabilidad) | Baja | 5% (schema listo) |
| Subscriptions/Billing (Stripe) | Baja | No iniciado |
| Reconciliacion bancaria | Baja | Schema listo |
| Dark mode completo | Baja | Parcial — login/registro/lockup completados, otros pendientes |

## Gotchas y convenciones

- **Siempre commit + push** despues de completar un task. El usuario espera deploy despues de cada cambio.
- **Paths con parentesis** en git: quotear para zsh — `git add "src/app/(app)/..."`.
- **Supabase CLI:** Necesita `SUPABASE_ACCESS_TOKEN=sbp_...` como env var y `2>/dev/null` para type gen.
- **Edge Functions deploy:** `wa-webhook` SIEMPRE con `--no-verify-jwt` (Meta usa HMAC, no JWT). Comando: `SUPABASE_ACCESS_TOKEN=sbp_... npx supabase functions deploy wa-webhook --project-ref yfjqscvvxetobiidnepa --no-verify-jwt`
- **database.ts:** Despues de `supabase gen types`, re-agregar los ~26 type aliases custom al final del archivo (Gasto, Proyecto, Oportunidad, Profile, Workspace, etc.).
- **PostgreSQL views:** Usar `DROP VIEW` + `CREATE VIEW` (no `CREATE OR REPLACE`) cuando se agregan columnas.
- **Nombres de migracion:** formato `YYYYMMDD000000_descripcion.sql`.
- **Server actions:** Archivos en `src/lib/actions/` o colocados junto a la pagina que los usa.
- **Idioma UI:** Espanol (Colombia). Textos hardcodeados, sin i18n.
- **Nomenclatura:** "MéTRIK one" (one en minuscula) en toda la app. Isotipo: M₁.
- **Modulos por empresa:** Cuando se necesite un modulo visible solo para un workspace especifico (ej: dashboard de otro producto, panel de control interno), seguir este patron:
  1. Env var `ADMIN_WORKSPACE_ID` (o equivalente) con el UUID del workspace autorizado
  2. Server layout pasa prop `isAdminWorkspace` comparando `profile.workspace_id === process.env.ADMIN_WORKSPACE_ID`
  3. Sidebar condiciona la seccion con ese prop (client component no lee env vars)
  4. Page server component valida `workspaceId` y redirect si no coincide
  5. Server actions validan `workspaceId` como ultima barrera
  6. Ruta bajo `/admin/[modulo]` — seccion "Admin" en sidebar
  7. Env vars en Vercel con `printf` (no `echo`) para evitar trailing `\n`

## Documentacion existente

| Archivo | Contenido |
|---------|-----------|
| `docs/FEATURES.md` | Todos los features por modulo con estado (implementado/schema listo/planeado) |
| `docs/CHANGELOG.md` | Cambios por sprint con detalle de migraciones y features |
| `docs/ARCHITECTURE.md` | Arquitectura tecnica completa: stack, infra, multi-tenancy, 48 tablas, roles, fiscal, navegacion |

## Pendientes

- [x] Dashboard Admin Mi Bolsillo (`/admin/mibolsillo`) — completado 2026-03-13
- [x] Modulo /equipo con gestion de horas — completado 2026-03-18
- [x] Costos ejecutados por categoria en proyecto — completado 2026-03-18
- [x] Costo horas por tarifa individual de staff — completado 2026-03-18
- [x] Sistema de roles [98G]: 5 niveles, proteccion paginas, filtrado operador, dual responsables — completado 2026-03-22
- [x] Mi Negocio rediseno: sidebar + acordeon mobile + Mi Plan card — completado 2026-03-22
- [x] Tab bar mobile: 4 tabs + "Mas" overflow — completado 2026-03-22
- [x] Activity Log / Comentarios: timeline con menciones, links, cambios automaticos — completado 2026-03-22
- [x] [98H] Custom Fields + Labels + Herencia nivel 1 — completado 2026-03-22
- [x] Notificaciones in-app N1-N8b + D170-D176 — completado 2026-03-24
- [x] Rol supervisor (5°) con routing por area — completado 2026-03-24
- [x] Rol contador (6°, solo causacion) — completado 2026-03-24
- [x] WhatsApp bot 3-wave overhaul (nuevos intents, UNCLEAR, alertas proactivas) — completado 2026-03-22
- [x] WhatsApp bot: titulo limpio de gastos — completado 2026-03-25
- [x] Deducible toggle en modulo causacion — completado 2026-03-25
- [x] Workflow engine: workspace_stages + stage_transition_rules + evaluate_stage_rules — completado 2026-03-26
- [x] Commit residuales WA sprint: execute.ts + gasto-directo.ts — incluidos en 2ca4980
- [x] Rediseno completo `/tableros` — Sprint 1+2+3 implementados, build limpio — completado 2026-03-31
- [x] Merge PR #1 `feat/tenant-rules-motor` — mergeado 2026-04-01
- [x] Aplicar migracion `tenant_rules` en produccion — aplicada 2026-04-01
- [x] Deploy Edge Function `evaluar-reglas` — deployada 2026-04-01
- [x] Configurar workspace SOENA — campos, modulos financieros y valor_anticipo aplicados 2026-04-05
- [x] Bloques renderers completos (11 tipos) — sesion C 2026-04-05
- [x] Configuración SOENA VE en DB — sesion C 2026-04-05
- [x] BloqueCotizacion funcional con flujo completo (crear/aprobar/rechazar/PDF/duplicar) — sesion D 2026-04-05
- [x] ActivityLog en negocios — menciones, link, 280 chars — sesion D 2026-04-05
- [x] Header negocio rediseñado — volver, ID, precio, carpeta editable, links empresa/contacto — sesion D 2026-04-05
- [x] Migraciones 008-010 aplicadas en produccion — sesion D 2026-04-05
- [ ] **CRITICO SOENA:** Recorrer todas las etapas VE de punta a punta y verificar que cada bloque funciona correctamente
- [ ] **CRITICO SOENA:** Auto-cotizacion cuando se crea una oportunidad en SOENA (feature no implementado — debe crearse automaticamente al abrir negocio)
- [ ] **PENDIENTE:** ID negocio formato SOE-11 — campo `negocios.codigo` generado por trigger, `empresas.alias_corto` configurable. Decision: Modelo A (auto de nombre empresa) con override manual. Ver debate Hana/Vera sesion D
- [ ] **PENDIENTE:** Header negocio refinado segun spec Noor (jerarquia 4 filas: nav / titulo+accion / empresa+contacto+precio / carpeta+linea / progreso)
- [ ] Verificar tableros en browser real (desktop + mobile viewport)
- [ ] Verificar cards condicionales en ambiente real (F6, C6, O7, O2 emptyMessage)
- [ ] Piloto workflow engine con primer cliente Clarity — configurar via `/configure-workflow [slug]`
- [ ] Activar programa referidos (/promotores): UI incentivos + deep links + tracking — pendiente sprint go-to-market
- [ ] Wizard fiscal en WhatsApp para OPP_GANADA (hard gate actual rompe flujo end-to-end)
- [ ] Templates + media en wa-respond.ts (facturas por WhatsApp, compliance Meta)
- [ ] Google OAuth (codigo listo, faltan credenciales en Supabase)
- [ ] AI-suggested deducibility para gastos
- [ ] Verificar que registro de horas desde proyecto pasa created_by correctamente
- [ ] Custom fields en contactos/empresas detail (cuando se creen esas vistas)

## Decisiones clave

| Fecha | Decision | Contexto |
|-------|----------|----------|
| 2026-03-12 | Dashboard Mi Bolsillo dentro de ONE, no standalone | Reunion directiva unanime. Mejor integrado al ecosistema ONE |
| 2026-03-13 | Acceso a modulos por empresa via ADMIN_WORKSPACE_ID | Solo rol owner no basta — otros workspaces tambien tienen owners. Se necesita filtro por workspace UUID |
| 2026-03-13 | Cross-project Supabase con service role key server-only | Patron para conectar a otros proyectos Supabase desde ONE. Nunca exponer key al client |
| 2026-03-13 | Patron de modulos empresa-especificos estandarizado | Env var + 3 capas (sidebar prop, page redirect, action guard). Reusar para cualquier modulo futuro por workspace |
| 2026-03-18 | Costo horas por tarifa individual de cada staff | La vista SQL anterior usaba un solo staff principal. Si nadie tenia es_principal=true, costo_horas=0. Ahora cada registro de hora usa la tarifa del staff que la registro |
| 2026-03-18 | Ruta /equipo (no /horas) para hub de gestion de equipo | Mas amplio que solo horas, alinea con perfil de staff y metricas del equipo |
| 2026-03-18 | Sin causaciones_log para horas por ahora | Flujo de aprobacion directo sin tabla de auditoria. Se puede agregar despues si se necesita |
| 2026-03-18 | Auto-aprobacion de horas para owner/admin | Reduce friccion. Solo operadores necesitan aprobacion explicita |
| 2026-03-18 | Solo APROBADO cuenta en proyecto (no CAUSADO) | CAUSADO es contable, no operativo. El PM solo ve gastos aprobados |
| 2026-03-18 | Barras de costos: umbrales 70/90/100, slate sin presupuesto | Consenso Vera+Kenji+Kaori+Hana. Estandar EVM simplificado |
| 2026-03-18 | WhatsApp botones interactivos para confirmaciones | UX mejorada: botones tappables en vez de texto libre. IDs estandar: btn_confirm, btn_cancel, btn_despues |
| 2026-03-18 | wa-webhook deploy siempre con --no-verify-jwt | Meta envia HMAC signature, no JWT. Sin este flag el webhook rechaza todo con 401 |
| 2026-03-22 | Mi Negocio: sidebar desktop + acordeon mobile | Cards en sidebar, contenido expande al lado (desktop) o inline debajo (mobile). Mi Plan es card regular |
| 2026-03-22 | Tab bar mobile: 4 primarios + "Mas" | owner/admin: Numeros, Oportunidades, Proyectos, Tableros. Resto en panel expandible. Roles con <=4 items no ven boton Mas |
| 2026-03-22 | Activity Log reemplaza notes-section | Comentarios tipo tweet (280 chars) + menciones + links + cambios automaticos del sistema. Tabla activity_log ya en produccion |
| 2026-03-22 | [98H] Custom fields JSONB, no ALTER TABLE por cliente | D154: Campos custom en custom_data JSONB. Solo MéTRIK configura via Clarity (skill /configure-fields). Labels como many-to-many con colores |
| 2026-03-22 | Herencia custom_data en handoff via mappings | Oportunidad→Proyecto: custom_field_mappings define que slugs se copian. Idempotente, configurable por workspace |
| 2026-03-24 | Notificacion = tarea pendiente, no log (D163) | Solo se notifica lo que requiere accion. Estado tripartito: pendiente/completada/descartada. Max 2-4 por dia |
| 2026-03-24 | 9 tipos de notificacion (N1-N8b), crons 13:00 UTC | N1 escalamiento 3-5-7-15d por rol. N7 inactividad proyecto 2-5d. Realtime via Supabase |
| 2026-03-24 | Roles genericos > roles especializados para ICP ONE | Consenso Hana+Kaori+directivos. 5 roles + area como tag. Roles especializados generan friccion en onboarding PYME |
| 2026-03-24 | Supervisor (5° rol): permisos operativo-comerciales | Ve pipeline + proyectos completos. Sin delete ni causacion. area (comercial/operaciones/null) solo afecta routing N1/N7 |
| 2026-03-24 | Contador (6° rol): solo causacion, ilimitado gratis | Puede causar (PUC+CC), no puede aprobar. Solo ve /causacion. No consume licencia del plan |
| 2026-03-24 | profiles.area afecta routing notificaciones, no permisos | N1 busca supervisor con area=comercial o null. N7 busca supervisor con area=operaciones o null. Fallback a owner |
| 2026-03-24 | CRON_SECRET en Vercel con printf (no echo) | echo agrega trailing newline. Vercel rechaza CRON_SECRET con whitespace. Usar printf para env vars en CLI |
| 2026-03-25 | Panel notificaciones movil: fixed inset-0 (full-screen) | El dropdown absolute right-0 se corria a la izquierda en movil. Full-screen con overlay es el patron correcto |
| 2026-03-25 | Deducible toggle: permiso canToggleDeducible en roles.ts | Solo owner/admin/contador pueden cambiar deducibilidad. Validacion en server action antes de UPDATE |
| 2026-03-25 | WhatsApp HMAC: fallar hard en prod si falta APP_SECRET | Sin validacion cualquiera puede inyectar mensajes. DENO_DEPLOYMENT_ID como proxy de produccion |
| 2026-03-25 | Titulo de gasto: buildGastoTitle() no mensaje_original | Formato: concepto NLP (si <=40 chars) o "[categoria] — $monto". mensaje_original va a campo notas |
| 2026-03-25 | 6 roles reales en WhatsApp bot | operator/supervisor: mismos permisos que collaborator anterior. contador: solo consultas. read_only: consultas basicas |
| 2026-03-25 | MVP declarado completo | Todos los pendientes del roadmap MVP cerrados. Proximos pasos: go-to-market + features post-MVP |
| 2026-03-25 | Go-to-market: referidos primero (CAC $3-5K), Meta Ads segundo (CAC $15-38K) | Consenso Mateo+Sami. /promotores ya existe en producto. Meta con gate semanal de CAC |
| 2026-03-25 | Alianza contadores como canal multiplicador | 60K contadores en Colombia. Referral fee post-conversion. Landing metrikone.co/programa-contadores |
| 2026-03-26 | Workflow engine: etapas minimas sistema + custom entre ellas | Opcion 2 aprobada — sin duplicidad de estados. etapas_sistema protegidas (es_sistema=true), custom insertables entre ellas |
| 2026-03-26 | UI configuracion workflow solo interna — no visible al usuario ONE | Usuarios de ONE no deben ver ni configurar etapas. MeTRIK configura via /configure-workflow |
| 2026-03-26 | Modelo AI-first: cuello de botella es diseno, no ejecucion | Validado con datos: Max ejecuta en 10-30min, discovery cliente toma 2-5h. Documentado en execution-model.md y agentes |
| 2026-03-26 | Proceso discovery Clarity-ONE: 3 bloques → Brief → /configure-workflow → QA | Hana + Kaori. Brief de configuracion es requisito antes de ejecutar. Proceso [34] en metrik-docs |
| 2026-04-01 | Gates son servicio Clarity — tenant_rules vacio por defecto | No hay gates sin que MeTRIK los configure. Cada cliente tiene reglas de su negocio que MeTRIK levanta en discovery |
| 2026-04-01 | Motor de reglas condicionales: block_transition evalua ANTES de persistir cambio de estado | estado_nuevo en contexto status_change hace los gates etapa-especificos. HTTP 422 si gate activo |
| 2026-04-01 | SOENA: proceso VE es primer cliente Clarity sobre ONE | Pipeline (stages A-B) + Proyectos (10 estados C-F). 11 etapas, 9 campos custom, gates documentales. Bizzagi sin API — trazabilidad en ONE |
| 2026-04-01 | Visibilidad input carpeta Drive: usar dato servidor, no estado local | useState se inicializa una vez — si se usa para condicionar su propio input, el input desaparece al escribir. Siempre usar la prop del server component para controlar visibilidad de campos que persisten en DB |
| 2026-04-05 | Modulos financieros configurables via workspaces.proyecto_modules JSONB | all-false por defecto. MeTRIK activa por workspace. SOENA: todos activos. Patron reutilizable para futuras features por tenant |
| 2026-04-05 | Auto-cobros VE: anticipo al ganar + saldo al llegar a por_cobrar | `ganarOportunidad` crea anticipo si existe referencia_anticipo_epayco + valor_anticipo. `moveProyectoVe` crea saldo = presupuesto - sum(anticipos). Ambos con estado_causacion PENDIENTE |
| 2026-04-05 | cobros.tipo_cobro: 'regular' (default) / 'anticipo' / 'saldo' | factura_id ahora nullable — anticipos y saldos VE se registran antes de emitir factura formal |
| 2026-04-05 | TypeScript: as any para cobros.tipo_cobro hasta regenerar database.ts | Columnas nuevas no estan en los tipos generados. Usar as any con eslint-disable-next-line hasta correr supabase gen types |
| 2026-04-05 | Cotizaciones de negocio: codigo = consecutivo (no opp_codigo-CN) | El trigger trg_cotizacion_auto_codigo detecta oportunidad_id IS NULL y usa el consecutivo directamente como codigo. UNIQUE index en (workspace_id, codigo) sigue activo |
| 2026-04-05 | Fallback consecutivo cotizacion: epoch no 0000 | Si get_next_cotizacion_consecutivo() falla, el fallback es COT-YYYY-{epoch} para garantizar unicidad. 0000 colisionaba en la segunda cotizacion del workspace |
| 2026-04-05 | Error creacion cotizacion: param ?err= en URL, no silencio | nueva/page.tsx redirige con ?err=mensaje en lugar de silenciar. NegocioDetailClient muestra toast.error al montar. Permite diagnosticar sin logs de servidor |
| 2026-04-05 | ID negocio: primeras 3-4 letras del primer vocablo, no iniciales | Decision Hana/Vera: WMC→WOR, TTI→TEX, BRA→BLU. Modelo A (auto del nombre empresa) + override via empresas.alias_corto. Pendiente de implementar por Max |
| 2026-04-05 | Header negocio: jerarquia 4 filas segun spec Noor | nav / titulo+accion / empresa+contacto+precio / carpeta+linea / progreso. Pendiente de implementar. Spec: empresa y contacto juntos (misma relacion), precio prominente a la derecha |
| 2026-04-05 | Modulo negocios opera en contexto degradado: priorizar sesion limpia | La sesion D acumulo muchos fixes encima. Proxima sesion debe empezar con brief quirurgico de los 2 criticos SOENA |
