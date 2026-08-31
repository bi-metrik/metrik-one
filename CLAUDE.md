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

**Desde el 2026-08-10 una tabla nueva no concede nada a nadie.** Antes de esa fecha esta sección afirmaba lo contrario de lo que hacía la base, y esa contradicción es la que hay que tener presente al leer migraciones viejas: hasta ese día **toda tabla nueva nacía con los SIETE privilegios para `anon` y `authenticated`** (medido: 135 tablas de `public` así para `anon`, 146 para `authenticated`), y lo único que separaba a un visitante sin sesión de los datos era el RLS. La convención existía en este archivo; el `ALTER DEFAULT PRIVILEGES` de la base decía otra cosa. Corregido en `20260810120200_default_privileges_no_conceden_a_anon.sql`.

Cambio Supabase relacionado: desde **2026-05-30** los proyectos nuevos ya no exponen `public` al Data API por defecto, y desde **2026-10-30** se aplica también a **tablas nuevas de proyectos existentes** (ONE es existente, ref `yfjqscvvxetobiidnepa`). ONE ya se adelantó a ese cambio.

**Toda migration que cree una tabla en `public`** debe incluir:

1. **RLS habilitado siempre** (`alter table <t> enable row level security;`).
2. **Policies de aislamiento por workspace** si la tabla se lee/escribe con el cliente `authenticated` (`getWorkspace`/`createClient`). Patrón canónico vía `current_user_workspace_id()`; si la tabla no tiene `workspace_id` propio, validar por join (ver `staff_areas` / `control_causa`).
3. **GRANT explícito al rol que la consume.** Ya no es opcional: sin él la tabla es invisible para PostgREST aunque el RLS sea perfecto.
   ```sql
   -- tabla accedida por el cliente authenticated (browser o SSR):
   grant select, insert, update, delete on public.<tabla> to authenticated;
   grant usage, select on all sequences in schema public to authenticated;  -- si usa secuencias
   -- tabla accedida SOLO server-side (createServiceClient / crons): NO dar grant,
   -- y declararlo con el comentario  -- server-only: <razon>
   ```
4. **Nunca** dar `grant ... to anon` salvo que la tabla sea deliberadamente pública sin datos sensibles, y en ese caso declararlo con `-- publico-deliberado: <razon>`.

Regla de decisión: ¿quién consume la tabla? `service_role` → RLS on, sin grant, sin policy. `authenticated` → RLS on + policy por workspace + grant a `authenticated`.

### Funciones: aquí el default NO se pudo arreglar

**Toda función nueva sigue naciendo ejecutable por `anon`, y no hay forma de evitarlo desde la configuración de la base.** PostgreSQL concede `EXECUTE` a `PUBLIC` en cada función por comportamiento nativo, ese default vive fuera de `pg_default_acl`, y `ALTER DEFAULT PRIVILEGES` no lo alcanza. Medido en esta base el 2026-08-10, en ensayo con rollback: revocar `anon` del default deja la función sin `anon=X` en su ACL y aun así `has_function_privilege('anon', f, 'execute')` devuelve **true**, porque `anon` la alcanza como miembro de PUBLIC. Forzar la materialización (`grant` a PUBLIC y luego `revoke`) tampoco sirve: el default pierde la entrada y la siguiente función vuelve a nacer con `=X/`.

Consecuencia: en funciones, el **REVOKE explícito en la migración es el único mecanismo**, no una segunda capa.

```sql
revoke execute on function public.<f>(<args>) from public, anon;
```

`revoke ... from anon` a secas **NO basta** (gotcha #185): deja la función alcanzable vía PUBLIC. Si la función es una RPC que el browser debe invocar, decláralo con `-- ejecutable-por-cliente: <razon>` y asegúrate de que la propia función filtre por `current_user_workspace_id()`, porque el guard del server action no la protege (ver el hallazgo abierto sobre segmentación por rol).

### La guarda que lo hace cumplir

`npm run check:migraciones` revisa las migraciones que el PR agrega y falla si una tabla nace sin RLS o sin declarar su grant, o si una función nace sin revocar `EXECUTE` a PUBLIC. Corre en CI (`.github/workflows/migraciones.yml`) en cada PR que toque `supabase/migrations/`. Las marcas `-- server-only:`, `-- publico-deliberado:` y `-- ejecutable-por-cliente:` son la forma de declarar una excepción: la marca es la decisión, el silencio no.

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

**Sesion:** 2026-08-31 (`soena` → producto: **dos gotchas del motor, sin una linea de codigo**). Ningun PR: las dos correcciones fueron de configuracion. Se documentan aqui porque el que muerde es el mecanismo, no la config.

- **⚠️⚠️ Mover un bloque de etapa NO reapunta el routing de las otras etapas — son dos mecanismos distintos.** Al subir `servicio_contratado` de Negociacion (orden 5) a Propuesta (4) se reapuntaron las 22 referencias entre **bloques** (`source_bloque_slug`, que es lo que la revision mira). Pero el `routing` de una etapa apunta a un **ORDEN de etapa** (`source_etapa_orden`) y no tiene concepto de slug: el de Documentacion quedo leyendo `servicio` de Negociacion, donde ya no habia ningun bloque que lo declarara. **El sintoma no se parece a la causa:** falla al *avanzar*, en *otra* etapa, sin relacion aparente con el cambio. `camposDecisionDelNegocio` busca al dueño del campo **solo entre los bloques `datos` de la etapa fuente**, y `camposNegocio` arma el bolsillo de valores con el mismo filtro (`bloque_configs.etapa_id = sourceEtapaId`), asi que con la fuente equivocada no aparece ni el bloque ni el valor. **Al mover un bloque, barrer TODAS las etapas con `routing.conditional` y cruzar cada `condition.field` contra la etapa que declara ese slug.** ✅ Lo salvo `exigir_dato_de_decision: true`, que freno el avance en vez de rutear con un dato ausente — el flag que se puso despues de que 17 casos de Entrega se fueran a Facturacion en julio: sin el, esto habria sido mudo.
- **⚠️ `_areaReadonly` y el guard del servidor NO miden el area contra el mismo stage.** `guardEditarBloque` la evalua contra el stage **del bloque**; `_areaReadonly` (en `negocio-v2-actions.ts`) contra el `stage_actual` **del negocio**. La consecuencia: alguien con permiso real en el servidor puede ver el bloque de solo lectura porque el negocio ya avanzo a un stage de otra area — el sintoma es "no tengo permiso" cuando el permiso si esta. **Antes de tocar roles o `staff_areas`, comprobar cual de los dos frena:** si el servidor deja pasar, el arreglo es `config_extra.areas_editoras` en el bloque, que es el opt-in canonico y apaga `_areaReadonly` solo ahi (`invitadoAEsteBloque`). ⚠️ `areas_editoras` invita a un **area**, no a una persona; para la correccion post-avance el filtro fino lo pone el rol (`puedeCorregirDocumentos` = owner/admin/supervisor). El comentario de `BloqueDatos.tsx` que dice "el servidor revalida las tres cosas" **es impreciso**: no revalida el area contra el stage del negocio.

**Sesion:** 2026-08-31 (`metrik-one` → producto: **el cargue masivo ya se puede ensayar sin escribir nada**). PRs **#428** (`a7e7f41`) y **#429** (`996d31b`) mergeados, los tres checks en verde. Sin migracion.

- **⚠️ Un cargue masivo tiene que poder ensayarse antes de escribir.** `scripts/cargue-iva-batch.ts` creaba contacto, negocio y archivos en Drive **antes de que nadie hubiera visto lo que la extraccion leyo**; en julio los errores de extraccion se descubrieron con los negocios ya creados. Ahora `--dry` corta despues de extraer los 4 documentos y **antes de la primera escritura**, y deja `<mapping>_out.json` con los 10 campos de cada caso mas los minimos que falten (identificacion, IVA, cuenta, radicado UPME). **El corte vive dentro del mismo script y no en una copia aparte**: lo que hay que validar es la extraccion real —los mismos campos, el mismo fallback de PDF cifrado con la cedula, el mismo fallback a PNG—, y una copia paralela se separa de esta con el primer arreglo que se le haga a una sola de las dos. Verificado: el dry-run del 2026-08-24 corrio los **67 casos** del cargue de agosto con **0 campos minimos vacios y 0 errores**.
- **⚠️ Bajar de Drive por ruta ata el script a una maquina.** La version anterior usaba `rclone` contra un remoto `gdrive:` **configurado a mano** por quien corriera el cargue: esa config no viaja con el repo, asi que el script no se podia correr en otro lado, y una ruta ademas se rompe si el cliente renombra una carpeta de su archivo. Ahora la descarga acepta **id de Drive** y usa la misma credencial que la app (`getAccessToken(WS)`); el id no cambia con el nombre. Con id, el mapping declara la extension aparte en `<k>_ext`, porque un id no la trae y `mimeOf` decide con ella: **sin eso todo id se leeria como PDF y una foto del documento fallaria la extraccion.**
- **⚠️ `formulario-actions` y `responsable-rol` no se pueden importar arriba en un script.** Arrastran la cadena de `get-workspace`, que espera el runtime de Next y no resuelve fuera de el. Van importados **dentro del camino que escribe** (`await import(...)`), que es justo lo que permite que el `--dry` corra sin cargarla. Mismo motivo por el que `crearNegocio` no sirve desde una edge function.
- **PR #429 — cinco specs de agosto versionadas.** `calificacion-de-leads`, `canal-whatsapp-propio-metrik`, `casilla-compartida-documentos`, `inversion-pauta-meta` y `rechazos-dian-soena` vivian solo en el disco de la torre, sobre `main` y sin commitear. Ninguna cambia codigo; las cuatro primeras son diseno sin construir.

**Sesion:** 2026-08-26 (`metrik-one` → producto: **por que ONE esta lento — el SQL no era el problema**). PRs **#414** (`6c3d819`) y **#415** (`34295ef`) mergeados y desplegados; deploy verificado sirviendo en produccion. Sin migracion.

- **⚠️⚠️ El promedio de `pg_stat_statements` NO es el costo de la consulta.** El diagnostico paso por dos conclusiones falsas antes de llegar a la buena: primero *"la base esta ociosa"* (2 de 30 conexiones, 136 MB, cache hit 100% — cierto como hecho, falso como conclusion: eso dice si esta **saturada**, no si **responde rapido**), y despues *"las consultas del camino caliente son lentas"*. Corriendo las **mismas** funciones solas y varias veces: `get_comercial_resumen_soena` **1.588 ms → 27 ms**, `get_comercial_seccional_mes_soena` **1.659 ms → 23 ms**, `get_comercial_kpis_mes_soena` **923 ms → 59 ms**, `count_negocios_por_conciliar` **179 ms → 60 ms** (8 corridas identicas). Mismo plan, mismos buffers. Un CTE que dentro de `v_negocio_valor` tardaba 208 ms tardaba **2,3 ms** aislado con `Buffers: shared hit=741` en los dos casos. **Antes de optimizar una consulta por su promedio, correrla sola.** Detalle en `cerebro/errores/promedio-de-produccion-no-es-el-costo-de-la-consulta.md`.
- **⚠️⚠️ La causa de fondo es de Supabase y NO se puede arreglar por migracion.** Realtime recrea su tabla de particiones **~300 veces al dia** (`CREATE TABLE IF NOT EXISTS realtime.messages_YYYY_MM_DD PARTITION OF ...` + su `ALTER TABLE ... OWNER TO`): **8.634 comandos DDL en 29 dias**, el 93% de todo el DDL de la base. Cada uno dispara el event trigger `pgrst_ddl_watch`, que hace que **PostgREST bote y reconstruya su cache de esquema** — la reconstruyo **1.965 veces** (68 al dia). Cada reconstruccion son `SELECT name FROM pg_timezone_names` (663 ms) + dos consultas recursivas de `base_types` (218 y 81 ms) ≈ **0,96 s durante los cuales la API no responde**, y al terminar **todo arranca en frio otra vez**. El arreglo natural —que el trigger ignore el esquema `realtime`— **esta bloqueado por permisos**: `extensions.pgrst_ddl_watch()` es de `supabase_admin` y el rol `postgres` (el que usa `supabase db push`) **no es miembro** (`pg_has_role('postgres', proowner, 'USAGE') = false`). Hay que pedirselo a Supabase. **No perder tiempo escribiendo esa migracion: falla con "must be owner of function".**
- **PR #414 — el layout de `(app)` deja de hacer 7 idas y vueltas en fila.** Corre en **todas** las pantallas del producto y encadenaba: perfil → `getWorkspace()` (que por dentro son otras tres) → cargo del staff → workspace+lineas → badge de conciliacion → `getPlatformAdminState()` → `getNotificaciones()`. Ahora son **3 olas**: (A) perfil + `getWorkspace` + admin de plataforma + notificaciones, que solo dependen del usuario; (B) cargo + workspace + lineas, que necesitan `profile.workspace_id`; (C) el badge, que necesita saber si el modulo esta activo. `getNotificaciones` llama a `getWorkspace` por dentro pero comparten el `cache()` de React (`getWorkspaceCached`), asi que en paralelo comparten la promesa en vuelo y no duplican lecturas.
- **PR #415 — `getNegocioDetalleCompleto` deja de pedir trece cosas en fila.** Es la pantalla mas pesada del producto. Negocio base, metadata del 010, workspace, responsables, profiles, staff, usuario, cobros, gastos directos, gastos mixtos, horas, cotizaciones y actividad salian **una detras de otra sin usar el resultado de la anterior**. Ahora salen en una sola ola: de **32 `await` quedan 23** y los diez primeros pasos son uno. De paso, **`workspaces` se leia DOS veces por render** —la misma fila, una para el gate del honorario y otra para `modules, config_extra`— y ahora es una sola lectura.
- **Cambio de comportamiento acotado a caminos de excepcion (los dos PRs):** un usuario sin perfil, un negocio inexistente o un negocio que un `operator` no tiene permitido ver ahora disparan la ola **antes** de devolver `null`/redirigir. El corte sigue exactamente donde estaba y no se devuelve ningun dato — solo se gasta trabajo que antes se ahorraba.
- **⚠️ Un check ausente sin conflicto: el PR #415 mostro SOLO Vercel en verde.** Los tres obligatorios (`Tipos y pruebas`, `Build`, `Lint de lo que cambia`) **no se encolaron**, con el PR en `MERGEABLE` (sin ningun conflicto), `pr.yml` sin filtro de `paths`, Actions habilitado y el PR anterior de la misma sesion (#414) disparandolos 20 minutos antes. `gh run list --branch <rama>` devolvia **cero runs**. La firma es `mergeable: MERGEABLE` + `mergeStateStatus: BLOCKED`. **Aqui cerrar y reabrir el PR SI los desperto** (`reopened` es tipo de actividad por defecto de `on: pull_request`) — lo cual **contradice** lo que decia el gotcha del 2026-08-11, que solo aplica al caso con conflicto. **Comprobacion que sirve en ambos: contar las filas de `gh pr checks <n> | sort -u` contra la lista de obligatorios, no mirar que no haya rojos.**
- **Datos de la instancia, por si vuelve el tema:** `shared_buffers` 286 MB, `effective_cache_size` 480 MB, `work_mem` 2,1 MB, `max_connections` 60, **sin addon de computo**. Los datos son chicos —tabla mas grande `negocio_bloques` con 6,2 MB y 16.176 filas, cache hit 100%, cero TOAST (`data` promedia 239 bytes)— asi que **no es volumen de datos**. Consumo total de CPU de base: 4,5 horas en 29 dias = 0,6% de un vCPU; el mayor consumidor no es la app sino **Realtime** (864.007 lecturas del WAL, 74 minutos) para publicar **una sola tabla: `public.notificaciones`**, usada en 2 archivos (`components/notification-bell.tsx` y `hooks/use-bloque-lock.ts`).
- **Metodo y canal:** todo medido contra produccion con la Management API de Supabase (`POST /v1/projects/{ref}/database/query` con el token `sbp_...` de `.credentials.md`) — **`psql` no esta instalado y el MCP de Supabase pide OAuth que no se puede completar en sesion no interactiva**. Linea base guardada en `.claude/state/perf-one-baseline-2026-08-26.md` para medir el delta.

---

**Sesion:** 2026-08-25 (`metrik-one` + SOENA/VE → producto: **el `{link}` del aviso al cliente sale del bloque que la etapa DECLARA, no del que la base devuelva primero**). PR **#395** mergeado, migracion aplicada y edge function `notificar-etapa` desplegada **v12**.

- **⚠️⚠️ Un enlace a un documento resuelto "por la etapa" lo elige el ORDEN DE LAS FILAS.** `datosDelCopy` (edge function `notificar-etapa`) resolvia `{link}` recorriendo todos los bloques del negocio y quedandose con el `drive_url` del **ultimo** cuya `bloque_configs.etapa_id` fuera la etapa actual — sin `order by` y sin filtrar por slug. **Medido: 10 etapas de la base tienen mas de un bloque con `drive_url`** (185 negocios abiertos parados en ellas). En Entrega de SOENA son el Certificado UPME y la Factura emitida, y de los 58 casos que ya pasaron por ahi **16 tienen archivo en LOS DOS**. Corriendo la consulta vieja sobre esos 16, el enlace que sale es el de la **FACTURA en los 16**: no fallaba a veces, mandaba el documento equivocado **siempre**, sobre un copy que promete el certificado, por correo y por WhatsApp, a clientes finales. Ahora la etapa declara `avisar_al_cliente.link_bloque_slug` y **sin esa clave el aviso se omite con `sin_link`** en vez de adivinar: mandarle a un tercero el documento de otro tramite no se deshace.
- **⚠️ Una copia heredada readonly NO es la fuente de su documento, y ademas no tiene slug que declarar.** Las copias nacen con `bloque_configs.slug` **NULL** (apuntan a su origen por `config_extra.source_bloque_slug`), asi que la referencia se declara con el slug del **ORIGEN**. Y no es solo forma: `getNegocioDetalle` le hace **swap** a la `data` de la copia por la del origen antes de pintarla (`documentoDataPorSlug`), o sea que el archivo que el operador ve en pantalla ES el del origen. **Medido: en 11 de 42 casos la copia de Entrega guarda un `drive_url` distinto del origen** —las 11 escritas en un mismo lote del 31-jul— data vieja de la ruta que llego a escribir en copias readonly, la misma que este archivo ya documenta. Leer la copia habria mandado un archivo que la plataforma no muestra en ningun lado. **Corolario para cualquier consumidor nuevo de `drive_url`: resolver por el slug del origen, nunca por la instancia de la etapa donde se esta parado.**
- **⚠️ "Todavia no lo hemos encendido" es una premisa que se comprueba, no se hereda.** El frente arranco asumiendo que el aviso al cliente de Entrega estaba pendiente de habilitar. Estaba **encendido** (`email: true` y `whatsapp: true`) desde antes: 0 negocios parados en Entrega ese dia, pero **380 abiertos** que todavia no pasan por ahi y que lo disparan al llegar. Cambia el orden de cierre — el merge no corta nada, lo corta el **deploy** de la edge function.
- **La consulta dejo de traer todos los bloques del negocio para leer dos campos:** pide los slugs concretos (`.in('bloque_configs.slug', slugs)`). `data` es jsonb y Postgres lo descomprime entero por fila; es el mismo costo que ya obligo al PR #124.
- **⚠️ `supabase/functions/` no lo verifica ningun check de CI, y ya dejo pasar una regresion completa.** `deno check` sobre `main` fallaba con **2 errores** en este archivo (`negocio.etapa_actual_id` no existe en el tipo `Negocio`), entrados con el PR #377 y detectados recien aqui. El baseline "un solo error en las 9 edge functions" medido el 22-ago **caduco solo en tres dias**: un baseline sin check en CI se re-mide, no se cita de memoria.
- **Metodo:** todo medido contra produccion **antes** de escribir; simulacion pura del `jsonb_set` y luego ensayo del `DO` block real con `rollback`; la migracion aborta con `into strict` si no encuentra exactamente una etapa con `{link}` o si el slug no existe en su linea; verificacion final leyendo el codigo **desplegado en el servidor** mas un POST que devuelve `401 unauthorized` desde el propio codigo de la function (o sea que arranca y corre).

---

**Sesion:** 2026-08-25 (`metrik-one--actas` → producto: **actas automaticas de reunion — generacion LLM + envio por email y cron diario, arranca en modo borrador**). PR **#391** mergeado y desplegado a produccion. Migracion `actas_generadas` aplicada.

- **Pipeline nuevo en `src/lib/actas/`:** `calendario.ts` (listado Google Calendar del dia) → `seleccion.ts` (filtra por duracion REAL de transcripcion ≥45 min, no la agendada; clasifica interna/externa por dominio; siempre devuelve el motivo de descarte) → `transcripcion.ts` (parseo del doc de Meet) → `generacion.ts` (Gemini 2.5-flash, `responseSchema` forzado a `{resumen, decisiones[], compromisos: {responsable, tarea, fecha_limite}[]}`) → `envio.ts` (Resend, mismo patron de `send-cuenta-cobro.ts`) → cron `src/app/api/crons/actas-diarias/route.ts` (`0 0 * * *` UTC = 19:00 Bogota, `CRON_SECRET`, try/catch por candidata para que una reunion rota no tumbe el resto).
- **⚠️ El cron dispara a las 00:00 UTC = 19:00 Bogota del dia ANTERIOR.** `new Date(iso).getDate()` lee la zona del RUNTIME, no Bogota — hay que desplazar por el offset fijo (-5, sin DST) y leer componentes UTC, mismo patron que `listarReunionesDelDia` de `calendario.ts`. Bug propio detectado y corregido antes de commitear, no llego a produccion.
- **Arranca en modo `revision` (constante `MODO_ENVIO_DEFAULT` en `envio.ts`):** primera semana los correos salen `[BORRADOR]` solo a mauricio.moreno@metrik.com.co, nunca a los participantes reales. El pipeline completo corre igual en ambos modos (genera, persiste, intenta enviar) — lo unico que cambia es el destinatario. Pasar a `produccion` es un cambio manual explicito en codigo, pendiente de que Mauricio valide la calidad de los primeros borradores. Patron capturado como regla reusable: `cerebro/reglas/automatizacion-arranca-en-revision.md`.
- **Idempotencia por `transcript_file_id` UNIQUE** en `actas_generadas` — si el cron corre dos veces sobre la misma reunion, no duplica el acta ni el envio.
- **No verificado contra APIs reales** (Resend/Gemini) — 62/62 tests con `fetch` mockeado, sin dry-run en vivo todavia.
- **Fuera de alcance de esta version** (spec completa en `proyectos/metrik/one/2026-08-18_brief-max-actas-automaticas.md`): §8bis vincular el acta a un proyecto con compromisos accionables, §8ter deteccion de prospecto + pregunta de creacion de negocio al iniciar sesion.

---

**Sesion:** 2026-08-18 (`soena--ve` → producto: **la plata del cliente se imputa con UNA regla, y anular deja de depender del tipo de cobro**). PRs **#301**, **#307**, **#310** y **#314** mergeados y desplegados.

- **⚠️⚠️ Habia DOS reglas de imputacion del dinero conviviendo, con $24,7M de diferencia.** El motor (`repartirPagoTarifaHonorario`) cubria la **tarifa primero**; la vista del P&L (`v_cobro_valor`) imputaba por escalones **honorario, tarifa, honorario**. Sobre los mismos 111 cobros de SOENA, una llamaba tarifa a $53,3M y la otra a $28,4M. **Decision de Mauricio: primero honorario, siempre** ("sin eso no detona lo demas"). Gana la de la vista y queda UNA, en `src/lib/upme/imputacion-pago.ts` (puro): `escalonesDelNegocio` espeja los techos de `v_negocio_valor` (tramo1 = honorario del plan, tarifa, tramo2 = resto) e `imputarPago` reparte contra ellos contando lo ya recaudado. `repartirPagoTarifaHonorario` **borrada**.
- **Un pago no se parte como si fuera el primero.** `crearCobrosSoenaCore` ignoraba lo ya recaudado del negocio: el segundo pago volvia a llenar el anticipo ya cubierto y llamaba honorario a plata que es tarifa. Ahora pasa `consumidoAntes`, excluyendo los cobros de la propia referencia para que un reintento no desplace la imputacion.
- **El desglose de un gate puede estar bien sumado y mandar a cobrar lo que no es.** `calcularPendienteHandoff` daba el total correcto (no depende del orden) pero repartia tarifa-primero, asi que decia "falta la tarifa" cuando lo que faltaba era el honorario. Ningun negocio cambia de lado del gate.
- **Anular un cobro dejo de exigir `tipo_cobro='externo'`** (#301). Alcanzaba a 7 de 189 cobros. Decide `src/lib/cobros/anulabilidad.ts` por **lo que quedaria desarmado detras**: pasarela viva (`fuente='epayco'`), cuota de un plan (`programado`/`plan_cobro_id`), o cuenta de cobro emitida que lo incluye (`cuentas_cobro_emitidas.cobros_ids`). Pasa a 124 anulables. Cada bloqueo dice **a donde ir**, no solo que no se puede.
- **⚠️ Dos vinculos fiscales que NO sirven como senal, medidos:** `cobros.factura_id` esta en **0 de 189** filas, y `negocios.metadata->'siigo_factura'` en **0 de 363** negocios — por eso la regla 2 de `redistribucion.ts` ("de un negocio facturado no se quita plata"), una de las tres que declara no negociables, **esta inerte**. El vinculo real a nivel de cobro es `cuentas_cobro_emitidas.cobros_ids`.
- **`cobros.anulado_por` es `profiles.id`, no `staff.id`.** La redistribucion escribia el staffId; las dos tablas son **disjuntas** (0 de 52 ids coinciden), asi que esas anulaciones quedaban sin autor visible en pantalla. El contrato ya estaba escrito en `ctx-pagos-externos.ts`; lo que faltaba era cumplirlo.
- **El bloque de cobros se daba por completo con la tarifa sin pagar** (#310). `reevaluarBloquesCobros` comparaba contra `precio_aprobado` pelado, sumaba cobros **sin fecha**, y exigia cero absoluto en vez del piso de materialidad. La decision salio a `src/lib/cobros/saldo-negocio.ts` (puro), que hace la misma cuenta que la tarjeta. En SOENA: 42 de 199 negocios abiertos, $28.110.037. Defecto **latente** — los bloques ya estaban en `pendiente`.
- **Se borro `eliminarPorcionPago`** (#307): el "deshacer" del comercial del PR #60, con el boton apagado por un `permiteEliminar = false` hardcodeado desde el **2026-07-16** y **cero usos en produccion**. Lo vivo no era el boton sino la server action, que borraba un cobro con `.delete()` sin motivo ni rastro. **Una server action exportada es un endpoint alcanzable aunque ninguna pantalla la invoque.**

**Sesion:** 2026-08-14→15 (`soena--ve` → producto: **un documento perecedero deja de valer por estar cargado y pasa a valer contra una FECHA OBJETIVO**). PRs **#288** y **#296** mergeados y desplegados.

- **El criterio de vigencia vive en un modulo puro con el reloj como PARAMETRO** (`src/lib/documentos/vigencia.ts`). `estadoVigencia(expedicion, objetivo, {vigenciaDias, hoyISO, margenSinObjetivoDias})` devuelve `vigente | esperar | reemplazar | no_comprobable`, mas `pedirDesde` (la fecha desde la cual pedirlo tiene sentido) y el `criterio` que se aplico. El `hoyISO` entra por parametro y sale de `todayBogotaISO()`: una marca por lote, testeable, y Bogota en vez de UTC — a las 7 p.m. de un 30, UTC ya esta en el 31 y el veredicto se corre un dia.
- **⚠️ Cuando NO hay fecha objetivo, se mide contra el CALENDARIO con un margen declarado** (`margen_sin_cita_dias`, opt-in por check). Un documento que caduca esta semana no sirve para un tramite que aun no tiene fecha. **La fecha objetivo real manda siempre**: el margen solo entra si el objetivo esta ausente, nunca lo pisa. Y con margen **no existe `esperar`**: sin objetivo, "espera a pedirlo" no significa nada — o alcanza o se pide otro.
- **⚠️⚠️ El veredicto de vigencia se DERIVA al leer; guardarlo es una pantalla sana que miente.** El cross-check se calcula al cargar el documento y queda en `negocio_bloques.data._cross_check`. Para comparar dos textos eso da igual hoy que en un mes; **para la vigencia no**: la fecha objetivo se reprograma y, con el criterio del margen, el objetivo es `hoy + margen`, asi que un documento guardado como vigente lo pareceria **para siempre**. `src/lib/documentos/refrescar-vigencia.ts` lo recalcula en cada lectura y **no persiste** (mismo criterio que `pedirDesde`). Regla general: si el veredicto de un control depende del reloj, no se guarda.
- **⚠️ Refrescar solo lo GUARDADO cubre una fraccion: hace falta SINTETIZAR.** Medido en SOENA: 144 negocios abiertos tienen el bloque, 136 con la fecha extraida y **solo 22 con veredicto guardado** — o sea que la alerta habria llegado a uno de cada seis. La sintesis arma el veredicto de un documento cargado **antes de que el check existiera**, y se hace solo si TODOS los checks del bloque son de vigencia: con otros modos sin evaluar, un panel que dice "validado" afirmaria de mas sobre comprobaciones que nadie hizo.
- **⚠️ Al sintetizar se pierde lo que solo vivia en el guardado, y `solo_alerta` es justo eso (PR #296).** Un check `solo_alerta` avisa en ambar y no bloquea; en la sintesis no hay guardado del cual heredar la marca, asi que el panel nacia en **ROJO** diciendo *"Discrepancia detectada. Sube un nuevo certificado…"* sobre un control que no frena nada. **Se vio abriendo la pantalla, no en las pruebas**: la nota de vigencia era correcta y el encabezado mentia sobre la gravedad. Fix: el helper recibe el `cross_check` COMPLETO de la config, no solo sus checks. Corolario: **al sintetizar un objeto que normalmente se hereda, listar que campos venian del original y de donde salen ahora.**
- **La causa de `no_comprobable` se DERIVA de la fila, no se asume.** "No se pudo comprobar" puede ser que falte la fecha del documento o que falte la fecha objetivo, y el mensaje util es distinto en cada caso; deducirlo del contexto acierta a veces y manda al operador a buscar el papel equivocado el resto.
- **⚠️ Reutilizar una rama despues de un merge con SQUASH la deja atras, y el PR siguiente REVIERTE lo que entro en medio.** `feat/vigencia-certificado` se mergeo con squash (#288) y se siguio usando. El squash crea un commit nuevo, asi que `git log origin/main..HEAD` muestra la rama "con 5 commits sin mergear" aunque su contenido ya este en main, y **el diff de tres puntos (`origin/main...HEAD`) tambien miente**: compara contra el ancestro comun, que quedo antes del squash. Lo delata `git diff origin/main HEAD` (dos puntos, contra la punta): ahi se vieron **-1112 lineas** que habrian revertido los PRs #289, #294 y #295. **Tras un squash merge la rama se abandona; el trabajo siguiente nace de `origin/main` fresco.** (Matiza el gotcha de 2026-08-06, que recomienda tres puntos: eso es para detectar colisiones de worktree, no para medir el delta contra main tras un squash.)
- **⚠️ `gh pr merge --delete-branch` falla si el arbol principal esta parado en `main`, pero el MERGE YA SE APLICO.** El error es de git, no de GitHub: *"fatal: 'main' is already used by worktree at .../metrik-one"*. `gh` mergea por API, y despues intenta borrar la rama **local**, para lo cual quiere pararse en `main` — que el arbol principal ya tiene tomado. Leerlo como "el merge fallo" lleva a reintentarlo sobre un PR ya cerrado. **Verificar el estado real antes de reaccionar** (`gh pr view <n> --json state,mergeCommit`) y hacer la limpieza aparte, o usar `gh pr merge --squash` a secas mientras el arbol principal siga en `main`. Familia de [[limpieza-encadenada-antes-de-verificar]]: merge y limpieza son dos pasos, no uno.
- **Metodo:** 37 pruebas puras (26 de criterio + 11 de refresco), y la del `solo_alerta` **se vio fallar** contra la implementacion sin el fix antes de confiar en ella. Alcance medido contra produccion ANTES de aplicar la config: con cita, los mismos 6 vencidos que con la regla anterior — subir la vigencia de 10 a 30 dias no marca a nadie de mas.

---


**Sesion:** 2026-08-14 (`soena--ve` → producto: **el aviso de avance al cliente gana un segundo canal, WhatsApp, via un DISPARADOR de FunnelChat**). PR **#293** mergeado y desplegado; 2 migraciones aplicadas; edge function `notificar-etapa` redesplegada (v9). Opt-in por etapa y **apagado en toda la base**.

- **El proveedor no expone una API para enviar: expone un DISPARADOR.** Se le hace POST a la URL de un flujo suyo y ese flujo le escribe al cliente, asi que el producto no arma un mensaje de WhatsApp sino el juego de datos que el flujo mapea a campos del contacto. **La URL ES la credencial** (verificado con `OPTIONS`: `allow: POST`, sin cabecera de auth), asi que vive en `config_extra` del workspace, server-only, mismo trato que Siigo; y como el valor viene de la base, la edge function **acota el destino por host** — sin ese guard, quien pudiera escribir esa clave convertiria la function en un puente hacia donde quisiera.
- **⚠️ El trigger despachaba mirando SOLO la clave `email` del aviso al cliente.** Una etapa con `{"whatsapp": true}` y nada mas no disparaba nada: el interruptor de `/flujo` encendido **sin efecto**, que es la pantalla que miente que la migracion `20260813000003` vino a evitar, entrando por la puerta de al lado. **Al agregar un canal a un aviso, revisar la condicion que decide el DESPACHO, no solo la que elige el destinatario.**
- **⚠️ Un campo de TEXTO LIBRE llega mucho peor de lo que se supone, y el orden de la limpieza decide el resultado.** Medido sobre los abiertos de SOENA: 15 formas de teléfono conviviendo. Tres no se resuelven quitando lo que no sea digito: `3001234567.0` (**el cargue leyo la celda de Excel como NUMERO**, y limpiar primero lo convierte en once digitos, un numero que no existe), `+57 +57 300...` (indicativo duplicado) y **tres usuarios de Instagram guardados como telefono**. `telefono_cliente_negocio` corta el decimal ANTES de limpiar, colapsa los `57` repetidos y solo entonces exige movil colombiano; un fijo y un handle se descartan devolviendo NULL. Hermana de `email_cliente_negocio` y por la misma razon: sus consumidores viven en runtimes distintos.
- **⚠️ El canal con MENOS cobertura era el unico que existia.** 242 de 256 negocios abiertos tienen celular utilizable (95%) contra 170 con correo (67%). Antes de dar por bueno el canal de un aviso, contar a cuantos alcanza de verdad.
- **Lo que se dispara NO se reporta como enviado** (`whatsapp_disparado`, no "enviado"): un 200 del proveedor dice que el disparo se recibio, no que el mensaje llego. Y **fuera de la ventana de 24 horas WhatsApp solo entrega plantillas aprobadas por Meta**, cosa que el proveedor no documenta y esta preguntada: hasta saberlo, afirmar "avisado" seria inventar.
- **Los dos canales del cliente son independientes y cada uno tiene su try**: un fallo del proveedor de WhatsApp no puede dejar al cliente sin el correo que si salio, ni al reves.
- **Metodo:** las dos migraciones ensayadas en transaccion con `rollback` contra produccion antes de escribirlas en firme; la funcion probada **ejecutandola sobre negocios reales** (242 de 242 en formato E.164, 0 malos) y con 9 casos limite corridos sobre un negocio real; el motor medido **en las dos direcciones** (etapa sin aviso → 0 disparos; etapa solo-whatsapp → exactamente 1) junto con el avance de etapa completandose, que es el riesgo real de tocar esa funcion. Verificacion final leyendo el codigo **desplegado en el servidor**, no el "Deployed" del CLI.

---

**Sesion:** 2026-08-13→14 (`soena--ve` → producto: **el control que ya existia llega a tiempo: el aviso de honorario aparece ANTES de llenar el formulario de pago**). PRs **#285** y **#289** mergeados y desplegados; las 2 migraciones aplicadas en produccion; interruptor **encendido** en la linea GIT EV/HEV.

- **⚠️ Un control puede estar bien construido y aun asi no servir, porque llega tarde.** El trigger de `cobros` rechazaba el registro sin honorario confirmado, pero el operador se enteraba **despues** de teclear referencia y valor: un rechazo seco, sin decir que hacer. El frente no agrego una barrera nueva, movio la que habia hacia adelante en el tiempo. Al evaluar un control, preguntar en que MOMENTO del trabajo aparece, no solo si bloquea lo correcto.
- **⚠️ La MISMA bandera puede significar cosas distintas segun el bloque que la recibe, y el efecto util en uno es el efecto contrario en otro.** `_faltaHonorarioConfirmado` en la **propuesta** ABRE la edicion aunque el caso ya haya avanzado (sin eso el guard deja el caso sin ningun lugar desde donde destrabarse); en las superficies de **pago** solo dispara el aviso. La excepcion de `editable_siempre` quedo acotada por tipo de bloque: propagarla tal cual le habria abierto la edicion a un bloque de pago, justo lo contrario de lo que el flag pide. Al reusar una bandera existente en un consumidor nuevo, revisar que hace en los consumidores viejos.
- **La lista de banderas que vuelven a un bloque "superficie de captura de dinero" vive en UN archivo** (`src/lib/negocios/superficie-cobro.ts`), no copiada entre el servidor que inyecta el flag y el dispatch de la pantalla que elige el componente. Copiada, se desincroniza el dia que aparezca una superficie nueva, y **el sintoma seria un aviso que deja de mostrarse sin que nadie lo note**. Misma familia que el guard con el catalogo de status copiado a mano (2026-08-03).
- **El texto del aviso sale de `MENSAJE_HONORARIO_PENDIENTE`**, la misma constante que usa el motivo del servidor. Escrito dos veces, la pantalla y el rechazo terminarian diciendo cosas distintas sobre el mismo bloqueo.
- **El FAB no puede recibir el flag precomputado y por eso PREGUNTA.** Elige el negocio de una lista de todos los abiertos (254 en SOENA): resolverlo por fila costaria una llamada por negocio. Pregunta una sola vez al elegirlo, con la RPC `negocio_puede_recibir_cobro`, la misma funcion que sostiene el trigger. **Ante `null` o error se deja pasar**: el trigger sigue siendo la barrera dura, y un aviso que aparece por no poder leer el estado ensena a ignorarlo.
- **⚠️ Un cero en la medicion puede ser correcto y aun asi haber salido de un instrumento roto.** Al medir cuantos casos frenados verian el aviso hoy, la consulta dio **0**; al revisar el instrumento aparecieron bloques de pago en etapas con 21 y 36 negocios abiertos, o sea que el cero olia mal. Resulto **cierto**, pero por una razon que no era la supuesta: en Validacion y Propuesta el bloque "Pagos" esta `desactivado`. Confirmar el cero contra el catalogo tomo dos consultas y cambio la conclusion que se iba a reportar.
- **El alcance se midio ANTES de encender**, con la config prendida dentro de una transaccion con `rollback` y `discard plans` entre medio: **56 de 254 abiertos** quedan frenados (21 en Validacion, 35 en Propuesta), **ninguno en etapa de cobro**, y **cero** de los 90 cobros de los ultimos 30 dias seria rechazado hoy.
- **Verificado contra el comportamiento, no contra el catalogo.** Ensayo con `rollback` tras encender: V0106 (sin honorario) **rechazado** con el mensaje del trigger, V0254 (con honorario) **pasa**. Ese segundo caso es el que hace valida la prueba: sin el, un insert mal formado se leeria como "el gate funciona". Cero cobros residuales.
- **Orden de encendido:** merge y **deploy** del aviso primero, interruptor despues. Prenderlo antes deja una ventana en que el trigger frena sin que la pantalla explique por que — la misma clase de ventana que este archivo ya documenta para copy y calculo que deben viajar juntos.
- **Hallazgo abierto, para finanzas:** los 4 casos cuyo honorario se cargo desde el Sheet (V0231, V0246, V0247, V0248) tienen **recaudo cero** en ONE mientras el Sheet registra un abono para cada uno. O los pagos no estan registrados, o esa columna es el acuerdo de pago y no un recaudo. Mover plata no es decision del agente.

---


**Sesion:** 2026-08-12→13 (`soena--ve` → producto: **cada etapa decide a quien avisa, y un aviso que el cliente puede recibir**). PRs **#267, #269, #270, #273, #281, #283** mergeados y desplegados.

- **Aviso por etapa con DOS destinos, equipo y cliente (`/flujo`, opt-in por etapa).** El aviso interno existia y se declaraba por SQL; ahora se prende y apaga con un interruptor, junto al SLA. El de cliente es nuevo. Apagar **no borra la config**: `avisar_al_entrar.activo=false` conserva areas, titulo y mensaje que alguien redacto (ausente = encendido, nadie cambia).
- **El correo al cliente sale del operador, hablando de parte del workspace.** Remitente `{Workspace} (via MeTRIK)`, `reply_to` al **comercial del negocio**, sin enlace a la plataforma (el cliente no tiene cuenta). **Si no hay a donde responder, el correo deja de invitar a responder**: prometer una respuesta que cae en un buzon sin dueno es peor que no ofrecerla.
- **`email_cliente_negocio(negocio_id)` vive en SQL, no en TypeScript.** Los dos consumidores estan en runtimes distintos (la edge function corre en Deno y no puede importar de `src/`), y dos copias de la regla se desincronizarian sin que nadie lo note: el sintoma seria "a unos clientes les llega y a otros no". Precedencia `contactos.email` -> email del RUT.
- **⚠️ Un `required` sobre un TOGGLE no obliga a decir que si, solo a mirarlo.** Un toggle `required` en `false` cuenta como respondido: el bloque queda `completo` y su gate deja pasar. En SOENA un caso llego cinco etapas mas adelante con una tarifa de $701.812 que el sistema leia como cero, porque el consumidor exige el toggle en `true`. Para exigir el SI hace falta el gate computado `campo:<slug>=true`, aparte del `required`.
- **⚠️ El flag `desactivado` se respetaba en el negocio y en los gates, pero NO en el diagrama.** `/flujo` y `/admin/workflows` seguian dibujando y contando los bloques desactivados, asi que el diagrama describia un proceso que la ejecucion ya no hacia — justo el drift que estas dos superficies no pueden tener. Corregido. **Al agregar una razon nueva por la que un bloque sale del flujo, revisar las TRES superficies: negocio, gates y diagrama.**
- **⚠️ Se escribieron DOS migraciones de funciones transcribiendo de memoria, y las dos estaban mal.** Aparecieron otras firmas de `crear_notificacion`, otro `search_path` y otros nombres de secretos. `avisar_entrada_etapa` cuelga del UPDATE de `negocios.etapa_actual_id`: aplicarlas habria roto el avance de etapa en produccion. **Este archivo ya documentaba el metodo correcto (editar la definicion volcada de la base, con cada reemplazo contado y abortando si no aplica) y aun asi se piso.** Si la funcion es larga, no se transcribe: se edita con un `do $$` que falla ruidosamente.
- **⚠️ Al condicionar un aviso, cerrar TODAS sus ramas.** Condicionar solo el reparto por areas dejaba viva la rama de destinatarios por stage, que habria seguido avisando al equipo con el aviso apagado. Medido en ambas direcciones antes de aplicar: solo-cliente -> 0 notificaciones internas; interno encendido -> las 2 de siempre.
- **⚠️ Filtros en la URL sin leerlos en el SERVIDOR = desajuste de hidratacion visible.** El hook `useEstadoUrl` (firma de `useState`) los guarda con `history.replaceState`, no con el router: un `router.replace` de la misma ruta refetchearia la lista entera en cada tecla. Pero el `page.tsx` tambien tiene que resolver los `searchParams`: sin eso el servidor pinta sin filtrar y el cliente hidrata filtrado, React descarta el subarbol y la lista parpadea. Medido: `value=""` en el HTML del servidor contra `value="abogal"` en el cliente.

---

**Sesion:** 2026-08-12 (`trappvel--clarity` → producto: **una pregunta del instrumento la formula el codigo, porque el prompt no la sostuvo**). PRs **#264** y **#265**, mergeados y desplegados.

Primer piloto del motor de Cardumen con personas reales (2 asesoras de un cliente). Los tres defectos que aparecieron no los habria encontrado ninguna simulacion, y los tres son de la misma familia: **una instruccion de estilo en el prompt no sostiene un paso critico.**

- **⚠️ El margen de reformulacion ES un hueco de plantilla.** El prompt pedia presentar la segunda narrativa "con estas palabras (o muy parecidas)". El modelo la reformulo en las DOS pruebas con personas: pregunto *"una vez que no salio asi"* donde el estudio dice *"algo que hayas tenido que hacer dos veces"*. Suenan equivalentes y piden otra clase de historia — la del estudio busca un REPROCESO, que era el dato que sostenia el diagnostico. Ahora el paso entre historias lo decide el codigo (`_shared/cardumen/narrativas.ts`) y el texto sale del literal del spec. Tercera ocurrencia del patron ya documentado en el cerebro (`instruccion-no-vence-hueco-de-plantilla`): **se quita el hueco, no se agrega la advertencia.** Corolario de diseño: si una pregunta es parte de un instrumento aprobado por el cliente, su literal no se le delega al modelo.
- **⚠️ Cubrir las dimensiones de una fase NO es haber escuchado la historia.** El presupuesto de profundidad solo tenia tope, no piso, asi que con la fase 1 resuelta en un solo turno la primera historia se quedaba sin una sola repregunta: medido, **4 repreguntas sobre la segunda y ninguna sobre la primera**. Se agrego un piso de 1 por historia. Lo detecto Mauricio leyendo la conversacion ("me parece que profundizo en la segunda pregunta pero en las demas no"), no una prueba.
- **⚠️ Un bloque del prompt que se contradice a si mismo: gana el que da trabajo concreto.** El bloque de preguntas de cierre autorizaba *"UNA repregunta abierta si la respuesta fue muy corta"* y dos lineas despues prohibia cualquier repregunta sobre ellas. Con una pregunta de cierre que pide un caso, esa licencia es justo el hueco. Se quito la linea.
- **⚠️ El encuadre prometia CINCO preguntas y el spec tenia cuatro.** Una pregunta del instrumento aprobado no estaba en el spec y nadie lo noto: el bot anunciaba cinco, hacia cuatro, y las dos cifras vivian en sitios distintos (el encuadre en `encuadre`, las preguntas en `spec`). Repuesta por migracion `20260812210000`. **Cuando un texto declara cuantas cosas va a hacer y esas cosas viven en otra estructura, hay que comprobar el numero contra el dato, no leer el texto.** Familia de los gotchas de verificacion de este archivo.
- **La regla del paso entre historias vive en UN archivo** (`narrativas.ts`), consumido por el motor (que lo impone) y por el mensaje de estado (que se lo informa al modelo). Escrita dos veces, el modelo redactaria una pregunta mientras el sistema envia otra.
- **Metodo:** la prueba corre contra `nextTurn` real con un modelo falso que reproduce la reformulacion observada, y se vio **fallar 3 de 4 comprobaciones contra el codigo de `main`** antes de confiar en ella. Una comprobacion inicial pasaba por la razon equivocada (el modelo falso dejaba de profundizar por su cuenta, no porque el codigo lo frenara) y se reescribio con un escenario que si lo prueba.

---

**Sesion:** 2026-08-11 (`soena--ve` → producto: **corregir el dato que decidio una ruta ya recorrida PROPONE devolver el caso al tramo que se salto**). PR **#253**.

- **⚠️ Corregir hacia adelante no arregla la decision YA TOMADA.** `propagarCamposDerivados` escribe los campos derivados en la misma operacion que la respuesta, para que la PROXIMA decision no use el dato viejo. Pero el routing solo se evalua hacia adelante dentro de `cambiarEtapaNegocioConGate`, asi que la decision que ya se tomo no se revisa nunca: **el dato queda bien y el caso se queda en la via equivocada**, sin error y sin aviso. Caso V0122: el bloque que gobierna la bifurcacion de Documentacion se creo el 03-ago y el negocio habia avanzado el 01-ago; nadie respondio la pregunta, `requiere_certificacion_upme` quedo en `false` y el caso se salto Cargue, Pago UPME y Certificacion. Ahora se detecta y se **propone**: `src/lib/negocios/reversa-ruta.ts` (reglas puras, 28 pruebas) + `src/lib/correcciones/reversa.ts` (ejecucion). Opt-in por LINEA (`lineas_negocio.config_extra.reversa_ruta.activa`); sin esa clave ninguna linea cambia.
- **Nunca automatico, y por eso la propuesta se PERSISTE.** Devolver un caso reabre gates de saldo y puede dejar cobros y cuentas emitidas en desacuerdo con la etapa: lo decide una persona (`puedeDevolverCasoPorRuta`, owner/admin/supervisor, **fuente unica** que consumen el guard del servidor y la pantalla). La propuesta queda en `negocios.metadata.reversa_ruta_pendiente` en vez de mostrarse y desaparecer, porque **quien corrige el dato casi nunca es quien puede decidir mover el caso**. Las dos salidas (aplicar y descartar) exigen motivo escrito: si el equipo descarta siempre la misma propuesta, lo que esta mal es la configuracion de la linea, y sin el motivo eso no se ve.
- **⚠️ La propuesta guardada avisa; para MOVER manda la recomprobacion.** Entre que se detecta y que alguien la aprueba, el caso pudo moverse o el dato pudo cambiar otra vez. `aplicarReversaDeRuta` vuelve a calcular la divergencia contra el estado de AHORA y, si ya no aplica, retira el aviso en vez de mover. Mover por una propuesta vencida seria exactamente el error que esto viene a evitar.
- **⚠️ La AUSENCIA de una etapa en el recorrido tiene explicaciones legitimas, y contarlas todas como omitidas propone devolver casos sanos.** Dos, y las dos costaron una correccion despues de medir contra produccion: (a) una etapa **sin casillas configuradas** no puede dejar prueba de haber sido recorrida (la prueba es tener instancias de sus bloques), asi que apareceria omitida para siempre; (b) una etapa que el motor **salta por saldo cubierto** se salta a proposito. Medido en V0107/V0114: fueron de Documentacion a Cita saltandose CINCO etapas, y **dos de ellas (Precobro y Cobro) por el salto por saldo, que es correcto**. Sin ese filtro la propuesta las habria listado, y en el peor caso habria propuesto devolver el caso a una etapa que no tenia nada que hacer. El criterio del salto NO se reimplementa: se reusa `aplicaSaltoPorSaldo` de `salto-etapa.ts`. Nota de diseño: se ignoran en bloque en vez de recalcular su saldo, porque **el saldo de hoy no dice que saldo habia el dia que el caso paso por ahi**.
- **⚠️ Un caso que sigue EN el punto de decision no diverge, y olvidarlo declara omitido medio proceso.** Lo destapo una prueba, no una revision: si el caso no se ha ido de la etapa que bifurca, el recorrido simulado nunca vuelve a tocarla, no encuentra donde parar y se va hasta el final del flujo. Es el peor falso positivo posible porque llega **justo cuando alguien acaba de corregir bien**. Mismo corte que ya aplicaba `debeRetornar` en el retorno al punto de decision.
- **`reversa` y `retorno` son hermanos, no compiten.** `retorno.ts` devuelve al punto donde el dato se EVALUA y archiva lo que dependia de esa decision; la reversa devuelve a la primera etapa OMITIDA y **no archiva ni vacia nada** (el trabajo aguas abajo es valido; lo que falto es el tramo que nunca se recorrio). Conviven porque la deteccion corre DESPUES del retorno: si el retorno ya movio el caso, este queda EN la etapa de decision y la reversa no propone nada. Invertir ese orden los pone a pisarse.
- **El movimiento reusa `cambiarEtapaNegocio`, inyectado como parametro.** Esa funcion **no esta huerfana**: no la llama la UI, pero es el movedor interno de `cambiarEtapaNegocioConGate`, y es la que crea las instancias de las casillas de la etapa destino con su herencia. Se inyecta (`moverEtapa`) en vez de importarse dentro de la lib para no cerrar un ciclo de imports contra las server actions. **Y el `avisar_al_entrar` sale solo**: lo dispara el trigger `trg_avisar_entrada_etapa`, que cuelga del UPDATE de `negocios.etapa_actual_id`. Corolario para cualquier movimiento de etapa futuro: mover con un UPDATE que esquive ese trigger (o con la replicacion desactivada) rompe el aviso en silencio; **un `update` por SQL SI lo dispara** — lo que se pierde no es el trigger, es el movimiento que nunca se hizo.
- **`propagarCamposDerivados` ahora devuelve los slugs derivados que cambiaron.** Hacia falta porque **el campo que gobierna una bifurcacion casi nunca es el que el equipo toca**: es su consecuencia (el patron de "una sola pregunta, varios interruptores"). Sin eso, una correccion que mueve el decisor por derivacion pasaria desapercibida. Los callers viejos ignoran el retorno; no cambia comportamiento.
- **Alcance medido antes de dar por bueno el mecanismo:** con la config apagada (hoy) no hay un solo caso afectado, y con ella encendida **ningun negocio abierto de SOENA muestra propuesta**, porque V0122 ya se corrigio a mano y V0107/V0114 todavia tienen el dato en `false` — la propuesta les aparecera el dia que alguien lo corrija, que es exactamente cuando debe aparecer.

---

**Sesion:** 2026-08-11 (`metrik-one--core` → producto: **el valor de un negocio se desglosa en un solo lugar, y un pago pasa a ser el hito de completar un tramo**). PRs **#246** y **#250** mergeados; las 4 migraciones aplicadas en produccion.

Dos frentes encadenados, y el segundo salio del primero: al llevar el desglose del precio al lado de los cobros aparecio un error mas grande que el que abrio la sesion.

- **`negocios.precio_aprobado` guarda el honorario CON IVA, y cada consumidor decidia por su cuenta si lo descontaba.** Dos dividian por el literal `1.19`, cuatro no descontaban nada. La misma venta se veia distinta segun la pantalla, y `v_mc_negocio` comparaba un ingreso CON IVA contra costos SIN IVA: el margen acumulado de SOENA estaba inflado en **$19,2M**. Fuente unica `v_negocio_valor` (total, base, IVA) y los consumidores reescritos. **El inventario del brief decia 6 y eran 8**: aparecieron `cs_estado_pagos` y `cs_identificar_cliente` buscando la formula por su FORMA en la base, no por la lista heredada.
- **⚠️ Lo que entra a la cuenta NO es todo ingreso, y el IVA era el menor de los dos errores.** En SOENA el cliente paga honorario mas la tarifa que se le gira a la UPME en una sola referencia. Medido: de **$63.138.351** cobrados, **$21.041.601 (33%)** excedian el honorario aprobado, en 32 casos. Plata de terceros contada como ingreso propio. Corregir solo el IVA habria dejado el P&L igual de falso pero con aspecto de corregido, **que es peor: una pantalla rota se ve, una pantalla sana que miente no**.
- **⚠️ Un dato que el negocio NUNCA produce no se captura: se DERIVA.** "La tarifa de la UPME nunca va a llegar clasificada como tal; es la diferencia entre lo que paga el cliente y el honorario" (Mauricio). Por eso se descarto tanto pedirla en la captura como reclasificar los cobros historicos: marcar a mano congelaria hoy una derivacion que puede cambiar. Pedir que se capture un dato asi produce un campo vacio que el sistema cree lleno, que es el fallo mudo que este archivo ya documenta varias veces.
- **Un pago no es una transaccion, es un HITO.** "Pago 1" es que se COMPLETE el tramo 1 del honorario; "pago 2", el tramo 2. Al cliente no se le puede exigir que pague estructurado: si hace su 50% en cinco transferencias, es su decision. De ahi que el grano no sea el cobro sino la CUENTA: tramo 1, tramo 2 (solo Plan 1) y tarifa, cada una con techo. `v_cobro_valor` imputa; `src/lib/upme/imputacion.ts` es su espejo puro con 17 pruebas, y ese contrato es lo unico que delata si una de las dos cambia sin la otra.
- **⚠️ El orden de imputacion se valida contra los CASOS REALES, no contra la regla literal.** La regla dada fue "primero honorario, segundo tarifa, tercero al balde". Al pie de la letra, en Plan 1 un pago de 50% mas tarifa completa **los dos tramos** y dispara el hito "pago 2" el dia uno. Un test rojo lo destapo, y los cinco casos de Plan 1 medidos lo confirmaron al peso: V0025/V0099/V0103 pagan `$1.126.812 = 425.000 (50%) + 701.812 (tarifa)`; V0277/V0287 pagan `$701.812`, la tarifa sola. El orden correcto es **tramo 1 → tarifa → tramo 2 → excedente**: el tramo 2 se paga al exito, asi que no puede llenarse con la plata que trae la tarifa. Con el, los cinco quedan en excedente CERO.
- **⚠️ Una casilla alimentada por un campo que nadie escribe muestra $0 para siempre.** El tablero calculaba `segundo_pago` como la suma de cobros con `tipo_cobro = 'saldo'` y `tarifa_recaudada` con `'pasante'`. Medido sobre los 89 cobros de SOENA: 66 `anticipo`, 24 `pago`, 2 `externo`, **cero `saldo` y cero `pasante`**. O sea que el segundo pago mostraba cero SIEMPRE y el primero se llevaba todo el recaudo con la tarifa adentro. Ahora salen de la derivacion. Al construir una metrica, revisar quien ESCRIBE el campo del que depende, no solo quien lo lee.
- **⚠️ Un criterio de UN cliente aplicado a todos los workspaces le borra ingreso a los demas.** Topar el recaudo contra el valor del negocio es el modelo de SOENA (honorario mas tarifa de tercero). Aplicado a ciegas, **ana-demo perdio $900.000** de ingreso por un excedente que en su modelo significa "el precio esta desactualizado", no "entro plata ajena". Ahora es opt-in por `config_extra.recaudo.topar_por_valor` (linea gana sobre workspace) y **el default reproduce el comportamiento previo**: quien no declara nada recibe lo que ya tenia, no una suposicion. Mismo criterio para la tarifa de IVA (`config_extra.honorario.iva_pct`): cada workspace tiene su propia configuracion.
- **⚠️ NO se asume 19% para quien no lo declaro.** Resuelven los 268 negocios de SOENA (por propuesta aprobada o por el servicio de su linea); afi, metrik, ana-demo, advise, wmc-sm y dimpro quedan `sin_declarar` y **su MC no se movio un peso**, verificado. Elegir 19% por defecto habria movido las cifras de cinco workspaces sobre una respuesta que nadie dio. El umbral de lo que cambiaria si declararan esta medido en el spec.
- **Tres indicadores que estaban clavados en valores imposibles volvieron a rangos reales:** la tasa de recaudo de SOENA paso de **196%-231% a 95,5%**, la tarifa recaudada de **$0 a $14,6M** en agosto, y los casos completos de **100% invariable a 92%**. Los tres mentian por la misma causa: comparar plata que traia tarifa contra un valor que no la incluia.
- **Metodo:** todo medido ANTES de escribir; cada migracion ensayada en transaccion con `rollback` contra produccion; el antes/despues calculado **dentro de la misma transaccion** con `discard plans` entre medio, para no comparar contra una linea base que la operacion ya movio. Invariante verificada en las cuatro cuentas: su suma es exactamente lo cobrado, descuadre CERO en todos los workspaces.
- **Hallazgo abierto, ya reportado a SOENA:** V0256 tiene **dos filas de cobro identicas** ($510.000, misma fecha, misma referencia, mismo `split_id`). No es sobrepago del cliente: es doble registro, y explica casi todo el excedente de SOENA ($511.808; el resto son $1.808 de redondeo bajo la tolerancia). La anulacion del PR #248 es la via para corregirlo cuando la financiera responda.
- Spec completo: `docs/specs/2026-08-10_valor-negocio-base-iva.md`. Frente derivado: `proyectos/metrik/one/2026-08-11_frente-tarifa-upme-derivada.md`.

---

**Sesion:** 2026-08-11 (`soena--ve` → producto: **el pago fuera de la pasarela se ve, lleva soporte, y un cobro deja de borrarse para poder anularse**). PR **#248**.

- **⚠️ Una pantalla que solo ESCRIBE no puede evitar el error que causa.** La pestaña de pago fuera de ePayco registraba y no mostraba nada de lo ya registrado. La referencia `378962162` (pago real de $1.020.000) termino con **$2.040.000 registrados**: el reparto de V0256 consumio el total y tres dias despues alguien volvio a cargar el total completo contra V0258. Quien lo cargo **no tenia como saberlo**. El listado debajo del formulario es la pieza mas barata del frente y la unica que ataca la causa: hace visible el duplicado en el momento de cometerlo. Regla general: toda superficie de captura de dinero muestra lo ya capturado, en la misma pantalla.
- **⚠️ El control de un pago repetido es sobre el MONTO, nunca sobre la unicidad de la referencia.** Una restriccion `unique` sobre `external_ref` habria "arreglado" el duplicado y roto el **reparto**, que es una necesidad real y tiene casos correctos en produccion (V0043/V0064, y el 50/50 de V0277/V0287). El criterio correcto: alertar cuando la SUMA registrada bajo una referencia supere el pago original (`src/lib/cobros/sobreasignacion.ts`, puro y probado). Atrapa el duplicado y deja pasar el reparto. La alerta va **antes de guardar** y se pasa con justificacion escrita, no con un clic.
- **⚠️ Un pago repartido tiene que DECLARARSE como reparto, o el resto del sistema lo lee como duplicado.** Al registrar una referencia que ya existe, se estampa un `split_id` compartido y el `split_total` en **todas** las porciones, incluidas las que ya estaban. Si una queda sin `split_id`, `refDuplicadaNoSplit` y `negocioCongeladoPorDuplicado` la ven como duplicado accidental y **congelan los dos negocios**. Permitir la referencia compartida sin declarar el reparto habria cambiado un problema por otro peor.
- **⚠️ Un cobro anulado NO puede seguir contando, y filtrarlo en cada sumador es un inventario que nadie puede cerrar.** `cobros.monto` lo suman 5 vistas, ~10 funciones SQL y ~40 sitios de TypeScript. Decision: al anular, **`monto` pasa a 0** y el valor original se preserva en `monto_anulado`. Ningun sumador puede contarlo, ni los de hoy ni los que se escriban manana, sin tocar una linea. Es la misma leccion del gotcha de la formula de saldo que un handoff declaro "en tres sitios" y estaba en cuatro. **Corolario para quien lea datos: en una fila anulada, `monto` NO es el monto** (`src/lib/cobros/anulacion.ts`).
- **⚠️ Lo que el cero NO resuelve es lo que cuenta por PRESENCIA.** Cuatro sitios necesitaron `anulado_at is null` explicito, y cada uno rompia de forma distinta: `refDuplicadaNoSplit` (bloquearia re-registrar la referencia liberada), `negocioCongeladoPorDuplicado` (dejaria dos negocios congelados para siempre), la idempotencia de `registrarPagoEnNegocio` (devolveria "ya existe" y no volveria a insertar) y la del auto-cobro de anticipo (**UPDATE**earia la fila anulada, resucitandola con motivo y autor intactos). Al construir un borrado logico, separar los sumadores (que el cero resuelve) de los contadores por presencia (que no).
- **⚠️ Dejar de sumar la plata no deshace las decisiones que ya se tomaron con ella.** El gate de anticipo se cierra solo cuando el saldo lo cubre (`_completado_via: 'saldo'`), y ese cierre queda escrito. Anular sin reabrirlo deja el caso avanzando con plata que ya no existe. `recalcularNegocioPorCambioDeRecaudo` (negocio-v2-actions) des-concilia, reevalua los bloques de cobros y **reabre solo los gates cerrados por saldo** — un gate que alguien cerro a mano no se toca, porque no fue esta plata la que lo cerro. No revierte un avance de etapa ya ocurrido: eso lo decide una persona.
- **El monto y el negocio NO se editan.** Los dos mueven plata: cambiarlos en caliente deja un saldo distinto sin rastro del valor anterior. Se anula y se vuelve a registrar, y quedan las dos filas. Lo descriptivo (fecha, cuenta, referencia, nota) si se corrige, y cambiar la referencia vuelve a pasar por la alerta de sobre-asignacion sobre la referencia destino.
- **Permisos con fuente unica:** `puedeGestionarPagosExternos` (can-edit.ts), hermana de `puedeAutorizarCierreNoFacturable`. La consumen el guard del servidor (`ctxPagosExternos`) **y** la pantalla, que decide con ella si dibuja los botones. El soporte va por la via de archivos que ya existe (Storage `ve-documentos` -> carpeta del negocio en Drive); **si Drive no responde, el soporte queda en Storage y la fila lo declara pendiente** — perder el registro del pago porque Drive fallo seria peor.
- **⚠️ Un path de Storage que llega del navegador y se lee con el cliente de SERVICIO necesita validacion de prefijo.** El service client no pasa por RLS: sin comprobar que el path empieza por el workspace de la sesion, un soporte de otro tenant se archivaria como propio. La policy del bucket ya lo exige para el cliente autenticado; el server-side tiene que repetirlo.
- **Opt-in por workspace** en `config_extra.pagos_externos` (`soporte_obligatorio`, `drive_subfolder`, `cuentas`). El default de `soporte_obligatorio` es **true**: un workspace que no declara nada recibe la decision, no la ausencia de ella; apagarlo exige declararlo.

---

**Sesion:** 2026-08-11 (`metrik-one--core` → **ninguna funcion de trigger es alcanzable sin sesion**). Continuacion del frente de grants. PR **#249**. Migracion aplicada en produccion y verificada.

- **48 funciones de trigger perdieron `EXECUTE` para PUBLIC, `anon` y `authenticated`.** Es la parte del frente de grants que el `ALTER DEFAULT PRIVILEGES` no podia cubrir: en funciones el REVOKE explicito es el unico mecanismo. Resultado medido: funciones de `public` ejecutables por `anon` **100 → 52**, y de esas las `SECURITY DEFINER` **26 → 3** (las tres intocables: `current_user_workspace_id`, que invocan **217** policies, mas `is_admin_or_owner` y `get_user_role`, verificada que sigue ejecutable).
- **⚠️ El criterio no era `SECURITY DEFINER`, era `returns trigger`.** El pendiente hablaba de 23 funciones, que son las `SECURITY DEFINER`. Al consultar por lo que de verdad importa aparecieron **48**: las otras 25 son triggers normales (`set_updated_at`, `update_updated_at_column`, `trg_*_auto_codigo`). Ninguna de las 48 se invoca por RPC, y PostgREST **ni siquiera expone funciones que retornan `trigger`**. Cerrar solo las 23 habria dejado media familia abierta por una distincion que no venia al caso. **Al cerrar una familia de objetos, el criterio se toma de para que sirve el objeto, no de la etiqueta con la que se conto la primera vez.**
- **⚠️ PostgreSQL NO exige `EXECUTE` al DISPARAR un trigger, solo al crearlo.** Era la duda que decidia si esto era gratis o rompia produccion, y se comprobo en vez de razonarse: con tabla, funcion `SECURITY DEFINER` y trigger propios, tras revocar a los tres roles y con `has_function_privilege('authenticated', f, 'execute')` en **false**, el INSERT se completo, el trigger corrio, modifico la fila y escribio en su tabla de log.
- **Verificado tambien contra el producto, no solo contra el catalogo.** Ensayo con `rollback`: 48 → 0 y un INSERT real en `negocios` funcionando. Repetido **despues** de aplicar: INSERT OK con `negocios_init_etapa_cambiada_at` (SECURITY DEFINER) y `trg_negocio_auto_codigo` (no SECDEF) disparando ambos. Los 66 triggers activos de `public` siguen ahi.
- **La migracion revoca por criterio, no por lista de 48 nombres.** Una lista de ese tamano se copia mal; el criterio no. La comprobacion final cuenta sobre `pg_proc`, no sobre lo que el bucle dice haber ejecutado.
- **Antecedente:** el PR #15 ya habia revocado `authenticated` en 21 triggers puros sin consecuencias. Esto lo completa y agrega **PUBLIC**, que era el que dejaba la puerta abierta (`revoke ... from anon` a secas no basta, gotcha #185).
- **⚠️ La guarda de migraciones NO corre cuando el PR tiene conflicto, que es justo cuando mas falta hace.** Este PR toca `supabase/migrations/` y aun asi registro **cero** workflow runs: con `mergeable: CONFLICTING` GitHub no puede construir el merge commit y los workflows `on: pull_request` **no se encolan**. Cerrar y reabrir el PR no los despierta; solo resolver el conflicto. El sintoma enganña porque los demas checks (Vercel) SI aparecen en verde, asi que el PR se ve revisado. **Al leer los checks de un PR, comprobar que el workflow que importa efectivamente corrio, no que no haya rojos** — un check ausente y un check en verde se parecen demasiado. Misma familia que los gotchas de verificacion: la ausencia de senal no es senal de que todo este bien.

---

- **⚠️ `next/font/google` DESCARGA la fuente en cada build: un 404 del CDN de Google tumba el build entero.** El preview del PR #241 fallo con 20 errores de `Module not found: '@vercel/turbopack-next/internal/font/google/font'`, que apuntan a un modulo interno de Turbopack y no dicen nada de la causa. La causa estaba **cinco lineas antes** en el log, como *warning*: `fonts.gstatic.com` respondio **404** a los cinco `.woff2` de Montserrat. Sin el archivo descargado el CSS generado no resuelve, y `npm run build` sale con 1. El mismo commit, sin tocar una linea, compilo verde al reintentar. **Al leer un build roto de fuentes, buscar el `Received response with status` antes que el `Module not found`.**
- **Fix: las tres familias pasan a `next/font/local`** con el `.woff2` variable del subset `latin` versionado en `src/app/fonts/` (86 KB: Montserrat 35, Geist 29, Geist Mono 23). **Se autoalojaron las tres, no solo la que fallo** — entraban por la misma linea y por la misma dependencia de red, asi que dejar dos conserva el modo de fallo intacto. Para actualizarlas: bajar el `.woff2` del bloque `/* latin */` de `fonts.googleapis.com/css2?family=<Familia>:wght@100..900` y reemplazar el archivo.
- **El splash tambien pedia Montserrat a `fonts.googleapis.com` por `@import`**, o sea que la primera pantalla del producto dependia de una red ajena. Ahora usa `var(--font-montserrat)`. **Queda un `@import` a proposito** en `src/app/(app)/facturacion/cuenta-cobro-pdf.tsx`: ese HTML se imprime en el navegador y no pasa por el build; si Google no responde, ese PDF sale en Arial.
- **⚠️ En Vercel, la configuracion de PROYECTO gana sobre la de TEAM, y el cambio parece aplicado.** Se fijo la maquina de build en el team (`resourceConfig.buildMachine.default`) y el proyecto siguio en `elastic` por su propio `buildMachineSelection`. La respuesta del PATCH al team se ve correcta; el override solo aparece leyendo `GET /v9/projects/{id}`. Misma familia que los gotchas de verificacion de este archivo: **comprobar desde el objeto que manda, no desde el que se toco.** Valores validos de `buildMachineSelection`: `elastic` | `fixed`.
- **⚠️ Al pasar a Pro, Vercel enciende on-demand concurrent builds por su cuenta** (`elasticConcurrencyEnabled: true`, con marca de tiempo del upgrade) y **eso se cobra por concurrencia**. Apagado deja 3 builds concurrentes gratis, contra 1 en Hobby. Revisar `resourceConfig` del proyecto despues de cualquier cambio de plan.
- **El plan es Pro desde el 2026-08-11** (ciclo 11-ago a 11-sep, un asiento). Configurado: build machine `standard`/`fixed` (4 vCPU), on-demand concurrency apagada, tope de gasto US$50 **sin** pausa automatica (pausar produccion sirve 503 a los clientes). El motivo del upgrade no fue capacidad: **Hobby restringe a uso no comercial** y exceder el tope no degrada, **apaga la funcion 30 dias**. El 4-ago se llego al 100% de las 4 CPU-hrs de Active CPU. **Queda desbloqueado el cron sub-diario** que este archivo documenta como limitacion: los 9 crons de `vercel.json` siguen diarios por inercia.

---

**Sesion:** 2026-08-10 (`metrik-one--core` → **lo que nace nuevo deja de nacer concedido a `anon`**). PR **#243** mergeado y desplegado.

- **El default de la base contradecia a este archivo, y ganaba el default.** Toda tabla nueva nacia con los siete privilegios para `anon` y `authenticated` (medido: 135 tablas de `public` asi para `anon`, 146 para `authenticated`; el "980" del brief eran filas de privilegio, no tablas). La seccion de convenciones afirmaba desde junio que las tablas nuevas exigian grant explicito. Nadie mentia: la convencion se escribio y el `ALTER DEFAULT PRIVILEGES` nunca se toco. **Una convencion que el default contradice no es una convencion, es una intencion**, y da la peor clase de seguridad, la que se siente cierta al leer la doc.
- **Lo destapo un respaldo bien hecho.** Las migraciones de datos del 09-10 de agosto crearon seis tablas con `CREATE TABLE ... AS SELECT`, que heredaron el default y quedaron sin RLS y con SELECT/INSERT/DELETE para `anon`, una con 173 filas de negocios. Escribir un respaldo antes de migrar es la buena practica; el defecto estaba debajo.
- **⚠️ El estado real era mejor de lo que sugeria el susto, y eso tambien hay que decirlo.** Verificado ejecutando como rol `anon` sin sesion, no leyendo policies: de las 123 tablas con escritura para `anon`, **122 ya estaban cerradas por RLS** y ninguna estaba sin RLS; la unica abierta es `cardumen_respuestas`, que lo esta a proposito (encuesta publica). Legibles sin sesion: **8 tablas**, todas catalogos globales sin datos de tenant. RLS estaba haciendo su trabajo. El problema no era una fuga, era que RLS fuera la **unica** capa y el default garantizara el grant esperando a la proxima tabla que naciera sin policy.
- **⚠️ El analisis del predicado no sustituye a ejecutar.** Leyendo `pg_policy` salian 6 tablas legibles sin sesion; ejecutando `count(*)` como `anon` salieron **8**. Las dos que faltaban (`etapas_negocio`, `lineas_negocio`) tienen predicados con subconsulta que el analisis estatico no evalua. Misma familia que los demas gotchas de verificacion: la prueba se calcula desde el dato, no desde la forma del codigo.
- **⚠️ La urgencia estaba sobredimensionada en este mismo archivo, y se corrigio.** Dos gotchas afirmaban que "cualquiera con la anon key del bundle podia vaciar la tabla" via TRUNCATE. Que TRUNCATE no pase por RLS es cierto y quedo verificado contra una tabla de prueba con deny-all (`anon` no veia una fila y la vacio igual). Que fuera alcanzable con la anon key, no: `anon` es NOLOGIN, PostgREST no expone TRUNCATE y hay cero funciones con TRUNCATE ejecutables por `anon`. Era superficie latente. Se revoco por higiene, no por incendio, y el texto quedo corregido: **un gotcha que exagera se descuenta entero la proxima vez que se lee.**
- **⚠️ En funciones el default NO se pudo arreglar, y la migracion no finge que si.** `ALTER DEFAULT PRIVILEGES` no alcanza el `EXECUTE` a PUBLIC que PostgreSQL concede nativamente: tras revocar `anon` del default, una funcion nueva nace sin `anon=X` y `has_function_privilege('anon', f, 'execute')` sigue dando **true**, porque `anon` entra como miembro de PUBLIC. Forzar la materializacion tampoco sirve. Se quito el revoke de funciones de la migracion en vez de dejarlo puesto: **un comando inutil con aspecto de proteccion es peor que no tenerlo.** Para funciones, el REVOKE explicito por migracion pasa a ser el unico mecanismo, y de eso responde la guarda.
- **Tres migraciones y una guarda.** `20260810120000` quita TRUNCATE/REFERENCES/TRIGGER a `anon` y `authenticated` (ningun cliente los emite; PostgREST solo genera SELECT/INSERT/UPDATE/DELETE y RPC). `20260810120100` quita el DML de `anon` con `cardumen_respuestas` re-otorgado de forma explicita. `20260810120200` cambia el default de tablas y secuencias. Las tres se ensayaron en transaccion con `rollback` contra produccion antes de escribirlas en firme, y ese ensayo es el que descubrio lo de las funciones.
- **CI nuevo, porque no habia.** `scripts/check-migracion-grants.mjs` + `.github/workflows/migraciones.yml` (primer workflow del repo): falla el PR si una tabla nace sin RLS o sin declarar su grant, o si una funcion nace sin revocar EXECUTE a PUBLIC. Se probo viendola **fallar** contra el caso exacto del incidente (`create table backup_x as select * from negocios`) antes de confiar en ella, y de paso pillo una tabla de verificacion en la propia migracion que la instaura.
- **`cliente_reposteria` cerrado** (`20260810120300`, aplicada). Hallazgo lateral del barrido: ese schema arrastraba el mismo default permisivo y **ninguna de sus 5 tablas tenia RLS**, cuando en `public` no quedaba ni una asi. Solo `productos` tenia datos (14 filas, intactas). Ahora: RLS en las 5, cero grants para `anon`/`authenticated`, y sin `USAGE` sobre el schema. `service_role` lo bypasea, asi que un consumidor server-side no se ve afectado; nada en el repo de ONE ni en el de MeTRIK lo referenciaba. Si aparece un consumidor legitimo con anon key, la vuelta atras esta escrita en la cabecera de esa migracion.
- **Las 4 migraciones estan aplicadas en produccion**, verificadas sobre el estado real de la base y no sobre el "success" del comando: cero TRUNCATE/REFERENCES/TRIGGER para `anon` y `authenticated`, cero tablas escribibles por `anon` fuera de `cardumen_respuestas`, una tabla nueva nace con `postgres=arwdDxtm,service_role=arwdDxtm` y nada mas, y `authenticated` sin cambio (148 tablas legibles, 139 con DML). Confirmado tambien en produccion el limite de las funciones: una funcion nueva sigue naciendo con `=X/postgres` y `anon=X`.

---

**Sesion:** 2026-08-10 (`soena--ve` → producto: **una etapa en blanco, un bloque que depende del dato y un gate que puede vencer**). PRs **#234, #235, #237, #240** mergeados y desplegados.

- **⚠️ La via "preferida" por slug dependia EN SECRETO de la via legacy, y el sintoma era una etapa EN BLANCO.** Detalle completo en el primer gotcha de la seccion de abajo. Lo que importa como metodo: **cuando un dato se puede declarar de dos formas y una es la recomendada, verificar que la recomendada funcione SOLA.** Aqui la nueva se apoyaba en la vieja y nadie lo noto porque casi toda la configuracion declaraba ambas. Y al diagnosticar: **un bloque invisible cuyo gate sigue exigiendo es la firma de que render y gate resuelven la referencia por caminos distintos.**
- **Un bloque heredado puede depender del DATO en vez de la rama (`editable_solo_si_vacio`, opt-in).** Lleno → solo lectura con su gate resuelto; vacio → editable. Nacio porque la alternativa (condicionar el bloque a la rama del proceso) dejaba al operador de la otra rama SIN VER el dato que necesitaba para trabajar. **Preguntar por el dato es mas simple que enumerar ramas, y no se desincroniza cuando el proceso gana una rama nueva.**
- **Un bloque puede invitar a otra area a editarlo (`areas_editoras`, opt-in).** El area dueña se deriva del stage de la etapa, y hay bloques cuyo trabajo real es de otra. **Amplia, nunca restringe**, y NO toca `canAdvanceStage`: registrar un dato no es mover el negocio. Para eso existe `areas_que_avanzan`, aparte y explicito.
- **⚠️ Al mover trabajo entre etapas, revisar quien MAS entra a la etapa destino** y si la rama que sale se queda sin su aviso de entrada. Los dos gotchas nuevos de abajo lo explican con las cifras medidas.
- **⚠️ Una comprobacion automatica que mira TEXTO DE PANTALLA en vez del dato miente en las dos direcciones.** Tres falsos resultados en una sola sesion: "la fecha no se guardo" (si se guardo; el bloque estaba colapsado tras recargar), "el aviso quedo editable" (el conteo miraba inputs de toda la pagina, incluido el de comentarios), "el gate bloqueo" (la guia de la etapa destino dice *"Faltan los anexos"* y el regex buscaba "faltan"). **Las tres las resolvio mirar la base o la captura.** Familia de los gotchas de verificacion ya escritos aqui: el instrumento tambien falla, y falla parecido a la verdad.
- **Metodo que si funciono:** alcance medido contra produccion ANTES de escribir codigo (3 bloques en toda la base, 4 casos que un gate habria frenado, 5 de 8 avisos ya hechos); cada migracion de datos ensayada con `rollback` y con guardas que abortan — **una de ellas aborto y tenia razon**: esperaba 7 casos y habia 6, y el error estaba en la expectativa, no en el dato.

---

**Sesion:** 2026-08-10 (`soena--ve` → producto: **un dato con varios vocabularios, y una atribucion que salia de la columna equivocada**). PRs **#236** y **#238** mergeados y desplegados.

- **⚠️ Un campo que se llama "responsable" NO es el responsable de lo que estas midiendo.** `negocios.responsable_id` es el responsable principal **derivado** (el asignado mas antiguo); desde que el negocio admite dos responsables con rol (`comercial` y `operaciones`), ese campo puede apuntar a un operativo. Las tres RPC comerciales agrupaban por el sin mirar el area, y por eso el tablero comercial listaba gente de operaciones. **Y la trampa esta en el fix obvio:** filtrar a los que sobran habria escondido que **9 de esos 16 negocios eran de otra persona** (la comercial real), dejando su cifra corta. Antes de filtrar a quien sobra, revisar si tapa algo que falta. Fuente unica en la vista `v_negocio_comercial`, consumida por las tres RPC — la leccion de la formula de saldo escrita en siete sitios.
- **⚠️ Un criterio derivado de TEXTO LIBRE se rompe el dia que alguien renombra.** `get_operaciones_bono_resumen` decidia quien es supervisor con `position ILIKE 'Supervisor%'`. `position` es campo libre y de esa clasificacion cuelga **la formula de su bono** (el del supervisor sale del promedio del equipo en cada indicador): cambiar el cargo a "Coordinadora de Operaciones" lo habria pasado a ejecutor sin que nadie tocara el tablero. El area ya se resolvia por `staff_areas` y el liderazgo debia resolverse por `profiles.role`. Al migrar un criterio asi, **medir primero que los dos clasifiquen igual hoy**: si no coinciden, el cambio mueve dinero.
- **⚠️ Recortar solo el dinero deja el resto en el payload.** El server action del bono ya borraba el `bono` ajeno antes de serializar, pero mandaba **la fila completa del supervisor** (nombre, cargo, puntaje, promedios) al navegador de cada operativo; la pantalla no la pintaba, y estaba ahi para quien abriera las herramientas del navegador. Si una fila no se puede ver, no se manda. Familia del gotcha ya escrito aqui: ocultar en React no es ocultar.
- **⚠️ Un mismo campo escrito por varios caminos termina con varios VOCABULARIOS, que es peor que varios olvidos.** `negocios.metadata.seccional` lo escribian tres caminos: el auto-init guardaba el label del catalogo (con buzon), el selector del 010 la clave de su preset (`"Otras seccionales"`, que ni siquiera es una seccional) y los scripts de cargue el texto del Excel sin tildes. Cada uno era correcto desde su punto de vista. Medido: Bogota partida en tres variantes (90+16+6 casos) y Medellin en dos (11+11). Fix: un solo camino de escritura que canoniza (`src/lib/negocios/seccional-negocio.ts`), y la vista que consume **tambien canoniza al leer**, para que un cargue nuevo no vuelva a partir una ciudad.
- **⚠️ Dos capas con vocabularios distintos + match exacto = fallo mudo.** El 010 buscaba su preset con `seccionales[valor]`, comparacion literal contra un vocabulario de 7 claves, mientras el catalogo tiene 35 seccionales. `"Bogota"` sin tilde no encontraba el preset de `"Bogotá"` y el formulario quedaba **sin la casilla 12 resuelta, en silencio**: 107 casos. Cuando dos capas nombran la misma realidad con vocabularios distintos, entre ellas va una **traduccion** (`presetKeySeccional`), no una comparacion.
- **Metodo — reescribir SQL largo a mano es donde se cuelan errores invisibles.** Las cuatro funciones se editaron sobre su definicion **vigente volcada de la base**, no transcritas, con cada reemplazo contado: si uno no aplicaba, el script abortaba en vez de dejar una funcion a medias. Control final **contra las funciones ya desplegadas** (`pg_get_functiondef`), no contra el archivo.
- **Metodo — la mutacion que NO tumba ningun test es la que ensena algo.** De las dos mutaciones probadas contra los tests nuevos, una tumbo 4 y la otra ninguna: esa segunda delato un hueco real de cobertura (faltaba el caso de una clave escrita distinto del canonico). Un test que pasa contra la implementacion mutada no esta probando nada.

---

**Sesion:** 2026-08-09→10 (`soena--ve` → producto: **ONE emite la factura contra Siigo, la archiva en el negocio, y el catalogo DIVIPOLA deja de escribirse a mano**). PRs **#224, #227, #228, #229, #230, #231** mergeados y desplegados.

- **⚠️ Validar un mapeo contra documentos ya emitidos es una prueba de LECTURA: no dice nada sobre ESCRIBIR.** El mapeo de cliente se habia validado comparando el payload contra facturas reales de SOENA y se dio por bueno. Al correr el backfill, Siigo rechazo los **167** terceros: ninguno se creo. Dos causas, y las dos son la misma leccion — **la forma que la API DEVUELVE no es la que ACEPTA**: (a) `id_type` se lee como objeto `{code, name}` y se escribe como cadena `"13"` (con el objeto responde "The field id_type is required"; con un numero, "Invalid data type"); (b) **`phones: []` se RECHAZA, pero omitir la clave funciona** — un arreglo vacio no equivale a ausente, y el error es generico ("could not be completed with the data you submitted"), sin nombrar el campo. Tras el fix: 175 de 175 terceros, cero errores.
- **Tecnica para probar un POST sin crear nada: mandarlo con una llave que YA existe.** Si el payload esta bien, el error que vuelve es "ya existe"; si esta mal, se queja del campo. Asi se validaron las tres variantes de `id_type` y el caso de `phones` contra la API real, sin ensuciar la contabilidad del cliente con terceros de prueba. Sirve para cualquier API con unicidad (identificacion, referencia, codigo).
- **⚠️ Siigo tiene limite de peticiones y el cliente HTTP no lo manejaba** (solo reintentaba el 401). Salta alrededor de las **100 peticiones seguidas** y pide ~19 s. Ahora quien llama declara cuanto esta dispuesto a esperar y **el default es CERO**: la mayoria de estas llamadas cuelgan de una accion del usuario, y dejarlo veinte segundos mirando la pantalla es peor que decirle que reintente. Emitir (que ya viene de dos confirmaciones) y los barridos si esperan.
- **⚠️ Una copia readonly de un DOCUMENTO no puede nacer "completa": afirma que el archivo esta cuando no esta.** Los bloques `visible` nacen completos porque no requieren accion del usuario — cierto para un bloque de datos, falso para un documento heredado, que no tiene archivo propio y muestra el del origen. Al mover el bloque de factura, **754 instancias** nacieron completas sin ninguna factura. La regla nueva mira el ORIGEN y no el tipo a secas: medido antes de escribirla, 754 + 28 tenian el origen vacio (falsas) mientras que 69 de Certificado UPME, Factura Venta Vehiculo y RUT si tienen archivo y se ven bien — una regla por tipo las habria marcado pendientes sin motivo. Mismo error de alcance que ya se documento al acotar `visiblePuedeNacerCompleto` a los gates.
- **⚠️ Un gate que compara contra un valor esperado RECHAZA el campo vacio.** El gate `factura:emitida` exige el consecutivo en los campos del bloque (los llena la extraccion del PDF) y compara el NIT del emisor contra el esperado. Un negocio facturado por ONE no tenia esos campos, y `'' !== esperado` lo dejaba sin poder cerrar **con un mensaje falso**: "la factura cargada no es de SOENA", cuando la emitio el propio Siigo de SOENA. Ahora la marca de la emision satisface el gate; la comprobacion de emisor sigue viva para lo que existe: detectar una factura ajena cargada a mano.
- **El catalogo DIVIPOLA se GENERA, no se teclea (#224).** La tabla tenia ~50 municipios a mano y dejaba sin codigo DANE a 14 casos de la cartera, dos de ellos homonimos entre departamentos. Ahora son los **1.122 oficiales**, generados desde el DANE. Tres reglas: el departamento manda; un homonimo sin departamento NO se resuelve (67 nombres se repiten, y elegir uno es inventar un dato que viaja a la DIAN); y se acepta el nombre comun si es inequivoco dentro del departamento — **sin esta ultima, ampliar el catalogo habria DEJADO DE resolver Cali**, que el DANE llama "Santiago de Cali" y es el segundo municipio de la cartera. Medido en ambas direcciones: 14 ganados, 0 perdidos, 0 codigos que cambien.
- **⚠️ El script con el que se MIDE tambien puede mentir, y de dos formas.** El cruce contra Siigo reportaba 18 terceros faltantes y 7 casos "que ONE no sabe": los reales eran 0 y 0. (a) Comparaba el numero CRUDO del RUT contra lo que Siigo guarda, y los NIT con DV pegado salian como faltantes aunque el tercero existiera — la medicion tiene que normalizar con **el mismo helper** que usa el codigo que prueba. (b) Leia "ONE ya lo sabe" solo del bloque del PDF, ignorando la marca que deja la emision: un criterio viejo mide otra cosa. Familia de los gotchas de verificacion ya escritos aqui.
- **Facturar contra Siigo: la prefactura vive en ONE, no en Siigo.** Siigo solo recibe lo que de verdad se emite, asi que su contabilidad no acumula borradores que alguien tendria que anular. Antes de emitir se le pregunta a Siigo si YA tiene factura del mismo producto para ese cliente: **medido, 7 casos de la cola ya estaban facturados y ONE no lo sabia**, 3 de ellos mostrados como listos. Es la barrera que ONE no puede resolver mirandose a si mismo (misma leccion que la perdida de leads de Meta). Bloquea, y solo se pasa con justificacion escrita que queda guardada.
- **Todo documento emitido queda ARCHIVADO en el negocio (#230).** Siigo entrega el PDF de la factura por API y de paso el **CUFE**. Se sube por la misma via que un documento cargado a mano (carpeta canonica del negocio en Drive, respaldo en Storage): un documento emitido no puede terminar en otro lugar que uno cargado, o el expediente queda partido en dos. **Los recibos de caja NO exponen PDF por API** (404 en `/pdf` y en `/print`), asi que ese bloque no se puede llenar igual.
- **Nada de lo que pase despues de crear un documento fiscal puede convertirlo en un fallo.** La factura ya existe y es irreversible: si el PDF no se puede archivar, es un pendiente que se reporta en pantalla, no una emision fallida.
- **El techo de la cola no es tecnico.** De 177 casos, **112 no tienen precio aprobado**: sin honorario aprobado no hay nada que facturar. Listos para emitir hoy: 28 por $16,7M. Ninguna automatizacion mueve ese numero.

---

**Sesion:** 2026-08-10 (`soena--ve` → producto: **el aviso llega al responsable del caso, no a su supervisora**). PR **#226** mergeado y desplegado.

- **⚠️ Un dato que el motor lee por una columna tiene que escribirse en TODOS los caminos que crean la fila.** `destinatarios_negocio` resuelve el destinatario de cada aviso buscando la fila de `negocio_responsables` con el `rol` del stage, y **escala al supervisor del area si no la encuentra**. De los cuatro caminos que asignan responsable, solo `agregarResponsable` escribia esa columna; los otros tres (auto-asignacion al crear en `crearNegocio`, conversion de interaccion, y los scripts de cargue) la dejaban NULL, y una fila sin rol es **invisible** para el routing. Medido en SOENA: **50 avisos al supervisor comercial, 48 de ellos en negocios que SI tenian responsable**; 87 de 130 abiertos en venta escalando. Fix: `src/lib/negocios/responsable-rol.ts`, fuente unica que expone la **asignacion completa** (derivar rol + liberar el puesto + escribir), no solo la derivacion — compartir solo esta ultima deja a cada camino la tarea de acordarse de liberar el puesto, y el que se olvide choca con el indice unico `(negocio_id, rol)`.
- **⚠️ Un fallback bien diseñado disfraza el defecto de comportamiento correcto.** Escalar al supervisor cuando nadie esta asignado es lo que se DEBE hacer, y por eso el sintoma ("le llega a la supervisora") parecio configuracion y no defecto durante semanas. Al diagnosticar un routing, medir **cuantas veces el fallback se disparo teniendo la respuesta**: esa es la cifra que separa un diseño de un bug. Familia de los gotchas de verificacion: el sistema no se puede auditar contra si mismo cuando su salida en el caso roto es identica a la del caso sano.
- **Un reemplazo silencioso saca a alguien de su caso sin que nadie lo note.** Un negocio admite UN comercial y UN operativo (indice unico parcial): asignar otro del mismo area reemplaza al anterior. `agregarResponsable` ahora devuelve **a quien desplazo** y con que rol quedo, y las dos pantallas lo dicen en el toast (`src/lib/negocios/responsable-copy.ts`, aparte del helper porque este lo importan server actions y scripts, y aquel componentes de cliente). Se descarto bloquear la asignacion: reasignar un caso es rutina y obligaria a quitar primero al anterior.
- **El modelo de responsables tiene DOS espacios, no tres.** Un staff de area `financiera` (o sin areas) se asigna igual y conserva su acceso, pero queda con `rol` null y **no** recibe avisos de etapa. Es limite del modelo, no pendiente; lo que se corrigio es que la pantalla ahora lo advierte en vez de callarlo.
- **⚠️ Deuda de modelo: el `rol` es el VIGENTE, no el historico.** Se deriva del area actual del staff, asi que si una persona cambia de area sus asignaciones viejas quedan etiquetadas con la nueva. Correcto hacia adelante (el rol dice quien responde hoy), pero el sistema **no puede reconstruir con que sombrero trabajo alguien un caso pasado**. Importa el dia que se midan comisiones o bonos por persona.
- **Metodo:** alcance medido contra produccion ANTES de escribir codigo; migracion de datos ensayada en transaccion con `rollback` y verificada despues **contra la funcion que corre en produccion** (`select ... from destinatarios_negocio(n.id)`), no contra una reimplementacion del criterio; 7 tests nuevos vistos fallar contra la implementacion mutada.

---

**Sesion:** 2026-08-06 a 08 (`soena--ve` → producto: **ONE emite documentos contra Siigo, y facturar deja de ser una etapa del flujo**). PRs **#211, #212, #220** mergeados y desplegados.

- **Cliente HTTP de Siigo (`src/lib/siigo/client.ts`), generico y opt-in por workspace.** Token cacheado 24 h por workspace, `Partner-Id` en toda peticion, reintento unico ante 401 y errores traducidos (llegan como `{Status, Errors:[{Code,Message,Params}]}`; sin parsearlos el operador ve "HTTP 400" y nada mas). **Credenciales SOLO por workspace en `config_extra`, sin fallback a env var global**: facturar es un acto fiscal a nombre de una empresa concreta y una credencial global permitiria emitir con el emisor equivocado. Scripts `setup-siigo-workspace.ts` (comprueba contra Siigo ANTES de guardar y preserva el resto de `config_extra`) y `check-siigo.ts` (ejercita el MISMO cliente que usa el producto, no una copia del payload).
- **⚠️ Exportar una CONSTANTE desde un archivo `'use server'` anula TODOS los exports del modulo.** El build falla con "The module has no exports at all" y el error apunta al importador, no al archivo culpable. Este archivo ya documentaba el caso de funciones puras sync; **una constante rompe igual**. Se resuelve moviendola a un modulo aparte (`src/lib/facturacion/ventana-descarte.ts`). **`tsc` NO lo detecta: solo el build.**
- **⚠️ Un `<label>` que envuelve una lista de `<button>` se roba sus clics.** El label se asocia al primer control labelable descendiente y reenvia hacia el los clics de todo lo que contiene, asi que elegir un item de una lista de resultados devolvia el foco al input en vez de seleccionarlo. Si un contenedor tiene input **y** botones, no puede ser un `<label>`. El comportamiento **difiere entre navegadores y en touch**, por eso puede fallarle a un usuario y a otro no.
- **⚠️ Descartar el `error` de una consulta produce un fallo mudo indistinguible de "no hay datos".** `const { data } = await supabase...` sin leer `error` devolvia lista vacia y la pantalla mostraba un buscador que "no encuentra nada". Toda consulta que alimente un selector debe leer el error y subirlo. De paso: **sin `.limit()` explicito manda el tope del servidor (1000)**, y con filtrado en el cliente un truncamiento silencioso se ve como "ese registro no existe".
- **Cierre excepcional no facturable (#211), generico.** Un caso que no se va a facturar cierra con motivo estructurado, autor y fecha, sin tocar `precio_aprobado`, y **solo sobre un gate REALMENTE incumplido** (si la factura ya cumple, manda al cierre normal). Lo autoriza `puedeAutorizarCierreNoFacturable` (owner/admin o area financiera), **fuente unica del criterio consumida por el guard del servidor Y por la pantalla**: copiar la regla en los dos lados los desincroniza en silencio. **Un cierre no facturable NO es cartera**: el tablero contaba todo negocio completado con precio aprobado como plata por cobrar.
- **⚠️ El dialogo de cierre quedaba detras del header (#212).** Tercera aparicion del mismo fallo: el header sticky usa `backdrop-blur`, que crea un containing block y atrapa cualquier `fixed inset-0` montado dentro. **Todo overlay que nazca en el header necesita `createPortal` a `document.body`.** Se aplico tambien a `PausaNegocioDialog`, que tenia el bug sin reportar.
- **Cola de facturacion (#220), opt-in por linea** (`config_extra.facturacion.desde_etapa_numero`). Sin ese dato **la bandeja sale vacia y lo dice**, en vez de asumir un criterio y llenarse de casos que nadie mando facturar. Los borradores viajan con sus campos faltantes visibles (`Borrador<T>` con `faltantes[]`) en vez de fallar al enviarse.
- **Mapeo ONE → Siigo en funciones PURAS (`src/lib/siigo/mapeo.ts`), validado contra documentos ya emitidos.** Esa validacion es lo que permite confiar en el algoritmo ANTES de emitir una factura electronica, que no se deshace. Gotchas de dominio: el precio aprobado del negocio venia CON IVA y Siigo espera la base (hay que **dividir**, no multiplicar); los codigos de ubicacion extraidos de un RUT pueden venir mal (llegaba el codigo de PAIS en el campo de departamento) y conviene resolverlos desde los nombres; y `Idempotency-Key` de Siigo admite **maximo 30 caracteres**, asi que un UUID sin guiones (32) NO cabe.

---

**Sesion:** 2026-08-06→09 (`soena--ve` → producto: **una misma formula de saldo escrita en SIETE sitios, y tres tolerancias distintas para la misma diferencia de plata**). PRs **#210, #213, #214, #216, #217, #219, #221** mergeados y desplegados + migracion de `count_negocios_por_conciliar`.

- **⚠️⚠️ SEPTIMA aparicion de `precio_aprobado − cobrado`, y el conteo heredado volvio a fallar.** Este archivo ya advertia que "el conteo de sitios que deja escrito un fix previo NO es un inventario cerrado" (04-ago, cuando eran cuatro). **Volvio a pasar:** aparecieron la quinta (`conciliacion-actions.ts`, el panel completo), la sexta (la RPC `count_negocios_por_conciliar`, que alimenta el badge del nav) y la septima (`reevaluarBloquesCobros`, ~4470). **Buscar la formula por su FORMA**, no por el numero heredado. En este producto el cliente paga **honorario + tarifa pasante** en un solo recaudo, asi que comparar contra `precio_aprobado` a secas convierte a todo el que paga completo en un sobrepago del tamaño de la tarifa.
- **⚠️ Dos superficies con criterios distintos sobre el mismo dato: una INVENTA y la otra ESCONDE, y juntas explican por que nadie usa una pantalla.** El panel de conciliacion marcaba **20 sobrepagos que no existian** (medido: 0 reales) y en **3 casos invertia el signo** — mostraba plata para devolver donde faltaba por cobrar. Al mismo tiempo el bloque de Cobros pintaba `saldoPendiente > 0 ? saldoPendiente : 0`, o sea **tapaba** los saldos a favor reales: un sobrepago se veia igual que un negocio al dia. Por eso el workspace tenia UNA sola fila conciliada en `negocio_conciliacion`: **un control que grita siempre enseña a ignorarlo**. Regla: antes de rediseñar un proceso, arreglar el instrumento con el que se mide.
- **UNA sola vara de materialidad para todo el sistema (`src/lib/negocios/tolerancia-saldo.ts`).** Habia tres: el gate `saldo_cero` toleraba $1.000, `descuadreConciliacion` toleraba $1 y el salto automatico de una etapa de cobro exigia **cero exacto**. La franja entre ellas es una trampa: un caso con $120 de mas pasaba los gates de la etapa pero no el salto que debia evitarle la etapa entera, y aterrizaba a conciliar una plata que sus propios gates daban por cuadrada. La constante vive en `lib/negocios` (la consume el motor de avance), NO en `lib/upme` (modelo de dinero de SOENA); `modelo-dinero.ts` la re-exporta para no partir a sus consumidores.
- **⚠️ La asimetria del saldo NO se puede aplicar a los dos lados: faltante contra el HONORARIO, exceso contra el VALOR A RECAUDAR.** Al corregir el sobrepago del panel se midio tambien el faltante contra el valor a recaudar, y la pestaña paso de esconder faltantes a **inventarlos**: 33 casos, de los cuales **30 ya habian pagado todo el honorario** y **25 tenian un faltante identico a la tarifa UPME**. Causa: muchos clientes pagan la tarifa **directo a la UPME**, sin que pase por el producto. Es la misma medicion del 04-ago (medir ambos lados igual retenia 62 casos). El panel ahora consume `descuadreConciliacion` en vez de tener su propia resta.
- **Un dato que la pantalla oculta es peor que uno que falta.** `BloqueCobros` mostraba `$0` en vez del saldo a favor: la cifra existia en los datos y la pantalla la tapaba, asi que nadie iba a buscar lo que el sistema afirmaba que no existia. Ahora la casilla cambia de etiqueta a "A favor del cliente". Mismo criterio en el panel con `recaudoPendienteDeConfirmar`: "faltan $X" sobre plata ya registrada manda a buscar lo que no se ha perdido — lo que falta es la confirmacion, y eso si es accionable.
- **Antiguedad de un registro: el reloj entra como PARAMETRO** (`src/lib/negocios/antiguedad.ts`). Dos razones: testeable sin congelar el reloj global, y quien llama toma UNA marca de tiempo para todo el lote (si cada fila llamara a `Date.now()`, dos registros creados en el mismo instante saldrian con antiguedades distintas al cruzar la medianoche a mitad del recorrido). Se calcula en el SERVIDOR: un `Date.now()` en el render ya rompio antes (`contactos-list`). **Sin fecha devuelve `null`, nunca 0** — un cero dice "recien creado", que seria falso.
- **⚠️ Gotcha de verificacion propio (van varios de esta familia): un `git checkout` que FALLA deja las pruebas corriendo en el commit anterior, y el verde se lee igual.** Paso al verificar un PR: el worktree de otra sesion tenia la rama tomada, el checkout aborto, no se miro el error y se reportaron 283 pruebas verdes de la rama vieja. **Comprobar en que commit se esta parado (`git log --oneline -1`) antes de leer cualquier verde.**
- **⚠️ `vercel ls` muestra edad RELATIVA; para saber que se desplego hay que comparar FECHAS.** Se leyo "11h" contra "acabo de mergear" y se declaro roto un auto-deploy que estaba bien — la sesion llevaba horas parada. `vercel inspect <url>` da el `created` con fecha y hora: esa es la que se compara contra la fecha del commit (`git log --format=%ad`). El gotcha de Vercel de mas abajo (deploy que no dispara) sigue vigente, pero **descartar primero el error de lectura**.
- **⚠️ Quinta colision de worktree entre sesiones**, esta vez detectada por un archivo ajeno modificado (`facturacion-actions.ts`) en un arbol propio. `git reflog` mostro el `checkout` que le movio el arbol a la otra sesion y su regreso. Y **`git diff main..rama` (dos puntos) da falsos positivos al buscar colisiones**: compara puntas, no ancestro comun. Usar `main...rama`.

---

**Sesion:** 2026-08-04 (`metrik-one--soena` → producto: **revertir la aprobacion de un bloque `propuesta_economica` ya deja rehacerla completa, no solo a medias**). PRs **#204** y **#205** mergeados y desplegados.

- **Gotcha generico de las copias readonly heredadas: escribir sobre el `bloqueId` abierto, no sobre el origen, deja una fila huerfana que nadie mas lee.** Un bloque tipo `propuesta_economica` vive en UNA fila (su etapa nativa) y aparece heredado de solo lectura en las etapas siguientes — cada copia es su propia fila en `negocio_bloques`, poblada como snapshot UNA sola vez al crearse (`cambiarEtapaNegocio`), nunca resincronizada despues. Todo lo que lee el estado vigente (otras copias readonly, gates de saldo, `anticipoCubiertoPorSaldo`) lo hace por el **slug estable del bloque origen** (`propuestaDataPorSlug` en `getNegocioDetalle`), no por la fila que el usuario tenga abierta. Las server actions de `propuesta-economica-actions.ts` (generar version, aprobar, **revertir aprobacion**, editar tarifa UPME) escribian directo sobre el `bloqueId` que llegaba del cliente: invocadas desde una copia heredada (que es justo donde el equipo opera dia a dia, ver el caso SOENA abajo), corregian la fila equivocada — el origen quedaba intacto y el resto del sistema seguia viendo el dato viejo.
- **Fix: resolver siempre al origen antes de leer/escribir, guard contra el bloque abierto.** Nuevo `resolverOrigenPropuesta()`: si `config_extra.readonly=true` + `source_bloque_slug`, resuelve a la fila cuyo `bloque_configs.slug` coincide, dentro del mismo negocio. El **guard de permiso se evalua contra el bloque que el usuario tiene ABIERTO** (la etapa donde trabaja), no contra el origen resuelto — mismo criterio que ya usa `actualizarBloqueData` para bloques `datos` compartidos (`compartido_con_origen`). Este es el tercer tipo de bloque con esta mecanica de "copia readonly + resolucion a origen por slug" (los otros dos: `datos` con `compartido_con_origen`, y el swap de lectura de `documento`); si aparece un cuarto, aplicar el mismo patron de raiz en vez de reinventarlo.
- **Corolario de diseno: una copia readonly heredada puede volverse editable sin dejar de ser una copia**, cuando la condicion que la fuerza a solo lectura (aprobacion vigente) deja de cumplirse Y el negocio sigue dentro de una ventana declarada (`revertir_hasta_etapa_orden`). Implementado en `negocio-detail-client.tsx`: el override de `modo` a `'editable'` lee el dato YA SWAPEADO del origen (asi ve el estado real, no el de su propia fila congelada) y explicitamente NO aplica si el area del usuario no cubre la etapa (`_areaReadonly`) ni si la card es la del historial (`_forceReadOnly`) — ninguna de las dos debe ceder ante esta excepcion.
- **Caso real que disparo el fix (SOENA, V0277):** el equipo revertia la aprobacion desde Negociacion (la copia heredada), la fila local quedaba `pendiente` pero el origen (etapa Propuesta) seguia `completo` y aprobado — y aunque no lo hubiera quedado, la copia es SIEMPRE de solo lectura por diseno, asi que no habia ningun lugar desde donde editar descuentos, generar el PDF de nuevo ni volver a aprobar un plan.
- **Fix visual (#205, recomendacion Noor):** dos acciones de riesgo distinto sobre el mismo bloque ("Revertir aprobacion" reabre la negociacion completa, "Corregir valor aprobado" solo ajusta un numero) eran texto subrayado identico y pegado. Ahora son botones con borde + icono propio, cada uno en su renglon — patron a reusar cuando dos acciones de riesgo distinto compitan por el mismo espacio.

---

**Sesion:** 2026-08-04 (`metrik-one--soena` → producto: **tablero de bono por indicadores, y la distincion entre un cero y una ausencia de medicion**). PR **#202** mergeado y desplegado. (Sesion en paralelo con la de abajo.)

- **Tablero de bono de operaciones (generico, opt-in por `modules.operaciones_bonos`).** Cuatro indicadores por persona con pesos configurables, puntaje y bono. Pestaña en `/tableros` + hoja individual en `/equipo/operaciones/[staff_id]`. Primer adopter: SOENA.
- **⚠️ Un indicador sin datos vale `null`, NO 0.** Es la decision que gobierna el modulo. La formula original (un Excel del cliente) daba el puntaje maximo de calidad cuando no habia ni un reproceso registrado: "cero errores" y "nadie midio" producian el mismo numero. Ahora el score es `null`, la celda se pinta con raya en vez de una cifra y el puntaje viaja con `completo: false`. **Un indicador ausente tampoco se suma como 0**, porque eso castigaria a quien no tuvo casos. Aplica a cualquier tablero nuevo: si una metrica puede calcularse sobre cero evidencias, hay que decidir a proposito que muestra en ese caso.
- **⚠️ `negocio_bloques.completado_por` → `profiles`; `negocios.responsable_id` → `staff`.** Son tablas distintas y miden cosas distintas: `responsable_id` es el comercial dueño del caso (Jessica 128 en SOENA), `completado_por` es quien hizo el trabajo (los tres operativos). El puente al salario es `staff.profile_id`. Es el mismo campo minado que este archivo ya documenta para `activity_log.autor_id`, y aqui volvio a aparecer: **un JOIN contra la tabla equivocada devuelve vacio en silencio**, que en un tablero se lee como "esta persona no trabajo".
- **`config_bono_operaciones`: la politica de incentivos es DATO, no codigo.** Pesos, pisos y ventanas de horas se editan sin desplegar. Un umbral hardcodeado en una regla de plata obliga a un deploy cada vez que el cliente negocia con su equipo.
- **`reproceso_eventos`: historial de reprocesos.** `negocios.metadata.reproceso` solo conserva el ciclo VIGENTE (al abrir el ciclo 2 se pisa el 1), asi que no permite contar reprocesos de un periodo. Cada ciclo se asienta como hecho propio con causa y atribucion. **Se atribuye a quien hizo el trabajo que se rehace, no a quien lo reporta** (siempre el supervisor): lo contrario invierte el indicador.
- **El dinero se recorta en el SERVIDOR.** La RPC calcula el bono de todos porque necesita el salario; la server action borra el bono ajeno antes de serializar. Ocultarlo en React lo dejaria legible en el payload de la pagina.
- **⚠️ Tercera ocurrencia del mismo gotcha de grants, y van tres en dos dias.** Ambas tablas nuevas nacieron con `INSERT/UPDATE/DELETE/TRUNCATE` para `anon` y `authenticated`. RLS tapa el DML pero **TRUNCATE no pasa por RLS**. `revoke all` ANTES de otorgar, y comprobar con `information_schema.role_table_grants`, nunca leyendo la migracion. **Corregido el 2026-08-10:** este gotcha decia que "cualquiera con la anon key del bundle podia vaciar la tabla", y eso es falso. Medido: `anon` es NOLOGIN (no hay conexion directa por wire protocol), **PostgREST no expone TRUNCATE por la API REST**, y hay cero funciones ejecutables por `anon` que contengan TRUNCATE. Que RLS no cubra TRUNCATE es cierto y esta verificado contra una tabla de prueba con deny-all; que sea explotable con la anon key no lo era. Es superficie latente, no una fuga abierta.
- **⚠️ Deuda que estorba a todos: `npm run lint` es inutilizable.** El `globalIgnores` de `eslint.config.mjs` ignora `.next/**` de la raiz pero no `.claude/worktrees/**`, asi que eslint entra a lintar **2,6 GB en 28 worktrees de agentes** con sus `.next` compilados. Nunca termina. Mientras tanto, lintar con `npx eslint src/`. **Arreglo de una linea, pendiente.**

---

**Sesion:** 2026-08-03→04 (`soena--ve` → producto: **la correccion hacia atras deja rastro, el retorno al punto de decision, y la aprobacion de la propuesta se puede revertir**). PRs **#192, #195, #198, #199, #200** mergeados y desplegados.

- **Traza de correcciones (#192, tabla `bloque_correcciones`).** La correccion post-avance ya dejaba QUIEN y CUANDO; faltaba QUE cambio y POR QUE. Una fila por campo con valor previo, valor nuevo, causa, etapa y **area DUEÑA del bloque** (no la de quien corrige: medir por persona señala a quien limpia errores ajenos). `activity_log` conserva el evento del timeline, enlazado por `activity_log_id` y **actualizado** en vez de duplicado mientras dure la correccion (el guardado de un bloque `datos` es un autosave: un evento por pulsacion llenaria el timeline de valores a medio escribir). La causa se pregunta ANTES de habilitar la edicion, en un clic y sin texto libre. Modulo puro `src/lib/correcciones/causas.ts` compartido por servidor y navegador; `contextoCorreccion` se movio a `src/lib/correcciones/registrar.ts` porque ahora lo usan datos y documentos.
- **⚠️ El camino comun de la correccion no dejaba rastro (#192).** `marcarBloqueCompleto` no trataba la correccion post-avance, y como un bloque de una etapa superada **casi siempre esta completo**, ese era el camino real: quedaba sin marca de autoria. Al agregar una salvaguarda a un flujo, verificar cual de sus caminos es el frecuente, no solo el que se tuvo en mente.
- **⚠️ `activity_log.autor_id` es FK a `staff(id)`, NO a profiles (#195).** Se le paso el `profile.id` y el insert violaba la FK sin que nadie mirara el error: la correccion quedaba en su tabla y **ausente del timeline**. Es el campo minado que este archivo ya documentaba (`completado_por` es profile.id; `activity_log.autor_id` y `negocio_responsables.staff_id` son staff.id) y aun asi se piso. Todo insert a `activity_log` desde codigo nuevo: verificar el id ANTES, y no tragarse el error.
- **⚠️ Un `grant` explicito NO quita lo heredado (#192).** La tabla nueva nacio con DELETE y TRUNCATE para `authenticated` por el default del proyecto, y **TRUNCATE no pasa por RLS**. Hay que `revoke all` ANTES de otorgar, y comprobar los privilegios reales con `information_schema.role_table_grants`, no leyendo la migracion. **Corregido el 2026-08-10:** decia "cualquiera con su token podia vaciar una tabla de auditoria completa"; PostgREST no emite TRUNCATE, asi que con el token solo no se podia. El privilegio sobraba igual y ya no existe (ver la tanda de grants de esa fecha), pero la urgencia estaba sobredimensionada. Un gotcha que exagera se descuenta entero la proxima vez que se lee.
- **Retorno al punto de decision (#198, `src/lib/negocios/retorno-decision.ts`).** Opt-in por `etapas_negocio.config_extra.punto_de_decision`: corregir un campo que decide la ruta devuelve el caso a la etapa donde se decide, archivando **solo lo que dependia de esa decision**. Un bloque que mueve plata **nunca se archiva**, este o no declarado, y esa regla la aplica el codigo, no la config. 23 pruebas con la topologia real.
- **⚠️ El `orden` de la etapa NO ordena el recorrido (#198).** En la linea de SOENA, Anexos (18) enruta a Generacion (13), y de 116 negocios en Cita **solo 8 pasaron por Entrega**: comparar ordenes los habria devuelto a una etapa que nunca recorrieron. Para saber si un caso "ya paso por X" hay que recorrer el routing real y exigir prueba de haber estado ahi (casillas de esa etapa, que solo nacen al entrar).
- **⚠️ HALLAZGO ABIERTO — un gate sin su casilla no retiene nada (#198).** `gates_pendientes_etapa` hace JOIN contra `negocio_bloques`: si la instancia no existe, el gate no exige nada. Medido en SOENA: **cientos** de casillas faltantes (Documentacion 654, Inclusion 573, Generacion y Envio 472 cada una), entre ellas la de un campo decisor en 36 casos. El trigger `sembrar_casillas_al_crear_bloque` es del 1-ago y las configuraciones anteriores no quedaron cubiertas. **Necesita un barrido con `sembrar_casillas_bloque(<config_id>)`, re-midiendo antes.**
- **La traza del reproceso nunca se habria escrito (#198).** `reproceso-actions.ts` insertaba `activity_log.tipo = 'reproceso'`, valor **fuera del CHECK**, sin mirar el error. Pasa a `cambio_etapa`/`sistema`. Cuarta vez que un tipo fuera del CHECK falla en silencio en este repo.
- **Revertir la aprobacion de la propuesta (#199, #200).** Deshace la aprobacion para generar version nueva y volver a elegir plan, **solo sin pagos confirmados** (`cobros.fecha IS NOT NULL`, la definicion que ya usa el producto para contar ingresos) y **dentro de una ventana declarada**. El cap de descuento no necesito nada: `aprobarVersionPropuesta` lo evalua en cada aprobacion, asi que re-aprobar vuelve a exigir rol gerencial. Las versiones y el PDF enviado al cliente **nunca se borran**.
- **⚠️ La ventana de una accion se DECLARA; no se deduce de donde vive el bloque (#200).** El bloque de propuesta vive en la etapa Propuesta, pero la renegociacion ocurre en Negociacion, donde ya es copia readonly. Atar el limite a "el negocio sigue en la etapa del bloque" dejo la funcion **inalcanzable justo en el escenario que la pidio**. Ahora `revertir_hasta_etapa_orden` y se mide contra la etapa del NEGOCIO. Regla general: antes de acotar una accion por etapa, verificar en que etapa vive el bloque y en cual ocurre el proceso — no tienen por que coincidir.
- **Gotcha de resolucion:** la etapa actual se resuelve en dos consultas y no por join, porque el nombre de la FK no es estable y un join mal nombrado devuelve vacio **en silencio**, que en un control de ventana significa dejar pasar lo que debia frenar.

---

**Sesion:** 2026-08-03→04 (`soena--ve` → producto: **el texto de las tarjetas se puede copiar, y el status inicial del contacto vuelve a existir**). PRs **#194** y **#196** mergeados y desplegados.

- **⚠️ Dentro de un `<a href>` Chrome NO deja seleccionar texto arrastrando** — el arrastre es "arrastrar el enlace". Medido en Chrome con y sin ventana: **ni `draggable={false}` ni `user-select: text` lo devuelven**, y ademas al soltar el mouse la tarjeta navega. **No hay CSS que arregle esto**: si el usuario tiene que poder copiar el contenido, el contenedor clickable no puede ser un ancla. Nuevo `src/components/card-link.tsx` (#194): contenedor que navega por click, con guard que ignora el click cuando acaba de haber seleccion **dentro de ese mismo nodo** (una seleccion en otra tarjeta no debe bloquear esta). Repone a mano lo que daba el ancla: Cmd/Ctrl/Shift click y boton central abren en pestana nueva, Enter y Espacio navegan (`role="link"`), precarga al pasar el cursor. **Se pierde** el menu contextual del navegador sobre el enlace y ver la URL en la barra de estado. Usado por las tarjetas de negocios, contactos y la `EntityCard`.
- **⚠️ Una lista de valores validos COPIADA en un guard se desincroniza del catalogo y falla en silencio (#196).** Al cambiar el juego de status de contacto (2026-07-31), `updateContactoSegmento` se quedo con los cuatro valores viejos y **rechazo los siete nuevos** con "Segmento invalido": tocar el chip en la lista de contactos no guardaba nada **durante tres dias**, y no se noto porque el detalle guarda por otra via **sin validacion**. La validacion debe derivarse del catalogo (`STATUS_CONTACTO.map(...)`), nunca reescribirse al lado. Regla general: **dos caminos de escritura para el mismo campo, uno validado y otro no, esconden el defecto del validado.**
- **`sin_contactar` es el estado de nacimiento del contacto** y volvio a `STATUS_CONTACTO`. Habia salido del catalogo mientras el sistema **seguia creando contactos ahi** (default del alta manual y `segmento_inicial` del webhook de Meta): nacian en un valor que el catalogo no reconocia, en gris y fuera del selector y los filtros. Al sacar un valor de un catalogo, revisar antes quien lo ESCRIBE, no solo quien lo muestra.
- **⚠️ `contactos.updated_at` no se mantiene: no sirve como senal de "nadie lo toco".** Medido el 2026-08-03: las 423 filas del workspace SOENA la tienen igual a `created_at`, incluidas las que estan en estados que solo pone una persona. Un backfill filtrado por esa columna **parece prudente y no filtra nada**. Para "nadie lo trabajo" usar evidencia real (estado de la interaccion, existencia de negocio). Misma familia que los gotchas de verificacion: el control se mide ANTES de escribir.

---

**Sesion:** 2026-08-01→02 (`soena--ve` → producto: **campos derivados de una sola pregunta, opcion que no aplica, casilla que nace con el bloque, ayuda dentro de la etapa y un contador que dejo de filtrarse a si mismo**). PRs **#183, #184, #185, #187, #188, #191** mergeados y desplegados. (Sesion en paralelo con la de Realtime, bloque siguiente.)

- **Campo derivado de otro campo (`lock_when` ampliado, opt-in).** Para hacer UNA pregunta y que los campos dependientes se resuelvan solos. `lock_when` gana `mapping` (deriva el valor desde la fuente) y `regla` (regla dura que **manda sobre** el mapeo). **La derivacion se persiste en el SERVIDOR** (`propagarCamposDerivados` en `negocio-v2-actions.ts`, colgado de `actualizarBloqueData`/`marcarBloqueCompleto`), no solo en un effect del cliente: gates y routing leen el dato real, y antes solo se escribia cuando alguien ABRIA el negocio, o sea tarde. Fuente unica en `src/lib/negocios/campo-derivado.ts`, compartida por render y servidor. **Gotcha al configurar:** si el campo ya tenia `lock_when` con una regla de negocio, agregarle `mapping` la borraria en silencio; por eso `regla` tiene precedencia explicita.
- **⚠️ Una opcion que no aplica se RETIRA, no se fuerza** (`opciones[].solo_si`, `src/lib/negocios/opcion-condicional.ts`). Mostrar una opcion forzada invita a preguntar por que esta ahi. **Pero una opcion que deja de aplicar NO se oculta si ya estaba seleccionada**: eso dejaria un dato invisible decidiendo la rama, que es exactamente el defecto del 2026-07-31 (ocultar un bloque no lo saca del motor).
- **La casilla de un gate nace con el bloque (#184, trigger `casilla_nace_con_el_bloque`).** Antes se creaba cuando alguien entraba a la etapa: un gate nuevo no exigia nada en los negocios que ya habian pasado por ahi. El contrato entre la regla TS y su espejo SQL esta en `casilla-nace.test.ts`.
- **⚠️ Seguridad: `revoke ... from anon` NO basta (#185).** Toda funcion nace con `EXECUTE` para **PUBLIC**, y `authenticated` lo hereda. Revocar solo de `anon` la deja alcanzable. Comprobar con `has_function_privilege('authenticated', '<f>(args)', 'execute')`, no leyendo el `revoke`. Misma familia que el gotcha de grants permisivos por defecto.
- **Ayuda operativa dentro de la etapa (#188, `GuiaEtapaCard`, generico opt-in).** `etapas_negocio.config_extra.guia` = `{definicion, hacer[], avanzar_cuando, responsable}` → tarjeta sobre los bloques del negocio. Solo la definicion queda visible; el detalle se despliega y **la preferencia se recuerda** (localStorage via `useSyncExternalStore`, no `setState` en effect). Sin `guia` en la etapa no aparece nada.
- **Un contador no se filtra a si mismo (#191, `src/lib/negocios/segmentador.ts`).** En `/negocios`, al elegir una etapa los contadores de las demas caian a cero porque se calculaban sobre la lista ya filtrada por esa etapa. **Lista y contadores salen de la misma funcion**, asi que el numero del chip es por construccion el largo de la lista que abre. Aplica a cualquier segmentador nuevo: el contador de una dimension excluye su propia seleccion (mismo criterio que el cross-filter de `get_rentabilidad_comercial`).
- **Guardian `audit_flujo_coherencia(linea_id)` v3.** Detecta decisiones sin dueno, gates decorativos, decisiones no obligatorias, y ahora **`derivacion_sin_fuente`**: juzgaba por `required`/`tipo` y daba por rojos campos ya resueltos por derivacion, asi que aprendio a seguir la cadena. SOENA VE en **0 hallazgos**.
- **⚠️ Gotcha de verificacion (propio, en la ultima milla):** comprobar que un cambio se aplico buscando **un simbolo que ya existia antes del cambio** da verde sin que el cambio exista. Paso al reapuntar el generador del documento de la guia hacia la base: se reporto exito y el documento seguia con los textos viejos. **Verificar contra el DATO producido** (los 46 pasos de la base aparecen los 46 en la salida), nunca contra una senal del codigo.

---

**Sesion:** 2026-08-01→02 (`soena--ve` — Max — **por que se pegaba la aplicacion: un salto de linea en una env var tenia Realtime caido**). PRs **#178, #180, #181, #182, #186** mergeados y desplegados.

Disparador: Daniela y Jessica reportaron que la aplicacion se pega, se queda cargando y a veces da error 400.

- **Causa raiz (2 dias de diagnostico):** `NEXT_PUBLIC_SUPABASE_ANON_KEY` en Vercel tenia un **salto de linea al final**. El navegador lo mandaba como `%0A` en el `apikey` del WebSocket → el gateway respondia **401**. **17.007 rechazos en 24 h, cero conexiones exitosas.** El navegador reintentaba en bucle: eso es lo que pegaba la pestana. Corregido + redesplegado + verificado en el bundle (huella SHA-256 de la key). Detalle completo en los gotchas de env vars.
- **Nueve hipotesis descartadas antes de dar con ella** (algoritmo del token, protocolo `vsn`, librería `createClient` vs `createBrowserClient`, header `Origin`, User-Agent, publicacion de la tabla, legacy keys deshabilitadas, el propio servicio Realtime). Se cerro mirando la consola del navegador: el `%0A` estaba a la vista en la URL.
- **⚠️ ES256 rompe Realtime** (gotcha propio abajo). Se roto la clave de firma dos veces con el mismo resultado. Queda en **HS256**, y con eso `getClaims()` degrada a `getUser()`.
- **El canal de Realtime ya no reintenta sin fin (#181):** se rinde tras 3 fallos o 30 s. La campana no queda desactualizada — el refresco por `visibilitychange` ya existia como respaldo.
- **Dos fallos mudos corregidos y verificados (#180):** (a) `bloque_items` se consultaba por `bloque_instancia_id`, columna que **no existe** en esa tabla (vive en `bloque_locks`) → el **historial de etapas anteriores** pintaba cronogramas y checklists **vacios**, sin avisar (~33 errores/hora → **0** en 12 h); (b) el auto-alta de `staff` chocaba contra `staff_profile_id_key` (~38/hora → 9 en 12 h) porque la lectura previa filtra `is_active` y no ve un registro inactivo.
- **Fuga cross-tenant cerrada (#182):** `/api/compliance/valida-reporte/[consulta_id]` traia el PDF SARLAFT con la api_key server-only **sin comprobar a que workspace pertenece la consulta**. Ahora resuelve sesion propia y valida pertenencia contra `valida_consultas`. Limite deliberado documentado en el codigo: `/compliance/validacion` no persiste, asi que sus ids efimeros pasan.
- **Costo de sesion por navegacion (#178):** `getWorkspace` deduplicado por request con `cache()` (lo llaman **111 archivos**; resolvia profile + staff + staff_areas por separado en cada render), el layout dejo de leer **dos veces** el mismo registro de `workspaces`, y 4 indices sobre FK de la ruta caliente (empezando por `negocio_bloques.bloque_config_id`: 577 llamadas a 100,8 ms).
- **Configuracion de Supabase aplicada:** ventana de reuso del refresh token 10 s → 30 s (las carreras entre middleware/pestana/socket mataban sesiones con `400 invalid_grant`); limites por IP subidos (SOENA sale por NAT compartida); y el pool de Auth pasa de **10 conexiones fijas a 20% del pool** — antes no escalaba aunque se subiera el compute, y era la causa del peor caso de **972 ms** en `getUser()`.
- **Lo que NO se hizo, con su razon:** mover el guard del rol `contador` fuera del middleware. Se midio: cuesta **0,62 ms por navegacion** (24 segundos en 4 dias). No justifica el riesgo de tocar un control de acceso.

---

**Sesion:** 2026-07-31 (`metrik-one--soena` → producto: **gate "al menos uno de varios campos" + el dato de una rama abandonada deja de decidir el routing**). PR **#171** mergeado y desplegado; **#172** abierto.

- **Gate `campos_alguno` (nuevo, opt-in por config de etapa).** El gate `campo:<slug>=<valor>` es igualdad exacta sobre **un** campo, así que no puede expresar "al menos una de estas dos respuestas". El nuevo se declara con `gates: ['campos_alguno']` + `campos_alguno_gate: { campos: [...], valor, source_etapa_orden? }` + `gate_messages.campos_alguno`. **`source_etapa_orden` no es adorno:** permite exigirlo desde una etapa POSTERIOR a la que captura las respuestas, y hace falta porque desde la corrección gerencial (#144) un campo se edita desde el historial cuando su etapa ya pasó — un gate que solo mirara la etapa actual protegería únicamente el primer avance. **Un campo ausente cuenta como no cumplido**, así que la exigencia sobrevive a que el bloque ni exista (caso real: negocios anteriores a que se creara el interruptor).
- **⚠️ El routing lee TODOS los bloques `datos` de la etapa SIN mirar su `condition`.** Un bloque oculto por condición cuyo `data` quedó persistido **sigue decidiendo la rama**. `cita_dian_confirmacion.solo_si` dejaba de sembrar el campo fuera de su rama y el comentario del código declaraba que ahí va vacío, pero al cambiar la respuesta de arriba el bloque solo dejaba de **mostrarse**: el valor viejo se quedaba y desviaba el negocio a una rama que ya no le correspondía. Ahora, cuando el guard deja de cumplirse, el campo se retira. **Regla general: ocultar un bloque no lo saca del motor — hay que retirar también su dato.** Es la segunda cara del gate invisible del 2026-07-29 (allí eran `visible` + `es_gate`, dos banderas que se tocan juntas).
- **⚠️ Una limpieza automática de datos deja rastro de lo retirado (#172).** El fix salió borrando la clave en silencio; medido **después** de desplegarlo, alcanza a **116 negocios** del cargue histórico, uno por uno a medida que alguien los abre. Un barrido de ese tamaño sin rastro es inauditable e irreversible. Ahora queda `_campo_retirado` (campo, valor, fecha, motivo), el mismo criterio que ya aplicaba la corrección manual equivalente. **Cuando el código repara datos solo, el rastro es parte del fix, no un extra** — y el alcance se mide antes de desplegar, no después.
- **⚠️ Gotcha del MCP de Supabase: sin `commit` explícito, la transacción se revierte.** Un `begin;` seguido de updates y un `select` de verificación devuelve el estado *dentro* de la transacción — se ve correcto y luego no queda nada. Y la trampa de la comprobación: verificar "existe un registro de cambio a la etapa X" puede ser cierto **antes y después** si el negocio ya pasó por ahí; comprobar por contenido exacto de lo que uno escribió, no por una propiedad que el dato ya tenía.
---

**Sesion:** 2026-07-30 (`advise--clarity` S4 → producto: **el audio de calidad sube a Storage, tope 45 min, y una transcripcion cortada deja de pasar por buena**). PRs **#162, #165** mergeados y desplegados.

- **⚠️⚠️ El motor daba por buena media transcripcion, y eso es un FALSO VERDE.** `transcribirAudio` solo fallaba si el texto venia **vacio**. Cuando Gemini se quedaba sin presupuesto de salida devolvia media llamada con `finishReason: MAX_TOKENS`, y esto lo aceptaba: se auditaba media conversacion y salia con puntaje y semaforo de aspecto normal, **sin el cierre de la llamada, que es donde viven las banderas de cobro**. Es exactamente la forma de fallar que las dos pasadas del motor existen para evitar. Ahora **cualquier `finishReason` distinto de `STOP` lanza error**. Regla general: en toda llamada a un LLM cuyo texto se procese despues, verificar el `finishReason`, no solo que haya texto.
- **⚠️ El pensamiento se cobra del `maxOutputTokens`, y por eso truncaba.** Medido en una llamada real de 40 min: `thoughtsTokenCount` **14.862** de 32.768, o sea que a la transcripcion le quedaban ~18.000. Como el pensamiento **varia entre corridas** (se vieron de 12k a 46k), la MISMA entrada daba unas veces `STOP` y otras `MAX_TOKENS`. Subido a **64.000**. Al dimensionar `maxOutputTokens` de un modelo con thinking, presupuestar pensamiento + salida, no solo salida.
- **El audio sube directo a Storage; el criterio del tope pasa de PESO a DURACION.** Mientras el archivo viajaba en el cuerpo de la peticion mandaba el peso (4,5 MB ≈ 17 min). Fuera del cuerpo manda el reloj, que depende de los **minutos** y no de los megas: dos archivos de 18 MB, uno de 37 min y otro de 75, pesan igual y tardan la mitad y el doble. Bucket `calidad-audio` privado, subida por URL firmada, borrado en `finally` + barrido de huerfanos en cada subida.
- **Tope 45 min, medido y no extrapolado** (llamada real recortada a 4 duraciones, con 64.000 de presupuesto): 30 min → 110 s y 26k tokens; 40 → 99 s y 23k; 52 → 121 s y 31k; **65 → 242 s y 63k (98% del presupuesto)**. El reloj **no** crece lineal con la duracion: manda el pensamiento, que pega un salto entre 52 y 65. A 65 funciona gastando casi todo, que no es un tope sino una moneda al aire. Para pasar de 45 hacen falta plan Pro (reloj) **y** trocear (presupuesto).
- **`thinkingLevel: low` se probo y se descarto** para transcripcion: baja el reloj a un tercio, pero cambia las marcas a `MM:SS` y cuela un preambulo, y el preambulo corre las marcas y rompe las citas de la auditoria. (Confirma el gotcha ya escrito abajo: `thinkingBudget` numerico se **ignora** en la familia 3.x.)
- **⚠️ Tres de los "hallazgos" de esta sesion YA estaban escritos en este archivo** (cron sub-diario en Hobby, dos sesiones no comparten working tree, `thinkingBudget` ignorado en 3.x) **y se repitieron igual por no leerlo antes de empezar**. Costo: el deploy que no salia y un arbol ajeno pisado. **Leer la seccion de gotchas de este archivo ANTES de tocar `vercel.json`, de crear una rama, o de configurar un modelo.**

---

**Sesion:** 2026-07-28→29 (`metrik-one--soena` → producto: **rendimiento de bloques, bloque compartido entre etapas, fuente única del flujo y foto del proceso**). PRs **#124, #125, #129, #130, #132, #133, #136, #138, #141, #142, #143, #146, #148-#152** mergeados y desplegados.

- **⚠️ Las imágenes NO van dentro de `negocio_bloques.data` (#124).** Los campos `imagen_clipboard` guardaban el PNG en base64 en el jsonb. **Postgres descomprime el jsonb completo aunque se pida una sola clave** (probado: proyectar solo el campo hace timeout), así que cada lectura del bloque arrastraba la imagen entera. En SOENA la lista de negocios movía **22 MB por carga** y era el **32% del tiempo total de base de datos** (1.603 ms prom, 7.601 ms pico). Ahora `subirImagenClipboard` (`documento-actions.ts`) sube a Storage y en el bloque queda la URL; retrocompatible (el `<img>` no distingue). Resultado: consulta de **575 ms a 118 ms**, tabla de **34 MB a 1.3 MB**. **Regla general: nada pesado en `data`, encarece TODA lectura del bloque.** Script de migración: `scripts/migrar-imagenes-clipboard-a-storage.ts`.
- **Bloque compartido entre etapas (#130), `config_extra.compartido_con_origen`.** Un bloque `datos` que aparece en dos etapas porque el mismo dato se captura en dos momentos LEE y ESCRIBE la fila del origen, no una copia. Hacía falta porque **los bloques `datos` heredados COPIAN el dato en su propia fila** y `actualizarBloqueData` escribe siempre en la fila abierta: un dato en dos etapas eran dos verdades sin conciliar. Detalles: el guard se evalúa sobre el bloque ABIERTO (si no, un área no podría escribir en un bloque cuyo origen es de otra), `marcarBloqueCompleto` separa dato y completitud (el estado `completo` se queda en cada instancia, cada etapa tiene su gate), y si el origen no se encuentra se escribe donde el usuario está. Sin el flag, comportamiento idéntico.
- **Fuente única de "por dónde sigue el proceso" (#133), `src/lib/negocios/flujo.ts`.** Había TRES reglas distintas: `/flujo` usaba `orden + 1`, el botón Avanzar "la siguiente por orden ascendente" y el motor el routing. Como el `orden` NO es contiguo (los huecos son normales tras fusionar etapas), no son la misma regla y el diagrama podía dibujar un proceso distinto del que ejecuta el sistema. Regla canónica: routing que se apunta a sí mismo → cierra; routing con destino → ese destino; sin routing → siguiente por orden **ascendente** (nunca `orden + 1`). **8 tests** en `flujo.test.ts`.
- **⚠️ `etapas_negocio.numero` es el orden VISIBLE; `orden` es interno.** No coinciden: las etapas nuevas suelen insertarse al final del `orden` para no correr las existentes. Toda superficie que muestre u ordene etapas debe usar `numero`. El `WorkflowDiagram` y sus consumidores ya lo exponen (#129, #141).
- **Correcciones del `WorkflowDiagram`** (afectan a TODOS los workflows): no dibuja rombo cuando el routing no tiene condiciones (#132); la pregunta de una decisión sale del `label_pregunta` de la **etapa** que declara el routing, no del bloque que produce el campo (#136); las salidas muestran **todas** las respuestas con su destino real, derivadas del valor de la condición en vez de clavar "SÍ" a la rama (#138); y el camino por defecto acepta `routing.label_default` para explicar cuándo se toma (#141).
- **Vista "cómo avanza un caso" (#142, #143, #146)**, alternativa al diagrama en `/flujo` con selector. Las rutas se declaran en **`lineas_negocio.config_extra.rutas`** (columna nueva) por sus RESPUESTAS a las decisiones, no por una lista de etapas: el recorrido se **simula sobre el routing real**. Las decisiones que la ruta no fija se ofrecen como interruptores. Reusa `SlaConfig` del diagrama (ahora exportado) para no duplicar el editor.
- **Foto del proceso (#125, #129, #148-#152).** Tabla `proceso_snapshots` por **(etapa, seccional)** + `tomar_proceso_snapshot()` (pg_cron semanal), y RPC `horas_habiles_negocios(uuid[])` que reusa `horas_habiles_entre` para no crear una tercera implementación del algoritmo. Pestaña Proceso en `/tableros` gateada por `modules.proceso_semanal`. **Gotcha de Postgres:** la unicidad usa `coalesce(seccional,'')` porque los NULL no colisionan entre sí y la fila de "sin registrar" se duplicaría en cada corrida.
- **⚠️ Gotcha de convivencia: dos sesiones NO comparten working tree.** Una `git switch` de otra sesión reescribe tu árbol; pasó **cuatro veces** (archivos revertidos, y una rama que arrastró commits ajenos). Una sesión = un working tree (`git worktree` para la segunda), toda rama nace de `origin/main` fresco, y revisar `git status` antes de commitear. **La cuarta (2026-07-30) enseñó cómo detectarlo:** `git status` al empezar y al crear la rama daban resultados DISTINTOS (aparecieron migraciones ajenas de minutos de antigüedad, y desaparecieron archivos que otra sesión acababa de commitear). Ante esa diferencia, `git reflog` dice quién movió qué: ahí se vio `checkout: moving from <rama ajena> to <la mía>`. Se arregla devolviendo el árbol a la rama ajena y saliéndose a un worktree; si ambas ramas apuntan al mismo commit no hay daño de contenido, pero si se hubiera commiteado, los commits ajenos habrían caído en la rama propia.

---

**Sesion:** 2026-07-28→29 (`metrik-one--soena` → producto: **el aviso de entrada a etapa puede dirigirse a un área completa**). PR **#131** mergeado y desplegado.

- **`avisar_al_entrar.areas` (opt-in, genérico):** el aviso al entrar a una etapa (`trg_avisar_entrada_etapa` → `avisar_entrada_etapa()`) resolvía destinatarios **solo** con `destinatarios_negocio`, que mapea el *stage* de la etapa y conoce dos áreas: `venta`→comercial, `ejecucion`→operaciones, `cobro`→ambas. **No hay ruta al área financiera**, así que un aviso en una etapa de cobro nunca llega a quien factura. Ahora, si la etapa declara `config_extra.avisar_al_entrar.areas = ["financiera"]`, el aviso se reparte con `crear_notificacion_equipo` (pendiente de equipo: le llega a todos, lo resuelve cualquiera, vía `grupo_clave`). **Sin el campo `areas`, comportamiento idéntico al anterior** — ningún workspace ajeno cambia.
- **Por qué por área y no por rol:** `destinatarios_negocio` escala a `profiles.role = 'supervisor'` del área. Un usuario que **lleva** un área con rol `admin` (caso real en SOENA: cargo "Supervisor Financiero", rol `admin`) queda fuera de cualquier escalamiento por rol. `crear_notificacion_equipo` reparte por `staff_areas` **sin mirar el rol**, que es lo correcto para "avisarle al área". Tenerlo presente al diseñar cualquier routing nuevo: **el rol no es el área**.
- **La edge function resuelve destinatarios por su cuenta.** `notificar-etapa/index.ts` también llamaba `destinatarios_negocio`; se le agregó el mismo modo por área. **Si se cambia a quién notifica el trigger, hay que cambiar la edge function en el mismo commit**, o la campana le llega a unas personas y el correo a otras — un desfase invisible hasta que alguien pregunta por qué no le llegó el correo.
- **`grupo_clave` incluye el área** (`etapa:<id>:negocio:<id>:area:<area>`): si un aviso va a dos áreas, que una lo resuelva NO debe borrarlo para la otra (son trabajos distintos sobre el mismo hecho).
- No se agregó ningún tipo de notificación: se reusa `negocio_en_etapa`, que ya está en el CHECK de `notificaciones.tipo`. **Un tipo ausente del CHECK hace fallar el insert en silencio** (ya costó tres incidentes).
- **Gotcha de verificación:** para probar un trigger que manda correos reales, `begin; …updates…; select …; rollback;` en una sola sentencia. `net.http_post` encola dentro de la transacción, así que el rollback también cancela el envío. Verificado: 0 notificaciones residuales, 0 correos disparados.

---

**Sesion:** 2026-07-20→21 (`metrik-one--soena` → producto: **extracción IA — modelo con thinking + edición de campos con trazabilidad**). PRs **#82, #84** mergeados a `main` y desplegados.

- **Extractor de documentos con thinking (#82, `src/lib/ai/extract-fields.ts`):** `GEMINI_MODEL` de `gemini-3.1-flash-lite` a **`gemini-2.5-flash`** con `thinkingConfig.thinkingBudget: 1024` y `maxOutputTokens: 8192`. Los errores de extracción semántica (razón social vs nombre comercial, prefijo de factura, municipio) los corrige el razonamiento, no el umbral de confianza. **Gotcha:** la familia 3.x usa `thinking_level` (minimal/low/medium/high), NO `thinkingBudget` numérico; combinar `gemini-3.1-*` con `thinkingBudget:0` (sintaxis 2.5) hace que el parámetro se **ignore** (corre en thinking mínimo, no apagado). Alinear siempre modelo↔sintaxis. La regla global del prompt "códigos: solo dígitos" se acotó a NIT/cédula (antes despojaba el prefijo alfabético de facturas/radicados).
- **Edición de campos extraídos con marca de trazabilidad (#84, genérico opt-in):** `CampoResultado` gana `edicion { editado_por_id, editado_por_nombre, editado_en }` (`extract-fields.ts`). `actualizarCampoDocumento` (`documento-actions.ts`) ahora: (a) estampa quién+cuándo al editar a mano; (b) **gana un guard de permiso que antes no tenía** (hueco: cualquiera autenticado escribía el campo) — etapa activa vía `guardEditarBloque`, y en modo visible (etapa posterior) solo rol gerencial (owner/admin/supervisor) o el path histórico `editar_extraidos + alerta_revision`. `BloqueDocumento` recibe prop `userRole` + flag de bloque `config_extra.corregir_campos_gerencial` (opt-in): en modo visible el gerencial corrige TODOS los campos; badge "Editado · {nombre}" (tooltip con fecha) reemplaza el de confianza en campos editados. La alerta "Revisar" ahora depende de `alerta_revision` del campo, no de si es editable.
- **Certificado como fuente de verdad = precedencia de `campos_fuente`, no sobrescritura (patrón, config-only):** para que un documento (ej. el certificado UPME) gobierne un campo del formulario sobre otro documento previo (ej. la factura), se re-apunta la casilla en `campos_fuente` con la fuente autoritativa como `source` y la anterior en `source_alternatives`. `resolverCamposFuente` usa la primera con valor (confianza ≥ 0.70) → si la autoritativa viene vacía, cae a la alternativa. No muta datos, no requiere código. Aplicado en SOENA (Relación de Facturas lee marca/línea del cert). Detalle en `proyectos/soena/ve/`.

---

**Sesion:** 2026-07-09→14 (`metrik-one--soena` → producto: **carpeta de Drive universal + auth service-account + reconciliador de documentos + búsqueda por radicado**). PRs #49-#53 mergeados a `main` y desplegados.

- **Carpeta de Drive universal (#49):** helper idempotente `src/lib/negocios/ensure-drive-folder.ts` (`ensureNegocioDriveFolder(supabase, workspaceId, negocioId)`) — una sola vía para formulario/Meta/manual/backfill/cron. `crearNegocio` lo llama (ya no lógica inline). Cron `/api/crons/ensure-negocio-folders` (sweep de `carpeta_url IS NULL`). Skip sin padre → `activity_log` `drive_folder_skipped` (ya no silencioso).
- **Auth service account + DWD (#50):** modo `service_account` en `src/lib/google-drive.ts`. Si `workspaces.config_extra.drive_auth_mode='service_account'` + `drive_impersonate_user`, `getAccessToken` firma un JWT con la llave del SA (`GOOGLE_DRIVE_SA_KEY`, fallback `METRIK_PDF_RENDER_SA_KEY`) e impersona al usuario via domain-wide delegation → token que **no caduca**. Retrocompatible: los demás ws siguen con OAuth (`drive_refresh_token`). Reusa el patrón JWT de `pdf-render-client.ts`.
- **Reconciliador de documentos (#51):** helper `src/lib/negocios/push-documento-drive.ts` empuja a Drive los docs atascados en Storage (con nombre `${label}.${ext}` en su subcarpeta). Cron `/api/crons/ensure-negocio-documentos`. Excluye bloques readonly heredados (`config_extra.source_etapa_orden`) — apuntan al mismo archivo de Storage que su origen (doble-borrado → 404). `documento-actions.ts` NO se refactorizó (el push está entrelazado con extracción AI; el helper replica la mecánica).
- **Búsqueda + tarjeta por radicado (#52):** `negocio_card.radicado_bloque/radicado_campo` (config-driven, patrón de la cédula). `getNegociosV2` extrae → `NegocioResumen.radicado`; búsqueda client-side lo matchea; `NegocioCard` lo muestra.
- **⚠️ Gotcha Vercel — plan Hobby (RESUELTO el 2026-08-11: el team pasó a Pro, el cron sub-diario ya es posible).** Se conserva porque el síntoma sigue siendo el mejor ejemplo de fallo mudo de este archivo, y porque los 9 crons de `vercel.json` siguen diarios por inercia. En Hobby solo permitía crons **diarios**. Un schedule sub-diario (`*/15 * * * *`, `0 */6 * * *`) hace **FALLAR el build**. Todo cron nuevo en `vercel.json` debe ser diario salvo que se suba a Pro. **Volvió a pasar el 2026-07-30, y el síntoma es peor de lo que decía esta línea: no se ve un `deploy_failed` en ninguna parte, simplemente NO APARECE deployment.** `vercel ls` y la lista de la API no muestran nada, el merge queda en `main` y producción sigue sirviendo lo anterior, sin error visible. El mensaje real (`cron_jobs_limits_reached`) solo se obtiene pidiendo el deploy por API (`POST /v13/deployments`). **Si un merge a `main` no genera deployment, sospechar de `vercel.json` ANTES que del webhook** (el fix de `git disconnect/connect` de abajo no aplica a este caso y hace perder tiempo). Si algo debe correr más seguido que a diario, no puede ser un cron: colgarlo de una acción del usuario (el barrido de audios huérfanos corre en cada subida, y el cron diario quedó de red).
- **⚠️ Gotcha Vercel — auto-deploy se desincroniza:** los pushes a `main` dejaron de deployar ~2 días (sin errores visibles, simplemente no dispara). Fix: `vercel git disconnect && vercel git connect` re-sincroniza el trigger; luego el siguiente merge deploya. Verificar `vercel ls` tras mergear.

---

**Sesion:** 2026-07-08 (`metrik-one--soena` → producto: **defaults del contacto de lead Meta (fuente/rol) + segmento automático por ciclo de vida**). Rama `feat/soena-meta-lead-contacto-defaults` (PR, sin mergear).

- **Webhook `meta-leads-webhook`** — `config_extra.meta_leads.contacto` = `{ fuente_adquisicion, fuente_detalle, rol_natural, tipo_persona_field, natural_value, segmento_inicial }`. Al crear el contacto: fuente = `pauta_digital`, rol = `decisor` solo si el lead declara persona **natural**, segmento inicial = `sin_contactar`. Opt-in; no pisa contactos existentes (dedup).
- **`sincronizarSegmentoContacto` (`negocio-v2-actions.ts`)** — llamada en `cambiarEtapaNegocioConGate` tras cada avance: mapea la etapa del negocio al segmento del contacto por ciclo de vida (entrada de venta → `sin_contactar`, resto de venta → `contactado`, ejecución/cobro → `convertido`). **Solo sube** (rank), no reactiva `inactivo`. Genérico (todos los negocios). En `perderNegocio`: contacto → `inactivo` si era su único negocio abierto.
- **Config + backfill SOENA** (`proyectos/soena/ve/migrations/20260708_meta_lead_contacto_defaults.sql`): config aplicada; 4 contactos de Meta → fuente `pauta_digital` + rol `decisor` + segmento `sin_contactar`.

---

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
- **Forzar emisión de un período:** `scripts/emitir-cuentas-periodo.ts --anio <n> --mes <n> [--ws <slug>] [--commit]`. Sin `--commit` es dry-run. Reemplaza los scripts de un solo uso por mes (`generar-cuentas-mayo/junio-metrik.ts`, borrados): eran el mismo código con el mes clavado, y cada copia era una oportunidad de desincronizar el período y la fecha de emisión. Junio emitido: CC-2026-06-001 AFI $916.667 + CC-2026-06-002 SOENA $1.750.000 (`cuentas_cobro_emitidas`, estado `emitida_pendiente_aprobacion`).

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
- **Fix:** declarar `verify_jwt = false` en `config.toml` para `wa-webhook` + redeploy `--no-verify-jwt`. El webhook valida autenticidad por su cuenta (firma HMAC-SHA256 `x-hub-signature-256` + handshake GET con `WHATSAPP_VERIFY_TOKEN`), asi que NO abre hueco. Blindados tambien `wa-parse-test` y `wa-notify-internal` (verify_jwt=false versionado). `wa-alerts`/`evaluar-reglas` se quedan en `true` a proposito (crons internos con service key). **⚠️ Ese supuesto caduco:** el 2026-08-31 se midio que `wa-alerts` devolvia **401 `UNAUTHORIZED_LEGACY_JWT`** en sus cuatro crons — el gateway dejo de aceptar la key legacy. Corregido a `verify_jwt = false` + secreto propio (`WA_ALERTS_SECRET`). `evaluar-reglas` sigue en `true` y **se midio el mismo dia: NO esta rota** — un GET con la anon key legacy devuelve 405, o sea que el gateway la deja pasar. Lo que dejo de aceptarse fue el token de los crons de `wa-alerts`, no toda credencial legacy.
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

- **Referencias de bloque por `slug` estable (2026-06-12) — preferir slug, no nombre/orden.** El motor ahora soporta referenciar el bloque fuente por `bloque_configs.slug` (identidad estable, única por línea, inmune a rename/reorder). Campos nuevos en `config_extra`: `cross_check.checks[].source_bloque_slug` (+ en `source_alternatives`), `campos_fuente[].source.bloque_slug` (+ alternatives), `fields[].auto_fill.source_bloque_slug`, `fields[].doc_link.source_bloque_slug`, `condition.source_bloque_slug` (render cliente + gate SQL `condicion_cumplida` priorizan slug, con flattening de campos para paridad), y `source_bloque_slug` top-level en heredados readonly (paths `documento` por etapa::nombre y `propuesta_economica` por orden migrados; los `datos` readonly ya eran estables por `bloque_definition_id`). **Todos los consumidores priorizan el slug y caen al método legacy (nombre/orden) solo si la ref no trae slug** — retrocompatible. Heredados readonly tienen `slug=NULL` (apuntan a su origen). **Corolario (2026-08-25, PR #395): un consumidor que necesite el ARCHIVO de un bloque documento resuelve por el slug del ORIGEN, nunca por la instancia de la etapa donde esta parado.** La copia no tiene slug que declarar, y ademas `getNegocioDetalle` le hace swap a su `data` por la del origen antes de pintarla: el `drive_url` que la copia tenga guardado puede ser data vieja que la plataforma no muestra en ningun lado (medido: 11 de 42 en Entrega de SOENA). **Al configurar una ref nueva, usar el slug** (no el nombre). **Validar con `SELECT * FROM audit_block_slug_refs('<linea_id>') WHERE NOT ok;`** (unicidad de slug + que todo slug referenciado exista) — companion de `audit_workflow_refs`. Migrations producto `20260612000001` (columna) + `20260612000002` (audit). Backfill por línea es workspace-específico (`proyectos/<cliente>/<linea>/migrations/`). SOENA VE ya migrado (158 refs: 49 auto_fill + 10 cross_check + 55 campos_fuente + 20 condition + 24 readonly). Migrations producto `20260612000003` (condicion_cumplida branch slug). Spec: `docs/specs/2026-05-26_block-references-by-slug.md`. **El bug DC13 (cross-check vacío al renombrar un bloque) queda estructuralmente cerrado.**
- **⚠️ La vía "preferida" por slug dependía en secreto de la vía legacy, y el síntoma era una etapa EN BLANCO.** `datosPorSlug` (el índice que el render usa para resolver `condition.source_bloque_slug`) se poblaba **solo** con los bloques de las etapas recogidas en `sourceEtapaOrdens`, y ese conjunto se armaba **únicamente** de `source_etapa_orden`. Una referencia que declaraba **solo el slug** —que es lo que la documentación pide— no alcanzaba nunca a su origen: el índice salía vacío, la condición caía al bag de la etapa actual, el campo no estaba ahí y el bloque **no se renderizaba**. Mientras tanto el gate en SQL (`condicion_cumplida`) **sí** resuelve el slug dentro de la línea, así que seguía exigiendo el bloque. Resultado: **un negocio sin nada que completar en pantalla y sin poder avanzar** — nadie puede desatascarlo desde la aplicación. **Medido en SOENA (2026-08-10):** los 3 bloques de la etapa Notificación, **39 negocios abiertos**; eran los únicos 3 `bloque_configs` de toda la base con esa forma (slug sin orden y sin el origen en su misma etapa), lo que explica que llevara meses sin verse. Las condiciones de la etapa **Cita** tienen la misma forma y funcionan **por casualidad**: ahí el bloque origen vive en la propia etapa, así que el bag local lo cubre. Fix: `src/lib/negocios/referencias-fuente.ts` recolecta **las dos** formas (`condition`, `auto_fill`, `lock_when`) y los slugs que quedan sin resolver se traen por slug dentro de la línea, la misma semántica del SQL. **Regla general: cuando un dato se puede declarar de dos formas y una es la recomendada, verificar que la recomendada funcione SOLA** — aquí la nueva se apoyaba en la vieja y nadie lo notó porque casi toda la configuración declaraba ambas. **Y al diagnosticar: un bloque invisible cuyo gate sigue exigiendo es la firma de que render y gate resuelven la referencia por caminos distintos.**
- **⚠️ Una etapa destino recibe casos de MÁS DE UNA rama, y un gate nuevo los frena a todos.** Al agregar un gate a una etapa, la pregunta no es "¿qué necesita el caso que viene de aquí?" sino **"¿quiénes más entran a esta etapa?"**. Medido en SOENA (2026-08-10) al mover el aviso de la cita a Anexos: esa etapa recibe la rama con cita (desde Cita) **y** los casos que nunca la tuvieron (desde Entrega, con `requiere_cita_dian_iva=false`). El gate nuevo les habría pedido avisar una fecha inexistente y **habría bloqueado 4 casos vivos**. Se resolvió condicionando el bloque a haber pasado por la rama (`condition` sobre un campo que **solo existe** si el caso pasó por ahí: `via_solicitud`, con `value_in` para aceptar cualquiera de sus valores). **Un campo ausente hace la condición falsa**, así que la exigencia se apaga sola en quien no recorrió esa rama. Al revés también aplica: si una rama deja de pasar por una etapa, el aviso de entrada que esa etapa daba **desaparece para ella** — en el mismo cambio, la vía agenda dejó de recorrer Notificación y nadie le avisaba ya al comercial; hubo que darle a Anexos su propio `avisar_al_entrar`.
- **⚠️ Un gate de solo lectura que la pantalla no puede cerrar retiene el negocio para siempre — y ya van tres formas de llegar ahí.** Las dos primeras están arriba (`visiblePuedeNacerCompleto`, `gateVisibleQuedaResuelto`). La tercera nace con `editable_solo_si_vacio` (2026-08-10): un bloque heredado que se vuelve de solo lectura **porque el dato ya viene lleno**. Si además es `es_gate`, hay que cerrarlo en el servidor en la misma pasada; si no, el caso queda esperando un dato que tiene delante. Cerrarlo **al abrir el negocio** deja el estado correcto de forma perezosa: hasta que alguien entre, el gate figura pendiente. Para los que ya estaban en la etapa hace falta un barrido con el MISMO criterio del código. **Regla general: cada vez que se agregue una razón nueva por la que un bloque pase a solo lectura, revisar si esa razón puede aplicarle a un gate.**
- **Un gate cuyo paso VENCIÓ puede quedar en "no aplica" (`config_extra.omitible_por`, opt-in, 2026-08-10).** Distinto de saltarse un control: el paso perdió su objeto. Caso canónico (SOENA): el comercial avisa que la DIAN enviará un enlace para agendar; si la DIAN asigna la cita **antes**, ese aviso ya no le sirve a nadie. Tres reglas que lo mantienen honesto: **(a)** el pendiente NO se borra ni se marca "completo" a secas — queda con motivo, autor y fecha, más su línea en el timeline, porque un pendiente eterno impide distinguir después un incumplimiento de un proceso que se adelantó; **(b)** lo declara vencido el ÁREA que trabaja el hecho que lo vence, nunca el área dueña del bloque (el comercial no puede saltarse su propio aviso); **(c)** si la config de los gates pendientes no se puede leer, **se retiene** — el lado seguro de un control es frenar, no dejar pasar por falta de información. Complemento: `etapas_negocio.config_extra.areas_que_avanzan` permite que otra área avance una etapa ajena sin volverla suya. Módulo `src/lib/negocios/gate-omitible.ts`.
- **Reordenar etapas (reorg) rompe referencias por `orden` — correr `audit_workflow_refs` despues.** El workflow encoda referencias cross-etapa por `etapa_orden` en `bloque_configs.config_extra` (7 clases: `source_etapa_orden` de herencia readonly, `condition.source_etapa_orden`, `fields[].auto_fill.source_etapa_orden`, `fields[].doc_link.source_etapa_orden`, `cross_check.checks[].source_etapa_orden`, `campos_fuente[].source.etapa_orden`, y `routing` en `etapas_negocio`). Insertar/reordenar etapas cambia `orden` pero **NO** recalcula esas referencias → quedan stale (apuntan a la etapa equivocada, leen datos vacios/incorrectos en silencio). **Despues de cualquier reorg:** `SELECT * FROM audit_workflow_refs('<linea_id>') WHERE NOT ok;` — devuelve cada ref stale + `donde_vive` (el orden correcto). Vacio = sano. Migration `20260602000003`. Nota: `etapas_negocio.numero` es el identificador ESTABLE (no cambia al reordenar); las referencias por orden son la deuda. La capa de slug (gotcha de arriba) es la vía robusta preferida y ya cubre las 7 clases en SOENA VE (incl. `condition` y herencia readonly); `source_etapa_orden` queda solo como fallback legacy para líneas no migradas. **Al escribir codigo que lea datos cross-bloque, preferir el slug; si la ref es legacy, resolver por NOMBRE de bloque (ignorando heredados con `config_extra.source_etapa_orden`), no por orden de etapa** — patron en `guia-devolucion-actions.ts` y el preview `guia_devolucion` de `negocio-v2-actions.ts`.
- **⚠️ Una RPC con consumidores en produccion se AMPLIA, no cambia de forma.** La base de Supabase es **compartida entre `main` y cualquier rama**: aplicar una migracion desde una rama impacta produccion al instante, aunque el codigo de esa rama no este desplegado. Si la migracion cambia la forma de lo que devuelve una funcion (renombrar claves, moverlas dentro de un objeto, quitarlas), el codigo YA desplegado deja de encontrarlas y la pantalla se rompe en vivo con los datos intactos — falla silenciosa, sin error en logs. **Paso el 2026-07-28** con `get_calidad_muro`: v6 movio `cierres`/`cobertura`/`banderaTop`/`rankings` dentro de `periodos` y el muro publico de Regat quedo ~20 min mostrando "Sin llamadas en este periodo". **Procedimiento:** (1) la migracion agrega las claves nuevas y **conserva las viejas** (proyectadas del mismo dato, no recalculadas) para que el consumidor viejo y el nuevo convivan; (2) se mergea y despliega el consumidor; (3) recien ahi otra migracion borra las claves viejas. Marcar las claves de compatibilidad con un comentario `BORRAR tras el merge` para que no se queden por inercia. Lo mismo aplica a DROP/rename de columnas y vistas que la app lea.
- **⚠️ Cuando el codigo y los datos tienen que cambiar juntos, la ventana entre uno y otro es una ventana de MENTIRA, no solo de error.** Tercera cara de la misma familia. Si el codigo nuevo AFIRMA algo sobre como se calcula una cifra ("descontado lo que rebota") y la migracion que cambia el calculo llega despues, en el intervalo la pantalla funciona perfecto y dice algo falso. **Paso el 2026-07-29** con el muro de Regat: se desplego el texto nuevo y durante unos minutos la linea decia "entra US$1.731 en la primera · descontado lo que rebota" mientras el numero seguia siendo el sexto aritmetico, en una pantalla publica con enlace repartido. Peor que el incidente de la RPC: alli el sintoma fue una pantalla rota, que se ve; aqui fue una pantalla sana que miente, que no se ve. **Regla:** si el copy describe el calculo, copy y calculo viajan en el mismo movimiento — la migracion se aplica pegada al merge, no cuando alguien tenga tiempo. Y si la ventana es inevitable, que el copy no afirme nada sobre el metodo hasta que el metodo exista.
- **⚠️ Si el cambio toca DATOS, el control se mide ANTES de escribir.** Corolario de la regla de arriba, y por la misma razon: la base es una sola, compartida entre `main` y todas las ramas, y puede haber un cliente mirandola. Antes de correr un script que reescriba filas que alguien ya reviso en pantalla, hay que saber **que numeros deben quedar** — calculandolos, o midiendo un sembrado de control con el cambio apagado. Verificar despues no sirve: para cuando se detecta la desviacion, el dato ya esta en produccion. **Paso el 2026-07-29** al sembrar tendencias en el historial de Regat: la deriva se centro en la mitad del calendario, pero como la deriva de un dia es la MISMA para todas las llamadas de ese dia, al redondear se empujaron todas hacia el mismo lado y el error no se cancelo entre dias; dos casillas del ranking del muro se movieron un punto y se descubrio despues de aplicar. **Procedimiento:** (1) apagar el cambio y medir la linea base contra la base; (2) aplicar; (3) comparar contra la linea base medida, no contra lo que uno recuerda. El paso 1 es el que se salta y es el unico que no se puede reconstruir despues. **Y dos trampas al elegir QUE medir:** (a) el agregado absorbe casi todo — al resembrar el historial de Regat el total se movio 0,2% mientras el DIA de la demo se movia 8,7% en cierres y en dinero, que son justo las cifras que se proyectan; mide el corte que importa, no solo el total. (b) El resumen con el que uno verifica tiene que derivarse del DATO, no de la variable que uno cree que lo representa: el script de sembrado calculaba "el dia ancla" desde un arreglo en memoria y, al mover dos llamadas de dia, siguio contandolas donde ya no estaban — reportaba 98 llamadas donde la base tenia 96, y ese mismo conteo alimentaba la tabla de cobertura. Una comprobacion que hereda el supuesto del codigo no comprueba nada.
- **⚠️ El conteo de sitios que deja escrito un fix previo NO es un inventario cerrado, y dos controles con la misma expresion NO son el mismo control.** Dos caras del mismo incidente, y la segunda es la cara cara. (a) El handoff del fix de saldo del 2026-08-03 declaro *"tres sitios con la misma expresion"* y **eran cuatro**: el gate `conciliacion_diana` de la etapa Cobro quedo con `precio_aprobado` crudo y siguio frenando negocios que habian pagado **exacto** (V0076: $988.406 = $637.500 de honorario + $350.906 de tarifa, retenido desde el 22-jul reclamandole justo la tarifa). Un numero escrito se lee como exhaustivo, pero solo refleja lo que encontro quien lo escribio. **Buscar la formula por su FORMA en el codigo** (aqui: `precio_aprobado` comparado contra la suma de cobros), tratando el conteo heredado como piso y nunca como techo. (b) Ese cuarto sitio **no se podia corregir copiando la solucion de los otros tres**: `sobrepago_conciliado` bloquea en UNA direccion (solo si sobra) y `conciliacion_diana` en LAS DOS (`|diferencia| > 1`). Medir los dos lados contra honorario + tarifa arregla el exceso y **rompe el faltante**: los clientes que le pagan la tarifa directo a la UPME aparecen debiendo. Simulado sobre los 223 abiertos ANTES de escribir codigo, esa version destrababa 17 y **habria retenido 62**, la mayoria ya en Cita, Envio o Generacion; la asimetrica (faltante contra el honorario como `saldo_cero`, exceso contra el valor a recaudar como `sobrepago_conciliado`) destraba 18 y retiene 0. **Antes de replicar un fix entre sitios, verificar en cuantas direcciones bloquea cada uno.** PR #206. La decision vive en el helper puro `descuadreConciliacion` (`src/lib/upme/modelo-dinero.ts`), no dentro de la server action, para que sea testeable sin mocks.
- **⚠️ Una prueba que sale "bien" puede estar saliendo bien POR LA RAZON CONTRARIA.** Cuarta cara de la misma familia, y la mas dificil de ver porque el resultado no se distingue del correcto. **Paso el 2026-07-29:** al ampliar `calidad_ranking_periodo` medi el muro antes y despues y salio identico byte a byte, y reporte eso como prueba de que el ranking tiene UNA sola fuente. Era identico **precisamente porque el muro NO usa esa funcion**: desde la v6 calcula su ranking en linea dentro de `calidad_bloque_periodo`, y `calidad_ranking_periodo` habia quedado codigo muerto. La coincidencia no confirmaba la union, confirmaba la ausencia de vinculo. **Procedimiento:** cuando una medicion respalde una afirmacion sobre el MECANISMO ("estas dos pantallas comparten el calculo"), verificar el mecanismo directamente y no por su sintoma — `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and position('<funcion>' in pg_get_functiondef(p.oid))>0` dice quien la llama de verdad. Un md5 igual prueba que el cambio fue inocuo; NO prueba que haya una sola fuente.
- **✅ DEUDA PAGADA (2026-07-30, PR #159) — el ranking de calidad ya se calcula en UN solo sitio.** Estuvo congelada un dia: el muro lo reimplementaba en linea dentro de `calidad_bloque_periodo` mientras `get_calidad_equipo` delegaba en `calidad_ranking_periodo`. Hoy **las dos delegan** y `percentile_cont` ya no aparece en `calidad_bloque_periodo` — verificado por mecanismo con `pg_get_functiondef`, no por el md5 (que solo prueba inocuidad, ver el gotcha de arriba). Se conserva el registro porque la leccion sigue viva: **el ranking es zona de una sola fuente.** Si alguien vuelve a calcular filas o umbrales fuera de `calidad_ranking_periodo`, la deuda regresa. Al cambiar columnas, orden o umbrales, tocar solo esa funcion y medir el md5 del nodo `ranking` antes y despues.
- **⚠️ Agrupar personas por el TEXTO del nombre funde homonimos en silencio, y los datos de demo lo esconden.** Las dos copias del ranking agrupaban por nombre: el muro por `split_part(agente_nombre,' ',1)` (el primero, porque la pantalla es publica) y la vista de equipo por el completo. Con los 4 agentes sembrados de un workspace demo eso NO se ve, porque tienen primer nombre distinto; con los ~80 vendedores reales de Advise, dos "Andres" se funden en UNA fila en el muro y salen como DOS en la pantalla del supervisor — la misma contradiccion que la deuda de arriba queria evitar, entrando por otra puerta. **Regla:** agrupar SIEMPRE por identidad (`agente_staff_id`, con `coalesce` al nombre solo como respaldo) y usar el nombre unicamente para MOSTRAR. Si la pantalla necesita el nombre corto, desambiguarlo al pintarlo (`Andres` → `Andres V.` → `Andres Villamil`), no al agrupar. **Antes de aplicar el coalesce, comprobar que ningun agente tenga llamadas partidas entre filas con `staff_id` y filas sin el**: es lo unico que dividiria a una persona en dos. **Deuda abierta del mismo patron:** `get_calidad_perfil_agente` todavia resuelve por `agente_nombre = p_agente`, asi que con homonimos reales el ranking los separa y el perfil los mezcla; arreglarlo toca el slug de `/calidad/agente/[slug]`.
- **⚠️ Al agregar por periodo, el VOLUMEN se pondera y se muestra — si no, el ruido de muestra chica se lee como desempeño.** Quinta cara de la familia de verificacion, esta vez en la pantalla y no en la prueba: el dibujo convence de un cambio que no ocurrio. **Medido el 2026-07-30** en el perfil de agente de Advise: el mismo agente va de 1 a 12 llamadas por dia (promedio 5,6). El 12 de julio hizo 2 llamadas y promedio 82, su mejor marca del mes; el 13 hizo 1 y promedio 53. Unir esos puntos dibuja un derrumbe de 24 a 29 puntos que es puro azar muestral, y una grafica asi es PEOR que la que reemplaza: igual de ilegible, pero mas convincente. **Procedimiento:** (1) el punto codifica el tamaño de la muestra (radio por **raiz** del volumen: lo que el ojo compara en un circulo es el area, no el radio); (2) la linea de trayectoria NO une los valores crudos, es una media movil **ponderada por volumen** — equivale a promediar todas las observaciones de la ventana, asi que un dia de 1 llamada casi no la mueve; (3) ventana hacia atras y no centrada, para no usar dias posteriores al dibujar el punto de hoy; (4) avisar en el tooltip cuando la muestra del punto es minima. No ocultar los periodos chicos: desaparecen dias de trabajo real y abren una pregunta que la pantalla no puede responder.
- **⚠️ Un descargo sobre el ORIGEN de los datos se cuenta, no se escribe a mano.** Variante del gotcha de "pantalla sana que miente", y mas peligrosa porque el texto es plausible y nadie lo verifica mirando. El pie del muro decia, fijo en el codigo, *"Datos de demostracion: una llamada real, el resto es muestra"*. En Regat era cierto **por casualidad** (1 real de 2.824); en Advise era FALSO (0 de 565), y esa pantalla se proyecta delante del cliente. Encima, la frase falsa era justo la que le da credibilidad a todo lo demas. **Regla:** cualquier afirmacion sobre cuantos datos son reales, de que periodo salen o de que fuente vienen, se deriva de un conteo de la base (`get_calidad_muro` gana `muestra {reales, total}` y la pantalla redacta), y el campo se declara OPCIONAL en el tipo para que, si el codigo llega antes que la migracion, la pantalla **calle** en vez de inventar. Si el conteo dice que todo es real, la linea no se pinta: no es una demostracion.
- **⚠️ HALLAZGO ABIERTO — la segmentacion por rol del producto es de APLICACION, no de base.** Ninguna de las 51 migraciones con policies filtra por rol: todas filtran por `workspace_id = current_user_workspace_id()`. Los permisos de `src/lib/roles.ts` los aplican los server actions, y **las RPC son `security invoker` con `grant execute to authenticated`**, asi que con la anon key del bundle mas su propio JWT un usuario alcanza la RPC por PostgREST sin pasar por ningun guard. Medido el 2026-07-29 en el modulo calidad: un `operator` obtenia las 565 llamadas del piso (sus propias eran 130), el ranking completo con `vendidoUsd` por agente, el perfil de un companero y **la vista de dinero del dueno** (vendido US$78.302, recaudado US$69.634). El comentario de `calidad/actions.ts` ya lo declaraba para la lista y aclaraba que "replica el modelo vigente del producto" (mismo caso en `/negocios`). **Calidad quedo cerrado** (PR #160: policies por rol y por agente + el dinero fuera del alcance del token del usuario); **el resto del producto sigue abierto y es decision pendiente de Mauricio**, no un olvido. Al escribir una RPC nueva que devuelva datos segregables por persona o dinero, asumir que el guard del server action NO la protege: cerrar tambien en la policy. Al escribirla, **leer el rol de `profiles.role`, nunca de `get_user_role()`** (ver el gotcha de vocabularios de rol abajo).
- **⚠️ Dos vocabularios de rol coexisten en la base: `profiles.role` y `staff.rol_plataforma`.** El helper `get_user_role()` devuelve el SEGUNDO (`ejecutor`, `dueno`), no el que usa la app (`operator`, `owner`). Una policy o guard SQL escrito con `get_user_role() = 'operator'` no coincide nunca y falla en silencio. **Y la trampa: probado con un `supervisor` pasa**, porque es el unico rol donde los dos vocabularios coinciden (`supervisor` = `supervisor`); con `operator` u `owner` no. Para autorizacion en SQL usar `profiles.role` (helper `current_user_profile_role()`, creado en `20260730000010`). Nunca validar un vocabulario de rol usando al supervisor como caso de prueba.
- **⚠️ `plpgsql` cachea planes: un arnes de prueba que mide ANTES y DESPUES en la misma sesion puede dar un FALSO NEGATIVO.** Al verificar la migracion `20260730000010` dentro de una transaccion, la medicion de la RPC reportaba el mismo total antes y despues (545) cuando la RLS nueva ya recortaba a 129: la funcion de medicion habia planificado la llamada con las policies viejas y reusaba ese plan. Los `count(*)` directos si se replanificaron, asi que el arnes mentia **solo en la metrica de la RPC** — el error mas facil de creer, porque las demas cuadraban. Fix: `discard plans;` entre la aplicacion del cambio y la segunda medicion, o dos funciones de medicion distintas. Corolario de la familia de gotchas de verificacion: aqui la prueba fallo por el arnes, no por el cambio; antes de concluir que un fix no sirve, descartar el instrumento.
- **⚠️ Responder 200 y seguir trabajando PIERDE el trabajo, y el proveedor no reintenta.** En Supabase Edge Functions (Deno), lo asincrono que queda vivo DESPUES de devolver la Response no esta garantizado: el runtime puede reciclar el worker a mitad de camino. El patron peligroso, comun en webhooks que quieren responder rapido:
  ```ts
  processPayload(payload).catch(e => console.error(e))
  return new Response('OK', { status: 200 })   // <-- el trabajo puede morir aqui
  ```
  Hay que envolverlo en `EdgeRuntime.waitUntil(promise)` (con fallback a `await` fuera del runtime, para local/tests). **Por que es peor que un error normal:** al responder 200 el proveedor da la entrega por buena y **nunca reintenta**; el registro HTTP queda en verde, los logs no muestran nada y el dato se pierde definitivamente. **Medido el 2026-07-31** en `meta-leads-webhook` (SOENA): **18 de 153 leads (12%) nunca llegaron**, 16 concentrados en cuatro dias. La perdida es intermitente y empeora en rafagas, que es justo lo que predice el reciclaje del aislamiento. **Regla:** en un webhook, o se procesa antes de responder, o el trabajo diferido va dentro de `waitUntil`. Y **todo evento recibido deja fila ANTES de procesarse** (`meta_leads_eventos` es el patron): sin esa fila, un corte a mitad es indistinguible de que el evento nunca llego. Familia del mismo fallo mudo: el gotcha de `verify_jwt` en `config.toml`.
- **⚠️ Un fallo mudo solo se detecta cruzando contra la fuente EXTERNA.** Corolario del anterior y de la familia de gotchas de verificacion. Cuando el sistema responde 200 y pierde el dato, **no se puede auditar contra si mismo**: por dentro todo cuadra. La perdida de leads de Meta llevaba semanas y se descubrio porque HubSpot conservaba su propia suscripcion a Meta y el equipo vio ahi un lead que en ONE no estaba. **Al integrar una fuente externa (Meta, pasarelas, ERPs), conservar un segundo receptor independiente hasta que un cruce periodico de conteos de cero diferencias sostenido**, y automatizar ese cruce. Apagar el sistema viejo el dia que entra el nuevo elimina el unico instrumento capaz de delatar el fallo. **Y la contraprueba llega por otra via:** 16 de los 18 leads perdidos tenian el contacto creado a la misma hora, sin su interaccion; eso ubica el corte entre dos inserts, sin depender de logs que ya expiraron.
- **⚠️ Un salto de linea invisible en una env var de Vercel tumba produccion, y el sintoma no apunta a la variable.** Ya paso DOS veces. La primera con `NEXT_PUBLIC_BASE_DOMAIN`: rompio el routing por subdominio de todos los tenants. La segunda, **medida el 2026-08-02**, con `NEXT_PUBLIC_SUPABASE_ANON_KEY`: el `\n` se horneaba en el bundle, el navegador lo mandaba como **`%0A`** en el parametro `apikey` del WebSocket y el gateway de Supabase respondia **401**. Resultado: **17.007 rechazos en 24 horas, cero conexiones exitosas**, durante semanas.
  **Por que cuesta tanto encontrarlo:** (a) el navegador **recorta** el whitespace al construir la URL base, pero un valor que viaja como **query param** se URL-encodea en vez de recortarse — por eso la URL funcionaba y la key no; (b) el REST no se veia afectado porque en ONE **todas las peticiones REST salen del servidor**, con otras variables; (c) el servicio Realtime **no registra nada**: el rechazo ocurre en el gateway, antes de llegar; (d) `.env.local` tenia el valor limpio, asi que **toda prueba local pasaba**. Se resolvio mirando la consola del navegador: el `%0A` estaba a la vista en la URL del WebSocket.
  **Regla:** cargar env vars con `printf '%s'`, NUNCA con `echo`. Y **verificar leyendo de vuelta**: `vercel env pull` y comparar la longitud contra la esperada. Un `grep '\\n'` sobre el pull delata a todas de una.
- **⚠️ `vercel env add` puede reportar exito y guardar el valor VACIO, y ademas crea la variable como `sensitive` (ilegible para siempre).** Corolario del anterior, aprendido el mismo dia. `printf '%s' "$V" | vercel env add K production` salio con codigo 0 y dejo **cuatro variables vacias**; el `vercel env pull` posterior las mostraba como `""`, lo que parecia confirmar el desastre — pero era ambiguo, porque las variables `sensitive` **tampoco se pueden leer nunca** (ni con `?decrypt=true`), asi que "vacia" e "ilegible" se ven igual. Distinguirlas mirando el campo `type` en `GET /v9/projects/{id}/env`: `sensitive` = ilegible por diseño, `encrypted` = legible via `vercel env pull`.
  **Regla:** escribir env vars por la **API REST** (`POST /v10/projects/{id}/env` con `"type": "encrypted"`), no por el CLI, y verificar con `vercel env pull` comparando el valor. Y **nunca borrar el respaldo antes de confirmar la escritura** — en ese incidente se perdio `BLOB_WEBHOOK_PUBLIC_KEY` por hacerlo. No se puede convertir `sensitive` → `encrypted` con PATCH (400): hay que borrar y recrear.
- **⚠️ La clave de firma ASIMETRICA (ES256) rompe el WebSocket de Realtime. Dejarla en HS256.** Medido dos veces con el mismo resultado (2026-08-01 y 2026-08-02): con `ES256` en `in_use`, **el 100% de las conexiones de navegadores reales reciben 401**; al volver la HS256 a `in_use`, conectan. El servicio Realtime no registra el rechazo — ocurre en el gateway, que parece dejar de validar la anon key legacy (firmada con HS256) cuando la clave activa es asimetrica.
  **Consecuencia directa: `getClaims()` NO sirve para ahorrar el round-trip de sesion.** Verifica la firma localmente solo con clave asimetrica; con HS256 **cae de vuelta a `getUser()`** por su cuenta (visto en el codigo de `auth-js`). El helper `src/lib/supabase/claims-user.ts` ya esta escrito y desplegado, y degrada solo — asi que la app se comporta como antes, sin el ahorro. Queda listo por si Supabase habilita ES256 en Realtime.
  **Trampa de verificacion:** una sola conexion exitosa desde Node **justo despues** de rotar la clave NO prueba compatibilidad. Salio `SUBSCRIBED` y sobre eso se concluyo que ES256 servia; en produccion, con navegadores y de forma sostenida, fallaba el 100%. Antes de dar por buena una rotacion de clave, medir **navegadores reales durante varios minutos** en `edge_logs`.
- **⚠️ Un conteo que baja a cero puede ser "no hay trafico", no "se arreglo".** Misma familia que los gotchas de verificacion de arriba, y volvio a morder el 2026-08-02: tras desplegar `getClaims()` se midio **cero llamadas a `/auth/v1/user`** y casi se reporta como exito — pero en esa ventana habia **cero peticiones REST**, o sea nadie usando la app un domingo por la noche. **Antes de leer una metrica que bajo, medir el trafico total de la misma ventana.** Un cero sin denominador no dice nada.
- **Convencion: la sesion se lee con `getCachedUser()`, no con `supabase.auth.getUser()`.** Cerrado el 2026-08-21 en el **#341** (squash `85ce586`): **54 llamadas directas en 29 archivos** pasaron a `src/lib/supabase/cached-user.ts`, que envuelve el helper en `cache()` de React y deduplica **por request**. El sintoma que lo destapo: **14.577 peticiones a `/auth/v1/user` en 8 horas**, ~3 por render, cada una un round-trip a Supabase Auth antes de que la pantalla empezara a consultar datos. **Trade-off aceptado explicitamente:** una sesion revocada sigue siendo valida hasta que expira su token (~1h) — es el mismo trade-off que el layout y el middleware ya venian haciendo, ahora es parejo en toda la app. **Unica excepcion viva:** `accept-invite/page.tsx`, que es el unico consumidor de `user.user_metadata`. ⚠️ Al convertir un archivo, `getCachedUser()` devuelve `{ user }` directo (no `{ data: { user } }`) y **suele dejar huerfano el `const supabase = await createClient()`** — nueve archivos quedaron con la variable y el import sin usar, y el lint lo caza despues.
- **⚠️ Un mock de test que no falla al cambiar el mecanismo es un mock que no prueba nada.** En el #341, cuatro tests reventaron con `supabase.auth.getClaims is not a function` — los mocks declaraban `getUser` pero no `getClaims`. Eso **no fue un problema, fue la evidencia** de que el refactor si cambio el camino real de autenticacion. Al revez: si los tests hubieran pasado intactos, habria que sospechar que el mock cortocircuita el helper.
- **⚠️ El payload grande que se ve en la red rara vez es el desperdicio; el desperdicio esta aguas arriba.** En el **#345** (squash `dc830ec`) el objetivo declarado era el payload de **334 kB de `/negocios`**, y medirlo lo descarto: 268 negocios x ~1,25 kB, casi todo campos que la tarjeta y el buscador si usan. El derroche real estaba en la consulta que lo alimentaba: `negocio_bloques` traia **2.150 filas / 1.153 kB de jsonb para producir 24 kB utiles — factor 48x**. Se reemplazo por la RPC `negocio_bloques_campos(uuid[], text[], text[])`, que hace el `jsonb_each` **en Postgres** y devuelve solo `(negocio_id, bloque, campo, valor)`: **1.153 kB → ~149 kB**. **Medir la consulta, no la respuesta**, antes de optimizar una pantalla lenta.
- **⚠️ `auth.uid()` suelto en una politica RLS se evalua FILA POR FILA; envuelto en `(select auth.uid())` se evalua una vez.** Cerrado el 2026-08-21 en el **#347** (squash `30e87f5`), **14 politicas** sobre `notificaciones`, `profiles`, `workspaces`, `team_invitations`, `tutorial_progress` y `etapa_sla_log`. Medido sobre `notificaciones` (3.811 filas) como usuario autenticado: **195,7 ms / 2.088 buffers → 2,47 ms / 5 buffers**, porque el subselect se convierte en `InitPlan` y **habilita el indice** (`Index Cond` en `idx_notificaciones_destinatario`) donde antes habia un `Filter` por fila. Se paga en **cada render**, porque el layout resuelve notificaciones siempre. ⚠️ **`current_user_workspace_id()` NO tiene este problema** (es `STABLE SECURITY DEFINER` y el planner ya la usa como `Index Cond`) — por eso el advisor marca 217 politicas pero solo 14 valian la pena: se acoto midiendo con `EXPLAIN (analyze, buffers)`, no por el conteo del advisor. **Usar `alter policy`, no drop+create:** entre el drop y el create la tabla queda sin politica. Y **generar los predicados desde `pg_policies`**, no reescribirlos a mano: un predicado tipeado de nuevo es una politica de seguridad distinta.
- **⚠️ Postgres deparsa `SELECT` en MAYUSCULA al guardar una politica, asi que verificar el envoltorio con un regex sensible a mayusculas da un falso negativo.** Comprobar con `~* '\( SELECT auth\.uid\(\)'` sobre `pg_policies`, y confirmar el efecto con `EXPLAIN` — un conteo de politicas no prueba que el plan cambio.
- **La pestana vieja ya no revienta: se recarga sola o pregunta.** **#327** (squash `cf2c732`). Sintoma: una pantalla en blanco tras un deploy, porque el HTML viejo pedia chunks JS que ya no existian. Tres capas: (1) **Skew Protection de Vercel** —ya venia activa; `deploymentId` en `next.config.ts` deja explicito que el id que fija los assets es el mismo que `build.ts` le da al watcher—, y la palanca real del panel es **Maximum Age**, cuyo default de **un dia** era exactamente la edad de la pestana que fallo (se subio a 7 dias); (2) `src/components/version-watcher.tsx`, que consulta `/api/version` cada 5 min y **recarga sola si nadie esta escribiendo**, o muestra una barra discreta «Hay una version nueva — Recargar» si hay foco en un input, un campo sucio o un archivo cargado — **nunca se pierde trabajo**; (3) `error.tsx` y `global-error.tsx`, donde el boton primario es **Recargar**, no `reset()`: reintentar con el mismo bundle roto vuelve a romper. ⚠️ El techo de 8h dispara aunque `/api/version` falle (`versionViva` se queda en `null`), y en dev la version es la constante `'dev'` a proposito, para que el watcher no entre en bucle.
- **⚠️ Un bloque nuevo nace SIN TITULO si solo se declara `config_extra.label`: el render toma el nombre de `bloque_configs.nombre`.** Con esa columna nula el bloque se pinta con el nombre de su `bloque_definitions` — o sea **"Documento"** o **"Datos"** a secas, sin decir de que. Lo peligroso es que **toda comprobacion contra la base da verde y es cierta**: el bloque existe, tiene el estado correcto, la instancia se creo y la linea lo declara. Paso el 2026-08-12 con `recibo_caja_upme` y solo se vio abriendo la pantalla. **Al crear un `bloque_configs`, llenar `nombre` aunque `config_extra.label` diga lo mismo**, y comprobar el titulo en `/flujo` (espejo del detalle del negocio y mucho mas barato de mirar que buscar un negocio parado en la etapa exacta).
- **⚠️ Crear un `bloque_configs` SIEMBRA instancias de inmediato en todos los negocios que YA pasaron por la etapa, no solo en los que estan ahi hoy.** Lo hace el trigger `sembrar_casillas_al_crear_bloque`. Medido el 2026-08-12: se estimo un alcance de **5 negocios** (los que estaban en la etapa ese dia) razonando que las instancias nacen al ENTRAR; el real fue **171**. Quedo acotado solo porque el bloque **no era gate** — de serlo habria retenido 171 casos abiertos de un cliente en produccion. **Contar el alcance con una consulta antes y despues de crear el bloque**, nunca deducirlo del recorrido: una deduccion se escribe con el mismo tono que una medicion y suele ser la cifra tranquilizadora. Familia de los gotchas de verificacion de este archivo.
- **⚠️ Siigo NO expone PDF de los recibos de caja.** Reconfirmado el 2026-08-12 contra la API sobre un recibo real (RC-1-43): **404** en `/v1/vouchers/{id}/pdf`, en `/print` y en `/documents/{id}/pdf`. El GET si devuelve todo lo necesario para armarlo (numero oficial, fecha, cliente, valor, forma de pago, observacion), asi que el PDF se renderiza en `metrik-pdf-render` (`/render/recibo-caja`, revision `00014-xqv`) con el consecutivo que asigno Siigo. Las facturas SI traen PDF por API; los recibos no, y esa asimetria no esta documentada del lado de Siigo.
- **⚠️ Una fecha armada con `new Date('YYYY-MM-DD')` se corre un dia hacia atras en Colombia.** Esa forma se interpreta como UTC y en UTC-5 cae en el dia anterior. En un documento contable (un recibo fechado un dia antes de lo que dice Siigo) eso no es un detalle de formato. Construir la fecha desde las partes de la cadena, como hace `fechaLegible` en `pdf-render-client.ts`.
- **⚠️ El CLI de Vercel se cuelga indefinidamente y no deja senal de error en ninguna parte.** Medido en la maquina de Mauricio el 2026-08-13: cuatro procesos del CLI vivos a la vez, de sesiones distintas, con 4 h 40 min, 10 h 44 min y 11 h 52 min de antiguedad, mas uno de unas 12 h que el ya habia matado. Los cuatro eran comandos de **solo lectura** (tres `vercel ls` y un `vercel inspect <url>`): ninguno estaba trabajando, se quedaron esperando y cada uno ocupa un `npm exec` mas un `node` hijo. No hay log, no hay error, el comando simplemente nunca retorna, asi que la sesion que lo lanzo tampoco se entera. **Invocar el CLI de Vercel siempre con tiempo limite** (el parametro `timeout` de la herramienta Bash, o `timeout 60 npx vercel ...`), y si no responde, matarlo en vez de esperarlo. Para detectar zombis: `ps -eo pid,etime,command | grep vercel`. Misma familia que el gotcha de `vercel ls` y la edad relativa: el CLI de Vercel es fuente recurrente de lecturas engañosas o colgadas, conviene tratarlo con desconfianza.
- **Siempre commit + push** despues de completar un task. El usuario espera deploy despues de cada cambio.
- **Paths con parentesis** en git: quotear para zsh — `git add "src/app/(app)/..."`.
- **Supabase CLI:** Necesita `SUPABASE_ACCESS_TOKEN=sbp_...` como env var y `2>/dev/null` para type gen.
- **Edge Functions deploy:** `wa-webhook` SIEMPRE con `--no-verify-jwt` (Meta usa HMAC, no JWT). Comando: `SUPABASE_ACCESS_TOKEN=sbp_... npx supabase functions deploy wa-webhook --project-ref yfjqscvvxetobiidnepa --no-verify-jwt`
- **database.ts:** Despues de `supabase gen types`, re-agregar los ~26 type aliases custom al final del archivo (Gasto, Proyecto, Oportunidad, Profile, Workspace, etc.).
- **PostgreSQL views:** Usar `DROP VIEW` + `CREATE VIEW` (no `CREATE OR REPLACE`) cuando se agregan columnas.
- **⚠️ `create or replace view` no renombra NI REORDENA columnas, y el error apunta a la columna equivocada.** Solo admite AGREGAR al final. Renombrar una (`propio_con_iva` → `a_tramo1`) o insertar una nueva en medio falla con `42P16: cannot change name of view column "X" to "Y"`, donde X e Y son las que quedaron desalineadas por posicion, no las que uno toco. Costo dos intentos el 2026-08-11. Dos consecuencias practicas: **(a)** lo nuevo va al final aunque quede feo, o se dropea; **(b)** para dropear una vista con dependientes, hacerlo **en orden inverso de dependencia y de forma explicita** (`drop v_pyl_mes; drop v_mc_linea_mes; drop v_cobro_valor;`), nunca con `cascade`: el cascade se lleva las dependientes sin nombrarlas y la migracion queda dependiendo de que uno se acuerde de recrearlas.
- **⚠️ Una metrica alimentada por un campo que nadie ESCRIBE muestra $0 para siempre, y se ve igual que "no hubo".** Antes de construir sobre un campo de clasificacion, contar sus valores reales en la base. Medido el 2026-08-11: `segundo_pago` del tablero comercial sumaba cobros con `tipo_cobro = 'saldo'` y `tarifa_recaudada` los `'pasante'`; de los 89 cobros de SOENA hay **cero de ambos tipos**. Las dos casillas llevaban meses en cero y nadie lo leia como defecto. Familia del fallo mudo del `CHECK` y del `verify_jwt`: el sistema no puede auditarse a si mismo cuando su salida en el caso roto es identica a la del caso sano.
- **⚠️ Un dato que el negocio nunca produce se DERIVA; pedir que se capture crea un campo vacio que el sistema cree lleno.** La tarifa UPME no llega clasificada nunca: es la diferencia entre lo pagado y el honorario. La tentacion es pedirla en la captura o reclasificar el historico; las dos congelan a mano una derivacion que puede cambiar. Corolario: cuando la derivacion depende de un calendario (aqui, el plan de pago 50/50 vs 100%), **el calendario es parte de la formula**, no un detalle de presentacion.
- **⚠️ Un criterio de UN cliente aplicado a todos los workspaces les borra datos en silencio.** Topar el recaudo contra el valor del negocio es el modelo de SOENA; aplicado a ciegas le quito **$900.000 de ingreso a ana-demo**, donde un cobro mayor al precio significa "el precio esta desactualizado". Todo criterio de modelo de dinero se declara en `config_extra` (linea gana sobre workspace) y **su default debe reproducir el comportamiento previo**, no la regla nueva: quien no declara nada recibe lo que ya tenia. Vale igual para `honorario.iva_pct` y para `recaudo.topar_por_valor`.
- **⚠️ Al validar una regla de negocio, el juez son los CASOS REALES, no la regla dicha.** La regla "primero honorario, luego tarifa" aplicada literalmente completaba los dos tramos del Plan 1 con un solo pago. Un test escrito desde la intencion (no desde la implementacion) salio rojo y destapo la ambiguedad; los cinco casos de produccion la resolvieron al peso. **Un test que solo repite lo que hace el codigo no habria dicho nada.**
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
