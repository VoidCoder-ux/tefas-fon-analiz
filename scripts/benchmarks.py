"""Kiyaslama (benchmark) serileri: BIST 100, USD/TRY, gram altin, TUFE.

Kaynaklar:
  * Yahoo Finance chart API  -> XU100.IS, USDTRY=X, GC=F  (anahtar gerekmez)
  * TCMB EVDS                -> TUFE (yalnizca EVDS_API_KEY tanimliysa)

Gram altin TL, ons altin (USD) ve USD/TRY'den turetilir:
    gram_altin = ons_usd / 31.1034768 * usdtry
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import os
import urllib.error
import urllib.parse
import urllib.request

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
EVDS_URL = "https://evds2.tcmb.gov.tr/service/evds/series={series}&startDate={start}&endDate={end}&type=json"

TROY_OUNCE_GRAMS = 31.1034768

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _get_json(url: str, headers: dict | None = None, timeout: int = 45) -> dict:
    hdr = {"User-Agent": _UA, "Accept": "application/json, */*", "Accept-Encoding": "gzip"}
    if headers:
        hdr.update(headers)
    req = urllib.request.Request(url, headers=hdr)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))


def yahoo_series(symbol: str, start: dt.date, end: dt.date) -> dict[str, float]:
    """Yahoo Finance'ten gunluk kapanis serisi ({'YYYY-MM-DD': deger})."""
    params = urllib.parse.urlencode({
        "period1": int(dt.datetime.combine(start, dt.time.min).timestamp()),
        "period2": int(dt.datetime.combine(end + dt.timedelta(days=1), dt.time.min).timestamp()),
        "interval": "1d",
        "events": "history",
    })
    data = _get_json(f"{YAHOO_URL.format(symbol=symbol)}?{params}")
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        return {}
    node = result[0]
    stamps = node.get("timestamp") or []
    quote = (node.get("indicators") or {}).get("quote") or [{}]
    closes = quote[0].get("close") or []
    out: dict[str, float] = {}
    for ts, close in zip(stamps, closes):
        if close is None:
            continue
        # Yahoo zaman damgasi borsanin yerel gunudur; UTC gunu yeterince dogru.
        day = dt.datetime.utcfromtimestamp(ts).date().isoformat()
        out[day] = float(close)
    return out


def _forward_fill(series: dict[str, float], days: list[str]) -> dict[str, float]:
    """Eksik gunleri bir onceki gecerli degerle doldurur."""
    out: dict[str, float] = {}
    last: float | None = None
    for day in days:
        if day in series:
            last = series[day]
        if last is not None:
            out[day] = last
    return out


def tufe_series(start: dt.date, end: dt.date) -> dict[str, float]:
    """TCMB EVDS'ten TUFE endeksi (aylik). EVDS_API_KEY yoksa bos doner."""
    key = os.environ.get("EVDS_API_KEY", "").strip()
    if not key:
        return {}
    url = EVDS_URL.format(
        series="TP.FG.J0",
        start=start.strftime("%d-%m-%Y"),
        end=end.strftime("%d-%m-%Y"),
    )
    try:
        data = _get_json(url, headers={"key": key})
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as exc:
        print(f"  TUFE cekilemedi ({exc}) - enflasyon kiyasi atlandi", flush=True)
        return {}
    out: dict[str, float] = {}
    for item in data.get("items", []):
        raw_date = item.get("Tarih")      # "2026-8" veya "08-2026"
        value = item.get("TP_FG_J0")
        if not raw_date or value in (None, "", "null"):
            continue
        parts = str(raw_date).replace(".", "-").split("-")
        try:
            if len(parts[0]) == 4:
                year, month = int(parts[0]), int(parts[1])
            else:
                month, year = int(parts[0]), int(parts[1])
            # Ay basina yaz; gunluk seriye ileri-doldurma ile yayilir.
            out[dt.date(year, month, 1).isoformat()] = float(value)
        except (ValueError, IndexError):
            continue
    return out


def collect(start: dt.date, end: dt.date, days: list[str]) -> dict:
    """Tum kiyaslama serilerini toplayip takvim gunlerine hizalar.

    `days` portfoy takviminin gunleridir (TEFAS'in veri urettigi gunler).
    Her seri bu gunlere ileri-doldurma ile hizalanir, boylece on uc
    tarafinda hizalama yapmak gerekmez.
    """
    series: dict[str, dict] = {}

    def add(key: str, label: str, unit: str, raw: dict[str, float]) -> None:
        if not raw:
            print(f"  {label}: veri yok, atlandi", flush=True)
            return
        aligned = _forward_fill(raw, days)
        if not aligned:
            return
        series[key] = {
            "label": label,
            "unit": unit,
            "values": [round(aligned.get(d), 6) if aligned.get(d) is not None else None
                       for d in days],
        }
        print(f"  {label}: {len(raw)} ham nokta -> {len(aligned)} hizali gun", flush=True)

    try:
        bist = yahoo_series("XU100.IS", start, end)
    except Exception as exc:                                    # noqa: BLE001
        print(f"  BIST 100 cekilemedi: {exc}", flush=True)
        bist = {}
    try:
        usdtry = yahoo_series("USDTRY=X", start, end)
    except Exception as exc:                                    # noqa: BLE001
        print(f"  USD/TRY cekilemedi: {exc}", flush=True)
        usdtry = {}
    try:
        gold_usd = yahoo_series("GC=F", start, end)
    except Exception as exc:                                    # noqa: BLE001
        print(f"  Ons altin cekilemedi: {exc}", flush=True)
        gold_usd = {}

    add("BIST100", "BIST 100", "puan", bist)
    add("USDTRY", "Dolar/TL", "TL", usdtry)

    # Gram altin: iki seriyi ortak gunlerde birlestir, sonra hizala.
    if gold_usd and usdtry:
        usd_ff = _forward_fill(usdtry, sorted(set(usdtry) | set(gold_usd)))
        gram = {
            day: value / TROY_OUNCE_GRAMS * usd_ff[day]
            for day, value in gold_usd.items()
            if day in usd_ff
        }
        add("GRAMALTIN", "Gram Altin", "TL", gram)

    add("TUFE", "TUFE (Enflasyon)", "endeks", tufe_series(start, end))
    return series
