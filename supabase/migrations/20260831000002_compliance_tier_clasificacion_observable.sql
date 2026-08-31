-- Compliance — clasificación por tier en modo OBSERVABLE
-- (concepto Emilio 2026-08-31, bloque A, condiciones C1, C3, C4 y C5)
--
-- Problema: el clasificador de tier existe desde el 2026-08-25
-- (`src/lib/compliance/tier-fuentes.ts`) y no lo consume nadie. Mientras no se
-- persista la clasificación no se puede medir la cobertura del catálogo, no se
-- puede probar que no hay supresión, y no se puede construir R2 (periodicidad
-- por nivel de riesgo) porque el nivel de riesgo no existe: hoy `severidad` es
-- binaria y no distingue un acto del Consejo de Seguridad de la ONU de una nota
-- de prensa.
--
-- Qué hace esta migración: agrega las columnas donde se GUARDA la clasificación
-- de cada consulta, junto a la versión de catálogo bajo la que se clasificó.
--
-- Qué NO hace, y es la condición C1 del concepto: no toca `severidad` ni ninguna
-- ruta que decida sobre una contratación. La clasificación se observa y se mide;
-- todavía no decide nada. Que el tier tenga efecto sobre el flujo de compras
-- depende del bloque B del concepto, que exige instrumentos contractuales que
-- hoy no existen.
--
-- Por qué las columnas y no una tabla aparte: la clasificación es un atributo
-- derivado de `matches` de esa misma fila, se escribe una vez con ella y se lee
-- siempre con ella. Una tabla 1:1 solo agregaría un join y la posibilidad de que
-- una consulta quede sin su clasificación.
--
-- `tier_catalogo_version` ya existía (se creó el 2026-08-25 anticipando esto) y
-- por eso no se agrega aquí.

alter table consultas_listas_dual
  -- El tier MÁXIMO presente, nunca la suma ni el conteo. Dentro de un mismo tier
  -- el número de coincidencias no escala nada (§5 del dictamen de Lucía).
  -- NULL = la consulta no trajo coincidencias, o no se pudo clasificar.
  add column if not exists tier_maximo text
    check (tier_maximo is null or tier_maximo in
      ('tier_1', 'tier_2', 'tier_3', 'tier_4', 'medios', 'sin_clasificar')),

  -- C4: alguna fuente de esta consulta NO está en el catálogo. Dispara, y se
  -- enruta al canal de mayor exigencia. NO se degrada a "medios" ni a "no
  -- dispara": es el blindaje contra un falso negativo por omisión de catálogo.
  add column if not exists tier_sin_clasificar boolean not null default false,

  -- Las fuentes crudas que el catálogo no resolvió, tal como las manda el
  -- proveedor. Es el insumo de quien vaya a clasificarlas, y la materia prima
  -- del indicador de C5.
  add column if not exists tier_fuentes_sin_clasificar text[],

  -- C3, cero supresión: hallazgos + duplicados tiene que ser igual al número de
  -- coincidencias que devolvió el proveedor. Se guardan los DOS números para que
  -- la igualdad sea verificable sobre los datos y no solo en una prueba.
  add column if not exists tier_hallazgos integer,
  add column if not exists tier_duplicados integer,

  -- El catálogo bajo el que se clasificó estaba firmado jurídicamente. Hoy es
  -- false (la versión 1 está en `validada_tecnica`). Se guarda por consulta
  -- porque una clasificación hecha con catálogo no operable no puede sustentar
  -- una decisión después, aunque el catálogo se firme más tarde.
  add column if not exists tier_opera boolean;

comment on column consultas_listas_dual.tier_maximo is
  'Tier máximo presente en la consulta (no la suma). Observable: no decide nada sobre contrataciones hasta el bloque B del concepto de Emilio del 2026-08-31.';

comment on column consultas_listas_dual.tier_sin_clasificar is
  'Alguna fuente no está en el catálogo. Dispara y va al canal de mayor exigencia (C4).';

comment on column consultas_listas_dual.tier_hallazgos is
  'Coincidencias deduplicadas. Con tier_duplicados tiene que sumar el total devuelto por el proveedor (C3, cero supresión).';

comment on column consultas_listas_dual.tier_opera is
  'El catálogo usado tenía firma jurídica. Falso mientras la versión 1 siga en validada_tecnica.';

-- Indicador de C5: fuentes sin clasificar del periodo. El índice parcial lo hace
-- barato porque hoy, y ojalá siempre, la respuesta es cero filas.
create index if not exists idx_consultas_dual_tier_sin_clasificar
  on consultas_listas_dual(workspace_id, created_at)
  where tier_sin_clasificar;

-- Consultas históricas: quedan con tier_maximo NULL y tier_sin_clasificar false.
-- NO se reclasifican en esta migración. Reclasificar hacia atrás escribiría un
-- juicio de hoy sobre una consulta de ayer sin dejar rastro de que fue posterior,
-- y el catálogo todavía no está firmado. Se arranca limpio de aquí en adelante,
-- mismo criterio que se aplicó con el segmento el 2026-08-20.
