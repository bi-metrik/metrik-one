---
name: adicionales-por-variante
description: "#810 en producción — el adicional cuelga del ITEM, no del grupo; `precioLinea` sigue siendo BASE porque `recalcularTotales` lo escribe en `items.precio_venta` y la maleta se compondría; SQL de `item_adicionales` SIN aplicar"
metadata:
  type: project
---

**PR [#810](https://github.com/bi-metrik/metrik-one/pull/810)** mergeado el 2026-09-21
(squash `18f310fb`), 4 checks obligatorios verdes, **desplegado a producción** (commit
status en `success`). **Sin migración en el PR y sin una escritura a producción.**

Parte **1** de `proyectos/trappvel/clarity/docs/diseno/adicionales-y-ficha-por-ranura.md`.
La **parte 2** (ficha fija de campos por ranura) NO entra: espera la lista que confirma
Trappvel, y `campos` de `ranuras-pantallazo.ts` no se tocó.

## ⚠️⚠️ Cuelga de la VARIANTE (`items.id`), NUNCA del grupo

Una variante es **una fila de `items`**; la ranura es su `grupo`, o sea varias filas. Una
maleta extra en Avianca Basic no cuesta lo mismo que en LATAM: colgada de la **ranura**,
cambiar de aerolínea deja el adicional en pie con el precio de la otra y el total queda
**bien sumado y mal costeado** — no falla en ninguna parte y no se ve en pantalla.

El emparejamiento vive en **`adjuntarAdicionales`** (puro, `src/lib/cotizaciones/adicionales.ts`)
y no en línea dentro de `contextoDeCotizacion`, para poder **verlo fallar**. Mutado a
emparejar por `grupo`:

```
× LA PLATA de la tarifa que eligió LATAM no se mueve → expected 1370000 to be 1250000
```

⚠️ **Las otras tres pruebas del mismo `describe` siguieron VERDES con la mutación puesta**:
construyen los ítems con sus adicionales ya colgados, así que miden la cascada dada una
atadura correcta. Lo único que separa el modelo bueno del malo es **medir la variante que
NO debe subir**. Hermano exacto de [[ranuras-multiples-tres-tarifas]] («los dos vuelos
suman EN PLATA» pasaba con la resolución mutada).

## ⚠️⚠️ `precioLinea` se queda en BASE, y el total va en `precioConAdicionales`

No es prolijidad. `recalcularTotales` escribe `items.precio_venta = precioLinea / cantidad`:
con la maleta adentro se volvería **precio base de la línea** y el recálculo siguiente la
sumaría otra vez encima — un error que **se compone solo**.

`LineaCalculada` gana tres campos (`costoAdicionales`, `precioAdicionales`,
`precioConAdicionales`). Los **agregados** de `Cascada` sí los incluyen, así que el total de
la cotización, el de cada tarifa, el gate del piso y el registro salen bien sin que ninguno
lo sepa. Quien necesita el total lo pide por nombre:

| Consumidor | Campo | Por qué |
|---|---|---|
| `recalcularTotales` → `items.precio_venta` | `precioLinea` | si no, se compone |
| `sumaRegulares` del ítem de cuadre | `precioConAdicionales` | el cuadre absorbería la maleta |
| `registro-decisiones` → `precioDe` | `precioConAdicionales` | *«el precio que se le mostró al cliente»* |
| editor: precio objetivo, split por pasajero | `precioLinea` / `costoDeVentaLinea` | miden el margen comercial de la línea |

⚠️ **El AIU se calcula sobre el costo BASE** (`costoBaseDeAdministrativos`): el precio del
adicional está DADO, no derivado, y meterlo a la base del AIU le movería el margen sin
moverle el precio. La invariante cierra con un término más:
`Σ costoDeVentaLinea + Σ costoAdicionales === costoDeVenta` (hay prueba con AIU 12%).

## Las decisiones de forma, y por qué

- **cantidad nace en 1.** Seis maletas para seis adultos es 6 — así no hay que decidir de
  antemano si un adicional es «por pasajero» o «por reserva».
- **Lista corta Y ADEMÁS texto libre** (`TIPOS_ADICIONAL`), mismo patrón que
  `motivo-combinacion.ts`. Código fuera del catálogo se descarta; **el texto sobrevive**.
  El CHECK de la base NO enumera los códigos: la lista se corrige con lo que aparezca.
- **Moneda: sin tasa se RECHAZA al guardar.** Guardarlo aportaría cero al total mientras se
  imprime como incluido — plata regalada en silencio. Si una fila así llega por SQL, aporta
  cero y **se declara con nombre** (`sinConvertir`), en rojo.
- **`origen` (`manual`|`pantallazo`) existe y la acción NO acepta el parámetro**: hoy es
  `'manual'` por construcción. Misma regla que `armarFilasDeRegistro` — un valor que se
  puede pasar por parámetro se pasa, y el día que se mida se estaría midiendo a quien llamó.

## ⚠️ SQL PENDIENTE, y va DESPUÉS del deploy

`proyectos/trappvel/clarity/migrations/2026-09-21_adicionales-PENDIENTE.sql` — **sin
aplicar**. Tabla `item_adicionales`, DDL puro y aditivo. RLS por workspace validado **por
join contra `items → cotizaciones`**, sin `workspace_id` propio (patrón de
`itinerario_opciones`: una columna propia abriría la puerta a que un adicional diga un
workspace y su línea diga otro). `grant` a `authenticated`, como `items`.

Leer tolera (`faltaLaTablaDeAdicionales`) y la pantalla **no ofrece el control**; escribir
falla con su frase. Asimetría de `tolerar-itinerarios.ts`.

## El aviso de cobertura NO los mira, y la ceguera es de FORMA

La cobertura se lee de `items.tarifa_pax.casillas[*].identidad` y el adicional vive en otra
tabla: `cobertura-opciones.ts` **no se tocó**. Dos pruebas lo fijan, una **por el TIPO** de
entrada — una ausencia no se puede comprobar por el valor.

## El documento del cliente

Sale **dentro de la ficha del vuelo** (y del hotel) como un `Dato` «Adicionales», en los
**tres** niveles de detalle (es plata que el cliente paga), y su valor entra en el total de
SU línea de «Inversión» con un «Incluye: …» debajo del nombre. Sin cifra propia: el dinero
del documento se imprime una vez. Medido **sobre el binario del PDF**; quitando el sumando:
`→ expected '…' to contain '1.534.351'`.

⚠️ **Las TRES plantillas** (`trappvel`, `termotech`, genérica) suman `valorAdicionales ?? 0`,
aunque solo Trappvel los reciba: un documento que no cuadra consigo mismo es el modo de
fallo que este repo ya pagó.

## Dos trampas de prueba que costaron una corrección cada una

- **`ItemDeCotizacion.adicionales` es REQUERIDO.** Opcional se omite y el dinero desaparece
  en silencio — es literalmente lo que documenta `ItemConGrupo.dia_relativo`. Costó tocar 4
  fixtures.
- **Tres dobles de Supabase no tenían `.in()`**, y el que existía filtraba por el PRIMER
  valor. Se implementó pertenencia de verdad: con el primer id, los adicionales de las demás
  líneas quedarían fuera del total **sin que nada fallara**.
- ⚠️ Una prueba de render que afirmaba el precio de la fila **pasó con la mutación** «olvidar
  la cantidad», porque la cifra multiplicada salía igual en el total de la sección. Hubo que
  agregar `not.toContain` del unitario. [[pruebas-por-mutacion]] otra vez.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Catálogo, normalización, totales, **`adjuntarAdicionales`** | `src/lib/cotizaciones/adicionales.ts` |
| La suma en la cascada | `src/lib/cotizaciones/totales.ts` |
| Lectura tolerante (`leerAdicionalesDeItems`) | `src/lib/cotizaciones/itinerarios-datos.ts` |
| Escribir, corregir, borrar | `src/app/(app)/negocios/adicional-actions.ts` |
| La sección dentro del ítem | `src/app/(app)/negocios/adicionales-item.tsx` |
| Dentro del vuelo, en el PDF | `src/lib/pdf/cotizacion-trappvel-pdf.tsx`, `detalle-viaje.ts` |

## Queda abierto

- **La parte 2** (ficha fija por ranura): necesita la lista de §2.5 confirmada por Alejandra
  y Daniela. Los tres huecos ya están escritos en el diseño (obligatorio ≠ `min`, faltan
  hora de salida/llegada y estrellas, y un campo leído con poca confianza entra como cierto).
- **El lector de pantallazo no extrae adicionales todavía**: `origen` siempre `'manual'`.

Relacionado: [[ranuras-multiples-tres-tarifas]], [[registro-decisiones-combinacion]],
[[cobertura-opciones-cotizacion]], [[documento-cliente-trappvel]], [[tarifa-por-pasajero]],
[[pruebas-por-mutacion]].
