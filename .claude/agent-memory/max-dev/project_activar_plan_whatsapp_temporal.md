---
name: project-activar-plan-whatsapp-temporal
description: «Activar plan» de Valida abre WhatsApp de MéTRIK (enlaceActivarPlan) mientras #1107 no esté en main; /suscripcion da 404 en espacios de prueba
metadata:
  type: project
---

Desde 2026-10-14, «Activar plan» (corte de bolsa y contador de saldo en /valida) abre wa.me/573159509103 con
«Hola, quiero activar el plan de Valida para <workspaces.name o slug>», vía `enlaceActivarPlan(espacio)` en
`src/lib/valida/corte-bolsa.ts`. Reemplazó `RUTA_ACTIVAR_PLAN = '/suscripcion'`.

**Why:** el registro autogestionado ya estaba abierto y promocionado; `/suscripcion` responde 404 a un espacio
sin contrato (la prueba), y la activación real (`/valida/activar`, PR #1107) no estaba en main.

**How to apply:** #1107 choca en las mismas líneas (corte-bolsa.ts final y activa-tu-plan.tsx). Al rebasarlo,
gana #1107 (`accionDelCorte` + `/valida/activar`, de vuelta a `<Link>`); se puede quitar la prop `espacio`
que baja de page.tsx → ValidaClient → ConsultaMasivaForm → ResumenCargueCompletado. Ver [[project-valida-alta-autogestionada]].
