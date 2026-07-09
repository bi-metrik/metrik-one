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

## Convenciones de base de datos (toda migration nueva)

Cambio Supabase: desde **2026-05-30** los proyectos nuevos ya no exponen `public` al Data API por defecto, y desde **2026-10-30** se aplica también a **tablas nuevas de proyectos existentes** (ONE es existente, ref `yfjqscvvxetobiidnepa`). A partir de ahí, una tabla sin `GRANT` explícito es invisible para PostgREST/supabase-js aunque el RLS esté perfecto. Para que ONE no acumule bugs silenciosos, **toda migration que cree una tabla en `public`** debe incluir:

1. **RLS habilitado siempre** (`alter table <t> enable row level security;`). Sin RLS + grant a `anon` = fuga pública (la anon key va en el bundle del browser).
2. **Policies de aislamiento por workspace** si la tabla se lee/escribe con el cliente `authenticated` (`getWorkspace`/`createClient`). Patrón canónico vía `current_user_workspace_id()`; si la tabla no tiene `workspace_id` propio, validar por join (ver `staff_areas` / `control_causa`).
3. **GRANT explícito al rol que la consume:**
   ```sql
   -- tabla accedida por el cliente authenticated (browser o SSR):
   grant select, insert, update, delete on public.<tabla> to authenticated;
   grant usage, select on all sequences in schema public to authenticated;  -- si usa secuencias
   -- tabla accedida SOLO server-side (createServiceClient / crons): NO dar grant.
   --   service_role bypasea RLS y grants; dejar la tabla sin grant a anon/authenticated es lo más seguro.
   ```
4. **Nunca** dar `grant ... to anon` salvo que la tabla sea deliberadamente pública sin datos sensibles.

Regla de decisión: ¿quién consume la tabla? `service_role` → RLS on, sin grant, sin policy. `authenticated` → RLS on + policy por workspace + grant a `authenticated`.

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
│   │   │   ├── riesgos/           # Compliance: listado + detalle riesgos SARLAFT
│   │   │   │   ├── causa/[id]/   # Detalle causa + controles read-only
│   │   │   │   └── [id]/         # Detalle riesgo + causas
│   │   │   ├── controles/        # Compliance: CRUD controles independientes
│   │   │   │   ├── nuevo/        # Crear control + multi-select causas
│   │   │   │   └── [id]/         # Detalle control + causas asignadas
│   │   │   ├── matriz/           # Compliance: heat map 5x5 compacta
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
│   │   ├── roles.ts              # 6 roles: owner, admin, supervisor, operator, contador, read_only + permisos compliance
│   │   ├── pdf/                  # Generacion PDF cotizaciones (@react-pdf)
│   │   └── export-csv.ts         # Exportacion CSV
│   ├── types/
│   │   └── database.ts           # Types auto-generados Supabase + 26 aliases (~3785 lineas)
│   └── middleware.ts             # Subdomain routing + auth guard
├── workspaces/                     # Contexto por workspace (Clarity)
│   ├── soena/
│   │   ├── CONTEXT.md              # Estado, config, pendientes, decisiones SOENA
│   │   ├── decisions.md            # Historial acumulativo decisiones
│   │   └── migrations/             # SQL workspace-especifico
│   └── metrik/
│       └── CONTEXT.md              # Workspace demo interno
├── supabase/
│   ├── migrations/               # Migraciones genericas del producto
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
- `/riesgos` — Listado riesgos SARLAFT con badges control por causa
- `/riesgos/[id]` — Detalle riesgo + causas
- `/riesgos/causa/[id]` — Detalle causa + controles read-only con links
- `/controles` — Listado controles independientes (cards con efectividad %)
- `/controles/nuevo` — Crear control: info + multi-select causas + 7 factores efectividad
- `/controles/[id]` — Detalle control + tabla causas asignadas
- `/matriz` — Heat map 5x5 compacta (max-w-lg, celdas h-9)
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
- `riesgos` — Riesgos SARLAFT por workspace (4 categorias: LA/FT/FPADM/PTEE, 7 factores, nivel_riesgo GENERATED)
- `riesgo_causas` — Causas de riesgo (4 dimensiones impacto + 2 probabilidades, linked to riesgos)
- `riesgos_controles` — Controles de riesgo (7 factores efectividad binarios, ponderacion GENERATED, responsable, periodicidad)
- `control_causa` — Junction M:N controles↔causas (RLS via join a riesgos_controles.workspace_id)

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

**Sesion:** 2026-07-08 (`metrik-one--soena` → producto: **Meta Lead Ads Capa 1 — bloque "Datos del lead" de solo lectura desde metadata**). Rama `feat/soena-meta-lead-datos-bloque` (PR, sin mergear).

- **Dos hooks genéricos en `getNegocioDetalle`** (`negocio-v2-actions.ts`), reutilizables por cualquier workspace, config-driven vía `config_extra`:
  - `mostrar_si_metadata: { key, equals }` → el bloque solo aparece cuando `negocio.metadata[key] === equals` (visibilidad condicional por negocio).
  - `data_desde_metadata: { source, map:{fieldSlug→metaFieldName}, clean? }` → sintetiza una instancia efímera de **solo lectura** cuyo `data` sale de `negocios.metadata[source]` (arreglo `[{name,values}]`, ej. el `field_data` de un lead de Meta). No duplica en DB, no requiere backfill. Helper `limpiarValorDeclarado` (quita `_` de relleno + capitaliza enums).
  - Se agregó `metadata` al `select` del negocio.
- **Uso SOENA (config, no código):** bloque `datos` "Datos del lead (Meta)" en Validación (orden 2), `estado='visible'` (read-only, reusa `BloqueDatos`), solo visible en negocios `fuente_cargue='meta_lead'`. Muestra lo declarado en el formulario (tipo vehículo, nuevo/usado, natural/jurídica, marca-línea-modelo, precio). La Factura sigue siendo la fuente de verdad; esto es referencia comercial. Migración en `proyectos/soena/ve/migrations/20260708_bloque_datos_lead_meta.sql` (aplicar a prod DESPUÉS del deploy del código).
- **Gotcha Meta/campaña:** el webhook `meta-leads-webhook` ya pide `campaign_*`/`ad_name`/`adset_*` a la Graph API, pero llegan `null` porque el System User no tiene la **cuenta publicitaria de SOENA** asignada (solo la Página está compartida). Capa 2 (campaña) depende de que Daniela comparta la cuenta al Business Portfolio `992387823949163`.
- **Refinamientos (rama `feat/soena-meta-lead-nombre-y-precio`):**
  - `dataDesdeMetadata` acepta `numeric: [fieldSlug]` → limpia el valor declarado sucio a número (`"$ 132.734.513"` → `132734513`) para render currency vía field `tipo:'numero'`. Config SOENA: `lead_precio` pasa a `numero` + `numeric:['lead_precio']`.
  - Webhook `meta-leads-webhook`: `config_extra.meta_leads.nombre_negocio = { uppercase, append_fields[] }` → el negocio nace con nombre `PERSONA - MARCA MODELO` en MAYÚSCULAS (el contacto conserva el nombre de la persona). SOENA: `append_fields=['marca_-línea_-modelo…']`. Backfill de V0026/V0028/V0029/V0030 aplicado.

---

**Sesion:** 2026-07-08 (`metrik-one--soena` → producto: **plomería propuesta personalizada + segmentador Fase→Etapa en /negocios + botón de avance honesto + marcador Meta**). **PRs #23, #31, #33, #34, #35 mergeados a `main`** (deploy Vercel).

- **Propuesta personalizada (PR #31):** `generarVersionPropuesta` arma y envía al render `generador_*` (staff que genera: full_name/position/phone_whatsapp + email de auth + `profiles.avatar_url` como `<img>` opcional) + `vehiculo_*` (leídos de la Factura del negocio por slug `factura_venta_vehiculo`, `data.campos[slug].value`) + `vehiculo_img` por tipo. Tipo del payload extendido (opcionales, retrocompat). Alimenta el template SOENA nuevo (portada/vehículo/firma dinámicos) en `metrik-pdf-render` (rev Cloud Run `00011-qsl`).
- **Segmentador Fase→Etapa en /negocios (PR #33, #34):** nueva server action `getEtapasSegmentador()` (etapas de la línea activa: numero/nombre/stage/orden). `NegociosClient` usa 2 niveles (fase → etapas de la fase, en orden, con contadores). Contadores sobre el prop `negocios` (ya server-scopeado para operator → cuenta por rol sin lógica extra). Cuenta/filtra por `etapa_numero` (ID estable). Filas con `flex-wrap` (no scroll). Reemplaza el pill especial "Inclusión".
- **Botón de avance honesto (PR #33):** label neutral "Avanzar de etapa" (no la siguiente por orden, que confunde cuando el routing salta). `cambiarEtapaNegocioConGate` ahora expone `etapaDestinoNombre` (destino REAL ya resuelto por routing) → el toast lo nombra. El motor ya redirigía bien; era el feedback visual el que engañaba.
- **Marcador Meta (PR #35):** `NegocioResumen.es_meta_lead` (`metadata.fuente_cargue === 'meta_lead'`) + badge "Meta" (azul FB, icono Megaphone) en `NegocioCard`. Integración Meta Lead Ads validada en prod con lead real (V0026).
- **Gotcha:** `getWorkspace` no expone email; usar `getCachedUser()` para el email del usuario. Provisioning de usuarios nuevos (staff+profile+auth) = server-side (auth admin API + inserts), la invitación por UI está rota para nuevos.

---

**Sesion:** 2026-07-02→03 (`metrik-one--soena` → producto: **determinismo en formularios DIAN + búsqueda/tarjeta config-driven en negocios + guía hereda seccional**). **PRs #22, #24, #25, #26, #27 mergeados a `main`** (deploy Vercel).

- **`aplicarDeterministas`** (`src/lib/actions/formulario-actions.ts`): valores que NO deben confiarse a la extracción. **DV** recalculado con `calcularDvNit` (módulo 11) para 010/1668; **códigos DANE** país/depto/municipio resueltos por nombre. Respeta overrides (con valor; vacío recalcula). Se llama en generación y en `resolverFormularioParaEdicion` (display ⟺ generación sin drift).
- **`src/lib/dian/divipola.ts`** (NUEVO): DIVIPOLA DANE por nombre (33 deptos + ~50 municipios + alias), dept-scoped para evitar homónimos (Rionegro). País Colombia = "169". `resolverCodigosUbicacion(pais, depto, muni, extraidos)`.
- **Formato 010** (`src/lib/pdf/formulario-010.ts`): casilla 20 (tipo doc) honra override (default "13"); se quitó el "06" del espacio reservado de la hoja 2; firma jala del solicitante. Casillas de firma huérfanas removidas del meta (`formulario-casillas.ts`).
- **Seccional a nivel de negocio** (`negocios.metadata.seccional`): `guardarSeccional` la escribe; `aplicarSeccionalPreset` la lee (precedencia override > metadata > data.seccional legacy > sugerida). Fuente única para las 2 copias del 010. La Guía de Devolución (`guia-devolucion-actions.ts` + preview en `getNegocioDetalleCompleto`) también la hereda.
- **Vista de negocios** (`negocio-v2-actions.ts` + `negocios-client.tsx` + `negocio-card.tsx`): cédula config-driven en tarjeta y búsqueda (`config_extra.negocio_card.cedula_bloque/cedula_campo`); búsqueda libre incluye cédula + seccional; `seccional_label` = solo `metadata.seccional` (sin dualidad); filtro de ciudad removido.
- **Gotcha infra:** `metrik-pdf-render` corre en **Google Cloud Run** (proyecto `metrik-pdf-render`, us-east1), NO en Fly (README legacy). Deploy: `gcloud run deploy metrik-pdf-render --source . --region us-east1`.

---

**Sesion:** 2026-07-01 (`hjbc--clarity` → producto: módulo `rentabilidad_comercial` + tablero interactivo + perfil de vendedor). **4 PRs #17-#20 mergeados a `main`** (deployados Vercel).

- **Módulo nuevo `rentabilidad_comercial`** (gateado por `workspaces.modules.rentabilidad_comercial`): tablero comercial alimentado por tabla de hechos **`ventas_hechos`** (grano línea de documento) + **`metas_vendedor`** (presupuesto). RLS por workspace (lectura `authenticated`, ingesta `service_role`).
- **RPCs** (SQL, security invoker, RLS via `current_user_workspace_id`): `get_rentabilidad_comercial(anio,mes,vendedor,linea)` con **cross-filter** (bases full/control/vend/linea, cada dimensión excluye su propio filtro), `get_vendedor_perfil(vendedor)` (KPIs + percentil vs equipo + cumplimiento de meta real + tendencia + mix + top productos), `get_vendedores_resumen()`.
- **UI:** tab "Rentabilidad Comercial" en `/tableros` (interactivo: cross-filter mes/vendedor/línea, drill año→mes, chips, breadcrumb, seleccionado/atenuado, re-consulta `useTransition`). `/equipo` muestra vendedores (tabla ordenable) cuando el ws tiene el módulo, con `/equipo/vendedor/[slug]` (perfil). `/numeros` en modo RC: P2 encendido con margen real, P1/P3/P5 "se activa al conectar", banner de alcance. Diseño Saga/Noor/Ren.
- **Ingesta:** `scripts/load-ventas-hechos.ts` + `scripts/load-metas-vendedor.ts` (carga puntual desde export Excel Siesa). Futuro: conector Siesa (CoreApp/WebServices).
- Workspace demo `hjbc` aislado. Migraciones `20260701000001_ventas_hechos.sql` + `20260701000002_rc_interactivo_metas.sql` (aplicadas vía MCP a la instancia).
- **Gotcha:** el hook `branch-guard-one` falso-positiva con el literal "main" en el comando (ej. `gh pr create --base main`); separar el comando del commit/push u omitir `--base` (el default ya es main).

---

**Sesion:** 2026-06-30 (`metrik-one--core`, Mik + Max: fix login por cookies del middleware + seguridad advisor Supabase Olas 1-2). Todo en PRs sin mergear, nada en `main`.

- **Fix login (PR #13, `fix/middleware-cookie-propagation`):** el middleware refrescaba el token de Supabase pero sus `NextResponse.redirect` no copiaban las cookies rotadas, el refresh token viejo quedaba en el browser, el 1er login fallaba y el 2o funcionaba. Helper `withAuthCookies()` que propaga `supabaseResponse.cookies` a los 13 redirects del middleware. Gotcha permanente: todo `NextResponse` nuevo en middleware SSR debe copiar las cookies o la sesión se corta.
- **Seguridad Ola 1 (PR #14, `fix/security-advisors-ola1`):** `search_path` fijado en 3 funciones de certificaciones + policy de listing del bucket `cert-documentos` acotada (mata la enumeración anon; el GET por path directo sobrevive porque el bucket sigue `public=true`).
- **Seguridad Ola 2 (PR #15, `fix/security-advisors-ola2`):** `REVOKE EXECUTE FROM anon` en las 45 funciones SECURITY DEFINER + revoke a `authenticated` en 21 triggers puros. Se MANTUVO `authenticated` en 24 (RPCs del cliente + las usadas en policies RLS como `current_user_workspace_id` / `is_admin_or_owner`: revocarlas rompe el aislamiento por workspace).
- **Pendiente de Mauricio:** mergear #13/#14/#15, luego aplicar las migraciones (Mik/Max por MCP) y re-correr el advisor. Además toggle manual de leaked-password protection en Auth. Migraciones NO aplicadas a prod todavía.
- **Nota multi-tenant Supabase:** el producto Cardumen (SenseMaker, owner Saga) convive en esta misma instancia (`yfjqscvvxetobiidnepa`) con tablas `cardumen_*` y la vista `v_cardumen_live`; sus lints del advisor son by-design, NO de ONE.

---

**Sesion:** 2026-06-29 (`soena` — Max — **NIT con DV: helper genérico + normalización en extracción + guion en relación de facturas**)
**Branch:** `main` (deploy Vercel) · PR #11 `47734e0`

Disparado por reporte de Deisy (SOENA), pero **genérico/opt-in**. Detalle de config + backfill SOENA en `proyectos/soena/ve/`.

- **`src/lib/dian/nit.ts`** (nuevo): DV colombiano módulo 11 + `separarNitDv`/`nitSinDv`/`nitConGuion`. Determinista → si el valor trae el DV pegado lo separa, si viene limpio lo calcula.
- **`CampoExtraccion.normalizar='nit_sin_dv'`** (opt-in por campo en `campos_extraccion`): `procesarDocumento`/`reprocesarDocumento` dejan el NIT **limpio sin DV pegado** al extraer. Sin la marca, comportamiento idéntico.
- **Relación de facturas** (`relacion-facturas-pdf.tsx`): renderiza el NIT del proveedor **con guion** (`860019063-8`) vía `nitConGuion`, robusto a valores legacy pegados.
- **Patrón:** el NIT base (sin DV) es la forma canónica almacenada/keyada a la DIAN; cada consumidor que necesite el DV lo recompone al renderizar. El DV NO se guarda pegado al número.

---

**Sesion:** 2026-06-23 (`soena` — Max — **conciliación v2 (5 pestañas + freeze duplicados) + FAB Registrar pago global + drag-and-drop de carga**)
**Branch:** `main` (deploy Vercel Ready) · merges `85f2cdc` (dnd) `258bf23` (conciliación+FAB) · commits `d5d846f` `4f0dd04` `b62678f` · migración producto `20260623000001_conciliacion_v2.sql`

Todo genérico/opt-in (otros workspaces sin cambio). Detalle de config SOENA en `proyectos/soena/ve/`.

### Conciliación v2 (genérico, opt-in `modules.conciliacion`) — `4f0dd04`
- Rediseño de `/conciliacion`: **panel base** de todas las referencias del ws + `agregarPago` (server action único) con selector de fuente; **5 pestañas** en `conciliacion-client.tsx` (Por conciliar=solo sobrepagos con reparto inline / Saldos=faltantes, gestión comercial, con búsqueda / Duplicados / Conciliado / Vista general).
- **`cobros.fuente`** (text nullable, retrocompat): `'epayco' | 'davivienda' | <texto libre>`. Antes la fuente vivía en `notas`. Lectura infiere cuando es NULL.
- **`cobros.tipo_cobro` += `'devolucion_pendiente'`**: remanente "por devolver" = cobro NEGATIVO + `split_json.por_devolver=true`. Descuenta del cobrado del negocio de origen sin destruir el cobro original; EXCLUIDO del cobrado financiero (las vistas MC/EBITDA no se tocan).
- **`count_negocios_por_conciliar` redefinido**: "por conciliar" = sobrepagos sin conciliar ∪ duplicados sin resolver ∪ etiquetados. Ya NO cuenta el saldo faltante (es gestión comercial). El cobrado de la RPC excluye `devolucion_pendiente`.
- **Control de fraude por duplicado** (`negocio-v2-actions.ts`): helper `negocioCongeladoPorDuplicado` + guard en `cambiarEtapaNegocioConGate` → un negocio atado a una referencia `external_ref` (no-split) presente en >1 negocio abierto NO avanza de etapa hasta resolverlo. Adicional al gate `conciliacion_diana`, respeta override owner/admin.
- `aceptarDuplicado`: deja la ref en el negocio de etapa más avanzada y desvincula las demás; empate → desvincula todas + `activity_log` `solicitud_conciliacion` al comercial. **Desvincular ≠ borrar el cobro** (queda sin asignar).

### FAB "Registrar pago" global (genérico, opt-in `modules.fab_registrar_pago`) — `b62678f`
- **Problema:** un comercial que cobra cuando el negocio ya está en stage `ejecucion` no podía registrar el pago (la segmentación por área `can-edit.ts`/`STAGE_TO_AREA` le bloquea editar el bloque de pagos de esa etapa).
- **Solución (Hana):** acción FAB "Registrar pago" (`fab.tsx`, prop `registrarPagoEnabled`) → modal de captura aislado (negocio + fuente + ref + valor + fecha). El núcleo de `agregarPago` se extrajo a `registrarPagoEnNegocio(supabase, wsId, staffId, input, origen)` en `conciliacion-actions.ts`; el FAB y el panel comparten esa función → **una sola vía de escritura** (no se bypasea validación ePayco ni duplicados).
- **Guard por rol** (`fab-pago-actions.ts`, `rolHabilitadoParaPagoFab`): owner/admin siempre; supervisor/operator salvo alcance de áreas SOLO operaciones; sin áreas → habilitado; read_only/contador nunca. **No usa `guardEditarBloque`** (validaría área de etapa). Traza `origen='fab'` en activity_log.
- **Gotcha visibilidad:** la UI muestra la acción por rol+flag; el server excluye operaciones-pura (el cliente no conoce las áreas sin fetch extra) → un operaciones-puro ve toast de rechazo. Afinable pasando áreas al cliente si molesta.

### Drag-and-drop de carga de archivos (genérico) — `d5d846f`
- **No existía** (el repo solo tenía file picker; los `@dnd-kit` son del kanban). Hook nuevo `src/hooks/use-file-drop.ts` (`useFileDrop` → `isDragging` + `dropProps`, contador de profundidad anti-parpadeo, filtro `dataTransfer.types.includes('Files')` para no chocar con el dnd del kanban, `disabled`/`multiple`).
- Aplicado a 7 zonas: `BloqueDocumento`, `DocUploadSlot`, `rut-upload-card`, `nuevo-gasto-form`, `marca-section`, `perfil-fiscal-extended`, `pila-section` (esta inyecta via `DataTransfer` al `<input>` del form). File picker + `procesarDocumento` (extracción IA) intactos.

---

**Sesion:** 2026-06-22→23 (`soena` — Max — **flujo financiero (pago externo, validación/causación ePayco, conciliación)** + fix multi-pago + quick-wins UX)
**Branch:** `main` (deploy Vercel) · commits `474f302` `5a0a494` `b08f8f5` `3505fbc` `dadf780` `02af942` `9dc59d4` `811a481`

Disparado por la reunión SOENA-Diana, pero **todo genérico/opt-in** (otros workspaces sin cambio). Detalle de config SOENA en `proyectos/soena/ve/`.

### Pago externo no-ePayco (genérico) — `474f302`
- `tipo_cobro='externo'` (constraint `cobros_tipo_cobro_check` ampliado, migración `20260622000001`) para pagos que NO entran por ePayco. Server action `registrarPagoExterno` + `BloquePagoExterno.tsx`; opt-in por `config_extra.es_pago_externo` en un bloque `datos`. `cobros` no tiene retefuente/reteica separadas → suma en `retencion`, desglose en `notas`. Cuenta para el saldo (no filtra por tipo).

### Validación de referencia ePayco (genérico) — `5a0a494`
- En `epayco-actions.ts`: bloquea referencias con estado real ≠ `'Aceptada'` (no crea cobro) y **duplicadas** (mismo `external_ref` en cualquier negocio del ws) con **override por justificación** (se anota en `activity_log`). Re-consulta ePayco server-side (barrera real). Opt-in `config_extra.validar_epayco`.

### Discriminado de costos ePayco en causación (genérico) — `b08f8f5`
- El cargo ePayco (comisión + IVA + retefuente + reteica) ya llega discriminado. AHORA se registran 2 gastos: comisión → `categoria='comision'` `clasificacion='variable'` (entra a MC); IVA+retef+reteica → `categoria='impuestos_recuperables'` `clasificacion='no_operativo'` → **excluido de MC/EBITDA** por `v_pyl_mes`/`v_mc_negocio` ("otra bolsa", impuestos a favor). Constraint `gastos.categoria` ampliado (migración `20260622000002`). Desglose fino en `cobros.split_json`. Opt-in `config_extra.causar_comision_epayco`.

### Panel de conciliación + badge/etiqueta (genérico, opt-in `modules.conciliacion`) — `3505fbc` `dadf780` `02af942`
- Ruta `/conciliacion` (área financiera): tabla Referencia/Valor pagado/Valor negocio/Diferencia; **reparto de un pago entre N negocios sin duplicar** (cobros con mismo `external_ref` + `split_json.split_id`; `buscarReferenciaDuplicada` reconoce el split como legítimo, no duplicado). Gate `conciliacion_diana` (bloquea avanzar de stage `cobro` hasta diferencia=0 + check) + tabla `negocio_conciliacion`. Migración `20260622000003`.
- **Badge** en nav + **etiqueta** del comercial (`activity_log` tipos `solicitud_conciliacion`/`conciliacion_atendida`, CHECK ampliado) via RPC `count_negocios_por_conciliar` (migración `20260622000004`). **Gotcha de scope:** "por conciliar" = negocio `stage_actual='cobro'` sin check + etiquetados + sobrepago + conciliados; NO todo abierto con diferencia≠0 (eso infla con el pipeline temprano = "por cobrar"). Aplica al badge Y al panel.

### Fix multi-pago: registrar segundo pago real (genérico) — `9dc59d4`
- `autoCrearCobrosMulti` usaba `external_ref` como Set para idempotencia → dos abonos reales con la misma referencia (o ref vacía) hacían que el filtro descartara AMBOS (`nuevos=[]`), el 2º nunca se insertaba. Ahora idempotencia por multiplicidad `(external_ref, monto_centavos)`: inserta solo el delta faltante. Preserva anti-doble-click; registra segundos pagos reales.

### Quick-wins UX (genérico) — `811a481`
- Filtro de ciudad en `/negocios` (config `negocio_card.ciudad_campo`). `BloqueDocumento`: opt-in `config_extra.editar_extraidos` → campos con `alerta_revision` editables aun en modo readonly (reusa `actualizarCampoDocumento`). Componente `src/components/ui/info-tooltip.tsx` (Radix, tokens MeTRIK) + campo `ayuda` opt-in en BloqueDatos. Tarjeta de negocio: `campos_visibles` config-driven.
- **Nota de datos (no producto):** los bloques `documento` readonly NO deben persistir archivo propio (deben resolver por herencia del origen vía override en `getNegocioDetalleCompleto`); una ruta vieja persistió data corrupta en copias readonly — pendiente evaluar un guard que impida `procesarDocumento` escribir en instancias `estado='visible'` con `source_etapa_orden`.

---

**Sesion:** 2026-06-22 (`soena` — Max — **extracción IA de campo desde pantallazo (`imagen_clipboard`)** + dedupe `auth.getUser()`)
**Branch:** `main` (deploy Vercel) · commits `a145376` `4457d83`

### `imagen_clipboard` con extracción IA (genérico) — `a145376`
- El campo `imagen_clipboard` de `BloqueDatos` acepta `extrae: { target_slug, descripcion_ai, alerta_revision }`. Al pegar la imagen, dispara el server action `extraerCampoDesdeImagen` (`src/lib/actions/documento-actions.ts`): **lee la config server-side** (la `descripcion_ai` NO viaja del cliente), corre Gemini (`extractFieldsFromDocument` + `extractWithRetry`) sobre el pantallazo pegado y **autollena el campo de texto hermano** — editable, con badge "Revisar" (se limpia al editar a mano). **NO persiste la imagen** (a diferencia de `procesarDocumento`, que sube a Storage+Drive). Opt-in por config → cualquier ws/línea sin `extrae` se comporta igual que hoy.
- **Gotcha:** el flag `s` (dotAll) en regex rompe el target del tsconfig (<es2018) → usar `[\s\S]` en vez de `.` con `/s`.

### Dedupe `auth.getUser()` por request — `4457d83`
- Nuevo `getCachedUser` (React `cache()`) en `src/lib/supabase/auth-user.ts`. `layout(app)` + `getWorkspace` hacían cada uno su `auth.getUser()` → 2 hits a Supabase Auth por render (presión de rate-limit por IP). Ahora **1**. Semánticamente idéntico.
- **Gotcha:** `get-workspace.ts` es `'use server'` (solo puede exportar async functions) → el `cache()` vive en módulo aparte con `'server-only'`, no en el archivo de server actions.
- Relacionado (no código): límites Auth subidos vía Management API — `rate_limit_token_refresh` 150→1800, `rate_limit_verify` 30→300 (por IP, oficina con NAT compartida).

---

**Sesion:** 2026-06-17 (`soena` — Max — **capa editable de formularios 010/1668 + versionado** · fixes nav-impersonación, activity-log, responsables, salto de Cobro)
**Branch:** `main` (deploy Vercel) · commits `80c65e6` `40a7a4f` `e6658bf` `8eb0f4d` `8653399` `1a598d9` · migración producto `20260617000001_formulario_versiones.sql`

### Formularios editables en plataforma + versionado (genérico) — `1a598d9`
- **Problema:** el 010/1668 se generaba como PDF overlay desde `campos_fuente` y corregir exigía editar el PDF (coge mal datos, no deja cambiar razón social). Ahora se editan **las casillas en la plataforma** y el PDF se arma con esos valores; el overlay calibrado no se toca.
- **`BloqueFormulario`**: `resolverFormularioParaEdicion` resuelve campos_fuente + constantes y arma las casillas autollenadas, agrupadas (módulo `src/lib/pdf/formulario-casillas.ts`: label + grupo + nº de casilla). Edición → `data.campos_override` vía `guardarFormularioOverrides` (guardado diferido).
- **`generarFormulario`**: fusiona overrides sobre el autollenado (un override **satisface un faltante**), arma el PDF con los valores finales e **inserta una versión** en `formulario_versiones`.
- **Versionado**: tabla `formulario_versiones` (workspace_id, negocio_bloque_id, version_n, drive_url, datos_snapshot, generated_by, generated_at; RLS por workspace + grant authenticated). UI con historial + "Modificar y regenerar". `data.version_actual` = última.
- **`editable_siempre`** (config_extra): el bloque sigue editable aunque se vea desde una etapa posterior (historial) — el modo deja de forzarse a `visible`. Para 010/1668 (la DIAN devuelve requerimientos casi siempre).
- **Retrocompat AFI:** la capa editable es **opt-in por config** (los bloques 010/1668 de SOENA la tienen); los formularios de AFI (declaración, relación de facturas) siguen auto-generando igual.

### Fix routing: salto de Cobro respeta el routing — `8653399`
- El atajo "saltar Cobro cuando saldo≤0" avanzaba a `orden+1` (Generación) **a ciegas**, ignorando el routing → un negocio sin devolución de IVA (leasing/jurídica) entraba a la rama de devolución solo por estar saldado. Ahora el salto **evalúa el routing de Cobro** (IVA=true→Generación; si no, Cobro es terminal). Fallback a `orden+1` si Cobro no tiene routing.

### Nav respeta impersonación "Ver como" — `80c65e6`
- `layout.tsx` pasaba el rol REAL del profile al `AppShell` → "Ver como [rol]" no cambiaba el nav. Ahora layout y el guard de `/mi-negocio` usan el **rol efectivo** de `getWorkspace` (impersonation-aware). Sin impersonar = rol real → sin cambio. **Gotcha/deuda:** esto agregó un segundo `auth.getUser()` por render (getWorkspace además del que ya hacía el layout) → optimizar (contribuye a presión de rate-limit por IP de Supabase).

### Responsables en tarjeta + filtro · auto-asignar — `e6658bf` / `7a1db20`
- `getNegociosV2` trae los responsables (negocio_responsables N:M) por negocio (batch); la tarjeta los muestra como chips; filtro por responsable en `/negocios`. `crearNegocio`: si el creador es `operator` se auto-asigna como responsable (sin esto perdía de vista su propio negocio — visibilidad por N:M).

### Activity log: sistema oculto por defecto — `8eb0f4d`
- El bloque queda siempre visible; `showSystem` arranca en **false** (solo comentarios), toggle revela los eventos automáticos (persistido en localStorage).

---

**Sesion:** 2026-06-16 (`soena` — Max — leasing cierra en Cobro + nav por rol config-driven + auto-asignar responsable + fix env vars PDF prod)
**Branch:** `main` (deploy Vercel) + migraciones SOENA en `proyectos/soena/ve/migrations/20260616_*`

### Primitivo nuevo `lock_when` (genérico, BloqueDatos) — bloqueo/forzado cross-bloque
- Un campo puede bloquearse y **forzar su valor** según un campo de OTRO bloque (referencia por slug estable). Config: `fields[i].lock_when = { source_bloque_slug, source_etapa_orden, field, value, force_value, hint }`.
- Render (`BloqueDatos.tsx`): si el campo fuente (vía `datosPorSlug`) == `value` → toggle deshabilitado, muestra `force_value` + hint, y un effect **persiste el valor forzado** (no es cosmético: gate y routing leen el dato real). `datosPorSlug` se threadea NegocioDetailClient → BloqueCard → BloqueRenderer → BloqueDatos.
- `getNegocioDetalleCompleto`: `lock_when.source_etapa_orden` se registra en `sourceEtapaOrdens` para que el bloque fuente siempre cargue en `datosPorSlug`.
- **SOENA:** `devolucion_de_iva` se bloquea cuando `titularidad.modalidad_solicitante = leasing` → `requiere_devolucion_iva = false` → el routing de Cobro **cierra el negocio sin devolución de IVA** (leasing se comporta como jurídica). Docs del banco y routing intactos. Solo SOENA configura `lock_when` → resto sin impacto. Audits 0.

### Nav por rol config-driven por workspace (`config_extra.nav_roles_override`)
- Mapa `{ href: roles[] }` que reemplaza los roles por defecto del sidebar SOLO en ese workspace. Lo leen `app-shell.tsx` (oculta items) y el guard server-side de `/mi-negocio/page.tsx` (acceso real, no solo visual — ambos config-driven). Sin override → roles globales intactos (AFI/ALMA/dimpro/metrik sin cambio).
- **SOENA:** `/mi-negocio` (Configuración) → owner/admin; `/movimientos` → owner/admin/read_only (se quitó supervisor de ambos). Operator ya quedaba en Negocios+Directorio.

### Auto-asignar responsable al crear negocio (`crearNegocio`)
- Si el creador es `operator` → se inserta en `negocio_responsables` + sync `responsable_id`. Tapa bug de visibilidad: un operator solo ve negocios donde es responsable; sin esto, perdía de vista el negocio recién creado. Owner/admin/supervisor ven todo → no se auto-asignan.

### Fix env vars PDF render (prod)
- Causa de "PDF render service no configurado" en la propuesta SOENA: en Vercel prod solo estaba `METRIK_PDF_RENDER_URL`; faltaban `SECRET` y `SA_KEY` → re-subidas. Ver corrección en el handoff 2026-06-13 abajo.

---

**Sesion:** 2026-06-13 (`metrik--one` — Max — cobros recurrentes: cambio bancario + cron día 10 + emisión junio + redeploy pdf-render)
**Branch:** `main` · commits `064ab5c` `2f70e80` `2dd4fae` (deployados Vercel)

### Cambio de cuenta receptora (persona natural)
- `src/lib/cobros/emisor-mauricio.ts` es la **fuente única del dato bancario impreso** en cada cuenta de cobro (hardcoded en `EMISOR_MAURICIO.banco`, no en DB). El render arma `{{banco_*}}` desde ahí. **Cambio bancario = tocar ese objeto** (la tabla `bank_accounts` es reconciliación de saldos, NO el dato impreso). Banco Falabella `111810431095` → **Banco Caja Social `24142103304`** (commit `064ab5c`).

### Cron de cobros reprogramado (`procesar-planes-cobro/route.ts`)
- El gate de emisión de cuentas pasó de `diaHoy === 15` a **`=== 10`**; la cuenta se fecha el **día 13** vía `fechaEmisionOverride` (envío al cliente) y el vencimiento sigue el **día 15** (`fechaEsperada` interna). Commit `2f70e80`. Aplica de julio en adelante. El schedule Vercel del cron NO cambió (sigue diario `0 12 * * *`); solo cambió el gate interno.

### Gotcha — el servicio `metrik-pdf-render` (Cloud Run) hay que redesplegarlo al agregar endpoints
- En prod corría una **revisión vieja SIN `/render/cuenta-cobro`** (deploy pendiente desde mayo) → el endpoint daba **404 de Flask** (auth OK, ruta inexistente). Y las 3 env vars `METRIK_PDF_RENDER_*` estaban **vacías en Vercel** → `renderCuentaCobro` no tiene fallback, habría fallado el cron en prod. Las cuentas de mayo se generaron localmente con WeasyPrint, nunca por el servicio.
- **Reparado:** redeploy `gcloud run deploy metrik-pdf-render --source . --region us-east1` → **rev `00008-sdh`** (3 endpoints). Credenciales recuperadas vía GCP: secret leído del Cloud Run + SA key nueva de `one-pdf-render-client`, cargadas a Vercel (production) + `.env.local`. **Diagnóstico rápido:** 404 de Flask en `/render/X` = la revisión desplegada no tiene ese endpoint → redesplegar desde el repo `metrik-pdf-render`. **⚠️ Corrección 2026-06-16:** de las 3 env vars solo persistió `METRIK_PDF_RENDER_URL` en Vercel prod; `SECRET` y `SA_KEY` faltaban (la propuesta SOENA fallaba con "PDF render service no configurado") → re-subidas el 2026-06-16. Tras tocar env vars en Vercel, verificar con `vercel env ls production` que estén las **3**.
- **Forzar emisión de un período:** `scripts/generar-cuentas-junio-metrik.ts` (modelo reusable, `--commit` para real, `fechaEmisionOverride` día 13). Junio emitido: CC-2026-06-001 AFI $916.667 + CC-2026-06-002 SOENA $1.750.000 (`cuentas_cobro_emitidas`, estado `emitida_pendiente_aprobacion`).

---

**Sesion:** 2026-06-12 (`soena` — Max — refactor del motor: referencias de workflow por slug estable)
**Branch:** `main` · commits `40eae50` `fd1590b` `9322b53` (deployados Vercel) + migrations `20260612000001/2/3`

### Referencias de bloque por `slug` estable (no por nombre/orden) — genérico
- **Problema:** el motor encodaba refs cross-bloque por nombre editable u orden de etapa; renombrar/reordenar un bloque las rompía en silencio (bug DC13: cross-check de marca/línea vacío al renombrar "Factura de venta" → "Factura Venta Vehículo"; mismo bug latente en preview/generación de la guía de devolución).
- **Solución:** columna `bloque_configs.slug` (identidad estable, única por línea, NULL en heredados). **7 clases de referencia migradas a slug, todas con fallback legacy** (cada consumidor prioriza slug y cae a nombre/orden si la ref no lo trae) → retrocompatible, cero big-bang. Otras líneas/workspaces siguen 100% legacy sin impacto.
- **Clases + sitios:** cross_check (`documento-actions`), campos_fuente (`formulario-actions`), auto_fill.source_bloque + doc_link + preview/generación guía (`negocio-v2-actions` + `guia-devolucion-actions`), condition (render `negocio-detail-client` + gate SQL `condicion_cumplida`, con `datosPorSlug` expuesto desde el server y flattening de campos para **paridad gate⟺render**), herencia readonly (documento + propuesta; los `datos` readonly ya eran estables por `bloque_definition_id`).
- **Guardián nuevo `audit_block_slug_refs(linea_id)`** (companion de `audit_workflow_refs`): valida unicidad de slug por línea + que todo slug referenciado exista. Correr tras configurar/migrar refs. Migrations `20260612000001` (columna+índice), `20260612000002` (audit, 7 clases), `20260612000003` (`condicion_cumplida` branch slug).
- **NO migrado a propósito:** el `block_id` visual (código corto tipo "DA5") sigue por (etapa, nombre, tipo) en `/flujo` y `/admin/workflows` — cosmético (si se desincroniza solo muestra otro código, no afecta datos ni gates).
- **SOENA VE:** 158 refs backfilleadas a slug (`proyectos/soena/ve/migrations/20260612_refs_por_slug.sql`). `audit_block_slug_refs` y `audit_workflow_refs` ambos en **0**. Pendiente: QA en vivo con un negocio real (8 casos A–H en Tana). Spec: `docs/specs/2026-05-26_block-references-by-slug.md`.

---

**Sesion:** 2026-06-10 (producto core — Mik + Max — borrado de 3 workspaces demo + reparacion del bot WhatsApp)
**Branch:** `main` · commit `8ac2776` (config.toml deployado) + redeploy edge `wa-webhook` v77

### Bot WhatsApp reparado (estaba caido desde 2026-05-26)
- **Causa raiz:** `wa-webhook` quedo con `verify_jwt: true` tras el redeploy v76 (2026-06-02). Como `config.toml` nunca declaro el flag, cada deploy del webhook dependia del default de la plataforma (`true`) → el gateway respondia **401 a Meta antes de ejecutar el codigo** (Meta no manda JWT de Supabase). 0 mensajes registrados 2026-05-26 → 2026-06-10.
- **Fix:** declarar `verify_jwt = false` en `config.toml` para `wa-webhook` + redeploy `--no-verify-jwt`. El webhook valida autenticidad por su cuenta (firma HMAC-SHA256 `x-hub-signature-256` + handshake GET con `WHATSAPP_VERIFY_TOKEN`), asi que NO abre hueco. Blindados tambien `wa-parse-test` y `wa-notify-internal` (verify_jwt=false versionado). `wa-alerts`/`evaluar-reglas` se quedan en `true` a proposito (crons internos con service key).
- **Verificado end-to-end:** GET handshake con token invalido → 403 (antes 401); POST vacio → 200; mensaje real "10700 invitacion café cierre T1261" → intent GASTO, parser gemini-2.5-flash-lite, confianza 0.90, registrado en `wa_message_log`.
- **Gotcha generico:** todo edge function debe declarar su `verify_jwt` en `config.toml`. Si no, un redeploy aplica el default `true` y rompe los webhooks de terceros. Diagnostico rapido: logs `edge-function` con `POST | 401` repetidos = es esto, no el codigo.

### Borrado de 3 workspaces demo (danilo, estudio-creativo-lum, altavista-demo)
- Borrado relacional en transaccion: ~33 FKs son CASCADE pero ~50 son `NO ACTION` y bloquean → hay que borrar filas hijas en orden hoja→raiz antes del row de `workspaces`. Gotchas de orden: `proyectos`→`cotizaciones`, `cotizaciones`→`oportunidades`, `gastos`/`expenses`→`expense_categories`, `staff`→`profiles`.
- **3 capas que el DELETE relacional NO cubre:** (1) `public` (verificar con `query_to_xml` sobre `information_schema.columns`); (2) Storage — objetos `workspace-logos/{ws_id}/...` requieren Storage API REST (DELETE directo bloqueado por trigger `protect_delete()`); (3) auth/cuentas compartidas — verificar `staff.profile_id` cross-workspace antes de borrar un profile/auth.user.
- **Caso real:** el owner de altavista-demo era Supervisor activo de `dimpro` → se conservo la cuenta y se repunto su `profile.workspace_id` a dimpro. Si esto se vuelve recurrente: montar funcion `delete_workspace(uuid)` que orqueste las 3 capas.

---

**Sesion:** 2026-06-09 (`soena` — Max — multi-responsable, mecanismo desactivar bloque, PhoneInput, filtro por etapa, Formulario 010)
**Branch:** `main` · commits `11d330d` `918c047` `2610086` `27808dc` `451c917` `3d24579` `5bd1125` (deployados Vercel)

### Multi-responsable (genérico)
- **`negocio_responsables` (N:M) es la fuente de verdad** de responsabilidad/permisos. `getNegocioDetalle` carga `responsables[]`; `getNegocioDetalleCompleto` expone `currentUserEsResponsable` (comparado por **staff.id**). Acciones `agregarResponsable`/`quitarResponsable` (reemplazan `actualizarResponsable`) mantienen `negocios.responsable_id` como **principal derivado** (responsable más antiguo). `ResponsableSelector` ahora es multi (chips). Backfill: migración que puebla N:M desde `responsable_id`.
- **Gotcha staff.id vs profile.id:** `negocio_responsables.assigned_by` es FK→`profiles(id)` → usar `userId` (no `staffId`). `negocio_responsables.staff_id` y `activity_log.autor_id` sí usan `staff.id`. (Mismo campo minado del modelo de equipo disperso.)

### Mecanismo "desactivar bloque" sin borrar (genérico)
- `bloque_configs` no tenía forma de sacar un bloque del flujo (solo `editable`/`visible`, ambos lo muestran). Nuevo flag **`config_extra.desactivado === true`** → el render lo excluye (`getNegocioDetalle`) + quitarle el gate. Reversible. Usado para desactivar la Guía de devolución en SOENA.

### Avance de etapa robusto a `orden` no contiguo (genérico)
- El cliente calculaba la "siguiente etapa" con `orden + 1`; al fusionar etapas el `orden` interno puede tener huecos. Ahora usa **la siguiente por orden ascendente** (`e.orden > actual`). El motor de avance ya usaba `routing.default_etapa_orden`. Permite reorgs que dejan huecos en `orden` manteniendo `numero` (ID visible) contiguo.

### PhoneInput (genérico)
- `src/components/phone-input.tsx`: input de teléfono con selector de indicativo por país (**default +57**), emite `"{indicativo} {numero}"`. Aplicado en nuevo negocio, staff, directorio contacto, contactos, promotores. Helper `splitPhone` para parsear valores guardados.

### Lista de negocios: filtro por etapa (config-driven)
- `negocios-client.tsx`: filtro/pill "Inclusión" que separa una etapa específica del stage; "Venta" excluye los de esa etapa. Se muestra solo si hay negocios en la etapa. Filtro de seccional DIAN (deriva de `seccional_label`).

### Formulario 010 (`formulario-010.ts`)
- Periodo **bimestral** (casilla 53), tipo doc **31**, firma del solicitante, **06 en espacio reservado** (pág 2), **códigos país/depto/municipio** (casillas 26-28, extraídos del RUT, `optional` en CampoFuente), razón social en blanco para persona natural (determinista), **Y_NUDGE +2pt** global. Coordenadas calibradas con `pdftotext -bbox`. Script de prueba `scripts/test-010.ts` (genera un 010 con datos hardcoded sin tocar DB/app).

---

**Sesion:** 2026-06-05 (producto core — Max — consolidación de equipo + auto-deploy + limpieza legacy)
**Branch:** `main` · commits `1c94597` `625d20c` `cc6f388` `3b238bb` `9ede644` `bae1fcd` + migraciones `20260604000002`, `20260605000001` (deployados Vercel)

**Modelo de equipo — consolidación completa:**
- **`staff_areas` (N:M) es la fuente única de área.** `staff.area` y `profiles.area` deprecadas y luego **dropeadas** (migración `20260605000001`). Cron `procesar-planes-cobro` reapuntado a `staff_areas` (financiera); crons de inactividad dejaron de leer `profiles.area` (era columna muerta — siempre null → comodín).
- **Equipo unificado en una sola pantalla** (sección "Mi equipo" de `/mi-negocio`): el form de crear/editar miembro incluye **áreas** (multi-select, `AreaMultiSelect`) + la sección **"Responsables por defecto"** (colapsable). `/mi-negocio/equipo` redirige ahí; su cliente viejo se eliminó. Gestión de áreas/responsables = **owner/admin** (el supervisor dejó de configurarla — `equipo-areas.ts`).
- **Un solo "Cargo"** (`staff.position`): se eliminó "Nombre personalizado". El header del workspace muestra `staff.position` con fallback al rol (`layout.tsx` → `AppShell`: `displayRole || ROLE_LABELS[role]`). `display_role` retirada del código (invite, accept-invite, `StaffConAreas`) y **dropeada** de `staff` y `profiles`.
- `database.ts`: quitadas las 4 columnas legacy de los tipos de `staff`/`profiles`. Índice `idx_profiles_role_area` recreado como `idx_profiles_workspace_role (workspace_id, role)`.
- **Gotcha:** al crear miembro, `createStaffMember` ahora retorna `id` para luego asignar áreas vía `updateStaffAreas`. Roles `contador`/`campo` no usan áreas (form las oculta).

**Nav:** sección **"Mi Negocio" → "Configuración"** (`app-shell.tsx`, evita confusión con "Negocios"); ícono Briefcase→Settings. Ruta interna sigue `/mi-negocio`. Textos de referencia en cotización/drill-down actualizados.

**Infra — auto-deploy reparado:** la integración Git↔Vercel estaba desincronizada (config correcta pero sin entrega de eventos de push → no auto-deployaba). Fix: `vercel git disconnect` + `vercel git connect`. Verificado: el push gatilla deploy automático. **Ya no hace falta `vercel --prod` manual.** Procedimiento documentado en memoria de Mik.

---

**Sesion previa:** 2026-06-04 (`alma`/CCBF — Max — receptor webhook CCBF en ONE)
**Branch:** `main` · commit `0138238` (deployado Vercel 2026-06-05)

- **Tabla `kyc_expediente_ref`** (migración `20260604000001`): espejo local en ONE del estado de los expedientes de Vinculación de Contrapartes (CCBF) cuya fuente de verdad vive en `metrik-valida` (`expedientes_kyc`). Columnas: `workspace_id`, `expediente_kyc_id` (unique, externo), `razon_social`, `estado_cache`, `etapa_cache`, `severidad_cache`, `decision_cache`. RLS + policy de lectura por workspace + grant `select` a `authenticated` (panel OC); escritura solo `service_role`.
- **Endpoint `POST /api/webhooks/kyc`** (`src/app/api/webhooks/kyc/route.ts`): recibe el webhook firmado de metrik-valida. Valida **HMAC-SHA256 del cuerpo crudo** (`timingSafeEqual`, secreto `KYC_WEBHOOK_SECRET`) → upsert por `expediente_kyc_id`. 401 si firma inválida/ausente, 503 si el secreto no está configurado.
- **Gotcha / deuda:** `kyc_expediente_ref` aún no está en `database.ts` generado → el endpoint usa cast `as any` puntual (mismo patrón que el cron `drive-health`). Pendiente: regenerar tipos + re-agregar los ~26 aliases.
- **Env nueva requerida en Vercel ONE:** `KYC_WEBHOOK_SECRET` (compartido con metrik-valida `ONE_KYC_WEBHOOK_URL`+`KYC_WEBHOOK_SECRET`). El panel OC de CCBF en ONE (`/conocimiento-contraparte`) está pendiente (Noor/Ren).
- Contexto completo de CCBF en `proyectos/metrik/valida/CONTEXT.md`.

---

**Sesion previa:** 2026-06-04 (`soena` — Max — Formato 1668 + modelo roles×áreas×stages + guards server-side + impersonación)
**Branch:** `main` · commits `e73348e` `7cf9312` `a1d1736` `88148f0` `80b0fb2` `f461e06` `74a68bc` `e23903d` `66883ba` (deployados Vercel)

### Modelo roles × áreas × stages — ahora cableado a la capa de datos
- **`src/lib/permissions/can-edit.ts`** es la fuente única: `canEditBloque`, `canViewNegocio`, `canAdvanceStage`, `getAreasEfectivas`, `STAGE_TO_AREA` (venta→comercial, ejecucion→operaciones, cobro→financiera). **Política 2026-06-04:** si el usuario tiene área(s) en `staff_areas`, solo edita el stage de su área (incluido owner/admin con área); sin área → passthrough por rol; operator además debe ser responsable.
- **`src/lib/permissions/guard-negocio.ts`** (NUEVO): `guardEditarBloque` / `guardVerNegocio` / `guardAvanzarStage` / `esGerencial`. **TODA server action que muta bloques/etapas DEBE invocar el guard al inicio** (marcarBloqueCompleto, marcarBloqueItem, cambiarEtapaNegocioConGate, procesarDocumento, generarFormulario, generar/aprobarVersionPropuesta, generar/aprobarVersionGuia). `getBloqueMode` (cliente) y `_areaReadonly` son **solo UX**, no seguridad.
- **`getWorkspace`** ahora resuelve `areas` (de `staff_areas`) e **impersonación**: cookie `__impersonate` (solo platform_admin) devuelve role/areas/staffId del usuario objetivo → todo el gating lo hereda. Barra "Ver como…" en el app-shell (`impersonation-bar.tsx`).
- **Lista de negocios:** operator filtrado por `negocio_responsables` (server); supervisor preselecciona la fase de su área. **Detalle:** operator no accede a negocios ajenos por URL.

### Gotcha — `staff.id` vs `profile.id` (campo minado)
- `completado_por` (negocio_bloques + bloque_items) es **FK → profiles(id)** y el display resuelve por profiles → debe guardarse **`userId` (profile.id), NO `staffId`**. `activity_log.autor_id` y `negocio_responsables.staff_id` SÍ usan **staff.id**. Confundirlos viola la FK. Pendiente de unificación: el modelo de equipo vive disperso en `profiles`/`staff`/`staff_areas` (bugs 8 y 10 de la auditoría son síntomas).

### Formato 1668 DIAN (`src/lib/pdf/formulario-1668.ts`)
- Overlay `pdf-lib` análogo al 010, coordenadas calibradas con `pdftotext -bbox` del PDF diligenciado real. Rama `formulario-1668` en `formulario-actions.ts` + soporte `optional` en `CampoFuente`.

### Auditoría de seguridad (workflow multi-agente, 30 hallazgos)
- Reporte completo en el handoff. 6 críticos cerrados esta sesión. Backlog medio (7, 12-18) pendiente.

---

**Sesion:** 2026-06-03 (`alma` — Max — compliance/listas: sidebar, doc de soporte PDF, landing unificado, trazabilidad por usuario)
**Branch:** `main` · commits `0bc8242`, `70e8ac0`, `f545bac`, `14970ef`, `adbccb9`, `5b910d7` (deployados Vercel)

- **Sidebar — grupo "Validación"** (`app-shell.tsx`): Riesgos/Controles/Matriz quedan en "Cumplimiento"; Segmentación + Validación + Listas + Comparativa pasan a grupo propio "Validación" (`VALIDACION_NAV_ITEMS`). Mismo gating por flags y rol; incluido en `allMobileItems`.
- **Documento de soporte de consultas de listas** (`src/lib/compliance/pdf-soporte-dual.tsx` + route `/api/compliance/listas/soporte/[consulta_id]`): PDF generado desde `consultas_listas_dual` sin llamar a Informa/Valida. Branding MeTRIK + sello "Powered by Informa" (logo data URI en `informa-logo.ts`, azul `#003DA5`). Botón en resultado puntual + columna en historial. Guards auth/ws/módulo/rol + filtro `workspace_id`.
- **Landing unificado** (`src/lib/auth/landing.ts` — `landingForWorkspace(role, modules)`): fuente única usada por `middleware.ts`, `auth/callback/route.ts` y `accept-invite/page.tsx`. Elimina el drift que mandaba roles no-numbers a `/pipeline` (legacy → 404). compliance+dual → `/compliance/listas`; business → `/numeros`/`/negocios`. `operator` agregado al nav de Listas (gateado por flag dual).
- **Trazabilidad "Consultado por"** (`_usuarios.ts` → `resolverNombresUsuarios`): historiales dual (`compliance-dual.ts`) y Valida (`valida-consultas.ts`) resuelven `created_by` → nombre y lo muestran. `consultado_por` añadido a `DualHistorialItem` y `ConsultaHistorialItem`.
- **Fix `VALIDA_API_BASE`** (`compliance-dual.ts`): `||` en vez de `??` para que env vacía (`""`, como la inyecta Vercel) caiga al default en vez de quedar URL relativa rota.

**Gotcha / aprendizaje:** el hardening de Supabase (mover extensiones de `public` a `extensions`) **rompe funciones `SECURITY DEFINER` con `search_path` fijo que llaman `pgcrypto` sin schema-qualify**. Pasó en metrik-valida (`authenticate_api_key` → `digest()` no resuelto → `invalid_api_key` global, consulta de listas caída). **Auditar el mismo patrón en ONE.** Fix: qualify `extensions.digest` + `extensions` en search_path.

**Sesion previa:** 2026-06-03 (`soena` — Max — fixes de workflow/propuesta/extracción + función guardián de refs)
**Branch:** `main` · commits deployados Vercel

### Cambios de producto (genéricos, deployados)
- **`audit_workflow_refs(linea_id)`** (migración `20260602000003_audit_workflow_refs`): función SQL genérica que valida las 7 clases de referencia por orden de etapa (readonly/condition/auto_fill/doc_link/cross_check/campos_fuente/routing) contra la realidad. **Correr tras cualquier reorg de etapas.** Ver gotcha en "Gotchas y convenciones".
- **Bloques `datos` de solo lectura (config estado='visible') nacen `completo`** (`6a3d93f`). No requieren acción del usuario → antes quedaban pendientes/atascados.
- **BloqueDatos modo visible cae a `field.default`** cuando no hay data ni auto_fill (`03fe141`).
- **Gate condicional honra `source_etapa_orden` + `value_in`** vía helper SQL `condicion_cumplida()` (`gates_pendientes_etapa` lo usa) — gate ⟺ render usan la misma fuente (migración `20260602000002`). `gates_pendientes_etapa`/`puede_avanzar_etapa` lista solo gates realmente pendientes (`20260602000001`).
- **Modal de gate vía `createPortal`** a `document.body` (no quedaba atrapado en el header sticky) + scroll-lock + Escape (`913617f`).
- **Auto-extracción AI con reintento** + flag `_extraction_status` + banner "reintentar/manual"; **`responseSchema` fuerza JSON válido en Gemini** (`4484c51`, probado contra API real) — elimina "JSON inválido de Gemini".
- **Documentos/formularios suben a la carpeta canónica del negocio (`carpeta_url`)**, no a una carpeta huérfana por `codigo` (`86147f0`). Scripts `cleanup-orphan-drive-folders.ts` + `dedup-and-cleanup-drive.ts`.
- **Auto-init de `propuesta_economica` al ENTRAR a su etapa** (no solo en crearNegocio) + robusto a instancias existentes sin `precio_base_con_iva` (`b307c97`, `235e8dd`). Necesario cuando el bloque propuesta no está en la 1ª etapa.
- **Guía de devolución resuelve RUT/Factura/Fecha-cita por NOMBRE de bloque** (no por orden) (`c14ed76`).
- **Convención:** al leer datos cross-bloque en código, resolver por **nombre de bloque** (ignorando heredados con `source_etapa_orden`), no por orden de etapa.

---

**Sesion:** 2026-06-02 (`metrik--valida` — Max — hardening de seguridad Supabase, gatillado por anuncio de grants públicos)
**Branch:** `main` · commits `123b42c`, `25bbe11` (migrations aplicadas en prod vía MCP)

Auditoría del Security Advisor de ONE (8 ERROR / 96 WARN) y cierre de **2 fugas reales cross-tenant**:

- **`staff_areas`** estaba sin RLS y con grant a `anon` → con la anon key pública (va en el bundle del browser) se leía el equipo (`staff_id`, `area`) de **todos los workspaces** vía `/rest/v1/staff_areas`. Fix: RLS + 4 policies de aislamiento por workspace (join a `staff`, patrón `control_causa`). Migration `20260602000003`. Se accede con cliente authenticated en `equipo-areas.ts`/`cierre-adelantado.ts`/`reapertura.ts`, por eso necesita policies (no solo enable RLS).
- **7 vistas financieras** (`v_pyl_mes`, `v_mc_negocio`, `v_mc_linea_mes`, `v_proyecto_financiero`, `v_proyecto_rubros_comparativo`, `v_negocios_etapa_vencimiento`, `v_tutorial_adopcion`) eran `SECURITY DEFINER` + grant `anon` → **EBITDA / P&L / MC de todos los workspaces leíbles sin login**. Fix: `security_invoker=on` (la vista respeta el RLS del rol consultante) + revoke `select` a `anon`. Migration `20260602000004`. La app las consume vía `getWorkspace()` filtrando por su propio workspace → sin cambio de comportamiento.
- **Convención de base de datos** agregada arriba (toda tabla nueva → RLS + policy por workspace + GRANT explícito), anticipando el cambio Supabase de oct-2026.
- Advisor ONE: **8 ERROR → 0 ERROR**. Backlog no crítico (96 WARN): 88 funciones `SECURITY DEFINER` ejecutables por anon/auth, 3 `search_path`, 3 `extension_in_public`, `public_bucket_listing`, `auth_leaked_password`.

**QA funcional pendiente (Mauricio):** `/numeros` (EBITDA/P&L/MC), detalle proyecto/negocio, `/flujo`, Config → Equipo / cierre adelantado / reapertura. Rollback trivial si algo sale vacío (`security_invoker=off` / `disable RLS`).

---

**Sesion previa:** 2026-06-02 (`soena` — 3 fixes E5 Documentación: gate falso-negativo IA + modal de gate preciso + modal sin cortes)
**Branch:** `main` (deployado Vercel)

### Cambios de producto deployados a Vercel prod

- **Bug #1 — gate falso-negativo cuando la extracción IA falla** (`documento-actions.ts`, `BloqueDocumento.tsx`). Antes: si Gemini fallaba (timeout/5xx/JSON malo) el bloque quedaba `pendiente` en silencio y bloqueaba el avance aunque el documento sí estuviera cargado. Ahora: helper `extractWithRetry` reintenta 1 vez ante fallo transitorio (no reintenta si el contenido fue bloqueado por Gemini — falla permanente); se persiste `_extraction_status` (`ok`/`failed`/`no_key`) en `negocio_bloques.data`; el bloque muestra banner rojo "La extracción con IA falló — Reintentar / completar manual" con botón prominente. `procesarDocumento` y `reprocesarDocumento` setean el flag; el llenado manual ya existente se conserva.
- **Bug #2 — modal de gate listaba TODOS los gates de la etapa, no los pendientes** (`negocio-v2-actions.ts` + migration). Nuevo RPC `gates_pendientes_etapa` devuelve **solo** los gate que realmente bloquean (`estado='pendiente'` + condición cumplida) con su label real (`config_extra.label` ?? `bloque_definitions.nombre`). `puede_avanzar_etapa` se redefine para reusar ese RPC → **una sola fuente de verdad, cero drift** entre el booleano del gate y la lista que se muestra. El server dejó de listar todos los `es_gate` y usa el RPC.
- **Bug #3 — modal de gate se cortaba + selección rara del header** (`negocio-detail-client.tsx`, `ModalGateBloqueado`). Agregado `max-h-[90vh]` + lista interna scrollable (`flex-1 overflow-y-auto`, header/footer `shrink-0`), lock de scroll del body mientras está abierto, `select-none` en el overlay (mata la selección residual del header sticky), cierre con Escape y por click en el backdrop.

**Migration:** `20260602000001_gates_pendientes_etapa.sql` (aplicada en prod vía MCP; smoke test consistencia `puede_avanzar_etapa` ↔ `gates_pendientes_etapa` OK).

### Seguimiento (mismo día) — modal en header + gate condicional cross-etapa

- **Modal de gate quedaba atrapado en el header** (`negocio-detail-client.tsx`, `ModalGateBloqueado`). `fixed inset-0` se anclaba al header sticky (que usa `backdrop-blur` → crea containing block). Fix: `createPortal` a `document.body` → el overlay vuelve a cubrir el viewport real. (El `max-h`/scroll-lock/`select-none` del fix anterior se conservan.)
- **Gate condicional ignoraba `source_etapa_orden` → bloqueaba un bloque que NO se renderizaba.** El render del bloque (`negocio-detail-client.tsx`) lee `condition.field` desde la etapa `condition.source_etapa_orden` y soporta `value_in`; el gate solo miraba la etapa actual → divergencia (bloqueaba "Certificado bancario" condicionado a `requiere_devolucion_iva`, toggle que vive en Negociación, pero el bloque no aparecía). Fix: helper SQL `condicion_cumplida()` que replica exactamente la lógica del render (cross-etapa + `value_in` normalizado lower/unaccent/trim + `value` escalar exacto); `gates_pendientes_etapa` lo usa. **Migration `20260602000002_gates_condicion_cross_etapa.sql`** (aplicada en prod). Ahora gate ⟺ render usan la misma fuente: si el bloque se ve, el gate lo exige; si no aplica, no estorba.
- **Dato SOENA:** la condición de "Certificado bancario" tenía `source_etapa_orden: 4` (stale tras el reorg de hoy que movió Negociación 4→5). Corregido a `5` vía SQL. Auditadas las 2 condiciones gate de la línea VE: la otra (`ciudad_venta`, orden 2) estaba correcta.

---

**Sesion previa:** 2026-06-02 (`soena` — gates computados reusables + fix render WorkflowDiagram + conciliación de sobrepago en Cobro)
**Branch:** `main` · commits `a0fa738`, `dd0ec94`, `2dbf92d` (deployados Vercel)

### Cambios de producto deployados a Vercel prod

- **Gate computado genérico `campo:<slug>=<valor>`** (`negocio-v2-actions.ts`, en `cambiarEtapaNegocioConGate` tras `saldo_cero`). Lee los bloques `datos` de la etapa actual y bloquea el avance si un campo ≠ valor esperado. Mensaje configurable por etapa vía `config_extra.gate_messages[gate]`. Reusable por cualquier workflow sin tocar código (se configura en `etapas_negocio.config_extra.gates`). Primer uso: SOENA Inclusión (`campo:decision_incluir=si`) y Espera (`campo:inclusion_confirmada=true`).
- **Gate computado `sobrepago_conciliado`** (mismo archivo). Si `total cobrado > precio`, bloquea avanzar hasta que el campo `accion_extra` (bloque de conciliación) tenga valor. Sin sobrepago, no exige nada.
- **Skip-cobro condicionado por `config_extra.conciliar_sobrepago`**. La etapa `stage='cobro'` se salta automáticamente solo si el pago es exacto (`saldo===0`) cuando la etapa tiene el flag; un sobrepago entra a Cobro a conciliar. Sin el flag, comportamiento previo (`saldo<=0`). No afecta workspaces que no lo activen.
- **Razón de pérdida "No incluido en UPME"** agregada a `RAZONES_PERDIDA_NEGOCIO` (`src/lib/negocios/constants.ts`).
- **Fix `WorkflowDiagram` — `routing.conditional` opcional** (`workflow-diagram.tsx` + tipos `WorkflowRouting`/`FlujoRouting` + tipo local en `negocio-v2-actions.ts`). Un routing solo-`default` (sin `conditional`, p.ej. avance lineal forzado) crasheaba el render (`conditional is not iterable`) y el motor de avance. Ahora `conditional?` es opcional y todos los iteradores/accesos usan `?? []` / `?.[]`. **Cualquier** workflow con routing solo-default deja de romper. commit `dd0ec94`.

**Aprendizaje:** verificar el render de workflows por trazado de código NO sustituye la verificación visual en runtime — el crash de `/flujo` se escapó de una verificación por trazado y solo lo destapó la prueba en vivo.

---

**Sesion previa:** 2026-05-25 (`soena` — bloque propuesta_economica end-to-end, blindaje Drive, opción C servicios↔líneas, UI historial etapas previas)
**Branch:** `main` · 19+ commits acumulados (sesion mega con SOENA + saneamiento bugs sesion paralela)

### Cambios de producto deployados a Vercel prod

- **Tipo `propuesta_economica` agregado a biblioteca de bloques** (genérico, codigo `PE`). Construido para SOENA pero reutilizable. Backend: `src/lib/actions/propuesta-economica-actions.ts` con server actions `generarVersionPropuesta`, `aprobarVersionPropuesta`, `crearV1Automatica`, helper `calcularPropuesta`. UI: `BloquePropuestaEconomica.tsx` con inputs sincronizados (% descuento ↔ valor final), cap configurable (default 50%), versionado en Drive, lista versiones con link PDF, botón aprobar setea `negocios.precio_aprobado`. Cliente PDF: `renderPropuestaEconomica` en `pdf-render-client.ts`. Auto-init v1 al crear negocio via `auto_propuesta.servicio_id` config_extra. Herencia readonly cross-etapa server-side reemplaza `data` por la del source cuando es propuesta_economica readonly.
- **Opción C — `servicios.linea_id` FK formal** (migration prod). Lookup por UUID estable a renames. `getServiciosActivos(lineaId?)` filtra automático. UI: selector línea en form servicios + badge "Global"/nombre línea en listado. `cotizacion-editor` recibe `lineaId` del negocio y filtra catálogo.
- **Blindaje Drive 4 capas** — script canónico `setup-drive-workspace.ts` valida antes de persistir + preserva config_extra. Trigger DB `protect_workspace_drive_config` bloquea borrado destructivo de keys drive_* (escape opt-in via session var). Health check diario `/api/crons/drive-health` + tabla `drive_health_log` + cron Vercel + activity_log `drive_health_failed` cuando falla. Script `preflight-workspace.ts` end-to-end (folder + OAuth + crear+borrar test), soporta Shared Drive.
- **`crearNegocio` registra activity_log `drive_folder_failed` al fallar Drive** — antes silencioso (solo `console.error`). Ahora visible al owner en timeline.
- **Sección "Historial de etapas anteriores"** en detalle de negocio. Server retorna `bloquesEtapasPrevias` con estructura completa (config + def + instancia + items). Cliente: componente colapsable, cada etapa expandible, cada bloque expandible con su componente nativo en modo `visible` via flag `_forceReadOnly` en BloqueRenderer. Renderiza BloqueDocumento descargable, BloquePropuestaEconomica con historial PDF, BloqueDatos rellenado, etc.
- **Fix BloquePagosEpayco** — `useEffect` re-sincroniza `pagos` con prop tras `revalidatePath`. Antes el pago se guardaba en DB pero la UI no reflejaba hasta refresh manual.
- **Fix propuesta_economica lookup `auto_propuesta.servicio_id` anidado** — antes solo leía `configExtra.servicio_id` (nivel raíz) → mostraba "Sin precio base disponible" porque la config canónica anida bajo `auto_propuesta`.
- **Fix query lookup negocio en propuesta_economica** — incluía `contactos(nombre, cedula)` pero `contactos` no tiene columna `cedula`. Query fallaba silenciosamente, `negocio=null`, "sin carpeta_url" cuando sí estaba poblada.
- **Fallback graceful** en `generarVersionPropuesta` — si render PDF falla (endpoint no disponible), versión queda persistida sin PDF + toast warning. Server action retorna `{ok:true, warning}` en vez de `{ok:false}` para permitir iterar valores y aprobar mientras se restaura el endpoint.

### Cambios en metrik-pdf-render (Cloud Run us-east1)

- **Endpoint nuevo `/render/propuesta-economica`** — acepta template_slug flexible (`cliente/propuesta-economica` o `cliente`). Reemplazo simple de placeholders `{{key}}`.
- **Template `templates/soena/propuesta-economica.html`** — 8 páginas A4, branding SOENA (Manrope, paleta `#4A6CF7`, `#1B2D4F`), assets reales extraídos del PDF original (logo SOENA, Tesla portada, carro híbrido + certificado UPME, carro eléctrico, ingeniero, foto Juan David Bruce). Placeholders dinámicos en pág 4 (planes) y pág 8 (firma).
- **Deploy revisión `metrik-pdf-render-00004-hkg`** sirviendo 100% tráfico.

### Sesión previa (no perder contexto)

**Sesion previa:** 2026-05-24 (`metrik-one--core` — fix routing platform admin + form negocios + IDs fijos L/E + paridad stage/etapa)
**Branch:** `main` · 8 commits acumulados sobre 3a40aa8 (PR #4 + fixes + features sin PR)

### Cambios de producto deployados a Vercel prod

- **Fix routing platform admin cross-subdomain** (PR #4, commit `3874390`): magic link usa `token_hash` directo al `/auth/callback` en vez de `action_link` (que aterrizaba con tokens en `#hash` que el server no procesa). Subdomain sin sesion → `/login` del MISMO subdomain (no marketing). Callback auto-switchea workspace cuando platform_admin entra a un subdomain ajeno. `getLanding` siempre `/numeros` para roles con acceso. Validado en prod por Mauricio en 4 escenarios.
- **Form `/negocios/nuevo` simplificado** (commits `7af5122`, `1b4f7be`, `86705b6`): eliminado campo `precio_estimado` del wizard. Solo nombre + (empresa/persona natural) + contacto. Server action `crearNegocio` ya aceptaba undefined → guarda NULL. Precio entra despues por cotizacion, bloques o edicion en header.
- **Selector linea de negocio en todo workspace** (commit `1b4f7be`): query `lineas_negocio` ya no esta gateada por `tipo='clarity'`. Selector visible en cualquier ws con >=1 linea activa. Pre-selecciona la unica cuando hay 1. Obligatorio si hay lineas. Workspaces sin lineas no muestran el campo.
- **Microtext sobrio "una sola linea"** (commit `86705b6`): cuando el ws tiene 1 sola linea, debajo del selector aparece "Esta es la única línea activa de tu negocio en MeTRIK ONE." en `text-[10px] text-muted-foreground/70`. Sin link, sin CTA. Invita a "reclamar" otras lineas sin empujar.
- **Linea de negocio en card y header del detalle** (commit `6d6d272`): `linea_nombre` se muestra cerca del StageBadge. Datos ya estaban en `NegocioResumen.linea_nombre` y `NegocioDetalle.lineas_negocio.nombre` — solo render faltaba.
- **IDs fijos L/E** (commit `8d4119e`, migration `20260524_lineas_etapas_numero_fijo`): columna `numero` agregada en `lineas_negocio` y `etapas_negocio`. UNIQUE (workspace_id, numero) y UNIQUE (linea_id, numero). Trigger BEFORE INSERT asigna `MAX + 1` entre todas (activas + inactivas) — preserva historial sin reusar numeros. `etapas_negocio.numero` INDEPENDIENTE de `orden` (orden = visual reordenable, numero = evolucion historica). Backfill: 9 lineas + 50 etapas numeradas. `NegocioResumen` y `NegocioDetalle` exponen `linea_numero` y `etapa_numero`.
- **Paridad visual stage/etapa + remover redundancia** (commit `e9ed289`): card y header muestran `[STAGE] › [E{N} ETAPA]` con MISMO `STAGE_CLASSES` (mismo bg, mismo text color, mismo padding, mismo `font-bold tracking-wider uppercase`). Stage y etapa quedan visualmente equivalentes — son par primario. Removido h2 redundante "Etapa actual: X" debajo del header sticky. Refuta propuesta original Noor de subordinar la etapa con stage color @5%.

### Bonus tecnicos fuera del scope original

- **`UPDATE profiles SET workspace_id = home_workspace_id` para Mauricio** via SQL: resetea workspace activo a metrik para entrada fluida.
- **Auth config Supabase verificada** via Management API (PAT `sbp_*`): Site URL `https://metrikone.co` + URI allow list `https://*.metrikone.co/**` correctos. No requirio cambios.
- **Saneamiento build sesion paralela** (commits `e17c2fd`, `b21e817`, `640ff0e`): 3 deploys fallaron en cascada porque arrastre imports a archivos untracked de la sesion paralela (`BloquePropuestaEconomica.tsx`, `propuesta-economica-actions.ts`). Resuelto deshabilitando el case `propuesta_economica` con placeholder + quitando `export` de `calcularPropuesta` (era sync en archivo `'use server'`). Sesion paralela ya commited sus archivos y restauro imports — todo funcional al cierre.

### Gotchas detectados / aprendizajes

- **Imports arrastrados de sesion paralela en working tree compartido**: cuando hago `git add` de un archivo que la sesion paralela edito, arrastro sus cambios sin querer. Patron de QA: `git diff --cached` antes de commit para detectar lineas ajenas. Captura `cerebro/errores/imports-arrastrados-sesion-paralela.md`.
- **`'use server'` exige TODOS los exports async**: si exportas una funcion pura sync (calculo, formateo) desde un archivo `'use server'`, Next.js falla el build con "Server Actions must be async functions". Fix: quitar `export` si es helper interno, o mover a archivo aparte sin la directive. Captura `cerebro/errores/use-server-exports-async-only.md`.
- **Stage y etapa son par primario, no jerarquia** (correccion a propuesta Noor inicial): cuando una entidad esta en un proceso multi-stage con sub-etapas, ambos niveles deben verse visualmente equivalentes. Subordinar la etapa visualmente (stage color @5%) escondio info operativa critica. Captura `cerebro/decisiones/2026-05-24_stage-etapa-par-primario.md`.

**Sesion previa:** 2026-05-21 (`metrik-one--core` — PR #2 mergeado, sidebar Workflows unificado, boton Reenviar cuenta de cobro, cleanup completo de branches)
**Branch:** `main` · branch del PR borrado · repo en estado "solo main"

### Cambios de producto deployados a Vercel prod

- **Fix magic link cross-subdomain** (`src/lib/actions/platform-admin.ts`): `generateCrossSubdomainSessionLink` ahora usa `properties.hashed_token` y construye URL directo a `/auth/callback?token_hash=...&type=magiclink&redirectTo=...`. Antes retornaba el `action_link` de Supabase que dispara `/auth/v1/verify` y aterriza con tokens en `#hash` — los hashes no llegan al server, asi que el callback nunca podia sembrar la sesion y el flow caia en `/login?redirectTo=/mi-negocio` con tokens colgando. Con `token_hash` en query, el server hace `verifyOtp` y la cookie de sesion se setea en la response del redirect.
- **Middleware: subdomain sin sesion -> /login del mismo subdomain** (`src/middleware.ts`): antes redirigia a `metrikone.co/login`, donde la sesion de marketing tomaba el `profile.workspace_id` actual y mandaba al subdomain de ESE ws — ignorando el subdomain que el user habia tecleado. Ahora el login se hace local al subdomain via magic link; la cookie se siembra alli y el callback decide destino con contexto del host correcto. Se agregaron `/login` y `/registro` a las rutas publicas permitidas para subdomain sin sesion.
- **Middleware: `getLanding` siempre `/numeros`** para roles con acceso (`owner`, `admin`, `supervisor`, `read_only`). Antes caia a `/mi-negocio` si `config_metas` estaba vacio — la pagina ya maneja empty state asi que el check de count era ruido. Esto confundia el switch de workspace de platform admin porque cada switch a un ws sin metas aterrizaba en `/mi-negocio` en lugar de Numeros.
- **Callback: auto-switch para platform admin via subdomain** (`src/app/auth/callback/route.ts`): si el callback aterriza en `subdomain.metrikone.co` y user es `platform_admin` con `profile.workspace_id` apuntando a otro workspace, `routeAfterAuth` ahora hace UPDATE del `workspace_id` al ws del host + audit log en `activity_log` (`tipo: platform_admin_enter`). Materializa "metrik por defecto cuando entro a metrik.metrikone.co" sin pasar por el dropdown Admin. Si `home_workspace_id` no estaba seteado, lo registra como side-effect del primer switch.

### Bonus aplicado fuera del PR

- **Reset workspace_id Mauricio** via SQL: `UPDATE profiles SET workspace_id = home_workspace_id` para `cc6f6100-4eb7-4eed-9a7c-096729f5cedf`. Estaba activo en SOENA (`7dea141d-d4da-483d-a78d-b14ef35500c5`) por el ultimo switch, `home_workspace_id` ya era metrik (`a21bfc88-1a60-48c3-afcd-144226aa2392`). Sin esto, la proxima entrada igual habria funcionado (el fix del callback hace auto-switch), pero evita un viaje extra por `/login` del subdomain metrik.
- **Auth config Supabase verificada via Management API** (PAT `sbp_...`): Site URL = `https://metrikone.co`, URI allow list incluye `https://*.metrikone.co/**`. Correcto, no requirio cambios — el bug era de codigo, no de config.

### Validacion en prod

QA manual por Mauricio confirmando los 4 escenarios:
1. `metrik.metrikone.co` directo -> login subdomain -> magic link -> `/numeros` correcto
2. Dropdown Admin -> SOENA -> aterriza directo en `soena.metrikone.co/numeros` con sesion sembrada (sin pasar por `/login`)
3. Banner "Platform Admin viendo SOENA" + host coincide con subdomain de la URL
4. "Regresar a metrik" -> `metrik.metrikone.co/numeros`

### Gotchas detectados / aprendizajes

- **`auth.admin.generateLink` retorna `action_link` que usa flow implicit (hash)** — patron incorrecto para sembrar sesion server-side cross-subdomain. El patron correcto es ignorar `action_link` y construir URL directo al callback con `properties.hashed_token` + `type=magiclink`. El callback procesa via `verifyOtp` que setea cookie en la response. Documentado al cerebro como `cerebro/errores/supabase-action-link-hash-flow.md`.
- **Bug invisible hasta que se prueba el flow real**: el flow cross-subdomain via dropdown Admin nunca se habia validado end-to-end despues de la decision Vercel SSO 2026-04-28. Los magic links de invitacion estandar (`auth.admin.inviteUserByEmail`) usan token_hash en query y funcionan bien — solo `generateLink` con magic link callback custom estaba roto. Reglas de QA pendiente: agregar al checklist de Hana "validar cross-subdomain switch de Platform Admin" tras cualquier cambio en middleware/callback/platform-admin.

**Sesion previa:** 2026-05-21 (`metrik-one--core` — PR #2 mergeado, sidebar Workflows unificado, boton Reenviar cuenta de cobro, cleanup completo de branches)
**Branch:** `main` · branch del PR borrado · repo en estado "solo main"

### Cambios de producto deployados a Vercel prod

- **Sidebar Workflows unificado** (commit `aee3541`): una sola entrada `Workflows` en `src/app/(app)/app-shell.tsx`. `href` se resuelve en runtime: owner del `ADMIN_WORKSPACE_ID` → `/admin/workflows` (biblioteca cross-workspace), resto → `/flujo` (Kanban del workspace). Item duplicado eliminado de `ADMIN_NAV_ITEMS`. Dropdown nuevo "Todos los workspaces" en `WorkflowsList`.
- **Boton Reenviar cuentas de cobro** (commit `3dfabd1`): server action `reenviarCuentaCobro` en `src/lib/actions/cuentas-cobro-actions.ts` (owner-only, estados `enviada`/`aprobada_lista_envio`). Reusa `enviarCuentaCobroEmail` sin re-aprobar. Boton variante secundaria en `src/app/(app)/cobros-recurrentes/cobros-recurrentes-client.tsx`.
- **Modelo roles-areas-stages Fases 1-3+ en produccion** (PR #2 merge commit `be1fb46`): 13 migrations aplicadas en Supabase prod via MCP **antes** del merge para evitar ventana de inconsistencia. Vercel auto-deploy en Ready.
- **Render workflow extendido**: bloques readonly + condicionales se distinguen visualmente. ID corto por bloque (2 letras + numero por linea) en simplified y detailed. `config_extra.visible=false` filtra el bloque del diagrama tanto en `/flujo` como en `/admin/workflows`. Tipos inherentemente readonly (cobros, historial, resumen, ejecucion) muestran icono Eye automaticamente.
- **ID corto por bloque con herencia** (commit `3a40aa8`): `block_id` formato `XX{N}` (2 letras del tipo + N consecutivo por linea). Bloques readonly heredados (con `config_extra.source_etapa_orden`) **conservan el ID del bloque origen** via matching `(etapa source, nombre, tipo)`. Calculado runtime en 3 server actions: `/flujo`, `/admin/workflows`, `/negocios/[id]`. NO se persiste en DB. Helper `bloqueTipoCode(tipo)` + `BLOQUE_TIPO_CODE` en `src/components/workflow/types.ts`.
- **ID visible en `/negocios/[id]`** (commit `3a40aa8`): badge negro junto al nombre en el header de cada bloque. Mismo estilo que `/flujo`. Permite referirse a bloques sin ambigüedad operacional.
- **Esquema visual WorkflowDiagram queda como ESTANDAR canonico** para todos los workflows MeTRIK ONE. NO modificable por cliente. Cualquier cambio futuro al esquema debe ser propuesto por Noor (UX/UI), validado por Vera + Hana, ejecutado por Max, y aplicado a TODOS los workflows existentes simultaneamente. Detalle en `cerebro/reglas/esquema-visual-workflow-estandar.md`.
- **`/flujo` y `/negocios/[id]` son espejos**: ambas superficies leen de `bloque_configs` (DB), cero drift permitido. Disenar un workflow ES disenar simultaneamente como se ve y opera dentro de cada negocio activo. Auto-instanciacion (`getNegocioDetalle` auto-crea instancias faltantes al entrar a etapa) preserva el espejo. Detalle en `cerebro/reglas/workflow-y-ejecucion-son-espejos.md`.

### Cleanup de repo

- 4 feature branches borrados (local + remoto): `feat/roles-areas-stages-fase-1`, `feat/tenant-rules-motor`, `fix/workflow-diagram-branch-chains`, `feat/workflow-render-readonly` (temporal).
- 18 branches `worktree-agent-*` huerfanos borrados.
- 6 worktrees fisicos desbloqueados y removidos en `.claude/worktrees/`.
- Estado actual: solo `main` en local, remoto, y worktree list. `.claude/worktrees/` vacio.

### Gotchas detectados

- **Colision sesiones paralelas (2026-05-20)**: tres sesiones Claude Code activas sobre el mismo working directory `metrik-one/`. Una hizo `git reset` + `git checkout feat/roles-areas-stages-fase-1` y descarto edits sin commit de otra sesion. Documentado al cerebro como `cerebro/errores/colision-sesiones-paralelas-git.md`. Solucion estable: una sesion = un worktree git. Blindaje hook pendiente (Hana propone, Vera valida).
- **Commits gemelos en merge paralelo**: cuando dos sesiones empujan el mismo commit a paths distintos (branch + main directo), git los conserva como SHAs distintos pero contenido identico. Detectable comparando timestamp + autor + diff stat. En PR #2 vs PR #3 paso con `69472b0`↔`fa8f897` y `806483c`↔`97f266b`.

**Sesion previa:** 2026-05-20 (`metrik-one--core` — Modelo roles · areas · stages, Fases 0-3+ con Fase 3+ UI corriendo en background al cierre)
**Branch:** `feat/roles-areas-stages-fase-1` · 4 commits acumulados sobre main · sin merge aun

### Trayectoria de la sesion

Diseno e implementacion del modelo canonico de permisos sobre negocios en MeTRIK ONE para arrancar el primer workspace multi-usuario con varios roles activos. El modelo anterior (3 tiers planos por rol global) era insuficiente — no contemplaba areas funcionales ni stages del negocio. Hana lidero 4 rondas de preguntas (19 cabos sueltos). Vera dio GO. Mauricio aprobo implementacion por 6 fases. Unifica 3 piezas: roles globales (6), areas funcionales (comercial / operaciones / financiera / direccion transversal) y stages del negocio (venta / ejecucion / cobro / cerrado).

### Fases entregadas

**Fase 0 — Cerebro (Kaori):**
- `cerebro/conceptos/modelo-roles-areas-stages.md` — concepto canonico con matriz 3D + funcion central + cascadas + lock + reapertura
- `cerebro/reglas/permisos-negocios.md` — 18 reglas operativas
- `cerebro/decisiones/2026-05-20_modelo-roles-areas-stages.md` — 25 decisiones + refinamiento post-Fase 1
- `cerebro/reglas/bloques-permisos-por-rol.md` deprecada con banner

**Fase 1 — BD (Max, commit `63db780`):**
- 9 migraciones aplicadas en prod (yfjqscvvxetobiidnepa)
- Tablas nuevas: `staff_areas`, `negocio_responsables`, `workspace_default_responsables`, `bloque_locks`
- Columnas nuevas: `negocios.cierre_motivo`, `is_paused/paused_at/by/reason`, ampliacion CHECK de `stage_actual` con `cerrado`
- Trigger auto-stage `sync_negocio_stage_from_etapa`

**Cleanup pre-Fase 2:** DELETE en transaccion de 7 negocios cerrados de pruebas + cobros/gastos/horas asociados (4+5+5 filas) + cascada 127 bloques + 4 cotizaciones. 0 cerrados restantes, 35 negocios activos.

**Fase 2 — Funcion central + cascadas + locks (Max, commit `3ff32d6`):**
- `src/lib/permissions/can-edit.ts` con expansion `direccion` → 3 areas operativas
- 33/33 tests pasan
- 4 migraciones nuevas (20260520000010-13): mapeo legacy D1, trigger cascada asignacion responsable area entrante, lock functions, alerta etapa sin responsable de area
- `src/lib/actions/bloque-locks.ts` server actions
- pg_cron cleanup locks + alerta diaria 13:00 UTC
- Refactor `getNegociosV2` lee `negocio_responsables` N:M
- Backfill D1: 4 staff direccion + 1 admin_finanzas → financiera

**Fase 3+ specs UX (Noor, commit `4846f0b`):**
- `docs/specs/2026-05-20_ux-roles-areas-stages.md` (810 lineas) con 6 superficies UX mobile-first 360px
- 13 componentes Radix/shadcn + hook `useBloqueLock` + 14 server actions nuevas + 4 extensiones
- 3 decisiones UX cerradas por Mauricio: A1 inline read-only post-cierre, A2 realtime Supabase para locks, A3 placeholder legal hasta Emilio

**Fase 3+ assets (Ren, commit `9f7d9df`):**
- 5 SVGs empty state en `public/empty-states/`: empty-staff-area, empty-cerrados, header-cerrado-{exitoso,perdido,cancelado}
- Tokens 100% manual de marca
- 3 SVGs separados para header (render condicional limpio en JSX)
- Spec `docs/specs/2026-05-20_assets-empty-states.md`

**Fase 3+ UI (Max, 8 commits `0f5e64d` → `cc2c387`):**
- 6 superficies entregadas: equipo multi-area, modal cierre, lista cerrados, accordion historial, lock UX (hook + banner + indicator + endpoint /api/locks/release), reapertura con bifurcacion
- 15 archivos nuevos + 4 modificados (`negocio-v2-actions`, `negocios-client`, `negocio-card`, `[id]/page`, `mi-negocio-client`)
- tsc + eslint limpios en archivos nuevos
- Tokens MeTRIK 100% canonicos en codigo nuevo
- Realtime Supabase channel `bloque_lock:{id}` funcional
- `navigator.sendBeacon` para release en unload
- Drawer bottom mobile <600px / modal centrado desktop

**Wiring pendiente para iteracion siguiente** (tasks #11-14):
- ConfirmCierreModal aun no enchufado al header (CierreNegocioDialog legacy sigue activo)
- useBloqueLock listo pero falta integrar en cada BloqueXxx.tsx (17 archivos)
- EtapasHistorialAccordion muestra placeholder — falta BloqueRenderer con `forceReadOnly`
- Tipo `bloque_cierre` configurable en catalogo bloque_definitions queda como abstraccion futura

### Decisiones clave

- **3 areas canonicas + 1 transversal:** comercial / operaciones / financiera / direccion
- **Sin limite cardinal por rol** (D3). Si un WS necesita limitar → overlay propio
- **Supervisor de un area NO manda sobre otra area.** Disciplina de mando lateral
- **Ser responsable NO sobrepasa filtro de area.** Area persona debe coincidir con area del stage
- **Cierre estructurado:** exitoso (auto), perdido (solo venta, cero cobros, reabre supervisor), cancelado (cualquier stage, notif owner, reabre admin)
- **Pausa flag ortogonal** (no es cierre). Solo admin/owner. Timers congelados, continuan al reactivar
- **Lock pesimista** TTL 5 min + heartbeat + realtime sync + force unlock owner/admin
- **MeTRIK configura todos los WS por ahora** (no self-service workflows)
- **Bloque cierre adelantado parametrizable** por etapa (habilitar_perdido_en_etapas, habilitar_cancelado_en_etapas)

### Estado al cierre

- 7 tasks cerradas (Kaori Fase 0, Max Fase 1+2 + arranque limpio, Vera GO, Noor specs UX, Ren assets)
- 3 tasks vivas: Max Fase 3+ UI (en background), Emilio disclaimer legal cancelacion, parking lot notificaciones

### Pendientes para proxima sesion

1. **Revisar reporte de Max Fase 3+** corriendo en background — ver commits posteriores a `9f7d9df` y resultado de tasks/a28f5f91e720eb519
2. **Emilio entrega copy legal disclaimer cancelacion con cobros** (Ley 1581 + manejo dinero + constancia escrita) → reemplazar placeholder en modal cierre
3. **QA E2E del flujo completo** en workspace metrik antes de merge a main
4. **Resolver 12 staff con `staff.area=NULL`** workspace-por-workspace (sin bulk-assign)
5. **Merge `feat/roles-areas-stages-fase-1` a main** cuando Fase 3+ este validada
6. **Sesion dedicada de notificaciones** (P5 + P14 parking lot): definir modelo cross-modulo in-app + email + WA con Yuto + Mateo + Hana
7. **Deuda tecnica Fase 2:** regenerar `database.ts` para tipar RPCs nuevas + quitar `as any` casts en `bloque-locks.ts`

---

**Sesion previa:** 2026-05-19 (`metrik--cobros-recurrentes` Fases 1-7 — modulo cobros recurrentes activable por flag en workspaces de persona natural emisora)
**Branch:** main · cambios uncommitted (16 archivos nuevos + 7 modificados)

### Trayectoria de la sesion

Implementacion tecnica del flujo de cuentas de cobro mensuales para workspaces ONE donde el emisor es persona natural (caso piloto: workspace `metrik`, emisor Brallan Mauricio Moreno Guzman). 7/10 fases completadas. Pendiente: deploy del nuevo endpoint metrik-pdf-render a Cloud Run (gcloud auth login bloqueado), Resend dominio `metrik.com.co` (DKIM/SPF), UI aprobacion humana antes de envio, QA end-to-end con mayo 2026 retroactivo.

### Modulo `cobros_recurrentes` (activable por flag)

Patron canonico para workspaces donde el titular emite cuentas de cobro como persona natural a clientes con acuerdos recurrentes. Flag en `workspaces.modules.cobros_recurrentes=true`.

**Datos:**
- `cuentas_cobro_emitidas` — espejo PDF de cuentas mensuales agrupadas por empresa pagadora. Numeracion `CC-YYYY-MM-NNN` via function `generate_cuenta_cobro_numero` con advisory lock por workspace+anio+mes. Estados: borrador → emitida_pendiente_aprobacion → aprobada_lista_envio → enviada → pagada → conciliada. Idempotencia: 1 cuenta por (workspace, anio, mes, empresa_pagadora)
- `planillas_pila_periodo` — planilla PILA del titular (persona natural). 1 por mes por workspace. Se referencia automaticamente desde cuentas del mismo periodo
- `planes_cobro.concepto_detalle_template` — columna nueva. Template del detalle con placeholders `{numero_cuota}` y `{total_cuotas}`
- Migrations: `20260518000001_cuentas_cobro_emitidas` + `20260518000002_modules_cobros_recurrentes` + `planes_cobro_concepto_detalle` + `rename_año_to_anio` (4 aplicadas remoto)

**Logica core:** `src/lib/cobros/generar-cuentas-cobro.ts`
- `generarCuentasCobroPeriodo(supabase, workspaceId, anio, mes, options)` — agrupa cobros programados del periodo por `empresa_id` (no negocio_id) → arma payload → llama metrik-pdf-render → sube PDF a subcarpeta `4. Cuentas de cobro` del negocio principal → inserta cuenta → notifica owner
- Helpers: `format.ts` (formatCOP, formatFechaLetras, numeroALetras, montoEnLetrasCOP), `emisor-mauricio.ts` (constantes verificadas), `pdf-render-client.ts` extendido con `renderCuentaCobro`
- Idempotencia full: skip si ya existe cuenta para empresa+periodo

**Cron:** `procesar-planes-cobro` extendido — el dia 15 dispara `generarCuentasCobroPeriodo` para cada workspace con flag activo, ademas de generar cobros programados normal

**UI nueva (3 superficies):**
1. `/cobros-recurrentes` — modulo en sidebar Extras (condicional a flag). Listado tipo `/movimientos` con stats + filtros por estado y anio. Drawer detalle con preview PDF
2. `/mi-negocio` → seccion "Planilla PILA" (condicional a flag) — 12 cards por mes con upload PDF/PNG. Estados: vacio / cargado / vencido / mes_futuro
3. Bloque embebido cuentas-cobro en negocio — **DEFERRED** (Task #22)

**Template PDF:** `metrik-pdf-render/templates/metrik/cuenta-cobro.html` parametrizable + `assets/firma-brallan-mauricio.png` (firma transparente como asset local — WeasyPrint resuelve `<img src="assets/...">` con base_url). Endpoint nuevo `POST /render/cuenta-cobro` en `app.py` con `is_draft` flag para watermark

**Estructura Drive (workspace.drive_folder_id como fallback de linea — fix nuevo en `crearNegocio`):**
```
{workspace_root}/  (ej. MéTRIK/Negocios = 1Dn2MkGAc07dO_2iNxpYUJ8bHVEji2g-5)
└── {codigo} - {empresa} - {nombre_negocio}/
    ├── 1. Legal/
    ├── 2. Documentos del cliente/
    ├── 3. Entregables/
    ├── 4. Cuentas de cobro/    (PDFs cuentas mensuales)
    └── 5. Soportes de pago/
```

### Bug fix: `crearNegocio` fallback workspace para drive_folder_id

Antes: si la linea era plantilla-global (workspace_id NULL), `crearNegocio` no creaba carpeta Drive porque solo leia `lineas.drive_folder_id`. Workspaces como `metrik` que usan lineas-plantilla globales tenian negocios sin carpeta. **Fix (negocio-v2-actions.ts:652-672):** fallback `workspaces.drive_folder_id` cuando linea no lo tiene. Aplica a TODOS los workspaces que usen lineas-plantilla globales. Detalle: `cerebro/reglas/drive-folder-fallback-workspace.md`

### Aprendizajes nuevos para ONE

- `cerebro/errores/columnas-postgres-unicode-rompen-supabase-js.md` — columnas Postgres con caracteres unicode (`año`, `ñ`) rompen el TS parser de supabase-js. Convencion: ASCII puro (`anio`). Aplicado a 2 tablas nuevas
- `cerebro/errores/postgres-rename-columna-con-function-dependiente.md` — `CREATE OR REPLACE FUNCTION` no permite cambiar parametros. Si rename columna implica rename parametro, hay que `DROP FUNCTION` primero

### Estado al cierre (pendientes para proxima sesion)

1. **`gcloud auth login`** (Mauricio, interactivo)
2. Deploy metrik-pdf-render a Cloud Run con `templates/metrik/cuenta-cobro.html` nuevo
3. Verificar env vars Resend + agregar dominio `metrik.com.co` en Resend dashboard (DKIM/SPF en DNS Vercel)
4. UI aprobacion + envio via Resend (Fase 9)
5. QA E2E mayo 2026 retroactivo (caso real SOENA $1.750.000 + AFI agrupada $816.667)
6. Bloque embebido cuentas-cobro-negocio (Task #22, deferred)

---

### Sesion previa: 2026-05-13 → 2026-05-15 (`wmc` — template cotizacion WMC + Fase 1 metrik-pdf-render serverless + Fase 2 integracion ONE + platform_admin switcher + landing /numeros)
**Branch:** main · 4 commits ONE (`5e5ddb0`, `930e0a8`, `caef1e5`, `6f790df`) + 1 repo nuevo (`bi-metrik/metrik-pdf-render`)

### Trayectoria de la sesion

Empezo construyendo template oficial WMC para cotizaciones (proyectos/wmc/_templates/cotizacion-wmc/) — formato visual aprobado por Ren, Powered by MéTRIK §10-§11 corregido. Migracion render engine de Chrome --print-to-pdf a WeasyPrint resolvio paginacion proper (running headers/footers + page counters via CSS Paged Media). Cotizacion final AR Construcciones generada y enviada por Julian.

Continuo levantando el servicio Cloud Run + integrandolo a ONE — para que Julian (y cualquier workspace futuro) pueda exportar cotizaciones desde el negocio en formato propio de su marca.

### Servicio metrik-pdf-render (repo nuevo `bi-metrik/metrik-pdf-render`)

- Flask + WeasyPrint + Gunicorn, dockerizado para Cloud Run
- Endpoint `POST /render/cotizacion` recibe `{template_slug, data}` y retorna PDF
- Templates HTML versionados en repo: `templates/wmc/cotizacion.html` (validado) + `templates/metrik/` (stub, fase 3)
- Auth dual: IAM Cloud Run (ID token via SA `one-pdf-render-client@metrik-pdf-render.iam.gserviceaccount.com`) + shared secret `X-MeTRIK-Secret` a nivel app
- Deploy: GCP project `metrik-pdf-render` billing MéTRIK ONE, region `us-east1`, **Cloud Run free tier perpetuo** ($0/mes confirmado para nuestro volumen — 2M reqs/mes, 360K vCPU-s/mes)
- URL: `https://metrik-pdf-render-1003919073039.us-east1.run.app`
- Smoke test EN VIVO: HTTP 200, 183KB PDF, **1.26s** sin cold start adicional vs local
- Override de 2 org policies a nivel proyecto: `iam.disableServiceAccountKeyCreation` (permite key json para Vercel) + Mauricio elevo `roles/orgpolicy.policyAdmin` en org `metrik.com.co`

### Fase 2: integracion ONE (commit `5e5ddb0`)

- Migration `20260515000001_pdf_render_serverless.sql` — agrega 6 columnas a `cotizaciones` (`lugar_entrega`, `tiempo_entrega`, `anticipo_pct`, `anticipo_terminos`, `saldo_terminos`, `observaciones_extra` JSONB) + `cotizacion_template_slug` en `workspaces`. Seedea WMC con template `'wmc'`
- `src/lib/pdf/pdf-render-client.ts` — cliente HTTP. Mintea Google ID token via JWT bearer flow + SA key (sin SDK googleapis). Cache de token. `isPdfRenderConfigured()` para feature flag
- `cotizacion-pdf-actions.ts` refactorizado con dos paths:
  - **PATH A (WeasyPrint):** si env vars configuradas y workspace template_slug != 'metrik', llama servicio + auto-upload a Drive en subcarpeta `cotizaciones/` del negocio (find-or-create idempotente)
  - **PATH B (fallback):** @react-pdf/renderer existente sin cambios. Se usa si las env vars no estan o si workspace no tiene template custom
- Spec canonico: `docs/specs/2026-05-15_pdf-render-weasyprint-serverless.md`

### Platform admin switcher (commits `930e0a8`, `caef1e5`, `6f790df`)

Patron staff-MeTRIK multi-tenant — Mauricio + agentes pueden saltar a cualquier workspace para soporte sin credenciales del cliente, con audit log.

- Migration `20260515000002_platform_admin.sql` — `profiles.platform_admin` (bool) + `home_workspace_id` (uuid). Seed: Mauricio = TRUE
- `src/lib/actions/platform-admin.ts` — server actions `getPlatformAdminState`, `switchWorkspace(targetId)`, `returnHome()`. Audit log en `activity_log` tipos `platform_admin_enter` / `platform_admin_exit`
- `src/components/platform-admin-bar.tsx` — pill discreto + dropdown searchable en home / banner amarillo en workspace ajeno con CTA "Regresar"
- Integrado en `app-shell.tsx` (envuelve root en flex-col con bar arriba)
- **Bug encontrado y fixeado:** cookies host-only entre subdomains rompian el redirect post-switch. Fix: `switchWorkspace` y `returnHome` ahora generan magic link via `auth.admin.generateLink({type:'magiclink', email, redirectTo: 'https://<target>.metrikone.co/auth/callback?redirectTo=/numeros'})` y el cliente sigue el `action_link` para sembrar sesion en subdomain destino
- Landing post-switch: `/numeros` (Mis Numeros) directo, sin pasar por root con landing dinamico

### Pendientes manuales (NO en commits, requieren accion de Mauricio)

- Aplicar migrations `20260515000001` + `20260515000002` al remote Supabase (SQL editor o `db push`)
- Regenerar `database.ts` post-migration + re-agregar los 26 type aliases custom
- Set env vars en Vercel (Production scope):
  - `METRIK_PDF_RENDER_URL=https://metrik-pdf-render-1003919073039.us-east1.run.app`
  - `METRIK_PDF_RENDER_SECRET=<secret hex 32 bytes>` (en `/tmp/metrik-pdf-render-secret.txt`)
  - `METRIK_PDF_RENDER_SA_KEY=<SA key JSON inline>` (en `/tmp/one-pdf-render-client-key.json`)
- Verificar wildcard `https://**.metrikone.co/auth/callback` en Supabase Auth URL Configuration (para que magic link cross-subdomain funcione)
- Redeploy en Vercel para que tome env vars
- Kaori integrar credenciales metrik-pdf-render a `.credentials.md`

### Casts as any temporales

Hasta regenerar `database.ts` post-migration, hay casts `as unknown as` / `as any` en:
- `cotizacion-pdf-actions.ts` — campos nuevos de cotizacion (CotizacionNuevosCampos type local)
- `platform-admin.ts` — `platform_admin`, `home_workspace_id` en profile
- `app-shell.tsx` — sin casts pero requiere database.ts regenerado para tipar `cotizacion_template_slug` en workspaces select

---

**Sesion previa:** 2026-05-13/14 (one core: fix flujo invitaciones + activity-log toggle + extirpacion legacy pipeline/proyectos/nuevo-oportunidad)
**Branch:** main · 5 commits (`35ed64a`, `bc6378e`, `60ca389`, `5abd9c2`, `3016d1a`)

### Fix flujo invitaciones (commit `35ed64a`)

Repro AFI (Yessica): la invitacion solo insertaba en `team_invitations` sin disparar email. Al autenticar via link signup nativo (token_hash+type) cae a `/onboarding` en vez de `/accept-invite`.

- `team-actions.inviteTeamMember`: replica patron `staff-actions.ts` — llama a `serviceClient.auth.admin.inviteUserByEmail` con `redirectTo=/auth/callback?redirectTo=/accept-invite`. Fallback Resend con magic link cuando user ya existe en `auth.users` (422 / already registered). Upsert unifica re-invite (cambia rol + reinicia expires_at).
- `InviteInput.role` extendido a `owner | admin | supervisor | operator | read_only`. Owner-as-invite = transfer de ownership, gated por `profile.role === 'owner'`.
- `auth/callback/route.ts`: branch nuevo `token_hash + type` via `verifyOtp`. Helper `routeAfterAuth` deduplica routing post-auth entre PKCE y token_hash.
- `team-section` UI: ROLE_OPTIONS agrega supervisor + read_only, toggle separado "Transferir ownership" con `confirm()` y advertencia de degradado manual. Dropdown de cambio de rol incluye supervisor + read_only.

### Activity log — toggle eventos sistema (commits `bc6378e` + `60ca389`)

Mauricio pidio filtrar metadata del sistema (cambios de etapa/estado/precio/checklist/aprobaciones) sin tocar comentarios humanos.

- `activity-log.tsx`: boton "Solo comentarios" / "Mostrar todo (N)" alineado a la derecha del timeline con icono Filter
- Estado persistido en localStorage (key `activity-log:show-system`)
- **Default: eventos del sistema OCULTOS** — solo comentarios visibles al entrar
- Lazy init seguro (toggle solo aparece tras cargar entries, sin riesgo hydration mismatch)
- Empty state diferenciado: cuando se filtran todos, indica cuantos eventos del sistema estan ocultos

Componente compartido — el toggle aplica en `/negocios/[id]` (unico modulo activo tras extirpacion).

### Extirpacion legacy pipeline/proyectos/nuevo-oportunidad (commits `5abd9c2` + `3016d1a`)

Mauricio confirmo que `/pipeline` y `/proyectos` no se usan y que el flujo "crear oportunidad" no esta dentro del proceso vigente — todo entra como negocio. **-8319 lineas, una sola fuente de verdad.**

**Fase A.1 — rename catalogos (`5abd9c2`):** `lib/pipeline/` → `lib/catalogos/`. 16 imports actualizados via sed. El path se llamaba "pipeline" por historia pero contiene catalogos genericos (CATEGORIAS_GASTO, FUENTES_ADQUISICION, SECTORES_EMPRESA, TIPOS_PERSONA, REGIMENES_TRIBUTARIOS, ROLES_CONTACTO, ESTADO_COTIZACION_CONFIG, etc.) usados en 16 archivos fuera de las rutas legacy.

**Fase A.2+B — extirpacion (`3016d1a`):**

Movido a `negocios/`:
- `pipeline/[id]/cotizaciones/actions-v2.ts` → `negocios/cotizacion-actions.ts`
- `pipeline/[id]/cotizacion/[cotId]/cotizacion-editor.tsx` → `negocios/cotizacion-editor.tsx`
- `pipeline/pdf-actions.ts` → `negocios/cotizacion-pdf-actions.ts`

Extraido a `lib/actions/`:
- `addCobro` + `addHoras` → `lib/actions/cobros-horas-rapidos.ts` (sin dependencia de `/proyectos`, usados desde FAB `/nuevo/cobro` y `/nuevo/horas`)

Borrado:
- `src/app/(app)/pipeline/` completo (15 archivos)
- `src/app/(app)/proyectos/` completo (12 archivos)
- `src/app/(app)/nuevo/oportunidad/` completo (2 archivos)

Ajustes externos (todo apunta a `/negocios`):
- `middleware.ts`: `/pipeline` y `/proyectos` fuera de `protectedPaths`
- `facturacion/page.tsx`: redirect `/proyectos` → `/negocios`
- `equipo/page.tsx`: redirect no-permiso `/proyectos` → `/negocios`
- `numeros/drill-down-sheet.tsx`: "Ir a Oportunidades" `/pipeline` → "Ir a Negocios" `/negocios` (3 sitios). "Ver todas las facturas" `/proyectos` → "Ver todos los negocios" `/negocios`
- `directorio/empresas-list` + `directorio/contactos-list`: quickAction "Crear oportunidad" → "Crear negocio" apuntando a `/negocios/nuevo?empresa_id=X` o `?contacto_id=Y` (query params conservados para futuro prefill)
- `negocios/cotizacion-editor:173`: fallback URL `/pipeline/...` → `/negocios/...`

Validacion: `npx tsc --noEmit` limpio tras `rm -rf .next`. ESLint clean en archivos tocados (un error preexistente desde feb 2026 en `contactos-list.tsx:68` por `Date.now()` en render, fuera de scope).

### Sesion previa: 2026-05-12 (one core: tutorial in-app reusable para Valida en 3 surfaces + activacion canonica unificada)
**Branch:** main · 3 commits (`fcfba68`, `ec6c5cf`, `17a1fb2`)

### Tutorial in-app — motor reusable para futuros modulos

Construido como motor (no one-off para Valida) para servir tutoriales contextuales a cualquier modulo de ONE que requiera onboarding "para dummies". Aplicable a futuros candidatos: compliance core, negocios, planes recurrentes, revision.

Arquitectura 3 capas: empty state didactico (tarjeta "Comienza aqui" cuando historial vacio) + tour driver.js con boton "?" siempre visible + tooltips contextuales (Radix UI ya en stack).

Capa de datos:
- Tabla `tutorial_progress` (workspace_id + user_id + tutorial_slug UNIQUE, current_step, version, completed_at, dismissed_at) con RLS por workspace
- Vista `v_tutorial_adopcion` para metricas: tasas de inicio, completacion, descarte, completacion% por workspace+slug

Estructura codigo:
- `src/lib/tutorials/` — registry + _shared.ts (5 steps core) + un archivo por slug + types
- `src/components/tutorial/` — TutorialTour (driver.js wrapper) + TutorialEmptyState + TutorialButton
- `src/lib/actions/tutorial-progress.ts` — get / markStepComplete / markCompleted / markDismissed / reset

3 surfaces integradas:
- `/valida` (slug `valida_standalone`) — 7 steps: bienvenida, puntual, lectura, asociar negocio, historial, masiva, PDF
- `/compliance/validacion` (slug `valida_compliance`) — 5 steps core, sin masiva ni asociacion
- `/compliance/listas` (slug `compliance_listas_dual`) — 5 steps con copy neutral, NO menciona Valida ni Informa (UX transparente ALMA)

Auto-arranque condicional: primer render dispara tour si `current_step === 0 && !completed_at && !dismissed_at`. Re-trigger via boton "?" borra la row para reprogramar.

Versionado: cada tutorial tiene `version`. Subir version reactiva el tour para usuarios que ya lo completaron en version anterior.

Copy en TypeScript (no DB): versionable con el codigo, voz MeTRIK aplicada por Mateo en commit `ec6c5cf` (confiable, clara, sin promesas vacias, sin anglicismos).

Dependencia nueva: `driver.js` v1.4.0 (~16kb, MIT, tipos incluidos).

### Garantia operativa — activacion canonica de Valida

El script `scripts/setup-valida-workspace.ts` ahora unifica activacion end-to-end (commit `17a1fb2`):
1. Emite api_key con hash en metrik-valida + plana en `workspaces.config_extra.valida_api_key` (server-only)
2. Activa flag `modules.valida_consulta=true` para mostrar item en sidebar
3. Deja tutorial in-app listo para auto-arrancar en primer ingreso

Antes: solo emitia api_key. Ahora: tres elementos garantizados en un paso, sin posibilidad de drift entre flag y credencial.

**Prohibido activar `modules.valida_consulta` manualmente desde SQL.** Siempre via script. Detallado en gotcha "Activacion canonica del modulo Valida en un workspace".

### Origen

Reunion directiva /hana (proceso) + /noor (UX) + /max (tecnico) convocada por Mauricio. Mik sintetizo. Mauricio aprobo Opcion B (driver.js + tabla + 3-layer reusable) sobre alternativas A (reutilizar `/story-mode`) y C (mix sin libreria).

---

**Sesion previa:** 2026-05-11 (one core: modulo Valida activable por workspace + patron config_extra para credenciales per-workspace)
**Branch:** main · 1 commit (`bfbe9cb`)

### Modulo Valida — activable por workspace_modules

Nueva ruta `/valida` en ONE para workspaces que necesitan consulta SARLAFT directa contra metrik-valida. Distinto del flujo dual de ALMA (`/compliance/listas` con Informa transparente) y distinto de `/compliance/validacion` (Valida pura dentro del modulo compliance core). El item se renderiza en seccion "Extras" del sidebar inferior, separado de los modulos principales — para workspaces que NO tienen modulo compliance pero igual necesitan validar listas.

Activacion (3 pasos):
1. Migration 20260506100001 aplica + flag `modules.valida_consulta=true` en el workspace
2. Script `npx tsx scripts/setup-valida-workspace.ts <slug> "<nombre>"` emite api_key (hash en metrik-valida.api_keys, plana en `workspaces.{slug}.config_extra.valida_api_key`)
3. Sidebar muestra item "Valida" automaticamente al recargar (Extras > Valida con icono ShieldCheck)

Primer workspace que lo usa: AFI (workflow CDAs). Yessica consulta listas SARLAFT por cada CDA cliente, opcionalmente atando cada consulta a un negocio del workspace (incluye negocios cerrados — uso comun para CDAs ya implementados). XLSX masivo soporta columna `negocio_codigo` para mezclar varios negocios en un cargue.

Codigo:
- Migration `20260506100001_valida_consultas.sql` — tabla `valida_consultas` con `negocio_id` nullable + RLS por workspace + indices (workspace_id, negocio_id, created_at, lote_id, severidad)
- Migration `20260506100002_workspaces_config_extra.sql` — columna `workspaces.config_extra jsonb default '{}'` (ver gotcha mas abajo)
- Server actions `src/lib/actions/valida-consultas.ts` — puntual + masivo XLSX (mismo formato ALMA, hasta 500 filas) + historial con filtros + buscador negocios. Helper `getWorkspaceValidaApiKey` lee de `config_extra.valida_api_key` con fallback a env var `VALIDA_API_KEY` (compat ALMA hasta cleanup futuro)
- UI `src/app/(app)/valida/{page,valida-client}.tsx` — 3 tabs (puntual/masiva/historial), dropdown `NegocioPicker` reutilizable con buscador (NO filtra por estado), filtros completos historial. Marca: paleta MeTRIK pura (#1A1A1A, #6B7280, #10B981, #E5E7EB, #F5F4F2)
- Tab "Consultas Valida" en `/negocios/[id]` — `negocio-valida-section.tsx` se renderiza al final del detalle cuando workspace tiene flag activo. Reusa `HistorialTable` exportado del valida-client
- Sidebar `app-shell.tsx` — interface `valida_consulta?: boolean` agregada a `WorkspaceModules`. Nueva seccion "Extras" entre compartidos y admin con item "Valida". Roles: owner/admin/supervisor/operator/read_only
- Script `scripts/setup-valida-workspace.ts` — emite api_key per-workspace. Requiere env vars: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VALIDA_SUPABASE_URL`, `VALIDA_SUPABASE_SERVICE_ROLE_KEY`
- database.ts regenerado: 47 aliases preservados + `ValidaConsulta`. Build limpio en archivos nuevos

### Sesion previa: 2026-04-27 → 2026-05-04 (one core: refactor MC + EBITDA + capa fiscal + planes recurrentes + lineas MeTRIK + MC por linea)
**Branch:** main · 12 commits

### Refactor MC + EBITDA + capa fiscal (Fase A backend) — 535a31e

ONE deja de ser software contable. Perimetro hasta EBITDA. Cash basis puro. Eliminado flujo causacion formal (PUC, retenciones JSONB, estados PENDIENTE/APROBADO/CAUSADO/RECHAZADO) → reemplazado por flag binario `revisado` para contador.

4 migraciones:
- `20260427100001_clasificacion_costo` — taxonomia variable/fijo/no_operativo + tabla mapeo + trigger default + backfill
- `20260427100002_simplificar_fiscal` — DROP causaciones_log + 14 columnas fiscales + retencion NUMERIC simple + recreadas v_proyecto_financiero y v_proyecto_rubros_comparativo sin filtro estado_causacion
- `20260427100003_revisado_flag` — revisado/revisado_at/revisado_por en gastos+cobros
- `20260427100004_v_mc_negocio_v_pyl_mes` — vistas MC auditable y PyL mensual con EBITDA

Refactor codigo: `causacion/` → `revision/`, 30+ archivos limpios, roles renombrados (canCausar/canApproveCausacion → canMarcarRevisado/canViewRevision/canExportRevision), middleware + accept-invite + sidebar actualizados.

### Fase B (UI) — 5 commits

- B.1 (a214f8b): FiscalDisclaimer aprobado por Emilio en /revision /movimientos /nuevo/gasto /nuevo/cobro /numeros drill-down P2 + toggle clasificacion (variable/fijo/no_operativo) en form gasto + campo retencion en gasto y cobro
- B.2 (2f9051c): panel /revision real con bandeja interactiva, filter pills, mes selector, marcar/desmarcar revisado optimistic
- B.3 (2dc5544): tile MC% + EBITDA en /numeros, drill MC por negocio top-5, copy "Margen efectivo" → "Margen de contribucion"
- B.4 (fa967ca): export CSV/XLSX desde /revision via /api/revision/export, 3 hojas (Resumen, Cobros, Gastos)
- B.5 (f83f09a): cleanup config_financiera.margen_* + filtro Clasificacion en /movimientos + badge inline

### Fix critical post-Fase B (c749daa)

`revisado` deja de filtrar calculos operativos. BloqueCobros, BloqueHistorial, totalCobrado en negocio detalle suman todos los cobros confirmados (`fecha IS NOT NULL`). Flag `revisado` queda exclusivo para bandeja /revision y export al contador. Bug detectado en auditoria post-Fase B: SOENA y demos mostraban $0 cobrado porque cobros pre-refactor quedaron `revisado=false` por default.

### Planes de cobro recurrentes (3 fases)

- **Fase 1 datos + cron** (9b9499e): tabla `planes_cobro` (negocio_id NOT NULL, monto, frecuencia, fecha_inicio, fecha_fin obligatoria, total_cuotas, pasarela wompi/manual/mixto, auto_renovar, activo), cobros tipo `programado` con `plan_cobro_id`/`numero_cuota`/`fecha_esperada`/`vencido`, trigger cierre auto-plan, cron `procesar-planes-cobro` 12:00 UTC, tipo notificacion `cobro_vencido` a 3 destinatarios (responsable + owner + staff `area=admin_finanzas`)
- **Fase 2 UI** (3afe283): `BloquePlanRecurrente` con form completo + preview + auto-renovar opcional + advertencia Wompi pendiente; server actions crearPlanRecurrente/confirmarCobroProgramado/cancelarPlan; BloqueCobros refactor con secciones Programados/Confirmados + boton "Confirmar pago manual"; bloque registrado en catalogo admin/workflows
- **Fase 3 lineas MeTRIK** (6391525): `MeTRIK ONE` (4 etapas: Prospecto → Contrato → Plan activo → Cierre) y `MeTRIK Resident` (6 etapas: Discovery → Propuesta → Contrato → Onboarding → Vigente → Cierre) creadas en workspace MeTRIK con bloques apropiados por etapa

### Decision directiva — Naming Resident

Debate Mateo (CMO) vs Santiago (CCO): Steady vs Resident. Mauricio aprobo **Resident** por escalabilidad de la convencion "[Especialista] Resident" (Oficial Cumplimiento Resident, BI Resident, Analista Financiero Resident). "Recurrente" se preserva como flag interno tipo_negocio, no como nombre comercial. Cerebro actualizado: `lineas-de-negocio.md` (4→5 lineas), `2026-05-04_linea-resident-naming.md`, `resident-como-servicio.md`.

### MC por linea (decision Carmen + Mauricio)

3 buckets revenue canonicos:
- **Service revenue** = Clarity + Projects + Analytics (discrete)
- **ARR ONE** = ONE software (recurrente sin costo marginal)
- **ARR Resident** = Resident servicio (recurrente con costo de especialista)

Excepcion: Clarity con financiacion a cuotas (caso SOENA) NO se reclasifica — sigue siendo Clarity discrete con plan de pago.

Implementado (c56f9e7):
- Migracion `20260504100003_v_mc_linea_mes` — vista que agrupa ingresos+variables por workspace+mes+linea_id, bucket "Sin linea" cuando linea_id IS NULL
- `numeros/actions-v2.ts` — tipo `McLinea`, query a `v_mc_linea_mes`, campo `mcLineas` en `NumerosData`
- Drill-down P2 — nueva seccion "MC por linea (mes actual)" antes de top-5 negocios. Bucket "Sin linea (costos no asignados)" en italico gris para visibilizar costos sin imputar

Decisiones operativas:
- Costos variables sin negocio → bucket "Sin linea" visible (no se prorratean)
- MC global y MC por linea coexisten
- Especialista Resident con gastos imputados a negocio = variable a linea Resident; sin imputacion = fijo de empresa

### Cleanup migracion config_financiera

Migracion `20260428100001` DROP columnas margen_contribucion_estimado/calculado/fuente/n_proyectos_margen + actualizada UI mi-negocio (MargenContribucionSection ahora read-only informativa).

**Migraciones aplicadas:** 20260427100001-100004, 20260428100001, 20260504100001-100003 (8 nuevas)
**database.ts:** regenerado 4 veces, 40 aliases preservados cada vez. Vistas v_mc_negocio, v_pyl_mes, v_mc_linea_mes registradas.

### Auditoria post-deploy

Workspaces con data: SOENA (15 movimientos productivos), DIMPRO (55 gastos), altavista-demo, ana-demo, MeTRIK propio, wmc-sm, AFI (vacio fiscal). Todos los workspaces afectados por el refactor — schema y codigo aplican a todos.

### Trabajo paralelo workspace AFI (commits c5555cf, 6128db6, 4d65d70)

En paralelo al refactor MC+EBITDA, se construyo el motor de contrato modular para el workspace AFI. Aporta 3 features genericos al producto que sirven a cualquier workspace Clarity:

**1. BloqueDatos extendido con 3 tipos genericos nuevos:**
- `radio` — botones excluyentes con opciones tipadas
- `documentos_preview` — lista en vivo (panel verde) los archivos a generar segun seleccion del bloque
- `showIf` — propiedad por field para renderizado condicional en funcion de otro field (ej: sub-opcion que solo aparece si toggle padre activo)

Aplica a cualquier bloque tipo `datos` con `config_extra.fields[]`. El componente filtra fields con `visible(f, values)` antes de renderizar tanto en modo editable como visible.

**2. Patron de hook dual en `negocio-v2-actions.ts`:**
El server action `marcarBloqueCompleto` ahora detecta multiples bloques accionables ("Generar paquete" y "Generar contrato" en workspace afi) y retorna flags como `trigger_afi_generation` o `trigger_afi_contrato` para que el cliente dispare el endpoint correspondiente. Patron extensible a cualquier "bloque de accion server-heavy" donde el motor no puede correr en server action por `maxDuration` y necesita route handler.

**3. Image module respeta aspect ratio del logo:**
`src/lib/afi/docx-engine.ts` ahora incluye parser inline para PNG/JPEG que lee dimensiones reales del logo del cliente y escala dentro de bbox 130x60 px (~3.4 x 1.6cm). Mantiene forma original sin deformar. Sin nuevas dependencias.

**Codigo especifico AFI** (no migra a producto, vive en `src/lib/afi/`):
- `contrato-engine.ts` — motor compositor del DOCX con docxtemplater section tags `{{#FLAG}}...{{/FLAG}}` (13 flags + 22 placeholders)
- `generar-contrato.ts` — orquestador (lee bloques, descarga master, sube a Drive)
- `/api/afi/contrato/[negocio_id]` — endpoint POST con maxDuration=60
- `template-mapping.ts` extendido — `sarlaft_regimen` ('ampliado'|'simplificado'|'ninguno') + ptee + oficial + seguimiento, con `templatesAGenerar` backwards-compatible al schema legacy + `TEMPLATE_NAMES` catalogo legible

## Estado actual (2026-05-04)

- **Branch:** main — produccion en Vercel (auto-deploy)
- **Cash basis confirmado:** ONE perimetro hasta EBITDA. Cobros confirmados = ingresos del mes. Sin accrual.
- **Flag revisado:** binario, exclusivo para bandeja /revision y export. NO afecta calculos operativos (saldo negocio, BloqueCobros, totalCobrado, MC, EBITDA)
- **Causacion → Revision:** ruta /causacion eliminada; /revision activa con bandeja interactiva, filter pills, descarga mes (xlsx/csv), permisos canMarcarRevisado/canViewRevision/canExportRevision. Sidebar muestra "Revisión" para owner/admin/contador
- **Clasificacion costo gastos:** variable/fijo/no_operativo. Trigger DB aplica default segun categoria. Form de gasto pide explicitamente al registrar. Backfill historico aplicado: gastos con negocio_id → variable, resto segun mapeo categoria
- **Retencion en gastos y cobros:** NUMERIC simple (patron DIMPRO). ONE no calcula retenciones — el contador del cliente las registra si las necesita
- **MC + EBITDA en /numeros:** tile principal MC% + EBITDA del mes desde v_pyl_mes. Cash basis puro. Drill P2 muestra MC global, MC por linea, MC por negocio top-5
- **MC por linea:** vista v_mc_linea_mes con bucket "Sin linea" para costos variables sin negocio asignado. UI italico gris para visibilizar costos por imputar
- **Bucket revenue canonico:** Service revenue (Clarity + Projects + Analytics) / ARR ONE (software) / ARR Resident (servicio). Excepcion Clarity-financiado: NO se reclasifica
- **Lineas en workspace MeTRIK:** MeTRIK ONE (4 etapas, suscripcion SaaS post-Clarity) y MeTRIK Resident (6 etapas, servicios profesionales recurrentes). BloquePlanRecurrente en etapa Contrato de ambas
- **BloquePlanRecurrente:** captura monto + frecuencia (mensual/trimestral/anual) + fecha inicio + total cuotas + pasarela (wompi/manual/mixto) + auto_renovar opcional. Al completarse: crea registro planes_cobro + setea precio_aprobado del negocio + activa pausado=true motivo_pausa='plan_recurrente_activo'
- **Cron procesar-planes-cobro:** 12:00 UTC diario. Genera cobros programados con T+3 dias. Marca vencido tras 3 dias de gracia. Notifica cobro_vencido a responsable + owner + staff area=admin_finanzas
- **BloqueCobros:** muestra Resumen (Cobrado / Saldo) + Programados pendientes (con boton "Confirmar pago manual") + Confirmados. Vencidos resaltan en rojo. Saldo = precio_total - sum(cobros confirmados)
- **ConfidenceBadge:** % confianza IA se muestra en BloqueDocumento tanto editable como read-only (solo si `!campo.manual`)
- **Header /negocios/[id]:** titulo + selector de etapa sticky al scrollear (desktop + mobile)
- **Lint status:** 28 issues restantes — TODOS react-hooks. Cero no-explicit-any, cero no-unused-vars. Fase 4 pendiente
- **database.ts:** regenerado 4 veces durante el refactor, 40 aliases preservados, vistas v_mc_negocio + v_pyl_mes + v_mc_linea_mes registradas. NO revertir a `as any` casts en tablas estandar
- **Security linter Supabase:** 51 de 54 hallazgos cerrados. Pendientes low: 3 extensions en public, wa_message_log sin policy, leaked password protection
- **WhatsApp notificaciones:** Vercel SSO LIBERADO en metrik.com.co/privacidad — listo para cargar la pagina al webhook como primer mensaje. Cargar 10 templates a Meta + edge function `wa-notify` pendientes
- **Management API Supabase:** verificado que funciona con access token para ejecutar SQL arbitrario — fallback util cuando CLI falla por desync de migrations. Usado para todas las migraciones del refactor fiscal
- **13+ migraciones remotas desync:** pendiente `supabase migration repair --status reverted` + `db pull` para realinear. Las nuevas migraciones aplicaron via Management API (no via supabase db push)
- **Cotizaciones:** cantidad por item + AIU manual sobre costos + costo unitario visible. AIU oculto por defecto. Item de ajuste invisible en UI
- **Cronograma (B10):** fechas, responsable, preload, delete, re-evaluacion completitud — todo funcional
- **WhatsApp bot:** Edge functions desplegadas. Parser: Gemini 2.5 Flash-Lite + fast-path regex + defense layer. FOLLOWUP, ESTADO_NEGOCIOS, last_context con anafora, golden set 98/99
- **Workspace metrik:** sin datos fiscales, con 2 lineas configuradas (ONE + Resident) listas para crear primer negocio recurrente
- **Google OAuth:** Preparado en codigo, deshabilitado (`googleEnabled = false`) — pendiente credenciales
- **Workflow engine:** Activo en produccion
- **Estado MVP:** COMPLETO — fase go-to-market + Clarity tailor-made sobre ONE + lineas recurrentes (suscripcion SaaS y servicios Resident)
- **Modulo negocios:** Operativo. 13 tipos de bloques + plan_recurrente nuevo (B14). Pendiente critico SOENA: fix persona natural (empresa_id=NULL)
- **Gotcha negocios.estado:** Valores reales son `'abierto'` y `'completado'`, NO `'activo'`
- **Gotcha /negocios cerrados:** La page filtra `.in('estado', ['activo','abierto'])` — negocios completados NO se muestran. Pendiente agregar pill o filtro
- **Wompi:** integracion pendiente — Mauricio investigando si puede activar cuenta empresarial como persona natural transitoria. Webhook `wa-notify`-style para suscripciones recurrentes vendra en Fase 4 cuando exista cuenta
- **CRITICO — Modulo negocios reemplaza pipeline y proyectos:** `/negocios` es el flujo principal. `/pipeline` y `/proyectos` son legacy. Todo apunta a negocios: FAB, WhatsApp, gastos, KPIs, navegacion

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

## Sistema de codigos (empresas + negocios)

Formato estandar para IDs visibles al usuario. Generados automaticamente por triggers de PostgreSQL.

### Empresa: `{letra}{consecutivo}`
- Primera letra del nombre (uppercase) + consecutivo por letra dentro del workspace
- Ejemplos: `S1` (SOENA), `R1` (Roble), `M1` (Mirador), `T1` (TechVerde)
- Generado por trigger `empresa_auto_codigo` → funcion `generate_empresa_codigo()`
- Si multiples empresas empiezan con la misma letra: `C1`, `C2`, `C3`
- **Regla clave:** Al elegir nombre de empresa, preferir la primera letra mas distintiva/reconocible. Ejemplo: "Conjunto Residencial El Roble" → empresa.nombre = "El Roble" para que el codigo sea `R1`, NO `C1`
- Unique index: `(workspace_id, codigo)`

### Negocio: `{empresa_codigo} {YY} {consecutivo}` (con espacios)
- Ejemplo: `S1 26 3` = empresa S1 + ano 2026 + 3er negocio de esa empresa en el ano
- Generado por trigger `negocio_auto_codigo` → funcion `generate_negocio_codigo()`
- **Se almacena CON espacios en la columna `negocios.codigo`** — no hay transformacion en UI
- Para persona natural sin empresa: usa primera letra del nombre del contacto (`P 26 1`)
- Unique index: `(workspace_id, codigo)`

### Reglas criticas
- **NUNCA generar codigos manualmente en app code** — los triggers de DB los asignan en INSERT
- **NUNCA usar formatCodigo() o regex de display** — los codigos ya vienen con espacios desde DB
- Al seedear datos de demo, respetar el formato `{codigo_empresa} {YY} {N}` con espacios
- Si un codigo de empresa no es suficientemente distintivo (ej: dos empresas con C1, C2), renombrar la empresa para usar una letra diferente
- Funciones SQL: `generate_empresa_codigo()`, `generate_negocio_codigo()`, `generate_negocio_codigo_sin_empresa()`
- Migraciones de referencia: `20260406000001` (sistema base) + `20260407000001` (formato con espacios)

## Gotchas y convenciones

- **Referencias de bloque por `slug` estable (2026-06-12) — preferir slug, no nombre/orden.** El motor ahora soporta referenciar el bloque fuente por `bloque_configs.slug` (identidad estable, única por línea, inmune a rename/reorder). Campos nuevos en `config_extra`: `cross_check.checks[].source_bloque_slug` (+ en `source_alternatives`), `campos_fuente[].source.bloque_slug` (+ alternatives), `fields[].auto_fill.source_bloque_slug`, `fields[].doc_link.source_bloque_slug`, `condition.source_bloque_slug` (render cliente + gate SQL `condicion_cumplida` priorizan slug, con flattening de campos para paridad), y `source_bloque_slug` top-level en heredados readonly (paths `documento` por etapa::nombre y `propuesta_economica` por orden migrados; los `datos` readonly ya eran estables por `bloque_definition_id`). **Todos los consumidores priorizan el slug y caen al método legacy (nombre/orden) solo si la ref no trae slug** — retrocompatible. Heredados readonly tienen `slug=NULL` (apuntan a su origen). **Al configurar una ref nueva, usar el slug** (no el nombre). **Validar con `SELECT * FROM audit_block_slug_refs('<linea_id>') WHERE NOT ok;`** (unicidad de slug + que todo slug referenciado exista) — companion de `audit_workflow_refs`. Migrations producto `20260612000001` (columna) + `20260612000002` (audit). Backfill por línea es workspace-específico (`proyectos/<cliente>/<linea>/migrations/`). SOENA VE ya migrado (158 refs: 49 auto_fill + 10 cross_check + 55 campos_fuente + 20 condition + 24 readonly). Migrations producto `20260612000003` (condicion_cumplida branch slug). Spec: `docs/specs/2026-05-26_block-references-by-slug.md`. **El bug DC13 (cross-check vacío al renombrar un bloque) queda estructuralmente cerrado.**
- **Reordenar etapas (reorg) rompe referencias por `orden` — correr `audit_workflow_refs` despues.** El workflow encoda referencias cross-etapa por `etapa_orden` en `bloque_configs.config_extra` (7 clases: `source_etapa_orden` de herencia readonly, `condition.source_etapa_orden`, `fields[].auto_fill.source_etapa_orden`, `fields[].doc_link.source_etapa_orden`, `cross_check.checks[].source_etapa_orden`, `campos_fuente[].source.etapa_orden`, y `routing` en `etapas_negocio`). Insertar/reordenar etapas cambia `orden` pero **NO** recalcula esas referencias → quedan stale (apuntan a la etapa equivocada, leen datos vacios/incorrectos en silencio). **Despues de cualquier reorg:** `SELECT * FROM audit_workflow_refs('<linea_id>') WHERE NOT ok;` — devuelve cada ref stale + `donde_vive` (el orden correcto). Vacio = sano. Migration `20260602000003`. Nota: `etapas_negocio.numero` es el identificador ESTABLE (no cambia al reordenar); las referencias por orden son la deuda. La capa de slug (gotcha de arriba) es la vía robusta preferida y ya cubre las 7 clases en SOENA VE (incl. `condition` y herencia readonly); `source_etapa_orden` queda solo como fallback legacy para líneas no migradas. **Al escribir codigo que lea datos cross-bloque, preferir el slug; si la ref es legacy, resolver por NOMBRE de bloque (ignorando heredados con `config_extra.source_etapa_orden`), no por orden de etapa** — patron en `guia-devolucion-actions.ts` y el preview `guia_devolucion` de `negocio-v2-actions.ts`.
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
- **`workspaces.config_extra` (jsonb, server-only):** Columna agregada el 2026-05-11 para almacenar credenciales y configs por workspace que NO deben llegar al cliente. **Cuando se activa:**
  1. **Solo cuando un modulo opcional necesita credenciales server-side per-workspace** (no globales en env var). Ejemplo canonico: `valida_api_key` y `valida_cliente_id` para que cada workspace consuma metrik-valida con su propia api_key emitida en lugar de compartir una env var unica
  2. **NO** se usa para flags booleanos de modulo (eso vive en `workspaces.modules`)
  3. **NO** se usa para datos visibles al cliente (logo, colores, nombre — esos tienen columnas dedicadas)
  4. **NO** se usa para parametros de UI o features togglables (eso vive en `proyecto_modules` o `modules`)
  5. **Acceso:** SOLO via service_role en server actions. Nunca se selecciona desde el cliente. Helper pattern: `await svc.from('workspaces').select('config_extra').eq('id', workspaceId).single()` + leer la key necesaria
  6. **Default:** `{}`. Cualquier workspace sin config tiene jsonb vacio
  7. **Patron de escritura:** scripts admin como `scripts/setup-valida-workspace.ts` que emiten credencial + persisten + entregan plana una sola vez para `.credentials.md`. NUNCA escribir desde server action en producto ONE — siempre via script admin con review explicita
- **Activacion canonica del modulo Valida en un workspace:** correr `npx tsx scripts/setup-valida-workspace.ts <slug> "<nombre>"`. El script garantiza en un solo paso: (1) emite api_key con hash en metrik-valida + plana en `workspaces.config_extra.valida_api_key`, (2) activa flag `modules.valida_consulta=true` para que el item aparezca en sidebar, (3) deja el tutorial in-app listo para auto-arrancar en primer ingreso de cada usuario (no requiere accion adicional). **NO activar el flag manualmente desde SQL** — siempre via script para que api_key y flag queden consistentes
- **Google Drive OAuth per-workspace + Shared Drives (`src/lib/google-drive.ts`):** Helpers (`createDriveFolder`, `uploadFileToDrive`, `setFilePublicByLink`, `downloadDriveFile`, `deleteDriveFile`) aceptan `workspaceId?: string` como ultimo parametro opcional. `getAccessToken(workspaceId?)` selecciona la triple OAuth a usar:
  - **Per-workspace** (preferido): si `workspaces.config_extra` tiene los TRES campos `drive_refresh_token` + `drive_client_id` + `drive_client_secret`, usa ese OAuth. Caso canonico: workspace AFI cuyo Drive es la Shared Drive del cliente (CDA, drive_id `0ALAKHcpyVsDDUk9PVA`). Yessica autorizo Drive scope desde su cuenta `yessica.vasquez@afiinternationalgroup.com.co` contra el OAuth client de MeTRIK (GCP `MeTRIK-cloud`).
  - **Fallback global** (cuenta `mauricio.moreno@metrik.com.co`): env vars `GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN`. Aplica si no hay `workspaceId` o si el workspace no tiene credenciales propias en `config_extra`. Sigue siendo el path de SOENA, DIMPRO y demos.
  - **Credenciales incompletas:** si `config_extra` tiene solo ALGUNOS de los tres campos `drive_*`, lanza error claro (`Workspace {slug}: credenciales Drive incompletas`). Evita debugging silencioso.
  - **Token cache por workspace:** `Map<cacheKey, {token, expiresAt}>`. Key `__global__` para el path env-var, `ws:{id}` para per-workspace. No hay leak entre workspaces.
  - **Soporte Shared Drives:** TODAS las requests pasan `supportsAllDrives=true`; las que listan/buscan tambien `includeItemsFromAllDrives=true` + `corpora=allDrives`. Sin estos params los CRUD en Shared Drives fallan silenciosamente o con 404 enganosos.
  - **`setFilePublicByLink` con 403:** en Shared Drives con restriccion de permisos externos esta operacion puede fallar con 403. El helper hace downgrade a warning y retorna void en lugar de crashear el flujo (el archivo ya fue subido). El link puede compartirse via permisos del Shared Drive.
  - **Keys auxiliares en `config_extra`:** `drive_shared_drive_id` (informativo, util para listings de la Shared Drive); `drive_gcp_project` (informativo, e.g. `MeTRIK-cloud`).
  - **Callers que pasan workspaceId:** `crearNegocio` (negocio-v2-actions), `generarContratoAFI`, `disparararGeneracionAFI`, `generarFormulario` (formulario-actions), `procesarDocumento`/`reprocesarDocumento` (documento-actions). En server actions que no exponen workspaceId directo, derivarlo desde el negocio (`SELECT workspace_id FROM negocios WHERE id = $1`).
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
- [x] Cobros automaticos desde bloques datos — anticipo + multi-pago ePayco — sesion G 2026-04-07
- [x] BloqueCobros visible todo el ciclo como solo lectura — sesion G 2026-04-07
- [x] Boton confirmar anticipo (require_confirm pattern) — sesion G 2026-04-07
- [x] BloqueDocumentos auto-complete fix (React setState timing) — sesion G 2026-04-08
- [x] Migraciones 011-015 aplicadas en produccion — sesion G 2026-04-07
- [x] BloqueHistorial (visualizacion gastos/horas/cobros con tabs) — sesion H 2026-04-09
- [x] KPI numeros: filtro estado 'abierto' + renombrar Pipeline → En venta — sesion H 2026-04-09
- [x] Limpieza completa workspace metrik para demo — sesion H 2026-04-09
- [x] Mejorar flujo WhatsApp: FOLLOWUP, ESTADO_NEGOCIOS, last_context, anáfora — completado 2026-04-12
- [x] Fix cronograma fechas no persistian — INSERT atomico en agregarBloqueItem — completado 2026-04-17
- [x] Cotizacion: cantidad por item + AIU manual sobre costos + costo unitario visible — completado 2026-04-17
- [x] Cotizacion: 5 ajustes UX (Carmen/Hana/Noor) — AIU oculto, ajuste invisible, grid responsive — completado 2026-04-17
- [x] Modulo compliance: riesgos + causas + controles + matriz — UI completa con CRUD, import/export, permisos por rol — completado 2026-04-17
- [x] Controles reestructurados: entidad independiente M:N con causas via control_causa junction — completado 2026-04-17
- [x] Matriz 5x5 compacta: max-w-lg, celdas h-9, labels 8-10px — completado 2026-04-17
- [x] Header /negocios/[id] sticky al scrollear — completado 2026-04-18
- [x] Fix BloqueAprobacion no refrescaba UI tras decision — completado 2026-04-18
- [x] Security linter Fase 1: 4 fixes criticos (RLS, SECURITY DEFINER, bucket listing, policy permisiva) — completado 2026-04-18
- [x] Security linter Fase 2: 46 funciones con search_path mutable fixed — completado 2026-04-18
- [x] Docs wa-templates.md: 10 templates listos para Meta Business Manager — completado 2026-04-18
- [x] **Fix flujo invitaciones equipo** — completado 2026-05-13 (commit 35ed64a). Email real via auth.admin.inviteUserByEmail + branch token_hash + roles owner/supervisor/read_only + toggle "Transferir ownership"
- [x] **Activity log toggle eventos sistema** — completado 2026-05-13 (commits bc6378e + 60ca389). Default solo comentarios, localStorage persist
- [x] **Extirpar pipeline/proyectos/nuevo-oportunidad** — completado 2026-05-14 (commits 5abd9c2 + 3016d1a). -8319 lineas, todo apunta a /negocios
- [ ] **QA online invitaciones equipo:** 3 escenarios — (1) invitar nuevo admin → email Supabase → /accept-invite → /numeros, (2) re-invite cambiando rol antes de aceptar, (3) toggle "Transferir ownership" → confirm → invitado acepta como owner
- [ ] **Pre-fill `/negocios/nuevo`:** leer searchParams empresa_id/contacto_id en page.tsx + pasar como initial props al form. Query params ya llegan desde Directorio empresas/contactos
- [ ] **Verificar legacy /nuevo/cobro y /nuevo/horas (FAB):** apuntan a tablas facturas y proyectos que pueden estar dormidas. Si no hay UI activa que renderice esos registros, sumar a extirpacion
- [ ] **Hana:** actualizar mapa de procesos — el flujo "crear oportunidad" se elimino del catalogo. Todo entra como Negocio
- [x] **WA notificaciones:** liberar Vercel SSO en metrik.com.co/privacidad — completado 2026-04-28
- [ ] **WA notificaciones:** validar que politica tratamiento menciona WhatsApp + telefono + opt-out (Emilio)
- [ ] **WA notificaciones:** cargar los 10 templates a Meta Business Manager (Yuto, post bloqueadores)
- [ ] **WA notificaciones:** construir edge function `wa-notify` + trigger SQL en tabla notificaciones + flow opt-in en primera interaccion (Max, post aprobacion Meta)
- [x] **Refactor MC + EBITDA + capa fiscal Fase A backend** — completado 2026-04-27 (commit 535a31e)
- [x] **Refactor Fase B UI completa** (5 sub-fases) — completado 2026-04-27 (commits a214f8b → f83f09a)
- [x] **Fix bug revisado en calculos operativos** — completado 2026-04-27 (commit c749daa)
- [x] **Planes recurrentes Fase 1 datos + cron** — completado 2026-05-04 (commit 9b9499e)
- [x] **Planes recurrentes Fase 2 BloquePlanRecurrente + UI cobros programados** — completado 2026-05-04 (commit 3afe283)
- [x] **Planes recurrentes Fase 3 lineas MeTRIK ONE + Resident** — completado 2026-05-04 (commit 6391525)
- [x] **MC por linea (decision Carmen + Mauricio)** — completado 2026-05-04 (commit c56f9e7)
- [x] **Cleanup config_financiera.margen_* legacy** — completado 2026-04-28 (commit f83f09a)
- [ ] **Planes recurrentes Fase 4 — webhook Wompi:** pendiente activacion cuenta empresarial Wompi (Mauricio investigando si se puede como persona natural transitoria). Edge function `wompi-webhook` para suscripciones recurrentes + mapeo `referencia_wompi` → `plan_cobro` (Max + Yuto)
- [ ] **Carmen (cerebro):** actualizar `cerebro/reglas/modelo-financiero-mrr-one.md` con regla hibrida 3 buckets revenue (Service / ARR ONE / ARR Resident) + excepcion Clarity-financiado + 3 decisiones MC por linea (Sin linea visible, MC global+linea coexisten, Resident variable a linea)
- [ ] **Mateo:** pieza de comunicacion para diferenciar Resident de ONE en pitch comercial
- [ ] **Santiago:** validar pricing y permanencia minima al cerrar primer contrato Resident
- [ ] **Auditoria SOENA:** validar que el saldo del flujo VE muestra correcto el cobrado real con cobros pre-refactor (`revisado=false` en historicos pero el fix c749daa ignora ese filtro). Revisar BloqueCobros y BloqueHistorial en negocio activo
- [ ] **Auditoria DIMPRO:** validar `/movimientos` con badge clasificacion + filtro nuevo en 55 gastos historicos
- [ ] **Security low:** mover extensions unaccent, pg_trgm, pg_net fuera de public
- [ ] **Security low:** policy explicita para wa_message_log o documentar como service-role-only
- [ ] **Security low:** activar Leaked Password Protection en Supabase Auth dashboard
- [ ] **DevOps:** supabase migration repair + db pull para realinear 13 migraciones remotas
- [ ] **CRITICO:** Persona natural debe crear empresa automaticamente en `crearNegocio` (ver workspaces/soena/CONTEXT.md para detalle)
- [ ] **SOENA:** Pendientes criticos en `workspaces/soena/CONTEXT.md` — incluye bloque `devolucion_dian` + storage + generacion docs
- [ ] **INTEGRAR (sesión SOENA 2026-04-12):** Commit `c51d246` agrega 2 features genéricos al producto que deben validarse: (1) `source_etapa_orden` en routing eval de `cambiarEtapaNegocioConGate` — permite leer campos de bloques datos de una etapa distinta a la actual, backward compatible (si no se pasa, lee etapa actual como antes); (2) `DatosField.default` en `BloqueDatos.tsx` — permite inicializar toggles con valor distinto de false. Ambos ya están en producción via SOENA. Revisar y documentar como features de producto si se validan correctos
- [x] **PENDIENTE:** Regenerar `database.ts` types tras migraciones 011-015 y quitar `as any` casts de cobros — completado 2026-04-18
- [ ] **Lint Fase 4:** 28 issues de react-hooks pendientes (set-state-in-effect, purity, exhaustive-deps, static-components, immutability, refs) — requieren análisis por feature
- [ ] **PENDIENTE:** /negocios no muestra cerrados — agregar pill "Cerrados" con filtro server-side en getNegociosV2
- [ ] **PENDIENTE:** Commitear 34 archivos uncommitted (WA bot + AFI compliance + SOENA) — split por tema
- [x] ID negocio formato `S1 26 3` — triggers auto-generan codigos, documentado en seccion "Sistema de codigos" — completado 2026-04-09
- [x] Responsable en header de etapa — selector con avatar+nombre, dropdown filtrable, permisos owner/admin/supervisor — completado 2026-04-17
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
| 2026-04-05 | ID negocio: `{empresa_codigo} {YY} {consecutivo}` con espacios | Formato final aprobado: S1 26 3. Triggers DB auto-generan. Empresa codigo = primera letra + consecutivo. Elegir nombre empresa con letra distintiva |
| 2026-04-05 | Header negocio: jerarquia 4 filas segun spec Noor | nav / titulo+accion / empresa+contacto+precio / carpeta+linea / progreso. Pendiente de implementar. Spec: empresa y contacto juntos (misma relacion), precio prominente a la derecha |
| 2026-04-05 | Modulo negocios opera en contexto degradado: priorizar sesion limpia | La sesion D acumulo muchos fixes encima. Proxima sesion debe empezar con brief quirurgico de los 2 criticos SOENA |
| 2026-04-06 | Persona natural = empresa automatica en crearNegocio | Regla de negocio original: PN es su propia empresa. El fix migration 004 fue incorrecto (usa contacto como base del codigo). Correcto: crear empresa con nombre del contacto y asignar empresa_id |
| 2026-04-06 | Sesion E ejecutada con Sonnet 4.6 — resultados degradados | Multiples errores de contexto y logica de negocio. Proximas sesiones de desarrollo complejo: usar Opus 4.6 |
| 2026-04-06 | BloqueDocumentos: upload real reemplaza inputs de URL | Patron copiado de ve-documentos-section. Bucket ve-documentos, path workspace/negocios/negocioId/bloqueId/slug.ext |
| 2026-04-06 | Gate comentario: config_extra.gates en etapas_negocio | Array de strings configurables por etapa. 'comentario_requerido' verifica activity_log antes de avanzar. Extensible para otros gates futuros |
| 2026-04-07 | Cobros automaticos desde bloques datos, nunca manuales | Anticipo (etapa 2) y multi-pago (etapa 7) crean cobros via triggers en config_extra. Cada cobro entra PENDIENTE con checkbox validacion |
| 2026-04-07 | Saldo = precio_total - sum(cobros), nunca pre-creado | No existe cobro tipo 'saldo' pre-insertado. El saldo es un calculo dinamico en BloqueCobros. Evita inconsistencias por edicion de cobros |
| 2026-04-07 | require_confirm pattern para bloques financieros | BloqueDatos con config_extra.require_confirm=true no auto-completa. Muestra boton explicito para confirmar. Aplicado en anticipo SOENA |
| 2026-04-07 | cobros.proyecto_id nullable — VE negocios no tienen proyecto | ALTER TABLE cobros ALTER COLUMN proyecto_id DROP NOT NULL. Cobros de negocios solo tienen negocio_id |
| 2026-04-07 | tipo_cobro CHECK: regular, anticipo, saldo, pago | CHECK constraint actualizado. 'pago' para multi-pago etapa 7 |
| 2026-04-08 | BloqueDocumentos: useRef para auto-complete, no setState | React 18 setState batching puede diferir updater callbacks. useRef.current.add(slug) es sincrono y confiable para checks de completitud |
| 2026-04-09 | negocios.estado valores reales: 'abierto' / 'completado' (no 'activo') | Bug encontrado en /numeros: 3 queries filtraban 'activo'. Corregido a 'abierto' |
| 2026-04-09 | BloqueHistorial: visualizacion pura en etapas ejecucion y cobro | is_visualization=true, tabs gastos/horas/cobros, sin edicion. BloqueEjecucion conserva solo KPIs + gastos por categoria |
| 2026-04-09 | Eliminar anglicismos en UI: "Pipeline" → "En venta" | Directiva de Mauricio: no usar anglicismos en la interfaz de ONE |
| 2026-04-09 | Modulo negocios reemplaza pipeline y proyectos | /pipeline y /proyectos son legacy. Todo nuevo desarrollo, conexion, FAB, WhatsApp, KPIs debe apuntar a /negocios. Las tablas oportunidades/proyectos siguen en DB pero el flujo nativo opera sobre negocios |
| 2026-04-09 | workspace_modules JSONB: arquitectura modular por workspace | Reemplaza concepto de workspace_type fijo. Permite activar combinaciones: business, compliance, tableros por tab. Default: {"business": true}. Clarity-only (no onboarding) |
| 2026-04-09 | Módulo business: Números, Negocios, Movimientos, Causación | Módulos exclusivos del paquete business. Sidebar condicional por modules.business |
| 2026-04-09 | Módulo compliance: Matriz de Riesgo, Validaciones | Listas vinculantes van en Config (no módulo propio). Sidebar condicional por modules.compliance |
| 2026-04-09 | Compartidos siempre visibles: Equipo, Directorio, Mi Negocio, Tableros | Independientes de módulos activos. Directorio es puente natural entre business y compliance |
| 2026-04-09 | Tableros: tabs activables por workspace (financiero, comercial, operativo, cumplimiento) | Tab "Cumplimiento" reemplaza concepto "Dashboard SARLAFT". Clarity configura qué tabs se activan por workspace |
| 2026-04-12 | Anáfora se resuelve en parser (Gemini), no en handler | Gemini recibe hint con items del contexto previo + few-shot examples adaptativos. Solo se inyecta cuando hasAnaphoricSignal dispara (~2-5% de mensajes) — ahorra tokens |
| 2026-04-12 | FOLLOWUP detectado por fast-path regex, no pasa por Gemini | Patrones como "los otros", "ver más", "el resto" no necesitan NLP. Fast-path ahorra ~700 tokens por mensaje FOLLOWUP |
| 2026-04-12 | last_context TTL 5 minutos, preload en sesión nueva | Si pasan más de 5 min sin interacción, la sesión siguiente no carga el contexto anterior. Evita resoluciones falsas de anáfora |
| 2026-04-12 | hasAnaphoricSignal usa patrones manuales, no \\b de JS | \\b en JS regex no reconoce caracteres acentuados (í, á) como word boundaries. Fix: lookarounds con \\s y puntuación explícita |
| 2026-04-16 | skip_enviar configurable por workspace en BloqueCotizacion | config_extra.skip_enviar=true muestra Aprobar/Rechazar directo en borradores. aceptarCotizacionNegocio acepta borrador o enviada. Patron generico reutilizable |
| 2026-04-16 | Bloques datos se inicializan con defaults de config al crearse | computeFieldDefaults() en negocio-v2-actions.ts. Aplica en crearNegocio y cambiarEtapaNegocio. Resuelve bug de herencia/condiciones con campos no tocados |
| 2026-04-16 | auto_fill normaliza acentos antes de comparar | normalize('NFD') + strip diacriticals. "Eléctrico" matchea "electrico" en mappings |
| 2026-04-17 | AIU se calcula sobre costoTotal (rubros), nunca sobre precio de venta | Modelo colombiano estandar. Admin% e Imprevistos% independientes, sobre costos directos |
| 2026-04-17 | AIU oculto por defecto — 90% del ICP no lo necesita | Revisado por Carmen/Hana/Noor. Link discreto para activar. Auto-mostrar si hay valores guardados |
| 2026-04-17 | Item de ajuste (es_ajuste) invisible en UI, visible en DB/PDF | El usuario no debe ver items que no creo. El ajuste es detalle interno de calculo |
| 2026-04-17 | Cuando usuario edita valor_total manualmente, AIU se resetea a null | Dos modelos mentales (margen vs AIU) no conviven — el ultimo en editarse gana |
| 2026-04-17 | items.cantidad default 1, precio_venta es unitario | costoTotal = sum(rubros x cant). Total linea = precio_venta x cantidad. Compatible con datos existentes |
| 2026-04-17 | Controles son entidad independiente M:N con causas via control_causa | Un control impacta multiples causas de diferentes riesgos. Junction table con RLS via join. Creacion desde /controles, no inline en causa |
| 2026-04-17 | Compliance: 6 roles reutilizados, supervisor = oficial operativo | owner/admin full; supervisor ve+edita+importa (no elimina, no cambia reglas); read_only = auditor (ve+exporta). Flags en roles.ts |
| 2026-04-17 | Riesgos se archivan via estado, nunca se borran | Trazabilidad SARLAFT: solo owner/admin DELETE permanente. Supervisor cambia estado, no elimina |
| 2026-04-17 | Responsable en header de etapa, no en bloque | negocios.responsable_id → staff(id). Selector en header de etapa (avatar+nombre+dropdown). BloqueEquipo deprecated pero no borrado (legacy). Decision cerebro 2026-04-13 implementada |
| 2026-04-18 | Cierre negocio aplica a últimas 3 etapas del flujo | Detecta `etapa.orden >= maxOrden - 2` como terminal. Stage `ejecucion` terminal se enruta a CompletarForm (verde) en vez de CancelarForm (rojo). Habilita SOENA VE: Certificación/Cobro/Devolución |
| 2026-04-18 | `completarNegocio` acepta stage `ejecucion`, solo bloquea `venta` | Guard anterior exigía stage `cobro` estricto. Cambio: bloquear solo `venta` (ese cierre va por Perder). Permite cerrar en ejecución terminal sin pasar por cobro |
| 2026-04-18 | ConfidenceBadge visible también en modo read-only de BloqueDocumento | Etapas completadas muestran `✓ XX%` o `⚠ Verificar` junto al label. Solo si `!campo.manual` — valores editados a mano no muestran badge |
| 2026-04-18 | `database.ts` regenerado: no volver a castear `as any` en tablas estandar | PostgrestVersion 14.1. Los campos retenciones/tercero_nit/created_by_wa_name/negocio_id/aiu_* ya están tipados. Usar tipos generados, no casts |
| 2026-04-18 | eslint config con argsIgnorePattern `^_` | Params/vars/destructuring con prefix `_` son ignorados por no-unused-vars. Convención para API pública donde se reciben props que no se usan internamente |
| 2026-04-18 | Skill `/one` es entrada directa al producto ONE (vs `/ws` para workspaces Clarity) | Distincion semantica: cambios transversales al producto vs workspace-especificos. Sesion se nombra `metrik-one--core`. Evita ambiguedad con workspaces llamados "one" (metrik/one, afi/one) |
| 2026-04-18 | Management API Supabase como fallback cuando `db push` falla por desync | Con SUPABASE_ACCESS_TOKEN + endpoint `/v1/projects/{ref}/database/query` se ejecuta SQL arbitrario sin tocar migration history. Util mientras el historial remoto esta fuera de sync |
| 2026-04-18 | WA notificaciones: cobrar 50K COP/ws/mes, modelo definitivo post-piloto | Carmen recomendo modelo A (flat + cap 500 notifs/mes) por margen estable. Mauricio opto por recoger data real 1 mes antes de fijar pricing |
| 2026-04-18 | Politica tratamiento Habeas Data NO es suficiente para opt-in Meta | Son dos compliance distintos: Ley 1581 Colombia (Emilio) y contrato Meta WhatsApp (Yuto). Ambos requeridos antes de enviar notificacion proactiva |
| 2026-04-18 | 9 notificaciones ONE como templates Utility (no Marketing) en Meta | Utility se aprueba en 1-24h (vs 1-3 dias Marketing) y cuesta ~40% menos. Copy sin promocion, sin emojis en v1 para maximizar tasa de aprobacion |
| 2026-04-18 | Security Fase 1+2 priorizada antes que WA notificaciones | 51 de 54 hallazgos del linter Supabase cerrados en una sesion. Aprovecho bloqueo WA para limpiar deuda de seguridad. Los 3 restantes son low priority |
| 2026-04-27 | Refactor MC + EBITDA: ONE no es software contable, perimetro hasta EBITDA, cash basis puro | Reemplaza flujo causacion formal (PUC, retenciones JSONB, estados PENDIENTE/APROBADO/CAUSADO/RECHAZADO) por flag binario `revisado` para contador. 4 migraciones aplicadas. Spec docs/specs/2026-04-26 |
| 2026-04-27 | Disclaimer fiscal en /revision /movimientos /nuevo/gasto /numeros drill | Copy aprobado por Emilio (CLO): "ONE es una herramienta de gestion operativa, no software contable, y no sustituye la asesoria de tu contador..." |
| 2026-04-27 | Causacion → Revision: ruta /causacion eliminada, /revision con bandeja interactiva | Permisos canMarcarRevisado / canViewRevision / canExportRevision reemplazan canCausar / canApproveCausacion / canViewCausacion. Sidebar muestra "Revisión" |
| 2026-04-27 | Flag revisado es exclusivo para bandeja /revision y export, NO afecta calculos operativos | Cobros se cuentan como reales con `fecha IS NOT NULL`, no con revisado=true. Bug detectado en auditoria: SOENA y demos mostraban $0 cobrado porque cobros pre-refactor quedaron revisado=false default. Fix c749daa |
| 2026-04-27 | Clasificacion costo gastos: variable / fijo / no_operativo | Trigger DB aplica default por categoria si no provisto. Form de gasto pide explicitamente al registrar. Backfill historico: gastos con negocio_id → variable, resto segun mapeo |
| 2026-04-27 | Retencion en gastos y cobros: NUMERIC simple (patron DIMPRO) | ONE no calcula retenciones — el contador del cliente las registra si las necesita. Reemplaza retenciones JSONB |
| 2026-04-27 | MC + EBITDA en /numeros desde v_pyl_mes (cash basis), reemplaza blend D130 | Tile principal MC% + EBITDA del mes. Drill P2 muestra MC global, MC por negocio top-5. Sin estimacion blend 40/60/100 historico — todo calculado del mes real |
| 2026-04-28 | Cleanup config_financiera.margen_* legacy (DROP columnas) | Post-refactor MC, esas columnas quedaron huerfanas. UI mi-negocio MargenContribucionSection ahora read-only informativa |
| 2026-05-04 | Linea Resident — 5ta linea MeTRIK, servicios profesionales recurrentes | Naming aprobado por Mauricio post-debate Mateo (Steady) vs Santiago (Resident). Resident gana por escalabilidad: "Oficial Cumplimiento Resident", "BI Resident", "Analista Financiero Resident". "Recurrente" se preserva como flag interno tipo_negocio |
| 2026-05-04 | Lineas MeTRIK ONE (4 etapas) y MeTRIK Resident (6 etapas) creadas en workspace MeTRIK | BloquePlanRecurrente en etapa Contrato de ambas. ONE: Prospecto → Contrato → Plan activo → Cierre. Resident: Discovery → Propuesta → Contrato → Onboarding → Vigente → Cierre |
| 2026-05-04 | Plan recurrente: monto + frecuencia + fecha_inicio + total_cuotas + auto_renovar | Tabla planes_cobro ligada a negocio_id. Cron diario procesar-planes-cobro genera cobros programados con T+3 dias anticipacion. Marca vencido tras 3 dias gracia. Notifica responsable + owner + staff area=admin_finanzas |
| 2026-05-04 | 3 buckets revenue canonicos: Service revenue / ARR ONE / ARR Resident | Decision Carmen + Mauricio. Service revenue = Clarity + Projects + Analytics (discrete). ARR ONE = software (recurrente sin costo marginal). ARR Resident = servicio (recurrente con costo de especialista). Excepcion: Clarity con financiacion a cuotas NO se reclasifica |
| 2026-05-04 | MC por linea con bucket "Sin linea" visible | Vista v_mc_linea_mes. Drill P2 muestra MC global y MC por linea coexistentes. Costos variables sin negocio asignado van a bucket "Sin linea" en italico gris (transparencia, no se prorratean). Especialista Resident con gastos imputados a negocio = variable a linea Resident; sin imputacion = fijo de empresa |
| 2026-05-04 | Lineas con tipo `recurrente` aceptadas en check constraint lineas_negocio.tipo | Antes solo aceptaba 'plantilla' / 'clarity'. Ahora tambien 'recurrente' para ONE y Resident |
| 2026-05-11 | Modulo Valida activable por workspace con flag `modules.valida_consulta=true` | Patron generico — cualquier workspace puede activarlo sin necesitar modulo compliance core. UI vive en seccion "Extras" del sidebar inferior, separada de modulos principales. Primer adopter: AFI (workflow CDAs sin compliance core activo) |
| 2026-05-11 | Nueva columna `workspaces.config_extra jsonb` para credenciales y configs server-only por workspace | No existia. Necesaria porque api_keys per-workspace requieren almacenamiento que NO sea env var global. Default `{}`. Acceso SOLO via service_role en server actions. NUNCA exponer al cliente. Patron de escritura: scripts admin (`scripts/setup-valida-workspace.ts`), nunca server actions. Ver gotcha en seccion correspondiente para criterios de cuando se activa |
| 2026-05-11 | API key per-workspace en `workspaces.config_extra.valida_api_key`, fallback a env var | Helper `getWorkspaceValidaApiKey(workspaceId)` lee primero de config_extra, cae a env var `VALIDA_API_KEY` (compatibilidad ALMA hasta cleanup). Habilita multi-tenant real para Valida — cada workspace tiene su propia api_key emitida + hash en metrik-valida.api_keys |
| 2026-05-11 | Tabla `valida_consultas` generica para historico local de consultas Valida en ONE | Multi-tenant via `workspace_id` + RLS. `negocio_id` nullable permite asociacion opcional consulta ↔ negocio. `lote_id` agrupa items de un mismo cargue masivo. Indices por (workspace_id, negocio_id, created_at), por lote_id, por severidad |
| 2026-05-11 | Buscador de negocios para Valida NO filtra por estado (incluye cerrados) | Server action `buscarNegociosParaValida` retorna todos los negocios del workspace ordenados por created_at. Comportamiento distinto al listado `/negocios` que oculta completados por default. Razon: las consultas SARLAFT suelen atarse a negocios ya implementados (CDAs cerrados) |
| 2026-05-11 | XLSX masivo Valida soporta columna `negocio_codigo` opcional que sobrescribe seleccion de lote | Plantilla descargable con headers + 3 ejemplos. Si la celda esta vacia, usa el dropdown del lote. Si tiene valor, lo resuelve via `negocios.codigo` y asocia esa fila a ese negocio. Permite mezclar varios negocios en un mismo cargue |
| 2026-05-12 | Tutorial in-app construido como motor reusable, no one-off para Valida | Driver.js + tabla `tutorial_progress` + vista `v_tutorial_adopcion` + 5 steps core compartidos + extras por surface. 3 slugs activos (valida_standalone, valida_compliance, compliance_listas_dual). Patron extensible a compliance core, negocios, planes recurrentes, revision. Aprobado por Mauricio tras reunion /hana /noor /max sintetizada por Mik |
| 2026-05-12 | Activacion canonica del modulo Valida en workspace ONE = correr `setup-valida-workspace.ts`, NUNCA SQL manual | Script garantiza api_key + flag + tutorial en un paso. Antes solo emitia api_key. Resuelve clase de errores de drift (workspaces con flag sin api_key o viceversa). Detalle en gotcha + cerebro `reglas/activacion-modulo-valida.md` |
| 2026-05-12 | Copy `/compliance/listas` (slug `compliance_listas_dual`) usa lenguaje neutral — NO menciona Valida ni Informa por nombre | UX transparente para ALMA preservada. Copy: "Cada consulta cruza varias fuentes y unifica el resultado". Decision visual + de marca para no exponer arquitectura interna dual al cliente final |
| 2026-05-13 | Drive OAuth per-workspace en `workspaces.config_extra.drive_*` + soporte Shared Drives + `supportsAllDrives=true` en `google-drive.ts` | Workspaces apuntando a Shared Drive de un cliente (caso AFI → CDA Shared Drive `0ALAKHcpyVsDDUk9PVA`) ya no fallan en silencio. `getAccessToken(workspaceId?)` resuelve credenciales: per-workspace si `config_extra` tiene la triple `drive_refresh_token/client_id/client_secret`, fallback a env vars del OAuth global MeTRIK. Cache de token por workspace. Helpers reciben `workspaceId?: string` como ultimo param opcional, todos los callers actualizados (crearNegocio, AFI generar-contrato/paquete, formulario-actions, documento-actions). Backfill aplicado a negocio C1 26 2 |
| 2026-04-27 | BloqueDatos extendido con tipos genericos `radio`, `documentos_preview`, `showIf` | Aplicable a cualquier workspace. Radio para opciones excluyentes, documentos_preview para listar archivos a generar segun seleccion en vivo, showIf para campos condicionales. Patron implementado para AFI pero util en SOENA, WMC, etc. donde haya seleccion de productos/modulos |
| 2026-04-27 | Patron hook AFI dual en negocio-v2-actions: server action retorna flags `trigger_*` para que el cliente dispare el endpoint | Server actions no pueden export `maxDuration`, asi que motores server-heavy (>10s) viven en route handlers. Patron extensible: `trigger_afi_generation` (paquete SARLAFT 30-60s) y `trigger_afi_contrato` (contrato 15-30s). Replicar en otros workspaces con motores pesados |
| 2026-04-27 | Image module respeta aspect ratio del logo en docx-engine AFI | Antes 300x100 px deformaba. Ahora parser inline PNG/JPEG escala dentro de bbox 130x60 manteniendo forma original. Sin nuevas dependencias (no `image-size` lib) |
| 2026-04-27 | Composicion modular de contratos via docxtemplater section tags `{{#FLAG}}...{{/FLAG}}` | Patron probado en motor AFI. Plantilla DOCX maestra unica + 13 flags + 22 placeholders genera N combinaciones de contrato. Reusable para cualquier cliente Clarity con productos componibles. Pricing hardcoded en v1 (DEFAULT_PRICING constante), pendiente migrar a `workspaces.config_extra` |
