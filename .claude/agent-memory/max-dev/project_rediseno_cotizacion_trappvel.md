---
name: rediseno-cotizacion-trappvel
description: Rediseño del editor de cotización de Trappvel (caso Providencia, 2026-09-23) — PRs #852, #855, #859 mergeados; #853 (P4) abierto con migración
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-rediseno-cotizacion-2026-09-23.md`.

- #852 (P1, P3, P8) mergeado. #855 (cinco pasos, P2, P5, P6) mergeado. #859 (bandeja de capturas, P7) mergeado.
- ⚠️ **#853 (P4, adicional con precio derivado del margen) SIN mergear**: trae la migración `item_adicionales.precio_manual`. Hay que aplicarla ANTES del merge.

**Why:** los tres primeros se mergearon solos porque no traían migración. El último espera la base.

**How to apply:**
- R6 lo cuida `cotizacion-editor-r6-render.test.ts`, que compara byte a byte contra un golden. Todo cambio en el editor que afecte a quien no es Trappvel lo pone en rojo.
- El detector escribe los lugares de dos maneras distintas («Bogotá (BOG)» y «Bogotá»). Por eso la bandeja compara por código IATA o por el nombre sin tildes (`bandeja-capturas.ts`).
- La nota para el cliente es `items.descripcion` solo cuando no es la que escribió el sistema (`nota-linea.ts`).
- La bandeja no se probó en vivo en una pantalla hidratada.
