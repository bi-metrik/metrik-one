# MéTRIK ONE — Project Log

## Info General

| Campo | Valor |
|-------|-------|
| **Cliente** | MéTRIK (producto propio) |
| **Tipo** | Aplicación Web (SaaS multi-tenant) |
| **Inicio** | 18/02/2026 |
| **URL Producción** | https://metrikone.co |
| **Repositorio** | https://github.com/bi-metrik/metrik-one |
| **Supabase** | yfjqscvvxetobiidnepa (plan Free) |
| **Vercel** | metrik-one (auto-deploy desde GitHub) |
| **DNS** | Vercel DNS (ns1/ns2.vercel-dns.com) — Wildcard SSL *.metrikone.co |

---

## Estado Actual

| Campo | Valor |
|-------|-------|
| **Sprint** | 3 — Cotización Flash + Fiscal |
| **Fase** | Deliver |
| **Status** | 🟢 Desplegado — Esperando QA |

---

## Historial de Sprints

### Sprint 3: Cotización Flash + Fiscal

| Campo | Valor |
|-------|-------|
| Fechas | 18/02/2026 |
| Decisiones | D32, D33, D34, D50, D51, D84, D86, D93, D94 |
| QA | ⏳ Pendiente Mauricio |

**Entregables:**
- [x] Motor de cálculos fiscales colombianos (`src/lib/fiscal/calculos.ts`)
  - ReteFuente honorarios (11% declarante / 10% no declarante)
  - IVA general (19%)
  - ReteICA Bogotá (9.66‰)
  - ReteIVA (15% del IVA)
  - Topes en UVT, defaults conservadores (D51)
- [x] Cotización Flash widget — cálculo en vivo (D32, D50)
  - 3 bloques: Cliente paga → Te retienen → Te consignan (D86)
  - Se muestra en modal de creación mientras Ana escribe el valor
  - Se muestra en detalle de oportunidad
- [x] Vista detalle oportunidad — panel lateral slide-in
  - Datos clave + Cotización Flash + acciones de etapa
  - Clic en cualquier card del Kanban abre el detalle
- [x] Warning perfil fiscal incompleto (D34)
- [x] Disclaimer fiscal obligatorio (D93)
- [x] Parámetros desde tabla fiscal_params (D94) — UVT $49.799

**Archivos creados/modificados:**
- `src/lib/fiscal/calculos.ts` — Motor de cálculos fiscales + formatters + disclaimer
- `src/app/(app)/pipeline/cotizacion-flash.tsx` — Widget 3 bloques en vivo
- `src/app/(app)/pipeline/opportunity-detail.tsx` — Panel lateral detalle
- `src/app/(app)/pipeline/pipeline-board.tsx` — Cards clickeables + detalle
- `src/app/(app)/pipeline/opportunity-modal.tsx` — Flash integrada en creación

---

### Sprint 2: Pipeline + Opportunity

| Campo | Valor |
|-------|-------|
| Fechas | 18/02/2026 |
| Decisiones | D25, D27, D29-D31, D42-D43, D47-D49, D171-D174, D176 |
| QA | ⏳ Pendiente Mauricio |

**Entregables:**
- [x] Pipeline Kanban board — 6 etapas: Lead → Prospecto → Cotización → Negociación → Ganada → Perdida
- [x] Totales: Pipeline total + Pipeline ponderado (valor × probabilidad)
- [x] Modal crear oportunidad — 4 campos, <45 segundos (D25)
  - Cliente (inline creation, D29), nombre trabajo, valor, momento (3 opciones)
- [x] Transiciones de etapa: clic para avanzar, botones contextuales
- [x] Marcar ganada → auto-crea proyecto activo (D48, D176)
- [x] Marcar perdida → razón obligatoria, 6 opciones (D174)
- [x] Reactivar oportunidad perdida a Lead o Prospecto (D173)
- [x] Quick actions Dashboard funcionales (D49, D172):
  - "Me buscan" → crea Lead
  - "Ya gané" → crea Won + proyecto active
  - "Ya entregué" → crea Won + proyecto completed
- [x] FAB "+" flotante en todas las pantallas (D43)
  - "Nueva oportunidad" funcional
  - "Registrar gasto" placeholder (Sprint 4)
- [x] Página Proyectos: lista básica con estado y presupuesto
- [x] Stage history tracking en DB (opportunity_stage_history)
- [x] Optimistic updates con rollback en error

**Archivos creados/modificados:**
- `src/app/(app)/pipeline/actions.ts` — Server actions: CRUD oportunidades, mover, reactivar
- `src/app/(app)/pipeline/pipeline-board.tsx` — Kanban board con 6 columnas
- `src/app/(app)/pipeline/opportunity-modal.tsx` — Modal 4 campos con timing options
- `src/app/(app)/pipeline/page.tsx` — Server component: fetch opp + clients
- `src/app/(app)/dashboard/dashboard-client.tsx` — Quick actions con modal integrado
- `src/app/(app)/fab.tsx` — FAB flotante global
- `src/app/(app)/app-shell.tsx` — Integración FAB
- `src/app/(app)/proyectos/page.tsx` — Lista proyectos con estado

---

### Sprint 1: Registro + Story Mode

| Campo | Valor |
|-------|-------|
| Fechas | 18/02/2026 |
| Decisiones | D1-D4, D6-D14, D233-D234, D237 |
| QA | ⏳ Pendiente Mauricio (rate limit Supabase Auth — 3 emails/hr en Free plan) |

**Entregables:**
- [x] Onboarding 3 pasos: nombre completo, nombre negocio (genera slug), profesión + experiencia
- [x] Story Mode 7 pantallas con botón "Saltar" siempre visible
- [x] Dashboard bienvenida con 3 estados rápidos
- [x] AppShell responsive con sidebar + iconos Lucide + sign out
- [x] Auth callback inteligente: nuevo → onboarding, existente → tenant workspace
- [x] Trial 14 días automático
- [x] Banner trial con días restantes en dashboard
- [x] Onboarding server action: @supabase/supabase-js service client (no SSR cookies)
- [x] DNS migrado de Cloudflare a Vercel DNS (wildcard SSL auto-provisioned)

**Archivos creados/modificados:**
- `src/app/(onboarding)/onboarding/page.tsx` — Flujo 3 pasos completo
- `src/app/(onboarding)/onboarding/actions.ts` — Server action con service role fix
- `src/app/(app)/story-mode/page.tsx` — 7 pantallas interactivas
- `src/app/(app)/dashboard/page.tsx` — Server component con datos
- `src/app/(app)/dashboard/dashboard-client.tsx` — Client component bienvenida
- `src/app/(app)/app-shell.tsx` — Sidebar responsive + mobile menu
- `src/app/(app)/layout.tsx` — Refactorizado para AppShell
- `src/app/auth/callback/route.ts` — Routing inteligente nuevo/existente + subdomain
- `src/middleware.ts` — Fix workspace_id + rutas onboarding/story-mode

---

### Sprint 0: Fundaciones Técnicas

| Campo | Valor |
|-------|-------|
| Fechas | 18/02/2026 |
| Decisiones | D5, D163-D170, D242 |
| QA | ✅ Cerrado |

**Entregables:**
- [x] Proyecto Supabase configurado con Auth
- [x] Schema PostgreSQL completo — 23 tablas para 245 decisiones
- [x] RLS policies por workspace_id en TODAS las tablas
- [x] Seed data: 9 categorías gasto + parámetros fiscales 2026
- [x] Triggers: updated_at, stage tracking, notificaciones
- [x] Proyecto Next.js 16 + React 19 + Tailwind 4 + shadcn/ui ready
- [x] Middleware auth multi-tenant por subdominio (*.metrikone.co)
- [x] Deploy Vercel con variables de entorno
- [x] Repo GitHub bi-metrik/metrik-one
- [x] Dominio metrikone.co configurado en Vercel (raíz + wildcard)
- [x] Vercel ↔ GitHub auto-deploy conectado
- [ ] Google OAuth credentials (pendiente — no bloquea)

**Stack:**
- Next.js 16.1.6 + React 19.2 + Tailwind CSS 4
- Supabase (Auth + DB + RLS + Storage)
- Vercel (hosting + CI/CD)
- Lucide Icons + Sonner (toasts) + next-themes
- Zustand (state) + Zod (validation) + React Hook Form
- Recharts (gráficas) + date-fns

---

## Decisiones Importantes

| Fecha | Decisión | Razón |
|-------|----------|-------|
| 18/02 | Reset limpio (no migrar de v2) | Arquitectura escalable desde cero, alineada a 245 decisiones |
| 18/02 | Repo público en bi-metrik org | Nueva org GitHub para MéTRIK ONE |
| 18/02 | `workspaces` en vez de `organizations` | Nomenclatura del Plan v1, preparado para multi-workspace Phase 2 |
| 18/02 | Dominio metrikone.co + wildcard subdominios | Multi-tenant: ana.metrikone.co, soena.metrikone.co |
| 18/02 | Schema completo desde Sprint 0 | Todas las tablas creadas (vacías) para evitar migraciones incrementales |
| 18/02 | Pipeline 6 etapas (D171) | lead, prospect, quotation, negotiation, won, lost |
| 18/02 | Proyecto 6 estados (D175) | active, paused, completed, rework, cancelled, closed |
| 18/02 | DNS migrado a Vercel | Wildcard SSL requiere Vercel NS. Cloudflare no podía emitir cert sin NS propio. |
| 18/02 | Story Mode ANTES de wizard fiscal (D233) | Ana ve el tour primero, fiscal es opcional |
| 18/02 | Service client sin SSR cookies | @supabase/supabase-js directo para operaciones privilegiadas (no @supabase/ssr) |
| 18/02 | Pipeline 6 etapas simplificado de 8 en v2 | ONE prioriza velocidad para independientes, no granularidad corporativa |
| 18/02 | Won → auto-create project (D48) | 1 clic, cero fricción. Proyecto nace activo sin draft (D176) |

---

## Contactos

| Rol | Nombre | Contacto |
|-----|--------|----------|
| CEO / Product Owner | Mauricio Moreno | mauricio.moreno@metrik.com.co |

---

*Última actualización: 18/02/2026*
