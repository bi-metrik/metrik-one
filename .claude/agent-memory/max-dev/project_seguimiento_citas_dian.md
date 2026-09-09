---
name: seguimiento-citas-dian
description: PR #598 mergeado — orden por cita en /negocios y marca roja; el `solo_si` que evita el único falso positivo, la config SOENA SIN aplicar, y qué NO se verificó
metadata:
  type: project
---

**PR #598 mergeado el 2026-09-09** (squash, 6 checks verdes, sin migración de esquema
y sin una sola escritura a producción). Orden «Cita más próxima» en `/negocios` +
marca roja de atención inmediata en la tarjeta.

**Why:** Deisy Ramírez, textual, *"se le están perdiendo citas"*. Y la marca es marca
y no aviso porque en 30 días el sistema disparó más de 4.000 avisos (Daniela sola
recibió 2.361): un aviso más ahí no se ve.

## ⚠️ La config del workspace quedó SIN aplicar y es lo único que enciende la marca

`proyectos/soena/ve/migrations/PENDIENTE_20260909_seguimiento_citas_soena.sql`
(fuera del repo de ONE, por convención de workspace). El **orden y los grupos
funcionan sin ella**; la marca roja no existe hasta que alguien la corra.

**How to apply:** antes de decir «el seguimiento de citas está entregado»,
comprobar `select config_extra ? 'seguimiento_citas' from workspaces where slug='soena'`.
El día que se aplique, la marca encenderá en **cero casos** — eso es correcto y
está medido, no es un fallo.

## ⚠️⚠️ El `solo_si` del documento requerido evitó el único caso que habría encendido

`Certificado bancario` es un bloque **condicional** (`requiere_devolucion_iva`), pero
su instancia **se crea igual y se queda en `pendiente` para siempre** cuando no
aplica. Medido el 9-sep: sin la condición, el ÚNICO caso que la marca roja habría
encendido ese día era **V0136, un falso positivo** — cita ese mismo día, certificado
pendiente, y ese negocio no pide devolución de IVA.

**Why:** la primera marca roja que ve la operación no puede ser una equivocada; si
lo es, dejan de mirarlas todas.

**How to apply:** cualquier control nuevo que se apoye en `negocio_bloques.estado`
tiene que preguntar antes si ese `bloque_configs` declara `condition` en su
`config_extra`. Un bloque condicional que no aplica es indistinguible de uno
pendiente si solo se mira el estado.

## Cifras de producción del 9-sep (410 abiertos y no pausados de SOENA)

| | |
|---|---|
| con fecha de cita | 111 (71 vencidas, 40 futuras) |
| **esperando que el cliente reporte la fecha** | **133** (46 en Notificación) |
| sin cita registrada | 166 |
| certificado bancario faltante | 96 |
| …con cita de hoy o futura | 9 |
| …dentro de las 36 h → **marca roja** | **0** |

⚠️ Estas cifras **caducan**: se re-miden al hacer QA (ver
[[cifras-del-brief-caducan]]). El brief decía «39 con cita futura» y «13 con
certificado pendiente»; ninguna de las dos coincidió al medir.

## Lo que NO se verificó, y hay que decirlo

**Sesión autenticada en `soena.metrikone.co`.** No hay navegador y la marca no tiene
caso real que encender (por diseño), así que forzar uno exigía escribir en
producción. La tarjeta sí quedó cubierta por prueba de render; el cableado de
`negocios-client.tsx` (elegir agrupador según el orden) está verificado **solo por
tipos**.

Relacionado: [[techo-postgrest]] (la lectura de instancias son 1.510 filas y exige
`traerTodo`), [[pruebas-por-mutacion]], [[soena-ve-pipeline]].
