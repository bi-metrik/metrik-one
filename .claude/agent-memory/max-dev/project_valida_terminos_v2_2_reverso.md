---
name: project-valida-terminos-v2-2-reverso
description: Términos Valida autoservicio v2.2 (11.3 reverso) en terminos-plan.ts; re-aceptación de la v2.1 NO construida y el flujo de aviso CDA no sirve tal cual
metadata:
  type: project
---

Desde el PR feat/valida-terminos-v2-2-reverso (2026-10-29) un registro NUEVO acepta los Términos autoservicio v2.2 (3.6 frase final, 11.2 «o por reversión del pago», 11.3 nueva). Sin SQL: la versión viaja en `valida_registros.terminos_version` y la fila de `documentos_contractuales_versiones` la crea la activación por suscripción.

**Why:** Mauricio aprobó el texto de Emilio el 2026-10-29; el corte por reverso ya corría desde #1322 para todos.

**How to apply:**
- Quien aceptó la v2.1 sigue con ella (13.1 autoservicio: «mientras no la acepte, rige la versión que aceptó»). Es lo OPUESTO de la 13.1 de los CDA («rige lo acepte o no»), y el flujo `rige_por_aviso` + `textosAvisoModificacion` dice la versión CDA: no reutilizarlo sin textos propios.
- Faltan para migrar a la v2.2: correo de aviso 30 días (el flujo CDA es solo plataforma), documento lleno por suscripción (Parte I propia + PDF), textos del aviso para autoservicio, prueba de aceptación canal plataforma sobre suscripción.
- Tensión legal abierta para Emilio: #1322 corta el plan por reverso también a clientes v2.1, cuyo 11.1 pide aviso previo.
- Copiar texto legal: script que compara el .md (título → fin) contra PARTE_I + separador + PARTE_II; daba «igual» antes y después. Ver [[project-valida-reverso-corta-plan]].
