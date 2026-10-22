---
name: project-epayco-cargo-pendiente-tardio
description: Cargo con tarjeta de ePayco que queda pendiente (eControl) y se decide tarde; cierre, conciliación y lo que sigue abierto (activar antes de cobrar)
metadata:
  type: project
---

Transacción 390720992 (2026-10-22, afi-prueba-produccion-1): ePayco la dejó «Pendiente por aprobación del comercio» a las 05:01 y la aceptó a las 09:28 Bogotá. La confirmación SÍ llegó y registró el pago (`pasarela_eventos` 390720992-1 `registrado`), pero el intento quedó `pendiente`, el registro en `cobro_pendiente` y sin C3. PR `fix/epayco-cargo-pendiente-tardio` arregla (a) cierre tras aprobado, (b) rechazo tardío, (c) conciliación por consulta. SIN mergear al 2026-10-22; el caso puntual de prod se corrige con 2 UPDATE que Mauricio autoriza aparte.

**Why:** la suscripción se activa ANTES del cobro (paso b de `activarYCobrarReclamado`); el (d), activar solo con el pago aprobado, quedó para Mauricio con Emilio.

**How to apply:**
- Las llaves de ePayco de `.env.local` (EPAYCO_PUBLIC_KEY) NO son del comercio de MeTRIK: la consulta responde «Transacción no relacionada con el comercio». Las `_METRIK` solo viven en Vercel.
- La forma de `/payment/transaction` se leyó de la colección oficial (dice «transacción de efectivo»); no se verificó contra una de tarjeta real.
- Un rechazo tardío de la cuota 1 queda `requiere_revision` mientras exista activar-antes-de-cobrar.
