const sayi = (deger, varsayilan = 0) => {
  const sonuc = Number(deger);
  return Number.isFinite(sonuc) ? sonuc : varsayilan;
};

const pozitifIdler = (degerler) => [...new Set((Array.isArray(degerler) ? degerler : [])
  .map(Number)
  .filter((id) => Number.isInteger(id) && id > 0))];

function tamamlayiciPuani(sepetTipleri, adayTipi) {
  if (sepetTipleri.has("burger") && ["yan_lezzet", "icecek", "menu"].includes(adayTipi)) return 60;
  if (sepetTipleri.has("yan_lezzet") && adayTipi === "icecek") return 45;
  if (sepetTipleri.has("icecek") && adayTipi === "yan_lezzet") return 30;
  return 0;
}

export function oneriPerformansPuani({ goruntulenme = 0, tiklama = 0, sepeteEkleme = 0, satinAlma = 0 } = {}) {
  const gosterim = Math.max(0, Math.floor(sayi(goruntulenme)));
  if (gosterim < 12) return { puan: 0, guvenilir: false, donusumYuzde: null };
  const tik = Math.min(gosterim, Math.max(0, Math.floor(sayi(tiklama))));
  const sepet = Math.min(gosterim, Math.max(0, Math.floor(sayi(sepeteEkleme))));
  const satis = Math.min(gosterim, Math.max(0, Math.floor(sayi(satinAlma))));
  // Bayes yumuşatması düşük örneklemde tesadüfi %100 dönüşümün sıralamayı ele
  // geçirmesini önler. Etki 50 gösterime kadar kademeli açılır ve 320 puanda kesilir.
  const guvenKatsayisi = Math.min(1, (gosterim - 8) / 42);
  const tiklamaOrani = (tik + 2) / (gosterim + 10);
  const sepetOrani = (sepet + 1) / (gosterim + 16);
  const donusumOrani = (satis + 1) / (gosterim + 24);
  const hamPuan = (tiklamaOrani * 70) + (sepetOrani * 150) + (donusumOrani * 500);
  const verimsizlikCezasi = gosterim >= 40 && satis === 0 ? Math.min(90, (gosterim - 30) * 1.5) : 0;
  return {
    puan: Math.max(-90, Math.min(320, hamPuan * guvenKatsayisi - verimsizlikCezasi)),
    guvenilir: true,
    donusumYuzde: Math.round((satis / gosterim) * 1000) / 10,
  };
}

export function otomatikOnerileriSirala({
  urunler = [],
  sepetUrunIdleri = [],
  istatistikler = [],
  performanslar = [],
  manuelOneriIdleri = [],
  limit = 3,
} = {}) {
  const sepetIdleri = new Set(pozitifIdler(sepetUrunIdleri));
  const manuelSirasi = new Map(pozitifIdler(manuelOneriIdleri).map((id, index) => [id, index]));
  const urunHaritasi = new Map(urunler.map((urun) => [Number(urun.id), urun]));
  const sepetTipleri = new Set([...sepetIdleri]
    .map((id) => urunHaritasi.get(id)?.urunTipi)
    .filter(Boolean));
  const istatistikHaritasi = new Map(istatistikler.map((satir) => [Number(satir.urun_id ?? satir.urunId), {
    birlikteSiparis: sayi(satir.birlikte_siparis ?? satir.birlikteSiparis),
    toplamSiparis: sayi(satir.toplam_siparis ?? satir.toplamSiparis),
    sepetSiparisi: sayi(satir.sepet_siparisi ?? satir.sepetSiparisi),
  }]));
  const performansHaritasi = new Map(performanslar.map((satir) => [Number(satir.urun_id ?? satir.urunId), {
    goruntulenme: sayi(satir.goruntulenme),
    tiklama: sayi(satir.tiklama),
    sepeteEkleme: sayi(satir.sepete_ekleme ?? satir.sepeteEkleme),
    satinAlma: sayi(satir.satin_alma ?? satir.satinAlma),
  }]));

  return urunler
    .filter((urun) => urun?.aktif !== false && urun?.stokta !== false && !sepetIdleri.has(Number(urun.id)))
    .map((urun) => {
      const id = Number(urun.id);
      const istatistik = istatistikHaritasi.get(id) || { birlikteSiparis: 0, toplamSiparis: 0, sepetSiparisi: 0 };
      const guvenYuzde = istatistik.sepetSiparisi > 0
        ? Math.min(100, Math.round((istatistik.birlikteSiparis / istatistik.sepetSiparisi) * 100))
        : 0;
      const birlikteVerisiGuvenilir = istatistik.sepetSiparisi >= 3 && istatistik.birlikteSiparis >= 2;
      const manuelSira = manuelSirasi.get(id);
      const tamamlayici = tamamlayiciPuani(sepetTipleri, urun.urunTipi);
      const performans = oneriPerformansPuani(performansHaritasi.get(id));
      const skor = (birlikteVerisiGuvenilir ? 2_000 + istatistik.birlikteSiparis * 100 + guvenYuzde * 4 : 0)
        + (manuelSira == null ? 0 : 400 - manuelSira * 10)
        + tamamlayici
        + Math.min(100, istatistik.toplamSiparis) * 0.4
        + performans.puan;
      const oneriNedeni = birlikteVerisiGuvenilir
        ? "birlikte_aliniyor"
        : manuelSira != null ? "isletme_secimi" : performans.guvenilir ? "iyi_donusum" : "populer";
      return {
        ...urun,
        oneriNedeni,
        oneriGuveni: birlikteVerisiGuvenilir ? guvenYuzde : null,
        birlikteSiparis: birlikteVerisiGuvenilir ? istatistik.birlikteSiparis : 0,
        oneriDonusumu: performans.donusumYuzde,
        oneriSkoru: skor,
      };
    })
    .filter((urun) => urun.oneriSkoru > 0)
    .sort((a, b) => b.oneriSkoru - a.oneriSkoru || Number(a.sira || 100) - Number(b.sira || 100) || Number(a.id) - Number(b.id))
    .slice(0, Math.max(1, Math.min(6, Math.floor(sayi(limit, 3)))))
    .map(({ oneriSkoru, ...urun }) => urun);
}
