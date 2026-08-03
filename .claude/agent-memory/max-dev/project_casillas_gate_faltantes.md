---
name: casillas-gate-faltantes-soena
description: Hueco ABIERTO en SOENA VE — 653 casillas de bloques gate no existen para casos que ya pasaron la etapa; el backfill de 297 no las cubrió
metadata:
  type: project
---

Al 2026-08-03 quedan **653 casillas de bloques gate sin crear** en la línea SOENA VE, sobre los 163 negocios abiertos que ya pasaron por Documentación. Un gate sin casilla NO retiene: `gates_pendientes_etapa` hace JOIN contra `negocio_bloques`, así que un bloque gate sin instancia es invisible para el motor de avance.

Desglose medido: `certificado_superintendencia_financiera`, `rut_solicitante_2`, `contrato_de_leasing`, `certificado_de_existencia`, `certificado_de_existencia_del_banco` (123 casos cada uno, configs creadas 2026-06-09/10), `cita_dian_requerida` (36 casos, config creada 2026-07-28) y `rut` (2 casos).

**Why:** el trigger `sembrar_casillas_al_crear_bloque` solo dispara al INSERTAR un `bloque_configs`, y se creó el 2026-08-01 — después que esas configs. El backfill de 297 casillas del 2026-07-31 tampoco las alcanzó. El auto-init de `getNegocioDetalle` las crea, pero solo para la etapa ACTUAL y solo cuando alguien abre el negocio: mientras nadie lo abra, el gate no existe y el caso puede salir de la etapa sin responder.

**How to apply:** el más grave es `cita_dian_requerida`, porque su campo `requiere_cita_dian` DECIDE una ruta (routing de Cobro). P5 tapa el caso puntual sembrando las casillas del destino al devolver un caso (ver `ejecutarRetorno` en `src/lib/correcciones/retorno.ts`), pero **el hueco general sigue abierto**: hace falta un barrido con `sembrar_casillas_bloque(<config_id>)` por cada config afectada. Antes de proponerlo, re-medir: la cifra cambia a medida que la gente abre negocios. Relacionado: [[soena-ve-pipeline]].
