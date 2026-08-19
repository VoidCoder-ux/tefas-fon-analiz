#!/usr/bin/env python3
"""TEFAS verisini çeker, yerel bir SQLite deposunda tutar ve siteyi üretir.

Akış
----
1. `data/tefas.sqlite` açılır (GitHub Actions'ta cache'ten geri yüklenir).
2. Eksik günler TEFAS'tan çekilir (depo boşsa tam geri doldurma yapılır).
3. Fonların güncel varlık dağılımı çekilir.
4. Kıyaslama serileri (BIST 100, gram altın, USD/TRY, TÜFE) çekilir.
5. `dist/` altına statik site + JSON veri dosyaları yazılır.

Kullanım
--------
    python scripts/update.py                 # artımlı güncelleme + site üret
    python scripts/update.py --full          # depoyu yok say, baştan çek
    python scripts/update.py --years 5       # farklı geçmiş derinliği
    python scripts/update.py --skip-fetch    # sadece mevcut veriden site üret
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import benchmarks                                   # noqa: E402
import buckets                                      # noqa: E402
from categorize import categorize                   # noqa: E402
from tefas import Tefas, KIND_LABELS                # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# Artımlı güncellemede son N gün yeniden çekilir (TEFAS geç gelen veya
# düzeltilen fiyatları geriye dönük yayımlayabiliyor).
OVERLAP_DAYS = 7

# Getiri penceresi etiketi -> takvim günü
RETURN_WINDOWS = {"1h": 7, "1a": 30, "3a": 90, "6a": 180, "1y": 365, "3y": 1095}

# En uzun getiri penceresinin (3 yıl) kenarında veri kalmaması için tutulan
# fazladan gün. Bu tampon olmazsa "3 yıl" sütunu boş çıkar.
RETENTION_BUFFER_DAYS = 20

SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
    date  TEXT NOT NULL,
    code  TEXT NOT NULL,
    price REAL NOT NULL,
    PRIMARY KEY (date, code)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS funds (
    code      TEXT PRIMARY KEY,
    name      TEXT,
    kind      TEXT,
    shares    REAL,
    investors INTEGER,
    size      REAL,
    updated   TEXT
);

CREATE TABLE IF NOT EXISTS allocation (
    code TEXT PRIMARY KEY,
    date TEXT,
    json TEXT
);

CREATE INDEX IF NOT EXISTS idx_prices_code ON prices (code, date);
"""


# --------------------------------------------------------------------- veri çekme

def open_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def latest_stored_date(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT MAX(date) FROM prices").fetchone()
    return row[0] if row and row[0] else None


def earliest_stored_date(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT MIN(date) FROM prices").fetchone()
    return row[0] if row and row[0] else None


def fetch_prices(conn: sqlite3.Connection, client: Tefas, kinds: list[str],
                 start: dt.date, end: dt.date) -> int:
    """Fiyatları çeker, `prices` ve `funds` tablolarını günceller."""
    total = 0
    for kind in kinds:
        print(f"[fiyat] {KIND_LABELS.get(kind, kind)} ({kind}) {start} -> {end}", flush=True)
        price_rows: list[tuple] = []
        fund_rows: dict[str, tuple] = {}
        for rec in client.prices(kind, start, end):
            price_rows.append((rec["date"], rec["code"], rec["price"]))
            # Fon meta verisi için en güncel satır kazanır.
            prev = fund_rows.get(rec["code"])
            if prev is None or rec["date"] >= prev[6]:
                fund_rows[rec["code"]] = (
                    rec["code"], rec["name"], kind, rec["shares"],
                    rec["investors"], rec["size"], rec["date"],
                )
            if len(price_rows) >= 50_000:
                conn.executemany(
                    "INSERT OR REPLACE INTO prices (date, code, price) VALUES (?,?,?)",
                    price_rows)
                total += len(price_rows)
                price_rows.clear()
        if price_rows:
            conn.executemany(
                "INSERT OR REPLACE INTO prices (date, code, price) VALUES (?,?,?)",
                price_rows)
            total += len(price_rows)
        if fund_rows:
            conn.executemany(
                "INSERT OR REPLACE INTO funds "
                "(code, name, kind, shares, investors, size, updated) "
                "VALUES (?,?,?,?,?,?,?)",
                list(fund_rows.values()))
        conn.commit()
    return total


def fetch_allocation(conn: sqlite3.Connection, client: Tefas, kinds: list[str],
                     end: dt.date) -> int:
    """Her fonun en güncel varlık dağılımını çeker (son 10 günlük pencere)."""
    start = end - dt.timedelta(days=10)
    latest: dict[str, tuple[str, str]] = {}
    for kind in kinds:
        print(f"[dagilim] {kind} {start} -> {end}", flush=True)
        for rec in client.allocation(kind, start, end):
            code, date = rec["code"], rec["date"]
            if code not in latest or date >= latest[code][0]:
                latest[code] = (date, json.dumps(buckets.summarize(rec["row"]),
                                                 ensure_ascii=False))
    if latest:
        conn.executemany(
            "INSERT OR REPLACE INTO allocation (code, date, json) VALUES (?,?,?)",
            [(code, date, payload) for code, (date, payload) in latest.items()])
        conn.commit()
    return len(latest)


def prune(conn: sqlite3.Connection, cutoff: dt.date) -> int:
    cur = conn.execute("DELETE FROM prices WHERE date < ?", (cutoff.isoformat(),))
    conn.commit()
    return cur.rowcount


# ------------------------------------------------------------------- site üretimi

def _pct(new: float | None, old: float | None) -> float | None:
    if old is None or new is None or old == 0:
        return None
    return round((new / old - 1) * 100, 2)


def _value_at_or_before(dates: list[str], prices: list[float], target: str) -> float | None:
    """`target` tarihindeki ya da ondan önceki en yakın fiyatı döndürür."""
    lo, hi, best = 0, len(dates) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if dates[mid] <= target:
            best = prices[mid]
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def _volatility_and_drawdown(prices: list[float]) -> tuple[float | None, float | None]:
    """Yıllık oynaklık (%) ve maksimum düşüş (%) hesaplar."""
    clean = [p for p in prices if p and p > 0]
    if len(clean) < 30:
        return None, None
    rets = [clean[i] / clean[i - 1] - 1 for i in range(1, len(clean))]
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    vol = (var ** 0.5) * (252 ** 0.5) * 100
    peak, max_dd = clean[0], 0.0
    for price in clean:
        peak = max(peak, price)
        max_dd = min(max_dd, price / peak - 1)
    return round(vol, 2), round(max_dd * 100, 2)


def build_site(conn: sqlite3.Connection, out_dir: Path, years: int) -> dict:
    """dist/ altına statik siteyi ve JSON veri dosyalarını yazar."""
    data_dir = out_dir / "data"
    hist_dir = data_dir / "history"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    hist_dir.mkdir(parents=True, exist_ok=True)

    # Ortak takvim: fiyat üretilen tüm günler.
    calendar = [r[0] for r in conn.execute(
        "SELECT DISTINCT date FROM prices ORDER BY date")]
    if not calendar:
        raise SystemExit("Veritabanında fiyat yok - önce veri çekilmeli.")
    index_of = {day: i for i, day in enumerate(calendar)}
    last_day = calendar[-1]
    print(f"[site] takvim {calendar[0]} -> {last_day} ({len(calendar)} gün)", flush=True)

    allocations = {code: json.loads(payload) for code, payload in
                   conn.execute("SELECT code, json FROM allocation")}

    meta = {code: dict(zip(("name", "kind", "shares", "investors", "size"), rest))
            for code, *rest in conn.execute(
                "SELECT code, name, kind, shares, investors, size FROM funds")}

    funds_out: list[dict] = []
    written = 0

    for code in sorted(meta):
        rows = conn.execute(
            "SELECT date, price FROM prices WHERE code = ? ORDER BY date", (code,)
        ).fetchall()
        if not rows:
            continue
        first_idx = index_of[rows[0][0]]
        last_idx = index_of[rows[-1][0]]
        span = last_idx - first_idx + 1
        series: list[float | None] = [None] * span
        for day, price in rows:
            series[index_of[day] - first_idx] = round(price, 6)

        dates = [d for d, _ in rows]
        prices = [p for _, p in rows]

        # Fon dosyası: başlangıç indeksi + fiyat dizisi (takvime hizalı).
        (hist_dir / f"{code}.json").write_text(
            json.dumps({"c": code, "i": first_idx, "p": series},
                       ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8")
        written += 1

        last_price = prices[-1]
        prev_price = prices[-2] if len(prices) > 1 else None
        info = meta[code]
        returns = {}
        for label, days in RETURN_WINDOWS.items():
            target = (dt.date.fromisoformat(dates[-1]) - dt.timedelta(days=days)).isoformat()
            base = _value_at_or_before(dates, prices, target)
            returns[label] = _pct(last_price, base) if base else None

        # Risk metrikleri son 1 yıllık veriden.
        cutoff = (dt.date.fromisoformat(dates[-1]) - dt.timedelta(days=365)).isoformat()
        recent = [p for d, p in rows if d >= cutoff]
        vol, max_dd = _volatility_and_drawdown(recent)

        funds_out.append({
            "code": code,
            "name": info["name"],
            "kind": info["kind"],
            "cat": categorize(info["name"]),
            "price": round(last_price, 6),
            "date": dates[-1],
            "chg": _pct(last_price, prev_price),
            "ret": returns,
            "vol": vol,
            "mdd": max_dd,
            "size": info["size"],
            "inv": info["investors"],
            "alloc": allocations.get(code) or {},
            "i0": first_idx,
            "n": span,
        })

    (data_dir / "funds.json").write_text(
        json.dumps(funds_out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (data_dir / "calendar.json").write_text(
        json.dumps(calendar, separators=(",", ":")), encoding="utf-8")

    # Kıyaslama serileri aynı takvime hizalanır.
    print("[site] kıyaslama serileri", flush=True)
    start_date = dt.date.fromisoformat(calendar[0])
    bench = benchmarks.collect(start_date, dt.date.fromisoformat(last_day), calendar)
    (data_dir / "benchmarks.json").write_text(
        json.dumps(bench, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    info = {
        "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "lastDataDate": last_day,
        "firstDataDate": calendar[0],
        "days": len(calendar),
        "fundCount": len(funds_out),
        "years": years,
        "benchmarks": list(bench),
        "buckets": buckets.BUCKET_ORDER,
    }
    (data_dir / "meta.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")

    # Statik site dosyalarını kopyala.
    shutil.copy2(ROOT / "index.html", out_dir / "index.html")
    shutil.copytree(ROOT / "assets", out_dir / "assets")
    # GitHub Pages'in Jekyll işlemesini kapat.
    (out_dir / ".nojekyll").write_text("", encoding="utf-8")

    size_mb = sum(f.stat().st_size for f in out_dir.rglob("*") if f.is_file()) / 1024 / 1024
    print(f"[site] {written} fon geçmişi, toplam {size_mb:.1f} MB -> {out_dir}", flush=True)
    return info


# --------------------------------------------------------------------------- giriş

def main() -> int:
    parser = argparse.ArgumentParser(description="TEFAS verisini güncelle ve siteyi üret")
    parser.add_argument("--years", type=int, default=int(os.environ.get("TEFAS_YEARS", 3)),
                        help="Kaç yıllık geçmiş tutulacak (varsayılan 3)")
    parser.add_argument("--kinds", default=os.environ.get("TEFAS_KINDS", "YAT,EMK,BYF"),
                        help="Fon tipleri, virgülle (YAT,EMK,BYF,GYF,GSYF)")
    parser.add_argument("--db", default=str(ROOT / "data" / "tefas.sqlite"))
    parser.add_argument("--out", default=str(ROOT / "dist"))
    parser.add_argument("--delay", type=float, default=float(os.environ.get("TEFAS_DELAY", 3.0)),
                        help="İstekler arası bekleme (saniye)")
    parser.add_argument("--days", type=int, default=None,
                        help="Geçmiş derinliğini gün cinsinden ver (--years yerine, test için)")
    parser.add_argument("--full", action="store_true", help="Depoyu yok say, baştan çek")
    parser.add_argument("--skip-fetch", action="store_true", help="Veri çekme, sadece site üret")
    args = parser.parse_args()

    started = time.time()
    kinds = [k.strip().upper() for k in args.kinds.split(",") if k.strip()]
    today = dt.date.today()
    depth_days = args.days if args.days is not None else args.years * 365
    cutoff = today - dt.timedelta(days=depth_days + RETENTION_BUFFER_DAYS)

    conn = open_db(Path(args.db))

    if not args.skip_fetch:
        client = Tefas(delay=args.delay)
        stored = None if args.full else latest_stored_date(conn)
        if stored:
            start = max(dt.date.fromisoformat(stored) - dt.timedelta(days=OVERLAP_DAYS), cutoff)
            print(f"Artımlı güncelleme: depoda son gün {stored}", flush=True)
        else:
            start = cutoff
            print(f"Tam geri doldurma: {args.years} yıl (bu işlem uzun sürer)", flush=True)

        rows = fetch_prices(conn, client, kinds, start, today)
        print(f"{rows} fiyat kaydı yazıldı", flush=True)

        # Geçmiş derinliği artırıldıysa (ya da tampon henüz doldurulmadıysa)
        # baştaki eksik pencereyi de tamamla.
        earliest = earliest_stored_date(conn)
        if earliest and dt.date.fromisoformat(earliest) > cutoff + dt.timedelta(days=3):
            print(f"Eksik erken dönem tamamlanıyor: {cutoff} -> {earliest}", flush=True)
            extra = fetch_prices(conn, client, kinds, cutoff,
                                 dt.date.fromisoformat(earliest))
            print(f"{extra} eski kayıt eklendi", flush=True)
        codes = fetch_allocation(conn, client, kinds, today)
        print(f"{codes} fonun varlık dağılımı güncellendi", flush=True)
        removed = prune(conn, cutoff)
        if removed > 0:
            print(f"{removed} eski kayıt temizlendi", flush=True)

    info = build_site(conn, Path(args.out), args.years)
    conn.commit()
    conn.close()
    print(f"Bitti: {info['fundCount']} fon, son veri {info['lastDataDate']}, "
          f"{time.time() - started:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
