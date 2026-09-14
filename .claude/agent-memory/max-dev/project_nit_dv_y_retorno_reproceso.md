---
name: nit-dv-y-retorno-reproceso
description: PRs #690 y #692 (2026-09-14) mergeados y #705 sin mergear — el NIT con DV pegado se corrige con TESTIGO (Bancolombia es la trampa), el reproceso vuelve a la etapa que el caso pisa, el error sin retorno es ciclo 0, y el tramo pasa al flujo del routing; dos SQL sin aplicar (V0388 antes del merge, y el backfill de 10 casos) y la atribución de V0388 cae en una supervisora que el bono excluye
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

## #705 — el tramo y el «antes de» pasan al FLUJO (decidido por Mauricio el 2026-09-14)

Ya no es `orden` ni `numero`: `tramoDelReproceso` toma las etapas en algún camino del retorno a
la actual, recorriendo el routing con `etapasAguasAbajo`. Línea sin routing = `orden` literal.
PR #705 con checks verdes y **NO mergeado a propósito** (ver abajo).

- **⚠️ V0388 pierde «Registrar sin devolver».** Está en Envío, que ahora va después de Cita: la
  pantalla solo ofrece ese registro cuando `reprocesarNegocio` responde `antesDelRetorno`, así que
  el mismo clic lo devuelve a Cita y reabre cinco etapas. Al 14-sep no tenía evento ciclo 0.
  Mauricio mantuvo su decisión: va por SQL **antes** del merge
  (`proyectos/soena/ve/migrations/20260914_v0388_error_sin_retorno.sql`, preparado SIN aplicar).
- **⚠️ El resolvedor le carga V0388 a Deisy, que es supervisora, y el bono excluye supervisores**
  (`base ... WHERE es_supervisor = false`, por `profiles.role`). El evento no le resta a nadie.
  Pasa porque el paso 2 toma a quien generó el último documento (10-sep, dos días DESPUÉS de la
  cita fallida del 8-sep). La responsable del caso es de comercial: tampoco entraría.
- **Casos viejos: `20260914_backfill_tramo_generacion_envio.sql`** (SIN aplicar, no depende del
  merge): 72 bloques en 10 casos, sello = `metadata.reproceso.abierto_at` de cada uno. Archivar
  deja `completado_at` puesto (igual que la acción): el indicador de envío del bono lo sigue
  contando hasta que se vuelva a completar. V0109/V0142/V0206 fuera: ya volvieron a radicar.
- **Facturación queda alcanzable desde Cita** (Seguimiento → Facturación). No hay botón en la
  etapa de cierre; solo muerde una llamada directa a la acción.
- **Revisión radicado (orden 20) arreglado de rebote:** con `orden`, un reproceso UPME desde ahí
  archivaba la línea entera (7..20) y un DIAN desde ahí era «reprocesable».
- Al reabrir Generación se archivan también los `campos_override` (V0142, V0244, V0403 los tenían).
- **Medición al 14-sep:** 0 bloques de Generación/Envío archivados por reprocesos DIAN. V0109
  cruzó Generación en 12 min con los documentos viejos; V0234 entró a Generación con los 4 de
  agosto completos (el gate no lo retiene). Tabla completa en el cuerpo del PR #705.

**How to apply:** si reportan «el 010 del ciclo anterior sigue completo después de un reproceso»,
mirar si el reproceso es anterior al deploy del #705. Una mutación que vuelva
`decisionesHaciaDestino` a `orden` solo la tumba la línea sintética: en SOENA coinciden.

Relacionado: [[reproceso-documentos-migrados]], [[formulario-010-dian]], [[pruebas-por-mutacion]],
[[cifras-del-brief-caducan]].
