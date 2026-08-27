# Cargar la factura que ya existía, sin volver a facturar

Fecha: 2026-08-27. Pedido de Mauricio: *"hay negocios cuya factura ya estaba hecha antes
de que empezara la facturación desde MéTRIK; necesito poder cargar en el bloque de
factura emitida el PDF que descargamos de Siigo"*.

## Lo que estaba pasando

Dos cosas distintas, y ninguna se veía desde la pantalla.

**1. El bloque solo recibía archivo en su etapa nativa.** "Factura emitida" es editable
en Cargue (orden 7) y se repite como copia `estado = 'visible'` — solo lectura — en las
12 etapas siguientes. Un caso en Cita o en Seguimiento muestra el bloque y no lo deja
recibir nada. La única salida que quedaba era emitir una segunda factura por lo mismo.

**2. Cargarla a mano no contaba como facturado en ninguna parte.** La cola leía el bloque
por su slug, y el slug lo tiene solo la configuración nativa: cada copia guarda en su
PROPIA fila de `negocio_bloques`. Medido: de 272 negocios sin marca que ya pasaron de
Cargue, **240 ni siquiera tienen fila en la nativa**. Y el guard de emisión
(`emitirFacturaNegocio`) ni miraba el bloque: se apoyaba solo en
`metadata.siigo_factura`, que existe únicamente cuando la factura salió DESDE ONE. Medido
el mismo día: de 13 facturas cargadas en el bloque, **2 no tienen marca**, o sea dos casos
a un clic de radicar ante la DIAN una segunda factura por lo mismo.

## Lo que se cambió

| Pieza | Qué hace |
|---|---|
| `editable_siempre` en las 13 configuraciones de "Factura emitida" | El bloque recibe el PDF desde la etapa donde esté el caso, no solo en Cargue. Migración `20260827000004`. |
| `getBloqueMode` — el flag ahora cubre `documento` | Ya cubría `formulario` (010/1668). Un documento que aparece después de su etapa es el mismo problema. Gate de rol sin cambios: supervisor+. |
| `idsDeCopiasDelBloque` (nuevo) | Resuelve la nativa y todas sus copias en la línea: mismo `nombre`, sin slug. |
| Cola de facturación | Lee las copias, no solo la nativa. Un caso con su factura cargada sale de la cola. |
| Barrera de emisión | Una factura cargada en cualquier copia bloquea emitir, igual que la marca. |

## Por qué el bloqueo va en la emisión y no solo en la cola

Esconder el botón no es cerrar la puerta. Emitir es irreversible: la factura queda
radicada ante la DIAN y el consecutivo se pierde. La barrera va donde ocurre el hecho.

## Lo que NO se cambió, a propósito

- **No se escribe `metadata.siigo_factura` al cargar a mano.** Esa marca dice "salió de
  Siigo por ONE" y trae `siigo_id`; inventarla para un PDF cargado a mano haría que
  cualquier consumidor futuro creyera que hay un documento de Siigo detrás. El bloque es
  la fuente de verdad de "hay factura cargada", y ahora los dos consumidores lo leen bien.
- **Las copias siguen siendo de solo lectura para todo lo demás.** El flag es explícito
  por bloque: no abre ningún otro documento heredado.

## Pendiente que este cambio deja a la vista

`facturas.ts:265` y `recibos.ts:161` fechan con UTC en vez de `todayBogotaISO()`: emitir
después de las 7 p.m. hora Colombia fecha el documento al día siguiente. Ya pasó con
FV-2-237 (V0323). No se tocó aquí para no mezclarlo con esto.
