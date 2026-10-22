---
name: hitos-de-gestion
description: Hitos de gestión + Agenda de Trappvel (#1245, #1236 ya en main) — migración 20261022090000 SIN aplicar (dry-run OK); pendientes se calculan; RD por copia archivada, MX sin plazo
metadata:
  type: project
---

PR `feat/trappvel-hitos-de-gestion` (2026-10-22), apilado sobre #1236 (fechas de servicios). Migración
`20261022090000_negocio_hitos.sql` SIN aplicar: tabla `negocio_hitos` (solo lo cerrado: hecho/no_aplica/
no_se_hizo; `unique nulls not distinct`) + tipos `agenda_del_dia`/`hito_vencido` sobre el CHECK vivo.
Dry-run en prod hecho por Mik (2026-10-22, Postgres 17, dos veces, nada persistió); PGlite también.

**Why:** Edgar quiere registro de gestiones («se nos pasó»); nada automático al viajero.

**How to apply:**
- Pendientes NO se guardan: `hitos.ts` calcula; `fecha_objetivo` de la marca = fecha del SERVICIO (ancla),
  no la del aviso: cambiar la fecha del servicio reabre el hito; cambiar un plazo del catálogo no.
- Check-in en no hábil → aprobadores de la línea; demás fijos se quedan con su responsable.
- Todo detrás de `config_extra.hitos.activo`; apagado, Mis pendientes es byte a byte la de #1236.
- Pre-registro: RD −1 día leído de la copia de web.archive.org (eticket.migracion.gob.do da 403 Cloudflare);
  MX vacío: el INM dice que por aire no hay FMM previa (FMMd después de entrar). Falta que Edgar diga qué pide.
- Campana: escalamiento por `recordatorios_log` (reclamar); resumen por consulta previa (sin índice único).
- El node_modules del checkout principal no trae `unpdf`/`happy-dom`/`ai`: esas suites caen en el worktree.

Relacionado: [[fechas-servicios-viaje]], [[pruebas-por-mutacion]].
