---
name: emision-cuentas-cobro-solo-en-produccion
description: La emisión de cuentas de cobro (PDF + Drive) no corre en local; el botón «Emitir período» en producción es la única vía. Más el paso 4 del cron, pendiente de decisión.
metadata:
  type: project
---

La emisión de cuentas de cobro solo se puede ejecutar desde la app desplegada, no desde local ni con `scripts/emitir-cuentas-periodo.ts`.

**Why:** `METRIK_PDF_RENDER_URL`, `METRIK_PDF_RENDER_SECRET`, `METRIK_PDF_RENDER_SA_KEY` y `GOOGLE_DRIVE_REFRESH_TOKEN` están marcadas como sensibles en Vercel: `vercel env pull` devuelve el literal `"[SENSITIVE]"`. No están en `.credentials.md` ni en ningún `.env` de la máquina. Sin ellas, el render del PDF y la subida a Drive fallan.

**How to apply:** cualquier frente de cobros que necesite emitir de verdad se entrega como botón/acción en la app y lo dispara Mauricio; no prometas correrlo tú. El script de rescate sirve para leer y diagnosticar, no para emitir.

---

**Pendiente de decisión (al 2026-08-21):** Mauricio aún no decide si apaga el paso 4 del cron `/api/crons/procesar-planes-cobro` (la emisión automática tras la guarda de día). Hasta que lo diga, ese bloque no se toca en ningún PR — aunque el botón ya cubra lo mismo.

**Why:** apagarlo cambia quién emite (cron vs. persona), y eso es decisión suya, no técnica.

**How to apply:** si un frente de cobros parece pedir tocar el cron, propónlo y espera; no lo metas en el diff.
