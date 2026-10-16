---
name: galeria-fotos-hotel
description: REEMPLAZADA por fotos-perfiles (2026-10-16): Galería de fotos del hotel tipo Booking + reglas de Emilio (feat/galeria-fotos-hotel, 2026-10-16) — migración 20261016233000 SIN aplicar y va ANTES del merge porque TODA escritura a fotos_catalogo la usa
metadata:
  type: project
---

Segunda entrega de [[fotos-hotel-por-categoria]] (#1199). Rama `feat/galeria-fotos-hotel`.

- ⚠️⚠️ Migración `20261016233000_fotos_catalogo_autorizacion.sql` (`autorizada_por` → auth.users, `autorizada_at`,
  `procedencia`) SIN aplicar. `guardarFoto` escribe las 3 columnas SIEMPRE (NULL en Commons, para no heredar la
  autorización al reemplazar): sin la migración, guardar CUALQUIER foto (también Commons y la sugerencia de ciudad) da
  «falta aplicar la migración». Leer y el PDF NO dependen (no están en `COLUMNAS`).
- Selección libre hasta 3 (se borró `puestoParaCategoria`). Marcado = fila en la biblioteca; se empareja con la opción
  por `FotoVista.fuenteId` (titulo_fuente / imagen_url). Desmarcar = `quitarFotoDeBiblioteca` (borra el archivo).
- Autorización obligatoria en `ponerFotoPropia` (tipo exige `autorizacion: {userId, procedencia}`): 4 caminos de
  subida (galería, SelectorPorFuente, tarjeta del hotel, panel). El userId sale de `getWorkspace().userId`, nunca del
  navegador.
- OTAs: `src/lib/fotos/agencias.ts`. El escaneo de texto solo toma tokens que EMPIEZAN como enlace: «File:Booking.jpg»
  dentro de una URL de Commons daba falso positivo con un regex suelto.
- Bug real cerrado: @react-pdf imprimía la foto de hotel de la biblioteca SIN crédito de Commons (`fotoDelHotel` con
  `credito: null`). Ahora `HotelPDF.foto.credito`.
- Capturas: mini-app vite en `.galeria-tmp/` del worktree (SelectorHotel real, acciones inyectadas, `sonner` doblado),
  `python3 -m http.server`, chromium CLI. Pegar se simula con `ClipboardEvent` + `DataTransfer`; el crédito «al pasar
  el mouse» se muestra con `focus()` (`group-focus-within`). Radix enfoca la 1.ª pestaña al abrir: `onOpenAutoFocus`
  con preventDefault. Bash con `$VAR` en chrome lo bloquea el guardia: comandos sueltos.

**How to apply:** antes de aplicar en prod, correr el dry-run de `sql/fotos/2026-10-16_dry-run_fotos-catalogo-autorizacion.sql`
(debe decir «DRY-RUN OK»). Si se agrega otro camino de subida a la biblioteca, pasa por `revisarAutorizacion`.
