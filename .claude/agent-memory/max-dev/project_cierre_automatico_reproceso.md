---
name: cierre-automatico-reproceso
description: PR #787 mergeado (2026-09-18) — el reproceso se cierra solo al ALCANZAR etapa_origen por flujo; el backfill de 21 casos sigue SIN aplicar y V0244 no tiene traza; la premisa del brief sobre eventos huérfanos era falsa
metadata:
  type: project
---

**PR #787** (`da7c8391`, checks verdes, **sin migración de esquema**). Código de Next: Vercel lo
sube solo, no hay nada que desplegar a mano.

## ⚠️ Lo que queda SIN aplicar

`proyectos/soena/ve/migrations/20260918_backfill_reproceso_etapa_origen.sql` — escribe
`etapa_origen` en los 22 reprocesos vivos de SOENA. **Hasta que se aplique, el cierre
automático es INERTE para esos 22** (se abstiene con `sin_origen`). Es a propósito: sin el
dato no se adivina de dónde salió el caso.

- **21 de 22 resolubles** desde `activity_log` (`valor_anterior` de la traza `Reproceso N —…`,
  cruzando `valor_nuevo = etapa_retorno` para no tomar la traza de otro ciclo).
- **V0244 no tiene traza y requiere decisión humana.** Su reproceso es del 2026-08-26 **14:04**
  y el arreglo del CHECK de `activity_log` entró ese mismo día hacia las **17:39**: los de
  V0213 (17:56) y V0309 (17:39) sí la tienen. No es un caso raro, es la frontera del fix.
- **El backfill NO cierra nada por sí solo**: el cierre ocurre en el siguiente avance. De los
  21, **7 ya alcanzaron su origen** (V0206, V0211, V0213, V0309, V0348, V0403, V0431) y se
  cierran en cuanto avancen. Medido con un recursivo sobre el routing real, no por `orden`.

## ⚠️⚠️ La premisa del brief era falsa y conviene no heredarla

El encargo pedía verificar que «hoy quedan eventos de ciclo 1 con `cerrado_at` null en casos
que ya van en ciclo 2». **Medido: CERO.** Los dos casos en ciclo 2 (V0206, V0255) tienen su
ciclo 1 cerrado, porque la operadora lo cerró a mano antes de abrir el siguiente. El hueco era
**latente, no vivo** — y se abre justo al dejar de esconder el botón. El arreglo hacía falta;
lo que no había era dato que reparar. Familia de [[cifras-del-brief-caducan]].

## El criterio, que es lo fácil de romper

Cierra cuando el caso vuelve a **ALCANZAR `etapa_origen`** (de dónde salió), **NO** cuando
supera `etapa_retorno` (a dónde volvió). Criterio explícito de Vera: devolver a Cita y avanzar
un paso ya supera el retorno y no rehizo nada.

Y se mide por **flujo** (`alcanzablesPorFlujo`, el de `tramoDelReproceso`), nunca por `orden`.
En la línea GIT EV/HEV el `orden` da la respuesta contraria en los dos sentidos:
- salió de **Seguimiento (19)** y llega a **Facturación (15)** → SÍ rehecho (por `orden` parece
  que retrocedió);
- salió de **Generación (13)** y llega a **Anexos (18)** → NO rehecho (Anexos → Generación, así
  que Anexos va ANTES; por `orden` parece que ya pasó).

Las dos son las pruebas que tumba la mutación a `orden`. Si alguien "simplifica" a una
comparación numérica, esas dos caen.

**Se abstiene a propósito en tres casos** (`sin_origen`, `origen_desconocido` si renombraron la
etapa, `no_alcanzado`): el lado seguro es dejar abierto, que se ve y se corrige con un clic;
cerrar de más lo vuelve invisible.

## Dónde vive

- `src/lib/negocios/cierre-reproceso.ts` — regla pura.
- `src/lib/negocios/cierre-reproceso-servidor.ts` — efectos, con `service_role`.
- Se invoca desde `cambiarEtapaNegocioConGate` **después** de mover, releyendo `metadata`
  (no reusando la del principio: los gates escriben ahí en el medio).
- El "Cerrar" del banner pasó a ser **corrección** ("Cerrar a mano"), y la marca guarda
  `cerrado_por`: `'sistema'` o el `staff.id` de quien lo pulsó.

## Gotchas que se pagaron aquí

- **El botón "Reprocesar" ya no se esconde con un reproceso activo.** Era el síntoma que abrió
  el frente (V0388): con 22 vivos sin cerrar, casi todo caso reincidente parecía no tener la
  opción. El modal explica qué ciclo está abierto y que confirmar lo cierra.
- Al abrir el ciclo N+1, el evento del ciclo N se cierra con **`service_role`**:
  `authenticated` solo tiene SELECT sobre `reproceso_eventos` y el 42501 se traga.
  El `is('cerrado_at', null)` deja intacto el **ciclo 0** (`CICLO_SIN_RETORNO`, nace cerrado —
  V0388 tiene uno).
- Los contadores del tablero (`tableros/actions.ts` ~905 y ~1153) y el chip del listado leen
  `marca.activo`: **se desinflan solos**, no hubo que tocarlos.

Relacionado: [[nit-dv-y-retorno-reproceso]], [[activity-log-vocabulario]],
[[pruebas-por-mutacion]], [[worktree-git-bloqueado]].
