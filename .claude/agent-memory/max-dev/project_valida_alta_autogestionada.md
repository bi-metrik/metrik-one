---
name: valida-alta-autogestionada
description: Alta autogestionada de Valida (18-recorrido-baja-friccion), primer corte 2026-10-09 — #1095 corte de bolsa, #1097 valida_registros SIN aplicar, #1098 /valida/empezar apagado; PR 1 y 9 de metrik-valida quedaron como PARCHE (worktree aislado no puede hacer git allá)
metadata:
  type: project
---

Spec `proyectos/metrik/valida/docs/crecimiento-mrr/18-recorrido-baja-friccion.md`, orden 4 → 1 → 2 → 3 → 9.
Decisiones vigentes en `10-decisiones-mauricio.md` (D: 10 consultas / 7 días sin tarjeta; A2: método de pago
al registrarse cuando llegue ePayco; B: marca de origen para la comisión AFI; F: precio único).

**Why:** Valida se vende autogestionada sobre ONE (decisión 23). Meta: primera consulta en < 5 min sin humano.

## Estado al 2026-10-09
- **#1095** (sin migración, verde): 402 `bolsa_agotada`/`bolsa_vencida` → «Activa tu plan»; contador vía
  `GET /api/v1/cuenta/consumo` con la llave del espacio; cargue masivo para con `procesarEnParalelo({ detenerSi })`.
  ⚠️ La llave de PRUEBA vence con su bolsa y Valida responde **401**, no 402: se traduce con
  `config_extra.valida_prueba.vence_en` (`src/lib/valida/corte-bolsa.ts`).
- **#1097** migración `20261010090000_valida_registros.sql` **SIN aplicar** (DDL puro). Hay que aplicarla antes del merge.
- **#1098** `/valida/empezar` + `/api/valida/registro`, apagado: `VALIDA_REGISTRO_ABIERTO=1` y, en producción,
  `textosListos()` (no quedan marcadores `[TEXTO EMILIO]`/`[TEXTO LUCÍA]` en `src/lib/valida-registro/condiciones.ts`).
- **PR 1 y PR 9 de metrik-valida NO son PR**: el hook de aislamiento rechaza cualquier git fuera del worktree de
  ONE. Quedaron como parches `diff -ruN` contra `b456fe6` en el scratchpad de la sesión (aplicar con `git apply -p1`).

## Gotchas que no se ven en el código
- Desde un worktree aislado de ONE **no se puede operar metrik-valida con git** (ni `cd`, ni `git -C`). Trabajar en
  una copia `rsync` en el scratchpad con `node_modules` symlinkeado y entregar parche; el Write sí escribe en el scratchpad.
- Rutas con paréntesis (`src/app/(marketing)/...`) dentro de comandos compuestos hacen que el hook rechace el comando
  «por complejo»: pasar el directorio con `\(` `\)` y sin `;`/`echo` encadenados.
- `/valida/empezar` vive en `(marketing)` y comparte el segmento `valida` con `(app)/valida`: el build lo acepta, pero
  el middleware del dominio base lo trataba como ruta del módulo; hay un corte explícito antes del gate.
- La persona DESIGNADA vive en el contrato (`servicios_contratados.aceptante_designado_id`): en la prueba no hay
  contrato y `entradaValidaCda()` deja pasar. La designación llega con la activación (PR 6).

## Falta para abrir al público
Textos de Emilio/Lucía; aplicar #1097; aplicar y desplegar el parche PR 1 en Valida (y `ONE_VALIDA_SECRET` ya está);
marca «PRUEBA» en el PDF (PR 8, criterio de Lucía); PR 5-7 (enrolamiento, activación con pago, cambio de llave al
pagar — sin el 7 un CDA que paga queda cortado el día 7); PR 9 encendido (`NEXT_PUBLIC_VALIDA_PRUEBA_GRATIS=1`);
límite técnico de 3.000 consultas/mes como parámetro del plan pagado (no construido).

Relacionado: [[secop-autogestion-registro]], [[radar-trial-y-cobro]], [[valida-migracion-antes-del-merge]].
