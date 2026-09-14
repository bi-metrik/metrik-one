---
name: nit-dv-y-retorno-reproceso
description: PRs #690 y #692 (2026-09-14) mergeados — el NIT con DV pegado se corrige con TESTIGO (Bancolombia es la trampa), el reproceso vuelve a la etapa que el caso pisa derivando de la seccional, y el error sin retorno se marca con ciclo 0; el orden/numero del tramo quedó sin decidir
metadata:
  type: project
---

Dos PRs del mismo encargo SOENA (frentes 1B, 3B, 3C), los dos mergeados con checks verdes y
**sin migración**. Nada desplegado a mano: son código de Next, Vercel los sube solo.

## #690 — el NIT del RUT con el DV pegado

- **La regla del brief habría mutilado a Bancolombia.** «Si el DV calculado de `nit[:-1]` es el
  último dígito y el DV leído también, recorta» se cumple con **890903938 / DV 8 estando limpio**.
  Se agregó una tercera condición: el DV del NIT COMPLETO no puede coincidir con el leído; si
  coincide, `dudoso` (no se toca, baja a 0.75). Control medido sobre 326 RUT limpios simulando
  que no hubiera identificación: la regla del brief recortaba 6 dígitos reales, la nueva 1.
- **Riesgo residual fijado en `nit.test.ts`:** sin identificación y con el DV MAL leído igual al
  último dígito, recorta (V0309 `rut_solicitante_2` sería el caso). Con identificación, no.
- **"Confianza baja" = 0.75, no <0.70.** Los formularios DIAN descartan como faltante todo campo
  bajo 0.70 (`resolverCamposFuente`); un NIT dudoso habría bloqueado el 1668 de cada cliente de
  Bancolombia.
- **Al medir, los 20 RUT pegados ya estaban corregidos** (0 de 345). Quedan 3 bloques con el DV
  guardado ≠ calculado, reportados y NO tocados: V0006 `rut` (1→0), V0309 `rut_solicitante_2`
  (2→3), V0468 `rut` (7→1).

## #692 — a dónde vuelve un reproceso, y el error que no devuelve el caso

- **Reusar solo la respuesta registrada NO habría arreglado V0374**: su caso migrado no tiene
  bloque en Entrega, y el `false` que sí tiene está en un bloque que no le aplica. Por eso hay
  un fallback que deriva de `negocios.metadata.seccional` con la misma regla de
  `cita_dian_confirmacion`. Medido: de 286 abiertos entre Cita y Seguimiento, **182 no tienen
  respuesta aplicable**; 24 de esos son de seccionales sin cita.
- **El error sin retorno no tiene columna: `ciclo = 0` (`CICLO_SIN_RETORNO`).** Si tomara
  `ciclo+1`, el próximo reproceso real lo repetiría. Supuesto no verificado: que ninguna función
  aplicada solo por MCP use el ciclo para contar.
- **Atribución por `formulario_versiones.generated_by`**, con corte `antesDe`: en V0142 la v2 la
  generó la supervisora 5 min DESPUÉS de abrir el evento, para corregirlo. Sin el corte se lleva
  la culpa quien arregló.

## ⚠️ Abierto: el tramo y el «antes de» usan `orden`, no `numero`

**Why:** en SOENA Generación (13) y Envío (14) van DESPUÉS de Cita (16) en el flujo. Las 15
devoluciones DIAN abiertas desde Seguimiento (26-ago a 14-sep) no archivaron Generación ni
Envío, y un caso en esas etapas nunca puede reprocesarse (cae en «antes de Cita»).
**How to apply:** no cambiarlo sin Mauricio: pasar a `numero` archivaría formularios y envíos en
cada devolución. Si alguien reporta «el 010 del ciclo anterior sigue completo después de un
reproceso», es esto.

Relacionado: [[reproceso-documentos-migrados]], [[formulario-010-dian]], [[pruebas-por-mutacion]],
[[cifras-del-brief-caducan]].
