"""TEFAS yeni resmi API'si icin istemci (yalnizca Python standart kutuphanesi).

TEFAS 2026'da eski /api/DB/BindHistory* uclarini kapatti. Bu modul guncel
/api/funds/* uclarini kullanir. Kimlik dogrulama gerektirmez.

Onemli kisitlar:
  * Tek istekte en fazla ~1 ay veri donuyor -> 28 gunluk parcalara boluyoruz.
  * Kaba bir hiz siniri var -> istekler arasi bekleme + 429'da ustel geri cekilme.
  * HTML sayfalari WAF (F5) arkasinda ama /api/funds/* uclari serbest.
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import time
import urllib.error
import urllib.request

INFO_URL = "https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir"
DIST_URL = "https://www.tefas.gov.tr/api/funds/dagilimSiraliGetirT"
# Resmi semsiye fon turleri (kategori eslemesi icin).
TYPES_URL = "https://www.tefas.gov.tr/api/funds/fonTurGetir"

# Tek istekte istenecek azami gun sayisi (API ~30 gun sinirli, 28 guvenli esik).
MAX_DAYS_PER_REQUEST = 28

# Fon tipleri: yatirim, emeklilik, borsa yatirim, gayrimenkul, girisim sermayesi.
FUND_KINDS = ("YAT", "EMK", "BYF", "GYF", "GSYF")

KIND_LABELS = {
    "YAT": "Yatırım Fonu",
    "EMK": "Emeklilik Fonu",
    "BYF": "Borsa Yatırım Fonu",
    "GYF": "Gayrimenkul Yatırım Fonu",
    "GSYF": "Girişim Sermayesi Yatırım Fonu",
}

_HEADERS = {
    "Accept": "*/*",
    "Content-Type": "application/json",
    "Origin": "https://www.tefas.gov.tr",
    "Referer": "https://www.tefas.gov.tr/tr/fon-verileri",
    "Accept-Encoding": "gzip",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    ),
}

# TEFAS bazen tatil/hafta sonu icin hata mesaji donuyor; bunlar "veri yok" demek.
_EMPTY_MARKERS = ("out of bounds", "veri bulunamadi", "veri bulunamadı")


class TefasError(RuntimeError):
    """TEFAS API'sinden donen hata."""


def _post(url: str, body: dict, timeout: int = 90) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), headers=_HEADERS
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))


def _chunks(start: dt.date, end: dt.date, max_days: int):
    cur = start
    while cur <= end:
        stop = min(cur + dt.timedelta(days=max_days - 1), end)
        yield cur, stop
        cur = stop + dt.timedelta(days=1)


class Tefas:
    """TEFAS API istemcisi.

    Parameters
    ----------
    delay : float
        Ardisik istekler arasinda beklenecek saniye (hiz sinirina saygi).
    max_retry : int
        Gecici hatalarda azami yeniden deneme sayisi.
    """

    # 429 alindiginda taban bekleme bu carpanla artar, bu tavana kadar.
    _BACKOFF_FACTOR = 1.6
    _MAX_DELAY = 15.0

    def __init__(self, delay: float = 3.0, max_retry: int = 6, verbose: bool = True):
        self.delay = delay
        self.max_retry = max_retry
        self.verbose = verbose
        self._last_call = 0.0
        self._ok_streak = 0

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(msg, flush=True)

    def _throttle(self) -> None:
        wait = self.delay - (time.time() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.time()

    def _request(self, url: str, body: dict) -> list[dict]:
        delay = 5.0
        for attempt in range(1, self.max_retry + 1):
            self._throttle()
            try:
                data = _post(url, body)
            except urllib.error.HTTPError as exc:
                # 429 = hiz siniri, 5xx = gecici sunucu hatasi -> geri cekil ve tekrar dene.
                if exc.code in (429, 500, 502, 503, 504) and attempt < self.max_retry:
                    if exc.code == 429:
                        # Hiz sinirina takildik: taban beklemeyi kalici olarak artir,
                        # boylece kalan istekler sinira yeniden carpmaz.
                        self._ok_streak = 0
                        new_delay = min(self.delay * self._BACKOFF_FACTOR, self._MAX_DELAY)
                        if new_delay > self.delay:
                            self._log(f"    Hiz siniri: bekleme {self.delay:.1f}s -> {new_delay:.1f}s")
                            self.delay = new_delay
                    self._log(f"    HTTP {exc.code}, {delay:.0f}s sonra tekrar denenecek "
                              f"({attempt}/{self.max_retry})")
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                if attempt < self.max_retry:
                    self._log(f"    Baglanti hatasi ({exc}), {delay:.0f}s sonra tekrar")
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise

            # Ust uste basarili istek geldiyse beklemeyi yavasca geri dusur.
            self._ok_streak += 1
            if self._ok_streak >= 12 and self.delay > 1.5:
                self.delay = max(1.5, self.delay / self._BACKOFF_FACTOR)
                self._ok_streak = 0
                self._log(f"    Sorunsuz gidiyor: bekleme {self.delay:.1f}s")

            msg = data.get("errorMessage")
            code = data.get("errorCode")
            if msg and any(m in msg.lower() for m in _EMPTY_MARKERS):
                return []
            if msg or code:
                raise TefasError(f"TEFAS hatasi: {msg} (kod: {code})")
            return data.get("resultList") or []
        return []

    @staticmethod
    def _body(kind: str, start: dt.date, end: dt.date, fund_code: str | None = None) -> dict:
        return {
            "fonTipi": kind,
            "fonKodu": fund_code,
            "aramaMetni": None,
            "fonTurKod": None,
            "fonGrubu": None,
            "sfonTurKod": None,
            "fonTurAciklama": None,
            "kurucuKod": None,
            "basTarih": start.strftime("%Y%m%d"),
            "bitTarih": end.strftime("%Y%m%d"),
            "basSira": 1,
            "bitSira": 100000,
            "dil": "TR",
            "sFonTurKod": "",
            "fonKod": "",
            "fonGrup": "",
            "fonUnvanTip": "",
        }

    def prices(self, kind: str, start: dt.date, end: dt.date):
        """Verilen fon tipi ve tarih araligi icin gunluk fiyat kayitlarini uretir.

        Aralik otomatik olarak 28 gunluk parcalara bolunur.
        """
        for c_start, c_end in _chunks(start, end, MAX_DAYS_PER_REQUEST):
            rows = self._request(INFO_URL, self._body(kind, c_start, c_end))
            self._log(f"  {kind} {c_start} -> {c_end}: {len(rows)} kayit")
            for row in rows:
                price = row.get("fiyat")
                code = row.get("fonKodu")
                date = row.get("tarih")
                if not code or not date or price is None:
                    continue
                # TEFAS zaman zaman 0 fiyat yayimliyor (fonun o gun fiyati
                # aciklanmamis oluyor). Bunlari veri yokmus gibi ele al;
                # aksi halde -%100 / +sonsuz yapay getiriler olusuyor.
                if float(price) <= 0:
                    continue
                yield {
                    "date": date[:10],
                    "code": code.strip().upper(),
                    "kind": kind,
                    "name": (row.get("fonUnvan") or "").strip(),
                    "price": float(price),
                    "shares": row.get("tedPaySayisi"),
                    "investors": row.get("kisiSayisi"),
                    "size": row.get("portfoyBuyukluk"),
                }

    def fund_types(self, kind: str = "YAT") -> list[dict]:
        """TEFAS'in resmi semsiye fon turleri: [{sfonTuru, sfonTurAciklama}, ...]."""
        return self._request(TYPES_URL, {"dil": "TR", "fonTipi": kind})

    def codes_for_type(self, kind: str, type_code: int | None, end: dt.date) -> set[str]:
        """Belirli bir semsiye fon turundeki fon kodlari.

        Kategori esleme icin kullanilir; kisa bir tarih penceresi yeterlidir.
        Not: Filtre yalnizca YAT tipinde calisiyor, EMK/BYF'de yok sayiliyor.
        """
        start = end - dt.timedelta(days=5)
        body = self._body(kind, start, end)
        body["sfonTurKod"] = type_code
        rows = self._request(INFO_URL, body)
        return {r["fonKodu"].strip().upper() for r in rows if r.get("fonKodu")}

    def allocation(self, kind: str, start: dt.date, end: dt.date):
        """Fonlarin varlik dagilimi kayitlarini uretir (yuzde alanlari)."""
        for c_start, c_end in _chunks(start, end, MAX_DAYS_PER_REQUEST):
            rows = self._request(DIST_URL, self._body(kind, c_start, c_end))
            self._log(f"  {kind} dagilim {c_start} -> {c_end}: {len(rows)} kayit")
            for row in rows:
                code = row.get("fonKodu")
                date = row.get("tarih")
                if not code or not date:
                    continue
                yield {"date": date[:10], "code": code.strip().upper(), "row": row}
