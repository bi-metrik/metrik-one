---
name: cardumen-navigate-demo
description: Bot Navigate (Cardumen x Reframeit) para la demo a Grupo Progreso — motor determinista aparte del R1/R2, orden de puesta en marcha (deploy ANTES del SQL), y qué cambia para la palabra `cardumen`
metadata:
  type: project
---

El estudio `navigate` (PR de la rama `feat/cardumen-navigate`, 2026-09-07) NO usa el
entrevistador R1/R2: es una máquina de estados en `supabase/functions/_shared/cardumen/navigate/`
y el modelo Haiku solo LEE texto libre a JSON (`interprete.ts`). El catálogo lo declara con
`spec.motor = "navigate"` y `startCardumenChat`/`continueCardumenChat` delegan por ese campo.

**Why:** el R1 infiere la inclinación de la narrativa y tiene PROHIBIDO presentar los polos como
elección (regla 5b del prompt); las specs de Navigate piden lo contrario (ordenar dos polos +
graduar, cinco anclas). No era una config, era otra mecánica. Y Saga exige que el modelo no
redacte ni traduza nada del instrumento.

**How to apply:**
- **Orden de puesta en marcha: desplegar `wa-webhook` y `cardumen-cron` PRIMERO, correr
  `sql/navigate-catalogo.sql` DESPUÉS.** Al revés, `cardumen` abre el R1 viejo con un spec sin
  dimensiones. Sin la fila del catálogo el código nuevo es inerte.
- Mientras la fila esté `activo = true`, la palabra `cardumen` **deja de mandar el link de la
  mini-web FEDE** (`sendCardumenLink` queda inalcanzable). Se revierte con `activo = false`.
- `cardumen_respuestas` solo tiene `id, estudio, token, lang, payload, created_at`: la bandera
  `demo`, población, sector, idioma y los campos de piloto van dentro de `payload`. No hay columna
  nueva ni migración.
- Los literales de Capa A se copian de `meta.json` (fuente única) **con sus tildes** y la
  prueba `instrumento.test.ts` los fija. Cambiar la redacción = cambiar meta.json primero.
  Excepción deliberada: el **sector se guarda como slug SIN tildes** (coincide con
  `respuestas.json` de la muestra) y se muestra con la etiqueta de `SECTORES_CATALOGO`
  (`etiquetaSector`); `leerSector` compara normalizado, así que tecleado con o sin tildes resuelve.
- Las anclas intermedias de las diadas son genéricas ("más cerca de X, con matices"); las
  definitivas las redacta Yuto cuando Saga avale el esquema (spec de diadas §9).
- El registro es de **usted**, como la muestra del cliente; el guard `es-neutro.ts` solo corrige
  voseo y no interfiere.
- Sector va por lista numerada, no por lista interactiva de WhatsApp: esas admiten 10 filas y son 12.
- El cron `cardumen-cron` salta sesiones con `state.motor = 'navigate'` porque su recordatorio es
  texto de La Araucanía.
- El webhook (bloque 0b) ahora pasa `message.interactive_reply` como 5.º parámetro de
  `continueCardumenChat`; el motor decide por id de botón y acepta el texto como equivalente.

Relacionado: [[canal-wa-propio]], [[pruebas-por-mutacion]].
