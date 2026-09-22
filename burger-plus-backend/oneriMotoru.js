const sayi = (deger, varsayilan = 0) => {
  const sonuc = Number(deger);
  return Number.isFinite(sonuc) ? sonuc : varsayilan;
};

const pozitifIdler = (degerler) => [...new Set((Array.isArray(degerler) ? degerler : [])
  .map(Number)
  .filter((id) => Number.isInteger(id) && id > 0))];

export function oneriAdediniSinirla(oneriAdedi, toplamAdet) {
  const guvenliToplam = Math.max(1, Math.floor(sayi(toplamAdet, 1)));
  const guvenliOneri = Math.max(0, Math.floor(sayi(oneriAdedi)));
  return Math.min(guvenliOneri, guvenliToplam);
}

function tamamlayiciPuani(sepetTipleri, adayTipi) {
  if (sepetTipleri.has("burger") && ["yan_lezzet", "icecek", "menu"].includes(adayTipi)) return 60;
  if (sepetTipleri.has("yan_lezzet") && adayTipi === "icecek") return 45;
  if (sepetTipleri.has("icecek") && adayTipi === "yan_lezzet") return 30;
  return 0;
}

export function otomatikOnerileriSirala({
  urunler = [],
  sepetUrunIdleri = [],
  istatistikler = [],
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
      const skor = (birlikteVerisiGuvenilir ? 2_000 + istatistik.birlikteSiparis * 100 + guvenYuzde * 4 : 0)
        + (manuelSira == null ? 0 : 400 - manuelSira * 10)
        + tamamlayici
        + Math.min(100, istatistik.toplamSiparis) * 0.4;
      const oneriNedeni = birlikteVerisiGuvenilir
        ? "birlikte_aliniyor"
        : manuelSira != null ? "isletme_secimi" : "populer";
      return {
        ...urun,
        oneriNedeni,
        oneriGuveni: birlikteVerisiGuvenilir ? guvenYuzde : null,
        birlikteSiparis: birlikteVerisiGuvenilir ? istatistik.birlikteSiparis : 0,
        oneriSkoru: skor,
      };
    })
    .filter((urun) => urun.oneriSkoru > 0)
    .sort((a, b) => b.oneriSkoru - a.oneriSkoru || Number(a.sira || 100) - Number(b.sira || 100) || Number(a.id) - Number(b.id))
    .slice(0, Math.max(1, Math.min(6, Math.floor(sayi(limit, 3)))))
    .map(({ oneriSkoru, ...urun }) => urun);
}
