---
name: responsable-desde-bot
description: Trappvel 2026-10-16 (feat/responsable-desde-bot) — viaje_nuevo exige responsable + dicho_en; aviso por trigger en negocio_responsables, opt-in avisar_asignacion; migración 20261016153000 SIN aplicar; staff de prueba por config
metadata:
  type: project
---

PR feat/responsable-desde-bot (2026-10-16). El núcleo conversacional no abre un viaje sin quién lo lleva.

**Why:** Mauricio en la reunión con Trappvel: «preguntar siempre obligatoriamente quién va a ser el responsable de la
ejecución». Prioridad 1 de Trappvel.

**How to apply:**
- `viaje_nuevo` exige `responsable` (nombre de la lista del Estado) Y `dicho_en` (#n de un mensaje/audio/toque del
  equipo, validado como `desde`). Sin `dicho_en` el respaldo lite y hasta el principal ASUMÍAN a quien escribe (QA real:
  3 de 8 primeros turnos). El código no lee el texto; solo exige el puntero. No quitarlo.
- Candados: `falta_responsable`, `responsable_fuera_del_equipo`, `sin_equipo_comercial`. `responsablePendiente` mira
  candados Y salientes del bot con opciones = nombres del equipo (el modelo suele preguntar sin pasar por el candado).
- Staff de prueba: `workspaces.config_extra.staff_de_prueba` (ids). `staff` no tiene marca; no filtrar por «PRUEBA ·».
- `asignarResponsable` vive en `_shared/asignar-responsable.ts` (Next lo envuelve con `registrarActividad`). Reasignar a
  la misma persona ya NO borra su fila (el trigger la vería nueva y re-avisaría).
- Aviso: trigger `trg_avisar_asignacion_responsable` (AFTER INSERT) → campanita `asignacion_responsable` + edge function
  `avisar-asignacion` (función aparte A PROPÓSITO: una `notificar-etapa` vieja leería el payload como entrada a etapa y
  re-avisaría al CLIENTE). Opt-in `config_extra.avisar_asignacion`. Orden: deploy → migración → SQL de Trappvel.
- Todo `PuertoBandeja` nuevo necesita `equipoComercial()` y `crearViaje({…, responsableId})`; los guiones de prueba
  llevan `responsable: 'Carla Comercial', dicho_en: 1` (EQUIPO_PRUEBA de memoria.ts).
Relacionado: [[nucleo-conversacional]], [[nucleo-turno-tras-toque]], [[bot-interpreta-modelo-no-reglas]].
