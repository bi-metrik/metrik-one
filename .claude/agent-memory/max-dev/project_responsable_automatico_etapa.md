---
name: project-responsable-automatico-etapa
description: SOE-016 responsable automático por etapa (config_extra.responsable_automatico); sin migración, config de SOENA SIN aplicar; caminos no cubiertos
metadata:
  type: project
---

SOE-016 (2026-10-14, rama feat/responsable-automatico-etapa): `etapas_negocio.config_extra.responsable_automatico = { rol, staff_id }` asigna al entrar si el rol está vacío. Sin migración. La config de SOENA (Cargue/Cita/Anexos → Camila 101e03b6) la aplica la sesión principal: hasta entonces el código es inerte.

**Why:** Deisy asignaba a mano a Camila; compromiso 2026-10-19.

**How to apply:**
- Un movedor nuevo de `etapa_actual_id` debe llamar `asignarResponsableAlEntrar` tras el UPDATE; la guarda en `responsable-automatico.test.ts` lista los archivos.
- NO cubiertos: crear negocio (y bot WA Deno), deshacer pago del riel, semillas, SQL directo. Un trigger de BD cubriría todo pero duplicaría `asignarResponsable` en SQL.
- `asignarResponsable` derivaba `comercial` para quien tiene ambas áreas: ahora acepta `rol` explícito. Ver [[project-trigger-staff-rol-sin-contador]].
- Suite local: ~34 archivos fallan por `happy-dom`/`unpdf` ausentes en el node_modules del repo principal; no es regresión.
