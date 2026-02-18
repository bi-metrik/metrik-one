# MéTRIK ONE — Sprint 0 Requirements

**Cliente:** MéTRIK (producto propio)
**Tipo:** Aplicación Web (SaaS multi-tenant)
**Sprint:** 0 — Fundaciones Técnicas
**Fecha:** 18/02/2026
**Status:** Validado
**Fuente:** ONE_Plan_Sprints_v1.md (245 decisiones)

---

## 1. Problema a Resolver

Construir la infraestructura base que soporta el 100% del producto MéTRIK ONE desde día 1. Cero features visibles al usuario. Base escalable y limpia.

---

## 2. Decisiones Cubiertas

D5 (Multi-tenant RLS desde día 1), D163-D170 (Roles y permisos — diseño completo, implementación solo Dueño), D242 (Seed data precargada)

---

## 3. Entregables del Sprint

- [x] Proyecto Supabase configurado — Auth (magic link + Google OAuth ready)
- [x] Schema PostgreSQL completo — 23 tablas para 245 decisiones
- [x] RLS policies — Por workspace_id en TODAS las tablas (D5)
- [x] Seed data — 9 categorías gasto, parámetros fiscales 2026 (D242)
- [x] Proyecto Next.js — App skeleton con Tailwind, Supabase client, middleware auth
- [x] Deploy Vercel — Variables de entorno configuradas
- [ ] Dominio metrikone.co (esperando DNS)
- [ ] Google OAuth credentials (pendiente)

---

## 4. Schema: 23 Tablas

| # | Tabla | Propósito | Sprint activo |
|---|-------|-----------|--------------|
| 1 | workspaces | Multi-tenant (D5, D165) | 0 |
| 2 | profiles | Usuarios + roles (D163-D170) | 0 |
| 3 | fiscal_profiles | Wizard Felipe (D2, D234-D236) | 6 |
| 4 | fiscal_params | UVT, tasas (D94) | 3 |
| 5 | clients | Catálogo clientes (D29, D30) | 2 |
| 6 | expense_categories | 9 categorías (D95) | 0 (seed) |
| 7 | opportunities | Pipeline 6 etapas (D171-D174) | 2 |
| 8 | opportunity_stage_history | Historial Pipeline | 2 |
| 9 | quotes | Cotización flash/detallada (D185) | 3 |
| 10 | quote_items | 6 rubros cotización (D85) | 12 |
| 11 | projects | 6 estados proyecto (D175) | 5 |
| 12 | time_entries | Horas | 5 |
| 13 | expenses | 3 capas gastos (D44) | 4 |
| 14 | fixed_expenses | Gastos fijos config (D239) | 4 |
| 15 | invoices | Cobros tracking (D182) | 5 |
| 16 | payments | Pagos recibidos (D183) | 5 |
| 17 | subscriptions | Billing (D204) | 10 |
| 18 | bot_sessions | WhatsApp Bot (D224) | 7 |
| 19 | wa_collaborators | Colaboradores WA (D60-D65) | 8 |
| 20 | notifications | Alertas cross-module | 0 |
| 21 | referrals | Referidos (D102-D104) | 14 |
| 22 | health_scores | Health score interno (D105) | 13 |
| 23 | testimonials | Advocacy (D118-D120) | 14 |

---

## 5. Validación

- [x] Mauricio aprobó approach (reset limpio)
- [x] Schema alineado a 245 decisiones
- Fecha: 18/02/2026

---

*Alineado a ONE_Plan_Sprints_v1.md*
