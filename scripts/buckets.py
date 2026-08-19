"""TEFAS varlık dağılımı alanlarını okunabilir varlık sınıflarına gruplar.

Alan kısaltmaları TEFAS'ın `dagilimSiraliGetirT` ucunun döndürdüğü yüzde
sütunlarıdır. Her sütun fonun portföyünün yüzde kaçının o varlıkta olduğunu
söyler; aşağıdaki gruplar bunları 9 anlaşılır sınıfa toplar.
"""

BUCKETS: dict[str, tuple[str, ...]] = {
    "Hisse Senedi": ("hs", "yhs"),
    "Kamu Borçlanma": ("dt", "hb", "kba", "kibd", "dot", "db", "eut", "ybkb",
                       "kks", "kkstl", "kksd", "kksyd"),
    "Özel Sektör Borçlanma": ("ost", "osdb", "fb", "bb", "vdm", "osks", "oksyd",
                              "ybosb", "yba"),
    "Para Piyasası & Repo": ("tpp", "bpp", "btaa", "btas", "r", "tr"),
    "Mevduat & Katılma": ("vm", "vmtl", "vmd", "kh", "khtl", "khd"),
    "Kıymetli Maden": ("km", "kmbyf", "kmkba", "kmkks", "vmau", "khau"),
    "Fon & BYF": ("fkb", "yyf", "byf", "ybyf"),
    "Gayrimenkul & Girişim": ("gykb", "gyy", "gsykb", "gsyy", "gas"),
    "Türev & Diğer": ("t", "vint", "ymk", "d"),
}

# Grafiklerde kullanılacak sabit sıra (renk tutarlılığı için).
BUCKET_ORDER = list(BUCKETS)


def summarize(row: dict) -> dict[str, float]:
    """Ham dağılım satırını varlık sınıfı -> yüzde sözlüğüne çevirir."""
    out: dict[str, float] = {}
    for bucket, fields in BUCKETS.items():
        total = 0.0
        for field in fields:
            value = row.get(field)
            if isinstance(value, (int, float)):
                total += float(value)
        if total > 0.005:
            out[bucket] = round(total, 2)
    return out
