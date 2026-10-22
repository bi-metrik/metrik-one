---
name: novedades-tablero
description: Tablero «Novedades» de ONE (2026-10-21): archivo versionado, panel sin ruta, visto por ids en localStorage; y el 503 busqueda_incompleta de Valida se muestra como código crudo
metadata:
  type: project
---

Publicar una novedad = agregar una entrada a `src/lib/novedades/novedades.ts` y mergear. Sin tabla ni migración
(pedido explícito de Mauricio: "MUY sencillo de mantener"). El texto es de cara al cliente: ese PR NO se automergea,
pasa por revisión de Mauricio.

**Why:** Mauricio quiere publicar sin CMS ni base; el texto al cliente lo aprueba él.

- Es un PANEL (Dialog) abierto desde el menú lateral y la barra superior del teléfono, no una ruta: así no pasa por
  el gate del middleware ni por el encierro del contador en /revision.
- «Visto» = ids vistos en `localStorage` (llave por usuario), NO una fecha: con fecha, una entrada mergeada el mismo
  día de la última apertura o con fecha atrasada nunca contaba. Numerito solo para las de los últimos 60 días.
- `producto` es un `IdModulo`; 'valida' también aplica en modo vitrina. Sin novedades del producto, no hay entrada:
  al crearlo solo los espacios con Valida la ven.

**Hallazgo abierto (no arreglado en ese PR):** el 503 `busqueda_incompleta` de metrik-valida#66 llega a /valida como
`ErrorBox` con el código crudo «busqueda_incompleta» (`llamarValida` pasa `body.error` tal cual; no hay mapa de
mensajes), y se guarda una fila `severidad='error'` en `valida_consultas` aunque Valida no cobró. El lote reintenta
una vez el 5xx y luego deja la fila en error con el código. No sale como sin hallazgo (bien), pero no explica ni
invita a reintentar.

**How to apply:** al tocar Novedades, cero escrituras a base; al tocar los mensajes de error de Valida, este es el
pendiente.
