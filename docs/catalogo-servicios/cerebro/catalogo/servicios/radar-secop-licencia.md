---
tipo: servicio
slug: radar-secop-licencia
version: 1
nombre: Licencia Radar SECOP
modulo: radar_secop
disparador_cobro: ciclo
tratamiento_iva: excluido
tratamiento_iva_fuente: decisiones/2026-09-16_suscripciones-sin-iva-cloud-computing-excluido
precios_lista_fuente: decisiones/2026-09-28_pricing-radar-secop
descripcion: 'Acceso al módulo Radar SECOP de MéTRIK ONE — convocatorias vigentes de SECOP II cruzadas contra los temas del negocio, con puntaje de afinidad y seguimiento — por suscripción mensual.'
parametros:
  precio_mensual:         { tipo: cop, min: 1, por_defecto: 20000, descripcion: '$20.000 sin IVA al mes, precio de LISTA. Lo pactado con cada cliente va en los parámetros de su contrato.' }
  licencias:              { tipo: entero, min: 1, por_defecto: 2 }
  dia_cobro:              { tipo: entero, min: 1, max: 28, por_defecto: 10 }
  dias_trial:             { tipo: entero, min: 0, max: 90, por_defecto: 5, descripcion: 'Días de prueba contados desde la ACEPTACIÓN de los términos. Al vencer sin pago confirmado el módulo se cierra.' }
  modo_vitrina:           { tipo: booleano, por_defecto: false, descripcion: 'Falso a propósito: lo que no está contratado no se muestra. Ver el ancla de precio.' }
  aviso_vencimiento_dias: { tipo: entero, min: 1, por_defecto: 30 }
  reintentos:             { tipo: entero, min: 0, max: 5, por_defecto: 3 }
  ventana_reintentos_dias: { tipo: entero, min: 1, por_defecto: 7 }
  dias_gracia:            { tipo: entero, min: 0, por_defecto: 5 }
documentos: [terminos-adhesion-one@1.0, terminos-uso-radar@1.0, politica-datos-one@1.0]
---

# Licencia Radar SECOP

Un negocio que vende al Estado y necesita saber, cada mañana, qué convocatorias abiertas de
SECOP II se parecen a lo que él hace. El puntaje de afinidad («fit») ordena la lista; el
cliente decide a qué se presenta.

Spec: `proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md`. Primer cliente: Fabri
(I + D FABRIACRYLICOS S.A.S, NIT 900.013.323-5).

## El precio de lista es $20.000; el de Fabri no vive aquí

**$20.000 al mes, sin IVA** (suscripción de computación en la nube, excluida del art. 476 ET).
Fabri paga **$15.000** como descuento de fundador, con vigencia y contraprestación escritas en
su contrato (`reglas/pricing-cliente-promotor-descuento-documentado`). Ese descuento va en
`servicios_contratados.parametros.precio_mensual` del contrato de Fabri, **no en este archivo**:
el catálogo declara el precio de lista, y un precio distinto aquí lo volvería el precio de
todos.

## El trial son 5 días y su ancla es la aceptación de los términos

Decisión de Mauricio del 2026-09-28: **5 días**, contados desde el momento en que se aceptan
los términos en el módulo, no desde que se crea el espacio ni desde una fecha que alguien
digite. Al día 6 sin pago confirmado el módulo se cierra y lo único que queda a la vista es el
enlace de pago.

Riesgo medido y aceptado: hoy los temas `acrilico` y `vitrinas` marcan **0** sobre los 1.908
procesos abiertos del 2026-09-28, así que el trial puede vencer antes de que el Radar demuestre
valor, y con 5 días ese riesgo es mayor que con 15. **Por eso es parámetro y no constante:**
subirlo para un cliente es cambiar `dias_trial` en su contrato, con su fila en la bitácora.

## El ancla de precio, que no es un detalle de este archivo

La licencia Empresa de ONE son $100.000/mes y un usuario adicional $50.000
(`reglas/pricing-one`). El Radar a $20.000 es **una quinta parte** de la licencia. Mientras el
Radar sea un módulo suelto no hay conflicto; el día que el cliente vea `/numeros` en su propio
espacio, el número que va a recordar es el del Radar. De ahí `modo_vitrina: false`.

## Por qué no lleva política de datos propia

El Radar no procesa datos personales de terceros: el dato es público y de entidades (SECOP II,
dataset `p6dx-8zbt` de datos.gov.co). Valida sí necesita la suya porque consulta personas. Aquí
basta la política de ONE.

## ⚠️ Pendientes antes de publicar

1. `precios_lista_fuente` cita `decisiones/2026-09-28_pricing-radar-secop`, que **todavía no
   existe como archivo del cerebro**. La Action comprueba que el slug citado exista y falla si
   no: **Kaori tiene que capturar la decisión de pricing de ese día antes de publicar.**
2. `terminos-uso-radar@1.0` está en borrador
   (`proyectos/metrik/legal/borradores/2026-09-28_terminos-uso-radar-v1.md`) y lo revisa Emilio.
   La Action **no valida `documentos`**, así que este archivo publica aunque el documento sea un
   borrador; el freno real está en ONE: sin la fila del documento con su PDF y su `sha256`, el
   gate del módulo no se puede abrir. **Publicar la ficha no habilita cobrar.**
