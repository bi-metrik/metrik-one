---
name: confirmacion-nit-ciegas
description: PR #807 — transcripción a ciegas del NIT antes de generar el 010/1668; la casilla NO viaja al navegador, la confirmación se ata al VALOR, y los 5 scripts de cargue quedan rotos A PROPÓSITO
metadata:
  type: project
---

PR **#807**, checks verdes, **sin migración** y **sin una escritura a producción**. Módulo
puro `src/lib/dian/confirmacion-nit.ts` + guarda en `generarFormularioCore` + server action
`confirmarNitFormulario` + panel en `BloqueFormulario.tsx`.

**Why:** el barrido de los 342 RUT de SOENA (banco en
`proyectos/soena/ve/qa/extraccion-rut-2026-09-21/`) encontró 3 NIT malos en producción y
midió que **ninguno de los controles existentes los ve**: el DV cuadra por módulo 11, el
cruce `nit`⟺`numero_identificacion` falla igual porque salen de la MISMA lectura, la
confianza era 0.98 en los tres, y en V0446 un operador ya había corregido el DV a mano sin
notar el 7 repetido. **Mirar el número en pantalla no es control** — por eso esto es una
transcripción y no un checkbox.

## Lo que hay que saber antes de tocarlo

- ⚠️⚠️ **La casilla del NIT NO viaja al navegador hasta que se confirma.**
  `resolverFormularioParaEdicion` la manda con `value: ''` y `oculto: true`. Enmascararla en
  el cliente dejaría el número en el payload de la página, y el punto es que el ojo no lo vea
  antes de teclearlo. Si alguien "arregla" esto mandando el valor y tapándolo con CSS, el
  control queda decorativo.
- **La confirmación se ata al VALOR, no a la fecha.** Vive en
  `negocio_bloques.data.confirmacion_nit = { nit, por, por_nombre, at }`; `at` es informativo.
  Si cambia el NIT que se va a imprimir (corrección del bloque `rut`, u override en la
  casilla), deja de coincidir y el candado se cierra solo. Por eso no necesitó tabla ni
  migración.
- **`casillasConNit` se EXPORTA desde `guarda-nit-formulario.ts` y se reusa.** Es el mismo
  criterio que la guarda del DV pegado. Copiarlo daría dos listas que se desincronizan al
  agregar un template, y el síntoma sería un formulario que un control protege y el otro no.
- **Al no coincidir, el campo para teclear NO vuelve en esa vista.** No es rigidez: al
  mostrar los dos números el guardado queda a la vista, así que reofrecer el campo dejaría
  copiar el de la pantalla. ⚠️ Recargar la página SÍ lo devuelve — límite conocido y escrito
  en el PR; la fuerza del control está en la primera lectura.
- **Tres mensajes distintos a propósito** (sin confirmar / el NIT cambió después de
  confirmar / el formulario tiene dos NIT): piden tres acciones diferentes.
- Un formulario **sin** NIT pasa sin confirmar: no hay nada que transcribir, y el faltante lo
  reporta el control de campos faltantes con un mensaje que sí dice qué hacer.

## ⚠️⚠️ Los 5 scripts de cargue quedan ROTOS a propósito

`cargue-iva.ts`, `cargue-iva-batch.ts`, `cargue-historico-iva.ts`, `regen-forms.ts` y
`qa-seccional.ts` entran por `generarFormularioCore`, así que a partir del #807 **fallan en
los 4 bloques de 010/1668** con «Antes de generar hay que confirmar el NIT…». Los otros 4
formularios (declaración juramentada, relación de facturas) siguen igual.

`generarFormularioCore` acepta `confirmacionNit: { nit, por?, por_nombre }` — **no es un flag
para saltarse la guarda**: se compara igual, y exige nombre de quien confirmó.

⚠️ **NO cablear los scripts con el `rut.nit` que ellos mismos extrajeron.** Todos lo tienen a
mano, y pasarlo sería que la extracción se confirme a sí misma: exactamente el «cruce entre
campos no es control» que motivó el PR. El número tiene que salir de una persona leyendo el
documento.

## Alcance medido (2026-09-21, antes del merge)

- 632 instancias de los 4 bloques de formulario (010 + 1668, generación + envío).
- **630 quedan retenidas** hasta que alguien confirme; **330 de ellas ya tenían PDF
  generado**, o sea que no pueden regenerar sin confirmar.
- Las 2 que pasan son los bloques de **V0231**, cuyo `rut` no tiene NIT utilizable.
- 0 confirmaciones existentes.

⚠️ **La primera medición dio 330 retenidos y estaba MAL:** usaba `campos_usados` del bloque
de formulario como proxy del NIT, y los 302 pendientes tienen `data` vacío. La generación lee
el bloque `rut` **vivo** (`resolverCamposFuente`). Para medir el alcance de cualquier guarda
sobre formularios, resolver desde la fuente, no desde lo que quedó guardado.

## Consecuencia operativa sin decidir

Las dos copias de cada formulario (generación y envío) son filas distintas con su propio
`data`, así que **cada caso pide 4 confirmaciones a lo largo de su vida** (2 a la vez). Se
siguió el brief (la confirmación vive en el bloque). Compartirla a nivel de negocio es un
cambio de una línea y lo decide Mauricio.

Relacionado: [[nit-dv-y-retorno-reproceso]], [[formulario-010-dian]],
[[seccional-contradice-el-rut]], [[pruebas-por-mutacion]], [[qa-pantalla-viva-cdp]].
