---
name: SOENA pipeline VE — sprint 2026-04-05
description: Implementación del flujo operativo VE/HEV/PHEV de SOENA en metrik-one — etapas, gates, custom fields, estado_ve
type: project
---

## Commit
2d387d9 feat: pipeline VE SOENA — etapas, campos custom, gates y flujo proyecto

## Workspace SOENA
- workspace_id / tenant_id: `7dea141d-d4da-483d-a78d-b14ef35500c5`
- slug: `soena`

## Etapas oportunidad activas post-sprint
orden 0: lead_nuevo ("Por contactar") — sistema, conservado
orden 1: contactado — custom nuevo
orden 2: pago_anticipo — custom nuevo
orden 3: recoleccion_docs — custom nuevo
orden 7: ganada — sistema, terminal
orden 8: perdida — sistema, terminal
(las otras 4 de sistema quedaron activo=false)

## Etapas proyecto activas post-sprint
orden 0: inclusion_upme ("Por inclusión", #6366F1) — custom
orden 1: active ("Por radicar") — sistema renombrado
orden 2: radicacion ("Por certificar") — custom renombrado
orden 3: certificacion ("Certificado") — custom renombrado
orden 4: a_cobrar ("Por cobrar") — custom renombrado
orden 5: paused, 6: rework, 7: completed — sistema conservados
orden 8: closed, 9: cancelled — terminal

## tenant_rules activos (gates)
- Gate E3: pago_anticipo requiere referencia_anticipo_epayco no vacío
- Gate E7: por_certificar requiere numero_radicado_certificacion no vacío

## Custom fields oportunidad (nuevos, orden 20-25)
- valor_anticipo (number)
- vehiculo_en_upme (boolean) — ya existía, upsert
- numero_radicado_inclusion (text)
- numero_radicado_certificacion (text)
- cert_upme_url (text — tipo 'url' no está en check constraint, usar 'text')
- cert_upme_validado (boolean)

## Flujo estado_ve en proyectos
custom_data.estado_ve controla el estado operativo VE. proyectos.estado se usa solo para routing de tabs:
- por_inclusion, por_radicar, por_certificar, certificado → en_ejecucion (tab "En curso")
- por_cobrar → entregado (tab "Por cobrar")
- cerrado → cerrado (tab "Historial")

Transición por_inclusion → por_radicar setea viene_de_inclusion=true en custom_data (para banderita).

## Archivos clave
- `src/lib/actions/ve-proyecto.ts` — moveProyectoVe: mueve estado_ve, ajusta proyectos.estado, loguea
- `src/app/(app)/pipeline/actions-v2.ts` — ganarOportunidad: skip fiscal para VE, estado_ve inicial, auto-cotizacion flash
- `src/app/(app)/pipeline/[id]/ve-documentos-section.tsx` — botón "Documentos completos" (etapa recoleccion_docs)
- `src/app/(app)/negocios/negocios-actions.ts` — incluye custom_data en proyectos, etiquetas VE
- `src/app/(app)/negocios/negocio-card.tsx` — banderita naranja proyectos VE por_radicar + colores indigo/purple

## Gotchas
- cotizaciones tabla: codigo y consecutivo son required en tipos TS. Usar get_next_cotizacion_consecutivo RPC + codigo: ''
- custom_fields check constraint no incluye 'url' como tipo — usar 'text' en su lugar
- Batch POST a custom_fields falla con ON CONFLICT en batch — insertar uno a uno con ?on_conflict=
- tenant_rules usa tenant_id (= workspace_id), NO workspace_id como columna
- custom_data.estado_ve vive en proyectos.custom_data JSONB — la vista v_proyecto_financiero no lo expone, hay que hacer JOIN directo a proyectos para obtenerlo

## Pendiente para próximo sprint
- moveProyectoVe: UI en /proyectos/[id] para avanzar entre etapas VE
- Gate E2 (modal pago anticipo) — complejo, requiere cambios en flujo de cambio de estado
- Pagos múltiples E9 — custom_data.pagos_saldo array JSONB
- parse-cert-upme.ts — AI validation del certificado UPME
