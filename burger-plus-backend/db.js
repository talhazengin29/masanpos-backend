// ============================================================================
// Veritabanı katmanı — PostgreSQL (pg kütüphanesi)
//
// SQLite'tan farkı: PostgreSQL ayrı bir sunucu ve ASENKRON çalışır.
// Yani her sorgu bir "söz" (Promise) döndürür, önüne await koyarız.
// Bağlantı bilgileri .env dosyasından gelir.
// ============================================================================

import pkg from "pg";
import dotenv from "dotenv";
import { randomBytes, randomUUID } from "crypto";
import { odemeSadakatiniUygula } from "./sadakatDb.js";
import {
  siparisReceteStogunuIsle,
  siparisUrunAdetleriniTopla,
  suresiDolanHammaddeRezervasyonlariniBirak,
} from "./receteDb.js";
import { oneriAtiflariniDogrula, oneriOlayiKaydet } from "./oneriAtif.js";

dotenv.config();
const { Pool } = pkg;

const DAVET_KODU_KARAKTERLERI = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function isletmeIdZorunlu(isletmeId) {
  const id = Number(isletmeId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("isletmeId zorunlu");
  return id;
}

export function davetKoduUret() {
  const rastgele = randomBytes(8);
  return Array.from(rastgele, (deger) => DAVET_KODU_KARAKTERLERI[deger % DAVET_KODU_KARAKTERLERI.length]).join("");
}

export function davetPuaniHesapla(tutar) {
  const sayi = Number(tutar);
  return Number.isFinite(sayi) && sayi > 0 ? Math.floor(sayi * 0.05) : 0;
}

// Bağlantı havuzu: birden çok istek aynı anda gelince verimli yönetir.
//
// İKİ KULLANIM ŞEKLİ:
// 1) Yerel geliştirme: .env'de PGHOST/PGUSER/PGPASSWORD/PGDATABASE ayrı ayrı
// 2) Yayın (Supabase/Render): tek satır DATABASE_URL
//
// SSL: Bulut veritabanları (Supabase vb.) SSL ister. Yerel PostgreSQL genelde
// desteklemez. PGSSL=kapali yazarsan SSL'siz bağlanır.
const baglantiUrl = process.env.DATABASE_URL;
const sslKapali = process.env.PGSSL === "kapali";

const pool = baglantiUrl
  ? new Pool({
      connectionString: baglantiUrl,
      ssl: sslKapali ? false : { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    });

// --- Tabloları oluştur (yoksa) ---
export async function tablolariHazirla(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oturumlar (
      id SERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      masa_no TEXT NOT NULL,
      durum TEXT NOT NULL DEFAULT 'acik',
      olusturma TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS siparis_kalemleri (
      id SERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      oturum_id INTEGER NOT NULL REFERENCES oturumlar(id),
      urun_id INTEGER NOT NULL,
      urun_ad TEXT NOT NULL,
      fiyat NUMERIC NOT NULL,
      adet INTEGER NOT NULL DEFAULT 1,
      kisi_adi TEXT,
      durum TEXT NOT NULL DEFAULT 'yeni',
      odendi BOOLEAN NOT NULL DEFAULT false,
      oneri_adedi INTEGER NOT NULL DEFAULT 0,
      secimler JSONB NOT NULL DEFAULT '{}'::jsonb,
      olusturma TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Migration: eski kurulumlarda ürün özelleştirmelerini güvenli JSON olarak sakla.
  await pool.query(`
    ALTER TABLE siparis_kalemleri
    ADD COLUMN IF NOT EXISTS secimler JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS odeme_id UUID");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS odeme_kalem_no INTEGER");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS siparis_no TEXT");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS hazirlamaya_baslandi TIMESTAMPTZ");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS hazir_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS hazirlayan_personel_id INTEGER");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS oneri_adedi INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE oturumlar ADD COLUMN IF NOT EXISTS kapandi_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE oturumlar ADD COLUMN IF NOT EXISTS kapatan_personel_id INTEGER");
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS tek_odeme_siparis_kalemi
    ON siparis_kalemleri (odeme_id, odeme_kalem_no)
    WHERE odeme_id IS NOT NULL AND odeme_kalem_no IS NOT NULL
  `);

  // Kullanıcılar tablosu. rol='kullanici' varsayılan; admin elle işaretlenir:
  //   UPDATE kullanicilar SET rol='admin' WHERE email='...';
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kullanicilar (
      id SERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      ad TEXT NOT NULL,
      soyad TEXT NOT NULL,
      cinsiyet TEXT,
      email TEXT NOT NULL,
      telefon TEXT,
      sifre_hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'kullanici',
      puan INTEGER NOT NULL DEFAULT 0,
      olusturma TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Şifremi unuttum akışı: şifre değişince o ana kadar üretilmiş JWT'ler
  // tokenDogrula içinde bu tarihle karşılaştırılıp geçersiz sayılır.
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS sifre_degisim_tarihi TIMESTAMPTZ");
  // İşletme kurulumunda admin hesabına geçici bir şifre tanımlanır; bu bayrak
  // açıkken girisYap normal oturum yerine "önce yeni şifre belirle" akışına
  // yönlendirir (bkz. auth.js#girisYap / ilkGirisSifreBelirle).
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS sifre_degistirmeli BOOLEAN NOT NULL DEFAULT false");
  // Parolalar geçici dahi olsa hiçbir zaman düz metin tutulmaz. Eski
  // sürümlerin oluşturduğu alan ve içindeki hassas veri migration sırasında
  // kalıcı olarak kaldırılır.
  await pool.query("ALTER TABLE kullanicilar DROP COLUMN IF EXISTS sifre_gecici_metin");
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS basarisiz_giris_sayisi INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS son_basarisiz_giris TIMESTAMPTZ");
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS giris_kilit_bitis TIMESTAMPTZ");
  // İsteğe bağlı TOTP tabanlı iki adımlı doğrulama. TOTP sırları uygulama
  // katmanında AES-GCM ile şifrelenmiş olarak saklanır; kurtarma kodları hash'tir.
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS iki_faktor_aktif BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS iki_faktor_sir TEXT");
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS iki_faktor_bekleyen_sir TEXT");
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS iki_faktor_kurtarma JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS iki_faktor_degisim_tarihi TIMESTAMPTZ");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sifre_sifirlama (
      id SERIAL PRIMARY KEY,
      kullanici_id INTEGER NOT NULL REFERENCES kullanicilar(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      son_gecerlilik TIMESTAMPTZ NOT NULL,
      kullanildi BOOLEAN NOT NULL DEFAULT false,
      olusturma TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS sifre_sifirlama_token ON sifre_sifirlama(token_hash)");

  // Davet sistemi migration'ı: her hesap kalıcı ve benzersiz bir kod taşır;
  // davetçi ilişkisi kayıt anında bir kez yazılır ve sonradan değiştirilmez.
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS davet_kodu VARCHAR(8)");
  await pool.query("ALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS davet_eden_id INTEGER");
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='kullanicilar_davet_eden_id_fkey') THEN
        ALTER TABLE kullanicilar ADD CONSTRAINT kullanicilar_davet_eden_id_fkey
          FOREIGN KEY (davet_eden_id) REFERENCES kullanicilar(id) ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='kullanicilar_davet_eden_farkli') THEN
        ALTER TABLE kullanicilar ADD CONSTRAINT kullanicilar_davet_eden_farkli
          CHECK (davet_eden_id IS NULL OR davet_eden_id <> id);
      END IF;
    END $$
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS kullanicilar_isletme_davet_kodu
    ON kullanicilar (isletme_id,davet_kodu) WHERE davet_kodu IS NOT NULL
  `);
  const kodsuzKullanicilar = await pool.query(
    "SELECT id,isletme_id FROM kullanicilar WHERE isletme_id=$1 AND davet_kodu IS NULL ORDER BY id",
    [tenantId]
  );
  for (const kullanici of kodsuzKullanicilar.rows) {
    let atandi = false;
    for (let deneme = 0; deneme < 20 && !atandi; deneme += 1) {
      try {
        const sonuc = await pool.query(
          "UPDATE kullanicilar SET davet_kodu=$1 WHERE id=$2 AND isletme_id=$3 AND davet_kodu IS NULL",
          [davetKoduUret(), kullanici.id, kullanici.isletme_id]
        );
        atandi = sonuc.rowCount === 1 || sonuc.rowCount === 0;
      } catch (e) {
        if (e.code !== "23505") throw e;
      }
    }
    if (!atandi) throw new Error(`Kullanıcı ${kullanici.id} için benzersiz davet kodu üretilemedi.`);
  }
  await pool.query("ALTER TABLE kullanicilar ALTER COLUMN davet_kodu SET NOT NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kullanici_siparisleri (
      id BIGSERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      kullanici_id INTEGER NOT NULL REFERENCES kullanicilar(id) ON DELETE CASCADE,
      siparis_no TEXT NOT NULL,
      masa_no TEXT,
      tip TEXT NOT NULL,
      urunler JSONB NOT NULL DEFAULT '[]'::jsonb,
      tutar NUMERIC NOT NULL DEFAULT 0,
      kazanilan_puan INTEGER NOT NULL DEFAULT 0,
      durum TEXT NOT NULL DEFAULT 'hazirlaniyor',
      tamamlandi BOOLEAN NOT NULL DEFAULT false,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (kullanici_id, siparis_no)
    )
  `);

  // Ödeme sağlayıcısından bağımsız sipariş taslağı. Sağlayıcı tokenı ve sonuç
  // burada tutulur; mutfağa yalnızca "basarili" ödeme aktarılabilir.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS odeme_islemleri (
      id UUID PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      kullanici_id INTEGER REFERENCES kullanicilar(id) ON DELETE SET NULL,
      siparis_no TEXT NOT NULL UNIQUE,
      masa_no TEXT,
      siparis_tipi TEXT NOT NULL,
      yontem TEXT NOT NULL,
      kisi_adi TEXT NOT NULL DEFAULT 'Misafir',
      urunler JSONB NOT NULL DEFAULT '[]'::jsonb,
      tutar NUMERIC NOT NULL CHECK (tutar >= 0),
      kazanilan_puan INTEGER NOT NULL DEFAULT 0,
      para_birimi TEXT NOT NULL DEFAULT 'TRY',
      saglayici TEXT NOT NULL DEFAULT 'hazirlanıyor',
      saglayici_token TEXT UNIQUE,
      saglayici_sayfa_url TEXT,
      iyzico_baslatim_basladi TIMESTAMPTZ,
      durum TEXT NOT NULL DEFAULT 'bekliyor',
      mutfaga_aktarildi BOOLEAN NOT NULL DEFAULT false,
      mutfaga_aktarim_basladi TIMESTAMPTZ,
      idempotency_kapsam VARCHAR(80),
      idempotency_anahtar VARCHAR(128),
      son_gecerlilik TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '20 minutes',
      basarili_at TIMESTAMPTZ,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS odeme_islemleri_kullanici_idx
      ON odeme_islemleri (kullanici_id, olusturma DESC);
  `);
  await pool.query("ALTER TABLE odeme_islemleri ADD COLUMN IF NOT EXISTS mutfaga_aktarim_basladi TIMESTAMPTZ");
  await pool.query("ALTER TABLE odeme_islemleri ADD COLUMN IF NOT EXISTS saglayici_sayfa_url TEXT");
  await pool.query("ALTER TABLE odeme_islemleri ADD COLUMN IF NOT EXISTS iyzico_baslatim_basladi TIMESTAMPTZ");
  await pool.query("ALTER TABLE odeme_islemleri ADD COLUMN IF NOT EXISTS idempotency_kapsam VARCHAR(80)");
  await pool.query("ALTER TABLE odeme_islemleri ADD COLUMN IF NOT EXISTS idempotency_anahtar VARCHAR(128)");
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS odeme_islemleri_idempotency_unique
    ON odeme_islemleri (isletme_id,idempotency_kapsam,idempotency_anahtar)
    WHERE idempotency_kapsam IS NOT NULL AND idempotency_anahtar IS NOT NULL
  `);

  // Nakit sipariş yalnızca salon personelinin açtığı masadan verilebilir.
  // Her masa için tek güncel yetki kaydı tutulur; geçmiş siparişler ödeme
  // kayıtlarında ve masa oturumlarında kalmaya devam eder.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nakit_masalari (
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      masa_no TEXT NOT NULL,
      aktif BOOLEAN NOT NULL DEFAULT false,
      acan_kullanici_id INTEGER REFERENCES kullanicilar(id) ON DELETE SET NULL,
      kapatan_kullanici_id INTEGER REFERENCES kullanicilar(id) ON DELETE SET NULL,
      acilis TIMESTAMPTZ,
      kapanis TIMESTAMPTZ,
      guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (isletme_id, masa_no)
    );
    CREATE INDEX IF NOT EXISTS nakit_masalari_aktif_idx
      ON nakit_masalari (isletme_id, aktif, masa_no);
    CREATE INDEX IF NOT EXISTS odeme_islemleri_nakit_bekleyen_idx
      ON odeme_islemleri (isletme_id, masa_no, durum, olusturma)
      WHERE saglayici='nakit' AND durum IN ('personel_onayi','nakit_bekliyor');
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS davet_odulleri (
      id BIGSERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      davet_eden_id INTEGER NOT NULL REFERENCES kullanicilar(id) ON DELETE CASCADE,
      davet_edilen_id INTEGER NOT NULL REFERENCES kullanicilar(id) ON DELETE CASCADE,
      odeme_id UUID NOT NULL REFERENCES odeme_islemleri(id) ON DELETE RESTRICT,
      siparis_tutari NUMERIC NOT NULL CHECK (siparis_tutari >= 0),
      oran NUMERIC NOT NULL DEFAULT 0.05 CHECK (oran >= 0 AND oran <= 1),
      puan INTEGER NOT NULL CHECK (puan >= 0),
      durum TEXT NOT NULL DEFAULT 'kazanildi' CHECK (durum IN ('kazanildi','geri_alindi')),
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      geri_alinma TIMESTAMPTZ,
      UNIQUE (odeme_id),
      CHECK (davet_eden_id <> davet_edilen_id)
    );
    CREATE INDEX IF NOT EXISTS davet_odulleri_davet_eden_idx
      ON davet_odulleri (davet_eden_id, olusturma DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS puan_hareketleri (
      id BIGSERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      kullanici_id INTEGER NOT NULL REFERENCES kullanicilar(id) ON DELETE CASCADE,
      tur TEXT NOT NULL,
      puan INTEGER NOT NULL,
      aciklama TEXT NOT NULL,
      odeme_id UUID REFERENCES odeme_islemleri(id) ON DELETE SET NULL,
      kaynak_kullanici_id INTEGER REFERENCES kullanicilar(id) ON DELETE SET NULL,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS puan_hareketleri_odeme_unique
      ON puan_hareketleri (kullanici_id, tur, odeme_id)
      WHERE odeme_id IS NOT NULL;
  `);

  // --- Migration: mevcut tablolarda olusturma sütununu TIMESTAMPTZ'ye çevir ---
  // Eski kurulumda TIMESTAMP (timezone'suz) kaydedilmişse saat 3 saat kayıyordu.
  // TIMESTAMPTZ'ye çevirirken mevcut değerleri UTC kabul edip düzeltiyoruz.
  const zamanSutunlari = [
    ["siparis_kalemleri", "olusturma"],
    ["oturumlar", "olusturma"],
    ["kullanicilar", "olusturma"],
  ];
  for (const [tablo, sutun] of zamanSutunlari) {
    try {
      const tip = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2`,
        [tablo, sutun]
      );
      // Sadece hâlâ timezone'suz ise çevir ("timestamp without time zone")
      if (tip.rows[0]?.data_type === "timestamp without time zone") {
        await pool.query(
          `ALTER TABLE ${tablo}
           ALTER COLUMN ${sutun} TYPE TIMESTAMPTZ
           USING ${sutun} AT TIME ZONE 'UTC'`
        );
        console.log(`Migration: ${tablo}.${sutun} → TIMESTAMPTZ`);
      }
    } catch (e) {
      console.log(`Migration atlandı (${tablo}.${sutun}):`, e.message);
    }
  }

  // Eski sürüm aynı masaya ürünleri eşzamanlı eklerken birden fazla açık
  // oturum oluşturabiliyordu. Kalemleri en yeni oturumda birleştir, eski
  // oturumları kapat ve bunun tekrarını veritabanı seviyesinde engelle.
  const migration = await pool.connect();
  try {
    await migration.query("BEGIN");
    await migration.query(`
      WITH acik_oturumlar AS (
        SELECT id, isletme_id, masa_no, MAX(id) OVER (PARTITION BY isletme_id,masa_no) AS hedef_id
        FROM oturumlar WHERE isletme_id=$1 AND durum='acik'
      )
      UPDATE siparis_kalemleri k
      SET oturum_id = a.hedef_id
      FROM acik_oturumlar a
      WHERE k.isletme_id=$1 AND k.oturum_id = a.id AND a.id <> a.hedef_id
    `, [tenantId]);
    await migration.query(`
      WITH acik_oturumlar AS (
        SELECT id, MAX(id) OVER (PARTITION BY isletme_id,masa_no) AS hedef_id
        FROM oturumlar WHERE isletme_id=$1 AND durum='acik'
      )
      UPDATE oturumlar o SET durum='kapali'
      FROM acik_oturumlar a
      WHERE o.isletme_id=$1 AND o.id=a.id AND a.id <> a.hedef_id
    `, [tenantId]);
    await migration.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS tek_acik_oturum_masa_isletme
      ON oturumlar (isletme_id,masa_no) WHERE durum='acik'
    `);
    await migration.query("COMMIT");
  } catch (e) {
    await migration.query("ROLLBACK");
    throw e;
  } finally {
    migration.release();
  }

  console.log("Veritabanı tabloları hazır.");
}

// Açık bir masa oturumu bul; yoksa oluştur.
export async function masaOturumuBulVeyaOlustur(isletmeId, masaNo) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const yeni = await pool.query(
    `INSERT INTO oturumlar (isletme_id,masa_no) VALUES ($1,$2)
     ON CONFLICT (isletme_id,masa_no) WHERE durum='acik' DO NOTHING
     RETURNING *`,
    [tenantId, masaNo]
  );
  if (yeni.rows.length) return yeni.rows[0];
  const mevcut = await pool.query(
    "SELECT * FROM oturumlar WHERE isletme_id=$1 AND masa_no=$2 AND durum='acik' LIMIT 1",
    [tenantId, masaNo]
  );
  return mevcut.rows[0];
}

// Bir masanin tum siparis kalemlerini getir (birlesik hesap).
export async function masaSiparisleriniGetir(isletmeId, masaNo) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const oturum = await pool.query(
    "SELECT * FROM oturumlar WHERE isletme_id=$1 AND masa_no=$2 AND durum='acik' ORDER BY id DESC LIMIT 1",
    [tenantId, masaNo]
  );
  if (oturum.rows.length === 0) {
    return { masaNo, oturumId: null, kalemler: [], toplam: 0 };
  }
  const oturumId = oturum.rows[0].id;

  const kalemler = await pool.query(
    "SELECT * FROM siparis_kalemleri WHERE isletme_id=$1 AND oturum_id=$2 ORDER BY id",
    [tenantId, oturumId]
  );
  // PostgreSQL NUMERIC alanları string olarak döner; frontend sayı bekliyor.
  const kalemlerNumerik = kalemler.rows.map((k) => ({
    ...k,
    fiyat: Number(k.fiyat),
    secimler: k.secimler || {},
    haricMalzemeler: k.secimler?.haricMalzemeler || [],
  }));
  const toplam = kalemlerNumerik.reduce(
    (t, k) => t + k.fiyat * k.adet,
    0
  );
  return { masaNo, oturumId, kalemler: kalemlerNumerik, toplam };
}

// Masaya yeni kalem ekle.
export async function kalemEkle(isletmeId, masaNo, urun, kisiAdi, gelenSecimler = {}, gelenHaricMalzemeler = [], siparisNo = null, odemeId = null, odemeKalemNo = null) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const oturum = await masaOturumuBulVeyaOlustur(tenantId, masaNo);
  const haricAdaylari = Array.isArray(gelenHaricMalzemeler)
    ? gelenHaricMalzemeler
    : Array.isArray(urun.haricMalzemeler) ? urun.haricMalzemeler : [];
  const haricMalzemeler = haricAdaylari
    .filter((malzeme) => typeof malzeme === "string")
    .slice(0, 50)
    .map((malzeme) => malzeme.slice(0, 100));
  let guvenliSecimler = {};
  if (gelenSecimler && typeof gelenSecimler === "object" && !Array.isArray(gelenSecimler)) {
    try {
      const json = JSON.stringify(gelenSecimler);
      if (Buffer.byteLength(json, "utf8") <= 10_000) guvenliSecimler = JSON.parse(json);
    } catch {
      guvenliSecimler = {};
    }
  }
  // Eski istemciler eksik seçim gönderirse ürün kataloğundan tamamla.
  const urunMetaSonuc = await pool.query(
    "SELECT kategori, malzemeler, temel_miktar FROM urunler WHERE isletme_id=$1 AND id=$2 LIMIT 1",
    [tenantId, urun.id]
  );
  const urunMeta = urunMetaSonuc.rows[0] || {};
  const tumMalzemeler = Array.isArray(urun.malzemeler)
    ? urun.malzemeler
    : Array.isArray(urunMeta.malzemeler) ? urunMeta.malzemeler : [];
  const standartGramaj = Number(guvenliSecimler.standartGramaj || urun.temelMiktar || urunMeta.temel_miktar || 0);
  const ekstraGramaj = Number(guvenliSecimler.ekstraGramaj || 0);
  const secimler = {
    ...guvenliSecimler,
    haricMalzemeler,
    dahilMalzemeler: Array.isArray(guvenliSecimler.dahilMalzemeler)
      ? guvenliSecimler.dahilMalzemeler
      : tumMalzemeler.filter((m) => !haricMalzemeler.includes(m)),
    ...(standartGramaj > 0 ? {
      standartGramaj,
      ekstraGramaj,
      toplamGramaj: Number(guvenliSecimler.toplamGramaj || standartGramaj + ekstraGramaj),
      gramajBirim: guvenliSecimler.gramajBirim || (urunMeta.kategori === "İçecekler" ? "ml" : "gr"),
      gramajEtiketi: guvenliSecimler.gramajEtiketi || "Ürün miktarı",
    } : {}),
  };
  const adet = urun.adet || 1;
  await pool.query(
    `INSERT INTO siparis_kalemleri
      (isletme_id,oturum_id,urun_id,urun_ad,fiyat,adet,kisi_adi,secimler,siparis_no,odeme_id,odeme_kalem_no,oneri_adedi)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
     ON CONFLICT (odeme_id, odeme_kalem_no)
       WHERE odeme_id IS NOT NULL AND odeme_kalem_no IS NOT NULL DO NOTHING`,
    [tenantId, oturum.id, urun.id, urun.ad, urun.fiyat, adet, kisiAdi || "Misafir", JSON.stringify(secimler), siparisNo, odemeId, odemeKalemNo, Number(urun.oneriAdedi || 0)]
  );
  if (odemeId && odemeKalemNo != null) {
    for (const atif of urun.oneriAtiflari || []) {
      await oneriOlayiKaydet(pool, {
        isletmeId: tenantId, oturumId: atif.oturumId, urunId: urun.id,
        olayTuru: "satin_alindi", adet: atif.adet, odemeId, odemeKalemNo,
      });
    }
  }
  return masaSiparisleriniGetir(tenantId, masaNo);
}

// Ödeme ve mutfak akışında fiyat yalnızca backend kataloğundan hesaplanır.
// İstemcinin gönderdiği fiyat/ad/metin alanları hiçbir şekilde kaynak kabul edilmez.
async function odemeUrunleriniDogrula(isletmeId, hamUrunler, kullaniciId = null) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  if (!Array.isArray(hamUrunler) || hamUrunler.length < 1 || hamUrunler.length > 50) {
    throw new Error("Ödeme için geçerli ürünler gerekli.");
  }
  const idler = [...new Set(hamUrunler.map((u) => Number(u?.id)).filter(Number.isInteger))];
  if (!idler.length) throw new Error("Ürün bilgisi geçersiz.");

  const sonuc = await pool.query(
    `SELECT id,ad,fiyat,kategori,gorsel,malzemeler,temel_miktar,gramaj_opsiyonu,urun_tipi,
            boyut_secenekleri,ekstra_malzeme_ayari,menu_yapisi,aktif,stok_takibi,stok_adedi
     FROM urunler WHERE isletme_id=$1 AND id = ANY($2::int[]) AND arsivli=false`,
    [tenantId, idler]
  );
  const katalog = new Map(sonuc.rows.map((urun) => [Number(urun.id), urun]));
  const bagliIdler = [...new Set(sonuc.rows.flatMap((urun) => {
    const menu = urun.menu_yapisi || {};
    return [menu.burgerUrunId, menu.yanLezzetUrunId, menu.icecekUrunId]
      .map(Number).filter(Number.isInteger);
  }))];
  const bagliSonuc = bagliIdler.length
    ? await pool.query(
      `SELECT id,ad,malzemeler,temel_miktar,gramaj_opsiyonu,urun_tipi,boyut_secenekleri,aktif
       FROM urunler WHERE isletme_id=$1 AND id=ANY($2::int[]) AND arsivli=false`, [tenantId, bagliIdler]
    )
    : { rows: [] };
  const bagliUrunler = new Map(bagliSonuc.rows.map((urun) => [Number(urun.id), urun]));
  const kampanyaIndirimleri = new Map();
  if (kullaniciId) {
    const kampanyalar = await pool.query(`SELECT id,baslik,indirim_yuzde,gecerli_kategoriler FROM kampanyalar WHERE isletme_id=$1 AND aktif=true AND indirim_yuzde > 0 AND (kampanya_tipi='surekli' OR (kampanya_tipi='saatli' AND EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Europe/Istanbul') >= baslangic_saat AND EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Europe/Istanbul') < bitis_saat))`, [tenantId]);
    for (const kampanya of kampanyalar.rows) for (const kategori of Array.isArray(kampanya.gecerli_kategoriler) ? kampanya.gecerli_kategoriler : []) {
      const mevcut = kampanyaIndirimleri.get(kategori);
      if (!mevcut || Number(kampanya.indirim_yuzde) > mevcut.indirimYuzde) kampanyaIndirimleri.set(kategori, { id: Number(kampanya.id), baslik: kampanya.baslik, indirimYuzde: Number(kampanya.indirim_yuzde) });
    }
  }

  const kullanilanAtiflar = new Map();
  const atifBilgileri = [];
  for (const ham of hamUrunler) {
    atifBilgileri.push(await oneriAtiflariniDogrula(pool, {
      isletmeId: tenantId,
      urunId: Number(ham?.id),
      adet: Math.floor(Number(ham?.adet || 0)),
      referanslar: ham?.oneriReferanslari,
      kullanilanAtiflar,
    }));
  }

  return hamUrunler.map((ham, hamIndex) => {
    const urun = katalog.get(Number(ham?.id));
    if (!urun || !urun.aktif) throw new Error("Sepetteki ürün artık satışta değil.");
    const adet = Math.floor(Number(ham?.adet || 0));
    if (!Number.isInteger(adet) || adet < 1 || adet > 30) throw new Error("Ürün adedi geçersiz.");
    const { oneriAdedi, atiflar: oneriAtiflari } = atifBilgileri[hamIndex];
    if (urun.stok_takibi === true && Number(urun.stok_adedi) < adet) {
      throw new Error(`${urun.ad} için yeterli stok bulunmuyor.`);
    }

    const gonderilenSecimler = ham?.secimler && typeof ham.secimler === "object" ? ham.secimler : {};
    const urunTipi = urun.urun_tipi || "burger";
    const menu = urunTipi === "menu" ? (urun.menu_yapisi || {}) : null;
    const burger = menu ? bagliUrunler.get(Number(menu.burgerUrunId)) : urun;
    const yanLezzet = menu ? bagliUrunler.get(Number(menu.yanLezzetUrunId)) : null;
    const icecek = menu ? bagliUrunler.get(Number(menu.icecekUrunId)) : null;
    if (menu && (!burger?.aktif || !yanLezzet?.aktif || !icecek?.aktif)) {
      throw new Error(`${urun.ad} menüsündeki bir ürün artık satışta değil.`);
    }

    const miktarAyari = burger?.gramaj_opsiyonu && burger.gramaj_opsiyonu.goster !== false ? burger.gramaj_opsiyonu : null;
    const kural = miktarAyari?.aktif ? miktarAyari : null;
    const istenenEkstra = Number(gonderilenSecimler.ekstraGramaj || 0);
    let ekstraGramaj = 0;
    let gramajFiyat = 0;
    if (kural) {
      const artis = Number(kural.artisMiktari);
      const maxAdim = Number(kural.maxAdim);
      const fiyatArtisi = Number(kural.fiyatArtisi);
      const adim = artis > 0 ? istenenEkstra / artis : NaN;
      if (!Number.isInteger(adim) || adim < 0 || adim > maxAdim) {
        throw new Error(`${urun.ad} için gramaj seçimi geçersiz.`);
      }
      ekstraGramaj = adim * artis;
      gramajFiyat = adim * fiyatArtisi;
    } else if (istenenEkstra !== 0) {
      throw new Error(`${urun.ad} için gramaj artırımı bulunmuyor.`);
    }

    const tumMalzemeler = Array.isArray(burger?.malzemeler) ? burger.malzemeler : [];
    const haricAdaylari = Array.isArray(ham?.haricMalzemeler)
      ? ham.haricMalzemeler
      : Array.isArray(gonderilenSecimler.haricMalzemeler) ? gonderilenSecimler.haricMalzemeler : [];
    const haricMalzemeler = [...new Set(haricAdaylari
      .filter((m) => typeof m === "string" && tumMalzemeler.includes(m)))]
      .slice(0, 50);
    const standartGramaj = miktarAyari ? Number(burger?.temel_miktar || 0) : 0;
    let boyutFiyati = 0;
    const boyutSec = (kaynak, istenenKod, varsayilanKod, alan) => {
      const secenekler = Array.isArray(kaynak?.boyut_secenekleri) ? kaynak.boyut_secenekleri : [];
      if (!secenekler.length) return {}; // boyutlandırma tanımlı değil: ürün standart/tek fiyatla satılır
      const varsayilanIndex = Math.max(0, secenekler.findIndex((secenek) => secenek.kod === varsayilanKod || (!varsayilanKod && secenek.varsayilan)));
      const secilenIndex = secenekler.findIndex((secenek) => secenek.kod === (istenenKod || secenekler[varsayilanIndex]?.kod));
      if (secilenIndex < varsayilanIndex || secilenIndex < 0) throw new Error(`${kaynak?.ad || urun.ad} boyut seçimi geçersiz.`);
      const secilen = secenekler[secilenIndex];
      const varsayilan = secenekler[varsayilanIndex];
      boyutFiyati += Number(secilen.fiyatFarki || 0) - Number(varsayilan?.fiyatFarki || 0);
      return {
        [`${alan}BoyutKodu`]: secilen.kod,
        [`${alan}BoyutEtiketi`]: secilen.etiket,
        [`${alan}BoyutMiktar`]: Number(secilen.miktar),
        [`${alan}BoyutBirim`]: secilen.birim,
      };
    };
    let boyutSecimleri = {};
    if (["yan_lezzet", "icecek"].includes(urunTipi)) {
      boyutSecimleri = boyutSec(urun, gonderilenSecimler.boyutKodu, null, "");
      boyutSecimleri = {
        boyutKodu: boyutSecimleri.BoyutKodu,
        boyutEtiketi: boyutSecimleri.BoyutEtiketi,
        boyutMiktar: boyutSecimleri.BoyutMiktar,
        boyutBirim: boyutSecimleri.BoyutBirim,
      };
    } else if (menu) {
      boyutSecimleri = {
        menuBurgerId: Number(burger.id), menuBurgerAd: burger.ad,
        yanLezzetId: Number(yanLezzet.id), yanLezzetAd: yanLezzet.ad,
        icecekId: Number(icecek.id), icecekAd: icecek.ad,
        ...boyutSec(yanLezzet, gonderilenSecimler.yanBoyutKodu, menu.varsayilanYanBoyut, "yan"),
        ...boyutSec(icecek, gonderilenSecimler.icecekBoyutKodu, menu.varsayilanIcecekBoyut, "icecek"),
      };
    }

    const ekstraAyari = urun.ekstra_malzeme_ayari && typeof urun.ekstra_malzeme_ayari === "object"
      ? urun.ekstra_malzeme_ayari : null;
    const ekstraAdaylari = Array.isArray(gonderilenSecimler.ekstraMalzemeIdleri)
      ? gonderilenSecimler.ekstraMalzemeIdleri : [];
    const ekstraIdleri = [...new Set(ekstraAdaylari.map((id) => String(id || "").trim()).filter(Boolean))];
    let ekstraMalzemeler = [];
    let ekstraMalzemeFiyati = 0;
    if (ekstraAyari?.aktif === true) {
      const secenekler = Array.isArray(ekstraAyari.secenekler) ? ekstraAyari.secenekler.filter((secenek) => secenek?.aktif !== false) : [];
      const secenekHaritasi = new Map(secenekler.map((secenek) => [String(secenek.id), secenek]));
      const minSecim = Math.max(0, Math.floor(Number(ekstraAyari.minSecim || 0)));
      const maxSecim = Math.max(1, Math.floor(Number(ekstraAyari.maxSecim || 1)));
      if (ekstraIdleri.length < minSecim || ekstraIdleri.length > maxSecim) throw new Error(`${urun.ad} için ekstra malzeme seçim sayısı geçersiz.`);
      ekstraMalzemeler = ekstraIdleri.map((id) => {
        const secenek = secenekHaritasi.get(id);
        if (!secenek) throw new Error(`${urun.ad} için seçilen ekstra malzeme geçersiz.`);
        const fiyat = Number(secenek.fiyat || 0);
        ekstraMalzemeFiyati += fiyat;
        return { id, ad: String(secenek.ad), fiyat };
      });
    } else if (ekstraIdleri.length) {
      throw new Error(`${urun.ad} için ekstra malzeme seçimi kapalı.`);
    }
    const secimler = {
      dahilMalzemeler: tumMalzemeler.filter((m) => !haricMalzemeler.includes(m)),
      haricMalzemeler,
      ...(standartGramaj > 0 ? {
        standartGramaj,
        ekstraGramaj,
        toplamGramaj: standartGramaj + ekstraGramaj,
        gramajEtiketi: miktarAyari?.etiket || "Ürün miktarı",
        gramajBirim: miktarAyari?.birim || "gr",
      } : {}),
      ...boyutSecimleri,
      ekstraMalzemeIdleri: ekstraMalzemeler.map((ekstra) => ekstra.id),
      ekstraMalzemeler,
    };
    const kampanya = kampanyaIndirimleri.get(urun.kategori) || null;
    const temelFiyat = Number(urun.fiyat);
    const indirimliFiyat = kampanya ? Math.round(temelFiyat * (1 - kampanya.indirimYuzde / 100) * 100) / 100 : temelFiyat;
    return {
      id: Number(urun.id),
      ad: urun.ad,
      kategori: urun.kategori,
      gorsel: urun.gorsel || null,
      adet,
      oneriAdedi,
      oneriAtiflari,
      fiyat: indirimliFiyat + gramajFiyat + boyutFiyati + ekstraMalzemeFiyati,
      orijinalFiyat: kampanya ? temelFiyat + gramajFiyat + boyutFiyati + ekstraMalzemeFiyati : null,
      kampanya,
      temelMiktar: standartGramaj || null,
      malzemeler: tumMalzemeler,
      gramajOpsiyonu: kural,
      urunTipi,
      haricMalzemeler,
      secimler,
    };
  });
}

async function suresiDolanStoklariBirak(baglanti, tenantId) {
  await baglanti.query(`
    WITH birakilan AS (
      UPDATE stok_rezervasyonlari
      SET durum='birakildi', guncelleme=NOW()
      WHERE isletme_id=$1 AND durum='aktif' AND son_gecerlilik <= NOW()
      RETURNING urun_id, adet
    ), toplam AS (
      SELECT urun_id, SUM(adet)::int adet FROM birakilan GROUP BY urun_id
    )
    UPDATE urunler u SET stok_adedi=u.stok_adedi+toplam.adet, guncelleme=NOW()
    FROM toplam WHERE u.isletme_id=$1 AND u.id=toplam.urun_id
  `, [tenantId]);
  await suresiDolanHammaddeRezervasyonlariniBirak(baglanti, tenantId);
}

async function siparisStogunuIsle(baglanti, tenantId, odemeId, urunler, { rezervasyon = false, stokAciginaIzinVer = false } = {}) {
  const adetler = siparisUrunAdetleriniTopla(urunler);
  if (!adetler.size) return;
  const idler = [...adetler.keys()];
  const urunSonucu = await baglanti.query(
    `SELECT id,ad,stok_takibi,stok_adedi FROM urunler
     WHERE isletme_id=$1 AND id=ANY($2::int[]) AND arsivli=false FOR UPDATE`,
    [tenantId, idler]
  );
  const mevcutRezervasyonlar = await baglanti.query(
    "SELECT urun_id,durum FROM stok_rezervasyonlari WHERE isletme_id=$1 AND odeme_id=$2 FOR UPDATE",
    [tenantId, odemeId]
  );
  const rezervasyonDurumlari = new Map(mevcutRezervasyonlar.rows.map((satir) => [Number(satir.urun_id), satir.durum]));

  for (const urun of urunSonucu.rows.filter((satir) => satir.stok_takibi === true)) {
    const urunId = Number(urun.id);
    const adet = adetler.get(urunId) || 0;
    const mevcutDurum = rezervasyonDurumlari.get(urunId);
    if (mevcutDurum === "tuketildi") continue;
    if (!rezervasyon && mevcutDurum === "aktif") {
      await baglanti.query(
        "UPDATE stok_rezervasyonlari SET durum='tuketildi',guncelleme=NOW() WHERE odeme_id=$1 AND urun_id=$2",
        [odemeId, urunId]
      );
      continue;
    }
    if (rezervasyon && mevcutDurum === "aktif") continue;
    if (Number(urun.stok_adedi) < adet && !stokAciginaIzinVer) throw new Error(`${urun.ad} için yeterli stok bulunmuyor.`);
    await baglanti.query(
      "UPDATE urunler SET stok_adedi=GREATEST(0,stok_adedi-$1),guncelleme=NOW() WHERE isletme_id=$2 AND id=$3",
      [adet, tenantId, urunId]
    );
    await baglanti.query(
      `INSERT INTO stok_rezervasyonlari (odeme_id,isletme_id,urun_id,adet,durum,son_gecerlilik)
       VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '20 minutes')
       ON CONFLICT (odeme_id,urun_id) DO UPDATE SET
         adet=EXCLUDED.adet, durum=EXCLUDED.durum, son_gecerlilik=EXCLUDED.son_gecerlilik, guncelleme=NOW()`,
      [odemeId, tenantId, urunId, adet, rezervasyon ? "aktif" : "tuketildi"]
    );
  }
  await siparisReceteStogunuIsle(baglanti, tenantId, odemeId, urunler, { rezervasyon, stokAciginaIzinVer });
}

export async function suresiDolanStokRezervasyonlariniBirak(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await suresiDolanStoklariBirak(pool, tenantId);
}

export async function siparisStogunuKesinlestir(isletmeId, odemeId, urunler) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    await suresiDolanStoklariBirak(baglanti, tenantId);
    await siparisStogunuIsle(baglanti, tenantId, odemeId, urunler);
    await baglanti.query("COMMIT");
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
}

export async function odemeTaslagiOlustur(isletmeId, { kullaniciId = null, masaNo = null, yontem = "tam", urunler, kisiAdi = "Misafir", idempotencyAnahtari = null }) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  if (idempotencyAnahtari) {
    const mevcut = await pool.query(
      `SELECT * FROM odeme_islemleri
       WHERE isletme_id=$1 AND idempotency_kapsam='odeme-taslagi' AND idempotency_anahtar=$2`,
      [tenantId, idempotencyAnahtari]
    );
    if (mevcut.rows[0]) return odemeDonustur(mevcut.rows[0]);
  }
  await suresiDolanStoklariBirak(pool, tenantId);
  const guvenliUrunler = await odemeUrunleriniDogrula(tenantId, urunler, kullaniciId);
  const hamMasa = masaNo == null || masaNo === "" ? null : String(masaNo).trim();
  if (hamMasa && !/^[A-Za-z0-9_-]{1,30}$/.test(hamMasa)) throw new Error("Masa numarası geçersiz.");
  const guvenliMasa = hamMasa;
  const tip = guvenliMasa ? "masa" : "algotur";
  const guvenliYontem = ["tam", "esit", "urun"].includes(yontem) ? yontem : "tam";
  const tutar = guvenliUrunler.reduce((toplam, urun) => toplam + urun.fiyat * urun.adet, 0);
  const kazanilanPuan = kullaniciId ? Math.floor(tutar / 10) : 0;
  const id = randomUUID();
  const siparisNo = `BP-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    await suresiDolanStoklariBirak(baglanti, tenantId);
    let sonuc = await baglanti.query(
      `INSERT INTO odeme_islemleri
        (isletme_id,id,kullanici_id,siparis_no,masa_no,siparis_tipi,yontem,kisi_adi,urunler,tutar,kazanilan_puan,
         idempotency_kapsam,idempotency_anahtar)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'odeme-taslagi',$12)
       ON CONFLICT (isletme_id,idempotency_kapsam,idempotency_anahtar)
         WHERE idempotency_kapsam IS NOT NULL AND idempotency_anahtar IS NOT NULL DO NOTHING
       RETURNING *`,
      [tenantId, id, kullaniciId, siparisNo, guvenliMasa, tip, guvenliYontem,
        String(kisiAdi || "Misafir").trim().slice(0, 120) || "Misafir",
        JSON.stringify(guvenliUrunler), tutar, kazanilanPuan, idempotencyAnahtari]
    );
    if (!sonuc.rows.length && idempotencyAnahtari) {
      sonuc = await baglanti.query(
        `SELECT * FROM odeme_islemleri
         WHERE isletme_id=$1 AND idempotency_kapsam='odeme-taslagi' AND idempotency_anahtar=$2`,
        [tenantId, idempotencyAnahtari]
      );
      await baglanti.query("COMMIT");
      return odemeDonustur(sonuc.rows[0]);
    }
    await siparisStogunuIsle(baglanti, tenantId, id, guvenliUrunler, { rezervasyon: true });
    await baglanti.query("COMMIT");
    return odemeDonustur(sonuc.rows[0]);
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
}

function nakitMasaNoDogrula(masaNo) {
  const deger = String(masaNo || "").trim();
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(deger)) throw new Error("Masa numarası geçersiz.");
  return deger;
}

export async function nakitMasaDurumunuGetir(isletmeId, masaNo) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const guvenliMasaNo = nakitMasaNoDogrula(masaNo);
  const sonuc = await pool.query(
    "SELECT aktif,acilis FROM nakit_masalari WHERE isletme_id=$1 AND masa_no=$2",
    [tenantId, guvenliMasaNo]
  );
  return {
    masaNo: guvenliMasaNo,
    nakitAcik: sonuc.rows[0]?.aktif === true,
    acilis: sonuc.rows[0]?.acilis || null,
  };
}

export async function nakitMasalariniGetir(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const [ayar, masaKayitlari, siparisler] = await Promise.all([
    pool.query("SELECT deger FROM sistem_ayarlari WHERE isletme_id=$1 AND anahtar='masa_sayisi'", [tenantId]),
    pool.query("SELECT masa_no,aktif,acilis,kapanis FROM nakit_masalari WHERE isletme_id=$1", [tenantId]),
    pool.query(
      `SELECT * FROM odeme_islemleri
       WHERE isletme_id=$1 AND saglayici='nakit'
         AND durum IN ('personel_onayi','nakit_bekliyor')
       ORDER BY olusturma`,
      [tenantId]
    ),
  ]);
  const hamAyar = ayar.rows[0]?.deger;
  const adet = Math.min(200, Math.max(1, Number(hamAyar?.adet ?? hamAyar ?? 20) || 20));
  const kayitHaritasi = new Map(masaKayitlari.rows.map((masa) => [String(masa.masa_no), masa]));
  const masaNumaralari = new Set(Array.from({ length: adet }, (_, sira) => String(sira + 1)));
  masaKayitlari.rows.forEach((masa) => masaNumaralari.add(String(masa.masa_no)));
  siparisler.rows.forEach((siparis) => masaNumaralari.add(String(siparis.masa_no)));
  return [...masaNumaralari]
    .sort((a, b) => a.localeCompare(b, "tr", { numeric: true }))
    .map((masaNo) => {
      const kayit = kayitHaritasi.get(masaNo);
      return {
        masaNo,
        nakitAcik: kayit?.aktif === true,
        acilis: kayit?.acilis || null,
        kapanis: kayit?.kapanis || null,
        siparisler: siparisler.rows.filter((siparis) => String(siparis.masa_no) === masaNo).map(odemeDonustur),
      };
    });
}

export async function nakitMasasiniAc(isletmeId, masaNo, kullaniciId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const guvenliMasaNo = nakitMasaNoDogrula(masaNo);
  await pool.query(
    `INSERT INTO nakit_masalari
      (isletme_id,masa_no,aktif,acan_kullanici_id,kapatan_kullanici_id,acilis,kapanis,guncelleme)
     VALUES ($1,$2,true,$3,NULL,NOW(),NULL,NOW())
     ON CONFLICT (isletme_id,masa_no) DO UPDATE SET
       aktif=true, acan_kullanici_id=EXCLUDED.acan_kullanici_id,
       kapatan_kullanici_id=NULL, acilis=NOW(), kapanis=NULL, guncelleme=NOW()`,
    [tenantId, guvenliMasaNo, kullaniciId || null]
  );
  return nakitMasaDurumunuGetir(tenantId, guvenliMasaNo);
}

export async function nakitSiparisOlustur(isletmeId, { kullaniciId = null, masaNo, urunler, kisiAdi = "Misafir", idempotencyAnahtari = null }) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  if (idempotencyAnahtari) {
    const mevcut = await pool.query(
      `SELECT * FROM odeme_islemleri
       WHERE isletme_id=$1 AND idempotency_kapsam='nakit-siparis' AND idempotency_anahtar=$2`,
      [tenantId, idempotencyAnahtari]
    );
    if (mevcut.rows[0]) return odemeDonustur(mevcut.rows[0]);
  }
  const guvenliMasaNo = nakitMasaNoDogrula(masaNo);
  await suresiDolanStoklariBirak(pool, tenantId);
  const guvenliUrunler = await odemeUrunleriniDogrula(tenantId, urunler, kullaniciId);
  const tutar = guvenliUrunler.reduce((toplam, urun) => toplam + urun.fiyat * urun.adet, 0);
  const kazanilanPuan = kullaniciId ? Math.floor(tutar / 10) : 0;
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const masa = await baglanti.query(
      "SELECT aktif FROM nakit_masalari WHERE isletme_id=$1 AND masa_no=$2 FOR UPDATE",
      [tenantId, guvenliMasaNo]
    );
    if (masa.rows[0]?.aktif !== true) throw new Error("Bu masa nakit siparişe açık değil. Personelden masayı açmasını isteyin.");
    const id = randomUUID();
    const siparisNo = `BP-N-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let sonuc = await baglanti.query(
      `INSERT INTO odeme_islemleri
        (isletme_id,id,kullanici_id,siparis_no,masa_no,siparis_tipi,yontem,kisi_adi,
         urunler,tutar,kazanilan_puan,saglayici,durum,son_gecerlilik,idempotency_kapsam,idempotency_anahtar)
       VALUES ($1,$2,$3,$4,$5,'masa','tam',$6,$7::jsonb,$8,$9,'nakit','personel_onayi',NOW()+INTERVAL '6 hours','nakit-siparis',$10)
       ON CONFLICT (isletme_id,idempotency_kapsam,idempotency_anahtar)
         WHERE idempotency_kapsam IS NOT NULL AND idempotency_anahtar IS NOT NULL DO NOTHING
       RETURNING *`,
      [tenantId, id, kullaniciId, siparisNo, guvenliMasaNo,
        String(kisiAdi || "Misafir").trim().slice(0, 120) || "Misafir",
        JSON.stringify(guvenliUrunler), tutar, kazanilanPuan, idempotencyAnahtari]
    );
    if (!sonuc.rows.length && idempotencyAnahtari) {
      sonuc = await baglanti.query(
        `SELECT * FROM odeme_islemleri
         WHERE isletme_id=$1 AND idempotency_kapsam='nakit-siparis' AND idempotency_anahtar=$2`,
        [tenantId, idempotencyAnahtari]
      );
    }
    await baglanti.query("COMMIT");
    return odemeDonustur(sonuc.rows[0]);
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
}

export async function nakitSiparisiOnayla(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const sonuc = await baglanti.query(
      `UPDATE odeme_islemleri SET durum='nakit_bekliyor',guncelleme=NOW()
       WHERE isletme_id=$1 AND id=$2 AND saglayici='nakit' AND durum='personel_onayi'
       RETURNING *`,
      [tenantId, id]
    );
    let odeme = sonuc.rows[0];
    if (!odeme) {
      const mevcut = await baglanti.query(
        "SELECT * FROM odeme_islemleri WHERE isletme_id=$1 AND id=$2 AND saglayici='nakit' AND durum='nakit_bekliyor'",
        [tenantId, id]
      );
      odeme = mevcut.rows[0];
    }
    if (!odeme) throw new Error("Sipariş onaylanabilir durumda değil.");
    await suresiDolanStoklariBirak(baglanti, tenantId);
    await siparisStogunuIsle(baglanti, tenantId, odeme.id, odeme.urunler);
    if (odeme.kullanici_id) {
      await baglanti.query(
        `INSERT INTO kullanici_siparisleri
          (isletme_id,kullanici_id,siparis_no,masa_no,tip,urunler,tutar,kazanilan_puan,durum)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,0,'yeni')
         ON CONFLICT (kullanici_id,siparis_no) DO NOTHING`,
        [tenantId, odeme.kullanici_id, odeme.siparis_no, odeme.masa_no,
          odeme.siparis_tipi, JSON.stringify(odeme.urunler), odeme.tutar]
      );
    }
    await baglanti.query("COMMIT");
    return odemeDonustur(odeme);
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
}

export async function nakitSiparisiReddet(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `UPDATE odeme_islemleri SET durum='reddedildi',guncelleme=NOW()
     WHERE isletme_id=$1 AND id=$2 AND saglayici='nakit' AND durum='personel_onayi'
     RETURNING *`,
    [tenantId, id]
  );
  if (!sonuc.rows.length) throw new Error("Sipariş reddedilebilir durumda değil.");
  return odemeDonustur(sonuc.rows[0]);
}

export async function nakitSiparisiTahsilEt(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const uygun = await pool.query(
    `SELECT mutfaga_aktarildi FROM odeme_islemleri
     WHERE isletme_id=$1 AND id=$2 AND saglayici='nakit' AND durum='nakit_bekliyor'`,
    [tenantId, id]
  );
  if (!uygun.rows.length) throw new Error("Sipariş tahsil edilebilir durumda değil.");
  if (uygun.rows[0].mutfaga_aktarildi !== true) throw new Error("Sipariş mutfağa aktarılmadan tahsilat tamamlanamaz.");
  return odemeBasariliOlarakIsle(tenantId, id, "nakit", null, null, "nakit_bekliyor");
}

export async function odemeSimulasyonOnayla(isletmeId, id, kullaniciId = null) {
  return odemeBasariliOlarakIsle(isletmeId, id, "simulasyon", null, kullaniciId);
}

export async function odemeIyzicoOlarakOnayla(isletmeId, id, token) {
  return odemeBasariliOlarakIsle(isletmeId, id, "iyzico", token, null);
}

export async function odemeCuzdanlaOnayla(isletmeId, id, kullaniciId) {
  if (!kullaniciId) throw new Error("Cüzdan ödemesi için giriş gerekli.");
  return odemeBasariliOlarakIsle(isletmeId, id, "cuzdan", null, kullaniciId);
}

async function odemeBasariliOlarakIsle(isletmeId, id, saglayici, saglayiciToken, kullaniciId = null, beklenenDurum = "bekliyor") {
  const tenantId = isletmeIdZorunlu(isletmeId);
  // İyzico sonucu sağlayıcıdan doğrulanmış gerçek bir tahsilattır. Kullanıcı
  // ödeme formundayken yerel taslak süresi dolsa bile alınmış ödemeyi reddetme.
  // Simülasyonda ise eski taslakların onaylanmasını engellemeye devam et.
  const sureKosulu = ["iyzico", "nakit"].includes(saglayici) ? "" : "AND son_gecerlilik > NOW()";
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const sonuc = await baglanti.query(
      `UPDATE odeme_islemleri
       SET durum='basarili', saglayici=$3, saglayici_token=COALESCE($4, saglayici_token), basarili_at=NOW(), guncelleme=NOW()
       WHERE isletme_id=$1 AND id=$2 AND durum=$6 ${sureKosulu}
         AND ($5::int IS NULL OR kullanici_id=$5)
       RETURNING *`,
      [tenantId, id, saglayici, saglayiciToken, kullaniciId, beklenenDurum]
    );
    if (sonuc.rows.length) {
      const odeme = sonuc.rows[0];
      let guncelBakiye = null;
      if (saglayici === "cuzdan") {
        if (!odeme.kullanici_id) throw new Error("Cüzdan ödemesi bir müşteri hesabına bağlı olmalıdır.");
        const tutarKurus = Math.round(Number(odeme.tutar) * 100);
        const bakiyeSonucu = await baglanti.query(
          `UPDATE kullanicilar SET bakiye_kurus=bakiye_kurus-$1
           WHERE isletme_id=$2 AND id=$3 AND bakiye_kurus >= $1 RETURNING bakiye_kurus`,
          [tutarKurus, tenantId, odeme.kullanici_id]
        );
        if (!bakiyeSonucu.rows.length) throw new Error("Cüzdan bakiyesi bu ödeme için yetersiz.");
        guncelBakiye = Number(bakiyeSonucu.rows[0].bakiye_kurus) / 100;
        await baglanti.query(
          `INSERT INTO cuzdan_hareketleri
            (id,isletme_id,kullanici_id,tur,tutar_kurus,odeme_id,aciklama)
           VALUES ($1,$2,$3,'cuzdan_harcama',$4,$5,$6)
           ON CONFLICT (isletme_id,odeme_id) WHERE odeme_id IS NOT NULL DO NOTHING`,
          [randomUUID(), tenantId, odeme.kullanici_id, -tutarKurus, odeme.id, `Sipariş ödemesi: ${odeme.siparis_no}`]
        );
      }
      await suresiDolanStoklariBirak(baglanti, tenantId);
      await siparisStogunuIsle(baglanti, tenantId, odeme.id, odeme.urunler, { stokAciginaIzinVer: saglayici === "iyzico" });
      let guncelPuan = null;
      if (odeme.kullanici_id && Number(odeme.kazanilan_puan) > 0) {
        const puanSonuc = await baglanti.query(
          "UPDATE kullanicilar SET puan=puan+$1 WHERE isletme_id=$2 AND id=$3 RETURNING puan",
          [odeme.kazanilan_puan, tenantId, odeme.kullanici_id]
        );
        guncelPuan = Number(puanSonuc.rows[0]?.puan);
        await baglanti.query(
          `INSERT INTO puan_hareketleri (isletme_id,kullanici_id,tur,puan,aciklama,odeme_id)
           VALUES ($1,$2,'siparis_kazanci',$3,'Sipariş puanı',$4)
           ON CONFLICT (kullanici_id,tur,odeme_id) WHERE odeme_id IS NOT NULL DO NOTHING`,
          [tenantId, odeme.kullanici_id, odeme.kazanilan_puan, odeme.id]
        );
      }
      const sadakat = await odemeSadakatiniUygula(tenantId, baglanti, odeme);
      const davetOdulu = await davetOdulunuUygula(tenantId, baglanti, odeme);
      if (odeme.kullanici_id) {
        await baglanti.query(
          `INSERT INTO kullanici_siparisleri
            (isletme_id,kullanici_id,siparis_no,masa_no,tip,urunler,tutar,kazanilan_puan,durum)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'hazirlaniyor')
           ON CONFLICT (kullanici_id,siparis_no) DO UPDATE SET
             kazanilan_puan=EXCLUDED.kazanilan_puan`,
          [tenantId, odeme.kullanici_id, odeme.siparis_no, odeme.masa_no, odeme.siparis_tipi,
            JSON.stringify(odeme.urunler), odeme.tutar, odeme.kazanilan_puan]
        );
      }
      await baglanti.query("COMMIT");
      return {
        odeme: {
          ...odemeDonustur(odeme),
          guncelPuan,
          burgerDamga: sadakat.burgerDamga,
          kazanilanHediye: sadakat.kazanilanHediye,
          davetOdulu,
          guncelBakiye,
        },
        ilkOnay: true,
      };
    }
    await baglanti.query("COMMIT");
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }

  const mevcut = await pool.query("SELECT * FROM odeme_islemleri WHERE isletme_id=$1 AND id=$2", [tenantId, id]);
  if (!mevcut.rows.length) throw new Error("Ödeme taslağı bulunamadı.");
  if (kullaniciId && Number(mevcut.rows[0].kullanici_id) !== Number(kullaniciId)) {
    throw new Error("Bu ödeme taslağı başka bir hesaba ait.");
  }
  const odeme = odemeDonustur(mevcut.rows[0]);
  if (odeme.durum !== "basarili") throw new Error("Ödeme taslağının süresi dolmuş veya işlem tamamlanamamış.");
  return { odeme, ilkOnay: false };
}

async function davetOdulunuUygula(isletmeId, baglanti, odeme) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  if (!odeme.kullanici_id) return null;
  const puan = davetPuaniHesapla(odeme.tutar);
  if (puan < 1) return null;

  const eklenen = await baglanti.query(
    `INSERT INTO davet_odulleri
      (isletme_id,davet_eden_id,davet_edilen_id,odeme_id,siparis_tutari,oran,puan)
     SELECT $1,davet_eden_id,id,$3,$4,0.05,$5
     FROM kullanicilar
     WHERE isletme_id=$1 AND id=$2 AND davet_eden_id IS NOT NULL AND davet_eden_id <> id
     ON CONFLICT (odeme_id) DO NOTHING
     RETURNING davet_eden_id,davet_edilen_id,puan`,
    [tenantId, odeme.kullanici_id, odeme.id, odeme.tutar, puan]
  );
  if (!eklenen.rows.length) return null;

  const odul = eklenen.rows[0];
  await baglanti.query("UPDATE kullanicilar SET puan=puan+$1 WHERE isletme_id=$2 AND id=$3", [odul.puan, tenantId, odul.davet_eden_id]);
  await baglanti.query(
    `INSERT INTO puan_hareketleri
      (isletme_id,kullanici_id,tur,puan,aciklama,odeme_id,kaynak_kullanici_id)
     VALUES ($1,$2,'davet_kazanci',$3,'Davet edilen kullanıcının siparişinden %5 ödül',$4,$5)
     ON CONFLICT (kullanici_id,tur,odeme_id) WHERE odeme_id IS NOT NULL DO NOTHING`,
    [tenantId, odul.davet_eden_id, odul.puan, odeme.id, odul.davet_edilen_id]
  );
  return { kullaniciId: Number(odul.davet_eden_id), puan: Number(odul.puan) };
}

// İade servisi eklendiğinde aynı transaction içinde çağrılmak üzere hazırdır.
// Ödülü yalnızca bir kez geri alır ve puanı hiçbir zaman sıfırın altına düşürmez.
export async function davetOdulunuGeriAl(isletmeId, odemeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const sonuc = await baglanti.query(
      `UPDATE davet_odulleri SET durum='geri_alindi',geri_alinma=NOW()
       WHERE isletme_id=$1 AND odeme_id=$2 AND durum='kazanildi'
       RETURNING davet_eden_id,davet_edilen_id,puan`,
      [tenantId, odemeId]
    );
    if (!sonuc.rows.length) {
      await baglanti.query("COMMIT");
      return false;
    }
    const odul = sonuc.rows[0];
    await baglanti.query(
      "UPDATE kullanicilar SET puan=GREATEST(0,puan-$1) WHERE isletme_id=$2 AND id=$3",
      [odul.puan, tenantId, odul.davet_eden_id]
    );
    await baglanti.query(
      `INSERT INTO puan_hareketleri
        (isletme_id,kullanici_id,tur,puan,aciklama,odeme_id,kaynak_kullanici_id)
       VALUES ($1,$2,'davet_iadesi',$3,'İade edilen siparişin davet ödülü geri alındı',$4,$5)
       ON CONFLICT (kullanici_id,tur,odeme_id) WHERE odeme_id IS NOT NULL DO NOTHING`,
      [tenantId, odul.davet_eden_id, -Number(odul.puan), odemeId, odul.davet_edilen_id]
    );
    await baglanti.query("COMMIT");
    return true;
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
}

export async function odemeGetir(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query("SELECT * FROM odeme_islemleri WHERE isletme_id=$1 AND id=$2", [tenantId, id]);
  return sonuc.rows[0] ? odemeDonustur(sonuc.rows[0]) : null;
}

export async function odemeIyzicoBaslatiminiTalepEt(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const mevcut = await pool.query(
    `SELECT saglayici_token,saglayici_sayfa_url,iyzico_baslatim_basladi
     FROM odeme_islemleri WHERE isletme_id=$1 AND id=$2 AND durum='bekliyor'`,
    [tenantId, id]
  );
  if (!mevcut.rows.length) throw new Error("Odeme taslagi odeme baslatmak icin uygun degil.");
  if (mevcut.rows[0].saglayici_token && mevcut.rows[0].saglayici_sayfa_url) {
    return { durum: "tamamlandi", paymentPageUrl: mevcut.rows[0].saglayici_sayfa_url };
  }
  const alinan = await pool.query(
    `UPDATE odeme_islemleri
     SET iyzico_baslatim_basladi=NOW(),guncelleme=NOW()
     WHERE isletme_id=$1 AND id=$2 AND durum='bekliyor'
       AND saglayici_token IS NULL
       AND (iyzico_baslatim_basladi IS NULL OR iyzico_baslatim_basladi < NOW()-INTERVAL '5 minutes')
     RETURNING id`,
    [tenantId, id]
  );
  return { durum: alinan.rows.length ? "alindi" : "isleniyor" };
}

export async function odemeIyzicoBaslatiminiBirak(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(
    `UPDATE odeme_islemleri SET iyzico_baslatim_basladi=NULL,guncelleme=NOW()
     WHERE isletme_id=$1 AND id=$2 AND durum='bekliyor' AND saglayici_token IS NULL`,
    [tenantId, id]
  );
}

export async function odemeSaglayiciTokenKaydet(isletmeId, id, token, paymentPageUrl) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const sonuc = await baglanti.query(
      `UPDATE odeme_islemleri SET saglayici='iyzico', saglayici_token=$3,
         saglayici_sayfa_url=$4, iyzico_baslatim_basladi=NULL,
         son_gecerlilik=NOW()+INTERVAL '60 minutes', guncelleme=NOW()
       WHERE isletme_id=$1 AND id=$2 AND durum='bekliyor' AND son_gecerlilik > NOW() RETURNING *`,
      [tenantId, id, token, paymentPageUrl]
    );
    if (!sonuc.rows.length) throw new Error("Ödeme taslağı ödeme başlatmak için uygun değil.");
    await baglanti.query(
      `UPDATE stok_rezervasyonlari SET son_gecerlilik=NOW()+INTERVAL '60 minutes',guncelleme=NOW()
       WHERE isletme_id=$1 AND odeme_id=$2 AND durum='aktif'`,
      [tenantId, id]
    );
    await baglanti.query("COMMIT");
    return odemeDonustur(sonuc.rows[0]);
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
}

export async function odemeSaglayiciTokeniniGetir(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    "SELECT saglayici_token FROM odeme_islemleri WHERE isletme_id=$1 AND id=$2",
    [tenantId, id]
  );
  return String(sonuc.rows[0]?.saglayici_token || "").trim() || null;
}

export async function iyzicoTokeniyleOdemeGetir(token) {
  // İyzico callback tenant başlığı göndermez; tenant bu benzersiz token ile
  // bulunan ödeme kaydındaki isletme_id alanından çözülür.
  const sonuc = await pool.query("SELECT * FROM odeme_islemleri WHERE saglayici_token=$1", [token]);
  return sonuc.rows[0] ? odemeDonustur(sonuc.rows[0]) : null;
}

export async function odemeMutfagaAktarildi(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(
    "UPDATE odeme_islemleri SET mutfaga_aktarildi=true, mutfaga_aktarim_basladi=NULL, guncelleme=NOW() WHERE isletme_id=$1 AND id=$2 AND durum IN ('basarili','nakit_bekliyor')",
    [tenantId, id]
  );
}

export async function odemeMutfakAktariminiTalepEt(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const talep = await pool.query(
    `UPDATE odeme_islemleri
     SET mutfaga_aktarim_basladi=NOW(),guncelleme=NOW()
     WHERE isletme_id=$1 AND id=$2 AND durum IN ('basarili','nakit_bekliyor')
       AND mutfaga_aktarildi=false
       AND (mutfaga_aktarim_basladi IS NULL OR mutfaga_aktarim_basladi < NOW()-INTERVAL '5 minutes')
     RETURNING *`,
    [tenantId, id]
  );
  if (talep.rows[0]) return { durum: "alindi", odeme: odemeDonustur(talep.rows[0]) };
  const mevcut = await pool.query(
    "SELECT * FROM odeme_islemleri WHERE isletme_id=$1 AND id=$2",
    [tenantId, id]
  );
  if (!mevcut.rows[0]) throw new Error("Ödeme taslağı bulunamadı.");
  return {
    durum: mevcut.rows[0].mutfaga_aktarildi ? "tamamlandi" : "isleniyor",
    odeme: odemeDonustur(mevcut.rows[0]),
  };
}

export async function odemeMutfakAktariminiBirak(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(
    `UPDATE odeme_islemleri SET mutfaga_aktarim_basladi=NULL,guncelleme=NOW()
     WHERE isletme_id=$1 AND id=$2 AND mutfaga_aktarildi=false`,
    [tenantId, id]
  );
}

function odemeDonustur(odeme) {
  return {
    id: odeme.id,
    isletmeId: Number(odeme.isletme_id),
    siparisNo: odeme.siparis_no,
    kullaniciId: odeme.kullanici_id,
    masaNo: odeme.masa_no,
    tip: odeme.siparis_tipi,
    yontem: odeme.yontem,
    kisiAdi: odeme.kisi_adi,
    urunler: Array.isArray(odeme.urunler) ? odeme.urunler : [],
    tutar: Number(odeme.tutar),
    kazanilanPuan: Number(odeme.kazanilan_puan),
    saglayici: odeme.saglayici,
    durum: odeme.durum,
    mutfagaAktarildi: odeme.mutfaga_aktarildi,
    tarih: odeme.olusturma,
  };
}

// Mutfak: bir masanin tum kalemlerini belirli duruma gecir.
export async function masaDurumGuncelle(isletmeId, masaNo, durum, kullaniciId = null, siparisNo = null) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const oturum = await pool.query(
    "SELECT * FROM oturumlar WHERE isletme_id=$1 AND masa_no=$2 AND durum='acik' ORDER BY id DESC LIMIT 1",
    [tenantId, masaNo]
  );
  if (oturum.rows.length === 0) return null;

  const izinliDurumlar = new Set(["yeni", "hazirlaniyor", "hazir"]);
  if (!izinliDurumlar.has(durum)) throw new Error("Gecersiz siparis durumu.");
  const guvenliSiparisNo = siparisNo == null ? null : String(siparisNo).trim().slice(0, 120);
  if (siparisNo != null && !guvenliSiparisNo) throw new Error("Gecersiz siparis numarasi.");
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const personel = kullaniciId
      ? await baglanti.query("SELECT id FROM personeller WHERE isletme_id=$1 AND kullanici_id=$2 AND aktif=true AND arsivli=false LIMIT 1", [tenantId, kullaniciId])
      : { rows: [] };
    const personelId = personel.rows[0]?.id || null;
    let kalemler;
    if (durum === "hazirlaniyor") {
      kalemler = await baglanti.query(
         `UPDATE siparis_kalemleri SET durum=$1,
           hazirlamaya_baslandi=COALESCE(hazirlamaya_baslandi,NOW()),
           hazirlayan_personel_id=COALESCE($4,hazirlayan_personel_id)
         WHERE isletme_id=$2 AND oturum_id=$3 AND ($5::text IS NULL OR siparis_no=$5) RETURNING siparis_no`,
        [durum, tenantId, oturum.rows[0].id, personelId, guvenliSiparisNo]
      );
    } else if (durum === "hazir") {
      kalemler = await baglanti.query(
        `UPDATE siparis_kalemleri SET durum=$1,
           hazirlamaya_baslandi=COALESCE(hazirlamaya_baslandi,NOW()),
           hazir_at=COALESCE(hazir_at,NOW()),
           hazirlayan_personel_id=COALESCE($4,hazirlayan_personel_id)
         WHERE isletme_id=$2 AND oturum_id=$3 AND ($5::text IS NULL OR siparis_no=$5) RETURNING siparis_no`,
        [durum, tenantId, oturum.rows[0].id, personelId, guvenliSiparisNo]
      );
    } else {
      kalemler = await baglanti.query(
        "UPDATE siparis_kalemleri SET durum=$1 WHERE isletme_id=$2 AND oturum_id=$3 AND ($4::text IS NULL OR siparis_no=$4) RETURNING siparis_no",
        [durum, tenantId, oturum.rows[0].id, guvenliSiparisNo]
      );
    }
    const siparisNolari = [...new Set(kalemler.rows
      .map((kalem) => kalem.siparis_no)
      .filter(Boolean))];
    if (siparisNolari.length) {
      await baglanti.query(
        "UPDATE kullanici_siparisleri SET durum=$1 WHERE isletme_id=$2 AND siparis_no=ANY($3::text[]) AND tamamlandi=false",
        [durum, tenantId, siparisNolari]
      );
    }
    await baglanti.query("COMMIT");
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
  return masaSiparisleriniGetir(tenantId, masaNo);
}

// Mutfak ekrani icin: tum acik masalarin (kalemi olan) siparisleri.
export async function tumAcikMasalar(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const oturumlar = await pool.query(
    "SELECT DISTINCT masa_no FROM oturumlar WHERE isletme_id=$1 AND durum='acik' ORDER BY masa_no",
    [tenantId]
  );
  const sonuc = await Promise.all(oturumlar.rows.map((o) => masaSiparisleriniGetir(tenantId, o.masa_no)));
  return sonuc.filter((masa) => masa.kalemler.length > 0);
}

// Salon personeli: masayi kapatir (musteriler kalkinca).
// Oturum 'kapali' olur; siparisler SILINMEZ (rapor icin arsivde kalir),
// ama yeni gelen musteri temiz masayla baslar (yeni oturum acilir).
export async function masaKapat(isletmeId, masaNo, kullaniciId = null) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const guvenliMasaNo = nakitMasaNoDogrula(masaNo);
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    // Masa kapatma ile aynı anda yeni nakit sipariş oluşturulmasını engelle.
    // Sipariş oluşturma da bu satırı FOR UPDATE kilitlediği için iki işlem
    // sıraya girer ve kapalı masada bekleyen sipariş bırakılamaz.
    await baglanti.query(
      "SELECT aktif FROM nakit_masalari WHERE isletme_id=$1 AND masa_no=$2 FOR UPDATE",
      [tenantId, guvenliMasaNo]
    );
    const acikNakit = await baglanti.query(
      `SELECT COUNT(*)::int AS adet FROM odeme_islemleri
       WHERE isletme_id=$1 AND masa_no=$2 AND saglayici='nakit'
         AND durum IN ('personel_onayi','nakit_bekliyor')`,
      [tenantId, guvenliMasaNo]
    );
    if (Number(acikNakit.rows[0]?.adet) > 0) {
      throw new Error("Bekleyen veya tahsil edilmemiş nakit siparişler varken masa kapatılamaz.");
    }
    const personel = kullaniciId
      ? await baglanti.query("SELECT id FROM personeller WHERE isletme_id=$1 AND kullanici_id=$2 AND aktif=true AND arsivli=false LIMIT 1", [tenantId, kullaniciId])
      : { rows: [] };
    const oturumlar = await baglanti.query(
      "UPDATE oturumlar SET durum='kapali',kapandi_at=NOW(),kapatan_personel_id=$3 WHERE isletme_id=$1 AND masa_no=$2 AND durum='acik' RETURNING id",
      [tenantId, guvenliMasaNo, personel.rows[0]?.id || null]
    );
    const oturumIdleri = oturumlar.rows.map((satir) => satir.id);
    if (oturumIdleri.length) {
      const kalemler = await baglanti.query(
        "SELECT siparis_no FROM siparis_kalemleri WHERE isletme_id=$1 AND oturum_id=ANY($2::int[])",
        [tenantId, oturumIdleri]
      );
      const siparisNolari = [...new Set(kalemler.rows
        .map((kalem) => kalem.siparis_no)
        .filter(Boolean))];
      if (siparisNolari.length) {
        await baglanti.query(
          "UPDATE kullanici_siparisleri SET durum='tamamlandi',tamamlandi=true WHERE isletme_id=$1 AND siparis_no=ANY($2::text[])",
          [tenantId, siparisNolari]
        );
      }
    }
    await baglanti.query(
      `UPDATE nakit_masalari SET aktif=false,kapatan_kullanici_id=$3,kapanis=NOW(),guncelleme=NOW()
       WHERE isletme_id=$1 AND masa_no=$2 AND aktif=true`,
      [tenantId, guvenliMasaNo, kullaniciId || null]
    );
    await baglanti.query("COMMIT");
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
  return masaSiparisleriniGetir(tenantId, guvenliMasaNo);
}

// ============================================================================
// Kullanici islemleri (auth)
// ============================================================================

// Yeni kullanici olustur (sifre zaten hash'lenmis gelir).
export async function kullaniciOlustur(isletmeId, { ad, soyad, cinsiyet, email, telefon, sifreHash, davetEdenId = null }) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  for (let deneme = 0; deneme < 20; deneme += 1) {
    try {
      const sonuc = await pool.query(
        `INSERT INTO kullanicilar
          (isletme_id,ad,soyad,cinsiyet,email,telefon,sifre_hash,davet_kodu,davet_eden_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id,isletme_id,ad,soyad,cinsiyet,email,telefon,rol,puan,davet_kodu,burger_damga`,
        [tenantId, ad, soyad, cinsiyet, email.toLowerCase(), telefon, sifreHash, davetKoduUret(), davetEdenId]
      );
      return kullaniciDonustur(sonuc.rows[0]);
    } catch (e) {
      const davetKoduCakismasi = e.code === "23505" && String(e.constraint || "").includes("davet_kodu");
      if (!davetKoduCakismasi) throw e;
    }
  }
  throw new Error("Benzersiz davet kodu üretilemedi.");
}

// E-posta ile kullanici bul (giris icin; sifre_hash dahil).
export async function kullaniciBulEmail(isletmeId, email) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    "SELECT * FROM kullanicilar WHERE isletme_id=$1 AND lower(email)=lower($2)",
    [tenantId, email.toLowerCase()]
  );
  return sonuc.rows[0] || null;
}

// Beş hatalı parola denemesinde hesabı 15 dakika kilitler. Sayaç, son
// denemeden 15 dakika geçtiyse yeniden başlar; işlem tek atomik sorgudur.
export async function basarisizGirisiKaydet(isletmeId, kullaniciId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `UPDATE kullanicilar
        SET basarisiz_giris_sayisi = CASE
              WHEN son_basarisiz_giris IS NULL OR son_basarisiz_giris < NOW() - INTERVAL '15 minutes' THEN 1
              ELSE basarisiz_giris_sayisi + 1
            END,
            son_basarisiz_giris = NOW(),
            giris_kilit_bitis = CASE
              WHEN (CASE
                WHEN son_basarisiz_giris IS NULL OR son_basarisiz_giris < NOW() - INTERVAL '15 minutes' THEN 1
                ELSE basarisiz_giris_sayisi + 1
              END) >= 5 THEN NOW() + INTERVAL '15 minutes'
              ELSE giris_kilit_bitis
            END
      WHERE isletme_id=$1 AND id=$2
      RETURNING basarisiz_giris_sayisi,giris_kilit_bitis`,
    [tenantId, kullaniciId]
  );
  return sonuc.rows[0] || null;
}

export async function basariliGirisiKaydet(isletmeId, kullaniciId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(
    `UPDATE kullanicilar
        SET basarisiz_giris_sayisi=0,son_basarisiz_giris=NULL,giris_kilit_bitis=NULL
      WHERE isletme_id=$1 AND id=$2`,
    [tenantId, kullaniciId]
  );
}

export async function kullaniciSifreHashiniGuclendir(isletmeId, kullaniciId, eskiHash, yeniHash) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(
    `UPDATE kullanicilar SET sifre_hash=$1
      WHERE isletme_id=$2 AND id=$3 AND sifre_hash=$4`,
    [yeniHash, tenantId, kullaniciId, eskiHash]
  );
}

// Tek panelden giris: isletme bilinmeden, TUM isletmelerde e-postayla adaylari
// bulur (ayni e-posta farkli isletmelerde ayri hesap olabilir, bkz. isletmeDb.js
// isletme_id+email unique index yorumu). Yalnizca aktif isletmeler dahil edilir.
export async function kullaniciAdaylariniEmailIleBul(email) {
  const sonuc = await pool.query(
    `SELECT k.*, i.slug AS isletme_slug, i.ad AS isletme_ad
     FROM kullanicilar k JOIN isletmeler i ON i.id = k.isletme_id
     WHERE lower(k.email) = lower($1) AND i.aktif = true`,
    [email.toLowerCase()]
  );
  return sonuc.rows;
}

// ID ile kullanici bul (token dogrulamasi sonrasi; sifre_hash HARIC).
export async function kullaniciBulId(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    "SELECT id,isletme_id,ad,soyad,cinsiyet,email,telefon,rol,puan,davet_kodu,burger_damga,sifre_degisim_tarihi,iki_faktor_aktif FROM kullanicilar WHERE isletme_id=$1 AND id=$2",
    [tenantId, id]
  );
  return sonuc.rows[0] ? kullaniciDonustur(sonuc.rows[0]) : null;
}

export async function ikiFaktorKaydiniGetir(isletmeId, kullaniciId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `SELECT id,email,sifre_hash,iki_faktor_aktif,iki_faktor_sir,
            iki_faktor_bekleyen_sir,iki_faktor_kurtarma
     FROM kullanicilar WHERE isletme_id=$1 AND id=$2`,
    [tenantId, kullaniciId]
  );
  return sonuc.rows[0] || null;
}

export async function ikiFaktorBekleyeniKaydet(isletmeId, kullaniciId, sifreliSir) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(
    `UPDATE kullanicilar
     SET iki_faktor_bekleyen_sir=$1, iki_faktor_degisim_tarihi=NOW()
     WHERE isletme_id=$2 AND id=$3`,
    [sifreliSir, tenantId, kullaniciId]
  );
}

export async function ikiFaktorEtkinlestir(isletmeId, kullaniciId, kurtarmaHashleri) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `UPDATE kullanicilar
     SET iki_faktor_aktif=true,
         iki_faktor_sir=iki_faktor_bekleyen_sir,
         iki_faktor_bekleyen_sir=NULL,
         iki_faktor_kurtarma=$1::jsonb,
         iki_faktor_degisim_tarihi=NOW()
     WHERE isletme_id=$2 AND id=$3 AND iki_faktor_bekleyen_sir IS NOT NULL
     RETURNING id`,
    [JSON.stringify(kurtarmaHashleri), tenantId, kullaniciId]
  );
  return sonuc.rowCount === 1;
}

export async function ikiFaktorKapat(isletmeId, kullaniciId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(
    `UPDATE kullanicilar
     SET iki_faktor_aktif=false, iki_faktor_sir=NULL,
         iki_faktor_bekleyen_sir=NULL, iki_faktor_kurtarma='[]'::jsonb,
         iki_faktor_degisim_tarihi=NOW()
     WHERE isletme_id=$1 AND id=$2`,
    [tenantId, kullaniciId]
  );
}

export async function ikiFaktorKurtarmaKoduKullan(isletmeId, kullaniciId, kodHash) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const sonuc = await baglanti.query(
      "SELECT iki_faktor_kurtarma FROM kullanicilar WHERE isletme_id=$1 AND id=$2 FOR UPDATE",
      [tenantId, kullaniciId]
    );
    const kodlar = Array.isArray(sonuc.rows[0]?.iki_faktor_kurtarma)
      ? sonuc.rows[0].iki_faktor_kurtarma
      : [];
    const index = kodlar.indexOf(kodHash);
    if (index < 0) {
      await baglanti.query("ROLLBACK");
      return false;
    }
    kodlar.splice(index, 1);
    await baglanti.query(
      "UPDATE kullanicilar SET iki_faktor_kurtarma=$1::jsonb WHERE isletme_id=$2 AND id=$3",
      [JSON.stringify(kodlar), tenantId, kullaniciId]
    );
    await baglanti.query("COMMIT");
    return true;
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
}

// Şifremi unuttum: yeni sıfırlama talebi kaydeder, kullanıcının önceki
// kullanılmamış token'larını iptal eder (aynı anda yalnızca bir bağlantı geçerli).
export async function sifreSifirlamaTalebiOlustur(isletmeId, kullaniciId, tokenHash, sureDk = 30) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(
    `UPDATE sifre_sifirlama s SET kullanildi=true
     FROM kullanicilar k
     WHERE s.kullanici_id=k.id AND k.isletme_id=$1 AND s.kullanici_id=$2 AND s.kullanildi=false`,
    [tenantId, kullaniciId]
  );
  await pool.query(
    `INSERT INTO sifre_sifirlama (kullanici_id, token_hash, son_gecerlilik)
     SELECT id,$3,NOW() + ($4::text || ' minutes')::interval
     FROM kullanicilar WHERE isletme_id=$1 AND id=$2`,
    [tenantId, kullaniciId, tokenHash, sureDk]
  );
}

export async function sifreSifirlamaTokeniGecerliMi(isletmeId, tokenHash) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `SELECT 1 FROM sifre_sifirlama s
     JOIN kullanicilar k ON k.id=s.kullanici_id AND k.isletme_id=$1
     WHERE s.token_hash=$2 AND s.kullanildi=false AND s.son_gecerlilik > NOW()`,
    [tenantId, tokenHash]
  );
  return sonuc.rows.length > 0;
}

// İlk girişte zorunlu şifre belirleme: yalnızca sifre_degistirmeli=true iken
// çalışır, böylece kullanılmış bir gecis token'ı tekrar oynatılsa bile (bayrak
// zaten kapandığı için) hiçbir şey yapmaz.
export async function ilkGirisSifresiniGuncelle(isletmeId, kullaniciId, yeniSifreHash) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `UPDATE kullanicilar
        SET sifre_hash=$1, sifre_degistirmeli=false, sifre_degisim_tarihi=NOW(),
            basarisiz_giris_sayisi=0,son_basarisiz_giris=NULL,giris_kilit_bitis=NULL
      WHERE isletme_id=$2 AND id=$3 AND sifre_degistirmeli=true RETURNING id`,
    [yeniSifreHash, tenantId, kullaniciId]
  );
  return sonuc.rows.length > 0;
}

// Token'ı doğrular, şifreyi günceller ve token'ı tek seferlik kullanılmış
// işaretler — hepsi tek transaction içinde (yarış durumuna karşı FOR UPDATE).
export async function sifreyiSifirla(isletmeId, tokenHash, yeniSifreHash) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const token = await baglanti.query(
      `SELECT s.id,s.kullanici_id FROM sifre_sifirlama s
       JOIN kullanicilar k ON k.id=s.kullanici_id AND k.isletme_id=$1
       WHERE s.token_hash=$2 AND s.kullanildi=false AND s.son_gecerlilik > NOW()
       FOR UPDATE OF s`,
      [tenantId, tokenHash]
    );
    if (!token.rows.length) {
      await baglanti.query("ROLLBACK");
      return { gecersiz: true };
    }
    const { id, kullanici_id: kullaniciId } = token.rows[0];
    await baglanti.query(
      // E-posta bağlantısıyla resetleyen kullanıcı kendi şifresini belirlemiş
      // olur; hesap daha önce geçici bir şifreyle işaretlenmişse (bkz.
      // sifre_degistirmeli) o durum da burada temizlenir — aksi halde bir
      // sonraki girişte gereksiz yere "yeni şifre belirle" ekranına düşer ve
      // artık geçersiz olan eski geçici şifre yönetim panelinde görünmeye devam eder.
      `UPDATE kullanicilar
          SET sifre_hash=$1, sifre_degisim_tarihi=NOW(), sifre_degistirmeli=false,
              basarisiz_giris_sayisi=0,son_basarisiz_giris=NULL,giris_kilit_bitis=NULL
        WHERE isletme_id=$2 AND id=$3`,
      [yeniSifreHash, tenantId, kullaniciId]
    );
    await baglanti.query("UPDATE sifre_sifirlama SET kullanildi=true WHERE id=$1", [id]);
    await baglanti.query("COMMIT");
    return { basarili: true };
  } catch (e) {
    await baglanti.query("ROLLBACK");
    throw e;
  } finally {
    baglanti.release();
  }
}

export async function davetKoduylaKullaniciBul(isletmeId, davetKodu) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    "SELECT id,ad,soyad,davet_kodu FROM kullanicilar WHERE isletme_id=$1 AND davet_kodu=$2",
    [tenantId, String(davetKodu || "").trim().toUpperCase()]
  );
  return sonuc.rows[0] || null;
}

export async function davetOzetiniGetir(isletmeId, kullaniciId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const ozet = await pool.query(
    `SELECT k.davet_kodu,
      (SELECT COUNT(*)::int FROM kullanicilar d WHERE d.isletme_id=$1 AND d.davet_eden_id=k.id) AS davet_edilen_sayisi,
      (SELECT COUNT(*)::int FROM davet_odulleri o WHERE o.isletme_id=$1 AND o.davet_eden_id=k.id AND o.durum='kazanildi') AS odullu_siparis_sayisi,
      (SELECT COALESCE(SUM(o.puan),0)::int FROM davet_odulleri o WHERE o.isletme_id=$1 AND o.davet_eden_id=k.id AND o.durum='kazanildi') AS kazanilan_puan
     FROM kullanicilar k WHERE k.isletme_id=$1 AND k.id=$2`,
    [tenantId, kullaniciId]
  );
  if (!ozet.rows.length) throw new Error("Kullanıcı bulunamadı.");
  const sonHareketler = await pool.query(
    `SELECT o.puan,o.siparis_tutari,o.olusturma,k.ad,k.soyad
     FROM davet_odulleri o
     JOIN kullanicilar k ON k.id=o.davet_edilen_id AND k.isletme_id=$1
     WHERE o.isletme_id=$1 AND o.davet_eden_id=$2 AND o.durum='kazanildi'
     ORDER BY o.olusturma DESC LIMIT 10`,
    [tenantId, kullaniciId]
  );
  const veri = ozet.rows[0];
  return {
    davetKodu: veri.davet_kodu,
    davetEdilenSayisi: Number(veri.davet_edilen_sayisi),
    odulluSiparisSayisi: Number(veri.odullu_siparis_sayisi),
    kazanilanPuan: Number(veri.kazanilan_puan),
    sonHareketler: sonHareketler.rows.map((hareket) => ({
      kisiAdi: `${hareket.ad} ${hareket.soyad}`,
      siparisTutari: Number(hareket.siparis_tutari),
      puan: Number(hareket.puan),
      tarih: hareket.olusturma,
    })),
  };
}

// Profil guncelle: SADECE email ve telefon degistirilebilir.
// ad, soyad, cinsiyet kalicidir (degistirilemez).
// email benzersiz olmali — baskasi kullaniyorsa hata doner.
export async function kullaniciProfilGuncelle(isletmeId, id, { email, telefon }) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  email = String(email || "").trim().toLowerCase().slice(0, 254);
  telefon = String(telefon || "").trim().slice(0, 20);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { hata: "Geçerli bir e-posta adresi girin." };
  }
  if (telefon && !/^\+?[0-9 ()-]{7,20}$/.test(telefon)) {
    return { hata: "Telefon numarası geçersiz." };
  }
  // Yeni email baskasinda var mi?
  if (email) {
    const mevcut = await pool.query(
      "SELECT id FROM kullanicilar WHERE isletme_id=$1 AND lower(email)=lower($2) AND id<>$3",
      [tenantId, email.toLowerCase(), id]
    );
    if (mevcut.rows.length > 0) {
      return { hata: "Bu e-posta başka bir hesapta kullanılıyor." };
    }
  }
  const sonuc = await pool.query(
    `UPDATE kullanicilar SET email=$1,telefon=$2 WHERE isletme_id=$3 AND id=$4
     RETURNING id,isletme_id,ad,soyad,cinsiyet,email,telefon,rol,puan,davet_kodu,burger_damga`,
    [email, telefon, tenantId, id]
  );
  return { kullanici: kullaniciDonustur(sonuc.rows[0]) };
}

function kullaniciDonustur(kullanici) {
  return {
    id: Number(kullanici.id),
    isletmeId: Number(kullanici.isletme_id),
    ad: kullanici.ad,
    soyad: kullanici.soyad,
    cinsiyet: kullanici.cinsiyet,
    email: kullanici.email,
    telefon: kullanici.telefon,
    rol: kullanici.rol,
    puan: Number(kullanici.puan || 0),
    burgerDamga: Number(kullanici.burger_damga || 0),
    davetKodu: kullanici.davet_kodu,
    sifreDegisimTarihi: kullanici.sifre_degisim_tarihi,
    ikiFaktorAktif: kullanici.iki_faktor_aktif === true,
  };
}

export async function kullaniciSiparisleriniGetir(isletmeId, kullaniciId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `SELECT ks.*, (d.id IS NOT NULL) AS degerlendirildi, d.genel_puan AS degerlendirme_puani
     FROM kullanici_siparisleri ks
     LEFT JOIN siparis_degerlendirmeleri d ON d.isletme_id=ks.isletme_id AND d.siparis_id=ks.id
     WHERE ks.isletme_id=$1 AND ks.kullanici_id=$2 ORDER BY ks.olusturma DESC LIMIT 200`,
    [tenantId, kullaniciId]
  );
  return sonuc.rows.map(kullaniciSiparisiniDonustur);
}

function kullaniciSiparisiniDonustur(siparis) {
  return {
    id: Number(siparis.id),
    siparisNo: siparis.siparis_no,
    masaNo: siparis.masa_no,
    tip: siparis.tip,
    urunler: Array.isArray(siparis.urunler) ? siparis.urunler : [],
    tutar: Number(siparis.tutar),
    kazanilanPuan: Number(siparis.kazanilan_puan),
    durum: siparis.durum,
    tamamlandi: siparis.tamamlandi,
    degerlendirildi: siparis.degerlendirildi === true,
    degerlendirmePuani: siparis.degerlendirme_puani == null ? null : Number(siparis.degerlendirme_puani),
    tarih: siparis.olusturma,
  };
}

export default pool;
