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

### ⚠️ El subdominio NO decide el inquilino: lo decide una sola fila

`current_user_workspace_id()` es literalmente `select workspace_id from profiles where id = auth.uid()`. O sea que **el workspace activo es uno solo por usuario**, no por pestana, no por subdominio, y de esa fila cuelga TODO el RLS. El subdominio enruta y pinta la marca; no manda.

Consecuencia que no es obvia y ya mordio: cambiar de workspace en una pestana se lleva **todas** las demas. Hasta el 2026-09-18 una pestana que se quedo abierta en `soena.metrikone.co` seguia pintando y **escribiendo** en el workspace nuevo, y el RLS lo aprobaba, porque las dos leen la misma fila. Un formulario abierto antes del cambio y enviado despues guardaba el dato en el inquilino equivocado con la URL diciendo lo contrario.

Lo que hay hoy es un guard, no el arreglo: el middleware compara el slug del host contra el del perfil y manda la navegacion a `/pestana-desincronizada`; `getWorkspace` devuelve `workspaceId: null` para cortar la escritura (ver `src/lib/tenant/desincronizacion.ts`). **Sigue sin poderse tener dos workspaces abiertos en paralelo.** Para eso habria que derivar el workspace activo del subdominio, lo que obliga a cambiar esa funcion, que es el corazon del aislamiento multi-tenant.

**El slug del inquilino llega al server component SOLO por cabecera de request.** En la funcion serverless el `host` y el `x-forwarded-host` NO traen el subdominio: el middleware inyecta `x-tenant-slug` con `NextResponse.next({ request: { headers } })`. Ponerlo en la respuesta, como estaba antes, no sirve de nada porque el servidor nunca lo ve.

**Un guard no puede vivir en un layout.** Un layout del App Router no se vuelve a ejecutar en navegacion suave, solo en carga completa de documento: el guard de pestana desincronizada nacio en `(app)/layout.tsx` y en produccion no existia al hacer clic en el menu. Lo que corre siempre es el middleware.

**`profiles` tiene DOS llaves foraneas hacia `workspaces`** (`workspace_id` y `home_workspace_id`, la del platform admin), asi que todo embed de PostgREST tiene que nombrar la relacion (`workspaces!profiles_workspace_id_fkey(...)`) o responde PGRST201 por ambiguedad.

**Dev local**: `localhost:3000` (marketing), no hay subdomain routing en dev — todo opera en el mismo host.

## Backups (public.backup_*)

**Un backup vence a los 30 dias** (decision de Mauricio, 2026-10-05; habeas data, temporalidad). Guardan copias de datos personales y no tienen RLS ni dueno.
- Nombre `backup_<tema>_<YYYYMMDD>`; la fecha del sufijo manda. Con `revoke all ... from public, anon, authenticated` + RLS, como cualquier tabla.
- Si de verdad hay que conservarlo mas, se declara con `COMMENT ON TABLE ... 'NO BORRAR: <razon>, decide <quien>'`; sin ese comentario se borra.
- Limpieza: cada migracion de limpieza lista las tablas por nombre (nunca patron), con bloque dry-run `DO` + `RAISE NOTICE`, y retira sus entradas de `src/types/database.ts`. Ejemplo: `20261005200000_drop_backups_mayores_30_dias.sql`.
- Antes de borrar: verificar por SELECT que ninguna vista, funcion, FK o trigger las referencia, y `git grep` en `src/ supabase/ scripts/ sql/`.

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

### Vistas: `CREATE OR REPLACE` borra `security_invoker`

Una vista sin `security_invoker` corre como su dueño (`postgres`) y **no aplica el RLS de sus tablas base**. Si además tiene `grant select to authenticated`, cualquier usuario con sesión lee todos los workspaces aunque las policies de abajo sean perfectas.

La trampa: **`CREATE OR REPLACE VIEW` sin cláusula `WITH` RESETEA las `reloptions`**, o sea borra el `security_invoker` que puso una migración anterior. Los grants sobreviven; la opción no. La vista sigue devolviendo filas, por eso nadie lo nota: devuelve de más.

Pasó. `v_cobro_valor` nació en invoker el 2026-08-11 (`20260811120000`) y el 2026-09-02 (`20260902220053`) la reemplazaron para agregarle dos columnas sin volver a declararla: quedó filtrando 429 cobros de 4 workspaces a cualquier usuario con sesión, y el PR pasó con los cinco checks en verde. Reparado el 2026-09-06 en `20260906000001_v_cobro_valor_respeta_rls.sql`.

```sql
create or replace view public.<v> with (security_invoker = on) as ...;
-- o, si la vista ya existe y solo se le repone la opcion:
alter view public.<v> set (security_invoker = on);
```

**Toda migration que cree o reemplace una vista en `public`** tiene que declarar la opción en la propia sentencia o con un `alter view` en el mismo archivo, aunque la vista ya estuviera en invoker. Si la vista corre a propósito como su dueño (se lee solo con `service_role`), decláralo con `-- vista-definer: <razon>`.

Para ver el estado real, que no es lo que dice la última migración: `select relname, reloptions from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v';`. Ojo, se guarda como `security_invoker=on` **o** `=true` según cómo se escribió: comparar solo contra uno da falso negativo.

### La guarda que lo hace cumplir

`npm run check:migraciones` revisa las migraciones que el PR agrega y falla si una tabla nace sin RLS o sin declarar su grant, si una función nace sin revocar `EXECUTE` a PUBLIC, o si una vista se crea o se reemplaza sin declarar `security_invoker`. Corre en CI (`.github/workflows/migraciones.yml`) en cada PR que toque `supabase/migrations/`. Las marcas `-- server-only:`, `-- publico-deliberado:`, `-- ejecutable-por-cliente:` y `-- vista-definer:` son la forma de declarar una excepción: la marca es la decisión, el silencio no.

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

## Documentacion existente

| Archivo | Contenido |
|---------|-----------|
| `docs/FEATURES.md` | Todos los features por modulo con estado (implementado/schema listo/planeado) |
| `docs/CHANGELOG.md` | Cambios por sprint con detalle de migraciones y features |
| `docs/ARCHITECTURE.md` | Arquitectura tecnica completa: stack, infra, multi-tenancy, 48 tablas, roles, fiscal, navegacion |

## Donde vive el resto (se lee a demanda, no se carga solo)

Este archivo se carga entero en cada sesion que toca ONE, en cada turno. Tope: 30.000 caracteres (lo mide el hook `presupuesto-contexto`). Aqui va solo contexto estable del producto; lo que crece vive en su archivo:

| Que | Donde | Cuando leerlo |
|-----|-------|---------------|
| Gotchas y convenciones | `docs/gotchas.md` | Antes de tocar un area: `grep -n -i "<tema>" docs/gotchas.md` |
| Avance por sesion | `docs/bitacora/AAAA-MM.md` (historico: `docs/bitacora/avance-hasta-2026-09-28.md`) | Para saber que se hizo y en que PR |
| Pendientes de producto | `docs/pendientes.md` | Al planear |
| Decisiones clave | `docs/decisiones-clave.md` | Antes de cambiar un comportamiento |

Al cerrar una sesion: el avance va ARRIBA en `docs/bitacora/AAAA-MM.md` del mes (crearlo si no existe), un gotcha nuevo al final de `docs/gotchas.md`, una decision como fila nueva en `docs/decisiones-clave.md`. Nada de eso entra a este archivo.

