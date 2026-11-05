---
name: foto-hotel-paquete-bloqueo
description: Foto del hotel del paquete de bloqueo (5-nov): llave «hotel|» sin ciudad en tarjeta y documento; destino resuelve alias; proveedor_id del paquete = operador
metadata:
  type: project
---

El paquete de bloqueo no tenía control de foto (5-nov-2026, Trappvel). Se agregó `FotoDelHotelDelPaquete`
(`por-pasos/foto-hotel-paquete.tsx`) que reusa `FotoDeTarjeta` de hoja-cliente, la casilla de autorización y
`subirFotoABiblioteca`. Sin migración.

- La llave es `pedidoFotoDelPaquete` (bloqueo-documento.ts): nombre GUARDADO del hotel, `ciudad: null`,
  `aMano: false`, nunca `proveedorId`. El documento ya buscaba `«hotel x|»` (hotelesDePaquetes da ciudad null por V6).
- El mismo hotel cotizado suelto en el destino: `FotosEnTarjetas destino` hace que `reconocer` guarde
  `«hotel x|»` como alias del perfil `«hotel x|ciudad»`; el PDF lo lee por `fotos_catalogo_por_clave`.
- `items.proveedor_id` del paquete es la ficha del OPERADOR (tipo `proveedor` en la base). Las fichas de hotel
  del PDF solo salen de `hotelesDeItems`; NO cambiar ese loop a `hotelesDoc` (la prueba e2e lo caza).
- Sin «No es este» en el paquete (noEsEsteProveedor toca proveedor_id = operador).

**Why:** Mauricio: «no permite agregar fotos a los hoteles de los paquetes».
**How to apply:** si se cambia la ciudad del hotel del paquete en el documento, cambiar `pedidoFotoDelPaquete` a la vez
o las fotos subidas quedan huérfanas. Pruebas: foto-hotel-paquete-dom/pdf-e2e.
