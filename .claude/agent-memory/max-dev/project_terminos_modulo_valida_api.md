---
name: terminos-modulo-valida-api
description: PR #769 (2026-09-16) aceptación contractual de términos dentro de /valida-api, mergeado y con la migración 20260917014500 aplicada; su entrada de dos pasos la reemplazó el #771; por qué va en aceptaciones_terminos
metadata:
  type: project
---

**PR #769** (`feat/valida-api-aceptar-terminos`). ⚠️ CADUCÓ el «sin mergear / sin aplicar»:
medido el 2026-09-16 por PostgREST, está en `main` (`383f5d07`) y `aceptaciones_terminos` ya
tiene `usuario_id`, `workspace_cliente_id` y `documento_version_id`. Su pantalla de dos pasos
(Política, luego términos solo para el dueño) la reemplazó el **#771** con una entrada única
([[entrada-unica-valida-api]]); la fila contractual y el trigger de la base siguen iguales.

**Estado que no se ve en el código:**
- 4D SOFT no ve el paso: su v1.0 está aceptada por WhatsApp (`def579c7`) y la RPC la devuelve con
  fecha. Mergear antes de aplicar NO le rompe nada (la puerta de llaves solo lee la RPC vieja); lo
  que falla sin migración es una aceptación nueva desde el módulo (columnas ausentes).
- La constancia va a `aceptaciones_terminos` con `canal='modulo'`, no a `documentos_aceptaciones_usuario`
  (esa es la Política por usuario). `mis_documentos_de_servicio` la muestra sin cambios porque ya
  derivaba el canal de `prompt_wamid` nulo.
- Revocar llaves NO exige términos (quita acceso). Sin documentos vigentes registrados, no hay llaves.

**Why:** cláusula 3.1 (credenciales solo tras la aceptación) y el trigger de la base vuelve a
exigir owner no platform_admin, versión vigente exacta, contrato de esa empresa que cubra al espacio,
no duplicado por ningún canal, y pone él `respondido_at` y la huella.

**How to apply:**
- ⚠️ `sha256(convert_to(...))` NO sirve en una columna generada: `convert_to` es STABLE en PG (medido
  en PGlite 0.5.8). `x::bytea` tampoco: pasa por `byteain` y revienta con `\x`. Se calcula en trigger.
- En PGlite, un BEFORE trigger corre ANTES de los CHECK: un test que espera el error del CHECK puede
  recibir el del trigger. Armar el caso para que el trigger pase.
- Mutaciones vistas caer: quitar la puerta en leer/generar llaves (2), y owner/soporte/duplicado en
  la función SQL (3). El índice único parcial atrapa el duplicado aunque falle el chequeo del trigger.

Relacionado: [[modulo-valida-api-c2]], [[aceptacion-terminos-wa]], [[modulos-gate-ruta-a1]],
[[pglite-version-de-ci]], [[pruebas-por-mutacion]].
