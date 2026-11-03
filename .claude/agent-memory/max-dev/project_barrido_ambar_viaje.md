---
name: barrido-ambar-viaje
description: Barrido ámbar de «Viaje a medida» (2026-10-22, sin migración) — los gates de etapa se devuelven todos juntos; margen del cierre único; gate cotizacion_requerida sin config aún
metadata:
  type: project
---

PR `feat/trappvel-barrido-ambar` (2026-10-22), sin migración, segundo pase tras #1248/#1250.

**Why:** en E8 el equipo descubría los pendientes de a uno (saldo, luego confirmación del cierre); el modal de cerrar
mostraba un margen distinto al del panel (sin IVA, con horas).

**How to apply:**
- `cambiarEtapaNegocioConGate` acumula en `pendientesGate` y devuelve una vez, DESPUÉS de `margen_sobre_piso`. Un gate
  nuevo de etapa tiene que hacer `pendientesGate.push(...)`, nunca `return`. Consecuencia: el margen (y su
  `evaluarSalida` con `registrarPerdida`) corre aunque otra familia ya frene. Fraude, cruces y recaudo cambiado siguen
  con `return` propio, después.
- `aplicarOmisiones` (gates vencidos → «no aplica») solo se arma si ningún bloque retiene.
- `leerViajeFinal` devuelve `{ panel, paraCerrar }`; `paraCerrar` solo existe en etapas 7-9 con `cierre_viaje.activo`.
  Fuera de eso el diálogo de cerrar usa la cuenta vieja.
- `cotizacion_requerida` no hace nada hasta que Mik lo agregue a `config_extra.gates` de E2 (después del deploy).
- «Edgar» fijo en `cierre-viaje.ts`/`servicios-viaje-actions.ts` sigue pendiente (otro PR).

Relacionado: [[barrido-gates-viaje]].
