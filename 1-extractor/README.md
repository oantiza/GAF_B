# FondosDB

**Modo sencillo (activo desde 11-06-2026):** cada fondo/ETF lleva su ficha de
~300-400 campos con top-10 de cartera. El uso diario es solo: `python app.py` → Actualizar,
y `python main.py export` para volcar a tu base de datos. El resto de
comandos (figi, calidad, cnmv, visor) son opcionales.

Motor de datos fundamentales de fondos y ETFs. Lee tu lista de ISINs, consulta
las fuentes (justETF, Morningstar) y genera un JSON por fondo conforme al
esquema v2 (`../esquema_fondo.json`), con caché, rate-limit educado, histórico
y trazabilidad de fuentes. Documentación de diseño: `../PLAN.md` y
`../CATALOGO_DATOS.md`.

## Instalación (una vez)

Necesitas Python 3.10+ ([python.org](https://www.python.org/downloads/), marca
"Add to PATH" al instalar). Después, en una consola (cmd o PowerShell):

```
cd "C:\Users\oanti\Proyectos\Gestor-Activos-Financieros\1-extractor"
pip install -r requirements.txt
```

Si falla la línea de `justetf-scraping` por no tener git instalado: instala
[git](https://git-scm.com/download/win) o borra esa línea de
`requirements.txt` (perderás la ficha completa justETF; la cotización seguirá
funcionando).

## Primer uso

1. **Verifica Morningstar desde tu conexión** (en mi entorno estaba bloqueado
   y quedó pendiente de comprobar en tu PC):

   ```
   python tools/test_morningstar.py
   ```

   Imprime PASS/FAIL de las 3 APIs y muestras reales. Nota: mstarpy v10 abre
   una ventana de Chrome unos segundos para crear la sesión — es normal.

2. **Primera carga** (el universo configurado en `config/fondos.csv`):

   ```
   python main.py update --all
   ```

3. **Añade tus fondos** y actualiza:

   ```
   python main.py add LU0690375182 --nombre "Fundsmith Equity Feeder T" --tipo fondo
   python main.py update LU0690375182
   ```

   (o edita `config/fondos.csv` directamente con Excel/Notepad)

## Interfaz web local (recomendada)

```
python app.py
```

Se abre sola en el navegador (http://127.0.0.1:8765, solo accesible desde tu
equipo). Desde ahí puedes: añadir/quitar fondos, **añadir en lote** (pega
cualquier texto con ISINs — un Excel, un email — y los detecta, les pone
nombre y tipo automáticamente y los actualiza), lanzar actualizaciones (todo,
uno, o forzando sin caché) y la descarga CNMV con **log en vivo**, y abrir la
ficha completa de cada fondo. En consola, `add` también acepta varios ISINs
con resolución automática: `python main.py add ISIN1 ISIN2 ISIN3`.

## Comandos

| Comando | Qué hace |
|---|---|
| `python main.py update --all` | Actualiza todos los de fondos.csv |
| `python main.py update ISIN1 ISIN2` | Solo esos |
| `python main.py update --all --force` | Ignora la caché (re-descarga todo) |
| `python main.py update --all --fuentes justetf` | Limita las fuentes |
| `python main.py add ISIN --nombre "..." --tipo fondo\|etf` | Añade a la lista |
| `python main.py report` | Tabla resumen + cobertura por bloque |
| `python main.py cnmv` | Descarga el ZIP oficial CNMV del último periodo y extrae los fondos ES de tu lista (luego `update` los fusiona con prioridad máxima) |
| `python main.py cnmv --ano 2026 --mes 3` | Un periodo concreto (los meses de fin de trimestre traen el detalle: comisiones, TER, cartera completa) |
| `python main.py visor` | Genera `data/visor.html`: visor local con tabla ordenable, buscador y ficha completa por fondo (doble clic, sin conexión) |
| `python main.py calidad` | Informes de calidad en `reports/`: resumen CSV por fondo (score, bucket, flags) y `fondos_problematicos.md` |
| `python main.py export` | **Export universal para bases de datos** en `export/`: `fondos.ndjson` (un doc ligero por fondo, apto Firestore <1MiB), `posiciones.ndjson` (carteras completas troceadas), `series.ndjson`, `fondos_plano.csv` (~50 columnas para SQL/BI) y `manifest.json` publicado al final con recuentos, SHA-256 y `package_id`. Instrucciones por motor en `export/README_EXPORT.md` |
| `python main.py figi` | OpenFIGI: añade `figi`, `share_class_figi` y `mercado` a las posiciones con ticker sin ISIN (CSV de iShares). Key en `config/secrets.json`; mapa permanente en `cache/figi/` que los update re-aplican solos |
| `python main.py bdb` | **Adaptador BDB-FONDOS** (también botón "Exportar a BDB" en la interfaz): genera `export_bdb/{ISIN}.json` y `_resumen.json` con hashes y el mismo `package_id` determinista que `export/manifest.json`. La plataforma rechaza mezclar snapshots distintos. `--destino carpeta` para regenerar sin pisar el paquete vigente. |
| `python main.py update --all --familias precio` | Refresco **diario** barato: solo la familia de dato pedida sale a red (el screener, 1 petición por fondo); el resto se sirve de caché aunque haya caducado. Familias: precio, rendimiento, analitica, cartera, esg, costes, regulatorio, identidad |
| `python main.py update --all --sin-caducidad` | Regenera las fichas con lo que haya en caché, tenga la edad que tenga (las fuentes sin caché sí salen a red). `--sin-red`: además, lo que no esté en caché se da por ausente. Las bibliotecas que no pasan por la caché HTTP no se llaman: la ficha completa de justETF (justetf_scraping) se sirve de su copia en `cache/justetf_overview/` y, si no hay copia vigente, se retiene la de la ficha anterior (`retenido:` con la fecha en que justETF la dio, hasta 180 días, aviso `dato_retenido`); si la copia vigente ya no trae un campo, ese campo no se resucita; yfinance y mstarpy se omiten. Para regenerar algo que se va a publicar, `--sin-red` junto con `--sin-caducidad` |
| `python main.py capacidades --sin morningstar` | Qué campos se quedan sin fuente y cuáles conservan respaldo si cae un proveedor. `--ruta riesgo.sri_kid_1a7` dice quién sabe dar una ruta |
| `python main.py corrige ISIN ruta valor --motivo "..."` | **Corrección manual de un campo suelto, en origen** (`config/correcciones.json`): se aplica en la siguiente pasada (`update ISIN --sin-caducidad`), lo derivado y la calidad se recalculan con el dato corregido, la procedencia pasa a `manual:<autor>` y viaja al canónico y a la maestra por el camino de siempre. `null` borra el campo; `--quitar` retira la corrección; `--listar` las muestra. Solo rutas que algún adaptador declara; bajo un comodín (`riesgo.*`) sin dato en la ficha hace falta `--nueva` |
| `python main.py ops` | **Servicio local de operaciones** (127.0.0.1:8766) que la app BDB-ACTIVOS usa desde Sistema › Operaciones: alta, extracción, canónico y correcciones. Ver `ops_server.py`. La parte de la plataforma de datos (copia, pasada en seco, escritura, auditoría, reclasificación y archivo en la maestra vieja) se borró con la base vieja el 21-11-2026. **Exige token** en cada petición (cabecera `X-Ops-Token`, salvo el preflight OPTIONS): el de `config/ops_token.txt` (fuera de git), que se crea solo la primera vez, o el `ops_token` de `config/settings.json` si se pone ahí (no conviene: ese fichero está en git; pide al menos 32 caracteres y el servicio avisa al arrancar). Se lee en cada petición, así que un token nuevo vale sin reiniciar el servicio. Sin token o con otro, 401 (la app se arranca con `iniciar-dev.bat`, que se lo pasa) |
| `python main.py ops-token` | Imprime ese token en una sola línea, y nada más en stdout; lo crea si falta. La app lo lee al arrancar su servidor de desarrollo y lo pasa como `VITE_BDB_OPS_TOKEN`; así la pestaña Sistema › Operaciones manda la cabecera. La interfaz `app.py` (`FondosDB.bat`) es otro servidor y no lo usa |
| `python main.py contraste` | **Fase 0 sin Morningstar**, sin red: compara las métricas propias de la ficha con las de Morningstar guardadas en `meta.contraste` (solo cuando las dos están fechadas el mismo día). Tolerancias: VL ±0,5 %; rentabilidades, año natural y volatilidad ±0,5 pp; Sharpe ±0,10. Salida en `reports/contraste_fase0.{csv,md}` |
| `python main.py cobertura` | **Fase 0**, sin red: % de hojas que ya no vienen de Morningstar, por bloque y por gestora; fondos con el VL del día hábil anterior (la puerta es el 100 %), con VL de EODHD y con métricas propias, y por qué faltan. Salida en `reports/cobertura_fase0.md` |
| `python tools/diff_canonicos.py ANTES DESPUES` | Compara dos carpetas de canónicos campo a campo: idéntico / cambia / aparece / desaparece (regresión salvo justificación) |

**Adquisición (desde el 04-09-2026)**: la recolección vive en
`core/adquisicion/` (adaptadores con capacidades declaradas, planificador por
familias de dato, procedencia por campo) y el bloque regulatorio —SRI del KID,
costes del KID y ex-ante MiFID, UCITS, gestora legal, fechas de registro,
cartera del informe periódico— sale de fuentes oficiales y gratuitas: CNMV
(ficha, KID y XML mensual/trimestral), CSSF, ESMA, AMF GECO y GLEIF. Morningstar
se conserva para la analítica propietaria (categoría, estrellas, medalist,
globos ESG, carbono). Cada ficha lleva `meta.procedencia` (quién escribió cada
campo) y el canónico `regulatory` y `provenance`. Desde el 05-09 el KID de los
fondos no españoles llega de la web de la gestora (DWS, Amundi, JPMorgan,
Invesco, Nordea, Candriam, Goldman Sachs, Schroders, M&G) o del espejo de
documentación de Deutsche Bank España (`fetchers/kid_gestora.py`). Diseño
completo en `docs/ADQUISICION_2026-09-04.md`.

**VL y métricas de los fondos sin Morningstar (fase 0, desde el 28-10-2026)**:
el adaptador `vl_eodhd` (`fetchers/vl_fondos.py`) pide a EODHD solo precios: la
serie diaria del VL por ISIN (`{ISIN}.EUFUND`) y la divisa de la clase. El VL
manda en la ficha (el de Morningstar se quedaba semanas atrás) y, en las
clases de **acumulación**, la rentabilidad a plazo y por año natural, la
volatilidad, el Sharpe y la caída máxima se calculan en `core/metricas.py`: a
cierre de mes y en la divisa de la clase, como las da Morningstar (sal-service).
El Sharpe, solo en clases en EUR (contra el €STR del BCE); en las demás queda
el de Morningstar. En
las clases de reparto o de política desconocida solo se toma el VL (EODHD no
ajusta la serie por los repartos) y las métricas siguen siendo las de
Morningstar, con el motivo en `riesgo.historial_precios.aviso_metricas`. Lo que
Morningstar trae en esas rutas no entra en la ficha pero queda en
`meta.contraste` (reglas en `registro.CONTRASTE`). Estrellas, Medalist,
categoría y las métricas de categoría e índice siguen viniendo de Morningstar.
`calidad` marca `vl_antiguo(Nd)` si el VL tiene más de 7 días frente a la pasada. Si la guarda de
regresión de `core/update.py` bloquea una ficha (la fuente dejó de dar su
cartera, por ejemplo), se conserva la anterior pero el VL y las métricas de la
serie se actualizan igual, con la fecha en `meta.actualizacion_parcial`. Una
serie de EODHD parada más de 10 días no se usa (`aviso_vl`) salvo que siga con la de
Morningstar: los fondos de `config/serie_de_respaldo.json` con su regla (D-9) y los demás
fondos de VL por empalme si cuadran (D-10, `core/serie_de_respaldo.py`; `update` lo resume al
final). Si tiene un salto
imposible (cambio de unidad) las métricas solo usan el tramo posterior
(`aviso_serie`).

**Saneado automático**: cada update pasa por `core/limpieza.py` (países a ISO3,
sectores canónicos, poda de campos descartados: intradía, 52 semanas, 1d/1sem,
num_titulos/valor_mercado, risk_score, etc.), `core/derivados.py` (IG/HY%,
divisas de cartera) y `core/calidad.py` (score, bucket ALTO/MEDIO/BAJO/BLOQUEADO
y flags: sintéticos, asignación que no suma 100, RF incompleta, patrimonio
fuera de escala...). La lista exacta de descartes vive en `limpieza.py`.

**Datos declarados por el emisor (fuentes `ishares` y `amundi`)**: VL histórico, TER, réplica, índice,
patrimonio, posiciones y dividendos del emisor, en el bloque propio `emisor` de la ficha y en
`series.vl_emisor`. iShares sale de su fichero de producto, con el id propio resuelto por ISIN; Amundi, que
incluye lo que fue Lyxor, de una llamada a su API por ISIN. En un ETF de Amundi por swap, la composición es
la cesta de sustitución, y `emisor.cartera.naturaleza` lo dice. No cambia ninguna otra ruta ni entra en
las métricas. Van en `prioridad_fuentes` desde la decisión 53 (uso interno para el desarrollo), y cada
instrumento se lee solo en el emisor cuya marca lleva en el nombre.

**Cartera completa del emisor (decisión B-79, 11-11-2026)**: para los ETF de `config/cartera_emisor.json`, los diecinueve
que del proveedor solo traen sus diez mayores posiciones, `export` saca las posiciones de `emisor.cartera` a un fichero
propio, `export/posiciones_emisor.ndjson`, troceado como `posiciones.ndjson` y con el tipo de cada línea (acción, renta
fija, derivado, liquidez) traducido del literal del emisor en `core/cartera_emisor.py`. Es de **uso interno, solo para el
asesor** (B-53): nunca entra en el documento ligero ni en `posiciones.ndjson`. Un ETF sintético (cesta de sustitución) o una
cartera recortada viajan marcados `uso: no_medir`. La cartera del emisor tiene su propio tope, `max_posiciones_cartera_emisor`
(30.000), porque el Global Aggregate de iShares da 20.000 líneas; el de las carteras del proveedor sigue en 10.000. En
iShares cada línea lleva además su valor de mercado: el peso del fichero va redondeado a dos decimales y en esa cartera suma
un 75,7 %.

**Mercado objetivo del fabricante (fuente `emt`, decisión 58)**: el EMT (European MiFID Template) de
iShares/BlackRock, Vanguard e Invesco, un fichero único por emisor que se descarga una vez por pasada
(familia `regulatorio`, copia en `cache/http/emt/`) y se lee por ISIN. Escribe el bloque `mercado_objetivo`:
tipo de cliente, conocimiento, capacidad de pérdidas (sin el `03050`), objetivos, periodo mínimo recomendado,
preferencias ESG y canal, con la fecha del mercado objetivo y el fichero (URL y sha256) del que sale. Lo que el
emisor deja vacío queda ausente, nunca «NEUTRAL». Emisores, URL y marcas en `emt_emisores` de los ajustes.
Ni costes ni EET. Uso interno: no va a informes de cliente.

## Dónde queda cada cosa

```
data/funds/{ISIN}.json      ← la ficha completa de cada fondo (esquema v2)
data/index.json             ← resumen de todos (para otras apps)
data/history/{ISIN}.jsonl   ← un snapshot por ejecución (VL, TER, estrellas…)
cache/http/                 ← respuestas cacheadas (TTL por familia de dato; ver settings)
cache/kid/{cnmv,amf}/       ← KID/PRIIPs en PDF descargados de la CNMV y de la AMF
cache/kid/gestoras/<fuente>/ ← KID/PRIIPs de las gestoras (LU/IE…) y marcadores .miss de 30 días
cache/cssf/                 ← fichero oficial de identificadores UCITS de Luxemburgo
cache/cnmv/                 ← ZIP mensuales y trimestrales de la CNMV y sus crudos
cache/raw_morningstar/{ISIN}/{bloque}.json ← respuestas crudas íntegras de
                              Morningstar: NINGÚN campo se pierde aunque el
                              mapeo aún no lo cubra (se amplía en Fase 2)
logs/                       ← registro detallado de cada ejecución
```

## Ajustes (`config/settings.json`)

`rate_limit_segundos` y `jitter_segundos` (ritmo educado), `cache_dias`
(frescura por defecto) y `ttl_dias_por_familia` (frescura por familia de dato),
`prioridad_fuentes` (quién gana en caso de conflicto; los adaptadores oficiales
entran siempre que apliquen), `guardar_respuestas_crudas`, `divisa`, `idioma`.

`sec_user_agent` (decision 37): identificacion ante la SEC, con la forma «nombre correo»
que EDGAR exige. Es **obligatoria para EDGAR**, va separada del `user_agent` general (que
simula un navegador) y la usara el paso 5 (fundamentales de la SEC) cuando exista; hoy no
hay ningun fetcher de EDGAR. Es un dato de contacto, no un secreto: los secretos van en
`config/secrets.json`. El JSON no admite comentarios, por eso se documenta aqui.

## Problemas típicos

- **No hace falta cuenta ni login en Morningstar.** Sus APIs públicas usan una
  apikey fija incrustada en la propia web (no credenciales de usuario);
  `morningstar_lt` la emplea para llamar a sal-service directamente, sin
  Selenium ni sesión. La fuente `morningstar` (mstarpy) queda como opcional
  (`--fuentes morningstar`): su búsqueda inicial exige una sesión de Chrome y
  daba "401 Unauthorized"; si quieres probarla, sube la espera con
  `$env:SELENIUM_DRIVER_WAIT_TIME="20"` en PowerShell.
- **Decisión sobre mstarpy manual:** se mantiene documentado como fuente
  manual/de contraste, no en la prioridad por defecto. `morningstar_lt` es la
  fuente operativa principal porque evita sesión interactiva y cubre screener,
  LT, MiFID y sal-service.
- **mstarpy falla / no quieres ventana de Chrome** → `pip install "mstarpy<10"`
  (usa la vía antigua sin navegador mientras siga operativa).
- **Un fondo sale "sin datos"** → ¿ISIN correcto? Los fondos no-ETF no están
  en justETF; necesitan Morningstar operativa.
- **HTTP 429/bloqueos** → sube `rate_limit_segundos` a 3–5 y reintenta mañana;
  la caché evita repetir lo ya descargado.

## Siguientes fases (PLAN.md)

F2: fetcher CNMV (XML oficiales, fondos españoles) + ampliar mapeo Morningstar
con las respuestas crudas reales + más bloques (MiFID/EMT, ESG completo,
documentos KID). F3: FT/KID-PDF para huecos + informe de cobertura. F4: visor
HTML local.
