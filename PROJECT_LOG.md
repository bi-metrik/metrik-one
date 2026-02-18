# MéTRIK ONE — Project Log

## Info General

| Campo | Valor |
|-------|-------|
| **Cliente** | MéTRIK (producto propio) |
| **Tipo** | Aplicación Web (SaaS multi-tenant) |
| **Inicio** | 18/02/2026 |
| **URL Producción** | https://metrikone.co (pendiente DNS) |
| **Repositorio** | https://github.com/bi-metrik/metrik-one |
| **Supabase** | yfjqscvvxetobiidnepa (plan Free) |
| **Vercel** | metrik-one |

---

## Estado Actual

| Campo | Valor |
|-------|-------|
| **Sprint** | 0 — Fundaciones Técnicas |
| **Fase** | Deliver |
| **Status** | 🟢 Completado — Esperando QA |

---

## Historial de Sprints

### Sprint 0: Fundaciones Técnicas

| Campo | Valor |
|-------|-------|
| Fechas | 18/02/2026 |
| Decisiones | D5, D163-D170, D242 |
| QA | ⏳ Pendiente Mauricio |

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
- [ ] Dominio metrikone.co configurado (esperando DNS de Mauricio)
- [ ] Vercel ↔ GitHub auto-deploy (Mauricio debe conectar en dashboard)
- [ ] Google OAuth credentials (pendiente — no bloquea)

**Stack:**
- Next.js 16.1.6 + React 19.2 + Tailwind CSS 4
- Supabase (Auth + DB + RLS + Storage)
- Vercel (hosting + CI/CD)
- shadcn/ui + Radix UI + Lucide Icons
- Zustand (state) + Zod (validation) + React Hook Form
- Recharts (gráficas) + date-fns + Sonner (toasts)

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

---

## Contactos

| Rol | Nombre | Contacto |
|-----|--------|----------|
| CEO / Product Owner | Mauricio Moreno | mauricio.moreno@metrik.com.co |

---

*Última actualización: 18/02/2026*
