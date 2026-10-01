---
name: tarifas-plan-ruta
description: Tarifas fijas por plan y ruta de la propuesta económica (SOENA, 2026-10-01) — tabla servicio_tarifas_versiones SIN aplicar; una propuesta emitida con el esquema anterior no cambia; el PDF aún imprime el plan que no se ofrece
metadata:
  type: project
---

Tarifas por plan × ruta en `servicio_tarifas_versiones` (inmutable, vigencia por día de creación del
negocio). Regla en `src/lib/propuesta/tarifas.ts` (`decidirEsquema`, `casillasDeRuta`). La ruta es
`servicio_contratado.servicio`. El negocio congela la versión en `data.tarifa` al generar su primera
versión con tarifas. Editor: Mi negocio → Mis servicios → «Tarifas» (owner/admin, escribe con service_role).

**Why:** SOENA quiere cambiar sus precios sin depender de MéTRIK. Medido el 2026-10-01: de 5 negocios
creados ese día, 4 ya tenían propuesta emitida con precio estándar + descuento (V0546/48/49 aprobadas a
637.500 / 425.000 / 425.000; V0547 pendiente). Con la tabla nueva cambiarían a 682.500 / 341.250 /
546.000, así que `decidirEsquema` los deja en el esquema anterior (`emitida_antes`). Pasarlos es
decisión de Mauricio, no del código.

**How to apply:**
- Migraciones `20261001140000_servicio_tarifas_versiones.sql` (DDL) y `20261001140100_soena_tarifas_plan_ruta.sql`
  (carga, re-aplicable) se aplican ANTES del merge (main despliega solo). Sin la tabla el código cae al
  esquema anterior en silencio (`leerVersionesTarifa` devuelve []).
- El tope 25 % vive en la versión; el `cap_descuento_pct` del bloque sigue en 100 para los negocios viejos.
  `umbral_aprobacion_pct` = 50 > 25 deja el gate gerencial mudo en los negocios con tarifas.
- La plantilla del PDF (`metrik-pdf-render/templates/soena/propuesta-economica.html`) no oculta la tarjeta
  del plan que no se ofrece: ONE manda «No aplica» y `plan1_estilo`/`plan2_estilo`. Cambiarla es otro repo
  (Fly), y como el render aborta con placeholders sin dato, ONE tiene que desplegar primero.
