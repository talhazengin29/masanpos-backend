const sayi = (deger) => {
  const sonuc = Number(deger);
  return Number.isFinite(sonuc) ? sonuc : 0;
};

function sessizSaatAraligiBul(saatlik = []) {
  const harita = new Map(saatlik
    .map((satir) => [Math.floor(sayi(satir.saat)), Math.max(0, sayi(satir.siparis))])
    .filter(([saat]) => saat >= 0 && saat <= 23));
  const aktifSaatler = [...harita.entries()].filter(([, adet]) => adet > 0).map(([saat]) => saat);
  if (aktifSaatler.length < 4) return { baslangicSaat: 14, bitisSaat: 17, veriyleBelirlendi: false };

  const ilkSaat = Math.max(8, Math.min(...aktifSaatler));
  const sonSaat = Math.min(24, Math.max(...aktifSaatler) + 1);
  const adaylar = [];
  for (let baslangic = ilkSaat; baslangic + 3 <= sonSaat; baslangic += 1) {
    const siparis = [0, 1, 2].reduce((toplam, fark) => toplam + (harita.get(baslangic + fark) || 0), 0);
    adaylar.push({ baslangicSaat: baslangic, bitisSaat: baslangic + 3, siparis });
  }
  if (!adaylar.length) return { baslangicSaat: 14, bitisSaat: 17, veriyleBelirlendi: false };
  adaylar.sort((a, b) => a.siparis - b.siparis || Math.abs(a.baslangicSaat - 14) - Math.abs(b.baslangicSaat - 14));
  return { ...adaylar[0], veriyleBelirlendi: true };
}

export function kampanyaTaslagiOlustur({ kategoriIstatistikleri = [], saatlik = [], gun = 30 } = {}) {
  const kategoriler = kategoriIstatistikleri
    .map((satir) => ({
      kategori: String(satir.kategori || "").trim(),
      aktifUrun: sayi(satir.aktif_urun ?? satir.aktifUrun),
      adet: sayi(satir.adet),
      ciro: sayi(satir.ciro),
      oneriAdedi: sayi(satir.oneri_adedi ?? satir.oneriAdedi),
      oneriCirosu: sayi(satir.oneri_cirosu ?? satir.oneriCirosu),
      tamamlayiciAdet: sayi(satir.tamamlayici_adet ?? satir.tamamlayiciAdet),
    }))
    .filter((satir) => satir.kategori && satir.aktifUrun > 0);
  if (!kategoriler.length) {
    const hata = new Error("Kampanya taslağı için aktif bir ürün kategorisi bulunamadı.");
    hata.status = 409;
    throw hata;
  }

  const oneriAdaylari = kategoriler.filter((satir) => satir.oneriAdedi > 0)
    .sort((a, b) => b.oneriCirosu - a.oneriCirosu || b.oneriAdedi - a.oneriAdedi);
  const tamamlayiciAdaylari = kategoriler.filter((satir) => satir.tamamlayiciAdet > 0)
    .sort((a, b) => b.tamamlayiciAdet - a.tamamlayiciAdet || b.ciro - a.ciro);
  const katalogAdaylari = [...kategoriler]
    .sort((a, b) => b.adet - a.adet || b.aktifUrun - a.aktifUrun || a.kategori.localeCompare(b.kategori, "tr"));
  const secilen = oneriAdaylari[0] || tamamlayiciAdaylari[0] || katalogAdaylari[0];
  const strateji = oneriAdaylari.length ? "oneri_performansi" : tamamlayiciAdaylari.length ? "tamamlayici_satis" : "katalog";
  const saat = sessizSaatAraligiBul(saatlik);
  const kategoriKucuk = secilen.kategori.toLocaleLowerCase("tr-TR");

  return {
    taslak: {
      etiket: "SEPETE ÖZEL",
      baslik: `${secilen.kategori} ile Siparişini Tamamla`,
      aciklama: `Sepetine ${kategoriKucuk} ekle, seçili saatlerde %10 avantaj yakala.`,
      buton: "Menüyü İncele",
      butonTipi: "primary",
      gorsel: "",
      ikon: "🎯",
      aktif: false,
      baslangicSaat: saat.baslangicSaat,
      bitisSaat: saat.bitisSaat,
      indirimYuzde: 10,
      gecerliKategoriler: [secilen.kategori],
      kampanyaTipi: "saatli",
      sira: 10,
    },
    analiz: {
      strateji,
      kategori: secilen.kategori,
      gun: Math.max(1, Math.floor(sayi(gun) || 30)),
      oneriAdedi: secilen.oneriAdedi,
      oneriCirosu: secilen.oneriCirosu,
      toplamAdet: secilen.adet,
      baslangicSaat: saat.baslangicSaat,
      bitisSaat: saat.bitisSaat,
      saatVerisiyleBelirlendi: saat.veriyleBelirlendi,
      veriSeviyesi: secilen.oneriAdedi >= 5 ? "guclu" : secilen.oneriAdedi > 0 ? "erken" : "baslangic",
    },
  };
}
