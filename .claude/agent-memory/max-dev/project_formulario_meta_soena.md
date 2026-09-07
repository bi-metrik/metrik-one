---
name: formulario-meta-soena
description: Meta renombró el formulario de SOENA a finales de julio 2026; qué quedó cerrado (PR #540), qué sigue abierto (709 contactos sin rol) y el valor jurídico que nadie ha medido
metadata:
  type: project
---

Meta renombró los campos del formulario de leads de SOENA a finales de julio de
2026 (transición en julio: 135 respuestas con los nombres viejos, 43 con los
nuevos; agosto y septiembre, todos nuevos). Cambiaron **los nombres de campo y
también los valores de respuesta**.

**Why:** el formulario lo edita el cliente en Meta, no MeTRIK. Cada sitio del
producto que dependa de un nombre de campo exacto se rompe mudo el día que lo
tocan — ya pasó tres veces (el `field_map` del webhook en agosto, el mapa del
bloque del negocio en la migración `20260818_nombres_alternativos_campos_meta.sql`,
y la ficha del contacto en septiembre).

**How to apply:**

- **Cerrado (PR #540, 2026-09-07):** la ficha del contacto pinta todo el
  `field_data` y solo calla la identidad por parecido. Ya no hay lista que
  acertar ahí.
- ⚠️ **Abierto y NO ejecutado — 709 contactos con `rol = null`.** El webhook
  compara `natural_value` (`"natural"` en la config) con `===` contra un valor que
  hoy llega como `persona_natural`: da falso y el contacto nace sin rol. 587 en
  agosto, 122 en septiembre; en julio nacían 126 con `decisor`. La propuesta
  (webhook por parecido + saneo acotado a los que declaran natural) está escrita en
  el cuerpo del PR #540. **Lo decide Mauricio**: toca datos de producción.
- ⚠️ **El valor exacto del caso JURÍDICO no está medido en ninguna parte.** El
  código lo resuelve por subcadena `jurid` para no depender de la forma, pero si
  llegara como `empresa` o `sociedad` la sugerencia de tipo de persona seguiría
  callada. La consulta que lo mide está en el cuerpo del PR #540 y solo se puede
  correr desde una sesión con MCP.
- Los DOS juegos de nombres de campo (viejo y nuevo) viven escritos en
  `proyectos/soena/ve/migrations/20260818_nombres_alternativos_campos_meta.sql`.
  Es la fuente para armar fixtures sin inventar nombres.

Relacionado: [[sql-prod-one]], [[medir-antes-de-construir]].
