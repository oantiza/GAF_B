"""
Test del read model (mapper Firestore maestro -> asset-for-bdb.v1).
Sin dependencias: ejecuta `python functions_python/tests/test_mappers.py`.
Fixtures = formas reales (recortadas) de la maestra de BDB, de la que se sembro la base de siempre.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from readmodel.mappers import map_asset_detail, map_costs


def approx(a, b, t=1e-5):
    return a is not None and abs(a - b) <= t


FUND = {
    "asset_id": "BE0946564383", "asset_type": "FUND",
    "updated_at": "2026-07-01T10:00:00Z",
    "identity": {"name": "DPAM B Equities NewGems Sustainable B Cap", "currency": "EUR"},
    "identifiers": {"isin": "BE0946564383"},
    "classification": {"asset_class": "RV", "fondosdb_asset_type": "equity", "region_primary": "global"},
    "product": {"product_type": "fund", "commercial_type": "EAA Fund Global Large-Cap Growth Equity"},
    "costs": {"management_fee_pct": 1.6, "ter_pct": 1.73, "mifid_ongoing_pct": 1.73486},
    "performance": {
        "returns": {"trailing_pct": {"ytd": {"fondo": 13.52824}, "3a_anualizada": {"fondo": 14.52422}}},
        "valuation": {"vl": 123.45, "vl_fecha": "2026-07-17", "vl_divisa": "EUR", "vl_fuente": "eodhd"},
    },
    "fundamentals": {
        "schema_version": "bdb.fundamentals-summary.v1", "source": "eodhd",
        "valuation": {"pe_trailing": 99.0},
    },
    "risk": {"volatilidad_pct": {"3a": {"fondo": 17.2645853317}}, "sharpe": {"3a": {"fondo": 0.7427874772}}, "srri_1a7": 6},
    "portfolio_exposure": {"asset_mix": {"equity": 0.977424, "bond": 0, "cash": 0.022576, "other": 0}},
}
FUND_HOLDINGS = {"data": {"holdings_count": 10, "top10_weight": 46.2989, "as_of_date": "2026-04-30"}}

ETF = {
    "asset_id": "EODHD_EEM.US", "asset_type": "ETF",
    "identity": {"name": "EEM.US", "currency": "USD"},
    "classification": {"asset_class": "ETF"},
    "identifiers": {"isin": None, "eodhd_code": "EEM.US"},
    "fundamentals": {
        "schema_version": "bdb.etf-fundamentals-summary.v1", "source": "eodhd",
        "as_of_date": "2026-07-11", "currency": "USD",
        "fund_metrics": {"total_assets": 25000000000, "ongoing_charge_pct": 0,
                         "net_expense_ratio_pct": 0.03},
        "holdings_summary": {"positions_count": 1200, "top10_weight_pct": 22.5,
                             "full_holdings_loaded": False, "coverage_status": "TOP10_ONLY"},
        "quality": {"coverage_status": "PARTIAL", "warnings": ["full_holdings_not_requested"]},
    },
}
ETF_METRICS = {"asset_id": "EODHD_EEM.US", "population": "stock", "source": "FONDOSDB_EODHD_DAILY_HISTORY",
               "updated_at": "2026-07-02T10:00:00Z", "risk_score_source": "VOL_BUCKET",
               "windows": {"3y": {"annualized_volatility": 0.28294153958398593,
                                   "sharpe_ratio": 1.163373381411962,
                                   "annualized_return": 0.14847083926031296}},
               "max_drawdown_hist": {"value": -0.13520770810298535}}

STOCK = {"asset_id": "EODHD_AMZN.US", "asset_type": "STOCK",
         "identity": {"name": "AMZN.US", "currency": "USD"}, "classification": {"asset_class": "EQUITY"},
         "risk": {"max_drawdown": {"pct": -19.6}},
         "fundamentals": {
             "schema_version": "bdb.fundamentals-summary.v1", "source": "eodhd",
             "as_of_date": "2026-06-30", "currency": "USD",
             "profile": {"sector": "Consumer Cyclical", "industry": "Internet Retail"},
             "valuation": {"market_cap": 2000000000000, "pe_trailing": 32.1, "pe_forward": 28.4},
             "profitability": {"profit_margin": 0.105, "return_on_equity_ttm": 0.24},
             "dividends": {"yield_ratio": 0.0},
             "quality": {"coverage_status": "COMPLETE", "warnings": []},
         }}
STOCK_METRICS = {"asset_id": "EODHD_AMZN.US", "population": "stock", "source": "FONDOSDB_EODHD_DAILY_HISTORY",
                 "updated_at": "2026-07-02T10:00:00Z", "risk_score_source": "VOL_BUCKET",
                 "windows": {"3y": {"annualized_volatility": 0.308, "sharpe_ratio": 0.661,
                                     "annualized_return": 0.086}},
                 "max_drawdown_hist": {"value": -0.196}}

INDEX = {"asset_id": "EODHD:GSPC.INDX", "asset_type": "INDEX",
         "identity": {"name": "S&P 500 Index Proxy", "currency": "USD"}, "classification": {"asset_class": "INDEX"}}

ETC = {
    "asset_id": "IE00B4ND3602", "asset_type": "OTHER",
    "identity": {"name": "iShares Physical Gold ETC", "currency": "USD"},
    "identifiers": {"isin": "IE00B4ND3602"},
    "classification": {"asset_class": "Otros", "fondosdb_asset_type": "other"},
    "product": {"product_type": "ETC", "commercial_type": "Materias Primas - Metales Preciosos"},
}

ok = 0


def check(cond, msg):
    global ok
    assert cond, "FALLO: " + msg
    ok += 1
    print("  ok:", msg)


def run():
    global ok
    ok = 0
    print("== FUND ==")
    f = map_asset_detail(FUND, None, FUND_HOLDINGS)
    check(f["instrument_type"] == "FUND", "instrument_type FUND")
    check(f["economic_asset_class"] == "EQUITY", "economic EQUITY (RV)")
    check(approx(f["costs"]["ongoing_charge"], 0.0173), "ter 1.73% -> 0.0173")
    check(approx(f["costs"]["management_fee"], 0.016), "mgmt 1.6% -> 0.016")
    check(approx(f["metrics"]["volatility_3y"], 0.172646), "vol_3y 17.26% -> 0.1726")
    check(approx(f["metrics"]["sharpe_3y"], 0.7428), "sharpe_3y 0.7428")
    check(approx(f["metrics"]["annualized_return_3y"], 0.145242), "ret_3y 14.52% -> 0.1452")
    check(approx(f["metrics"]["ytd_return"], 0.135282), "ytd 13.53% -> 0.1353")
    check(f["performance_preview"]["ytd_return"] == f["metrics"]["ytd_return"], "performance_preview incluye ytd")
    check(f["identity"]["region"] == "Global", "region_primary primero")
    check(f["category"] == "EAA Fund Global Large-Cap Growth Equity", "categoria comercial como fallback trazable")
    check(f["updated_at"] == "2026-07-01T10:00:00Z", "updated_at expuesto")
    check(f["metrics"]["risk_score"] == 6, "risk_score = srri 6")
    check(f["holdings_summary"]["has_holdings"] and f["holdings_summary"]["positions_count"] == 10, "holdings 10")
    check(approx(f["pms_exposure"]["equity"], 0.977424) and f["pms_exposure"]["source"] == "PORTFOLIO_EXPOSURE", "pms equity")
    check(f["performance_preview"]["available"] is True and approx(f["performance_preview"]["annualized_return_3y"], 0.145242), "performance_preview agregado")
    check(approx(f["performance_preview"]["latest_value"], 123.45) and f["performance_preview"]["source"] == "eodhd", "VL EODHD expuesto sin fundamentales de fondo")
    check(f["fundamentals_summary"] is None and "fundamentals" not in f["available_sections"], "fundamentales EODHD de fondo bloqueados en lectura")
    check("performance_preview" in f["available_sections"], "available_sections incluye performance_preview")
    check(f["data_quality_summary"]["has_metrics"] is True and f["data_quality_summary"]["coverage_status"] == f["coverage_status"], "data_quality_summary contractual")
    check(f["is_investable"] and f["role"] == "INVESTABLE", "fondo invertible")
    check("NON_INVESTABLE_BENCHMARK" not in f["quality_flags"], "fondo NO benchmark")

    print("== ETF ==")
    e = map_asset_detail(ETF, ETF_METRICS, None)
    check(e["instrument_type"] == "ETF", "instrument_type ETF")
    check(approx(e["metrics"]["volatility_3y"], 0.282942), "vol desde metrics/latest")
    check(approx(e["metrics"]["annualized_return_3y"], 0.148471), "ret desde window 3y")
    check(e["costs"] is None, "ETF fino sin costes")
    check(e["fundamentals_summary"]["fund_metrics"]["total_assets"] == 25000000000, "ETF expone resumen fundamental")
    check(approx(e["fundamentals_summary"]["fund_metrics"]["net_expense_ratio_pct"], 0.03), "ETF conserva expense ratio normalizado")
    check("fundamentals" in e["available_sections"], "ETF anuncia sección fundamentals")
    check(e["is_investable"], "ETF invertible")

    print("== STOCK ==")
    s = map_asset_detail(STOCK, STOCK_METRICS, None)
    check(s["instrument_type"] == "STOCK" and s["economic_asset_class"] == "EQUITY", "STOCK/EQUITY")
    check(approx(s["metrics"]["volatility_3y"], 0.308), "STOCK usa metrics/latest aunque root.risk solo tenga max_drawdown")
    check(s["costs"] is None, "STOCK sin costes (permitido)")
    check(approx(s["fundamentals_summary"]["valuation"]["pe_trailing"], 32.1), "STOCK expone PER EODHD")
    check(approx(s["fundamentals_summary"]["profitability"]["return_on_equity_ttm"], 0.24), "STOCK expone ROE EODHD")
    check(s["data_quality_summary"]["has_fundamentals"] is True, "calidad declara fundamentales disponibles")
    check(s["is_investable"], "STOCK invertible")

    print("== INDEX ==")
    i = map_asset_detail(INDEX, None, None)
    check(i["instrument_type"] == "INDEX", "instrument_type INDEX")
    check((not i["is_investable"]) and i["role"] == "BENCHMARK", "INDEX no invertible / benchmark")
    check("NON_INVESTABLE_BENCHMARK" in i["quality_flags"], "INDEX flag benchmark")
    check(i["costs"] is None, "INDEX sin costes")
    check("proxy_note" in i["available_sections"], "INDEX incluye proxy_note")

    print("== ETC / OTHER ==")
    o = map_asset_detail(ETC, None, None)
    check(o["instrument_type"] == "ETF", "ETC se normaliza como producto cotizado ETF-compatible")
    check(o["economic_asset_class"] == "COMMODITIES", "el oro es materias primas, no «Otros» (decision 13)")
    check(o["is_investable"], "ETC invertible si no es benchmark")

    print(f"\nTODOS OK: {ok} comprobaciones pasaron.")


def test_readmodel_mappers_contract_checks():
    run()


if __name__ == "__main__":
    run()


# --- Perfil de renta fija (plan «Mejorar cartera», fase 1) -----------------

RF_FUND = {
    "asset_id": "DE000A0X7541", "asset_type": "FUND",
    "identity": {"name": "Fondo RF Flexible", "currency": "EUR"},
    "identifiers": {"isin": "DE000A0X7541"},
    "classification": {"asset_class": "RF", "fondosdb_asset_type": "fixed_income"},
    "product": {"product_type": "fund"},
    "fixed_income_profile": {
        "effective_duration": 3.79, "modified_duration": 3.79, "effective_maturity": 8.76,
        "avg_credit_quality": " BBB+ ", "yield_to_maturity": 3.62,
        "investment_grade_pct": 54.49, "high_yield_pct": 41.83,
        "bond_sectors": {"ignorado": 1},
    },
    "portfolio_exposure": {
        "asset_mix": {"equity": 0, "bond": 0.78, "cash": 0.22, "other": 0},
        "bond_types": {"corporate": 0.540825, "cash": 0.22268, "government": 0.236494, "securitized": 0},
    },
}


def test_fixed_income_profile_fondo_rf_en_fraccion():
    f = map_asset_detail(RF_FUND, None, None)
    p = f["fixed_income_profile"]
    assert p is not None
    assert approx(p["effective_duration"], 3.79) and approx(p["effective_maturity"], 8.76)
    assert p["avg_credit_quality"] == "BBB+"
    assert approx(p["yield_to_maturity"], 0.0362), "TIR en fraccion"
    assert approx(p["investment_grade_pct"], 0.5449) and approx(p["high_yield_pct"], 0.4183), "IG/HY en fraccion"
    assert p["bond_types"] == {"corporate": 0.540825, "cash": 0.22268, "government": 0.236494}, "ceros fuera"
    assert "bond_sectors" not in p, "solo las claves del contrato"


def test_fixed_income_profile_con_bond_types_neto_sirve_lo_positivo():
    """C-31 (21-11-2026): la base nueva guarda el mapa neto, y aqui se sirven solo sus partes > 0.

    Los dos casos son del canonico del 17-11: UBS Duracion 0-2 (ES0126547035), con la liquidez a -4,87 %
    y el resto sumando 1,049, y FON Fineco Inversion (ES0137396000), con la liquidez a 105 % y el gobierno
    a -5 %. No rompe ninguno, y la parte por encima de 1 pasa tal cual.
    """
    root = dict(RF_FUND)
    root["portfolio_exposure"] = {
        **RF_FUND["portfolio_exposure"],
        "bond_types": {"government": 0.095618, "corporate": 0.90365, "securitized": 0.049477, "cash": -0.048737},
    }
    p = map_asset_detail(root, None, None)["fixed_income_profile"]
    assert p["bond_types"] == {"government": 0.095618, "corporate": 0.90365, "securitized": 0.049477}

    root["portfolio_exposure"] = {
        **RF_FUND["portfolio_exposure"],
        "bond_types": {"government": -0.049955, "corporate": -0.000007, "securitized": -0.000002, "cash": 1.049964},
    }
    p = map_asset_detail(root, None, None)["fixed_income_profile"]
    assert p["bond_types"] == {"cash": 1.049964}


def test_fixed_income_profile_con_derivados_y_municipal_los_sirve_como_otra_clave():
    """C-33 (21-11-2026): el tipo de emisor trae tambien `municipal` y `derivative`, y no rompe nada.

    Las claves no tienen lista ni aqui ni en el contrato de lectura (`number_map`): pasan como las demas, y
    solo las partes > 0. Gestion Talento (ES0141991002) y Abante Seleccion (ES0162946034), del canonico
    que sale de las fichas del 17-11 con el adaptador nuevo.
    """
    root = dict(RF_FUND)
    root["portfolio_exposure"] = {
        **RF_FUND["portfolio_exposure"],
        "bond_types": {"government": 0.367105, "corporate": 0.060236, "cash": -1.340189, "derivative": 1.912847},
    }
    p = map_asset_detail(root, None, None)["fixed_income_profile"]
    assert p["bond_types"] == {"government": 0.367105, "corporate": 0.060236, "derivative": 1.912847}

    root["portfolio_exposure"] = {
        **RF_FUND["portfolio_exposure"],
        "bond_types": {"government": 0.420698, "municipal": 0.000013, "corporate": 0.478256,
                       "securitized": 0.196899, "cash": -0.091183, "derivative": -0.004682},
    }
    p = map_asset_detail(root, None, None)["fixed_income_profile"]
    assert p["bond_types"] == {"government": 0.420698, "municipal": 0.000013, "corporate": 0.478256,
                               "securitized": 0.196899}


def test_fixed_income_profile_fondo_rv_con_mapa_a_cero_queda_sin_perfil():
    root = dict(FUND)
    root["portfolio_exposure"] = {
        **FUND["portfolio_exposure"],
        "bond_types": {"government": 0, "corporate": 0, "securitized": 0, "cash": 0},
    }
    root["fixed_income_profile"] = {"bond_sectors": {}, "avg_credit_quality": None, "effective_duration": None}
    f = map_asset_detail(root, None, None)
    assert "fixed_income_profile" in f and f["fixed_income_profile"] is None


def test_fixed_income_profile_ausente_y_no_fondos():
    assert map_asset_detail(FUND, None, None)["fixed_income_profile"] is None
    s = map_asset_detail(STOCK, STOCK_METRICS, None)
    i = map_asset_detail(INDEX, None, None)
    assert s["fixed_income_profile"] is None and i["fixed_income_profile"] is None


# --- NUEVO-B1 (16-10-2026): «Ultimo dato» parado frente a la serie ------------------------

AENA = {
    "asset_id": "ES0105046009", "asset_type": "STOCK",
    "identity": {"name": "Aena SME", "currency": "EUR"}, "identifiers": {"isin": "ES0105046009"},
    "classification": {"asset_class": "EQUITY"},
    "performance": {"valuation": {"vl": 26.66, "vl_fecha": "2026-06-22", "vl_divisa": "EUR"}},
}
AENA_METRICS = {"asset_id": "ES0105046009", "population": "stock", "source": "FONDOSDB_EODHD_DAILY_HISTORY",
                "updated_at": "2026-10-16T07:00:00Z", "risk_score_source": "VOL_BUCKET",
                "first_date": "2016-01-04", "last_date": "2026-10-15", "ytd_return": 0.1234,
                "windows": {"3y": {"annualized_volatility": 0.2, "sharpe_ratio": 0.5, "annualized_return": 0.12}}}


def test_un_vl_de_junio_no_se_ensena_como_ultimo_dato_si_la_serie_llega_a_ayer():
    p = map_asset_detail(AENA, AENA_METRICS, None)["performance_preview"]
    assert p["latest_value"] is None
    assert p["latest_value_date"] == "2026-10-15"  # la fecha de la serie de la que sale el YTD
    assert p["ytd_return"] == 0.1234
    assert p["source"] == "FONDOSDB_EODHD_DAILY_HISTORY" and p["available"] is True


def test_un_vl_al_dia_o_con_pocos_dias_de_retraso_se_sigue_ensenando():
    for vl_fecha in ("2026-10-15", "2026-10-08"):  # mismo dia y justo 7 dias
        root = {**AENA, "performance": {"valuation": {**AENA["performance"]["valuation"], "vl_fecha": vl_fecha}}}
        p = map_asset_detail(root, AENA_METRICS, None)["performance_preview"]
        assert p["latest_value"] == 26.66 and p["latest_value_date"] == vl_fecha, vl_fecha


def test_sin_metrics_latest_o_sin_fechas_no_se_juzga_el_vl():
    assert map_asset_detail(AENA, None, None)["performance_preview"]["latest_value"] == 26.66
    sin_fecha = {**AENA_METRICS}
    sin_fecha.pop("last_date")
    assert map_asset_detail(AENA, sin_fecha, None)["performance_preview"]["latest_value"] == 26.66
    # El fondo del fixture (VL de EODHD) sigue igual con su serie al dia.
    fondo = map_asset_detail(FUND, {**AENA_METRICS, "asset_id": FUND["asset_id"], "last_date": "2026-07-17"}, FUND_HOLDINGS)
    assert fondo["performance_preview"]["latest_value"] == 123.45


def test_el_preview_sin_vl_sigue_cumpliendo_el_contrato():
    import json
    from pathlib import Path
    from jsonschema import Draft202012Validator
    schema = json.loads((Path(__file__).resolve().parents[1] / "contracts_cache" / "asset-for-bdb.v1.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(map_asset_detail(AENA, AENA_METRICS, None))


def test_fixed_income_profile_parcial_y_valores_invalidos():
    root = dict(RF_FUND)
    root["fixed_income_profile"] = {"avg_credit_quality": "AA-", "investment_grade_pct": 180, "high_yield_pct": "n/d"}
    root["portfolio_exposure"] = {"asset_mix": {"bond": 1}}
    p = map_asset_detail(root, None, None)["fixed_income_profile"]
    assert p == {"avg_credit_quality": "AA-"}, p


# --- Decision 43: manda el KID, con su fecha, y donde no lo haya, el proveedor. Cifra a cifra. ---

KID_VIEJO = {"url": "https://ejemplo.invalid/kid.pdf", "sha256": "a" * 64, "date": "2026-04-22"}


def test_base_vieja_manda_el_kid_cifra_a_cifra():
    # BlackRock A2: 1,81 % de TER frente a 1,01 % en el KID.
    c = map_costs({"costs": {"ter_pct": 1.81, "mifid_ongoing_pct": 1.01, "management_fee_pct": 0.8, "ongoing_costs_kid_pct": 1.01,
                             "transaction_costs_pct": 0.4, "entry_fee_max_pct": 5, "kid_evidence": KID_VIEJO}})
    assert c == {"ongoing_charge": 0.0101, "management_fee": 0.008, "transaction_costs": 0.004, "entry_charge": 0.05,
                 "document_url": KID_VIEJO["url"], "document_date": "2026-04-22",
                 "ongoing_charge_source": "KID", "transaction_costs_source": "KID", "entry_charge_source": "KID"}


def test_base_vieja_sin_kid_el_proveedor_y_nada_mas():
    c = map_costs({"costs": {"management_fee_pct": 0.2, "ter_pct": 0.2, "mifid_ongoing_pct": 0.2}})
    assert c == {"ongoing_charge": 0.002, "management_fee": 0.002, "ongoing_charge_source": "PROVIDER"}


def test_base_vieja_sin_ter_cae_al_mifid_y_es_del_proveedor():
    assert map_costs({"costs": {"mifid_ongoing_pct": 1.5}})["ongoing_charge"] == 0.015
    assert map_costs({"costs": {"mifid_ongoing_pct": 1.5}})["ongoing_charge_source"] == "PROVIDER"


def test_base_vieja_no_se_cree_lo_que_se_sabe_que_se_leyo_mal():
    # Santalucia, 0 %; Xtrackers, 82 %; PIMCO, un 0 % de entrada donde el KID dice 492 EUR.
    c = map_costs({"costs": {"ter_pct": 2.08, "ongoing_costs_kid_pct": 0, "transaction_costs_pct": 82, "entry_fee_max_pct": 0, "kid_evidence": KID_VIEJO}})
    assert c["ongoing_charge"] == 0.0208 and c["ongoing_charge_source"] == "PROVIDER"
    assert "transaction_costs" not in c and "transaction_costs_source" not in c
    assert "entry_charge" not in c and "entry_charge_source" not in c
    assert c["document_date"] == "2026-04-22"


def test_base_vieja_sin_documento_no_es_kid():
    c = map_costs({"costs": {"ter_pct": 1.81, "ongoing_costs_kid_pct": 1.01, "transaction_costs_pct": 0.4}})
    assert c == {"ongoing_charge": 0.0181, "ongoing_charge_source": "PROVIDER"}


def test_base_vieja_un_kid_sin_fecha_no_se_inventa_una():
    c = map_costs({"costs": {"ongoing_costs_kid_pct": 1.87, "kid_evidence": {"url": "x", "sha256": "a" * 64}}})
    assert c["ongoing_charge_source"] == "KID" and "document_date" not in c


def test_base_nueva_ya_viene_decidido_y_no_se_vuelve_a_elegir():
    c = map_costs({"costs": {"ter_pct": 2.08, "management_fee_pct": 1.5, "transaction_costs_pct": 0.37, "entry_fee_max_pct": None,
                             "document_date": "2026-08-19", "document_url": "https://ejemplo.invalid/k.pdf",
                             "ongoing_charge_source": "KID", "transaction_costs_source": "PROVIDER", "entry_charge_source": None}})
    assert c == {"ongoing_charge": 0.0208, "management_fee": 0.015, "transaction_costs": 0.0037, "document_date": "2026-08-19",
                 "document_url": "https://ejemplo.invalid/k.pdf", "ongoing_charge_source": "KID", "transaction_costs_source": "PROVIDER"}


def test_la_operacion_de_un_etf_no_se_redondea_a_cero():
    # iShares, 0,00263 %: a seis decimales saldria 0,000026, y la cifra de la cartera se moveria un centimo sobre 100.000 EUR.
    c = map_costs({"costs": {"ter_pct": 0.2, "transaction_costs_pct": 0.00263, "ongoing_charge_source": "PROVIDER", "transaction_costs_source": "PROVIDER"}})
    assert c["transaction_costs"] == 0.0000263


def test_una_accion_sigue_sin_costes():
    root = {"asset_type": "STOCK", "costs": {"ter_pct": 1.0}}
    assert map_asset_detail(root)["costs"] is None


def test_la_replica_del_proveedor_viaja_con_el_activo():
    # 12-11-2026: el solapamiento la necesita para decir que un ETF por swap replica con una permuta y no que «no publica».
    sintetico = {**ETF, "product": {"domicile": "IE", "legal_structure": "UCITS", "replication": "SYNTHETIC"}}
    assert map_asset_detail(sintetico)["product"] == {"replication": "SYNTHETIC"}


def test_sin_replica_no_hay_bloque_de_producto():
    assert "product" not in map_asset_detail(FUND)
    assert "product" not in map_asset_detail({**ETF, "product": {"replication": "  "}})
