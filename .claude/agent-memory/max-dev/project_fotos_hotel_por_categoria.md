---
name: fotos-hotel-por-categoria
description: REEMPLAZADA por fotos-perfiles (2026-10-16): Selector de fotos de HOTEL por pestañas Fachada/Habitaciones/Zonas comunes (feat/fotos-hotel-por-categoria, 2026-10-16) — migración 20261016221500 SIN aplicar y va ANTES del merge; la categoría exacta de Commons trae fotos que no son del hotel
metadata:
  type: project
---

Pedido de Mauricio (2026-10-16): Commons traía fotos que no eran del hotel. Rama `feat/fotos-hotel-por-categoria`.

- ⚠️ Migración `20261016221500_fotos_catalogo_categoria.sql` (columna `categoria` nullable + CHECK) SIN aplicar, y
  `COLUMNAS` de `catalogo.ts` ya la lee: sin ella la biblioteca dice «falta la migración» y el PDF sale sin fotos de
  biblioteca. Aplicar ANTES del merge. Dry-run/reversa en `sql/fotos/` (probados en PGlite, `categoria-sql.test.ts`).
- Medido en Commons vivo: `Category:Pullman Paris Tour Eiffel` contiene «The Eiffel Tower» y «Summit @ Eiffel
  Tower». La categoría exacta NO basta: lo que no nombra el hotel solo pasa con el modelo diciendo «es hotel».
  «Gran Hotel Inglés» encontraba «RIU hotel, Playa del Inglés, Gran Canaria»: por eso otra marca en el título = fuera.
- Filtro de nombre en `nombre-hotel.ts`. El reparto «una por categoría» (`puestoParaCategoria`) se BORRÓ en
  [[galeria-fotos-hotel]]: ahora se marcan hasta 3 de cualquier categoría.
- Clasificador `src/lib/ai/clasificar-fotos-hotel.ts` (gemini-2.5-flash, de a 12). NUNCA se probó con el modelo
  real (sin llave de QA; la de prod gasta cuota). Sin llave: solo «sin clasificar» de títulos que nombran el hotel.
- Las candidatas se recuerdan en memoria del servidor (no hay tabla); las filas viejas sin categoría se clasifican
  al abrir el selector (`fotosDelHotel`) y se anota la categoría en la fila (escritura de la app, no mía).
- Las miniaturas de Commons traen paréntesis literales: `url(...)` sin comillas las dejaba vacías
  (`fondoDeMiniatura`).

**How to apply:** antes de tocar el selector de hotel, leer `opciones-hotel.ts`. Si Mauricio reporta otra foto
equivocada, agregar su título a `nombre-hotel.test.ts` antes de ajustar listas. Relacionado: [[biblioteca-fotos]],
[[fotos-catalogo]].
