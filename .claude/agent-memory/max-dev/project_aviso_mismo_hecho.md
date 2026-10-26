---
name: aviso-mismo-hecho
description: SOE-008/009 (2026-10-09) — avisos al cliente de notificar-etapa no se repiten por el mismo hecho (huella) ni salen con cita pasada; migración 20261009220000 SIN aplicar; deploy de notificar-etapa DESPUÉS
metadata:
  type: project
---

Decisión de Mauricio (2026-10-09): «la primera debe ser blindada para que en los reprocesos no se
envíen los correos». Guarda en `notificar-etapa` vía `_shared/aviso-mismo-hecho.ts`.

- Huella = datos crudos que el copy cita (`fecha_cita_dian`, `drive_url` del `link_bloque_slug`,
  números de recibo); `{}` si no cita nada. Mismo origen (etapa o bloque) + canal + huella con
  `enviado`/`disparado` previo → `omitido/duplicado`. Otra huella (reprogramación) sí sale.
- Filas viejas (huella NULL) se reconstruyen del `_ciclos` del bloque: el reproceso archiva y VACÍA
  los bloques de las etapas repetidas — por eso `omitir_si_bloque_completo` nunca atajó el reproceso.
- 11 de 13 repeticiones medidas en SOENA eran reprogramaciones reales; solo V0457 (y V0255 parcial)
  repetía la misma cita. Tratar filas viejas como «iguales» habría callado reprogramaciones.
- V0171 no fue duplicado: la UI rechazaba citas pasadas y la operación puso «hoy 10:00». Ahora
  `notaPorFechaPasada` solo avisa y la edge omite con `cita_pasada`.

**Why:** un correo repetido o con una cita vieja el cliente lo lee como fraude (Deisy).

**How to apply:** orden migración → merge → deploy `notificar-etapa` (sin la columna, el insert de
la traza falla). Si otro aviso nuevo cita un dato distinto, agregarlo a `DatoDelHecho` o su
re-entrada contará como duplicado. Relacionado: [[avisos-dia-habil]], [[cierre-automatico-reproceso]].
