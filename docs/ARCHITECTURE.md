# MeTRIK ONE — Arquitectura Tecnica

> Documento generado: 2026-02-26 | Version: MVP v1.0

---

## Stack

| Capa | Tecnologia | Version |
|------|-----------|---------|
| Framework | Next.js (App Router) | 16.1.6 |
| UI | React | 19.2 |
| Estilos | Tailwind CSS (oklch) | 4.x |
| Backend | Supabase (PostgreSQL + Auth + Storage + Edge Functions) | — |
| Tipos | TypeScript strict | 5.x |
| Validacion | Zod | 4.x |
| Forms | React Hook Form | 7.x |
| Charts | Recharts | 3.x |
| PDF | @react-pdf/renderer | 4.x |
| Email | Resend | 6.x |
| DnD | @dnd-kit | 6.x |
| State | Zustand | 5.x |
| Iconos | Lucide React | 0.574 |
| UI Primitives | Radix UI | 1.4 |
| Toasts | Sonner | 2.x |

---

## Infraestructura

| Servicio | Detalle |
|----------|---------|
| **Hosting** | Vercel (auto-deploy on `main` push) |
| **Dominio** | `metrikone.co` (wildcard SSL: `*.metrikone.co`) |
| **Base de datos** | Supabase PostgreSQL (`yfjqscvvxetobiidnepa`) |
| **Auth** | Supabase Auth (magic link + Google OAuth) |
| **Storage** | Supabase Storage (logos, soportes gastos) |
| **Edge Functions** | Supabase (WhatsApp webhook) |
| **GitHub** | `bi-metrik/metrik-one` |

---

## Multi-Tenancy

MeTRIK ONE usa **subdomain routing** para aislamiento de tenants:

```
ana.metrikone.co    → workspace slug "ana"
clarity.metrikone.co → workspace slug "clarity"
```

### Flujo de Routing (middleware.ts)

1. Extraer slug del subdominio
2. Usuario no autenticado → `/login` en dominio marketing
3. Usuario autenticado sin workspace → `/onboarding`
4. Usuario autenticado con workspace → redirige a subdominio del tenant
5. Todas las rutas protegidas validan sesion + workspace

### Aislamiento de Datos (RLS)

- **Todas** las tablas tienen `workspace_id`
- RLS policies usando `current_user_workspace_id()` (funcion PostgreSQL)
- Cada query Supabase filtra automaticamente por workspace

---

## Estructura de Carpetas

```
src/
  app/
    (app)/                    # Rutas autenticadas (tenant)
      numeros/                # KPIs y metricas
      pipeline/               # Oportunidades (kanban)
      proyectos/              # Proyectos activos
      movimientos/            # Registro transaccional
      causacion/              # Bandeja contable (D246)
      directorio/             # Empresas y contactos
      facturacion/            # Facturas
      nuevo/                  # Formularios de creacion (gasto, cobro, etc.)
      config/                 # Configuracion (fiscal, equipo, banco, etc.)
      mi-negocio/             # Perfil de empresa/marca
      semaforo/               # Score de salud
      story-mode/             # Tutorial interactivo
      promotores/             # Promotores/referidos
      dashboard/              # Dashboard de bienvenida
      app-shell.tsx           # Sidebar + header + mobile tab bar
      fab.tsx                 # Floating action button
    (onboarding)/             # Flujo de onboarding
    login/                    # Login (magic link)
    registro/                 # Registro nuevo usuario
    accept-invite/            # Aceptar invitacion de equipo
  components/
    ui/                       # Primitivos shadcn/ui (dialog, badge, input, etc.)
    entity-card.tsx           # Card reutilizable
    notes-section.tsx         # Sistema de notas
    timer/                    # Timer flotante
  lib/
    actions/                  # Server actions compartidos
    supabase/                 # Clientes Supabase (client, server, middleware)
    fiscal/                   # Motor fiscal colombiano
    pipeline/                 # Constantes pipeline
    projects/                 # Config proyectos
    contacts/                 # Constantes contactos
    roles.ts                  # Sistema de permisos
    pdf/                      # Generacion PDF cotizaciones
    export-csv.ts             # Exportacion CSV
  types/
    database.ts               # Types auto-generados de Supabase + aliases
supabase/
  migrations/                 # 27 archivos SQL
  functions/                  # Edge functions (WhatsApp)
    _shared/                  # Utilidades compartidas del bot
    wa-webhook/               # Webhook receptor
    wa-alerts/                # Alertas via WhatsApp
```

---

## Base de Datos — 48 Tablas

### Nucleo Multi-tenant
| Tabla | Proposito |
|-------|----------|
| `workspaces` | Tenant: slug, nombre, suscripcion, branding |
| `profiles` | Usuarios: role, full_name, workspace_id |
| `team_invitations` | Invitaciones de equipo |

### Pipeline y Ventas
| Tabla | Proposito |
|-------|----------|
| `oportunidades` | Pipeline CRM (5 etapas) |
| `opportunity_stage_history` | Auditoria cambios de etapa |
| `cotizaciones` | Cotizaciones formales |
| `quote_items` | Items de cotizacion (6 rubros) |
| `servicios` | Catalogo de servicios |

### Proyectos y Ejecucion
| Tabla | Proposito |
|-------|----------|
| `proyectos` | Proyectos (6 estados) |
| `proyecto_rubros` | Presupuesto por rubro |
| `horas` / `time_entries` | Registro de horas |
| `staff` | Equipo interno (salarios, horas) |

### Financiero
| Tabla | Proposito |
|-------|----------|
| `gastos` | Egresos (9 categorias, deducibilidad, causacion) |
| `cobros` | Ingresos/pagos recibidos |
| `facturas` | Facturas emitidas |
| `payments` | Registro de pagos |
| `gastos_fijos_config` | Gastos fijos recurrentes |
| `gastos_fijos_borradores` | Borradores mensuales |
| `causaciones_log` | Auditoria flujo contable (D246) |

### Fiscal
| Tabla | Proposito |
|-------|----------|
| `fiscal_profiles` | Perfil tributario del workspace |
| `fiscal_params` | Parametros: UVT, tasas retencion |
| `expense_categories` | 9 categorias con deducibilidad |
| `config_financiera` | Margen calculado |

### Directorio
| Tabla | Proposito |
|-------|----------|
| `clients` | Empresas cliente (NIT, regimen) |
| `contacts` / `contactos` | Personas de contacto |
| `empresas` | Directorio de empresas |
| `promoters` | Promotores/referidos |

### Bancario
| Tabla | Proposito |
|-------|----------|
| `bank_accounts` | Cuentas bancarias |
| `bank_balances` | Snapshots de saldo |
| `saldos_banco` | Reconciliacion (real vs teorico) |

### Metas y Performance
| Tabla | Proposito |
|-------|----------|
| `config_metas` / `monthly_targets` | Metas mensuales ventas/recaudo |
| `health_scores` | Score de salud del negocio |
| `costos_referencia` | Costos de referencia para pricing |

### WhatsApp
| Tabla | Proposito |
|-------|----------|
| `bot_sessions` | Conversaciones activas del bot |
| `wa_collaborators` | Colaboradores via WhatsApp |
| `wa_message_log` | Log de mensajes |

### Vistas SQL
| Vista | Proposito |
|-------|----------|
| `v_proyecto_financiero` | Resumen financiero por proyecto |
| `v_facturas_estado` | Estado de facturas |
| `v_gastos_fijos_mes_actual` | Gastos fijos del mes |
| `v_cartera_antiguedad` | Antiguedad de cartera |
| `v_proyecto_rubros_comparativo` | Presupuesto vs real |

### Funciones PostgreSQL
| Funcion | Proposito |
|---------|----------|
| `get_next_proyecto_codigo()` | Auto-incremento P-001, P-002... |
| `get_next_cotizacion_consecutivo()` | Auto-incremento COT-001... |
| `current_user_workspace_id()` | Helper para RLS |
| `check_perfil_fiscal_completo()` | Validar perfil fiscal |

---

## Sistema de Roles

4 roles actuales en `profiles.role`:

| Permiso | owner | admin | operator | read_only |
|---------|:-----:|:-----:|:--------:|:---------:|
| Invitar equipo | Si | No | No | No |
| Eliminar registros | Si | Si | No | No |
| Config fiscal | Si | No | No | No |
| Ver Numeros | Si | Si | No | Si |
| Ver Pipeline | Si | Si | No | No |
| Ver Proyectos (todos) | Si | Si | No | No |
| Ver Proyectos (propios) | Si | Si | Si | No |
| Usar FAB | Si | Si | Si | No |
| Registrar gasto | Si | Si | Si | No |
| Registrar horas | Si | Si | Si | No |
| Registrar cobro | Si | Si | No | No |
| Exportar CSV | Si | Si | No | Si |
| Gestionar equipo | Si | No | No | No |
| Aprobar causacion | Si | Si | No | No |
| Causar movimiento | Si | Si | No | No |
| Ver causacion | Si | Si | No | No |

**Futuro (98G):** Se planean 5 niveles: dueno, administrador, supervisor, ejecutor, campo. Mas un rol `contador` con permisos especificos de causacion.

---

## Motor Fiscal Colombiano

Ubicacion: `src/lib/fiscal/`

### Tasas Predeterminadas
- **IVA:** 19%
- **Retencion en la fuente:** 11% (servicios) / 10% (compras)
- **ReteICA:** 9.66 por mil
- **ReteIVA:** 15% del IVA
- **UVT 2025:** $49,799

### Categorias de Gasto (9)
materiales, transporte, servicios_profesionales, viaticos, software, impuestos_seguros, mano_de_obra, alimentacion, otros

### Deducibilidad (D142)
- Solo regimen ordinario (no simple)
- Requiere soporte (factura) para ser deducible
- 7 categorias son potencialmente deducibles

---

## Flujo de Causacion Contable (D246)

```
Nuevo gasto/cobro
       |
       v
   PENDIENTE  ──[Rechazar]──> RECHAZADO
       |
   [Aprobar]
       |
       v
   APROBADO
       |
   [Causar] (cuenta PUC + centro costo)
       |
       v
    CAUSADO  ──(futuro)──> Alegra sync
```

- Solo owner/admin pueden aprobar y causar
- Cada accion se registra en `causaciones_log`
- No afecta calculos financieros (es capa contable paralela)

---

## Navegacion del App Shell

### Desktop Sidebar
1. Numeros (BarChart3) — owner, admin, read_only
2. Pipeline (Flame) — owner, admin
3. Proyectos (FolderKanban) — owner, admin, operator
4. Movimientos (ArrowLeftRight) — owner, admin, read_only
5. Directorio (Users) — owner, admin
6. Mi Negocio (Briefcase) — owner, admin, operator

**Seccion Contabilidad** (separada):
7. Causacion (BookOpen) — owner, admin

### Mobile
- Header: isotipo MeTRIK + logo empresa + avatar + logout
- Bottom tab bar: mismos items principales (sin Contabilidad)
- FAB flotante para acciones rapidas
