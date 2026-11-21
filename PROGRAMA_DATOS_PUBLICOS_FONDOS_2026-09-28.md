# Programa de datos públicos de fondos: diseño propuesto

*28 de septiembre de 2026. Es un informe de diseño: no se ha ejecutado ni escrito código. Complementa a `FUENTES_PUBLICAS_FONDOS_2026-09-28.md`, que contiene la investigación de fuentes y la verificación con fondos reales.*

---

## 1. Qué es y qué no es

**Qué es.** Un programa independiente que obtiene los **datos fundamentales de fondos y ETF** solo de documentación pública y gratuita. Esa documentación la publica la gestora (KID, ficha mensual, informes) o un organismo oficial (CNMV, CSSF, ESMA, AMF, GLEIF). El programa entrega una ficha por ISIN que la plataforma carga en la maestra sin cambios en la app.

**Qué no es:**

- **No descarga precios.** Las series de valor liquidativo siguen viniendo de EODHD (plan «EOD All World»).
- **No cubre acciones en esta fase.** Las acciones quedan para una fase 2, con SEC EDGAR para EE. UU. y cuentas ESEF/XBRL para Europa.
- **No usa Morningstar ni el plan de fundamentales de EODHD.** Cuando esté completo, ambos se pueden dar de baja para fondos.

**Reparto final:**

| Dato | Fuente |
|---|---|
| Serie diaria de VL (todos los domicilios) | EODHD |
| Rentabilidades, volatilidad, Sharpe, drawdown, correlaciones | Cálculo propio desde la serie (ya lo hace la app) |
| Identidad, regulatorio, costes, composición, perfil de RF | **Este programa** |

---

## 2. Qué datos tiene que dar

El catálogo sale de lo que la app lee de verdad (`read/asset-for-bdb.v1` y `master/asset.v1.1`). Nada más, salvo lo marcado como opcional.

| Bloque | Campos | Prioridad |
|---|---|---|
| **Identidad** | ISIN, nombre legal de la clase, gestora comercial y legal, divisa de la clase, cubierta/no cubierta, distribución/acumulación, domicilio, UCITS/AIF, fecha de lanzamiento, índice de referencia | Imprescindible |
| **Riesgo regulatorio** | SRI 1-7, periodo de mantenimiento recomendado, artículo SFDR | Imprescindible |
| **Costes** | Gastos corrientes (≈ TER), comisión de gestión, costes de operación, comisión de éxito, comisiones de entrada/salida | Imprescindible |
| **Exposición por activo** (`pms_exposure`) | RV, RF, liquidez, alternativos, activos reales, otros (suma 100 %) | Imprescindible (lo usa el optimizador) |
| **Detalle RV** | Regiones (macro-zonas de la app), sectores (11 GICS), países principales | Imprescindible |
| **Perfil RF** | Duración, rating medio, reparto por rating, tipo (gobierno/corporativo/HY/emergente), vencimientos, TIR | Importante |
| **Cartera** | Top 10 con pesos, nº de posiciones, peso del top 10, fecha de la cartera | Importante |
| **Clasificación propia** | `asset_type`, `region_primary`, `fixed_income_type`, `strategy_tags`… (`classification_v2`) | Imprescindible (sustituye a la categoría Morningstar) |
| **Estilo RV** | Valor/crecimiento, capitalización | Opcional: pocas fichas lo traen |
| **Patrimonio** | Patrimonio del fondo o de la clase y su fecha | Opcional |

**Se dejan fuera** por ser propietarios: categoría y estrellas Morningstar, medalist, percentiles de categoría, globos ESG y huella de carbono.

---

## 3. Fuentes y orden de prioridad

Cada campo tiene una fuente preferente y una de respaldo. Cuando dos fuentes dan el mismo campo, gana la oficial frente a la comercial y la más reciente frente a la antigua.

| Fuente | Aplica a | Da | Frecuencia | Estado |
|---|---|---|---|---|
| **CNMV XML** (FONDREGISTRO, FONDTRIM, FONDCART, FONDDERI) | Fondos ES | Identidad, comisiones, gastos, rentabilidades, **cartera completa valor a valor** | Mensual y trimestral (~4 meses de retraso) | Ya existe en el extractor: migrar |
| **CNMV ficha + KID** | Fondos ES | Registro, gestora y depositaria legales, KID | Al cambiar | Existe: migrar |
| **CSSF** | Fondos LU | Paraguas, compartimento, clase, divisa, UCITS | Mensual | Existe: migrar |
| **ESMA** | UE | Marco UCITS/AIF, gestora legal, países de comercialización | Mensual | Existe: migrar |
| **AMF GECO** | Fondos FR | Gestora, LEI, clasificación AMF, KID | Mensual | Existe: migrar |
| **GLEIF** | Todos | LEI, nombre legal | Anual | Existe: migrar |
| **KID de la gestora** (+ espejo de Deutsche Bank España) | No ES | SRI, costes, periodo recomendado, SFDR, objetivo | Anual (TTL 90 días) | Existe: migrar y ampliar |
| **Ficha mensual de la gestora** | Todos (sobre todo no ES) | **Composición**, top 10, perfil RF, gastos corrientes, comisión de gestión | Mensual | **Nuevo** |
| **Datos estructurados de la gestora** (JSON de JPMorgan, Excel de BlackRock/iShares) | Gestoras concretas | Composición y posiciones sin leer PDF | Mensual o diario | **Nuevo** (iShares ya existe) |
| **Plantillas FinDatEx (EMT/EPT/EET)** | Gestoras que las publican (Schroders, M&G, Columbia Threadneedle…) | Costes ex ante, SRI, SFDR en formato estructurado | Mensual o trimestral | **Nuevo** |
| **Informe anual/semestral** | Respaldo para cartera completa | Inventario de cartera | Semestral | Fase posterior |

---

## 4. Arquitectura

**Lenguaje:** Python, igual que el extractor. En tu PC ya están Python y pdfplumber.
**Ubicación propuesta:** `C:\Users\oanti\Proyectos\Gestor-Activos-Financieros\0-datos-publicos\` (nombre a decidir).

```
0-datos-publicos/
├─ config/
│  ├─ universo.csv            ISIN, gestora, tipo (se sincroniza con el extractor)
│  ├─ gestoras.yaml           por gestora: patrón de URL, lector de ficha, idioma
│  └─ enlaces_fijos.csv       ISIN → URL fija cuando no hay patrón (DWS, Robeco…)
├─ fuentes/                   un adaptador por fuente (capacidades declaradas)
│  ├─ cnmv_xml.py  cnmv_ficha.py  cssf.py  esma.py  amf_geco.py  gleif.py
│  ├─ kid.py                  localizar + leer KID (lector actual, migrado)
│  ├─ ficha_mensual.py        localizar + leer factsheet
│  ├─ estructurados.py        JSON de JPMorgan, Excel de BlackRock/iShares
│  └─ findatex.py             EMT/EPT/EET
├─ lectores_ficha/            un lector por gestora (plantilla fija)
│  ├─ fidelity.py  pictet.py  carmignac.py  blackrock.py  dws.py  …
│  └─ generico_ia.py          respaldo con IA para gestoras sin lector propio
├─ nucleo/
│  ├─ descarga.py             ritmo educado, caché en disco, reintentos, robots.txt
│  ├─ normaliza.py            taxonomía común (ver 4.2)
│  ├─ fusiona.py              prioridad por campo + procedencia
│  ├─ valida.py               reglas duras (ver 4.3)
│  └─ clasifica.py            classification_v2 propia
├─ salida/                    {ISIN}.json + _resumen.json con hashes
└─ informes/                  cobertura por campo y por gestora, cola de revisión
```

### 4.1 Contrato de salida

El programa escribe una ficha por ISIN con **los mismos campos que hoy alimentan la maestra**: `pms_exposure`, `exposure_detail`, `costs`, `fixed_income_profile`, `holdings_summary`, `classification` y `regulatory`. Cada campo lleva su procedencia (fuente, documento, fecha del dato). La plataforma solo necesita un adaptador de lectura nuevo; la app no cambia.

Durante la transición, el extractor puede consumir esta salida como una fuente oficial más. Así la maestra se alimenta de lo público donde exista y de Morningstar solo donde todavía falte.

### 4.2 Normalización (el punto crítico)

Cada gestora usa su propia clasificación. Sin normalizar, los repartos no son comparables entre fondos ni sirven al optimizador.

- **Clases de activo:** RV · RF · liquidez · alternativos · activos reales · otros. Hay una tabla de sinónimos por idioma («Actions», «Equities», «Renta variable»…).
- **Regiones:** las macro-zonas que ya usa la app. Los países se convierten a ISO3 y se agregan a zona.
- **Sectores:** los 11 GICS. Hay tablas de equivalencia para ICB y para las etiquetas propias de cada gestora.
- **RF:** tipos (gobierno, corporativo IG, HY, emergentes, titulizados), tramos de rating y de duración, alineados con los enums de `classification_v2`.
- Lo que no mapea va a «otros» con un aviso. Nunca se reparte a ojo.

### 4.3 Validación antes de aceptar un dato

- Los repartos suman 100 % ± 2 puntos; si no, se rechaza el bloque.
- El ISIN del documento coincide con el pedido. Hay que comprobarlo porque algunas gestoras sirven el mismo PDF para varios ISIN.
- La fecha del dato no tiene más de 120 días en composición ni más de 18 meses en el KID.
- Los gastos corrientes están entre 0 y 5 %, el SRI entre 1 y 7 y la duración entre 0 y 30.
- Un dato que empeora respecto a la pasada anterior (menos campos, fecha más antigua) no sobrescribe; va a la cola de revisión.

### 4.4 Lectura de fichas mensuales

- **Primero, un lector propio por gestora.** Cada gestora mantiene una plantilla estable, así que un lector con pdfplumber es fiable, gratuito y verificable.
- **Después, respaldo con IA** para la cola larga. Se pasa el texto del PDF a Claude o Gemini con un esquema JSON cerrado y se aplican las mismas validaciones. El resultado lleva la marca `ia` en la procedencia. Si no valida, va a la cola de revisión; nunca entra en la maestra sin validar.
- **Los formatos estructurados** (JSON de JPMorgan, Excel de BlackRock/iShares, EMT/EPT) tienen prioridad sobre el PDF cuando existen.

---

## 5. Cobertura por olas

El universo son 766 fondos y ETF de 119 gestoras.

| Ola | Qué | Cobertura aproximada |
|---|---|---|
| **1** | Migrar los adaptadores oficiales (CNMV, CSSF, ESMA, AMF, GLEIF, KID) + CNMV completo para fondos ES (cartera trimestral → exposición calculada) | Regulatorio ~100 %; costes ~71 % (los que ya tienen KID); composición: 89 fondos ES |
| **2** | Ficha mensual de las 10 gestoras con más fondos: BlackRock, Fidelity, Schroders, JPMorgan, Amundi, DWS, Invesco, Allianz, BNP y Andbank (Lux) | +~43 % del universo |
| **3** | Siguientes 15 gestoras (Robeco, Goldman Sachs, Nordea, M&G, Morgan Stanley, UBS, Edmond de Rothschild, Carmignac, Candriam, Pictet, Franklin, Natixis, Groupama, BNY Mellon, PIMCO) + KID para los 221 fondos que no lo tienen | Hasta ~69 % |
| **4** | Cola larga (94 gestoras restantes) con el lector de IA + enlaces fijos + informes semestrales | Objetivo ≥ 90 % |

**Dificultades ya detectadas:**

- **Schroders:** la ficha se carga con JavaScript. Vía alternativa: sus plantillas EMT/EET abiertas para costes; la composición está por resolver.
- **Invesco:** exige perfil y el patrón de URL da 404.
- **Pictet:** la ficha sí se localiza por ISIN, pero la biblioteca de informes no.
- **DWS y Robeco:** necesitan una tabla de enlaces rellenada una vez.

---

## 6. Transición y prueba de calidad

1. **Ejecución en paralelo.** Durante 2 o 3 meses el programa corre junto al extractor actual sin escribir en la maestra.
2. **Comparación fondo a fondo** entre lo público y lo que hoy da Morningstar, con tolerancias:

   | Dato | Tolerancia |
   |---|---|
   | Repartos (activo, región, sector) | ± 3 puntos por grupo |
   | Gastos corrientes | ± 0,05 puntos |
   | Duración | ± 0,5 años |
   | SRI | Exacto |

   Las diferencias se revisan: a veces el error estará en Morningstar.
3. **Cambio de fuente por bloque y por gestora**, solo cuando la comparación pase. Primero regulatorio y costes, luego composición.
4. **Baja de Morningstar y del plan de fundamentales** cuando la cobertura de composición supere el umbral que tú fijes (propuesta: 90 %) y la app funcione sin ellos.

---

## 7. Qué se pierde y cómo se sustituye

| Hoy (Morningstar) | Después |
|---|---|
| Categoría Morningstar | Clasificación propia (`classification_v2`) + vocación CNMV para fondos ES |
| Estrellas, medalist, percentil en categoría | No se sustituye. Se puede construir un ranking propio con las series de EODHD dentro de la clasificación propia |
| Globos ESG, carbono | Artículo SFDR (KID/EET); indicadores PAI de la EET donde se publique |
| Style box RV homogéneo | Solo si la ficha lo trae; si no, queda vacío |
| Composición mensual de todos los fondos | Composición mensual del ~70-90 % (según avance de olas); el resto trimestral o semestral |

---

## 8. Riesgos

- **Mantenimiento.** Las gestoras cambian la maquetación sin avisar. Mitigación: validación dura, un informe de fallos por gestora en cada pasada y el respaldo con IA.
- **Frescura.** La ficha sale entre 2 y 6 semanas después del cierre de mes. Para asignación de activos es suficiente.
- **Condiciones de uso.** Son documentos públicos que la gestora publica para inversores. Se respetan robots.txt y un ritmo lento (≥ 1,5 s por petición), y se descarga cada documento una vez al mes.
- **Pruebas.** Este entorno no llega a las webs de las gestoras: todas las pruebas con datos reales se ejecutan en tu PC.
- **Sin repositorio oficial de KID ni de fichas para LU/IE.** Depende de que cada gestora mantenga su web. Por eso importan el espejo de Deutsche Bank y la tabla de enlaces fijos.

---

## 9. Fases y entregables

| Fase | Entregable | Verificación |
|---|---|---|
| 0 | Estructura del programa, contrato de salida, tablas de normalización | Esquema validado contra `asset.v1.1` |
| 1 | Adaptadores oficiales migrados + CNMV completo | Salida idéntica a la del extractor actual en esos campos (comparación campo a campo) |
| 2 | Lectores de ficha de las 10 gestoras principales | Comparación con Morningstar dentro de tolerancias en ≥ 90 % de sus fondos |
| 3 | 15 gestoras siguientes + ampliación de KID | Ídem; fondos sin KID < 60 |
| 4 | Lector con IA + cola de revisión + informe de cobertura | Cobertura de composición ≥ 90 % |
| 5 | Conexión con la plataforma (adaptador de lectura), primero en pasada en seco | Sin escritura en la maestra sin tu OK |

---

## 10. Decisiones pendientes

1. Nombre y ubicación del programa (`0-datos-publicos` es la propuesta).
2. ¿Se migran los adaptadores oficiales del extractor (recomendado: una sola casa para lo público) o se duplican?
3. Motor del respaldo con IA: Claude o Gemini (ya usas Gemini en los informes de mercado).
4. Umbral de cobertura para dar de baja Morningstar y el plan de fundamentales de EODHD (propuesta: 90 %).
5. ¿Ranking propio para sustituir a las estrellas, o se prescinde?
