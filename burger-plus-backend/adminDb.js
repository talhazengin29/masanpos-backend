import pool, { davetKoduUret } from "./db.js";
import bcrypt from "bcryptjs";
import { ingilizceCeviriUret } from "./ceviri.js";
import { urunMalzemeleriniRecetedenGuncelle } from "./receteDb.js";
import { otomatikOnerileriSirala } from "./oneriMotoru.js";
import { kampanyaTaslagiOlustur } from "./kampanyaTaslagi.js";

function isletmeIdZorunlu(isletmeId) {
  const id = Number(isletmeId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("isletmeId zorunlu");
  return id;
}

const sayi = (deger, varsayilan = 0) => {
  const n = Number(deger);
  return Number.isFinite(n) ? n : varsayilan;
};

function gramajOpsiyonunuDogrula(ham, temelMiktar) {
  if (ham == null) return null;
  if (typeof ham !== "object" || Array.isArray(ham)) throw new Error("Gramaj artırma kuralı geçersiz.");
  const goster = ham.goster !== false;
  const aktif = goster && ham.aktif === true;
  const etiket = String(ham.etiket || "Ürün miktarı").trim().slice(0, 80);
  const birim = String(ham.birim || "gr").trim().toLowerCase().slice(0, 12);
  const artisMiktari = sayi(ham.artisMiktari, NaN);
  const maxAdim = Math.floor(sayi(ham.maxAdim, NaN));
  const fiyatArtisi = sayi(ham.fiyatArtisi, NaN);
  if (!etiket || !/^[a-zçğıöşü]+$/i.test(birim)) throw new Error("Gramaj etiketi veya birimi geçersiz.");
  if (!Number.isFinite(artisMiktari) || artisMiktari <= 0 || artisMiktari > 10000) throw new Error("Artış miktarı 0'dan büyük olmalıdır.");
  if (!Number.isInteger(maxAdim) || maxAdim < 1 || maxAdim > 20) throw new Error("Maksimum artış adımı 1–20 arasında olmalıdır.");
  if (!Number.isFinite(fiyatArtisi) || fiyatArtisi < 0 || fiyatArtisi > 100000) throw new Error("Gramaj fiyat artışı geçersiz.");
  if (goster && sayi(temelMiktar) <= 0) throw new Error("Miktar bilgisini göstermek için standart miktar gereklidir.");
  return { goster, aktif, etiket, birim, artisMiktari, maxAdim, fiyatArtisi };
}

const URUN_TIPLERI = new Set(["burger", "yan_lezzet", "icecek", "menu"]);

function boyutSecenekleriniDogrula(ham, urunTipi) {
  if (!["yan_lezzet", "icecek"].includes(urunTipi)) return [];
  if (ham == null || (Array.isArray(ham) && ham.length === 0)) return []; // boyutlandırma isteğe bağlıdır: girilmezse ürün standart/tek fiyatla kalır
  if (!Array.isArray(ham) || ham.length < 2 || ham.length > 6) {
    throw new Error("Boyut seçeneği eklemek istiyorsan en az 2, en fazla 6 boyut girmelisin.");
  }
  const kodlar = new Set();
  const secenekler = ham.map((secenek, index) => {
    const kod = String(secenek?.kod || `boyut-${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30);
    const etiket = String(secenek?.etiket || "").trim().slice(0, 40);
    const birim = String(secenek?.birim || (urunTipi === "icecek" ? "ml" : "gr")).trim().toLowerCase().slice(0, 12);
    const miktar = sayi(secenek?.miktar, NaN);
    const fiyatFarki = sayi(secenek?.fiyatFarki, NaN);
    if (!kod || kodlar.has(kod)) throw new Error("Boyut kodları benzersiz olmalıdır.");
    if (!etiket || !Number.isFinite(miktar) || miktar <= 0 || miktar > 10000) throw new Error("Boyut etiketi ve miktarı geçersiz.");
    if (!Number.isFinite(fiyatFarki) || fiyatFarki < 0 || fiyatFarki > 100000) throw new Error("Boyut fiyat farkı geçersiz.");
    kodlar.add(kod);
    return { kod, etiket, miktar, birim, fiyatFarki, varsayilan: secenek?.varsayilan === true };
  });
  if (!secenekler.some((secenek) => secenek.varsayilan)) secenekler[0].varsayilan = true;
  let varsayilanGoruldu = false;
  return secenekler.map((secenek) => {
    const varsayilan = secenek.varsayilan && !varsayilanGoruldu;
    if (varsayilan) varsayilanGoruldu = true;
    return { ...secenek, varsayilan };
  });
}

function ekstraMalzemeAyariniDogrula(ham) {
  if (ham == null) return { aktif: false, baslik: "Ekstra malzeme seç", minSecim: 0, maxSecim: 1, secenekler: [] };
  if (typeof ham !== "object" || Array.isArray(ham)) throw new Error("Ekstra malzeme ayarı geçersiz.");
  const aktif = ham.aktif === true;
  const baslik = String(ham.baslik || "Ekstra malzeme seç").trim().slice(0, 80);
  const hamSecenekler = Array.isArray(ham.secenekler) ? ham.secenekler : [];
  if (hamSecenekler.length > 30) throw new Error("Bir ürüne en fazla 30 ekstra malzeme ekleyebilirsin.");
  const idler = new Set();
  const secenekler = hamSecenekler.map((secenek, index) => {
    const id = String(secenek?.id || `ekstra-${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    const ad = String(secenek?.ad || "").trim().replace(/\s+/g, " ").slice(0, 80);
    const fiyat = sayi(secenek?.fiyat, NaN);
    if (!id || idler.has(id)) throw new Error("Ekstra malzeme kodları benzersiz olmalıdır.");
    if (!ad) throw new Error("Ekstra malzeme adı zorunludur.");
    if (!Number.isFinite(fiyat) || fiyat < 0 || fiyat > 100000) throw new Error("Ekstra malzeme fiyatı geçersiz.");
    idler.add(id);
    return { id, ad, fiyat, aktif: secenek?.aktif !== false };
  });
  const aktifSayisi = secenekler.filter((secenek) => secenek.aktif).length;
  const maxSecim = Math.floor(sayi(ham.maxSecim, 1));
  const minSecim = Math.floor(sayi(ham.minSecim, 0));
  if (!baslik) throw new Error("Ekstra malzeme başlığı zorunludur.");
  if (!Number.isInteger(maxSecim) || maxSecim < 1 || maxSecim > 10) throw new Error("Maksimum ekstra seçimi 1–10 arasında olmalıdır.");
  if (!Number.isInteger(minSecim) || minSecim < 0 || minSecim > maxSecim) throw new Error("Minimum ekstra seçimi geçersiz.");
  if (aktif && aktifSayisi < 1) throw new Error("Ekstra malzeme alanını açmak için en az bir aktif seçenek eklemelisin.");
  if (aktif && minSecim > aktifSayisi) throw new Error("Minimum seçim sayısı aktif malzeme sayısını aşamaz.");
  return { aktif, baslik, minSecim, maxSecim: Math.min(maxSecim, Math.max(1, aktifSayisi || maxSecim)), secenekler };
}

async function menuYapisiniDogrula(isletmeId, ham, urunTipi) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  if (urunTipi !== "menu") return null;
  const menu = {
    burgerUrunId: Number(ham?.burgerUrunId),
    yanLezzetUrunId: Number(ham?.yanLezzetUrunId),
    icecekUrunId: Number(ham?.icecekUrunId),
    varsayilanYanBoyut: String(ham?.varsayilanYanBoyut || "").trim(),
    varsayilanIcecekBoyut: String(ham?.varsayilanIcecekBoyut || "").trim(),
  };
  if (![menu.burgerUrunId, menu.yanLezzetUrunId, menu.icecekUrunId].every(Number.isInteger)) {
    throw new Error("Menü için burger, yan lezzet ve içecek seçilmelidir.");
  }
  const sonuc = await pool.query(
    "SELECT id,urun_tipi,boyut_secenekleri FROM urunler WHERE isletme_id=$1 AND id=ANY($2::int[]) AND arsivli=false AND aktif=true",
    [tenantId, [menu.burgerUrunId, menu.yanLezzetUrunId, menu.icecekUrunId]]
  );
  const urunler = new Map(sonuc.rows.map((urun) => [Number(urun.id), urun]));
  if (urunler.get(menu.burgerUrunId)?.urun_tipi !== "burger") throw new Error("Menüde geçerli bir burger seçilmelidir.");
  if (urunler.get(menu.yanLezzetUrunId)?.urun_tipi !== "yan_lezzet") throw new Error("Menüde geçerli bir yan lezzet seçilmelidir.");
  if (urunler.get(menu.icecekUrunId)?.urun_tipi !== "icecek") throw new Error("Menüde geçerli bir içecek seçilmelidir.");
  const yanBoyutlar = urunler.get(menu.yanLezzetUrunId).boyut_secenekleri || [];
  const icecekBoyutlar = urunler.get(menu.icecekUrunId).boyut_secenekleri || [];
  // Boyutlandırma isteğe bağlı: ürünün hiç boyut seçeneği yoksa (standart ürün) varsayılan boyut eşleşmesi aranmaz.
  if (yanBoyutlar.length && !yanBoyutlar.some((boyut) => boyut.kod === menu.varsayilanYanBoyut)) throw new Error("Menünün varsayılan yan lezzet boyutu geçersiz.");
  if (icecekBoyutlar.length && !icecekBoyutlar.some((boyut) => boyut.kod === menu.varsayilanIcecekBoyut)) throw new Error("Menünün varsayılan içecek boyutu geçersiz.");
  return menu;
}

export async function ilkYerelAdminOlustur(isletmeId, { email, sifre }) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const yerelVeritabani = !process.env.DATABASE_URL && ["localhost", "127.0.0.1"].includes(process.env.PGHOST);
  if (!yerelVeritabani) throw new Error("İlk admin kurulumu yalnızca yerel geliştirme ortamında kullanılabilir.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "") || String(sifre || "").length < 8) {
    throw new Error("Geçerli e-posta ve en az 8 karakterli şifre gerekli.");
  }
  const adminVar = await pool.query("SELECT 1 FROM kullanicilar WHERE isletme_id=$1 AND rol='admin' LIMIT 1", [tenantId]);
  if (adminVar.rows.length) throw new Error("İlk yönetici daha önce oluşturulmuş.");
  const sifreHash = await bcrypt.hash(String(sifre), 12);
  await pool.query(
    `INSERT INTO kullanicilar (isletme_id,ad,soyad,email,sifre_hash,rol,davet_kodu)
     VALUES ($1,'İşletme','Yöneticisi',$2,$3,'admin',$4)`,
    [tenantId, String(email).toLowerCase(), sifreHash, davetKoduUret()]
  );
}

export async function yerelAdminKurulumGerekli(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const yerelVeritabani = !process.env.DATABASE_URL && ["localhost", "127.0.0.1"].includes(process.env.PGHOST);
  if (!yerelVeritabani) return false;
  const sonuc = await pool.query("SELECT 1 FROM kullanicilar WHERE isletme_id=$1 AND rol='admin' LIMIT 1", [tenantId]);
  return sonuc.rows.length === 0;
}

export async function adminTablolariHazirla(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kategoriler (
      id SERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      ad TEXT NOT NULL,
      gorsel TEXT,
      sira INTEGER NOT NULL DEFAULT 0,
      aktif BOOLEAN NOT NULL DEFAULT true,
      ceviriler JSONB NOT NULL DEFAULT '{}'::jsonb,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS urunler (
      id SERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      ad TEXT NOT NULL,
      fiyat NUMERIC NOT NULL CHECK (fiyat >= 0),
      kategori TEXT NOT NULL,
      gorsel TEXT,
      aciklama TEXT,
      malzemeler JSONB NOT NULL DEFAULT '[]'::jsonb,
      alerjenler JSONB NOT NULL DEFAULT '[]'::jsonb,
      besin_degerleri JSONB,
      temel_miktar NUMERIC,
      gramaj_opsiyonu JSONB,
      urun_tipi TEXT NOT NULL DEFAULT 'burger',
      boyut_secenekleri JSONB NOT NULL DEFAULT '[]'::jsonb,
      ekstra_malzeme_ayari JSONB NOT NULL DEFAULT '{"aktif":false,"baslik":"Ekstra malzeme seç","minSecim":0,"maxSecim":1,"secenekler":[]}'::jsonb,
      menu_yapisi JSONB,
      onerilen_urunler JSONB NOT NULL DEFAULT '[]'::jsonb,
      populer BOOLEAN NOT NULL DEFAULT false,
      sira INTEGER NOT NULL DEFAULT 100,
      stok_takibi BOOLEAN NOT NULL DEFAULT false,
      stok_adedi INTEGER NOT NULL DEFAULT 0 CHECK (stok_adedi >= 0),
      arsivli BOOLEAN NOT NULL DEFAULT false,
      aktif BOOLEAN NOT NULL DEFAULT true,
      ceviriler JSONB NOT NULL DEFAULT '{}'::jsonb,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS personeller (
      id SERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      ad TEXT NOT NULL,
      soyad TEXT NOT NULL,
      rol TEXT NOT NULL,
      email TEXT,
      telefon TEXT,
      saatlik_ucret NUMERIC NOT NULL DEFAULT 0,
      aktif BOOLEAN NOT NULL DEFAULT true,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vardiyalar (
      id SERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      personel_id INTEGER NOT NULL REFERENCES personeller(id),
      giris TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cikis TIMESTAMPTZ,
      notlar TEXT
    );

    CREATE TABLE IF NOT EXISTS sistem_ayarlari (
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      anahtar TEXT NOT NULL,
      deger JSONB NOT NULL DEFAULT '{}'::jsonb,
      guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (isletme_id,anahtar)
    );

    CREATE TABLE IF NOT EXISTS duyurular (
      id SERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      baslik TEXT NOT NULL,
      mesaj TEXT NOT NULL,
      hedef TEXT NOT NULL DEFAULT '/anasayfa',
      aktif BOOLEAN NOT NULL DEFAULT true,
      ceviriler JSONB NOT NULL DEFAULT '{}'::jsonb,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS kampanyalar (
      id SERIAL PRIMARY KEY, isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      kod TEXT, etiket TEXT NOT NULL, baslik TEXT NOT NULL,
      aciklama TEXT NOT NULL, buton TEXT NOT NULL DEFAULT 'Sipariş Ver', buton_tipi TEXT NOT NULL DEFAULT 'primary',
      gorsel TEXT, ikon TEXT, aktif BOOLEAN NOT NULL DEFAULT true, baslangic_saat SMALLINT, bitis_saat SMALLINT,
      indirim_yuzde NUMERIC NOT NULL DEFAULT 0, gecerli_kategoriler JSONB NOT NULL DEFAULT '[]'::jsonb,
      kampanya_tipi TEXT NOT NULL DEFAULT 'surekli', sira INTEGER NOT NULL DEFAULT 0,
      ceviriler JSONB NOT NULL DEFAULT '{}'::jsonb,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(), guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS revizyon_kayitlari (
      id BIGSERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      yapan_kullanici_id INTEGER REFERENCES kullanicilar(id) ON DELETE SET NULL,
      yapan_ad TEXT NOT NULL DEFAULT 'Sistem',
      varlik_turu TEXT NOT NULL,
      varlik_id TEXT,
      islem TEXT NOT NULL,
      aciklama TEXT NOT NULL,
      eski_deger JSONB,
      yeni_deger JSONB,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE siparis_kalemleri
    ADD COLUMN IF NOT EXISTS siparis_no TEXT
  `);
  await pool.query("ALTER TABLE personeller ADD COLUMN IF NOT EXISTS kullanici_id INTEGER");
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='personeller_kullanici_id_fkey') THEN
        ALTER TABLE personeller ADD CONSTRAINT personeller_kullanici_id_fkey
          FOREIGN KEY (kullanici_id) REFERENCES kullanicilar(id) ON DELETE SET NULL;
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS personeller_isletme_kullanici_id
      ON personeller(isletme_id,kullanici_id) WHERE kullanici_id IS NOT NULL;
  `);

  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS besin_degerleri JSONB");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS urun_tipi TEXT NOT NULL DEFAULT 'burger'");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS boyut_secenekleri JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query(`ALTER TABLE urunler ADD COLUMN IF NOT EXISTS ekstra_malzeme_ayari JSONB NOT NULL DEFAULT '{"aktif":false,"baslik":"Ekstra malzeme seç","minSecim":0,"maxSecim":1,"secenekler":[]}'::jsonb`);
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS menu_yapisi JSONB");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS onerilen_urunler JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS populer BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS sira INTEGER NOT NULL DEFAULT 100");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS stok_takibi BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS stok_adedi INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS arsivli BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS ceviriler JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE urunler ADD COLUMN IF NOT EXISTS malzemeler_receteden BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE kategoriler ADD COLUMN IF NOT EXISTS arsivli BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE kategoriler ADD COLUMN IF NOT EXISTS ceviriler JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE personeller ADD COLUMN IF NOT EXISTS arsivli BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE duyurular ADD COLUMN IF NOT EXISTS arsivli BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE duyurular ADD COLUMN IF NOT EXISTS ceviriler JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE duyurular ADD COLUMN IF NOT EXISTS guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await pool.query("ALTER TABLE kampanyalar ADD COLUMN IF NOT EXISTS arsivli BOOLEAN NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE kampanyalar ADD COLUMN IF NOT EXISTS ikon TEXT");
  await pool.query("ALTER TABLE kampanyalar ADD COLUMN IF NOT EXISTS ceviriler JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS hazirlamaya_baslandi TIMESTAMPTZ");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS hazir_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS hazirlayan_personel_id INTEGER");
  await pool.query("ALTER TABLE siparis_kalemleri ADD COLUMN IF NOT EXISTS oneri_adedi INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE oturumlar ADD COLUMN IF NOT EXISTS kapandi_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE oturumlar ADD COLUMN IF NOT EXISTS kapatan_personel_id INTEGER");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stok_rezervasyonlari (
      odeme_id UUID NOT NULL REFERENCES odeme_islemleri(id) ON DELETE CASCADE,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      urun_id INTEGER NOT NULL REFERENCES urunler(id) ON DELETE RESTRICT,
      adet INTEGER NOT NULL CHECK (adet > 0),
      durum TEXT NOT NULL DEFAULT 'aktif' CHECK (durum IN ('aktif','tuketildi','birakildi')),
      son_gecerlilik TIMESTAMPTZ NOT NULL,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (odeme_id, urun_id)
    );
    CREATE INDEX IF NOT EXISTS stok_rezervasyonlari_sure_idx
      ON stok_rezervasyonlari (isletme_id, durum, son_gecerlilik);
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='siparis_hazirlayan_personel_fkey') THEN
        ALTER TABLE siparis_kalemleri ADD CONSTRAINT siparis_hazirlayan_personel_fkey
          FOREIGN KEY (hazirlayan_personel_id) REFERENCES personeller(id) ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='oturum_kapatan_personel_fkey') THEN
        ALTER TABLE oturumlar ADD CONSTRAINT oturum_kapatan_personel_fkey
          FOREIGN KEY (kapatan_personel_id) REFERENCES personeller(id) ON DELETE SET NULL;
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS revizyon_kayitlari_tarih_idx ON revizyon_kayitlari (olusturma DESC);
    CREATE INDEX IF NOT EXISTS siparis_kalemleri_hazirlik_idx
      ON siparis_kalemleri (olusturma DESC, hazirlamaya_baslandi, hazir_at);
    CREATE INDEX IF NOT EXISTS siparis_kalemleri_isletme_tarih_idx
      ON siparis_kalemleri (isletme_id, olusturma DESC);
    CREATE INDEX IF NOT EXISTS siparis_kalemleri_oneri_tarih_idx
      ON siparis_kalemleri (isletme_id, olusturma DESC) WHERE oneri_adedi > 0;
  `);
  await pool.query(`
    ALTER TABLE kategoriler DROP CONSTRAINT IF EXISTS kategoriler_ad_key;
    ALTER TABLE kampanyalar DROP CONSTRAINT IF EXISTS kampanyalar_kod_key;
    ALTER TABLE personeller DROP CONSTRAINT IF EXISTS personeller_email_key;
    CREATE UNIQUE INDEX IF NOT EXISTS kategoriler_isletme_ad
      ON kategoriler(isletme_id,ad);
    CREATE UNIQUE INDEX IF NOT EXISTS kampanyalar_isletme_kod
      ON kampanyalar(isletme_id,kod);
    CREATE UNIQUE INDEX IF NOT EXISTS personeller_isletme_email
      ON personeller(isletme_id,lower(email));
    CREATE UNIQUE INDEX IF NOT EXISTS sistem_ayarlari_isletme_anahtar
      ON sistem_ayarlari(isletme_id,anahtar);
  `);
  const onerilerKuruldu = await pool.query("SELECT 1 FROM sistem_ayarlari WHERE isletme_id=$1 AND anahtar='upsell_onerileri_v1'", [tenantId]);
  if (!onerilerKuruldu.rows.length) {
    await pool.query(`
      UPDATE urunler kaynak
      SET onerilen_urunler = COALESCE((
        SELECT jsonb_agg(hedef.id)
        FROM (
          SELECT hedef.id
          FROM urunler hedef
          WHERE hedef.isletme_id=$1 AND hedef.aktif=true AND hedef.arsivli=false AND hedef.id <> kaynak.id
            AND (
              (kaynak.urun_tipi='burger' AND hedef.urun_tipi IN ('yan_lezzet','icecek'))
              OR (kaynak.urun_tipi='yan_lezzet' AND hedef.urun_tipi='icecek')
            )
          ORDER BY CASE
            WHEN kaynak.urun_tipi='burger' AND hedef.urun_tipi='yan_lezzet' THEN 0
            ELSE 1
          END, hedef.id
          LIMIT 2
        ) hedef
      ), '[]'::jsonb)
      WHERE kaynak.isletme_id=$1 AND kaynak.aktif=true AND kaynak.arsivli=false
        AND (kaynak.onerilen_urunler IS NULL OR kaynak.onerilen_urunler='[]'::jsonb)
    `, [tenantId]);
    await pool.query(
      "INSERT INTO sistem_ayarlari (isletme_id,anahtar,deger) VALUES ($1,'upsell_onerileri_v1',$2::jsonb) ON CONFLICT (isletme_id,anahtar) DO NOTHING",
      [tenantId, JSON.stringify({ tarih: new Date().toISOString() })]
    );
  }
  await pool.query(`
    INSERT INTO kategoriler (isletme_id,ad,gorsel,sira)
    SELECT $1,u.kategori,MIN(u.gorsel),100 + ROW_NUMBER() OVER (ORDER BY u.kategori) * 10
    FROM urunler u
    WHERE u.isletme_id=$1 AND BTRIM(u.kategori) <> ''
    GROUP BY u.kategori
    ON CONFLICT (isletme_id,ad) DO NOTHING
  `, [tenantId]);

}

function ceviriAlanlari(ceviriler) {
  return {
    ceviriler: { en: ceviriler?.en || {} },
    ceviriDurumu: ceviriler?.durum || "bekliyor",
  };
}

async function oncekiCeviriGetir(tablo, isletmeId, id) {
  if (!id) return null;
  const izinliTablolar = new Set(["urunler", "kategoriler", "kampanyalar", "duyurular"]);
  if (!izinliTablolar.has(tablo)) throw new Error("Geçersiz çeviri tablosu.");
  const sonuc = await pool.query(`SELECT ceviriler FROM ${tablo} WHERE isletme_id=$1 AND id=$2 AND arsivli=false`, [isletmeId, id]);
  return sonuc.rows[0]?.ceviriler || null;
}

function urunCeviriKaynagi({ ad, aciklama, malzemeler, alerjenler, gramajOpsiyonu, boyutSecenekleri, ekstraMalzemeAyari }) {
  return {
    ad,
    aciklama: aciklama || "",
    malzemeler,
    alerjenler,
    gramajEtiketi: gramajOpsiyonu?.etiket || "",
    boyutSecenekleri: boyutSecenekleri.map(({ etiket }) => ({ etiket: etiket || "" })),
    ekstraMalzeme: {
      baslik: ekstraMalzemeAyari?.baslik || "",
      secenekler: (ekstraMalzemeAyari?.secenekler || []).map(({ ad: secenekAdi }) => ({ ad: secenekAdi || "" })),
    },
  };
}

function urunDonustur(u, { stokDetayi = false } = {}) {
  const urun = {
    id: u.id,
    ad: u.ad,
    fiyat: Number(u.fiyat),
    kategori: u.kategori,
    gorsel: u.gorsel,
    aciklama: u.aciklama,
    malzemeler: u.malzemeler || [],
    malzemelerReceteden: u.malzemeler_receteden === true,
    alerjenler: u.alerjenler || [],
    besinDegerleri: u.besin_degerleri || null,
    temelMiktar: u.temel_miktar == null ? null : Number(u.temel_miktar),
    urunTipi: u.urun_tipi || "burger",
    boyutSecenekleri: u.boyut_secenekleri || [],
    ekstraMalzemeAyari: u.ekstra_malzeme_ayari || { aktif: false, baslik: "Ekstra malzeme seç", minSecim: 0, maxSecim: 1, secenekler: [] },
    menuYapisi: u.menu_yapisi || null,
    onerilenUrunler: Array.isArray(u.onerilen_urunler) ? u.onerilen_urunler.map(Number).filter(Number.isInteger) : [],
    populer: u.populer === true,
    sira: Number(u.sira ?? 100),
    stokTakibi: u.stok_takibi === true,
    stokta: u.stok_takibi !== true || Number(u.stok_adedi) > 0,
    aktif: u.aktif,
    ...ceviriAlanlari(u.ceviriler),
  };
  if (stokDetayi) urun.stokAdedi = Number(u.stok_adedi || 0);
  if (u.gramaj_opsiyonu != null) urun.gramajOpsiyonu = u.gramaj_opsiyonu;
  return urun;
}

export async function urunleriGetir(isletmeId, { tumu = false, stokDetayi = false } = {}) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const [sonuc, receteSonucu] = await Promise.all([
    pool.query(`
      SELECT u.*
      FROM urunler u
      LEFT JOIN kategoriler k ON k.isletme_id=u.isletme_id AND k.ad=u.kategori AND k.arsivli=false
      WHERE u.isletme_id=$1 AND u.arsivli=false ${tumu ? "" : "AND u.aktif=true"}
      ORDER BY COALESCE(k.sira,999), u.sira, u.ad
    `, [tenantId]),
    pool.query(`
      SELECT r.urun_id,
        GREATEST(0,MIN(FLOOR(h.stok_miktari/(r.miktar*(1+r.fire_orani/100)))))::int uretilebilir_adet,
        SUM(r.miktar*(1+r.fire_orani/100)*h.ortalama_birim_maliyet) recete_maliyeti
      FROM recete_urun_satirlari r
      JOIN recete_hammaddeler h ON h.isletme_id=r.isletme_id AND h.id=r.hammadde_id AND h.aktif=true
      WHERE r.isletme_id=$1 GROUP BY r.urun_id
    `, [tenantId]),
  ]);
  const stoklar = new Map(sonuc.rows.map((urun) => [Number(urun.id), {
    takip: urun.stok_takibi === true,
    adet: Number(urun.stok_adedi || 0),
  }]));
  const receteStoklari = new Map(receteSonucu.rows.map((satir) => [Number(satir.urun_id), {
    uretilebilirAdet: Number(satir.uretilebilir_adet || 0),
    maliyet: Number(satir.recete_maliyeti || 0),
  }]));
  return sonuc.rows.map((satir) => {
    const urun = urunDonustur(satir, { stokDetayi });
    const receteStogu = receteStoklari.get(Number(urun.id));
    if (receteStogu) {
      if (receteStogu.uretilebilirAdet < 1) urun.stokta = false;
      if (stokDetayi) {
        urun.receteMaliyeti = Number(receteStogu.maliyet.toFixed(2));
        urun.receteUretilebilirAdet = receteStogu.uretilebilirAdet;
      }
    }
    if (urun.urunTipi === "menu") {
      const menu = urun.menuYapisi || {};
      const bagliIdler = [menu.burgerUrunId, menu.yanLezzetUrunId, menu.icecekUrunId].map(Number).filter(Number.isInteger);
      const bagliStoklar = bagliIdler.map((id) => stoklar.get(id)).filter(Boolean);
      const bagliReceteler = bagliIdler.map((id) => receteStoklari.get(id)).filter(Boolean);
      if (bagliStoklar.some((stok) => stok.takip && stok.adet < 1) || bagliReceteler.some((recete) => recete.uretilebilirAdet < 1)) urun.stokta = false;
    }
    return urun;
  });
}

function kategoriDonustur(kategori) {
  return {
    id: kategori.id,
    ad: kategori.ad,
    gorsel: kategori.gorsel,
    sira: Number(kategori.sira || 0),
    aktif: kategori.aktif,
    ...ceviriAlanlari(kategori.ceviriler),
  };
}

export async function kategorileriGetir(isletmeId, { tumu = false } = {}) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(`
    SELECT id,ad,gorsel,sira,aktif,ceviriler
    FROM kategoriler
    WHERE isletme_id=$1 AND arsivli=false ${tumu ? "" : "AND aktif=true"}
    ORDER BY sira, ad
  `, [tenantId]);
  return sonuc.rows.map(kategoriDonustur);
}

export async function kategoriKaydet(isletmeId, veri) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const ad = String(veri.ad || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const gorsel = String(veri.gorsel || "").trim().slice(0, 1000);
  const sira = Math.floor(sayi(veri.sira, 0));
  if (ad.length < 2 || /[\u0000-\u001F\u007F]/.test(ad)) throw new Error("Kategori adı en az 2 karakter olmalıdır.");
  if (ad.toLocaleLowerCase("tr") === "tümü".toLocaleLowerCase("tr")) throw new Error("Tümü adı uygulama tarafından otomatik oluşturulur.");
  if (!gorsel) throw new Error("Kategori görseli zorunludur.");
  try {
    const url = new URL(gorsel);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error("Kategori görseli geçerli bir http/https adresi olmalıdır.");
  }
  if (!Number.isInteger(sira) || sira < 0 || sira > 999) throw new Error("Kategori sırası 0–999 arasında olmalıdır.");
  const oncekiCeviri = await oncekiCeviriGetir("kategoriler", tenantId, veri.id);
  const ceviriler = await ingilizceCeviriUret("kategori", { ad }, oncekiCeviri);

  const istemci = await pool.connect();
  try {
    await istemci.query("BEGIN");
    let sonuc;
    if (veri.id) {
      const mevcut = await istemci.query("SELECT ad FROM kategoriler WHERE isletme_id=$1 AND id=$2 FOR UPDATE", [tenantId, veri.id]);
      if (!mevcut.rows.length) throw new Error("Kategori bulunamadı.");
      sonuc = await istemci.query(
        "UPDATE kategoriler SET ad=$1,gorsel=$2,sira=$3,ceviriler=$4::jsonb,guncelleme=NOW() WHERE isletme_id=$5 AND id=$6 RETURNING *",
        [ad, gorsel, sira, JSON.stringify(ceviriler), tenantId, veri.id]
      );
      if (mevcut.rows[0].ad !== ad) {
        await istemci.query("UPDATE urunler SET kategori=$1,guncelleme=NOW() WHERE isletme_id=$2 AND kategori=$3", [ad, tenantId, mevcut.rows[0].ad]);
      }
    } else {
      sonuc = await istemci.query(
        "INSERT INTO kategoriler (isletme_id,ad,gorsel,sira,aktif,ceviriler) VALUES ($1,$2,$3,$4,true,$5::jsonb) RETURNING *",
        [tenantId, ad, gorsel, sira, JSON.stringify(ceviriler)]
      );
    }
    await istemci.query("COMMIT");
    return kategoriDonustur(sonuc.rows[0]);
  } catch (hata) {
    await istemci.query("ROLLBACK");
    if (hata.code === "23505") throw new Error("Bu kategori adı zaten kullanılıyor.");
    throw hata;
  } finally {
    istemci.release();
  }
}

export async function urunKaydet(isletmeId, veri) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const urunTipi = URUN_TIPLERI.has(veri.urunTipi) ? veri.urunTipi : "burger";
  const temelMiktar = urunTipi === "burger" && veri.temelMiktar !== "" && veri.temelMiktar != null
    ? sayi(veri.temelMiktar) : null;
  const gramajOpsiyonu = urunTipi === "burger" ? gramajOpsiyonunuDogrula(veri.gramajOpsiyonu, temelMiktar) : null;
  const boyutSecenekleri = boyutSecenekleriniDogrula(veri.boyutSecenekleri, urunTipi);
  const ekstraMalzemeAyari = ekstraMalzemeAyariniDogrula(veri.ekstraMalzemeAyari);
  const menuYapisi = await menuYapisiniDogrula(tenantId, veri.menuYapisi, urunTipi);
  const onerilenUrunler = await onerilenUrunleriDogrula(tenantId, veri.onerilenUrunler, veri.id);
  const stokTakibi = veri.stokTakibi === true;
  const sira = Math.floor(Number(veri.sira ?? 100));
  if (!Number.isSafeInteger(sira) || sira < 0 || sira > 9999) throw new Error("Ürün gösterim sırası 0–9999 arasında olmalıdır.");
  const stokAdedi = stokTakibi ? Math.floor(Number(veri.stokAdedi)) : 0;
  if (stokTakibi && (!Number.isSafeInteger(stokAdedi) || stokAdedi < 0 || stokAdedi > 1000000)) {
    throw new Error("Stok adedi 0 ile 1.000.000 arasında olmalıdır.");
  }
  const alanlar = [
    String(veri.ad || "").trim().slice(0, 120),
    sayi(veri.fiyat),
    String(veri.kategori || "Genel").trim().slice(0, 80),
    veri.gorsel ? String(veri.gorsel).slice(0, 1000) : null,
    veri.aciklama ? String(veri.aciklama).slice(0, 2000) : null,
    JSON.stringify(Array.isArray(veri.malzemeler) ? veri.malzemeler.slice(0, 100) : []),
    JSON.stringify(Array.isArray(veri.alerjenler) ? veri.alerjenler.slice(0, 50) : []),
    temelMiktar,
    gramajOpsiyonu == null ? null : JSON.stringify(gramajOpsiyonu),
    urunTipi,
    JSON.stringify(boyutSecenekleri),
    JSON.stringify(ekstraMalzemeAyari),
    menuYapisi == null ? null : JSON.stringify(menuYapisi),
    JSON.stringify(onerilenUrunler),
    veri.aktif !== false,
    veri.populer === true,
    stokTakibi,
    stokAdedi,
    sira,
  ];
  if (!alanlar[0] || alanlar[1] < 0) throw new Error("Ürün adı ve geçerli fiyat zorunludur.");
  const oncekiCeviri = await oncekiCeviriGetir("urunler", tenantId, veri.id);
  const ceviriler = await ingilizceCeviriUret("urun", urunCeviriKaynagi({
    ad: alanlar[0],
    aciklama: alanlar[4],
    malzemeler: JSON.parse(alanlar[5]),
    alerjenler: JSON.parse(alanlar[6]),
    gramajOpsiyonu,
    boyutSecenekleri,
    ekstraMalzemeAyari,
  }), oncekiCeviri);
  alanlar.push(JSON.stringify(ceviriler));
  alanlar.push(veri.malzemelerReceteden === true);
  const mevcutKategori = await pool.query(
    "SELECT ceviriler FROM kategoriler WHERE isletme_id=$1 AND ad=$2 AND arsivli=false LIMIT 1",
    [tenantId, alanlar[2]]
  );
  const kategoriCevirisi = await ingilizceCeviriUret("kategori", { ad: alanlar[2] }, mevcutKategori.rows[0]?.ceviriler);
  await pool.query(
    `INSERT INTO kategoriler (isletme_id,ad,sira,aktif,ceviriler) VALUES ($1,$2,999,true,$3::jsonb)
     ON CONFLICT (isletme_id,ad) DO UPDATE SET ceviriler=EXCLUDED.ceviriler`,
    [tenantId, alanlar[2], JSON.stringify(kategoriCevirisi)]
  );

  const sonuc = veri.id
    ? await pool.query(
        `UPDATE urunler SET ad=$1, fiyat=$2, kategori=$3, gorsel=$4, aciklama=$5,
          malzemeler=$6::jsonb, alerjenler=$7::jsonb, temel_miktar=$8,
          gramaj_opsiyonu=$9::jsonb, urun_tipi=$10, boyut_secenekleri=$11::jsonb,
          ekstra_malzeme_ayari=$12::jsonb, menu_yapisi=$13::jsonb, onerilen_urunler=$14::jsonb, aktif=$15, populer=$16,
          stok_takibi=$17, stok_adedi=$18, sira=$19, ceviriler=$20::jsonb, malzemeler_receteden=$21,
          arsivli=false, guncelleme=NOW()
         WHERE isletme_id=$22 AND id=$23 AND arsivli=false RETURNING *`, [...alanlar, tenantId, veri.id]
      )
    : await pool.query(
        `INSERT INTO urunler
          (isletme_id,ad,fiyat,kategori,gorsel,aciklama,malzemeler,alerjenler,temel_miktar,gramaj_opsiyonu,
           urun_tipi,boyut_secenekleri,ekstra_malzeme_ayari,menu_yapisi,onerilen_urunler,aktif,populer,stok_takibi,stok_adedi,sira,ceviriler,malzemeler_receteden,arsivli)
         VALUES ($22,$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20::jsonb,$21,false) RETURNING *`, [...alanlar, tenantId]
      );
  if (!sonuc.rows.length) throw new Error("Ürün bulunamadı veya arşivlenmiş.");
  let kaydedilenUrun = sonuc.rows[0];
  if (kaydedilenUrun.malzemeler_receteden === true) {
    await urunMalzemeleriniRecetedenGuncelle(tenantId, pool, kaydedilenUrun.id);
    const guncel = await pool.query("SELECT * FROM urunler WHERE isletme_id=$1 AND id=$2 AND arsivli=false", [tenantId, kaydedilenUrun.id]);
    kaydedilenUrun = guncel.rows[0] || kaydedilenUrun;
  }
  return urunDonustur(kaydedilenUrun, { stokDetayi: true });
}

async function onerilenUrunleriDogrula(isletmeId, ham, kendiId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  if (ham == null) return [];
  if (!Array.isArray(ham)) throw new Error("Önerilen ürünler listesi geçersiz.");
  const kendiUrunId = Number(kendiId);
  const idler = [...new Set(ham.map(Number).filter(Number.isInteger))].filter((id) => id > 0 && id !== kendiUrunId);
  if (idler.length > 5) throw new Error("En fazla 5 önerilen ürün seçebilirsin.");
  if (!idler.length) return [];
  const sonuc = await pool.query(
    "SELECT id FROM urunler WHERE isletme_id=$1 AND id=ANY($2::int[]) AND aktif=true AND arsivli=false",
    [tenantId, idler]
  );
  const gecerliIdler = new Set(sonuc.rows.map((urun) => Number(urun.id)));
  if (gecerliIdler.size !== idler.length) throw new Error("Önerilen ürünlerden biri geçersiz veya satışta değil.");
  return idler;
}

export async function onerileriGetir(isletmeId, sepetUrunIdleri) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sepetIdleri = [...new Set((Array.isArray(sepetUrunIdleri) ? sepetUrunIdleri : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 30);
  if (!sepetIdleri.length) return [];
  const [manuelSonucu, istatistikSonucu, performansSonucu, katalog] = await Promise.all([
    pool.query(
      "SELECT id,onerilen_urunler FROM urunler WHERE isletme_id=$1 AND id=ANY($2::int[]) AND aktif=true AND arsivli=false",
      [tenantId, sepetIdleri],
    ),
    pool.query(`
      WITH gecmis AS (
        SELECT COALESCE(siparis_no,'oturum-'||oturum_id::text) siparis_anahtari,urun_id,SUM(adet)::int adet
        FROM siparis_kalemleri
        WHERE isletme_id=$1 AND olusturma>=NOW()-INTERVAL '120 days'
        GROUP BY COALESCE(siparis_no,'oturum-'||oturum_id::text),urun_id
      ), sepet_siparisleri AS (
        SELECT DISTINCT siparis_anahtari FROM gecmis WHERE urun_id=ANY($2::int[])
      )
      SELECT g.urun_id,
        COUNT(*) FILTER (WHERE s.siparis_anahtari IS NOT NULL)::int birlikte_siparis,
        COUNT(*)::int toplam_siparis,
        (SELECT COUNT(*)::int FROM sepet_siparisleri) sepet_siparisi
      FROM gecmis g
      LEFT JOIN sepet_siparisleri s ON s.siparis_anahtari=g.siparis_anahtari
      WHERE NOT (g.urun_id=ANY($2::int[]))
      GROUP BY g.urun_id
    `, [tenantId, sepetIdleri]),
    pool.query(`SELECT e.urun_id,
        COUNT(DISTINCT e.oturum_id) FILTER (WHERE e.olay_turu='goruntulendi')::int goruntulenme,
        COUNT(DISTINCT e.oturum_id) FILTER (WHERE e.olay_turu='tiklandi')::int tiklama,
        COUNT(DISTINCT e.oturum_id) FILTER (WHERE e.olay_turu='sepete_eklendi')::int sepete_ekleme,
        COUNT(DISTINCT e.oturum_id) FILTER (WHERE e.olay_turu='satin_alindi')::int satin_alma
      FROM oneri_olaylari e
      JOIN oneri_oturumlari o ON o.id=e.oturum_id AND o.isletme_id=e.isletme_id
      WHERE e.isletme_id=$1 AND e.olusturma>=NOW()-INTERVAL '60 days'
        AND o.olusturma>=NOW()-INTERVAL '60 days'
        AND o.kaynak_urun_idleri && $2::int[]
      GROUP BY e.urun_id`, [tenantId, sepetIdleri]),
    urunleriGetir(tenantId),
  ]);
  const manuelOneriIdleri = manuelSonucu.rows
    .flatMap((urun) => Array.isArray(urun.onerilen_urunler) ? urun.onerilen_urunler : [])
    .map(Number)
    .filter(Number.isInteger);
  return otomatikOnerileriSirala({
    urunler: katalog,
    sepetUrunIdleri: sepetIdleri,
    istatistikler: istatistikSonucu.rows,
    performanslar: performansSonucu.rows,
    manuelOneriIdleri,
    limit: 3,
  });
}

export async function urunAktiflikDegistir(isletmeId, id, aktif) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  await pool.query("UPDATE urunler SET aktif=$1,guncelleme=NOW() WHERE isletme_id=$2 AND id=$3 AND arsivli=false", [!!aktif, tenantId, id]);
}

export async function urunArsivle(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    "UPDATE urunler SET aktif=false,arsivli=true,guncelleme=NOW() WHERE isletme_id=$1 AND id=$2 AND arsivli=false RETURNING id",
    [tenantId, id]
  );
  if (!sonuc.rows.length) throw new Error("Ürün bulunamadı.");
  await pool.query(
    `UPDATE urunler SET aktif=false,arsivli=true,guncelleme=NOW()
     WHERE isletme_id=$1 AND urun_tipi='menu' AND arsivli=false AND (
       menu_yapisi->>'burgerUrunId'=$2 OR menu_yapisi->>'yanLezzetUrunId'=$2 OR menu_yapisi->>'icecekUrunId'=$2
     )`,
    [tenantId, String(id)]
  );
}

export async function personelleriGetir(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(`
    SELECT p.*,
      k.sifre_degistirmeli,
      v.id AS acik_vardiya_id, v.giris AS vardiya_giris,
      COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(v2.cikis,NOW())-v2.giris))/3600)
                FROM vardiyalar v2 WHERE v2.isletme_id=$1 AND v2.personel_id=p.id
                AND v2.giris >= date_trunc('month',NOW())),0) AS aylik_saat
    FROM personeller p
    LEFT JOIN vardiyalar v ON v.isletme_id=$1 AND v.personel_id=p.id AND v.cikis IS NULL
    LEFT JOIN kullanicilar k ON k.isletme_id=$1 AND k.id=p.kullanici_id
    WHERE p.isletme_id=$1 AND p.aktif=true AND p.arsivli=false ORDER BY p.ad,p.soyad
  `, [tenantId]);
  return sonuc.rows.map((p) => ({
    ...p,
    saatlik_ucret: Number(p.saatlik_ucret),
    aylik_saat: Number(p.aylik_saat),
  }));
}

export async function personelKaydet(isletmeId, veri) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const ad = String(veri.ad || "").trim().slice(0, 80);
  const soyad = String(veri.soyad || "").trim().slice(0, 80);
  const rolEtiketi = String(veri.rol || "").trim();
  const rolHaritasi = { "Mutfak": "mutfak", "Salon": "salon", "Kasiyer": "kasiyer", "Yönetici": "admin" };
  const hesapRolu = rolHaritasi[rolEtiketi];
  const email = String(veri.email || "").trim().toLowerCase().slice(0, 254);
  const telefon = String(veri.telefon || "").trim().slice(0, 20) || null;
  const sifre = String(veri.sifre || "");
  if (!ad || !soyad || !hesapRolu) throw new Error("Personel adı, soyadı ve geçerli rol zorunludur.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Personel girişi için geçerli e-posta zorunludur.");
  if (sifre && (sifre.length < 8 || sifre.length > 72)) throw new Error("Şifre 8–72 karakter arasında olmalıdır.");

  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    let mevcut = null;
    if (veri.id) {
      const sonuc = await baglanti.query("SELECT * FROM personeller WHERE isletme_id=$1 AND id=$2 FOR UPDATE", [tenantId, veri.id]);
      mevcut = sonuc.rows[0] || null;
      if (!mevcut) throw new Error("Personel bulunamadı.");
    }
    if (!mevcut?.kullanici_id && !sifre) throw new Error("Personel hesabı için en az 8 karakterli şifre belirleyin.");

    let kullaniciId = mevcut?.kullanici_id || null;
    if (kullaniciId) {
      const parametreler = [ad, soyad, email, telefon, hesapRolu, kullaniciId];
      if (sifre) {
        // Şifre geçicidir ancak yalnızca bcrypt özeti saklanır; düz metin
        // form gönderildikten sonra backend tarafından tekrar döndürülemez.
        parametreler.push(await bcrypt.hash(sifre, 12));
        await baglanti.query(
          `UPDATE kullanicilar
              SET ad=$1,soyad=$2,email=$3,telefon=$4,rol=$5,sifre_hash=$7,
                  sifre_degistirmeli=true,sifre_degisim_tarihi=NOW()
            WHERE isletme_id=$8 AND id=$6`,
          [...parametreler, tenantId]
        );
      } else {
        await baglanti.query(
          `UPDATE kullanicilar SET ad=$1,soyad=$2,email=$3,telefon=$4,rol=$5 WHERE isletme_id=$7 AND id=$6`,
          [...parametreler, tenantId]
        );
      }
    } else {
      const sifreHash = await bcrypt.hash(sifre, 12);
      const hesap = await baglanti.query(
        `INSERT INTO kullanicilar (isletme_id,ad,soyad,email,telefon,sifre_hash,rol,davet_kodu,sifre_degistirmeli)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
        [tenantId, ad, soyad, email, telefon, sifreHash, hesapRolu, davetKoduUret()]
      );
      kullaniciId = hesap.rows[0].id;
    }

    const alanlar = [ad, soyad, rolEtiketi, email, telefon, sayi(veri.saatlikUcret), kullaniciId];
    const sonuc = mevcut
      ? await baglanti.query(
          `UPDATE personeller SET ad=$1,soyad=$2,rol=$3,email=$4,telefon=$5,saatlik_ucret=$6,kullanici_id=$7
           WHERE isletme_id=$8 AND id=$9 RETURNING *`, [...alanlar, tenantId, veri.id]
        )
      : await baglanti.query(
          `INSERT INTO personeller (isletme_id,ad,soyad,rol,email,telefon,saatlik_ucret,kullanici_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [tenantId, ...alanlar]
        );
    await baglanti.query("COMMIT");
    return sonuc.rows[0];
  } catch (e) {
    await baglanti.query("ROLLBACK");
    if (e.code === "23505") throw new Error("Bu e-posta başka bir hesapta kullanılıyor.");
    throw e;
  } finally {
    baglanti.release();
  }
}

export async function vardiyaDegistir(isletmeId, personelId, islem) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  if (islem === "giris") {
    const acik = await pool.query("SELECT id FROM vardiyalar WHERE isletme_id=$1 AND personel_id=$2 AND cikis IS NULL", [tenantId, personelId]);
    if (!acik.rows.length) await pool.query("INSERT INTO vardiyalar (isletme_id,personel_id) VALUES ($1,$2)", [tenantId, personelId]);
  } else if (islem === "cikis") {
    await pool.query(
      "UPDATE vardiyalar SET cikis=NOW() WHERE isletme_id=$1 AND personel_id=$2 AND cikis IS NULL",
      [tenantId, personelId]
    );
  }
}

export async function duyurulariGetir(isletmeId, { tumu = false } = {}) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `SELECT id,baslik,mesaj,hedef,aktif,olusturma,ceviriler FROM duyurular
     WHERE isletme_id=$1 AND arsivli=false ${tumu ? "" : "AND aktif=true"}
     ORDER BY olusturma DESC LIMIT 30`,
    [tenantId]
  );
  return sonuc.rows.map(({ ceviriler, ...duyuru }) => ({ ...duyuru, ...ceviriAlanlari(ceviriler) }));
}

export async function duyuruKaydet(isletmeId, veri) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const baslik = String(veri.baslik || "").trim().slice(0, 100);
  const mesaj = String(veri.mesaj || "").trim().slice(0, 600);
  const hamHedef = String(veri.hedef || "/anasayfa").trim();
  const hedef = hamHedef.startsWith("/") && !hamHedef.startsWith("//") ? hamHedef.slice(0, 160) : "/anasayfa";
  if (!baslik || !mesaj) throw new Error("Duyuru başlığı ve mesajı zorunludur.");
  const ceviriler = await ingilizceCeviriUret("duyuru", { baslik, mesaj });
  const sonuc = await pool.query(
    `INSERT INTO duyurular (isletme_id,baslik,mesaj,hedef,aktif,ceviriler) VALUES ($1,$2,$3,$4,true,$5::jsonb) RETURNING *`,
    [tenantId, baslik, mesaj, hedef, JSON.stringify(ceviriler)]
  );
  const { ceviriler: kayitliCeviriler, ...duyuru } = sonuc.rows[0];
  return { ...duyuru, ...ceviriAlanlari(kayitliCeviriler) };
}

function kampanyayiDonustur(kampanya) {
  return { id: Number(kampanya.id), kod: kampanya.kod || null, etiket: kampanya.etiket, baslik: kampanya.baslik, aciklama: kampanya.aciklama, buton: kampanya.buton, butonTipi: kampanya.buton_tipi, gorsel: kampanya.gorsel || null, ikon: kampanya.ikon || null, aktif: kampanya.aktif, baslangicSaat: kampanya.baslangic_saat == null ? null : Number(kampanya.baslangic_saat), bitisSaat: kampanya.bitis_saat == null ? null : Number(kampanya.bitis_saat), indirimYuzde: Number(kampanya.indirim_yuzde || 0), gecerliKategoriler: Array.isArray(kampanya.gecerli_kategoriler) ? kampanya.gecerli_kategoriler : [], kampanyaTipi: kampanya.kampanya_tipi, sira: Number(kampanya.sira || 0), ...ceviriAlanlari(kampanya.ceviriler) };
}

export async function kampanyalariGetir(isletmeId, { tumu = false } = {}) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(`SELECT * FROM kampanyalar WHERE isletme_id=$1 AND arsivli=false ${tumu ? "" : "AND aktif=true"} ORDER BY sira,id`, [tenantId]);
  return sonuc.rows.map(kampanyayiDonustur);
}

export async function kampanyaTaslagiGetir(isletmeId, gun = 30) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const aralik = Math.floor(Math.min(90, Math.max(7, sayi(gun, 30))));
  const [kategoriIstatistikleri, saatlik] = await Promise.all([
    pool.query(`
      SELECT u.kategori,COUNT(DISTINCT u.id)::int aktif_urun,
        COALESCE(SUM(k.adet),0)::int adet,COALESCE(SUM(k.fiyat*k.adet),0) ciro,
        COALESCE(SUM(LEAST(k.adet,k.oneri_adedi)),0)::int oneri_adedi,
        COALESCE(SUM(k.fiyat*LEAST(k.adet,k.oneri_adedi)),0) oneri_cirosu,
        COALESCE(SUM(k.adet) FILTER (WHERE u.urun_tipi IN ('yan_lezzet','icecek','diger')),0)::int tamamlayici_adet
      FROM urunler u
      JOIN kategoriler c ON c.isletme_id=$1 AND c.ad=u.kategori AND c.aktif=true AND c.arsivli=false
      LEFT JOIN siparis_kalemleri k ON k.isletme_id=$1 AND k.urun_id=u.id
        AND k.olusturma>=NOW()-($2::text || ' days')::interval
      WHERE u.isletme_id=$1 AND u.aktif=true AND u.arsivli=false
      GROUP BY u.kategori
    `, [tenantId, aralik]),
    pool.query(`
      SELECT EXTRACT(HOUR FROM olusturma)::int saat,
        COUNT(DISTINCT COALESCE(siparis_no,id::text))::int siparis
      FROM siparis_kalemleri
      WHERE isletme_id=$1 AND olusturma>=NOW()-($2::text || ' days')::interval
      GROUP BY 1 ORDER BY 1
    `, [tenantId, aralik]),
  ]);
  return kampanyaTaslagiOlustur({
    kategoriIstatistikleri: kategoriIstatistikleri.rows,
    saatlik: saatlik.rows,
    gun: aralik,
  });
}

export async function kampanyaKaydet(isletmeId, veri) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const id = veri.id == null || veri.id === "" ? null : Number(veri.id);
  const etiket = String(veri.etiket || "").trim().slice(0, 80), baslik = String(veri.baslik || "").trim().slice(0, 120), aciklama = String(veri.aciklama || "").trim().slice(0, 600), buton = String(veri.buton || "Sipariş Ver").trim().slice(0, 60);
  const butonTipi = ["primary", "charcoal"].includes(veri.butonTipi) ? veri.butonTipi : "primary", gorsel = String(veri.gorsel || "").trim().slice(0, 1000) || null, ikon = String(veri.ikon || "").trim().replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 16) || null, kampanyaTipi = ["surekli", "saatli"].includes(veri.kampanyaTipi) ? veri.kampanyaTipi : "surekli", indirimYuzde = Number(veri.indirimYuzde), sira = Math.floor(Number(veri.sira || 0));
  const kategoriler = [...new Set((Array.isArray(veri.gecerliKategoriler) ? veri.gecerliKategoriler : []).map((kategori) => String(kategori).trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
  const baslangicSaat = kampanyaTipi === "saatli" ? Number(veri.baslangicSaat) : null, bitisSaat = kampanyaTipi === "saatli" ? Number(veri.bitisSaat) : null;
  if (!etiket || !baslik || !aciklama || !buton) throw new Error("Kampanya etiketi, başlığı, açıklaması ve butonu zorunludur.");
  if (!Number.isFinite(indirimYuzde) || indirimYuzde < 0 || indirimYuzde > 90) throw new Error("İndirim oranı %0–%90 arasında olmalıdır.");
  if (indirimYuzde > 0 && !kategoriler.length) throw new Error("İndirimli kampanya için en az bir kategori seçin.");
  if (kampanyaTipi === "saatli" && (!Number.isInteger(baslangicSaat) || !Number.isInteger(bitisSaat) || baslangicSaat < 0 || bitisSaat > 24 || baslangicSaat >= bitisSaat)) throw new Error("Saatli kampanyada başlangıç ve bitiş saatleri geçersiz.");
  const oncekiCeviri = await oncekiCeviriGetir("kampanyalar", tenantId, id);
  const ceviriler = await ingilizceCeviriUret("kampanya", { etiket, baslik, aciklama, buton }, oncekiCeviri);
  const alanlar = [etiket, baslik, aciklama, buton, butonTipi, gorsel, ikon, veri.aktif !== false, baslangicSaat, bitisSaat, indirimYuzde, JSON.stringify(kategoriler), kampanyaTipi, sira, JSON.stringify(ceviriler)];
  const sonuc = id
    ? await pool.query(`UPDATE kampanyalar SET etiket=$1,baslik=$2,aciklama=$3,buton=$4,buton_tipi=$5,gorsel=$6,ikon=$7,aktif=$8,baslangic_saat=$9,bitis_saat=$10,indirim_yuzde=$11,gecerli_kategoriler=$12::jsonb,kampanya_tipi=$13,sira=$14,ceviriler=$15::jsonb,guncelleme=NOW() WHERE isletme_id=$16 AND id=$17 RETURNING *`, [...alanlar, tenantId, id])
    : await pool.query(`INSERT INTO kampanyalar (isletme_id,etiket,baslik,aciklama,buton,buton_tipi,gorsel,ikon,aktif,baslangic_saat,bitis_saat,indirim_yuzde,gecerli_kategoriler,kampanya_tipi,sira,ceviriler) VALUES ($16,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb) RETURNING *`, [...alanlar, tenantId]);
  if (!sonuc.rows.length) throw new Error("Kampanya bulunamadı.");
  return kampanyayiDonustur(sonuc.rows[0]);
}

export async function eksikCevirileriTamamla(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const tanimlar = [
    {
      tablo: "kategoriler", tur: "kategori",
      kaynak: (satir) => ({ ad: satir.ad }),
    },
    {
      tablo: "urunler", tur: "urun",
      kaynak: (satir) => urunCeviriKaynagi({
        ad: satir.ad, aciklama: satir.aciklama, malzemeler: satir.malzemeler || [], alerjenler: satir.alerjenler || [],
        gramajOpsiyonu: satir.gramaj_opsiyonu, boyutSecenekleri: satir.boyut_secenekleri || [], ekstraMalzemeAyari: satir.ekstra_malzeme_ayari || {},
      }),
    },
    {
      tablo: "kampanyalar", tur: "kampanya",
      kaynak: (satir) => ({ etiket: satir.etiket, baslik: satir.baslik, aciklama: satir.aciklama, buton: satir.buton }),
    },
    {
      tablo: "duyurular", tur: "duyuru",
      kaynak: (satir) => ({ baslik: satir.baslik, mesaj: satir.mesaj }),
    },
  ];
  const ozet = { toplam: 0, hazir: 0, bekliyor: 0, hata: 0, hataOrnekleri: [] };
  for (const tanim of tanimlar) {
    const sonuc = await pool.query(`SELECT * FROM ${tanim.tablo} WHERE isletme_id=$1 AND arsivli=false ORDER BY id`, [tenantId]);
    for (const satir of sonuc.rows) {
      const ceviriler = await ingilizceCeviriUret(tanim.tur, tanim.kaynak(satir), satir.ceviriler);
      await pool.query(`UPDATE ${tanim.tablo} SET ceviriler=$1::jsonb,guncelleme=NOW() WHERE isletme_id=$2 AND id=$3`, [JSON.stringify(ceviriler), tenantId, satir.id]);
      ozet.toplam += 1;
      ozet[ceviriler.durum] = (ozet[ceviriler.durum] || 0) + 1;
      if (ceviriler.durum === "hata" && ceviriler.hata && !ozet.hataOrnekleri.includes(ceviriler.hata) && ozet.hataOrnekleri.length < 3) {
        ozet.hataOrnekleri.push(ceviriler.hata);
      }
    }
  }
  return ozet;
}

export async function dashboardGetir(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const [satis, personel, populer, hazirlik] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(fiyat*adet),0) toplam,
      COALESCE(SUM(fiyat*LEAST(adet,oneri_adedi)),0) oneri_cirosu,
      COALESCE(SUM(LEAST(adet,oneri_adedi)),0)::int oneri_adedi,
      COUNT(DISTINCT COALESCE(siparis_no, id::text)) siparis_sayisi
      FROM siparis_kalemleri WHERE isletme_id=$1 AND olusturma >= date_trunc('day',NOW())`, [tenantId]),
    pool.query("SELECT COUNT(*) FILTER (WHERE aktif) toplam, (SELECT COUNT(*) FROM vardiyalar WHERE isletme_id=$1 AND cikis IS NULL) vardiyada FROM personeller WHERE isletme_id=$1", [tenantId]),
    pool.query(`SELECT urun_ad, SUM(adet)::int adet, SUM(fiyat*adet) ciro
      FROM siparis_kalemleri WHERE isletme_id=$1 AND olusturma >= NOW()-INTERVAL '30 days'
      GROUP BY urun_ad ORDER BY adet DESC LIMIT 5`, [tenantId]),
    pool.query(`SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (hazir_at-hazirlamaya_baslandi))/60.0) FILTER
        (WHERE hazir_at IS NOT NULL AND hazirlamaya_baslandi IS NOT NULL),1) AS ortalama_dakika,
      COUNT(DISTINCT COALESCE(siparis_no,oturum_id::text)) FILTER
        (WHERE hazir_at IS NOT NULL AND hazirlamaya_baslandi IS NOT NULL
          AND EXTRACT(EPOCH FROM (hazir_at-hazirlamaya_baslandi))/60.0 > 15)::int AS geciken
      FROM siparis_kalemleri WHERE isletme_id=$1 AND olusturma >= NOW()-INTERVAL '30 days'`, [tenantId]),
  ]);
  return {
    bugunCiro: Number(satis.rows[0].toplam),
    bugunOneriCirosu: Number(satis.rows[0].oneri_cirosu),
    bugunOneriAdedi: Number(satis.rows[0].oneri_adedi),
    bugunSiparis: Number(satis.rows[0].siparis_sayisi),
    personel: Number(personel.rows[0].toplam),
    vardiyada: Number(personel.rows[0].vardiyada),
    populer: populer.rows.map((p) => ({ ...p, adet: Number(p.adet), ciro: Number(p.ciro) })),
    ortalamaHazirlamaDakika: hazirlik.rows[0].ortalama_dakika == null ? null : Number(hazirlik.rows[0].ortalama_dakika),
    gecikenSiparis: Number(hazirlik.rows[0].geciken || 0),
  };
}

export async function kurulumAyarlariGetir(isletmeId) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    "SELECT deger FROM sistem_ayarlari WHERE isletme_id=$1 AND anahtar='masa_sayisi'",
    [tenantId]
  );
  const adet = Number(sonuc.rows[0]?.deger?.adet);
  return { masaSayisi: Number.isInteger(adet) && adet >= 1 && adet <= 500 ? adet : 10 };
}

export function oneriHunisiniDonustur(satir = {}) {
  const goruntulenme = Number(satir.goruntulenme || 0);
  const tiklama = Number(satir.tiklama || 0);
  const sepeteEkleme = Number(satir.sepete_ekleme || 0);
  const satinAlma = Number(satir.satin_alma || 0);
  const oran = (pay, payda) => payda > 0 ? Math.round((pay / payda) * 10_000) / 100 : 0;
  return {
    goruntulenme, tiklama, sepeteEkleme, satinAlma,
    goruntulenmeOturumu: Number(satir.goruntulenme_oturumu || 0),
    tiklamaOrani: oran(tiklama, goruntulenme),
    sepeteEklemeOrani: oran(sepeteEkleme, tiklama),
    satinAlmaOrani: oran(satinAlma, sepeteEkleme),
    toplamDonusumOrani: oran(satinAlma, goruntulenme),
  };
}

export async function satisRaporuGetir(isletmeId, gun = 30) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const aralik = Math.min(365, Math.max(1, sayi(gun, 30)));
  const [gunluk, urunler, kategoriler, saatlik, haftalik, ozet, oncekiOzet, oneriHunisi, oncekiOneriHunisiSonucu, oneriUrunleri] = await Promise.all([
    pool.query(`SELECT date_trunc('day',olusturma)::date gun, SUM(fiyat*adet) ciro, SUM(adet) adet,
        COALESCE(SUM(fiyat*LEAST(adet,oneri_adedi)),0) oneri_cirosu,
        COALESCE(SUM(LEAST(adet,oneri_adedi)),0)::int oneri_adedi,
        COUNT(DISTINCT COALESCE(siparis_no,id::text))::int siparis
      FROM siparis_kalemleri WHERE isletme_id=$1 AND olusturma >= NOW()-($2::text || ' days')::interval
      GROUP BY 1 ORDER BY 1`, [tenantId, aralik]),
    pool.query(`SELECT urun_ad, SUM(adet) adet, SUM(fiyat*adet) ciro
      FROM siparis_kalemleri WHERE isletme_id=$1 AND olusturma >= NOW()-($2::text || ' days')::interval
      GROUP BY urun_ad ORDER BY ciro DESC`, [tenantId, aralik]),
    pool.query(`SELECT COALESCE(u.kategori,'Diğer') kategori, SUM(k.adet)::int adet, SUM(k.fiyat*k.adet) ciro
      FROM siparis_kalemleri k LEFT JOIN urunler u ON u.isletme_id=$1 AND u.id=k.urun_id
      WHERE k.isletme_id=$1 AND k.olusturma >= NOW()-($2::text || ' days')::interval
      GROUP BY 1 ORDER BY adet DESC`, [tenantId, aralik]),
    pool.query(`SELECT EXTRACT(HOUR FROM olusturma)::int saat, SUM(adet)::int adet,
        COUNT(DISTINCT COALESCE(siparis_no,id::text))::int siparis
      FROM siparis_kalemleri WHERE isletme_id=$1 AND olusturma >= NOW()-($2::text || ' days')::interval
      GROUP BY 1 ORDER BY 1`, [tenantId, aralik]),
    pool.query(`SELECT EXTRACT(ISODOW FROM olusturma)::int gun, SUM(adet)::int adet,
        SUM(fiyat*adet) ciro
      FROM siparis_kalemleri WHERE isletme_id=$1 AND olusturma >= NOW()-($2::text || ' days')::interval
      GROUP BY 1 ORDER BY 1`, [tenantId, aralik]),
    // Genel dönem toplamı: ürün adedinden bağımsız gerçek sipariş sayısı burada çıkar (ortalama sepet tutarı için).
    pool.query(`SELECT COALESCE(SUM(fiyat*adet),0) ciro, COALESCE(SUM(adet),0)::int adet,
        COALESCE(SUM(fiyat*LEAST(adet,oneri_adedi)),0) oneri_cirosu,
        COALESCE(SUM(LEAST(adet,oneri_adedi)),0)::int oneri_adedi,
        COUNT(DISTINCT COALESCE(siparis_no,id::text)) FILTER (WHERE oneri_adedi > 0)::int oneri_siparisi,
        COUNT(DISTINCT COALESCE(siparis_no,id::text))::int siparis
      FROM siparis_kalemleri WHERE isletme_id=$1 AND olusturma >= NOW()-($2::text || ' days')::interval`, [tenantId, aralik]),
    // Bir önceki eşit uzunluktaki dönem: kutucuklardaki trend karşılaştırması için.
    pool.query(`SELECT COALESCE(SUM(fiyat*adet),0) ciro, COALESCE(SUM(adet),0)::int adet,
        COALESCE(SUM(fiyat*LEAST(adet,oneri_adedi)),0) oneri_cirosu,
        COALESCE(SUM(LEAST(adet,oneri_adedi)),0)::int oneri_adedi,
        COUNT(DISTINCT COALESCE(siparis_no,id::text)) FILTER (WHERE oneri_adedi > 0)::int oneri_siparisi,
        COUNT(DISTINCT COALESCE(siparis_no,id::text))::int siparis
      FROM siparis_kalemleri
      WHERE isletme_id=$1 AND olusturma >= NOW()-($2::text || ' days')::interval
        AND olusturma < NOW()-($3::text || ' days')::interval`, [tenantId, String(aralik * 2), aralik]),
    pool.query(`SELECT
        COUNT(DISTINCT (oturum_id,urun_id)) FILTER (WHERE olay_turu='goruntulendi')::int goruntulenme,
        COUNT(DISTINCT (oturum_id,urun_id)) FILTER (WHERE olay_turu='tiklandi')::int tiklama,
        COUNT(DISTINCT (oturum_id,urun_id)) FILTER (WHERE olay_turu='sepete_eklendi')::int sepete_ekleme,
        COUNT(DISTINCT (oturum_id,urun_id)) FILTER (WHERE olay_turu='satin_alindi')::int satin_alma,
        COUNT(DISTINCT oturum_id) FILTER (WHERE olay_turu='goruntulendi')::int goruntulenme_oturumu
      FROM oneri_olaylari
      WHERE isletme_id=$1 AND olusturma >= NOW()-($2::text || ' days')::interval`, [tenantId, aralik]),
    pool.query(`SELECT
        COUNT(DISTINCT (oturum_id,urun_id)) FILTER (WHERE olay_turu='goruntulendi')::int goruntulenme,
        COUNT(DISTINCT (oturum_id,urun_id)) FILTER (WHERE olay_turu='tiklandi')::int tiklama,
        COUNT(DISTINCT (oturum_id,urun_id)) FILTER (WHERE olay_turu='sepete_eklendi')::int sepete_ekleme,
        COUNT(DISTINCT (oturum_id,urun_id)) FILTER (WHERE olay_turu='satin_alindi')::int satin_alma,
        COUNT(DISTINCT oturum_id) FILTER (WHERE olay_turu='goruntulendi')::int goruntulenme_oturumu
      FROM oneri_olaylari
      WHERE isletme_id=$1 AND olusturma >= NOW()-($2::text || ' days')::interval
        AND olusturma < NOW()-($3::text || ' days')::interval`, [tenantId, String(aralik * 2), aralik]),
    pool.query(`SELECT e.urun_id, COALESCE(u.ad,'Arşivlenmiş ürün') urun_ad,
        COUNT(DISTINCT e.oturum_id) FILTER (WHERE e.olay_turu='goruntulendi')::int goruntulenme,
        COUNT(DISTINCT e.oturum_id) FILTER (WHERE e.olay_turu='tiklandi')::int tiklama,
        COUNT(DISTINCT e.oturum_id) FILTER (WHERE e.olay_turu='sepete_eklendi')::int sepete_ekleme,
        COUNT(DISTINCT e.oturum_id) FILTER (WHERE e.olay_turu='satin_alindi')::int satin_alma
      FROM oneri_olaylari e
      LEFT JOIN urunler u ON u.isletme_id=e.isletme_id AND u.id=e.urun_id
      WHERE e.isletme_id=$1 AND e.olusturma >= NOW()-($2::text || ' days')::interval
      GROUP BY e.urun_id,u.ad
      ORDER BY satin_alma DESC, sepete_ekleme DESC, tiklama DESC, goruntulenme DESC
      LIMIT 20`, [tenantId, aralik]),
  ]);
  return {
    gunluk: gunluk.rows.map((g) => ({ ...g, ciro: Number(g.ciro), adet: Number(g.adet), siparis: Number(g.siparis), oneriCirosu: Number(g.oneri_cirosu), oneriAdedi: Number(g.oneri_adedi) })),
    urunler: urunler.rows.map((u) => ({ ...u, ciro: Number(u.ciro), adet: Number(u.adet) })),
    kategoriler: kategoriler.rows.map((k) => ({ ...k, ciro: Number(k.ciro), adet: Number(k.adet) })),
    saatlik: saatlik.rows.map((s) => ({ ...s, saat: Number(s.saat), adet: Number(s.adet), siparis: Number(s.siparis) })),
    haftalik: haftalik.rows.map((h) => ({ ...h, gun: Number(h.gun), adet: Number(h.adet), ciro: Number(h.ciro) })),
    ozet: {
      ciro: Number(ozet.rows[0].ciro), adet: Number(ozet.rows[0].adet), siparis: Number(ozet.rows[0].siparis),
      oneriCirosu: Number(ozet.rows[0].oneri_cirosu), oneriAdedi: Number(ozet.rows[0].oneri_adedi), oneriSiparisi: Number(ozet.rows[0].oneri_siparisi),
    },
    oncekiOzet: {
      ciro: Number(oncekiOzet.rows[0].ciro), adet: Number(oncekiOzet.rows[0].adet), siparis: Number(oncekiOzet.rows[0].siparis),
      oneriCirosu: Number(oncekiOzet.rows[0].oneri_cirosu), oneriAdedi: Number(oncekiOzet.rows[0].oneri_adedi), oneriSiparisi: Number(oncekiOzet.rows[0].oneri_siparisi),
    },
    oneriHunisi: oneriHunisiniDonustur(oneriHunisi.rows[0]),
    oncekiOneriHunisi: oneriHunisiniDonustur(oncekiOneriHunisiSonucu.rows[0]),
    oneriUrunleri: oneriUrunleri.rows.map((urun) => {
      const donusturulmus = oneriHunisiniDonustur(urun);
      return { urunId: Number(urun.urun_id), urunAd: urun.urun_ad, ...donusturulmus };
    }),
  };
}

export async function kategoriArsivle(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const kategori = await baglanti.query("SELECT ad FROM kategoriler WHERE isletme_id=$1 AND id=$2 AND arsivli=false FOR UPDATE", [tenantId, id]);
    if (!kategori.rows.length) throw new Error("Kategori bulunamadı.");
    const urun = await baglanti.query(
      "SELECT 1 FROM urunler WHERE isletme_id=$1 AND kategori=$2 AND arsivli=false LIMIT 1",
      [tenantId, kategori.rows[0].ad]
    );
    if (urun.rows.length) throw new Error("İçinde ürün bulunan kategori silinemez. Önce ürünleri taşıyın veya arşivleyin.");
    await baglanti.query("UPDATE kategoriler SET aktif=false,arsivli=true,guncelleme=NOW() WHERE isletme_id=$1 AND id=$2", [tenantId, id]);
    await baglanti.query("COMMIT");
  } catch (hata) {
    await baglanti.query("ROLLBACK");
    throw hata;
  } finally {
    baglanti.release();
  }
}

export async function personelArsivle(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const baglanti = await pool.connect();
  try {
    await baglanti.query("BEGIN");
    const mevcut = await baglanti.query(
      "SELECT kullanici_id FROM personeller WHERE isletme_id=$1 AND id=$2 AND arsivli=false FOR UPDATE",
      [tenantId, id]
    );
    if (!mevcut.rows.length) throw new Error("Personel bulunamadı.");
    await baglanti.query("UPDATE vardiyalar SET cikis=COALESCE(cikis,NOW()) WHERE isletme_id=$1 AND personel_id=$2 AND cikis IS NULL", [tenantId, id]);
    await baglanti.query("UPDATE personeller SET aktif=false,arsivli=true WHERE isletme_id=$1 AND id=$2", [tenantId, id]);
    if (mevcut.rows[0].kullanici_id) {
      await baglanti.query("UPDATE kullanicilar SET rol='pasif' WHERE isletme_id=$1 AND id=$2", [tenantId, mevcut.rows[0].kullanici_id]);
    }
    await baglanti.query("COMMIT");
  } catch (hata) {
    await baglanti.query("ROLLBACK");
    throw hata;
  } finally {
    baglanti.release();
  }
}

export async function duyuruArsivle(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    "UPDATE duyurular SET aktif=false,arsivli=true WHERE isletme_id=$1 AND id=$2 AND arsivli=false RETURNING id",
    [tenantId, id]
  );
  if (!sonuc.rows.length) throw new Error("Duyuru bulunamadı.");
}

export async function kampanyaArsivle(isletmeId, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    "UPDATE kampanyalar SET aktif=false,arsivli=true,guncelleme=NOW() WHERE isletme_id=$1 AND id=$2 AND arsivli=false RETURNING id",
    [tenantId, id]
  );
  if (!sonuc.rows.length) throw new Error("Kampanya bulunamadı.");
}

const YONETIM_TABLOLARI = {
  urun: "urunler",
  kategori: "kategoriler",
  personel: "personeller",
  duyuru: "duyurular",
  kampanya: "kampanyalar",
  odul: "oduller",
};

export async function yonetimVarliginiGetir(isletmeId, varlikTuru, id) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const tablo = YONETIM_TABLOLARI[varlikTuru];
  if (!tablo) return null;
  const sonuc = await pool.query(`SELECT * FROM ${tablo} WHERE isletme_id=$1 AND id=$2`, [tenantId, id]);
  return sonuc.rows[0] || null;
}

export async function revizyonKaydet(isletmeId, { yapan, varlikTuru, varlikId, islem, aciklama, eskiDeger = null, yeniDeger = null }) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const yapanAd = [yapan?.ad, yapan?.soyad].filter(Boolean).join(" ").trim() || yapan?.email || "Sistem";
  await pool.query(
    `INSERT INTO revizyon_kayitlari
      (isletme_id,yapan_kullanici_id,yapan_ad,varlik_turu,varlik_id,islem,aciklama,eski_deger,yeni_deger)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
    [tenantId, yapan?.id || null, yapanAd.slice(0, 160), String(varlikTuru).slice(0, 60), varlikId == null ? null : String(varlikId).slice(0, 80), String(islem).slice(0, 40), String(aciklama).slice(0, 500), eskiDeger == null ? null : JSON.stringify(eskiDeger), yeniDeger == null ? null : JSON.stringify(yeniDeger)]
  );
}

export async function revizyonKayitlariniGetir(isletmeId, { arama = "", varlikTuru = "", islem = "", baslangic = null, bitis = null, limit = 200 } = {}) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `SELECT id,yapan_ad,varlik_turu,varlik_id,islem,aciklama,eski_deger,yeni_deger,olusturma
     FROM revizyon_kayitlari
     WHERE isletme_id=$1
       AND ($2='' OR yapan_ad ILIKE '%'||$2||'%' OR aciklama ILIKE '%'||$2||'%')
       AND ($3='' OR varlik_turu=$3)
       AND ($4='' OR islem=$4)
       AND ($5::timestamptz IS NULL OR olusturma >= $5::timestamptz)
       AND ($6::timestamptz IS NULL OR olusturma < $6::timestamptz + INTERVAL '1 day')
     ORDER BY olusturma DESC LIMIT $7`,
    [tenantId, String(arama).trim().slice(0, 100), String(varlikTuru).trim().slice(0, 60), String(islem).trim().slice(0, 40), baslangic || null, bitis || null, Math.min(500, Math.max(1, Number(limit) || 200))]
  );
  return sonuc.rows;
}

async function satisKayitlariniGetir(isletmeId, { arama = "", durum = "", baslangic = null, bitis = null, limit = 100 } = {}, acikOturum = true) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `WITH siparisler AS (
       SELECT COALESCE(k.siparis_no,'LEGACY-'||k.oturum_id::text) AS siparis_no,
         MIN(o.masa_no) AS masa_no, MIN(k.kisi_adi) AS kisi_adi,
         SUM(k.fiyat*k.adet) AS tutar, SUM(k.adet)::int AS urun_adedi,
         MIN(k.olusturma) AS olusturma, MAX(o.kapandi_at) AS kapandi_at,
         BOOL_OR(o.durum='acik') AS oturum_acik,
         CASE WHEN BOOL_AND(k.durum='hazir') THEN 'hazir'
              WHEN BOOL_OR(k.durum='hazirlaniyor') THEN 'hazirlaniyor' ELSE 'yeni' END AS durum,
         JSONB_AGG(JSONB_BUILD_OBJECT('ad',k.urun_ad,'adet',k.adet,'fiyat',k.fiyat) ORDER BY k.id) AS urunler
       FROM siparis_kalemleri k JOIN oturumlar o ON o.isletme_id=$1 AND o.id=k.oturum_id
       WHERE k.isletme_id=$1
       GROUP BY COALESCE(k.siparis_no,'LEGACY-'||k.oturum_id::text)
     )
     SELECT * FROM siparisler
     WHERE ($2='' OR siparis_no ILIKE '%'||$2||'%' OR COALESCE(kisi_adi,'') ILIKE '%'||$2||'%' OR COALESCE(masa_no,'') ILIKE '%'||$2||'%')
       AND ($3='' OR durum=$3)
       AND ($4::timestamptz IS NULL OR olusturma >= $4::timestamptz)
       AND ($5::timestamptz IS NULL OR olusturma < $5::timestamptz + INTERVAL '1 day')
       AND oturum_acik=$6
     ORDER BY COALESCE(kapandi_at,olusturma) DESC LIMIT $7`,
    [tenantId, String(arama).trim().slice(0, 100), String(durum).trim(), baslangic || null, bitis || null, acikOturum, Math.min(300, Math.max(1, Number(limit) || 100))]
  );
  return sonuc.rows.map((satir) => ({ ...satir, tutar: Number(satir.tutar), urunAdedi: Number(satir.urun_adedi) }));
}

export async function canliSatislariGetir(isletmeId, secenekler = {}) {
  return satisKayitlariniGetir(isletmeId, secenekler, true);
}

export async function gecmisSatislariGetir(isletmeId, secenekler = {}) {
  return satisKayitlariniGetir(isletmeId, secenekler, false);
}

export async function mutfakKayitlariniGetir(isletmeId, { arama = "", durum = "", personelId = "", baslangic = null, bitis = null, limit = 200 } = {}) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `WITH kayitlar AS (
       SELECT COALESCE(k.siparis_no,'LEGACY-'||k.oturum_id::text) AS siparis_no,
         MIN(o.masa_no) AS masa_no, MIN(k.kisi_adi) AS kisi_adi,
         MIN(k.olusturma) AS siparis_at,
         MIN(k.hazirlamaya_baslandi) AS baslangic_at, MAX(k.hazir_at) AS hazir_at,
         MAX(o.kapandi_at) AS kapandi_at,
         CASE WHEN BOOL_AND(k.durum='hazir') THEN 'hazir'
              WHEN BOOL_OR(k.durum='hazirlaniyor') THEN 'hazirlaniyor' ELSE 'yeni' END AS durum,
         MAX(k.hazirlayan_personel_id) AS personel_id,
         MAX(CONCAT_WS(' ',p.ad,p.soyad)) AS personel_ad,
         SUM(k.adet)::int AS urun_adedi,
         STRING_AGG(k.urun_ad||' x'||k.adet, ', ' ORDER BY k.id) AS urunler
       FROM siparis_kalemleri k
       JOIN oturumlar o ON o.isletme_id=$1 AND o.id=k.oturum_id
       LEFT JOIN personeller p ON p.isletme_id=$1 AND p.id=k.hazirlayan_personel_id
       WHERE k.isletme_id=$1
       GROUP BY COALESCE(k.siparis_no,'LEGACY-'||k.oturum_id::text)
     )
     SELECT *,
       CASE WHEN baslangic_at IS NOT NULL THEN GREATEST(0,ROUND(EXTRACT(EPOCH FROM (baslangic_at-siparis_at))))::int END AS bekleme_saniye,
       CASE WHEN baslangic_at IS NOT NULL THEN GREATEST(0,ROUND(EXTRACT(EPOCH FROM (COALESCE(hazir_at,NOW())-baslangic_at)))::int) END AS hazirlama_saniye,
       CASE WHEN hazir_at IS NOT NULL THEN GREATEST(0,ROUND(EXTRACT(EPOCH FROM (hazir_at-siparis_at)))::int) END AS toplam_saniye,
       CASE WHEN hazir_at IS NOT NULL AND kapandi_at IS NOT NULL THEN GREATEST(0,ROUND(EXTRACT(EPOCH FROM (kapandi_at-hazir_at)))::int) END AS masa_kapanis_saniye
     FROM kayitlar
     WHERE ($2='' OR siparis_no ILIKE '%'||$2||'%' OR urunler ILIKE '%'||$2||'%' OR COALESCE(kisi_adi,'') ILIKE '%'||$2||'%')
       AND ($3='' OR durum=$3)
       AND ($4='' OR personel_id::text=$4)
       AND ($5::timestamptz IS NULL OR siparis_at >= $5::timestamptz)
       AND ($6::timestamptz IS NULL OR siparis_at < $6::timestamptz + INTERVAL '1 day')
     ORDER BY siparis_at DESC LIMIT $7`,
    [tenantId, String(arama).trim().slice(0, 100), String(durum).trim(), String(personelId).trim(), baslangic || null, bitis || null, Math.min(500, Math.max(1, Number(limit) || 200))]
  );
  return sonuc.rows.map((satir) => ({
    ...satir,
    urunAdedi: Number(satir.urun_adedi),
    beklemeSaniye: satir.bekleme_saniye == null ? null : Number(satir.bekleme_saniye),
    hazirlamaSaniye: satir.hazirlama_saniye == null ? null : Number(satir.hazirlama_saniye),
    toplamSaniye: satir.toplam_saniye == null ? null : Number(satir.toplam_saniye),
    masaKapanisSaniye: satir.masa_kapanis_saniye == null ? null : Number(satir.masa_kapanis_saniye),
    hazirlamaDakika: satir.hazirlama_saniye == null ? null : Number(satir.hazirlama_saniye) / 60,
    toplamDakika: satir.toplam_saniye == null ? null : Number(satir.toplam_saniye) / 60,
  }));
}

export async function musteriKayitlariniGetir(isletmeId, { arama = "", baslangic = null, bitis = null, limit = 300 } = {}) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const sonuc = await pool.query(
    `SELECT k.id,k.ad,k.soyad,k.email,k.telefon,k.puan,k.olusturma,
       COUNT(s.id)::int AS siparis_sayisi, COALESCE(SUM(s.tutar),0) AS toplam_harcama,
       MAX(s.olusturma) AS son_siparis
     FROM kullanicilar k LEFT JOIN kullanici_siparisleri s ON s.isletme_id=$1 AND s.kullanici_id=k.id
     WHERE k.isletme_id=$1 AND k.rol='kullanici'
       AND ($2='' OR CONCAT_WS(' ',k.ad,k.soyad) ILIKE '%'||$2||'%' OR k.email ILIKE '%'||$2||'%' OR COALESCE(k.telefon,'') ILIKE '%'||$2||'%')
       AND ($3::timestamptz IS NULL OR k.olusturma >= $3::timestamptz)
       AND ($4::timestamptz IS NULL OR k.olusturma < $4::timestamptz + INTERVAL '1 day')
     GROUP BY k.id ORDER BY k.olusturma DESC LIMIT $5`,
    [tenantId, String(arama).trim().slice(0, 100), baslangic || null, bitis || null, Math.min(500, Math.max(1, Number(limit) || 300))]
  );
  return sonuc.rows.map((satir) => ({ ...satir, puan: Number(satir.puan), siparisSayisi: Number(satir.siparis_sayisi), toplamHarcama: Number(satir.toplam_harcama) }));
}

export async function personelKayitlariniGetir(isletmeId, { arama = "", rol = "", personelId = "", baslangic = null, bitis = null, limit = 300 } = {}) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const parametreler = [tenantId, String(arama).trim().slice(0, 100), String(rol).trim(), String(personelId).trim(), baslangic || null, bitis || null, Math.min(500, Math.max(1, Number(limit) || 300))];
  const vardiyalar = await pool.query(
    `SELECT v.id,v.personel_id,v.giris,v.cikis,v.notlar,p.ad,p.soyad,p.rol,
       ROUND(EXTRACT(EPOCH FROM (COALESCE(v.cikis,NOW())-v.giris))/3600.0,2) AS calisma_saati
     FROM vardiyalar v JOIN personeller p ON p.isletme_id=$1 AND p.id=v.personel_id
     WHERE v.isletme_id=$1 AND ($2='' OR CONCAT_WS(' ',p.ad,p.soyad) ILIKE '%'||$2||'%')
       AND ($3='' OR p.rol=$3) AND ($4='' OR p.id::text=$4)
       AND ($5::timestamptz IS NULL OR v.giris >= $5::timestamptz)
       AND ($6::timestamptz IS NULL OR v.giris < $6::timestamptz + INTERVAL '1 day')
     ORDER BY v.giris DESC LIMIT $7`, parametreler
  );
  const performans = await pool.query(
    `SELECT p.id,p.ad,p.soyad,p.rol,
       COUNT(DISTINCT COALESCE(k.siparis_no,k.oturum_id::text)) FILTER (WHERE k.hazir_at IS NOT NULL)::int AS hazirlanan_siparis,
       ROUND(AVG(EXTRACT(EPOCH FROM (k.hazir_at-k.hazirlamaya_baslandi))/60.0) FILTER (WHERE k.hazir_at IS NOT NULL AND k.hazirlamaya_baslandi IS NOT NULL),1) AS ortalama_dakika
     FROM personeller p LEFT JOIN siparis_kalemleri k ON k.isletme_id=$1 AND k.hazirlayan_personel_id=p.id
       AND ($5::timestamptz IS NULL OR k.olusturma >= $5::timestamptz)
       AND ($6::timestamptz IS NULL OR k.olusturma < $6::timestamptz + INTERVAL '1 day')
     WHERE p.isletme_id=$1 AND p.arsivli=false AND ($2='' OR CONCAT_WS(' ',p.ad,p.soyad) ILIKE '%'||$2||'%')
       AND ($3='' OR p.rol=$3) AND ($4='' OR p.id::text=$4)
     GROUP BY p.id ORDER BY hazirlanan_siparis DESC`, parametreler.slice(0, 6)
  );
  return {
    vardiyalar: vardiyalar.rows.map((satir) => ({ ...satir, calismaSaati: Number(satir.calisma_saati) })),
    performans: performans.rows.map((satir) => ({ ...satir, hazirlananSiparis: Number(satir.hazirlanan_siparis), ortalamaDakika: satir.ortalama_dakika == null ? null : Number(satir.ortalama_dakika) })),
  };
}
