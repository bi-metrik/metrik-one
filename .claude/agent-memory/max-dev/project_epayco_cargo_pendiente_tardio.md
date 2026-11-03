---
name: project-epayco-cargo-pendiente-tardio
description: Cargo con tarjeta de ePayco que queda pendiente (eControl) y se decide tarde; causa real (deploy después de la aceptación), cierres, paso 7e y lo abierto (activar antes de cobrar)
metadata:
  type: project
---

Transacción 390720992 (2026-10-22, afi-prueba-produccion-1): pendiente 10:01:35Z, aceptada 14:28:57Z (evento
`registrado`). #1252 (cierre del intento, registro y C3) se mergeó a las **15:03:55Z**, o sea DESPUÉS: la causa
del desfase fue que el código vivo no tenía el cierre. Nada lo reparaba después (evento final; la conciliación
del cargo no mira una cuota pagada). Se cerró a mano por SQL.
PR fix/valida-cobro-pendiente-y-reverso (26-oct): `cerrarCargoAprobadoTardio` lee el pago de la base y cierra el
registro aunque el intento ya esté cerrado; el cargo re-chequea tras escribir `cobro_pendiente` (carrera de una
aprobación en segundos); paso 7e del cron `conciliarRegistrosConCobroPendiente`. C3 solo si el pago es el de la
tarjeta (referencia de un intento).

**Why:** la suscripción se activa ANTES del cobro (paso b de `activarYCobrarReclamado`); el (d), activar solo con
el pago aprobado, quedó para Mauricio con Emilio.

**How to apply:**
- Ante «el arreglo no funcionó en prod», comparar la hora del evento con la del merge antes de buscar el bug.
- Las llaves de ePayco de `.env.local` (EPAYCO_PUBLIC_KEY) NO son del comercio de MeTRIK; las `_METRIK` solo viven en Vercel.
- El subagente aislado no tiene MCP: SELECT por PostgREST con GET (script python en el worktree, borrarlo después).
- Un rechazo tardío de la cuota 1 queda `requiere_revision` mientras exista activar-antes-de-cobrar.
