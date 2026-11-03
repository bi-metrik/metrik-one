---
name: project-obras-web-fase1
description: Obras parte web (#1237): cierre, PDF, facturas por obra, llegadas, rubros, colaboradores WA, CSV; llave modules.obras; migración 20261021183000 SIN aplicar con 2 defectos
metadata:
  type: project
---

PR #1237 (feat/imperviun-obras-web, 2026-10-21) construye la parte web de la Fase 1 del asistente de obras; la parte WhatsApp la hace otra sesión en `feat/imperviun-asistente-wa`. Sin mergear: trae la migración `20261021183000_obras_asistente_wa.sql` SIN aplicar (no es mía, venía en el commit base).

- Todo detrás de la llave de función `modules.obras` (`src/lib/obras/modulo.ts`, `REQUISITO.obras`). En prod no existe workspace de Impervium todavía (21-oct): hay que encender la llave al crearlo.
- **Defectos de la migración, reportados sin tocarla:** `facturas.proyecto_id` sigue NOT NULL (crear factura por obra falla; la acción lo dice); `v_cierre_obra.cobrado` cuenta cuotas sin `fecha` y `devolucion_pendiente`.
- No había pantalla de `wa_collaborators` en la app: la creé en Configuración («Colaboradores de WhatsApp»). Teléfono = solo dígitos con 57; se revisa duplicado en otros espacios con service client.
- `src/lib/export-csv.ts` que citaba el brief NO existe: el CSV sigue el patrón de `api/revision/export` (XLSX `sheet_to_csv` + BOM).

**Why:** el brief daba por existentes piezas que no estaban; quien retome debe saber que la factura por obra no funciona hasta el ALTER.
**How to apply:** antes de aplicar la migración, pedir el `drop not null` de `facturas.proyecto_id`; QA real solo con la migración en una base. Relacionado: [[feedback-la-referencia-manda-sobre-el-diseno]].
