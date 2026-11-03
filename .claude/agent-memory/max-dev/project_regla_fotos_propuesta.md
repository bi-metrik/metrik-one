---
name: regla-fotos-propuesta
description: Regla de fotos Trappvel (29-oct): #1357 casillas iguales + paneles (díptico) + alto común 17 %; #1358 portada con crédito, respaldo = collage de main; #1365 Recomendada = precio medio; foto Curazao SIN cargar
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-29-regla-fotos-propuesta.md` + decisión en
`proyectos/trappvel/clarity/decisions.md` (29-oct). QA en `proyectos/trappvel/clarity/qa/2026-10-29_regla-fotos/`.
#1339 cerrado (lo reemplazan estos dos).

- **#1357 fichas**: `src/lib/fotos/forma.ts` (0,75–2,1; frena al subir SOLO hotel; orden fachada → sin
  categoría → habitación → zonas comunes → otra; la piscina vive en zonas_comunes) y
  `src/lib/pdf/html/trappvel/fotos-ficha.ts`: fotos buenas lado a lado, hasta 3, del mismo tamaño; alto POR
  FICHA (el más bajo dentro del 15 %); las filas emparejan fichas de la misma ciudad que admiten un alto común.
  Mauricio corrigió DOS veces el 29-oct: (1) «1 ancha · 2 iguales · grande+2» con alto común; (2) grande+2 con
  relleno rosa; (3, final) lado a lado iguales, nunca recuadro vacío ni relleno. Hotel sin fotos = sin recuadro.
  Aviso «Al X le faltan N fotos…» viaja en la cabecera `x-avisos-fotos` de `/vista-previa`; `DocumentoEnRevisar`
  ahora pide el PDF con fetch y lo muestra por `blob:`.
- **#1358 portada**: una sola imagen (`portada.foto`: banco curado o ciudad de biblioteca con origen asesora o
  revisada), rótulo «Imagen ilustrativa», sin imagen = banda con el degradado de Trappvel. Nunca hotel.
- **Pide migración (no hecha)**: biblioteca por destino con imágenes generadas (tipo 'destino', origen
  'generada', modelo/instrucción/fecha/aprobador). DDL propuesto en el cuerpo de #1358. Punto 3 solo escrito.
- **Hoja 1 a medias en la COT-0008 (abierto)**: quedan ~79 mm; título + fila Kunuku/Dreams (foto sola ~60 mm)
  piden ~108. Traslados (~35 mm) no llena: no se movió.
- La marca «margen bajo el mínimo» (antes «falta la comisión de una tarifa Pública») es por datos de prod: sale
  igual con código viejo (8ade0d9b) sobre la base de hoy. Prod ya tiene la Intermedia aplicada (29-oct tarde).

**Why:** Mauricio: «no pueden salir todas así» (Kunuku tríptico) y «en los hoteles sí necesitamos ver el collage».
**How to apply:** antes de tocar fichas o portada, leer `fotos-ficha.ts`; los tests cuentan casillas por clase
(`img fila n2|n3`, `class="img" style="height:`). En la receta de solo lectura, la RPC `autorizacion_datos_estado` (STABLE) se
puede dejar pasar por POST para que la marca refleje prod. Ver [[reproducir-pdf-real-solo-lectura]],
[[cot0008-ajustes-alejandra]], [[fotos-perfiles]].

**Estado final (29-oct noche, PDF aprobado por Mauricio):**
- #1357: casillas iguales lado a lado; una foto de PANELES iguales (`src/lib/fotos/paneles.ts`, por píxeles:
  franja o corte de lado a lado en 1/2 o 1/3) ocupa tantas casillas como paneles. El «tríptico» del Kunuku es
  un DÍPTICO (2×1,39). Alto común del documento si lo hay (el que menos recorta), si no por filas; tope 17 %.
- #1358: crédito «Foto: autor · licencia» en la portada; sin imagen aprobada vuelve el collage de main (la
  banda de colores es «grave»). El catálogo pide también las partes de «Willemstad / Curacao» y el destino
  (`ciudadesDelViaje`): desde #1363 la parada es «Curacao».
- #1365 (`feat/trappvel-recomendada-precio-medio`): `repartoPorPrecio` cruza Rec (caro) ⇄ tercera (medio);
  «Intermedia» vuelve a «Premium» (el PDF dice «Superior», léxico vetado). COT-0008 se acomoda en la
  siguiente acción de Tarifas.
- Foto de Curazao SIN cargar: archivo + INSERT (clave `curacao`) en
  `proyectos/trappvel/clarity/qa/2026-10-29_regla-fotos/carga-foto-curazao/`.

