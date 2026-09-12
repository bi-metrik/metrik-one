---
name: routing-condition-bloque
description: PR #586 mergeado — el routing filtra por `condition` del bloque; el radio real es UN solo routing de todo el sistema, y los 177 negocios huérfanos siguen sin limpiar
metadata:
  type: project
---

**El motor de etapas ya descarta los bloques que no le aplican al caso** (`condition` no
cumplido, `desactivado: true`) al armar el mapa de campos con el que resuelve el routing.
PR **#586**, mergeado el 2026-09-08 (squash `50a6b4f`, verificado con `merge-base
--is-ancestor`). Sin migración y sin una sola escritura a producción.

**Why:** V0431 (SOENA) saltó de Certificación directo a Anexos —saltándose Segundo cobro,
Cartera, **Entrega** y Cita— porque el cargue histórico le sembró `requiere_cita_dian:
false` en un bloque condicionado a `servicio = solo_iva` que a él no le aplica. Un valor
que el equipo no puede ver ni corregir decidía por dónde seguía el caso.

**How to apply:**

- Toda lectura nueva de campos para decidir una ruta pasa por
  `camposDeRoutingDelNegocio` (en `negocio-v2-actions.ts`) o por el módulo puro
  `src/lib/negocios/campos-de-routing.ts`. El destino se resuelve con `destinoDeRouting`
  (en `dato-de-decision.ts`), no reescribiendo el bucle: ese bucle ya estuvo escrito tres
  veces.
- **El filtro va ANTES del gate de dato de decisión**, para que el gate y el `conditional`
  vean el mismo mapa. Si se separan, un caso pasa el gate con un valor que el routing
  ignora.
- La condición **no se reevalúa en TypeScript**: entra por parámetro y la resuelve la RPC
  `condicion_cumplida`, con `p_etapa_actual_id = sourceEtapaId`. Existe además
  `cumpleCondicion` puro en `condicion-bloque.ts` (para el render) — usarlo aquí haría que
  un bloque aplique para la pantalla y no para el motor.

## Lo que NO cerró este PR (sigue abierto)

- ⚠️ **Los 177 negocios con el campo huérfano NO se limpiaron.** Retirar el valor con el
  rastro `_campo_retirado` es un paso aparte y **lo aprueba Mauricio**. Mientras tanto el
  valor sigue en la base; lo que cambió es que el motor ya no lo lee.
- ⚠️ **V0431 y V0400 están adelante sin haber pasado por Entrega ni por Cita.** Devolverlos
  o completarlos a mano **lo decide Deisy**.

## El radio, medido (2026-09-08, al abrir y al cerrar: 177/19 las dos veces)

**Solo UN routing de todo el sistema cambia de destino: Cartera (11) de la línea VE de
SOENA.** De los 7 campos de decisión que existen en las 5 líneas con `routing.conditional`
de los 16 workspaces, solo 2 viven en un bloque con `condition`, y los dos son de SOENA VE.
Los de Trappvel están en bloques sin condición. Ninguno vive en un bloque `desactivado`.

- **Cartera:** 177 abiertos cambian (153 dejaban de ir a Cita, 24 a Anexos; todos caen al
  default, Entrega). Los 19 cuyo bloque sí aplica (`solo_iva`) mantienen su destino.
- **Entrega (12):** **cero** cambios — los 84 abiertos con `requiere_cita_dian_iva` tienen
  el bloque aplicable.
- **Cuándo pega:** solo **2 de los 177** (V0415, V0416, en Documentación) siguen aguas
  arriba de Cartera. Los otros 175 solo re-evalúan si vuelven a cruzarla por reproceso o
  retroceso — que es justo lo que le pasó a V0431, reprocesado dos veces.

Relacionado: [[soena-ve-pipeline]], [[casillas-gate-faltantes]], [[medir-antes-de-construir]].
