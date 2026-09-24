---
name: project-foto-hotel-y-fila-de-acciones
description: Trappvel 2026-09-24: #907 (Componentes no refrescaba al aceptar capturas: fila única de server actions de Next) y #910 (foto del hotel en «Así lo ve el cliente», reemplaza la foto de ciudad del capítulo)
metadata:
  type: project
---

**#907 (merge b9ed7c62).** En COT-2026-0016 Mauricio aceptaba capturas y «no veía los componentes». Se guardaban; el `router.refresh()` esperaba detrás de las lecturas de Gemini (8-25 s) porque Next pone server actions y refresh en UNA fila. Detectar/leer pasaron a rutas `/api/cotizaciones/[id]/{detectar,leer}-captura` (`bandeja-red.ts`); un contrato en `bandeja-red.test.ts` falla si la bandeja vuelve a importarlas como server action.

**Why:** cualquier server action larga en una página bloquea sus refrescos; el síntoma parece «no guardó».
**How to apply:** en pantallas que disparan lecturas LLM, llamar por route handler (fetch), nunca por server action.

**#910 (merge ecffe5e2).** Foto del hotel: `tarifa_pax.fotoHotel {ref, proporcion}`, bucket privado del workspace (`fotos-hotel/<cot>/<item>-<huella>.jpg`), comprimida en el navegador (1600 px, JPEG). En el PDF ocupa el lugar de la miniatura de ciudad del capítulo y la reemplaza (sin crédito); se quitó el hueco 80×60 dentro de `TarjetaHotel`. Se borra siempre con la opción, también al devolverla a la bandeja (`imagenesAlBorrarOpcion`).

**Límites no resueltos:** solo imprime la foto del hotel PRINCIPAL de cada capítulo (una alternativa de otra tarifa no la muestra); la portada sigue siendo la foto de ciudad; sin QA en pantalla ni PDF con foto real (solo pruebas de render de texto).

Relacionado: [[project-tarjeta-opcion-trappvel]], [[project-documento-trappvel-fotos-ritmo]].
