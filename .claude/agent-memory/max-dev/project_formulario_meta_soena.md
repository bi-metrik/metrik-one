---
name: formulario-meta-soena
description: Meta renombró el formulario de SOENA a finales de julio 2026; qué quedó cerrado (PR #540 la ficha, PR #543 el webhook y el rol) y los cuatro valores reales ya medidos
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
- **Cerrado (PR #543, 2026-09-07):** el webhook comparaba el tipo de persona con
  `===` contra `natural_value`, y eso dejó **572 contactos sin rol** desde finales
  de julio. Los 572 los saneó Mauricio a mano; la causa la cierra
  `decidirTipoPersona` en `supabase/functions/_shared/meta-leads/tipo-persona.ts`,
  que juzga por subcadena. ⚠️ **Es una copia deliberada** de
  `detectarTipoPersona` de `src/lib/contactos/campos-formulario.ts` — el webhook
  corre en Deno y no importa de `src/`. **Si se toca una, hay que tocar la otra**;
  cada una tiene sus pruebas con los mismos cuatro valores reales, y se apuntan
  entre sí por comentario.
- ✅ **El valor JURÍDICO ya está medido** (2026-09-07, 803 interacciones): llega
  como `persona_jurídica` (32, formulario vigente) y `jurídica` (6, el de julio).
  El natural llega como `persona_natural` (632) y `natural` (129). **No hay otro
  valor ni ninguno ambiguo.** Caducó la línea que decía que no estaba medido.
- **`natural_value` quedó INERTE** y documentada como tal en el tipo. Medido:
  SOENA es el **único** workspace con `config_extra.meta_leads` en toda la base,
  así que borrar la clave de `config_extra` no afecta a nadie — quedó sin hacer
  solo porque era escritura en producción y ese frente era de solo lectura.
- **El webhook es una edge function: mergear no cambia nada hasta desplegarla.**
  Al cierre del PR #543 quedó pendiente el deploy de `meta-leads-webhook`.

- Los DOS juegos de nombres de campo (viejo y nuevo) viven escritos en
  `proyectos/soena/ve/migrations/20260818_nombres_alternativos_campos_meta.sql`.
  Es la fuente para armar fixtures sin inventar nombres.

Relacionado: [[sql-prod-one]], [[medir-antes-de-construir]].
