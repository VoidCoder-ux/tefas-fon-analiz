#!/usr/bin/env python3
"""Tam derleme gerekip gerekmediğine karar veren hafif ön kontrol.

Neden var
---------
TEFAS fon pay fiyatları her işlem günü sabah Takasbank sistemine tanımlanır;
Takasbank TEFAS Uygulama Esasları MADDE 13(2) uyarınca saat 09:30 itibarıyla
fiyatı tanımlanmamış fonlar için operatör üyesine uyarı gider. Yani günün
fiyatı 09:00-09:30 (TR) aralığında yayımlanmış oluyor.

Sorun, GitHub Actions'ın zamanlanmış işleri en iyi çaba ile çalıştırması:
tek bir cron 40 dakikaya varan gecikmeyle tetiklenebiliyor, yoğun saatlerde
büsbütün atlanabiliyor. Bu yüzden sabah boyunca sık aralıklarla yoklama
yapıyoruz. Her yoklamada 5 dakikalık tam derlemeyi çalıştırmak israf olur;
bu betik saniyeler içinde şu üç soruyu yanıtlayıp kararı veriyor:

  1. Yayındaki site zaten bugünün fiyatını gösteriyor mu?   -> derleme yok
  2. TEFAS bugünün fiyatını yayımlamış mı?                   -> yoksa derleme yok
  3. İkisi de değilse                                        -> derle ve yayınla

Çıktı GitHub Actions'a `run=true|false` olarak yazılır.

Kullanım
--------
    python scripts/check_fresh.py                  # sabah yoklaması
    python scripts/check_fresh.py --force-refresh  # akşam doğrulama turu
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tefas import Tefas                             # noqa: E402

TR = ZoneInfo("Europe/Istanbul")

# Yayındaki meta.json'u okurken CDN önbelleğine takılmamak için başlık.
_NO_CACHE = {"Cache-Control": "no-cache", "Pragma": "no-cache",
             "User-Agent": "tefas-fon-analiz/ci"}


def published_last_date(url: str) -> str | None:
    """Yayındaki sitenin son fiyat gününü döndürür (okunamazsa None)."""
    try:
        req = urllib.request.Request(url, headers=_NO_CACHE)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8")).get("lastDataDate")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        print(f"Yayındaki meta.json okunamadı ({exc}); güncel değilmiş gibi davranılıyor")
        return None


def tefas_has(day: dt.date, delay: float) -> bool:
    """TEFAS verilen gün için fiyat yayımlamış mı?"""
    client = Tefas(delay=delay, max_retry=3, verbose=False)
    for _ in client.prices("YAT", day, day):
        return True
    return False


def emit(run: bool, reason: str) -> int:
    print(f"{'DERLE' if run else 'ATLA'}: {reason}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"run={'true' if run else 'false'}\n")
            fh.write(f"reason={reason}\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Derleme gerekli mi?")
    parser.add_argument("--site-url", default=os.environ.get("SITE_URL", ""),
                        help="Yayındaki sitenin kök adresi")
    parser.add_argument("--force-refresh", action="store_true",
                        help="Site güncel olsa da yeniden derle (fiyat düzeltmelerini yakalar)")
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()

    now = dt.datetime.now(TR)
    today = now.date()
    print(f"Türkiye saati: {now:%Y-%m-%d %H:%M}")

    if today.weekday() >= 5:
        return emit(False, "hafta sonu, TEFAS fiyat yayımlamıyor")

    if not args.force_refresh:
        meta_url = args.site_url.rstrip("/") + "/data/meta.json"
        last = published_last_date(meta_url)
        print(f"Yayındaki son fiyat günü: {last or 'bilinmiyor'}")
        if last and last >= today.isoformat():
            return emit(False, f"site zaten {last} fiyatını gösteriyor")

    if not tefas_has(today, args.delay):
        return emit(False, f"TEFAS {today} için fiyat yayımlamamış (tatil ya da henüz erken)")

    return emit(True, f"TEFAS {today} fiyatlarını yayımlamış, site güncellenecek")


if __name__ == "__main__":
    raise SystemExit(main())
