# PLAN — FondosDB: motor de datos fundamentales de fondos y ETFs

**Fecha:** 10-06-2026 · **Alcance acordado:** fondos UE/España (ISIN) + ETFs UCITS · 100–1.000 instrumentos · ejecución manual · script Python que genera/actualiza JSONs.

---

## 1. Idea central (lo eficiente y barato)

No hace falta "scrapear" páginas con navegador, proxies de pago ni servicios anti-bot. Las webs de fondos (Morningstar, justETF…) cargan sus datos desde **APIs JSON internas** que cualquier script puede llamar directamente con cabeceras correctas. Eso, más los **datos abiertos oficiales de la CNMV**, cubre casi todo el universo elegido a **coste 0 €**, sin servidor y sin suscripciones.

Bloomberg se descarta: bloqueo agresivo y datos bajo licencia; no aporta nada que no den las fuentes de abajo para fondos/ETFs UCITS.

## 2. Fuentes priorizadas

| # | Fuente | Cubre | Método | Datos clave | Estado |
|---|--------|-------|--------|-------------|--------|
| 1 | **justETF** | ETFs UCITS (3.400+) | API JSON interna (`/api/etfs/{ISIN}/...`) + librería `justetf-scraping` | TER, rentabilidades 1M–MAX, volatilidad, Sharpe, max drawdown, holdings, sectores, países, tamaño | ✅ **Verificada hoy en vivo** (devuelve JSON con cotización de 10-06-2026) |
| 2 | **Morningstar** | Fondos + ETFs (todo) | Librería `mstarpy` (mantenida, últ. versión abr-2026) + endpoint screener europeo (`tools.morningstar.es/api/rest.svc/klr5zyak8x/security/screener`) | Rating estrellas, OngoingCharge/TER, rentabilidades, cartera, estilo, categoría, benchmark, sostenibilidad | ⚠️ A verificar en tu PC (mi sandbox no tiene salida de red a ese dominio). Nota: mstarpy ≥ v10 requiere abrir sesión con Chrome/Selenium → señal de que Morningstar ha endurecido; usar v9.x con la API screener mientras funcione y mstarpy v10 como plan B |
| 3 | **CNMV (datos abiertos)** | Todos los fondos españoles | Descarga oficial gratuita de ficheros XML ([cnmv.es](https://www.cnmv.es/portal/publicaciones/descarga-informacion-individual)) | VL mensual, patrimonio, partícipes, **comisiones**, rentabilidades y **cartera completa trimestral** | ✅ Oficial, sin riesgo legal, máxima calidad |
| 4 | **FT (markets.ft.com)** | Fondos por ISIN | Ficha HTML `funds/tearsheet/summary?s={ISIN}` | Fallback para fondos no españoles sin dato Morningstar | ⚠️ No accesible desde mi entorno; verificar en tu PC |
| 5 | **Gestoras / KID PRIIPs** | Cualquier fondo | Descargar PDF del documento de datos fundamentales y extraer con `pdfplumber` | TER, indicador de riesgo SRI, política | Solo para rellenar huecos |
| 6 | **Yahoo Finance** (`yfinance`) | ETFs con ticker | Librería gratuita | AUM, precios, dividendos | Complemento |

**Estrategia multi-fuente:** cada campo del JSON se rellena de la primera fuente que lo tenga (orden de prioridad por campo) y guarda de qué fuente salió. Si mañana una fuente cambia o bloquea, las demás siguen cubriendo: el sistema no depende de nadie en exclusiva.

## 3. Cómo evitar bloqueos (sin gastar dinero)

Con cientos de fondos y ejecución manual el riesgo es bajo si el script se comporta como un usuario educado: máximo 1–2 peticiones/segundo con pausa aleatoria, sesión HTTP persistente con cookies, User-Agent de navegador real, cabecera Referer correcta, reintentos con espera exponencial y **caché en disco** (si un fondo se actualizó hace menos de N días, no se vuelve a pedir — esto solo ya reduce el 90% del tráfico). Si algún día `requests` recibe 403 por huella TLS, se cambia esa fuente a `curl_cffi` (imita el TLS de Chrome, gratis) y, como último recurso, Playwright headless solo para esa fuente. Nunca paralelizar contra el mismo dominio.

## 4. Arquitectura (0 €, sin servidor)

Python 3.11+ en tu PC. Sin base de datos externa: los JSON son la base de datos.

```
DATOS FONDOS/
├── config/
│   ├── fondos.csv          # tu lista: ISIN, nombre opcional, tipo
│   └── settings.json       # prioridades de fuente, días de caché, pausas
├── data/
│   ├── funds/{ISIN}.json   # ficha completa actual de cada fondo
│   ├── index.json          # resumen de todos (para que otras apps listen rápido)
│   └── history/{ISIN}.jsonl  # un snapshot por línea y fecha → histórico gratis
├── cache/                  # respuestas crudas con timestamp
├── logs/
└── src/
    ├── fetchers/           # justetf.py · morningstar.py · cnmv.py · ft.py · kid_pdf.py
    ├── normalize.py        # cada fetcher → esquema común
    ├── merge.py            # combina fuentes por prioridad de campo
    ├── validate.py         # rangos lógicos (TER 0–5%, fechas, sumas de cartera ≈100%)
    └── main.py             # CLI: update --all | update ISIN... | add ISIN | report
```

Flujo por ISIN: ¿caché fresca? → no: llamar fetchers en orden → normalizar → fusionar → validar → escribir `{ISIN}.json` + añadir snapshot a histórico + actualizar índice. Un fallo en un fondo no detiene el lote; al final, informe de cobertura (qué campos faltan y dónde).

## 5. Esquema JSON (por fondo)

> **Ampliación 10-06-2026:** inventario exhaustivo campo a campo en `CATALOGO_DATOS.md` (~50 bloques de Morningstar con sus endpoints exactos, justETF, CNMV, KID) y esquema completo v2 en `esquema_fondo.json`. El esquema de abajo queda como versión mínima ilustrativa.

```json
{
  "meta": { "isin": "IE00B4L5Y983", "actualizado": "2026-06-10T09:00:00Z",
            "fuentes": { "ter": "justetf", "rating": "morningstar" } },
  "identificacion": { "nombre": "iShares Core MSCI World UCITS ETF", "ticker": "SWDA",
    "tipo": "etf", "gestora": "iShares", "domicilio": "IE", "divisa": "USD",
    "fecha_lanzamiento": "2009-09-25", "categoria": "RV Global Cap. Grande",
    "indice": "MSCI World", "replicacion": "física", "distribucion": "acumulación" },
  "costes": { "ter_pct": 0.20, "comision_gestion_pct": null, "comision_exito_pct": null },
  "patrimonio": { "aum_meur": 65000, "vl": 120.83, "vl_fecha": "2026-06-10", "vl_divisa": "EUR" },
  "rentabilidad_pct": { "1m": null, "3m": null, "ytd": null, "1a": null,
                        "3a_anual": null, "5a_anual": null, "10a_anual": null,
                        "por_año": { "2025": null, "2024": null } },
  "riesgo": { "volatilidad_1a_pct": null, "volatilidad_3a_pct": null, "sharpe_3a": null,
              "max_drawdown_pct": null, "sri": null },
  "rating": { "morningstar_estrellas": null, "sostenibilidad_globos": null },
  "cartera": { "fecha": null, "num_posiciones": null,
    "top_holdings": [ { "nombre": "", "peso_pct": 0 } ],
    "sectores": { }, "regiones": { }, "asignacion": { "rv": 0, "rf": 0, "liquidez": 0 } }
}
```

Campos sin dato quedan `null` (nunca inventados). `meta.fuentes` permite auditar cada cifra.

## 6. Fases

**F1 — Núcleo (1ª sesión de trabajo):** estructura de carpetas, `fondos.csv`, fetcher justETF (ya verificado) + fetcher Morningstar screener, esquema, CLI básico. → Con esto ya obtienes ~80% de los datos para ETFs y gran parte de fondos.

**F2 — Fondos españoles e histórico:** fetcher CNMV (XML oficiales), fusión multi-fuente por campo, snapshots históricos, `index.json`.

**F3 — Huecos y robustez:** FT como fallback, extracción de KID PDF para fondos difíciles, informe de cobertura, `curl_cffi` donde haga falta.

**F4 — Opcional:** visor HTML local de los JSON; tarea programada de Windows si algún día quieres automatizar.

## 7. Costes y riesgos

**Coste: 0 €.** Todo es software libre y fuentes gratuitas; corre en tu PC. Única alternativa de pago si algún día quisieras API comercial estable: EODHD (~60 €/mes) — innecesaria ahora.

**Riesgos:** los endpoints internos no son APIs oficiales y pueden cambiar sin aviso (por eso: multi-fuente + caché + un fetcher por archivo, fácil de reparar). Uso personal de datos públicos con ritmo educado; revisa los términos de uso de cada web y evita redistribuir comercialmente los datos. Morningstar es la fuente con más probabilidad de endurecerse: la arquitectura lo asume y no depende de ella.
