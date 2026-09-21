import pool from "./db.js";

function isletmeIdZorunlu(isletmeId) {
  const id = Number(isletmeId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("isletmeId zorunlu");
  return id;
}

const sayi = (deger, varsayilan = 0) => {
  const sonuc = Number(deger);
  return Number.isFinite(sonuc) ? sonuc : varsayilan;
};

const yuvarla = (deger, basamak = 2) => Number(sayi(deger).toFixed(basamak));

function siparisDurumu(satir) {
  if (satir.yeni === true) return "yeni";
  if (satir.hazirlaniyor === true) return "hazirlaniyor";
  return "hazir";
}

function masaDurumu(masa) {
  if (sayi(masa.onay_bekleyen) > 0) return "personel_onayi";
  if (sayi(masa.hazirlaniyor) > 0) return "hazirlaniyor";
  if (sayi(masa.yeni) > 0) return "yeni";
  if (sayi(masa.hazir) > 0) return "hazir";
  if (sayi(masa.tahsilat_bekleyen) > 0) return "tahsilat_bekliyor";
  return "acik";
}

function yogunlukSeviyesi(kuyruk, vardiyada) {
  const kapasite = Math.max(2, sayi(vardiyada) * 3);
  if (kuyruk === 0) return "sakin";
  if (kuyruk <= kapasite) return "normal";
  if (kuyruk <= kapasite * 2) return "yogun";
  return "kritik";
}

function aksiyonlariOlustur({ nakit, mutfak, stok, personel }) {
  const aksiyonlar = [];
  if (nakit.onayBekleyen > 0) {
    aksiyonlar.push({
      id: "nakit-onay-bekliyor",
      oncelik: "kritik",
      tur: "nakit_onay",
      baslik: `${nakit.onayBekleyen} nakit sipariş onay bekliyor`,
      aciklama: "Siparişler onaylanmadan mutfak sırasına aktarılmaz.",
      hedef: "/nakit",
    });
  }
  if (nakit.tahsilatBekleyen > 0 && nakit.enEskiBeklemeDakika >= 30) {
    aksiyonlar.push({
      id: "nakit-tahsilat-gecikti",
      oncelik: "yuksek",
      tur: "nakit_tahsilat",
      baslik: `${nakit.tahsilatBekleyen} masada tahsilat bekleniyor`,
      aciklama: `En eski açık hesap ${Math.round(nakit.enEskiBeklemeDakika)} dakikadır bekliyor.`,
      hedef: "/nakit",
    });
  }
  if (mutfak.gecikenSiparis > 0) {
    aksiyonlar.push({
      id: "mutfak-gecikme-riski",
      oncelik: mutfak.gecikenSiparis >= 3 ? "kritik" : "yuksek",
      tur: "mutfak_gecikme",
      baslik: `${mutfak.gecikenSiparis} siparişte gecikme riski var`,
      aciklama: `En uzun bekleme ${Math.round(mutfak.enUzunBeklemeDakika)} dakika.`,
      hedef: "/mutfak",
    });
  }
  if (stok.kritikToplam > 0) {
    aksiyonlar.push({
      id: "kritik-stok",
      oncelik: stok.stoktaYok > 0 ? "kritik" : "orta",
      tur: "stok",
      baslik: `${stok.kritikToplam} stok kalemi kritik seviyede`,
      aciklama: stok.stoktaYok > 0
        ? `${stok.stoktaYok} kalem tamamen tükendi.`
        : "Minimum seviyeye ulaşan stokları kontrol edin.",
      hedef: "/admin/stok",
    });
  }
  if (mutfak.kuyruktakiSiparis > 0 && personel.vardiyada === 0) {
    aksiyonlar.push({
      id: "vardiya-eksik",
      oncelik: "kritik",
      tur: "personel",
      baslik: "Aktif sipariş var ancak açık vardiya yok",
      aciklama: "Mutfak performansının doğru ölçülmesi için vardiyayı kontrol edin.",
      hedef: "/admin/personeller",
    });
  }
  const oncelikSirasi = { kritik: 0, yuksek: 1, orta: 2, dusuk: 3 };
  return aksiyonlar.sort((a, b) => oncelikSirasi[a.oncelik] - oncelikSirasi[b.oncelik]);
}

export function operasyonNabziniOlustur({
  ozet = {},
  mutfakSiparisleri = [],
  hazirlik = {},
  masaSatirlari = [],
  stokSatirlari = [],
  sonSiparisler = [],
  uretimZamani = new Date().toISOString(),
} = {}) {
  const bugunSiparis = sayi(ozet.bugun_siparis);
  const kuyruk = mutfakSiparisleri.filter((siparis) => siparisDurumu(siparis) !== "hazir");
  const gecikmeEsigiDakika = Math.max(15, yuvarla(sayi(hazirlik.ortalama_dakika, 10) * 1.5, 1));
  const enUzunBeklemeDakika = mutfakSiparisleri.reduce(
    (enUzun, siparis) => Math.max(enUzun, sayi(siparis.bekleme_dakika)),
    0,
  );
  const gecikenSiparis = kuyruk.filter((siparis) => sayi(siparis.bekleme_dakika) > gecikmeEsigiDakika).length;

  const nakit = {
    onayBekleyen: masaSatirlari.reduce((toplam, masa) => toplam + sayi(masa.onay_bekleyen), 0),
    tahsilatBekleyen: masaSatirlari.reduce((toplam, masa) => toplam + sayi(masa.tahsilat_bekleyen), 0),
    tahsilatBekleyenTutar: yuvarla(masaSatirlari.reduce((toplam, masa) => toplam + sayi(masa.tahsilat_tutari), 0)),
    enEskiBeklemeDakika: masaSatirlari.reduce((enUzun, masa) => Math.max(enUzun, sayi(masa.nakit_bekleme_dakika)), 0),
  };

  const hammaddeler = stokSatirlari
    .filter((stok) => stok.tur === "hammadde")
    .map((stok) => ({
      id: Number(stok.id), tur: stok.tur, ad: stok.ad, birim: stok.birim,
      mevcut: sayi(stok.mevcut), esik: sayi(stok.esik), durum: sayi(stok.mevcut) <= 0 ? "stokta_yok" : "kritik",
    }));
  const paketliUrunler = stokSatirlari
    .filter((stok) => stok.tur === "paketli_urun")
    .map((stok) => ({
      id: Number(stok.id), tur: stok.tur, ad: stok.ad, birim: "adet",
      mevcut: sayi(stok.mevcut), esik: sayi(stok.esik), durum: sayi(stok.mevcut) <= 0 ? "stokta_yok" : "kritik",
    }));
  const tumKritikStoklar = [...hammaddeler, ...paketliUrunler];
  const stok = {
    kritikToplam: tumKritikStoklar.length,
    stoktaYok: tumKritikStoklar.filter((kalem) => kalem.durum === "stokta_yok").length,
    hammaddeler,
    paketliUrunler,
  };

  const personel = {
    toplam: sayi(ozet.toplam_personel),
    vardiyada: sayi(ozet.vardiyada),
  };
  const mutfak = {
    kuyruktakiSiparis: kuyruk.length,
    yeniSiparis: mutfakSiparisleri.filter((siparis) => siparisDurumu(siparis) === "yeni").length,
    hazirlananSiparis: mutfakSiparisleri.filter((siparis) => siparisDurumu(siparis) === "hazirlaniyor").length,
    hazirSiparis: mutfakSiparisleri.filter((siparis) => siparisDurumu(siparis) === "hazir").length,
    kuyruktakiUrun: kuyruk.reduce((toplam, siparis) => toplam + sayi(siparis.urun_adedi), 0),
    ortalamaHazirlamaDakika: hazirlik.ortalama_dakika == null ? null : sayi(hazirlik.ortalama_dakika),
    enUzunBeklemeDakika: yuvarla(enUzunBeklemeDakika, 1),
    gecikmeEsigiDakika,
    gecikenSiparis,
    yogunluk: yogunlukSeviyesi(kuyruk.length, personel.vardiyada),
  };

  const masalar = masaSatirlari.map((masa) => ({
    masaNo: String(masa.masa_no),
    tip: String(masa.masa_no) === "algotur" ? "gel_al" : "masa",
    durum: masaDurumu(masa),
    nakitAcik: masa.nakit_acik === true,
    oturumId: masa.oturum_id == null ? null : Number(masa.oturum_id),
    acilis: masa.oturum_acilis || masa.nakit_acilis || null,
    siparisSayisi: sayi(masa.siparis_sayisi),
    urunAdedi: sayi(masa.urun_adedi),
    toplam: yuvarla(sayi(masa.oturum_toplami) + sayi(masa.onay_bekleyen_tutari)),
    onayBekleyen: sayi(masa.onay_bekleyen),
    tahsilatBekleyen: sayi(masa.tahsilat_bekleyen),
    beklemeDakika: yuvarla(Math.max(sayi(masa.siparis_bekleme_dakika), sayi(masa.nakit_bekleme_dakika)), 1),
  }));

  const sonuc = {
    uretimZamani,
    metrikler: {
      bugunSiparis,
      bugunSiparisTutari: yuvarla(ozet.bugun_siparis_tutari),
      bugunTahsilat: yuvarla(ozet.bugun_tahsilat),
      ortalamaSepet: bugunSiparis > 0 ? yuvarla(sayi(ozet.bugun_siparis_tutari) / bugunSiparis) : 0,
      aktifMasa: masalar.filter((masa) => masa.tip === "masa").length,
      mutfakKuyrugu: mutfak.kuyruktakiSiparis,
      ortalamaHazirlamaDakika: mutfak.ortalamaHazirlamaDakika,
      tahsilatBekleyenTutar: nakit.tahsilatBekleyenTutar,
      kritikStok: stok.kritikToplam,
    },
    mutfak,
    nakit,
    personel,
    masalar,
    stok,
    sonSiparisler: sonSiparisler.map((siparis) => ({
      siparisNo: siparis.siparis_no,
      masaNo: siparis.masa_no,
      durum: siparisDurumu(siparis),
      kisiAdi: siparis.kisi_adi || "Misafir",
      urunAdedi: sayi(siparis.urun_adedi),
      tutar: yuvarla(siparis.tutar),
      olusturma: siparis.olusturma,
    })),
  };
  sonuc.aksiyonlar = aksiyonlariOlustur(sonuc);
  return sonuc;
}

export async function operasyonNabziniGetir(isletmeId, veritabani = pool) {
  const tenantId = isletmeIdZorunlu(isletmeId);
  const [ozetSonucu, mutfakSonucu, hazirlikSonucu, masaSonucu, stokSonucu, sonSiparisSonucu] = await Promise.all([
    veritabani.query(`
      WITH bugun_siparisler AS (
        SELECT COALESCE(siparis_no,id::text) siparis_no,SUM(fiyat*adet) tutar
        FROM siparis_kalemleri
        WHERE isletme_id=$1 AND olusturma>=date_trunc('day',NOW())
        GROUP BY 1
      )
      SELECT
        COALESCE((SELECT SUM(tutar) FROM bugun_siparisler),0) bugun_siparis_tutari,
        (SELECT COUNT(*) FROM bugun_siparisler)::int bugun_siparis,
        COALESCE((SELECT SUM(tutar) FROM odeme_islemleri
          WHERE isletme_id=$1 AND durum='basarili' AND basarili_at>=date_trunc('day',NOW())),0) bugun_tahsilat,
        (SELECT COUNT(*) FROM personeller WHERE isletme_id=$1 AND aktif=true AND arsivli=false)::int toplam_personel,
        (SELECT COUNT(*) FROM vardiyalar WHERE isletme_id=$1 AND cikis IS NULL)::int vardiyada
    `, [tenantId]),
    veritabani.query(`
      SELECT COALESCE(k.siparis_no,'oturum-'||k.oturum_id::text) siparis_no,o.masa_no,
        MIN(k.olusturma) olusturma,SUM(k.adet)::int urun_adedi,SUM(k.fiyat*k.adet) tutar,
        BOOL_OR(k.durum='yeni') yeni,BOOL_OR(k.durum='hazirlaniyor') hazirlaniyor,
        ROUND(EXTRACT(EPOCH FROM (NOW()-MIN(k.olusturma)))/60.0,1) bekleme_dakika
      FROM siparis_kalemleri k
      JOIN oturumlar o ON o.id=k.oturum_id AND o.isletme_id=k.isletme_id
      WHERE k.isletme_id=$1 AND o.durum='acik' AND k.durum IN ('yeni','hazirlaniyor','hazir')
      GROUP BY COALESCE(k.siparis_no,'oturum-'||k.oturum_id::text),o.masa_no
      ORDER BY MIN(k.olusturma)
    `, [tenantId]),
    veritabani.query(`
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (hazir_at-hazirlamaya_baslandi))/60.0),1) ortalama_dakika
      FROM siparis_kalemleri
      WHERE isletme_id=$1 AND hazir_at IS NOT NULL AND hazirlamaya_baslandi IS NOT NULL
        AND olusturma>=NOW()-INTERVAL '30 days'
    `, [tenantId]),
    veritabani.query(`
      WITH masa_kaynak AS (
        SELECT masa_no FROM oturumlar WHERE isletme_id=$1 AND durum='acik'
        UNION SELECT masa_no FROM nakit_masalari WHERE isletme_id=$1 AND aktif=true
        UNION SELECT masa_no FROM odeme_islemleri
          WHERE isletme_id=$1 AND saglayici='nakit' AND durum IN ('personel_onayi','nakit_bekliyor')
      )
      SELECT m.masa_no,n.aktif nakit_acik,n.acilis nakit_acilis,o.id oturum_id,o.olusturma oturum_acilis,
        COALESCE(k.siparis_sayisi,0)::int siparis_sayisi,COALESCE(k.urun_adedi,0)::int urun_adedi,
        COALESCE(k.oturum_toplami,0) oturum_toplami,COALESCE(k.yeni,0)::int yeni,
        COALESCE(k.hazirlaniyor,0)::int hazirlaniyor,COALESCE(k.hazir,0)::int hazir,
        COALESCE(k.bekleme_dakika,0) siparis_bekleme_dakika,
        COALESCE(p.onay_bekleyen,0)::int onay_bekleyen,
        COALESCE(p.tahsilat_bekleyen,0)::int tahsilat_bekleyen,
        COALESCE(p.onay_bekleyen_tutari,0) onay_bekleyen_tutari,
        COALESCE(p.tahsilat_tutari,0) tahsilat_tutari,
        COALESCE(p.bekleme_dakika,0) nakit_bekleme_dakika
      FROM masa_kaynak m
      LEFT JOIN nakit_masalari n ON n.isletme_id=$1 AND n.masa_no=m.masa_no
      LEFT JOIN oturumlar o ON o.isletme_id=$1 AND o.masa_no=m.masa_no AND o.durum='acik'
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT COALESCE(siparis_no,id::text)) siparis_sayisi,SUM(adet) urun_adedi,
          SUM(fiyat*adet) oturum_toplami,COUNT(*) FILTER (WHERE durum='yeni') yeni,
          COUNT(*) FILTER (WHERE durum='hazirlaniyor') hazirlaniyor,COUNT(*) FILTER (WHERE durum='hazir') hazir,
          ROUND(EXTRACT(EPOCH FROM (NOW()-MIN(olusturma)))/60.0,1) bekleme_dakika
        FROM siparis_kalemleri WHERE isletme_id=$1 AND oturum_id=o.id
      ) k ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE durum='personel_onayi') onay_bekleyen,
          COUNT(*) FILTER (WHERE durum='nakit_bekliyor') tahsilat_bekleyen,
          COALESCE(SUM(tutar) FILTER (WHERE durum='personel_onayi'),0) onay_bekleyen_tutari,
          COALESCE(SUM(tutar) FILTER (WHERE durum='nakit_bekliyor'),0) tahsilat_tutari,
          ROUND(EXTRACT(EPOCH FROM (NOW()-MIN(olusturma)))/60.0,1) bekleme_dakika
        FROM odeme_islemleri WHERE isletme_id=$1 AND masa_no=m.masa_no AND saglayici='nakit'
          AND durum IN ('personel_onayi','nakit_bekliyor')
      ) p ON true
      ORDER BY m.masa_no COLLATE "C"
    `, [tenantId]),
    veritabani.query(`
      SELECT 'hammadde' tur,id,ad,birim,stok_miktari mevcut,minimum_stok esik
      FROM recete_hammaddeler
      WHERE isletme_id=$1 AND aktif=true AND stok_miktari<=minimum_stok
      UNION ALL
      SELECT 'paketli_urun' tur,id,ad,'adet' birim,stok_adedi mevcut,5 esik
      FROM urunler
      WHERE isletme_id=$1 AND aktif=true AND arsivli=false AND stok_takibi=true AND stok_adedi<=5
      ORDER BY mevcut ASC,ad ASC LIMIT 20
    `, [tenantId]),
    veritabani.query(`
      SELECT COALESCE(k.siparis_no,'oturum-'||k.oturum_id::text) siparis_no,o.masa_no,
        MIN(k.kisi_adi) kisi_adi,MIN(k.olusturma) olusturma,SUM(k.adet)::int urun_adedi,
        SUM(k.fiyat*k.adet) tutar,BOOL_OR(k.durum='yeni') yeni,BOOL_OR(k.durum='hazirlaniyor') hazirlaniyor
      FROM siparis_kalemleri k
      JOIN oturumlar o ON o.id=k.oturum_id AND o.isletme_id=k.isletme_id
      WHERE k.isletme_id=$1 AND k.olusturma>=date_trunc('day',NOW())
      GROUP BY COALESCE(k.siparis_no,'oturum-'||k.oturum_id::text),o.masa_no
      ORDER BY MIN(k.olusturma) DESC LIMIT 12
    `, [tenantId]),
  ]);

  return operasyonNabziniOlustur({
    ozet: ozetSonucu.rows[0] || {},
    mutfakSiparisleri: mutfakSonucu.rows,
    hazirlik: hazirlikSonucu.rows[0] || {},
    masaSatirlari: masaSonucu.rows,
    stokSatirlari: stokSonucu.rows,
    sonSiparisler: sonSiparisSonucu.rows,
  });
}
