---
name: duplicado-hermanos-siigo
description: PR #561 — el guardián de duplicados solo retiene facturas LIBRES; el vínculo es la marca de la factura y NO el contacto (V0321/V0323 lo prueba), y qué quedó sin QA
metadata:
  type: project
---

**PR [#561](https://github.com/bi-metrik/metrik-one/pull/561)** — checks en verde,
**sin mergear** (lo pidió el encargo). Construido sobre el #550, que ya está en `main`.

**Regla que fijó Mauricio el 2026-09-07:** cada negocio se factura independiente y
cada factura queda atada a UN negocio. **Una factura que otro negocio ya reclama NO
es evidencia de que este esté duplicado, y no puede advertirse como tal.**

## Por qué el defecto era un callejón sin salida, no una molestia

El guardián mostraba en rojo la factura del hermano y mandaba a usar «Esta factura
ya existe»; abajo, el panel de adopción mostraba **esa misma factura deshabilitada**
con "ya está en V0140". La pantalla mandaba a un botón que ella misma bloqueaba, y
la única salida correcta —emitir la factura nueva— quedaba pareciendo la prohibida.

**Why:** las dos superficies leían el mismo dato (`metadata.siigo_factura`) y sacaban
conclusiones opuestas. El panel ya sabía distinguir reclamada de libre; el guardián
no preguntaba. **How to apply:** cuando dos superficies opinan sobre el mismo objeto,
comprobar que la salida que una recomienda sea alcanzable en la otra — el defecto no
se ve mirando ninguna de las dos por separado.

## ⚠️ El vínculo es la MARCA de la factura, no el contacto de ONE

Medido contra producción: **V0321 y V0323 son el mismo dueño con DOS `contacto_id`
distintos** en ONE. Siigo agrupa por identificación, así que la factura del hermano
aparece igual. Una implementación "natural" que agrupara hermanos por `contacto_id`
habría seguido bloqueando ese caso y **nadie lo habría notado**, porque los otros 9
pares sí comparten contacto. Vale para cualquier regla futura sobre "el mismo cliente":
en ONE el cliente puede estar duplicado; en Siigo no.

## Lo medido (lectura, sin una sola escritura)

- Los **10 hermanos tienen marca** de factura y los **10 pendientes no**; los **6 de
  la lista de libres siguen sin marca**. V0140 = FV-2-290, V0410 = FV-2-478.
- **V0370 ya salió con FV-2-510**: es la corrección a mano que originó el encargo, o
  sea que el caso testigo ya no reproduce. Los que siguen viendo el aviso espurio hoy
  son V0408 y V0409 (su hermano V0410 ya facturado).

## Lo que queda ABIERTO

- **Cero QA en pantalla y cero POST a Siigo.** Lo que se probó es el código, con
  dobles. Nadie ejercitó el flujo con un operador.
- **Los hermanos solo se pintan cuando la emisión se BLOQUEA**, porque es el único
  momento en que el servidor ya consultó Siigo. En los 10 casos espurios puros la
  emisión ahora simplemente funciona y no se muestra nada — correcto, pero significa
  que la línea de contexto **no se ve en el caso que la motivó**. Mostrarla antes
  costaría un GET a Siigo por caso al abrir la revisión, y se descartó por eso.
- La copia de la caja roja ahora dice «cancela y márcala con "Esta factura ya existe",
  aquí abajo: sale habilitada». **Esa promesa depende de que el panel de adopción esté
  visible** (`siigoConfigurado && !descartado && (!ya_facturado || factura_sin_pdf)`).

Relacionado: [[siigo-sucursal-adopcion]], [[marcas-siigo-soena]], [[sql-prod-one]],
[[pruebas-por-mutacion]].
