---
name: reprueba-bloqueo-1030
description: Trappvel reprueba del bloqueo (30-oct, arreglada 3-nov) — paquete en $0 cuenta como sin costo en Armar/Sigue; PDF de 2+ paquetes con acomodación y tarjetas «Solo en <versión>»; revierte una aserción del #1352
metadata:
  type: project
---

Rama fix/bloqueo-opcion-cero-y-pdf-por-version, sin migración. Lo no obvio:

- **$0 en Armar/Sigue**: `sinCosto` de `loQueSuma` solo miraba la opción de la Recomendada. Nuevo
  `RenglonQueSuma.opcionSinCosto` (solo `tipo === 'paquete'` e `incluido`): otra opción en $0 que va al cliente
  (con tarifas, las que van; sin tarifas, todas, como `paquetesIncompletos`). `sinCostoDelViaje` (puro) arma la lista
  que antes vivía en `vista-por-pasos.tsx`. Hoteles/vuelos con alternativa en $0 en otra tarifa NO se tocaron.
  Un paquete nunca es legítimo en $0 (`faltasDelPaquete` lo frena siempre); cortesías van por estado opcional/no.
- **PDF**: `HotelPDF.paquete` marca el hotel de un paquete (con su `noIncluye` de pantalla); `OpcionHotelDoc.acomodacion`
  y `precio.porVersion` SOLO con 2+ versiones (formato de Edgar de un paquete intacto). El texto «No incluye» igual en
  todas las versiones va una vez a `precio.noIncluye`. `viaje.noIncluye` (noIncluyeDePaquetes) sigue sin leerlo el
  modelo html: con UN paquete el «No incluye» de pantalla no sale en el html.
- Esto **revierte** la aserción del #1352 «Qué incluye no menciona Traslados»: ahora lo de una versión sale en su
  tarjeta «Solo en». Se repite con lo de la tarjeta del hotel (decisión del brief de Mauricio).
- Medido con Chromium: 2 versiones siguen en 2 hojas (CASO_QA_1359 y CASO_REPRUEBA_BLOQUEO).

**How to apply:** si Edgar pide acomodación con un solo paquete, quitar la guarda `porTarifas` en `opcionSinNoIncluye`.
Relacionado: [[defectos-qa-1359]], [[qa-corta-1352]].
