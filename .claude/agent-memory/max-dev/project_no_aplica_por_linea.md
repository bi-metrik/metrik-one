---
name: no-aplica-por-linea
description: Una línea puede declarar en qué casos NO aplica; la pantalla muda por `condition` es lo que empuja a mentirle al formulario — avisa, no cierra, y SOENA lo tiene sin aplicar
metadata:
  type: project
---

`lineas_negocio.config_extra.no_aplica` es una lista de reglas `{condition, titulo, mensaje, que_hacer}`. Si alguna se cumple, la ficha del negocio pinta un aviso ámbar que dice que el caso no aplica y qué hacer. Módulo puro `src/lib/negocios/no-aplica.ts` + panel `aviso-no-aplica.tsx`. PR de la sesión 2026-09-18.

**Why:** en la línea GIT EV/HEV todos los bloques de Documentación llevan `condition: tipo_persona = natural`. Marcar `juridica` —que es la respuesta correcta— hace que **los bloques simplemente no aparezcan**: el negocio se queda mudo en Propuesta sin nada que completar y sin nada que lo explique (V0261, V0320 y V0426 están así). Lo que hace un comercial delante de una pantalla vacía es volver atrás, marcar «natural» y cargar el papel que sí tiene: **la pantalla muda no es un problema de UX, es la causa del dato inventado de V0497/V0498**.

**How to apply:**

- ⚠️ **Avisa, NO cierra.** Cerrar un negocio tiene motivo, autor y consecuencias financieras, y la respuesta que dispara el aviso se corrige en un clic. Mismo criterio que el banner de reversa de ruta: propone, no ejecuta. El `que_hacer` es obligatorio en la práctica — un aviso que solo diagnostica deja al operador igual de atascado que la pantalla vacía.
- ⚠️ **La condición la resuelve `condicion_cumplida`, nunca una lectura propia en TypeScript.** Si la pantalla juzgara por su cuenta podría decir «no aplica» sobre un caso al que el motor sí le está pidiendo documentos. El evaluador entra por parámetro, igual que en `camposDeRouting`.
- **Se devuelve la PRIMERA regla que se cumple**, no todas: dos avisos compiten por la misma atención. El orden del arreglo es la precedencia y lo decide quien configura.
- Un evaluador que revienta **no inventa un «no aplica»**: devuelve `null` y calla.
- Va en la **línea** y no en la etapa: «no aplica» es propiedad del caso completo.

⚠️ **SOENA lo tiene SIN APLICAR** (`sql/soena/2026-09-18_documento-esperado-rut-y-no-aplica-juridica.sql`, el mismo archivo del documento esperado). Sin esa clave ninguna línea cambia.

Relacionado: [[documento-esperado-bloque]], [[casillas-gate-faltantes]].
