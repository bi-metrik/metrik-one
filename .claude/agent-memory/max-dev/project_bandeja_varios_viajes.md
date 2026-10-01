---
name: bandeja-varios-viajes
description: Modo mixto de la bandeja WA (varios viajes por entrega) y guardianes N1-N9 — migración 20261001120000 SIN aplicar, upsert por (entrega, segmento), límites que el QA debe conocer
metadata:
  type: project
---

PR `feat/bandeja-wa-varios-viajes` (2026-10-01), base main, SIN mergear: va a QA de Vera (grupo F a 5
corridas, día sintético a 10). Migración `20261001120000` ANTES del deploy de wa-alerts y wa-webhook: el
upsert del código viejo `on conflict (entrega_id)` se queda sin índice. `modo_viajes` nace en `uno`.

**Why:** Tatiana reenvía varios clientes a la vez; un reenvío no dice de qué chat viene.

**How to apply:**
- Fila 0 = la entrega (estado `repartida` tras el «sí»); cada viaje confirmado corre en su fila
  `segmento = k`, que filtra `wa_bandeja_mensajes.segmento = k`. Las confirmaciones N4/N5/N6 reusan
  `esperando_negocio` + `respuesta_negocio` con `confirmacion_pendiente`: el cron NO cambió.
- Historia extractiva: solo citas de mensajes REENVIADOS y clase cliente; la prosa del modelo se ignora.
- Límites declarados: un encabezado olvidado cuyos primeros mensajes no nombran a nadie queda en la caja
  vieja (solo lo ve el comercial en el resumen); N5 depende de que el modelo liste las solicitudes; D4
  («mi hermana también va») deja adultos vacío, no lo suma.
- Fixtures sintéticos: `__fixtures__/bandeja-varios-viajes.json` (F + día) y `bandeja-banco-bcd.json`
  (A4/B/C/D), salidas del modelo grabadas a mano en el esquema nuevo (mensajes, citas, solicitudes).
- QA de #971 (Gemini real) tumbó la primera versión: el día dio S1 10/10. Lecciones: el modelo
  NO debe decidir el año de una fecha; el «cliente» que extrae el modelo puede ser el código o «Tati»
  (comparar solo con quien se presenta); el destino no es evidencia de asignación; un «sí» con sin
  asignar descartaba en silencio. Las propuestas reales están en `__fixtures__/bandeja-qa971.json`.
- 2026-10-01 tarde: Mauricio decidió que MANDA EL ENCABEZADO. Se fue el modo mixto (el modelo ya no
  asigna) y `segundos_bloque`; quedan sospechosos con «dejar / mover / descartar». Sin encabezados,
  la tanda es un viaje como en modo uno. N5 no separa: pide reenviar con encabezados.
- QA v5 (2026-10-01): solo un encabezado EXACTO (código, nombre de pila ± apellido) cambia la caja;
  el aproximado (tipeo, solo apellido, destino) pregunta «¿Cambias a…? sí/no» en el acto y el «sí/no»
  se guarda en la tanda (el reparto lo relee, no hay estado aparte). Equipo (staff + wa_collaborators)
  nunca es candidato. NO existe marca de negocio de prueba en el esquema: no inventarla.
- Edades: decisión de Mauricio, la edad NO mueve a nadie de categoría (niño/adulto dependen del
  componente y los decide operaciones). Único corte: infante < 2. No hay cortes en la config.
- El aislamiento rechaza `cat >> archivo <<EOF` y `sed` con variables: usar Edit/Write o un .py en el worktree.
Relacionado: [[entendimiento-bandeja-wa]], [[bandeja-negocio-existente]].
