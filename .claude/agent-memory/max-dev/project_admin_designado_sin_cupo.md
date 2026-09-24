---
name: admin-designado-sin-cupo
description: En los CDA la persona designada del contrato es administrador sin costo y no ocupa licencia; el cupo cuenta solo operativos en /suscripcion, /config y /mi-negocio (#906 y siguiente, 2026-09-24)
metadata:
  type: project
---

Decisión de Mauricio (2026-09-24): un CDA con `parametros.licencias = 2` tiene a la persona designada
(`aceptante_designado_id`) como administrador SIN costo MÁS dos operativos. El adicional de la
cláusula 2.3 empieza en el tercer operativo. PR #906 (mergeado, sin migración).

**Why:** antes la designada consumía una de las 2 licencias y el CDA pagaba adicional desde el
tercer usuario total.

**How to apply:** todo conteo de cupo pasa por `cupoDelEspacio` / `usuariosOperativos` de
`src/lib/usuarios-espacio/reglas.ts`. Hay TRES lugares que cuentan personas: `leerEquipo`
(carga-servidor), la re-cuenta post-creación de `invitarUsuario` (servidor.ts, recibe
`designadoId`) y la liberación de adicional al retirar (acciones.ts + usuarios-panel). El cuarto
llegó el mismo día: `/config` (`getLicenseInfo` + `inviteStaffToPlataform`) y `/mi-negocio` pasan
por `leerLicenciasDelEspacio` (licencias-servidor.ts) → `licenciasDelEspacio` de reglas.ts. Siguen
contando `profiles` contra `max_seats` (no `listarUsuarios`: no excluyen retirados, platform admin
ni contador), solo sin la designada; `max_seats` lo mantiene igual al contrato la RPC de compra.
El texto del contador sale de `textoCupo` en las tres pantallas. Cobro de adicionales, comisión
y renovación no cuentan personas. Relacionado: [[seccion-suscripcion-cda]], [[suscripcion-solo-designado]].
