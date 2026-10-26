---
name: project-soe028-operadora-corrige-historial
description: SOE-028 (#1296) — el operator responsable no podía corregir documentos de etapas pasadas: el historial no pasaba _esResponsable; copias de solo lectura ahora siempre visibles
metadata:
  type: project
---

Camila (SOENA, operator de operaciones, responsable) no podía cambiar el RUT de Documentación con
el caso en Cargue. El servidor (guardEditarBloque + areas_editoras + responsable) SIEMPRE la dejó: el
corte era de pantalla. `HistorialEtapasPrevias` pintaba los bloques sin `_esResponsable`, y
`BloqueDocumento.puedeCorregirVisible` es `puedeCorregirDocumentos(rol) || esResponsable`.
PR #1296 (26-oct, sin migración) pasa el flag al historial, fuerza en visible las copias de documento
de solo lectura y les pone un aviso con `_origenEtapaNombre`.

**Why:** a SOENA le dijeron que «le faltaba ser responsable», y no era cierto: un operator que no
es responsable ni siquiera ve el caso (`getNegocios` filtra por negocio_responsables).
**How to apply:**
- Si alguien «no tiene permiso» en un bloque del historial, mira primero qué flags le llegan al bloque
  (`_esResponsable`, `_areaReadonly`, `_forceReadOnly`) antes de culpar a la configuración.
- Una copia (`source_etapa_orden`) NO hereda las `areas_editoras` del original. Para las copias que
  escriben en el origen (editable_siempre / compartido_con_origen), el guard usa el stage de la copia
  y sus propias `areas_editoras`.
- `actualizarCampoDocumento` no exige el opt-in `corregir_campos_gerencial` después de avanzar
  de etapa; `procesarDocumento` sí lo exige. Solo la pantalla lo esconde.
- Prueba DOM de la ficha: `corregir-documento-operator-dom.test.ts`. Necesita `self` e
  IntersectionObserver por next/link; los bloques entran con next/dynamic, así que hay que esperar
  por condición, y una tarjeta completa de la etapa llega plegada.
