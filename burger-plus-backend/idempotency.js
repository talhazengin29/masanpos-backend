import { createHash } from "crypto";

const ANAHTAR_DESENI = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const TAMAMLANDI = "tamamlandi";

export class IdempotencyHatasi extends Error {
  constructor(mesaj, status = 409, kod = "IDEMPOTENCY_CONFLICT") {
    super(mesaj);
    this.name = "IdempotencyHatasi";
    this.status = status;
    this.kod = kod;
  }
}

export function idempotencyAnahtariniDogrula(deger) {
  const anahtar = String(deger || "").trim();
  if (!anahtar) {
    throw new IdempotencyHatasi(
      "Bu işlem için Idempotency-Key başlığı zorunludur.",
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }
  if (!ANAHTAR_DESENI.test(anahtar)) {
    throw new IdempotencyHatasi(
      "Idempotency-Key 8-128 karakter olmalı; yalnızca harf, rakam, nokta, alt çizgi, iki nokta ve kısa çizgi içermelidir.",
      400,
      "IDEMPOTENCY_KEY_INVALID",
    );
  }
  return anahtar;
}

function kararliDeger(deger, gorulen = new WeakSet()) {
  if (deger === null || typeof deger !== "object") return deger;
  if (gorulen.has(deger)) throw new TypeError("Döngüsel veri özetlenemez.");
  gorulen.add(deger);
  const sonuc = Array.isArray(deger)
    ? deger.map((oge) => kararliDeger(oge, gorulen))
    : Object.fromEntries(
      Object.keys(deger).sort().map((anahtar) => [anahtar, kararliDeger(deger[anahtar], gorulen)]),
    );
  gorulen.delete(deger);
  return sonuc;
}

export function kararliJson(deger) {
  return JSON.stringify(kararliDeger(deger));
}

export function idempotencyIstegiOzeti({ metot, yol, govde }) {
  return createHash("sha256")
    .update(kararliJson({
      metot: String(metot || "POST").toUpperCase(),
      yol: String(yol || ""),
      govde: govde ?? null,
    }))
    .digest("hex");
}

function pozitifTamsayi(deger, alan) {
  const sayi = Number(deger);
  if (!Number.isSafeInteger(sayi) || sayi < 1) throw new TypeError(`${alan} geçersiz.`);
  return sayi;
}

function guvenliKisaMetin(deger, alan, enFazla = 120) {
  const metin = String(deger || "").trim();
  if (!metin || metin.length > enFazla) throw new TypeError(`${alan} geçersiz.`);
  return metin;
}

export async function idempotencyTablosunuHazirla(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS idempotency_kayitlari (
      id BIGSERIAL PRIMARY KEY,
      isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
      kapsam VARCHAR(80) NOT NULL,
      anahtar VARCHAR(128) NOT NULL,
      istek_ozeti CHAR(64) NOT NULL,
      aktor_turu VARCHAR(30) NOT NULL,
      aktor_id VARCHAR(120) NOT NULL,
      durum VARCHAR(20) NOT NULL DEFAULT 'isleniyor'
        CHECK (durum IN ('isleniyor','tamamlandi','basarisiz')),
      yanit_kodu INTEGER,
      yanit_govdesi JSONB,
      olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guncelleme TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      son_gecerlilik TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
      UNIQUE (isletme_id, kapsam, anahtar)
    );
    CREATE INDEX IF NOT EXISTS idempotency_son_gecerlilik_idx
      ON idempotency_kayitlari (son_gecerlilik);
  `);
  await pool.query("DELETE FROM idempotency_kayitlari WHERE son_gecerlilik <= NOW()");
}

const bekle = (milisaniye) => new Promise((tamamla) => setTimeout(tamamla, milisaniye));

export async function idempotentIslemCalistir(pool, ayarlar, islem) {
  const isletmeId = pozitifTamsayi(ayarlar?.isletmeId, "İşletme kimliği");
  const kapsam = guvenliKisaMetin(ayarlar?.kapsam, "Idempotency kapsamı", 80);
  const anahtar = idempotencyAnahtariniDogrula(ayarlar?.anahtar);
  const istekOzeti = guvenliKisaMetin(ayarlar?.istekOzeti, "İstek özeti", 64);
  const aktorTuru = guvenliKisaMetin(ayarlar?.aktorTuru, "Aktör türü", 30);
  const aktorId = guvenliKisaMetin(ayarlar?.aktorId, "Aktör kimliği", 120);
  await pool.query(
      `DELETE FROM idempotency_kayitlari
       WHERE isletme_id=$1 AND kapsam=$2 AND anahtar=$3 AND son_gecerlilik <= NOW()`,
      [isletmeId, kapsam, anahtar],
  );

  async function mevcutKaydiGetir() {
    const bulunan = await pool.query(
      `SELECT istek_ozeti,aktor_turu,aktor_id,durum,yanit_kodu,yanit_govdesi
       FROM idempotency_kayitlari
       WHERE isletme_id=$1 AND kapsam=$2 AND anahtar=$3`,
      [isletmeId, kapsam, anahtar],
    );
    return bulunan.rows[0] || null;
  }

  function kaydiDogrula(mevcut) {
    const ayniIsteginTekrari = mevcut.istek_ozeti === istekOzeti
      && mevcut.aktor_turu === aktorTuru
      && mevcut.aktor_id === aktorId;
    if (!ayniIsteginTekrari) {
      throw new IdempotencyHatasi(
        "Bu Idempotency-Key farklı bir istek veya kullanıcı için daha önce kullanılmış.",
      );
    }
  }

  async function hakTalepEt() {
    const eklenen = await pool.query(
      `INSERT INTO idempotency_kayitlari
        (isletme_id,kapsam,anahtar,istek_ozeti,aktor_turu,aktor_id,durum,yanit_kodu,yanit_govdesi,son_gecerlilik)
       VALUES ($1,$2,$3,$4,$5,$6,'isleniyor',NULL,NULL,NOW()+INTERVAL '24 hours')
       ON CONFLICT (isletme_id,kapsam,anahtar) DO NOTHING
       RETURNING id`,
      [isletmeId, kapsam, anahtar, istekOzeti, aktorTuru, aktorId],
    );
    if (eklenen.rows.length) return true;

    const devralinan = await pool.query(
      `UPDATE idempotency_kayitlari
       SET durum='isleniyor',yanit_kodu=NULL,yanit_govdesi=NULL,guncelleme=NOW(),
           son_gecerlilik=NOW()+INTERVAL '24 hours'
       WHERE isletme_id=$1 AND kapsam=$2 AND anahtar=$3
         AND istek_ozeti=$4 AND aktor_turu=$5 AND aktor_id=$6
         AND (durum='basarisiz' OR (durum='isleniyor' AND guncelleme < NOW()-INTERVAL '5 minutes'))
       RETURNING id`,
      [isletmeId, kapsam, anahtar, istekOzeti, aktorTuru, aktorId],
    );
    return Boolean(devralinan.rows.length);
  }

  let calistirmaHakki = await hakTalepEt();
  if (!calistirmaHakki) {
    const sonBekleme = Date.now() + 20_000;
    while (Date.now() < sonBekleme) {
      const mevcut = await mevcutKaydiGetir();
      if (!mevcut) {
        calistirmaHakki = await hakTalepEt();
        if (calistirmaHakki) break;
      } else {
        kaydiDogrula(mevcut);
        if (mevcut.durum === TAMAMLANDI) {
          return {
            durumKodu: Number(mevcut.yanit_kodu),
            govde: mevcut.yanit_govdesi,
            tekrar: true,
          };
        }
        if (mevcut.durum === "basarisiz") {
          calistirmaHakki = await hakTalepEt();
          if (calistirmaHakki) break;
        }
      }
      await bekle(100);
    }
  }

  if (!calistirmaHakki) {
    throw new IdempotencyHatasi(
      "Aynı anahtarla başlatılan işlem halen devam ediyor. Kısa süre sonra aynı anahtarla yeniden deneyin.",
      409,
      "IDEMPOTENCY_IN_PROGRESS",
    );
  }

  try {
    const sonuc = await islem();
    const durumKodu = Number(sonuc?.durumKodu || 200);
    const govde = sonuc?.govde ?? { basarili: true };
    if (!Number.isInteger(durumKodu) || durumKodu < 200 || durumKodu > 299) {
      throw new TypeError("Idempotent işlem yalnızca başarılı HTTP yanıtını kaydedebilir.");
    }
    await pool.query(
        `UPDATE idempotency_kayitlari
         SET durum='tamamlandi',yanit_kodu=$4,yanit_govdesi=$5::jsonb,guncelleme=NOW()
         WHERE isletme_id=$1 AND kapsam=$2 AND anahtar=$3 AND istek_ozeti=$6`,
        [isletmeId, kapsam, anahtar, durumKodu, JSON.stringify(govde), istekOzeti],
    );
    return { durumKodu, govde, tekrar: false };
  } catch (hata) {
    await pool.query(
      `UPDATE idempotency_kayitlari
       SET durum='basarisiz',yanit_kodu=NULL,yanit_govdesi=NULL,guncelleme=NOW()
       WHERE isletme_id=$1 AND kapsam=$2 AND anahtar=$3 AND istek_ozeti=$4`,
      [isletmeId, kapsam, anahtar, istekOzeti],
    ).catch(() => {});
    throw hata;
  }
}
