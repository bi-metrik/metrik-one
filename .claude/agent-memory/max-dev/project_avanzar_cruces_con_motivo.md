---
name: avanzar-cruces-con-motivo
description: PR #1016 (2026-10-05) — avanzar UN cruce de línea con motivo (lista avanzar_cruces.staff_ids); las 2 migraciones YA aplicadas en prod el 2026-10-05; Daniela conserva Omitir gate (decisión de Mauricio)
metadata:
  type: project
---

`avanzarCrucesConMotivo` (negocio-v2-actions) deja una excepción en `negocio_cruces_avanzados`
para un cruce, un negocio y una `huella` (hash de los valores que se contradicen). El gate
(`contradiccionesQueBloquean`) y la tarjeta (`datosClaveDelNegocio`) la leen; la tarjeta sigue
mostrando el cruce con «Avanzado por X: motivo».

**Why:** Mauricio (2026-10-05): los cruces eran demasiado rígidos; el override de owner/admin
apaga TODOS los gates de la etapa, esto solo uno y vuelve a frenar si el dato cambia.

**How to apply:**
- Migraciones `20261005120000` y `20261005120100` YA aplicadas y en el ledger (2026-10-05): no cambiar su versión ni su contenido; un ajuste va en migración nueva.
- Decisión de Mauricio (2026-10-05): Daniela conserva «Omitir gate» además del botón nuevo.
- La tabla SOLO la escribe service_role: si la sesión pudiera insertar, cualquiera se fabrica su excepción por PostgREST. No abrirle insert a `authenticated`.
- Historial: `tipo: 'cambio'` + `campo_modificado: 'cruce_avanzado'` a propósito, para no reescribir el CHECK de `activity_log.tipo` (su test lee la migración 20260901000010).
- Permiso = solo la lista, el rol no cuenta. SOENA: staff `c914313f…` (admin) y `6f107e73…` (supervisora). La admin además está en `omitir_gate.staff_ids`.
- Votos en disputa (`voto:*`) NO se avanzan: no traen huella.
- La huella de `cantidad` son los conteos: cambiar QUIÉN figura sin cambiar cuántos no re-frena.
- Medido 2026-10-05: 26 abiertos frenados por cruce (23 certificado_personas_vs_titularidad en Cita/Seguimiento/Anexos) + 1 por voto.
- Sin QA en pantalla. Relacionado: [[datos-clave-cruces-titularidad]], [[omitir-gate-por-persona]], [[freno-titulares-antes-de-radicar]].
