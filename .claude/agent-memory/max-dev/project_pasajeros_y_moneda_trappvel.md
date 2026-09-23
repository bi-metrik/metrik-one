---
name: pasajeros-y-moneda-trappvel
description: "#825: una captura de otros pasajeros se MARCA (no se borra ni se divide) y la moneda de cada bloque es editable; RX3 ya no rechaza en casillas; el hueco era la línea que HEREDA los pasajeros del viaje"
metadata:
  type: project
---

**PR [#825](https://github.com/bi-metrik/metrik-one/pull/825)** — brief
`proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-pasajeros-y-moneda.md`, QA en
`proyectos/trappvel/clarity/qa/2026-09-22_pasajeros-y-moneda/`. **Sin migración y sin escrituras
a producción** (todo en `items.tarifa_pax`). Sigue a [[tarifa-por-pasajero]] y
[[orden-bloque-item-trappvel]] (#802), y usa el patrón de correcciones de #821.

## ⚠️⚠️ El hueco era la línea que HEREDA, no la que tiene composición propia

Captura para 2 adultos leída con la línea heredando del viaje (#802 solo FIJA la composición
cuando la captura difiere del viaje). Si el viaje pasa a 3, `resolverTarifa` («solo adultos»)
dividía entre 3 y confirmar escribía **Adulto × 3 a $666.666,67** sin aviso. Test del hueco
visto rojo antes del arreglo.

**How to apply:** el control vive DENTRO de `resolverTarifa` (estado `desactualizada`), no en
quien llama: es el único sitio donde un precio se divide entre pasajeros. Cada casilla guarda
`paraComposicion`; la comparación es **casilla por casilla** (de 1 a 2 infantes no invalida
«solo adultos»). Sin `paraComposicion` se usa `composicionDeLectura`; sin eso, no se marca.
⚠️ Responder «a cuántos cubre» una captura sin ocupación la ANOTA (`actualizarComposicionDeItem`
con composición anterior nula): sin eso un cambio posterior no tendría contra qué compararse.

## ⚠️ Cambiar pasajeros ya NO borra casillas ni confirmación

CADUCA lo que decían #763/#802. La confirmación vieja se queda (rubros intactos) y
`confirmacionDesactualizada` la marca por composición o por moneda: el reparto por pasajero no
se muestra (editor) ni se imprime (`precioPorPasajeroDeItem`). Las casillas viejas se excluyen
de CC1/CC2 al leer una nueva (`casillasVigentes`): si no, una vieja rechazaría una buena.

## La moneda

- `evaluarLectura` con `monedaSiFalta` → COP `supuesto` en vez de RX3. Solo lo pide el cargue
  por casillas (tiene el freno); el legacy sigue rechazando.
- `tarifa_pax.moneda` = decisión de la persona (quién/cuándo). **Un pantallazo 1 nuevo la
  retira** (otra búsqueda); las casillas 2 y 3 la heredan. `monedaDeTarifa` es la fuente única.
- Costo a mano en otra moneda: `subtotal` en pesos + `tarifa_pax.costoManual`, vigente solo si
  `round(valor × tasa) === subtotal`. Rubros siguen solo COP.

## ⚠️ El envío SÍ se frena desde el PR siguiente (feat/trappvel-bloquear-envio-desactualizado)

Mauricio decidió (2026-09-22) cerrar la pendiente #1: con una línea desactualizada la cotización
**no sale de borrador**. Freno en el servidor, `captura-desactualizada-datos.ts`
(`motivoPorCapturasDesactualizadas`), en las CUATRO puertas: `enviarCotizacion`,
`enviarCotizacionNegocio`, `aceptarCotizacionNegocio` (solo si está en borrador: `skip_enviar`
salta el envío) y `updateCotizacion({ estado })`. Va ANTES de `motivoParaNoSalir` (margen).

**Why:** #824 (piso de margen) ya había creado un control de salida; mi reporte del #825 decía
«no existe control de envío» sin haberlo visto — verificar contra `origin/main` antes de afirmar
que algo no existe.

**How to apply:** el texto sale de `motivoParaNoEnviar` (puro) y es el mismo en el botón del
editor, en el rechazo y en el aviso del PDF; no reescribir la regla en otra parte. **El PDF
sale como BORRADOR** (#835): marca `ponerMarcaDeBorrador(pdf, motivos)` sobre los bytes (cubre
@react-pdf y el servicio externo sin tocar la plantilla), sin guardar ni registrar la salida.
Única vía del PDF: `generateCotizacionPDF` (botón «PDF» del editor); no hay correo, bot, link
público ni cron que lo mande. No frena: aprobar una `enviada`, ni nada sin `tarifa_pax`
(`hayTarifaPorPasajero`: ni lee el viaje). Si no puede leer
líneas o pasajeros, FRENA. El bloque `BloqueCotizacion` no deshabilita sus botones: solo el
servidor lo frena y el toast trae el motivo. Instrumento de R6 en la prueba: registrar los
SELECT por columnas (`negocio_bloques|adultos…`), no por tabla — aprobar también escribe en
`negocio_bloques`.

## La marca dice el motivo REAL (fix/pdf-borrador-motivo-real, 2026-09-23)

Hasta #835 los borradores por IVA (sin calcular, o incluido sin plantilla) salían con la marca
«margen bajo el mínimo»: `ponerMarcaDeBorrador` tenía `'margen'` por defecto y el PDF solo
distinguía pantallazos. Ahora **una sola fuente**, `src/lib/cotizaciones/motivos-borrador.ts`
(puro, sin pdf-lib, lo importan componentes de cliente), nombra los cuatro motivos y arma la
línea de la marca, el aviso del PDF y las etiquetas de los avisos del editor y del panel de
margen. Dos motivos se escriben enteros; tres o más, el principal y «y N más».

**Why:** un parámetro con valor por defecto en algo que habla con el usuario acaba diciendo el
valor por defecto: por eso la lista de motivos ahora es obligatoria (un borrador sin motivos
lanza).

**How to apply:** un motivo de borrador nuevo se agrega en `motivos-borrador.ts` (tipo, orden y
etiqueta) y se pasa como condición; el módulo NO decide cuándo es borrador. La prueba de las 16
combinaciones fija que «hay motivos» es exactamente el OR de las condiciones: agregar una
condición exige ampliarla. La marca de un solo motivo conserva la geometría (0,55 de la
diagonal); con dos o más, 0,7.

## Queda para Mauricio

Editar adicionales ya creados, y las tarjetas de hotel viejas sin ocupación que no se pueden
marcar.

Relacionado: [[tarifa-por-pasajero]], [[orden-bloque-item-trappvel]], [[pruebas-por-mutacion]].
