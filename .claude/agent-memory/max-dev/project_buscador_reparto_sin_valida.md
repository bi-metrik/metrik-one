---
name: buscador-reparto-sin-valida
description: #877 (mergeado 2026-09-23): "Corregir el reparto" busca negocios con su propia action; el escape de .or() no se probó contra PostgREST vivo
metadata:
  type: project
---

El modal de reparto (`conciliacion/redistribuir-modal.tsx`) usa `buscarNegociosParaReparto`
(acceso `ctxFinanciero`) y ya no `buscarNegociosParaValida`, que exige módulo Valida y dejaba
el campo mudo en Soena. El único uso restante de la de Valida está en `valida/valida-client.tsx`.

⚠️ El escape del término para `.or()` (`src/lib/cobros/busqueda-negocio.ts`: valor entre
comillas de PostgREST + `\%`/`\_` de LIKE) solo tiene pruebas unitarias. La prueba de solo
lectura contra producción la bloqueó el clasificador ([Production Reads]).

**Why:** si PostgREST no desescapa `\\` dentro de comillas como se asume, una búsqueda con
`%` o `_` devolvería nada, sin error.
**How to apply:** si reportan que buscar «10%» o un nombre con guion bajo no encuentra, mirar
primero ese módulo. `redistribuirReferencia` ahora devuelve `sinCambios`.
