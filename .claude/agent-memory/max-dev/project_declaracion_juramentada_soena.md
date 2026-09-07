---
name: declaracion-juramentada-soena
description: PR #545 — la plantilla nueva, las tres decisiones que no se deben revertir, el campo no opcional que BLOQUEA la generación del PDF, y lo que falta preguntarle a Deisy
metadata:
  type: project
---

PR **#545** (2026-09-07). La declaración juramentada de SOENA pasó de una carta al
Art. 7 del Decreto 1165 de 2019 —sin un solo dato del vehículo— a la plantilla del
Art. 12 de la Ley 1715 de 2014 + Concepto DIAN 000673-int-0063, que describe la compra.
Migración `20260907000001`, **config aplicada en producción**, respaldo en
`public.backup_declaracion_juramentada_20260907`.

**Why:** Deisy Ramírez (directora operativa) llevaba días haciendo el documento a mano
por fuera de la plataforma. Su pedido del 4-sep nunca se había escrito, y se le
respondió que era un tema de despliegue — eso hay que corregirlo con ella.

## ⚠️⚠️ Un campo NO opcional en `campos_fuente` BLOQUEA la generación del PDF

`generarFormularioCore` corta con `faltantesReales.length > 0` y devuelve
«Faltan N campos». No imprime un marcador: **no genera**. Así que decidir qué va
`optional` es decidir a cuántos casos les vas a poder emitir el documento, y eso se
**mide contra la base antes de escribir la config**, no se supone.

Medido sobre los 401 negocios abiertos de SOENA:

| Campo (bloque.campo) | Cobertura |
|---|---|
| `rut.direccion` / `.municipio` / `.razon_social` / `.numero_identificacion` | 312 |
| `factura.tipo_vehiculo` / `.fecha_factura` / `.proveedor` / `.numero_factura` / valores | 377-381 |
| marca y línea, contando la alterna a la factura | 380 |
| `concepto_upme.numero_caso_upme` | **283** |
| `concepto_upme.fecha_certificado` | **96** |
| segundo RUT (copropiedad) | **8** |

Resultado del cambio: **282 podían generar antes, 307 después**. Ganan 30 (los casos
sin certificado UPME, que antes se bloqueaban porque el `tipo_vehiculo` salía del
certificado); pierden 5 a los que les falta el número de factura, el IVA o la fecha.
Ese bloqueo es deliberado: son datos que la declaración afirma bajo juramento, y el
bloque es `editable_siempre`, así que **un override en la casilla satisface el
faltante** — no es un callejón sin salida.

## Tres decisiones que NO se deben "arreglar"

Están comentadas en `src/lib/pdf/declaracion-juramentada-pdf.tsx`, pero se olvidan:

1. **No se imprime el valor total de la factura.** Pedido textual de Deisy del 4-sep:
   ese total puede llevar impuesto al consumo o accesorios, y afirmarlo como valor del
   vehículo contradice la Relación de facturas del mismo expediente.
2. **La identificación va sin dígito de verificación** (es cédula, no NIT).
   `nitConDv()` **sigue vigente** en el Formato 010 y en la Relación.
3. **Los datos del certificado UPME son `optional`** y la cláusula SEGUNDO degrada por
   niveles: con radicado y fecha, el texto íntegro; con radicado sin fecha, sin el
   trozo de la fecha; **sin radicado, se cae la mención a la UPME y a la Ley 1715** y
   solo queda lo que la factura prueba.

Y dos desviaciones deliberadas de la plantilla: dice **«vehículo híbrido»** cuando la
factura dice híbrido (la plantilla decía siempre «eléctrico»), y usa
**«identificado(a)» / «domiciliado(a)»** para que sirva con solicitantes mujeres.

## ⚠️ Lo que falta preguntarle a Deisy

1. **Qué debe decir la cláusula SEGUNDO en los casos «solo IVA».** El texto que quedó
   es decisión de MéTRIK, no del cliente. Es lo único abierto de fondo.
2. Confirmar que omitir el valor total es lo que pidió.
3. Confirmar «vehículo híbrido» en vez del «eléctrico» fijo.
4. **Avisarle que ya puede dejar de hacerlo por fuera.**

**How to apply:** antes de tocar este documento, leer los comentarios del componente;
antes de tocar `campos_fuente`, medir la cobertura de cada campo que se vuelva
obligatorio. QA en `proyectos/soena/ve/qa/` (V0425 un titular, V0286 copropiedad,
V0452 solo IVA) con su LÉEME.

Relacionado: [[react-pdf-guion-entre-corridas]], [[soena-ve-pipeline]],
[[medir-antes-de-construir]].
