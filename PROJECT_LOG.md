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
| **DNS** | Cloudflare (migrando desde mi.com.co) |

---

## Estado Actual

| Campo | Valor |
|-------|-------|
| **Sprint** | 1 — Registro + Story Mode |
| **Fase** | Deliver |
| **Status** | 🟢 Completado — Esperando QA |

---

## Historial de Sprints

### Sprint 1: Registro + Story Mode

| Campo | Valor |
|-------|-------|
| Fechas | 18/02/2026 |
| Decisiones | D1-D4, D6-D14, D233-D234, D237 |
| QA | ⏳ Pendiente Mauricio |

**Entregables:**
- [x] Onboarding 3 pasos: nombre completo, nombre negocio (genera slug), profesión + experiencia
- [x] Story Mode 7 pantallas con botón "Saltar" siempre visible
  1. Todo empieza con un registro (FAB)
  2. Tus clientes, organizados (Pipeline)
  3. ¿Cuánto cobrar? (Cotización + fiscal)
  4. Controla cada proyecto (Vista 360)
  5. Facturas y cobras (Cartera + alertas)
  6. Todo se convierte en claridad (5 preguntas Números)
  7. Tu negocio te espera (CTA primera acción)
- [x] Dashboard bienvenida con 3 estados rápidos: "Me buscan" / "Ya gané" / "Ya entregué"
- [x] AppShell responsive con sidebar + iconos Lucide + sign out
- [x] Auth callback inteligente: nuevo → onboarding, existente → tenant workspace
- [x] Trial 14 días automático (vía trial_ends_at en schema)
- [x] Banner trial con días restantes en dashboard
- [x] Middleware fix: org_id → workspace_id (bug Sprint 0)
- [x] Ruta /onboarding protegida en middleware

**Archivos creados/modificados:**
- `src/app/(onboarding)/onboarding/page.tsx` — Flujo 3 pasos completo
- `src/app/(app)/story-mode/page.tsx` — 7 pantallas interactivas
- `src/app/(app)/dashboard/page.tsx` — Server component con datos
- `src/app/(app)/dashboard/dashboard-client.tsx` — Client component bienvenida
- `src/app/(app)/app-shell.tsx` — Sidebar responsive + mobile menu
- `src/app/(app)/layout.tsx` — Refactorizado para AppShell
- `src/app/auth/callback/route.ts` — Routing inteligente nuevo/existente
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
- [x] DNS migrado a Cloudflare (propagando)

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
| 18/02 | DNS migrado a Cloudflare | mi.com.co no soporta wildcard CNAME ni A. Cloudflare Free sí. |
| 18/02 | Story Mode ANTES de wizard fiscal (D233) | Ana ve el tour primero, fiscal es opcional |

---

## Contactos

| Rol | Nombre | Contacto |
|-----|--------|----------|
| CEO / Product Owner | Mauricio Moreno | mauricio.moreno@metrik.com.co |

---

*Última actualización: 18/02/2026*
