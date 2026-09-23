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
sale como BORRADOR** (PR siguiente, `feat/trappvel-pdf-borrador-marca-agua`): marca
`ponerMarcaDeBorrador(pdf, 'pantallazos')` sobre los bytes (cubre @react-pdf y el servicio
externo sin tocar la plantilla), sin guardar ni registrar la salida. Única vía del PDF:
`generateCotizacionPDF` (botón «PDF» del editor); no hay correo, bot, link público ni cron que lo
mande. No frena: aprobar una `enviada`, ni nada sin `tarifa_pax` (`hayTarifaPorPasajero`: ni lee
el viaje). Los borradores por IVA reusan la marca «margen bajo el mínimo»: texto equivocado,
no corregido. Si no puede leer
líneas o pasajeros, FRENA. El bloque `BloqueCotizacion` no deshabilita sus botones: solo el
servidor lo frena y el toast trae el motivo. Instrumento de R6 en la prueba: registrar los
SELECT por columnas (`negocio_bloques|adultos…`), no por tabla — aprobar también escribe en
`negocio_bloques`.

## Queda para Mauricio

Editar adicionales ya creados, y las tarjetas de hotel viejas sin ocupación que no se pueden
marcar.

Relacionado: [[tarifa-por-pasajero]], [[orden-bloque-item-trappvel]], [[pruebas-por-mutacion]].
