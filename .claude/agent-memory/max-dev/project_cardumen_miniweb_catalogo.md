---
name: cardumen-miniweb-catalogo
description: Modo `miniweb` de Cardumen resuelto por catálogo (columna url) + endpoint público `cardumen-ingesta` (PR #980) — por qué la palabra `cardumen` no se puede tocar, qué queda inerte hasta el deploy, y los límites conocidos de la idempotencia y del endpoint
metadata:
  type: project
---

PR #980 (2026-10-01, rama `worktree-agente-8e0740c900c2`, encargo de Saga): `modo='miniweb'`
pasa a resolverse por `cardumen_estudios` + `cardumen_estudio_triggers`, con una columna `url`
nueva, y nace `supabase/functions/cardumen-ingesta` (POST público con CORS) para que los
instrumentos de Reframeit (`reframeit.metrik.com.co/adultos` y `/ninos`) dejen de guardar solo
en el dispositivo.

**Why:** `miniweb` estaba en el CHECK de la tabla desde el 2026-08-12 y el webhook NUNCA lo
leyó: las dos mini-webs vivas se despachan con la palabra Y el destino escritos en TypeScript
(`isCardumenTrigger`/`isTurismoTrigger` + la constante `CARDUMEN_APP_URL`, un solo deploy de
Vercel). Un instrumento en otro dominio no se podía publicar sin redesplegar la función.

**How to apply:**
- **La palabra `cardumen` NO se toca: resuelve al estudio `navigate` (modo chat) y es la demo
  viva de Grupo Progreso.** Por eso el bloque nuevo del webhook va DESPUÉS del de chat, y por
  eso `sendCardumenLink`/`sendTurismoLink`/el flow quedan intactos aunque sean migrables.
  Ver [[cardumen-navigate-demo]].
- **Orden: migración 20261001150000 ANTES del merge, deploy DESPUÉS.** Sin la columna `url`, el
  `select` del resolver falla con 42703. Y hasta que se desplieguen `wa-webhook` (bloque nuevo)
  y `cardumen-ingesta` (función nueva, primer deploy) TODO esto es inerte: `cardumen adultos`
  no responde nada. El merge a `main` no despliega edge functions.
- **La ñ no se normaliza.** `normalizarTrigger` solo baja a minúscula y quita `!¡?¿.,`: por eso
  `cardumen ninos` y `cardumen niños` son DOS filas de trigger. Un instrumento nuevo con tilde
  o ñ en su palabra necesita todas las grafías sembradas.
- **La idempotencia de `cardumen-ingesta` NO es atómica.** Busca una fila previa por el id de
  sesión del payload (lista cerrada: `session_id|sesion_id|sessionId`) y la ACTUALIZA; dos POST
  simultáneos del mismo envío pueden insertar dos filas. Cerrarlo exige un unique sobre una ruta
  del payload, o sea decidir la clave canónica del id de sesión: es decisión de Saga, no del
  código.
- **El endpoint no tiene rate limit por teléfono.** Lo único que lo acota es el tope de 1 MB
  (audio en base64 queda fuera: eso pide Storage, no `cardumen_respuestas`) y que el `estudio`
  se valide contra el catálogo (404 si no existe o está apagado). Si el instrumento sale de
  pilotos, hace falta.
- El HTML del instrumento vive FUERA de este repo (`proyectos/metrik/cardumen/...`): el POST
  desde el cliente lo conecta Mauricio. Mientras no exista, el endpoint no recibe nada.
- `cardumen_estudios.publicable` sigue en `false` para los dos instrumentos: nada de lo que
  entre sale por la vista pública hasta que alguien lo declare.

Relacionado: [[pruebas-por-mutacion]], [[valida-migracion-antes-del-merge]].
