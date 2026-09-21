# Burger Plus — Backend

Çok-telefon + mutfak destekli gerçek zamanlı sipariş sunucusu.
Node.js + Express + Socket.io + **PostgreSQL**.

## Ne işe yarar?

- Aynı masaya bağlanan **birden fazla telefonun** siparişini birleştirir.
- Biri ürün eklediğinde **herkes anında görür** (Socket.io ile canlı).
- **Mutfak ekranı** tüm masaları canlı görür, "hazır" durumunu yayar.
- Veriler **PostgreSQL** veritabanında kalıcı — sunucu kapansa da kaybolmaz.

## Kurulum

### 1. PostgreSQL hazır olmalı
Bilgisayarında PostgreSQL kurulu ve çalışıyor olmalı, `burger_plus` adında bir
veritabanı oluşturulmuş olmalı:
```sql
CREATE DATABASE burger_plus;
```

### 2. Bağlantı bilgileri (.env)
`.env` dosyasını aç ve `PGPASSWORD` satırına PostgreSQL kurulumunda
belirlediğin şifreyi yaz:
```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=senin_sifren
PGDATABASE=burger_plus
PORT=4000
```

### AI destekli müşteri menüsü çevirisi

Ürün, kategori, kampanya, duyuru ve sadakat metinleri kaydedilirken İngilizce
çeviri üretmek için yalnızca backend ortamına aşağıdaki değişkenleri ekle:

```env
GEMINI_API_KEY=...
GEMINI_TRANSLATION_MODEL=gemini-3.1-flash-lite
GEMINI_TRANSLATION_BACKFILL_ON_START=true
```

`GEMINI_TRANSLATION_BACKFILL_ON_START=true`, daha önce kaydedilmiş içerikleri bir
sonraki backend açılışında tarar. Çeviriler her müşteri isteğinde yeniden
üretilmez; PostgreSQL içinde saklanır.
Türkçe kaynak değişmediyse tekrar API çağrısı yapılmaz. Mevcut kayıtları veya
hata alan çevirileri yeniden işlemek için admin yetkisiyle bir kez
`POST /api/admin/ceviriler/tamamla` çağrılabilir. Anahtar yoksa Türkçe içerik
kaydedilmeye devam eder ve İngilizce ekran güvenli biçimde Türkçeye düşer.

### 3. Çalıştır
```bash
npm install
npm start        # http://localhost:4000
```

İlk açılışta tablolar (oturumlar, siparis_kalemleri) otomatik oluşturulur.

Bağlantı hatası alırsan:
- PostgreSQL servisi çalışıyor mu? (Windows Hizmetler'den kontrol et)
- .env'deki şifre doğru mu?
- burger_plus veritabanı oluşturuldu mu?

## Mimari

- Her masa bir **oturum**. Aynı masaya bağlanan herkes aynı oturuma düşer → siparişler birleşir.
- Telefon `masaya-katil` ile masanın "odasına" girer; o odaya yayılan güncelleme ona ulaşır.
- Mutfak `mutfaga-katil` ile tüm masaları dinler.

## Socket olayları

Müşteri: `masaya-katil`(masaNo), `urun-ekle`({masaNo,urun,kisiAdi}) · dinle: `masa-guncellendi`
Mutfak: `mutfaga-katil`, `masa-durum-degistir`({masaNo,durum}) · dinle: `mutfak-guncellendi`

## HTTP API
- `GET /api/masa/:masaNo` → bir masanın siparişi (`X-Masa-Token` başlığı zorunlu)
- `GET /api/mutfak` → tüm açık masalar

### Idempotency sözleşmesi

Sipariş veya ödeme oluşturan/değiştiren kritik `POST` istekleri
`Idempotency-Key` başlığı ister. İstemci her mantıksal işlem için bir UUID üretir
ve ağ hatasında **aynı gövdeyle aynı anahtarı** yeniden kullanır. Yeni bir kullanıcı
aksiyonu için yeni anahtar üretilir.

```http
POST /api/odeme/taslak
Idempotency-Key: order:550e8400-e29b-41d4-a716-446655440000
```

- Anahtar 8-128 karakterdir; harf, rakam, `.`, `_`, `:`, `-` kullanılabilir.
- Aynı anahtar + aynı istek tamamlandıysa kaydedilen HTTP kodu ve JSON yanıtı döner.
- Tekrar yanıtında `Idempotency-Replayed: true` başlığı bulunur.
- Aynı anahtar farklı gövde, kullanıcı veya masa ile kullanılırsa `409` döner.
- Aynı işlem hâlen sürüyorsa istek en fazla 20 saniye sonucu bekler; devam
  ediyorsa `IDEMPOTENCY_IN_PROGRESS` ile `409` döner ve aynı anahtarla tekrar denenir.
- Başarısız işlem aynı anahtar ve aynı gövdeyle yeniden denenebilir. Tamamlanan
  yanıt kayıtları 24 saat saklanır.

Kapsamdaki uçlar: ödeme taslağı, simülasyon/cüzdan onayı, iyzico başlatma ve
doğrulama, nakit sipariş oluşturma/onaylama/reddetme/tahsil etme. iyzico callback'i
sağlayıcı tokenı ve ödeme satırındaki atomik durum geçişiyle; mutfak aktarımı ise
veritabanındaki aktarım talebiyle ayrıca tekilleştirilir.
İyzico ödeme sayfası başlatılırken ödeme satırı atomik olarak sahiplenilir; oluşan
sağlayıcı tokenı ve sayfa adresi kalıcı tutulduğu için farklı HTTP anahtarlarıyla
gelen eşzamanlı başlatma istekleri de ikinci bir sağlayıcı oturumu oluşturamaz.

Masa numarası tek başına erişim sağlamaz. İşletme admini veya super admin
tarafından üretilen QR kodu, işletme ve masa numarasına bağlı imzalı bir erişim
anahtarı taşır. Eski `?no=3` biçimindeki QR kodları geçersizdir ve yeniden
üretilmelidir. `MASA_TOKEN_SECRET` değiştirildiğinde basılı QR kodları da yeniden
üretilmelidir.

## Veritabanı tabloları
- **oturumlar**: her aktif masa bir oturum (id, masa_no, durum)
- **siparis_kalemleri**: kim ne ekledi (oturum_id, urun_ad, fiyat, adet, kisi_adi, durum, odendi)

## Kullanıcı sistemi (auth)

Gerçek kayıt/giriş sistemi eklendi:
- Şifreler **bcrypt** ile hash'lenir (güvenli)
- Oturum **JWT token** ile korunur (7 gün geçerli)
- Kayıt alanları: ad, soyad, cinsiyet, e-posta, telefon, şifre

### Birini admin yapma (QR üretme ekranını görmesi için)

Normal kullanıcılar QR üretme (işletme) ekranını göremez. Bir kullanıcıyı
admin yapmak için, Docker'daki PostgreSQL'e bağlanıp şu komutu çalıştır:

```bash
docker exec -it burgerplus-postgres psql -U burgerplus -d burgerplus
```

Sonra (kendi e-postanı yaz):
```sql
UPDATE kullanicilar SET rol='admin' WHERE email='senin@epostan.com';
```

Çıkmak için `\q`. Admin olan kullanıcı, uygulamada Profil ekranında
"İşletme → Masa QR Kodları" bölümünü görür.

## Auth API uçları
- `POST /api/kayit` — kayıt (ad, soyad, cinsiyet, email, telefon, sifre)
- `POST /api/giris` — giriş (email, sifre) → token döner
- `GET /api/ben` — token ile güncel kullanıcı (Authorization: Bearer TOKEN)
- `GET /api/siparislerim` — backend tarafından kaydedilmiş hesap siparişleri
- `GET /api/sadakat` — puan, damga, ödül kataloğu ve hediye envanteri
- `POST /api/sadakat/oduller/:id/satin-al` — puanla ödül al (transaction + idempotency)
- `POST /api/sadakat/hediyeler/:id/kullan` — hediyeyi backend siparişine dönüştür

Puan ve sipariş kaydı için istemciye açık yazma endpoint'i yoktur. Puan,
damga, hediye ve sipariş geçmişi yalnızca doğrulanmış ödeme/ödül işlemi içinde
backend tarafından yazılır.

## Yayına çıkış (Supabase + Render)

Bu backend hem yerel hem bulut ortamda çalışır:

- **Yerel:** `.env` içinde `PGHOST/PGUSER/PGPASSWORD/PGDATABASE`
- **Yayın:** Tek satır `DATABASE_URL` (Supabase'in verdiği adres)

Detaylı adım adım rehber için `burger-plus-web` projesindeki
**YAYINA-CIKIS-REHBERI.md** dosyasına bak.

### Yerel kurulum notu

Zip içinde `.env` yoktur (güvenlik). İlk kurulumda:

```bash
copy .env.example .env
```

sonra `.env` içindeki değerleri kendi Docker PostgreSQL ayarlarınla düzenle.
