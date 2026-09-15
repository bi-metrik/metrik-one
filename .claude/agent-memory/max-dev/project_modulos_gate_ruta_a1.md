---
name: modulos-gate-ruta-a1
description: PR #733 (A1, spec módulos y cobro) SIN mergear y migración workspace_modulos SIN aplicar; el gate vive en el middleware porque el layout no corre en navegación suave; advise pierde Workflows al mergear
metadata:
  type: project
---

Entrega A1 de `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, abierta el
2026-09-15 como **PR #733**, con los 7 checks en verde. **Sin mergear**, porque trae migración:
lo decide Mauricio.

**Estado que no se ve en el código:**
- `20260915210000_workspace_modulos.sql` **sin aplicar**. Nada del PR lee esa tabla: el gate lee
  `workspaces.modules` como siempre, así que merge y migración son independientes.
- `sql/modulos/carga-inicial-workspace-modulos.sql` **sin correr**: son 20 filas y hay que
  confirmar qué workspace es cortesía y cuál es demo. Ensayado en PGlite con la foto de
  producción: 20 filas y 0 cambios en la proyección.
- `scripts/ensayo-rutas-bloqueadas.ts` (cruce con `activity_log`) **sin correr**: el encargo
  prohibió correrlo contra producción.
- Al mergear, el menú de **advise** pierde Workflows (`/flujo`). Tiene una línea activa y 2
  negocios del 2026-07-30 que nadie volvió a tocar. Si lo usan, necesita cortesía de Clarity.

**Why:** la spec pedía el gate en `layout.tsx`. Medido con Next 16.1.6 en una app mínima: con
`<Link>` el layout compartido **no se vuelve a ejecutar** (siguió pintando la ruta vieja), y el
middleware sí corre en cada navegación y su redirect funciona. Un gate en el layout solo habría
cerrado la URL tecleada.

**How to apply:**
- Toda guarda por ruta futura (el solo lectura de B2, rutas de C2) va en el middleware o en la
  página. Nunca solo en un layout compartido.
- Una carpeta nueva en `src/app/(app)` rompe `catalogo.test.ts` hasta declararla en un módulo.
- `proyectar_modulos` es `stable` a propósito: encenderla es otra migración, con escritura y cron.
- El CHECK de `servicio_contratado_id` va en una sola dirección hasta A3.

Relacionado: [[suscripciones-cobro-automatico]], [[ensayo-sql-pglite]].
