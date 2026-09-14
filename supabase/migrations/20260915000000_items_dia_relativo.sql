-- El DIA de una linea de cotizacion, y el check de una sugerencia.
--
-- Decision de Mauricio del 2026-09-14: el itinerario dia por dia y el paquete de
-- tours sugeridos NO son dos cosas, son una sola lista de `items` con un solo
-- interruptor, el dia. Textual: «si es itinerario debe darme la opcion de poder
-- asignarle un dia dentro de las fechas del viaje. En caso de que no tenga fecha
-- asignada entra al paquete de sugerido.»
--
-- ⚠️ ESTA MIGRACION NO ESTA APLICADA. El PR que la acompana queda ABIERTO hasta que
-- Mauricio la autorice y se aplique. Sin la columna, las escrituras del dia fallan
-- con 42703 (ruidoso, que es lo correcto) y el producto se comporta exactamente como
-- hoy: toda lectura usa `select('*')`, asi que el campo llega `undefined` y eso
-- significa «sin dia».
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Que gana
-- ─────────────────────────────────────────────────────────────────────────────
--
--   · El itinerario dia por dia, que hoy no tiene donde colgarse: `items` no tiene
--     ninguna columna de dia ni de fecha (verificado el 2026-09-14 leyendo una fila
--     real: id, cotizacion_id, nombre, subtotal, orden, servicio_origen_id,
--     created_at, precio_venta, descuento_porcentaje, descripcion, es_ajuste,
--     cantidad, margen_porcentaje, precio_manual, grupo, opcion_de, unidad).
--   · El paquete «actividades adicionales no incluidas» al final de la cotizacion,
--     sin mantener una segunda lista.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Por que un ENTERO y no una fecha
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mauricio, textual: «dia relativo, que el itinerario se arma antes de fijar fechas».
-- En un circuito tipo Peru el itinerario se arma semanas antes de que la salida tenga
-- fecha. Una columna `date` obligaria a inventar una fecha o a dejar el campo vacio
-- justo cuando el dato se necesita para armar.
--
-- ⚠️ UN ENTERO ALCANZA, y se evaluo la alternativa: un tour de dos dias o un hotel de
-- tres noches «abarcan» varios dias. Se resuelve sin estructura nueva y sin ambiguedad:
--   · el hotel es COMBINABLE, no lleva dia nunca (su sitio lo decide el itinerario);
--   · un tour de dos dias se declara en el dia en que ARRANCA, que es como se lee un
--     itinerario («Dia 3 · Tour Machu Picchu, dos dias»), y la duracion ya tiene su
--     sitio en `items.descripcion`, que el PDF imprime.
-- Un rango (`dia_desde`/`dia_hasta`) agrega una segunda columna, un invariante nuevo
-- (`hasta >= desde`) y la pregunta de en que dia se imprime una linea que abarca tres.
-- Si algun dia hace falta, `dia_relativo` es el `desde` y la columna nueva es aditiva.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Que cuesta
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Nada medible. Las dos columnas son ADITIVAS y no tocan una sola fila de datos:
--   · `dia_relativo` nace NULL en las 41 lineas que existen en toda la base, y NULL
--     es «sin dia», o sea el comportamiento de hoy.
--   · `mostrar_en_sugeridos` nace `true`, que es «se muestra», tambien el de hoy.
--
-- Medido contra produccion el 2026-09-14, ANTES de escribir una linea de codigo:
--   · 41 items en toda la base, 20 cotizaciones, 16 workspaces.
--   · 4 items con `grupo` no nulo, los cuatro `vuelo`, en 2 cotizaciones de trappvel.
--   · 0 filas en `cotizacion_itinerarios` y 0 en `itinerario_opciones`.
--   · 0 items con dia (la columna no existe).
-- O sea: al aplicar esto, CERO cotizaciones cambian de aspecto. La primera que cambie
-- sera la primera a la que alguien le asigne un dia a mano.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A quien avisarle
-- ─────────────────────────────────────────────────────────────────────────────
--
--   · Mauricio: autoriza la aplicacion. El PR no se mergea antes.
--   · Trappvel (Alejandra, Daniela) via Edgar: desde que se aplique, una linea de
--     tour o traslado SIN dia en una cotizacion que ya use dias se imprime como
--     «no incluida». El editor avisa en pantalla cuando esa linea ademas cobra.
--   · Nadie mas: Termotech, Arca, WMC y los demas workspaces no usan `grupo` ni dias,
--     y su PDF no cambia un pixel.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Que se verifico antes de escribirla
-- ─────────────────────────────────────────────────────────────────────────────
--
--   · Que `items` no tiene ya una columna de dia o fecha: no la tiene.
--   · Que toda lectura de `items` usa `select('*')` y no nombra columnas, asi que la
--     ausencia de la columna no rompe el editor, el PDF ni el duplicado
--     (`getCotizacionItems`, `cotizacion-pdf-actions`, `duplicarCotizacion`).
--   · Que ninguna linea combinable (vuelo/hotel) puede recibir dia: lo impide el
--     guard de la server action y lo fija `dia-relativo.test.ts`.
--
-- ⚠️ Vuelta atras: las dos columnas se pueden dropear sin perder nada mas que los
-- dias escritos. Ningun calculo de dinero depende de ellas — el dia es presentacion,
-- no precio, y `itemsQueAportanAlTotal` no las mira.

alter table public.items
  add column if not exists dia_relativo integer;

alter table public.items
  add column if not exists mostrar_en_sugeridos boolean not null default true;

-- El dia es un ordinal del viaje: 1 es el primer dia. No hay dia 0 ni dias negativos.
-- No se pone tope superior: un circuito largo puede tener 30 dias y elegir un maximo
-- seria inventar un limite de negocio que nadie pidio.
alter table public.items drop constraint if exists items_dia_relativo_check;
alter table public.items add constraint items_dia_relativo_check
  check (dia_relativo is null or dia_relativo >= 1);

comment on column public.items.dia_relativo is
  'Dia del viaje al que pertenece la linea, relativo a la salida (1 = primer dia). NULL = sin dia: la linea cae al paquete de sugeridos si declara un grupo no combinable, y si no imprime donde imprime hoy. Es RELATIVO y no una fecha porque el itinerario se arma antes de fijar la salida. Es presentacion, no precio: no entra en ningun calculo de total.';

comment on column public.items.mostrar_en_sugeridos is
  'Solo aplica a las lineas que caen al paquete de sugeridos: si es false, el PDF no la imprime. NO la saca del total — una sugerencia oculta que sigue cobrando es el caso que el aviso del editor nombra con nombre propio.';

-- Indice: la consulta que importa es «los dias de ESTA cotizacion», y esa ya entra
-- por `items.cotizacion_id`, que tiene su indice. Un indice sobre `dia_relativo`
-- no lo usaria nadie con 41 filas en toda la base. Se agrega el dia que haga falta.
