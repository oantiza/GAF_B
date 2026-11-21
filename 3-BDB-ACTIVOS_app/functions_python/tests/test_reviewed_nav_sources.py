from copy import deepcopy
from datetime import date, datetime, timezone
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from reviewed_nav_sources import (validate_native_append, convert_ecb, parse_schroders,
                                  parse_blackrock, parse_ft)


def fixture():
    points = [{"date":f"2026-10-{d:02}","value":100+d} for d in range(5,10)]
    config = dict(currency="USD",provider="markit_ft",source_listing_id="MARKIT_FT:123")
    series = dict(asset_id="A",series_type="NAV",currency="EUR",source_currency="USD",
                  source_listing_id=config["source_listing_id"],last_date="2026-10-09",
                  points=[{**p,"value":p["value"]/1.2,"source_value":p["value"]} for p in points])
    return series,points,config


def test_native_overlap_and_ecb_conversion_preserve_original_currency():
    series,points,config=fixture()
    points += [{"date":"2026-10-12","value":110}]
    plan=validate_native_append("A",series,points,points[-1],date(2026,10,13),config)
    raw=b'<root><Cube time="2026-10-09"><Cube currency="USD" rate="1.25"/></Cube></root>'
    result=convert_ecb(plan["append_only_points"],"USD",raw)
    assert result[0]["value"]==88 and result[0]["source_value"]==110
    # La divisa de origen vive en el documento de serie, no repetida en cada punto.
    assert result[0]["fx_rate"]==1.25 and "source_currency" not in result[0]


@pytest.mark.parametrize("change",["currency","listing","native_missing","disagreement","last_missing","short_overlap"])
def test_rejects_unverified_identity_and_overlap(change):
    series,points,config=fixture()
    if change=="currency":series["source_currency"]="EUR"
    elif change=="listing":series["source_listing_id"]="OTHER:123"
    elif change=="native_missing":del series["points"][0]["source_value"]
    elif change=="disagreement":points[0]["value"]+=1
    elif change=="last_missing":points=points[:-1]
    else:points=points[-3:]
    with pytest.raises((ValueError,KeyError)):
        validate_native_append("A",series,points,points[-1],date(2026,10,10),config)


def test_only_published_non_dealing_days_allow_long_gap():
    series,points,config=fixture()
    points += [{"date":"2026-10-19","value":110}]
    with pytest.raises(ValueError,match="Gap"):
        validate_native_append("A",series,points,points[-1],date(2026,10,19),config)
    config["verified_non_dealing_days"]=[f"2026-10-{d}" for d in range(12,17)]
    assert validate_native_append("A",series,points,points[-1],date(2026,10,19),config)["overlap_checks"]==5


@pytest.mark.parametrize("raw",[b'<root/>',b'<root><Cube time="2026-09-01"><Cube currency="USD" rate="1.2"/></Cube></root>',b'<root><Cube time="2026-10-09"><Cube currency="USD" rate="0"/></Cube></root>'])
def test_missing_stale_and_zero_fx_are_rejected(raw):
    with pytest.raises(ValueError):convert_ecb([{"date":"2026-10-12","value":100}],"USD",raw)


def test_schroders_accepts_unpadded_dates_but_rejects_disagreement():
    node=dict(date=int(datetime(2026,10,9,tzinfo=timezone.utc).timestamp()*1000),
              title="9.10.2026",value=123,valueFormatted='<span>PLN</span>')
    assert parse_schroders(json.dumps([{"children":[node]}]))[1]["date"]=="2026-10-09"
    node["title"]="8.10.2026"
    with pytest.raises(ValueError,match="date mismatch"):parse_schroders(json.dumps([node]))


def test_blackrock_requires_exact_share_class_and_currency():
    cells=["A2","EUR","15.00","0","0","16-Oct-2026","15","13","LU123"]
    html='<table><tr>'+''.join('<td>'+c+'</td>' for c in cells)+'</tr></table>'
    html+='var navData = [{x:Date.UTC(2026,9,16),y:Number((15.00).toFixed(2))}];'
    points,quote=parse_blackrock(html,"LU123","EUR")
    assert points==[quote]
    with pytest.raises(ValueError):parse_blackrock(html,"LU456","EUR")
    with pytest.raises(ValueError):parse_blackrock(html,"LU123","USD")


def test_ft_refuses_a_missing_share_class():
    with pytest.raises(ValueError,match="share class"):
        parse_ft('<html>generic page</html>',"LU123","EUR","MARKIT_FT:123")
