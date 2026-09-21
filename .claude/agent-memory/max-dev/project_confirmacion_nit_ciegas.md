---
name: confirmacion-nit-ciegas
description: PR #807 — transcripción a ciegas del NIT antes de generar el 010/1668; la casilla NO viaja al navegador, la confirmación es un MAPA por negocio indexado por NIT, y los 5 scripts de cargue quedan rotos A PROPÓSITO
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

## Dónde vive la confirmación (lo que hay que saber para sembrar)

**Ruta exacta:** `negocios.metadata` → clave `confirmacion_nit` → **un objeto indexado por el
NIT en dígitos**. Forma literal:

```json
{ "confirmacion_nit": { "40771100": { "por": "<staff.id|null>", "por_nombre": "Deisy", "at": "2026-09-21T..." } } }
```

- **La llave manda.** Se normaliza con `digitosDeNit` al leer, así que `40.771.100` y
  `40771100` son la misma entrada; un `nit` **dentro** del valor se ignora (dos sitios que se
  pueden contradecir). Una llave sin dígitos descarta la entrada.
- **Contra qué se compara al generar:** contra el NIT que ESE bloque va a imprimir, o sea
  `resolverCamposFuente` + `campos_override`, pasado por `digitosDeNit`. No es el `rut.nit`
  crudo si hay override.
- **Si la entrada ya existe, se SOBREESCRIBE** (autor y fecha nuevos) y las entradas hermanas
  se conservan: `guardarMarcaAnidadaEnMetadata` relee la metadata justo antes del update, así
  que `seccional` y `siigo_*` también sobreviven. Nunca falla por existir.

## Lo que hay que saber antes de tocarlo

- ⚠️⚠️ **La casilla del NIT NO viaja al navegador hasta que se confirma.**
  `resolverFormularioParaEdicion` la manda con `value: ''` y `oculto: true`. Enmascararla en
  el cliente dejaría el número en el payload de la página, y el punto es que el ojo no lo vea
  antes de teclearlo. Si alguien "arregla" esto mandando el valor y tapándolo con CSS, el
  control queda decorativo. Verificado en pantalla: el número no está ni en `innerText` ni en
  `innerHTML` de la tarjeta sin confirmar.
- ⚠️ **El `data-testid` de la casilla tapada lleva el slug** (`casilla-oculta-nit` en el 010,
  `casilla-oculta-numero_identificacion` en el 1668). Un QA que busque el primero da un falso
  negativo en el 1668.
- **Es un MAPA, no un valor, y esa es la decisión que sostiene lo compartido.** Con un solo
  valor por negocio, confirmar el bloque que lleva override desconfirmaría a los otros tres:
  un ping-pong en el que los cuatro nunca se generan. Cada bloque pregunta por SU número.
- **Se ata al VALOR, no a la fecha.** `at` es informativo. Si cambia el NIT a imprimir
  (corrección del `rut`, u override), deja de coincidir y el candado se cierra solo.
- **`casillasConNit` se EXPORTA desde `guarda-nit-formulario.ts` y se reusa.** Mismo criterio
  que la guarda del DV pegado; copiarlo daría dos listas que se desincronizan al agregar un
  template.
- **El porqué de la falta sale de UN criterio** (`motivoFaltaConfirmacionNit`): de ahí salen
  el mensaje del servidor y el texto del panel. `otro_nit` existe **solo** porque la
  confirmación es compartida: quien acaba de confirmar en el formulario de al lado necesita
  leer que este bloque imprime otro número, o la segunda petición se lee como un defecto y
  aprende a teclear sin mirar.
- **Con dos NIT distintos no se pide teclear**: no hay un número que sirva. Se explica y se
  corta.
- **Al no coincidir, el campo para teclear NO vuelve en esa vista.** Al mostrar los dos
  números el guardado queda a la vista; reofrecerlo dejaría copiar el de la pantalla.
  ⚠️ Recargar SÍ lo devuelve — límite conocido y escrito en el PR.

## ⚠️⚠️ Los 5 scripts de cargue quedan ROTOS a propósito

`cargue-iva.ts`, `cargue-iva-batch.ts`, `cargue-historico-iva.ts`, `regen-forms.ts` y
`qa-seccional.ts` entran por `generarFormularioCore`, así que **fallan en los 4 bloques de
010/1668**. Los otros 4 formularios (declaración juramentada, relación de facturas) siguen
igual.

`generarFormularioCore` acepta `confirmacionNit: { nit, por?, por_nombre }` — **no es un flag
para saltarse la guarda**: se compara igual y exige nombre de quien confirmó. Cuando viene,
la confirmación se persiste en el mapa del negocio.

⚠️ **NO cablear los scripts con el `rut.nit` que ellos mismos extrajeron.** Pasarlo sería que
la extracción se confirme a sí misma: el mismo «cruce entre campos no es control» que motivó
el PR.

## Alcance medido (2026-09-21, antes del merge)

- 632 instancias de los 4 bloques de formulario (010 + 1668, generación + envío).
- **630 quedan retenidas** hasta que alguien confirme; **330 ya tenían PDF generado**.
- Las 2 que pasan son los bloques de **V0231**, cuyo `rut` no tiene NIT utilizable.
- Con el mapa por negocio, **una confirmación libera los 4 bloques** del caso salvo que
  alguno imprima otro número.

⚠️ **La primera medición dio 330 retenidos y estaba MAL:** usaba `campos_usados` del bloque
de formulario como proxy del NIT, y los 302 pendientes tienen `data` vacío. La generación lee
el bloque `rut` **vivo**. Para medir el alcance de una guarda sobre formularios, resolver
desde la fuente, no desde lo guardado.

## Siembra del barrido (decidida, la ejecuta la sesión principal)

**333, no 337:** los 4 sin acuerdo entre lecturas no son coincidentes, no hay contra qué
compararlos. A esos 333 se suman **V0216, V0382 y V0446**, ya corregidos con el barrido.

Relacionado: [[nit-dv-y-retorno-reproceso]], [[formulario-010-dian]],
[[seccional-contradice-el-rut]], [[pruebas-por-mutacion]], [[qa-pantalla-viva-cdp]].
