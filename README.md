# TEFAS Fon Analiz

TEFAS'ta işlem gören yatırım fonları için **portföy takip ve analiz uygulaması**.
Günlük ve toplam kazancını, portföy dağılımını, BIST 100 / altın / dolar kıyasını ve
risk metriklerini tek sayfada gösterir.

- **Kurulum gerektirmez** — GitHub Pages'te yayınlanan statik bir site, telefondan da açılır.
- **Veriler hafta içi her gün otomatik güncellenir** — GitHub Actions TEFAS'tan fiyatları çeker.
- **Portföy bilgin sende kalır** — işlemlerin yalnızca kendi tarayıcının belleğinde
  (localStorage) tutulur, hiçbir sunucuya gönderilmez. Depo herkese açık olsa bile
  kimse portföyünü göremez.
- **Aile için çoklu profil** — her kişi için ayrı portföy, bir de birleşik "tüm profiller"
  görünümü.

---

## Ne gösteriyor?

| Sekme | İçerik |
|---|---|
| **Panel** | Toplam değer, günlük kazanç (₺ ve %), toplam kazanç, net yatırılan anapara, yıllık getiri (XIRR), portföy değeri grafiği, pozisyon tablosu |
| **Dağılım** | Fon, kategori ve **gerçek varlık sınıfı** dağılımı (fonların içindeki hisse/tahvil/altın/mevduat kırılımı), fon başına kâr-zarar katkısı |
| **Kıyaslama** | Portföy getirisinin BIST 100, gram altın, dolar ve (isteğe bağlı) enflasyon ile karşılaştırması |
| **Risk** | Yıllık oynaklık, Sharpe oranı, maksimum düşüş, drawdown grafiği, fonlar arası korelasyon matrisi |
| **İşlemler** | Alım/satım girişi — fon ve tarihi seçince **birim fiyat TEFAS'tan otomatik gelir**; tutar yazınca adet kendiliğinden hesaplanır |
| **Fonlar** | TEFAS'taki ~2.400 fonun tamamında arama, filtreleme, sıralama ve fon detayı |
| **Ayarlar** | Profiller, tema, yedek al/yükle, Excel-CSV'den toplu işlem aktarma |

---

## Kurulum (tek seferlik, ~5 dakika)

### 1. Depoyu GitHub'a yükle

```bash
git remote add origin https://github.com/KULLANICI_ADIN/tefas-fon-analiz.git
git push -u origin main
```

### 2. GitHub Pages'i aç

Depo sayfasında **Settings → Pages** bölümüne gir ve **Source** olarak
**GitHub Actions**'ı seç. (Branch seçme, Actions olmalı.)

### 3. İlk veri çekimini başlat

**Actions → "Veri güncelle ve yayınla" → Run workflow.**

İlk çalışma 3 yıllık geçmişi baştan çektiği için **20–35 dakika** sürer (TEFAS hız
sınırı uyguladığı için istemci kendini yavaşlatır). Sonraki günlük çalışmalar
yalnızca eksik günleri çeker ve **1 dakikadan kısa** sürer.

Bittiğinde siten şu adreste yayında olur:
`https://KULLANICI_ADIN.github.io/tefas-fon-analiz/`

### 4. Ailenle paylaş

Linki gönder — kurulum yok. Herkesin işlemleri kendi telefonunda/bilgisayarında
saklanır, birbirini görmez. Aynı portföyü paylaşmak isterseniz **Ayarlar → Yedeği
İndir** ile aldığınız dosyayı diğer cihazda **Yedekten Yükle** ile açmanız yeterli.

---

## Nasıl çalışıyor?

```
GitHub Actions (hafta içi 10:45 ve 22:10 TR)
  ├─ TEFAS API'sinden eksik günleri çek        scripts/tefas.py
  ├─ SQLite deposuna yaz (Actions cache'inde)  scripts/update.py
  ├─ Kıyas serilerini çek (Yahoo, TCMB EVDS)   scripts/benchmarks.py
  ├─ dist/ altına JSON veri + statik site üret
  └─ GitHub Pages'e yayınla
```

Ham veri **depoya commit edilmez**. İki çalıştırma arasında GitHub Actions
cache'inde taşınır, site ise Pages artifact'i olarak yayınlanır. Böylece depo
küçük kalır (birkaç yüz KB), veri klasörü şişmez.

Tarayıcı yalnızca ihtiyaç duyduğu fonun geçmişini indirir
(`data/history/AAK.json` gibi ~20 KB'lık dosyalar), bu yüzden mobil bağlantıda da
hızlı açılır.

### Veri kaynakları

| Veri | Kaynak | Anahtar gerekir mi? |
|---|---|---|
| Fon fiyatları, portföy büyüklüğü, yatırımcı sayısı | `tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir` | Hayır |
| Fonların varlık dağılımı | `tefas.gov.tr/api/funds/dagilimSiraliGetirT` | Hayır |
| BIST 100, USD/TRY, ons altın | Yahoo Finance chart API | Hayır |
| TÜFE (enflasyon) | TCMB EVDS | **Evet** (ücretsiz, aşağıya bak) |

> TEFAS tek istekte ~1 aylık veri döndürür ve kaba bir hız sınırı uygular; istemci
> aralığı 28 günlük parçalara böler, istekler arasında bekler ve hata durumunda
> üstel geri çekilme ile yeniden dener.

### Enflasyon kıyasını açmak (isteğe bağlı)

1. [evds2.tcmb.gov.tr](https://evds2.tcmb.gov.tr/) adresinden ücretsiz üye ol,
   profil sayfandan API anahtarını al.
2. Depoda **Settings → Secrets and variables → Actions → New repository secret**.
3. İsim: `EVDS_API_KEY`, değer: anahtarın.

Bir sonraki çalışmada "Kıyaslama" sekmesine TÜFE çizgisi eklenir. Anahtar yoksa
uygulama sorunsuz çalışır, sadece o çizgi görünmez.

---

## Hesaplamalar

**Maliyet yöntemi: ağırlıklı ortalama.** Bir fondan farklı fiyatlarla aldıysan
maliyetin ortalamadır; sattığında gerçekleşen kâr bu ortalamaya göre yazılır.
Türkiye'deki banka ve TEFAS ekstreleri de pozisyonu böyle gösterir.

**Günlük kazanç**, *dünkü kapanışta elinde olan* adetler üzerinden hesaplanır.
Bugün aldığın paylar bugünün kazancına dahil edilmez — çünkü zaten bugünün
fiyatından alındılar.

**İki farklı yıllık getiri** raporlanır, ikisi de doğrudur ama farklı soruları yanıtlar:

- **XIRR (para ağırlıklı)** — *"Cebime giren gerçek yıllık getiri ne?"* Paranın ne
  zaman girdiğini hesaba katar. Panel sekmesinde.
- **TWR (zaman ağırlıklı)** — *"Fon seçimlerim ne kadar iyiydi?"* Para giriş/çıkışının
  etkisini arındırır, bu yüzden BIST 100 gibi endekslerle adil kıyaslanabilir.
  Kıyaslama ve Risk sekmelerinde.

**Risk metrikleri** günlük getirilerden hesaplanır: oynaklık yıllıklandırılmış
standart sapma (√252), maksimum düşüş zirveden en derin geri çekilme, Sharpe
oranı ise `(yıllık getiri − risksiz getiri) / oynaklık`. Risksiz getiriyi Risk
sekmesinden kendin ayarlayabilirsin (varsayılan %40).

---

## Yerelde çalıştırmak

Python 3.11+ yeterli, **hiçbir üçüncü parti paket gerekmez** (yalnızca standart
kütüphane).

```bash
python scripts/update.py --days 60          # 60 günlük veriyle hızlı deneme
python -m http.server 8000 --directory dist # siteyi aç: http://localhost:8000
```

Faydalı seçenekler:

```bash
python scripts/update.py --years 5              # 5 yıllık geçmiş
python scripts/update.py --kinds YAT,EMK,BYF    # fon tipleri
python scripts/update.py --full                 # depoyu yok say, baştan çek
python scripts/update.py --skip-fetch           # veri çekme, sadece siteyi yeniden üret
```

### Dosya düzeni

```
index.html                 sayfa iskeleti
assets/css/style.css       tek dosya stil (açık/koyu tema)
assets/js/
  app.js                   açılış, sekme yönlendirme, profil/tema
  data.js                  JSON veri yükleme, tembel fon geçmişi
  store.js                 localStorage: profiller, işlemler, ayarlar
  portfolio.js             maliyet, kâr/zarar, TWR, XIRR, risk metrikleri
  charts.js                bağımlılıksız SVG grafikler
  util.js                  biçimlendirme (₺, %, tarih) ve DOM yardımcıları
  views/                   sekme başına bir dosya
scripts/
  tefas.py                 TEFAS API istemcisi
  benchmarks.py            BIST 100 / altın / dolar / TÜFE
  buckets.py               varlık dağılımı gruplaması
  categorize.py            fon ünvanından kategori çıkarımı
  update.py                veri güncelleme + site üretimi
```

---

## Sık sorulanlar

**Portföyümü kim görebiliyor?**
Sadece sen. İşlemler `localStorage`'da kalır; ne GitHub'a ne başka bir yere gider.
Tarayıcı verilerini temizlersen kaybolur — bu yüzden ara ara **Ayarlar → Yedeği
İndir** yap.

**Aynı portföyü iki cihazda görebilir miyim?**
Yedek dosyasını indirip diğer cihazda yükleyerek. Otomatik eşitleme yok (bu, veriyi
hiçbir yere göndermemenin bedeli).

**Fon fiyatı neden bugün güncel değil?**
TEFAS fiyatları sabah (~10:00 TR) açıklıyor; iş akışı hafta içi 10:45'te çalışıp
veriyi çekiyor, 22:10'da bir kez daha kontrol ediyor. Hafta sonu ve resmî
tatillerde yeni fiyat yayımlanmaz.

**Emeklilik (BES) fonlarım da var.**
Varsayılan olarak dahil (`YAT,EMK,BYF`). Fon kodunu yazman yeterli.

**Bir fonu bulamıyorum.**
Gayrimenkul ve girişim sermayesi fonları varsayılanda kapalı. İş akışındaki
`TEFAS_KINDS` değerine `GYF,GSYF` ekleyerek açabilirsin.

---

## Sorumluluk reddi

Bu araç kişisel takip amaçlıdır, **yatırım tavsiyesi değildir**. Veriler TEFAS'ın
herkese açık uçlarından alınır; hesaplamalar bilgilendirme amaçlıdır ve resmî
kayıt yerine geçmez. Vergi hesabı yapmaz. Kararlarının sorumluluğu sana aittir.

## Lisans

MIT — bkz. [LICENSE](LICENSE). (Dosyadaki telif satırına kendi adını yazabilirsin.)
