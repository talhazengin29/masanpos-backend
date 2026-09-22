import { createHmac, randomUUID, timingSafeEqual } from "crypto";

const REFERANS_TURU = "oneri";
const REFERANS_SURUSU = 1;
const VARSAYILAN_OMUR_SANIYE = 6 * 60 * 60;
const OLAYLAR = new Set(["goruntulendi", "tiklandi", "sepete_eklendi", "satin_alindi"]);

function hata(mesaj, status = 400, kod = "ONERI_REFERANSI_GECERSIZ") {
  const sonuc = new Error(mesaj);
  sonuc.status = status;
  sonuc.kod = kod;
  return sonuc;
}

function sir() {
  const deger = process.env.ONERI_REFERANS_SECRET || process.env.MASA_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!deger || deger.length < 32) throw hata("Öneri referans anahtarı yapılandırılmamış.", 500, "ONERI_REFERANS_ANAHTARI_EKSIK");
  return deger;
}

function imzala(govde) {
  return createHmac("sha256", sir()).update(govde).digest("base64url");
}

export function oneriReferansiOlustur({ oturumId, isletmeId, urunIdleri, simdi = Date.now(), omurSaniye = VARSAYILAN_OMUR_SANIYE }) {
  const urunler = [...new Set((urunIdleri || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!oturumId || !Number.isSafeInteger(Number(isletmeId)) || !urunler.length) throw hata("Öneri referansı oluşturulamadı.", 500);
  const payload = {
    v: REFERANS_SURUSU,
    typ: REFERANS_TURU,
    sid: String(oturumId),
    tid: Number(isletmeId),
    pids: urunler,
    iat: Math.floor(simdi / 1000),
    exp: Math.floor(simdi / 1000) + Math.max(60, Math.floor(Number(omurSaniye) || VARSAYILAN_OMUR_SANIYE)),
  };
  const govde = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${govde}.${imzala(govde)}`;
}

export function oneriReferansiniDogrula(referans, { isletmeId, urunId, simdi = Date.now() } = {}) {
  const [govde, gelenImza, fazladan] = String(referans || "").split(".");
  if (!govde || !gelenImza || fazladan) throw hata("Öneri referansı geçersiz.");
  const beklenen = Buffer.from(imzala(govde));
  const gelen = Buffer.from(gelenImza);
  if (beklenen.length !== gelen.length || !timingSafeEqual(beklenen, gelen)) throw hata("Öneri referansı doğrulanamadı.", 401);
  let payload;
  try { payload = JSON.parse(Buffer.from(govde, "base64url").toString("utf8")); }
  catch { throw hata("Öneri referansı okunamadı."); }
  if (payload?.v !== REFERANS_SURUSU || payload?.typ !== REFERANS_TURU || !payload.sid || !Array.isArray(payload.pids)) throw hata("Öneri referansı biçimi geçersiz.");
  if (Number(payload.exp) <= Math.floor(simdi / 1000)) throw hata("Öneri referansının süresi dolmuş.", 401, "ONERI_REFERANSI_SURESI_DOLDU");
  if (isletmeId != null && Number(payload.tid) !== Number(isletmeId)) throw hata("Öneri referansı bu işletmeye ait değil.", 403, "ONERI_REFERANSI_ISLETME_UYUSMAZLIGI");
  if (urunId != null && !payload.pids.map(Number).includes(Number(urunId))) throw hata("Ürün bu öneri oturumunda bulunmuyor.", 403, "ONERI_REFERANSI_URUN_UYUSMAZLIGI");
  return payload;
}

export async function oneriAtifTablolariniHazirla(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS oneri_oturumlari (
    id UUID PRIMARY KEY,
    isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
    kullanici_id INTEGER REFERENCES kullanicilar(id) ON DELETE SET NULL,
    kaynak_urun_idleri INTEGER[] NOT NULL DEFAULT '{}',
    onerilen_urun_idleri INTEGER[] NOT NULL,
    son_gecerlilik TIMESTAMPTZ NOT NULL,
    olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS oneri_olaylari (
    id BIGSERIAL PRIMARY KEY,
    isletme_id INTEGER NOT NULL REFERENCES isletmeler(id) ON DELETE CASCADE,
    oturum_id UUID NOT NULL REFERENCES oneri_oturumlari(id) ON DELETE CASCADE,
    urun_id INTEGER NOT NULL,
    olay_turu TEXT NOT NULL CHECK (olay_turu IN ('goruntulendi','tiklandi','sepete_eklendi','satin_alindi')),
    adet INTEGER NOT NULL DEFAULT 1 CHECK (adet BETWEEN 1 AND 30),
    olay_anahtari UUID NOT NULL,
    odeme_id UUID,
    odeme_kalem_no INTEGER,
    olusturma TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (isletme_id, olay_anahtari)
  )`);
  await db.query("CREATE INDEX IF NOT EXISTS oneri_olaylari_rapor_idx ON oneri_olaylari (isletme_id, olay_turu, olusturma)");
  await db.query("CREATE INDEX IF NOT EXISTS oneri_olaylari_tarih_idx ON oneri_olaylari (isletme_id, olusturma DESC, urun_id, oturum_id)");
  await db.query("CREATE INDEX IF NOT EXISTS oneri_oturumlari_sure_idx ON oneri_oturumlari (isletme_id, son_gecerlilik)");
  await db.query("CREATE INDEX IF NOT EXISTS oneri_oturumlari_tarih_idx ON oneri_oturumlari (isletme_id, olusturma DESC)");
  await db.query("CREATE INDEX IF NOT EXISTS oneri_oturumlari_kaynak_idx ON oneri_oturumlari USING GIN (kaynak_urun_idleri)");
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS oneri_satin_alma_tekil_idx
    ON oneri_olaylari (isletme_id, oturum_id, urun_id, odeme_id, odeme_kalem_no)
    WHERE olay_turu='satin_alindi' AND odeme_id IS NOT NULL AND odeme_kalem_no IS NOT NULL`);
}

export async function eskiOneriAtiflariniTemizle(db, saklamaGunu = 760) {
  const gun = Math.min(1460, Math.max(30, Math.floor(Number(saklamaGunu) || 760)));
  const sonuc = await db.query(`DELETE FROM oneri_oturumlari
    WHERE olusturma < NOW()-($1::text || ' days')::interval`, [gun]);
  return Number(sonuc.rowCount || 0);
}

export async function oneriOturumuOlustur(db, { isletmeId, kullaniciId = null, kaynakUrunIdleri = [], onerilenUrunIdleri, omurSaniye = VARSAYILAN_OMUR_SANIYE }) {
  const id = randomUUID();
  const urunler = [...new Set((onerilenUrunIdleri || []).map(Number).filter(Number.isSafeInteger))];
  if (!urunler.length) return null;
  const sonGecerlilik = new Date(Date.now() + Math.max(60, Number(omurSaniye)) * 1000);
  await db.query(`INSERT INTO oneri_oturumlari
    (id,isletme_id,kullanici_id,kaynak_urun_idleri,onerilen_urun_idleri,son_gecerlilik)
    VALUES ($1,$2,$3,$4::int[],$5::int[],$6)`, [id, Number(isletmeId), kullaniciId, kaynakUrunIdleri, urunler, sonGecerlilik]);
  return { id, sonGecerlilik, urunIdleri: urunler };
}

async function aktifOturumuDogrula(db, { isletmeId, oturumId, urunId, sureKontrolu = true }) {
  const sonuc = await db.query(`SELECT id FROM oneri_oturumlari
    WHERE id=$1 AND isletme_id=$2 AND ($4::boolean=false OR son_gecerlilik > NOW()) AND $3 = ANY(onerilen_urun_idleri)`,
  [oturumId, Number(isletmeId), Number(urunId), sureKontrolu]);
  if (!sonuc.rowCount) throw hata("Öneri oturumu geçersiz veya süresi dolmuş.", 401, "ONERI_OTURUMU_GECERSIZ");
}

export async function oneriOlayiKaydet(db, { isletmeId, oturumId, urunId, olayTuru, adet = 1, olayAnahtari = randomUUID(), odemeId = null, odemeKalemNo = null }) {
  if (!OLAYLAR.has(olayTuru)) throw hata("Öneri olayı geçersiz.");
  const guvenliAdet = Math.floor(Number(adet));
  if (!Number.isInteger(guvenliAdet) || guvenliAdet < 1 || guvenliAdet > 30) throw hata("Öneri olay adedi geçersiz.");
  await aktifOturumuDogrula(db, { isletmeId, oturumId, urunId, sureKontrolu: olayTuru !== "satin_alindi" });
  const sonuc = await db.query(`INSERT INTO oneri_olaylari
    (isletme_id,oturum_id,urun_id,olay_turu,adet,olay_anahtari,odeme_id,odeme_kalem_no)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
  [Number(isletmeId), oturumId, Number(urunId), olayTuru, guvenliAdet, olayAnahtari, odemeId, odemeKalemNo]);
  return { kaydedildi: sonuc.rowCount > 0 };
}

export async function oneriAtiflariniDogrula(db, { isletmeId, urunId, adet, referanslar = [], kullanilanAtiflar = new Map() }) {
  if (referanslar != null && !Array.isArray(referanslar)) throw hata("Öneri referansları geçersiz.");
  if ((referanslar || []).length > 5) throw hata("Çok fazla öneri referansı gönderildi.");
  if ((referanslar || []).some((deger) => typeof deger !== "string" || !deger || deger.length > 2048)) throw hata("Öneri referansı geçersiz.");
  const tekil = [...new Set(referanslar || [])];
  const oturumlar = tekil.map((referans) => oneriReferansiniDogrula(referans, { isletmeId, urunId }).sid);
  if (!oturumlar.length) return { oneriAdedi: 0, atiflar: [] };
  const sonuc = await db.query(`SELECT o.id,
      COALESCE(SUM(e.adet) FILTER (WHERE e.olay_turu='sepete_eklendi'),0)::int AS eklenen
    FROM oneri_oturumlari o
    LEFT JOIN oneri_olaylari e ON e.oturum_id=o.id AND e.isletme_id=o.isletme_id AND e.urun_id=$3
    WHERE o.isletme_id=$1 AND o.id=ANY($2::uuid[]) AND o.son_gecerlilik>NOW() AND $3=ANY(o.onerilen_urun_idleri)
    GROUP BY o.id`, [Number(isletmeId), oturumlar, Number(urunId)]);
  if (sonuc.rows.length !== new Set(oturumlar).size) throw hata("Öneri oturumu geçersiz veya süresi dolmuş.", 401, "ONERI_OTURUMU_GECERSIZ");
  let kalan = Math.max(0, Math.floor(Number(adet) || 0));
  const atiflar = [];
  for (const satir of sonuc.rows) {
    const anahtar = `${satir.id}:${Number(urunId)}`;
    const kullanilan = Number(kullanilanAtiflar.get(anahtar) || 0);
    const miktar = Math.min(kalan, Math.max(0, (Number(satir.eklenen) || 0) - kullanilan));
    if (miktar) atiflar.push({ oturumId: satir.id, adet: miktar });
    kullanilanAtiflar.set(anahtar, kullanilan + miktar);
    kalan -= miktar;
  }
  return { oneriAdedi: atiflar.reduce((toplam, atif) => toplam + atif.adet, 0), atiflar };
}
