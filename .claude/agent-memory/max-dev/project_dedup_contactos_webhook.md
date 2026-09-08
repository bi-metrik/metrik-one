---
name: dedup-contactos-webhook
description: PR #565 sin mergear — el orden migración-antes-de-deploy es veneno si se invierte, el DROP de la sobrecarga es obligatorio, y queda abierto el mismo agujero en la creación inline de negocio
metadata:
  type: project
---

**PR [#565](https://github.com/bi-metrik/metrik-one/pull/565)** (rama
`fix/dedup-nombre-y-usuario-whatsapp`, commit `81eafa6`): el nombre desempata la
regla del teléfono compartido en el webhook de Meta, `usuario_whatsapp` entra
como tercera llave de `buscar_contacto_duplicado`, y `posible_duplicado` se ve
en `/directorio/contactos`. Los 5 checks obligatorios en verde. **NO mergeado a
propósito** (2026-09-08): Mauricio lo pidió así porque lleva migración de
función.

**Why:** las 6 interacciones marcadas `posible_duplicado` desde el 2026-08-02
eran la MISMA persona con un segundo correo, las 6, y de los 17 teléfonos que
comparten 39 contactos en SOENA **ninguno tiene el nombre repetido** — la regla
que existía para separar cónyuges nunca separó a nadie y creó seis fichas.

**How to apply — lo que NO está en el código y decide si esto sale bien:**

1. ⚠️⚠️ **La migración `20260908000001` va ANTES del deploy de
   `meta-leads-webhook`, y el deploy es a mano** (mergear no despliega una edge
   function). Al revés el webhook llama la RPC con `p_usuario_whatsapp`, eso es
   `PGRST202`, el `dedup:` lanza a propósito y **Meta reintenta cada lead hasta
   que la migración exista**. En el orden correcto no hay ventana: la función
   nueva atiende igual a los cuatro llamadores viejos, que pasan los argumentos
   por nombre.
2. ⚠️ **El `drop function ... (uuid, text, text, uuid)` de la migración no es
   cosmético.** `create or replace` con un parámetro más crea una SOBRECARGA; la
   llamada de 4 argumentos encaja en las dos y Postgres responde `function is
   not unique`. Ese error, en este webhook, es el mismo veneno del punto 1. Si
   alguien "limpia" el drop, se rompe producción.
3. **Sin backfill y sin escritura**: el arreglo es hacia adelante, las 6 fichas
   ya las fusionó Mauricio a mano y hoy no queda grupo con nombre repetido.
4. **La selección entre varios dueños de un teléfono** (que el lead del hijo se
   compare contra la ficha del hijo, no contra la de la madre) solo se puede
   ejercitar en vivo **después** de aplicar: la función desplegada devuelve una
   sola fila y la nueva devuelve hasta 10.

⚠️ **Agujero hermano que sigue abierto:** la creación inline de negocio
(`negocio-v2-actions.ts`, ~1949) **engancha por teléfono sin mirar el nombre**,
así que crear el negocio del hijo con el celular de la madre lo cuelga de la
ficha de la madre. Es el mismo defecto en espejo (el webhook creaba de más, esta
puerta funde de más) y quedó fuera del alcance del #565.

**Decisiones de diseño que no se revierten sin hablar con Mauricio:**
enganchar y **no** fusionar (no se toca un campo del contacto existente; el
correo que no cabe va a `custom_data.emails_alternos`); marcar
`posible_duplicado` **igual que si hubiera creado**, porque agrupar bien no
exime de que un humano confirme; y un nombre de una sola palabra SÍ cuenta como
nombre (25 de los 809 leads llegan así), asumiendo el falso positivo de padre e
hijo homónimos con el mismo celular, que es recuperable.

Relacionado: [[formulario-meta-soena]], [[merge-no-despliega-edge-function]],
[[sql-prod-one]], [[pruebas-por-mutacion]].
