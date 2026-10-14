---
name: project-cruce-banco-leasing
description: SOE-012 cruce entidad_financiera (factura a nombre de banco exige titularidad leasing); config SOENA SIN aplicar, la aplica la sesion principal
metadata:
  type: project
---

Cruce tipo `entidad_financiera` (PR feat/cruce-banco-leasing, 2026-10-13). La config de la línea SOENA GIT EV/HEV
(slug `factura_banco_exige_leasing`, etapas 4-7) NO la apliqué: el brief la deja a la sesión principal.

**Why:** Deisy (SOE-012) pidió doble titularidad cuando la factura viene a nombre de un banco; único caso real V0294
(BANCOLOMBIA, ya en leasing). Detección por nombre porque el NIT 8/9 no distingue banco de cualquier sociedad.

**How to apply:** si un banco no se reconoce, se agrega a la lista de `src/lib/documentos/entidad-financiera.ts`,
no al motor. Fuente mejor propuesta y no construida: lista de vigiladas de la Superfinanciera por NIT.
Si alguien dice que el cruce «no frena», verificar primero que la config esté en `lineas_negocio.config_extra.cruces`.
