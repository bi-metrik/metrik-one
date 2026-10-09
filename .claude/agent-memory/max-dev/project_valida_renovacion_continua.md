---
name: valida-renovacion-continua
description: Cobro de Valida mes a mes (fila A, 2026-10-09) — paso 6b del cron agrega UNA cuota; script de los 4 CDA SIN correr; ficha sin dias_trial
metadata:
  type: project
---

Paso 6b (`renovar-ciclo.ts`) renueva planes con `auto_renovar = true` de contratos `valida_consulta` activos:
una cuota cuando la última vence dentro de 30 días. Enrolamiento (6a) ya incluye `valida_consulta`.

**Why:** Mauricio 2026-10-09 (fila A de `proyectos/metrik/valida/docs/crecimiento-mrr/10-decisiones-mauricio.md`):
sin permanencia, se retiran cuando quieran. Antes nada leía `auto_renovar` salvo el trigger de fin de plan.

**How to apply (lo que no se ve en el código):**
- ⚠️ Los 4 CDA (C1/C2/C3/M2) siguen frenados por `plan_existente`; pasan con
  `proyectos/metrik/valida/migrations/2026-10-09_cdas-renovacion-continua.sql` (SIN correr; ensayado en PGlite).
  Debe correrse DESPUÉS del merge. Maxitec renueva el 29-oct, C1/C3 el 28-nov; El Carmen queda `en_mora`.
- ⚠️ Medido 9-oct: Maxitec PAGÓ la cuota 1 el 8-oct (el brief decía que debía); solo El Carmen debe.
- ⚠️ La ficha `valida-cda-licencia` v1 no declara `dias_trial`: un CDA nuevo descarta `sin_dias_trial` hasta
  que una versión del catálogo lo traiga (decisión D: prueba de 7 días).
- `metrik` NO tiene `cobros.pasarela_en_linea`: no ponérsela (encendería enlaces a todo plan manual);
  la pasarela de Valida sale de `PASARELA_DE_ENLACE_POR_MODULO`. Cambiar a ePayco = esa línea.
- Baja = `auto_renovar=false` + contrato `terminado` con `vigente_hasta`; plantilla comentada en el script.

Relacionado: [[radar-secop-modulo]], [[pago-en-linea-bold]], [[valida-cda-restriccion-y-plan-anual]].
