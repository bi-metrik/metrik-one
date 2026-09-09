---
name: pqr-rechazado-desenlace
description: PR #603 mergeado, config SOENA SIN aplicar — el gate que hace el archivado inútil, la fecha de cita que dejaba el frente muerto en llegada, y por qué el hook vive en la LECTURA del negocio
metadata:
  type: project
---

PR **#603** (`dd0ab0e`) mergeado el 2026-09-09. Mecanismo genérico
`config_extra.desenlace_retorno`: una etapa declara que una respuesta devuelve el caso a
una etapa anterior, se archiva lo que dependía del ciclo que se cierra y queda marca en
`negocios.metadata.desenlaces`.

⚠️ **La config de SOENA NO está aplicada**:
`proyectos/soena/ve/migrations/PENDIENTE_20260909_pqr_rechazado_desenlace.sql`. Mientras
no se aplique, el código no toca una sola fila en ninguna línea. **Orden obligatorio:
deploy del código primero, config después** — al revés, un caso vuelve a Cita con
`via_solicitud = pqrs` intacto y entra en el bucle que esto viene a evitar.

## ⚠️⚠️ Archivar el dato NO rompe el bucle. Lo rompe el GATE

El routing de Cita (orden 16) cae por **DEFECTO a Notificación (17)** cuando
`via_solicitud` está vacío. O sea que vaciar el campo deja el destino igual. Lo que retiene
el caso es que el bloque archivado queda `pendiente` **y es gate**.

**How to apply:** cualquier mecanismo que "vacíe un campo para que se vuelva a preguntar"
tiene que comprobar dos cosas por separado — que el valor se fue, y que algo RETIENE al
caso mientras no haya respuesta nueva. Un bloque declarado en `archivar` que no sea gate
deja el bucle abierto y se ve exactamente igual de verde.

## ⚠️⚠️ Un desenlace nuevo puede ser INALCANZABLE por los gates que ya existen

El brief pedía bloque nuevo + routing. Con eso solo, **44 de los 46** casos no habrían
podido registrar el rechazo nunca: Notificación tiene otro gate, «Fecha cita DIAN»
(`required`), y si la DIAN rechazó el PQR **no hay fecha**. Hubo que condicionarlo a
`resultado_pqr = cita_asignada`.

**How to apply:** antes de agregar una salida nueva a una etapa, **listar TODOS sus gates y
preguntarse cuáles no se pueden cumplir en la rama nueva**. Se mide con una consulta al
estado de esos bloques en los casos parados ahí, no leyendo la config.

## Por qué el hook vive en `getNegocioDetalle` y no en el avance

El motor (`cambiarEtapaNegocioConGate`) no expone punto de extensión posterior al
movimiento, y su zona suele estar tomada por otra sesión. Colgarse de la LECTURA sale mejor
y no es un parche: **es reintentable**. La señal es la respuesta viva en su bloque, lo que
la consume es archivar ese bloque y eso va de ÚLTIMO, y **el conteo se DERIVA de los ciclos
archivados en vez de incrementar la marca**. Una pasada a medias se completa sola en la
siguiente apertura sin contar dos veces.

El caso no se escapa en el intervalo: el botón de avanzar vive en la ficha, y abrir la
ficha es lo que dispara esto. `getNegocioDetalle` ya hospeda cuatro reparaciones perezosas
del mismo estilo (auto-init de casillas, propuesta económica, tarifa UPME, el
`_campo_retirado` de `cita_dian_confirmacion`).

## Topología medida (línea GIT EV/HEV `34a0fa6b`, 2026-09-09)

- Cita = **orden 16 / numero 13**, id `548804e9`. Notificación = **orden 17 / numero 14**,
  id `e0a9ffce`. Anexos = 18. El `orden` NO ordena el recorrido: Anexos (18) enruta a 13 y
  Seguimiento (19) a 15.
- **Cuando una etapa tiene `routing`, el motor NO valida orden**: resuelve el destino y
  autocorrige. Ir de 17 a 16 no necesita tocar el motor. Verificado leyendo
  `cambiarEtapaNegocioConGate`.
- 46 negocios en Notificación, los 46 **abiertos**, los 46 con `via_solicitud = pqrs`,
  ninguno con fecha de cita. 128 negocios pasaron alguna vez por la etapa.
- ⚠️ El bloque nuevo es gate y `sembrar_casillas_al_crear_bloque` siembra al **INSERTAR el
  `bloque_configs`**: nacen **128 casillas** de una vez, aunque solo retienen a los 46 que
  están ahí hoy (los gates se evalúan sobre la etapa actual).

## Decisión abierta (Deisy)

El gate «Aviso del enlace de la DIAN» (`aviso_enlace_pqr`) sigue exigido **también en la
rama del rechazo**, y **28 de los 46** lo tienen `pendiente`. Se dejó así porque la guía de
la etapa dice que el aviso es «la respuesta de la DIAN le llega a su correo, pídele que te
la pase», y eso aplica igual si la respuesta es un rechazo. Si Deisy dice que no aplica, la
salida ya existe sin código: su `omitible_por` de área operaciones.

## Desvíos del brief, deliberados

La marca quedó **anidada** en `metadata.desenlaces.<clave>` (no `metadata.pqr_rechazos`
suelto) y el campo es `ultima_referencia` (no `ultimo_radicado`): así `getNegociosV2` lee
UNA clave fija y no consulta la config de las etapas para saber qué mirar, y el mecanismo
no sabe de PQR. Sin datos en producción cuando se decidió. Se agregó
`guardarMarcaAnidadaEnMetadata` a `marca-metadata.ts`, que relee los DOS niveles.

Relacionado: [[soena-ve-pipeline]], [[casillas-gate-faltantes-soena]],
[[seguimiento-citas-dian]], [[pruebas-por-mutacion]].
