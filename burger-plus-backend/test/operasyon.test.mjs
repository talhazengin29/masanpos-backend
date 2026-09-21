import test from "node:test";
import assert from "node:assert/strict";
import { operasyonNabziniGetir, operasyonNabziniOlustur } from "../operasyonDb.js";

const temelVeri = {
  ozet: {
    bugun_siparis: "4",
    bugun_siparis_tutari: "1200",
    bugun_tahsilat: "900",
    toplam_personel: "5",
    vardiyada: "1",
  },
  hazirlik: { ortalama_dakika: "10" },
  uretimZamani: "2026-09-21T12:00:00.000Z",
};

test("operasyon nabzi metrikleri sayisal ve arayuze hazir doner", () => {
  const sonuc = operasyonNabziniOlustur({
    ...temelVeri,
    mutfakSiparisleri: [
      { siparis_no: "S-1", yeni: true, hazirlaniyor: false, urun_adedi: "2", bekleme_dakika: "4" },
      { siparis_no: "S-2", yeni: false, hazirlaniyor: true, urun_adedi: "3", bekleme_dakika: "18" },
      { siparis_no: "S-3", yeni: false, hazirlaniyor: false, urun_adedi: "1", bekleme_dakika: "2" },
    ],
  });

  assert.deepEqual(sonuc.metrikler, {
    bugunSiparis: 4,
    bugunSiparisTutari: 1200,
    bugunTahsilat: 900,
    ortalamaSepet: 300,
    aktifMasa: 0,
    mutfakKuyrugu: 2,
    ortalamaHazirlamaDakika: 10,
    tahsilatBekleyenTutar: 0,
    kritikStok: 0,
  });
  assert.equal(sonuc.mutfak.yogunluk, "normal");
  assert.equal(sonuc.mutfak.gecikmeEsigiDakika, 15);
  assert.equal(sonuc.mutfak.gecikenSiparis, 1);
  assert.equal(sonuc.mutfak.kuyruktakiUrun, 5);
});

test("masa durumu en acil operasyon adimina gore belirlenir", () => {
  const sonuc = operasyonNabziniOlustur({
    ...temelVeri,
    masaSatirlari: [
      { masa_no: "2", nakit_acik: true, onay_bekleyen: "1", tahsilat_bekleyen: "0", onay_bekleyen_tutari: "250" },
      { masa_no: "4", nakit_acik: true, onay_bekleyen: "0", tahsilat_bekleyen: "1", tahsilat_tutari: "500", nakit_bekleme_dakika: "42" },
      { masa_no: "6", nakit_acik: true, hazirlaniyor: "2", siparis_sayisi: "1", urun_adedi: "2", oturum_toplami: "390" },
    ],
  });

  assert.deepEqual(sonuc.masalar.map(({ masaNo, durum, toplam }) => ({ masaNo, durum, toplam })), [
    { masaNo: "2", durum: "personel_onayi", toplam: 250 },
    { masaNo: "4", durum: "tahsilat_bekliyor", toplam: 0 },
    { masaNo: "6", durum: "hazirlaniyor", toplam: 390 },
  ]);
  assert.equal(sonuc.nakit.tahsilatBekleyenTutar, 500);
  assert.equal(sonuc.aksiyonlar[0].id, "nakit-onay-bekliyor");
  assert.ok(sonuc.aksiyonlar.some((aksiyon) => aksiyon.id === "nakit-tahsilat-gecikti"));
});

test("kritik hammaddeler ve paketli urunler tek stok ozetinde birlesir", () => {
  const sonuc = operasyonNabziniOlustur({
    ...temelVeri,
    stokSatirlari: [
      { tur: "hammadde", id: "7", ad: "Patates", birim: "gr", mevcut: "0", esik: "2000" },
      { tur: "paketli_urun", id: "9", ad: "Kola", mevcut: "3", esik: "5" },
    ],
  });

  assert.equal(sonuc.stok.kritikToplam, 2);
  assert.equal(sonuc.stok.stoktaYok, 1);
  assert.equal(sonuc.stok.hammaddeler[0].durum, "stokta_yok");
  assert.equal(sonuc.stok.paketliUrunler[0].mevcut, 3);
  assert.ok(sonuc.aksiyonlar.some((aksiyon) => aksiyon.id === "kritik-stok"));
});

test("benzer gunlerden 30 dakikalik operasyon ve vardiya ongorusu uretir", () => {
  const sonuc = operasyonNabziniOlustur({
    ...temelVeri,
    mutfakSiparisleri: [
      { siparis_no: "S-1", yeni: true, urun_adedi: "2", bekleme_dakika: "3" },
    ],
    tahmin: {
      ornek_gun: "6",
      aktif_gun: "5",
      simdiye_kadar_ciro: "900",
      gelecek_siparis: "6.5",
      gelecek_ciro: "1450",
      kalan_ciro: "1800",
    },
  });

  assert.equal(sonuc.ongoru.hazir, true);
  assert.equal(sonuc.ongoru.beklenenSiparis, 6.5);
  assert.equal(sonuc.ongoru.gunSonuCiroTahmini, 3000);
  assert.equal(sonuc.ongoru.tempoDegisimiYuzde, 33);
  assert.deepEqual(sonuc.ongoru.personel, { mevcut: 1, onerilen: 3, ekIhtiyac: 2 });
  assert.ok(sonuc.aksiyonlar.some((aksiyon) => aksiyon.id === "vardiya-ongorusu"));
});

test("yetersiz gecmis veri kesin tahmin gibi sunulmaz", () => {
  const sonuc = operasyonNabziniOlustur({
    ...temelVeri,
    tahmin: { ornek_gun: "6", aktif_gun: "1", gelecek_siparis: "4" },
  });

  assert.equal(sonuc.ongoru.hazir, false);
  assert.equal(sonuc.ongoru.risk, "belirsiz");
  assert.equal(sonuc.ongoru.baslik, "Tahmin için veri birikiyor");
  assert.ok(!sonuc.aksiyonlar.some((aksiyon) => aksiyon.id === "vardiya-ongorusu"));
});

test("yonetici ozeti kritik operasyonu tek metinde aciklar", () => {
  const sonuc = operasyonNabziniOlustur({
    ...temelVeri,
    mutfakSiparisleri: [
      { siparis_no: "S-9", yeni: false, hazirlaniyor: true, urun_adedi: "3", bekleme_dakika: "22" },
    ],
    masaSatirlari: [
      { masa_no: "4", nakit_acik: true, onay_bekleyen: "1", tahsilat_bekleyen: "1", tahsilat_tutari: "480" },
    ],
    stokSatirlari: [
      { tur: "paketli_urun", id: "9", ad: "Kola", mevcut: "0", esik: "5" },
    ],
  });

  assert.equal(sonuc.yoneticiOzeti.durum, "kritik");
  assert.match(sonuc.yoneticiOzeti.metin, /1 sipariş gecikme eşiğini aştı/);
  assert.match(sonuc.yoneticiOzeti.metin, /1 nakit sipariş onay/);
  assert.match(sonuc.yoneticiOzeti.metin, /1 kalem tükendi/);
});

test("nakit siparisten mutfaga uzanan demo senaryosu Pulse durumlarina yansir", () => {
  const masaAcik = operasyonNabziniOlustur({
    ...temelVeri,
    masaSatirlari: [{ masa_no: "2", nakit_acik: true }],
  });
  const onayBekliyor = operasyonNabziniOlustur({
    ...temelVeri,
    masaSatirlari: [{ masa_no: "2", nakit_acik: true, onay_bekleyen: "1", onay_bekleyen_tutari: "320" }],
  });
  const mutfakta = operasyonNabziniOlustur({
    ...temelVeri,
    mutfakSiparisleri: [{ siparis_no: "BP-2", yeni: true, urun_adedi: "2", bekleme_dakika: "1" }],
    masaSatirlari: [{ masa_no: "2", nakit_acik: true, yeni: "2", siparis_sayisi: "1", urun_adedi: "2", oturum_toplami: "320" }],
  });
  const hazir = operasyonNabziniOlustur({
    ...temelVeri,
    mutfakSiparisleri: [{ siparis_no: "BP-2", yeni: false, hazirlaniyor: false, urun_adedi: "2", bekleme_dakika: "9" }],
    masaSatirlari: [{ masa_no: "2", nakit_acik: true, hazir: "2", siparis_sayisi: "1", urun_adedi: "2", oturum_toplami: "320", tahsilat_bekleyen: "1", tahsilat_tutari: "320" }],
  });

  assert.equal(masaAcik.masalar[0].durum, "acik");
  assert.equal(onayBekliyor.masalar[0].durum, "personel_onayi");
  assert.equal(mutfakta.masalar[0].durum, "yeni");
  assert.equal(mutfakta.mutfak.kuyruktakiSiparis, 1);
  assert.equal(hazir.masalar[0].durum, "hazir");
  assert.equal(hazir.nakit.tahsilatBekleyenTutar, 320);
});

test("operasyon sorgularinin tamami ayni isletme kapsaminda calisir", async () => {
  const sonuclar = [
    { rows: [{ bugun_siparis: "0", bugun_siparis_tutari: "0", bugun_tahsilat: "0", toplam_personel: "0", vardiyada: "0" }] },
    { rows: [] },
    { rows: [{ ortalama_dakika: null }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [{ ornek_gun: "6", aktif_gun: "0" }] },
  ];
  const cagrilar = [];
  const veritabani = {
    query: async (sql, parametreler) => {
      cagrilar.push({ sql, parametreler });
      return sonuclar[cagrilar.length - 1];
    },
  };

  const sonuc = await operasyonNabziniGetir(42, veritabani);

  assert.equal(cagrilar.length, 7);
  assert.ok(cagrilar.every(({ parametreler }) => parametreler.length === 1 && parametreler[0] === 42));
  assert.ok(cagrilar.every(({ sql }) => sql.includes("isletme_id=$1")));
  assert.equal(sonuc.metrikler.bugunSiparis, 0);
  assert.deepEqual(sonuc.masalar, []);
});
