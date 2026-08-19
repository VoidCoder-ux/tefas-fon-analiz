"""Fon ünvanından kategori çıkarımı.

Kategori adları TEFAS'ın resmi şemsiye fon türleriyle birebir aynı yazılır
("Kıymetli Madenler" gibi); aksi hâlde aynı tür iki ayrı kategori olarak
görünür. Bu yol yalnızca resmi kategori alınamayan fonlar (emeklilik ve borsa
yatırım fonları) için kullanılır.

TEFAS'ın yeni fiyat ucu fon türü alanını döndürmüyor; ünvan ise türü
neredeyse her zaman içinde taşıyor (SPK ünvan kuralları gereği).
Aşağıdaki kurallar sırayla denenir, ilk eşleşen kategori kullanılır.
"""
from __future__ import annotations

import re

# (kategori, ünvanda aranacak kalıp) - sıra önemli, özelden genele.
RULES: list[tuple[str, str]] = [
    ("Para Piyasası", r"PARA P[İI]YASASI"),
    ("Kıymetli Madenler", r"ALTIN|KIYMETL[İI] MADEN|GÜMÜ[ŞS]"),
    ("Hisse Senedi", r"H[İI]SSE SENED[İI]"),
    ("Endeks", r"ENDEKS"),
    ("Serbest", r"SERBEST"),
    ("Katılım", r"KATILIM|K[İI]RA SERT[İI]F[İI]KASI"),
    ("Borçlanma Araçları", r"BOR[ÇC]LANMA ARA[ÇC]LARI|TAHV[İI]L|BONO|EUROBOND"),
    ("Fon Sepeti", r"FON SEPET[İI]"),
    ("Değişken", r"DE[ĞG][İI][ŞS]KEN"),
    ("Karma", r"KARMA|DENGEL[İI]"),
    ("Gayrimenkul", r"GAYR[İI]MENKUL"),
    ("Girişim Sermayesi", r"G[İI]R[İI][ŞS][İI]M SERMAYES[İI]"),
    ("Yabancı Menkul", r"YABANCI"),
]

_COMPILED = [(name, re.compile(pattern, re.IGNORECASE)) for name, pattern in RULES]


def categorize(name: str) -> str:
    """Fon ünvanından kategori döndürür; eşleşme yoksa 'Diğer'."""
    text = (name or "").upper()
    for category, pattern in _COMPILED:
        if pattern.search(text):
            return category
    return "Diğer"
