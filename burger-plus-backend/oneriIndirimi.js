export const ONERI_INDIRIM_AYARI_ANAHTARI = "oneri_indirimi_v1";

export const VARSAYILAN_ONERI_INDIRIM_AYARI = Object.freeze({
  aktif: false,
  indirimYuzde: 10,
});

const paraYuvarla = (deger) => Math.round(Number(deger) * 100) / 100;

export function oneriIndirimAyariniDonustur(deger = {}) {
  const oran = Number(deger?.indirimYuzde);
  return {
    aktif: deger?.aktif === true,
    indirimYuzde: Number.isFinite(oran) && oran >= 1 && oran <= 50
      ? Math.round(oran * 10) / 10
      : VARSAYILAN_ONERI_INDIRIM_AYARI.indirimYuzde,
  };
}

export function oneriIndirimAyariniDogrula(deger = {}) {
  const oran = Number(deger?.indirimYuzde);
  if (!Number.isFinite(oran) || oran < 1 || oran > 50) {
    const hata = new Error("Sepete özel öneri indirimi %1-%50 arasında olmalıdır.");
    hata.status = 400;
    throw hata;
  }
  return { aktif: deger?.aktif === true, indirimYuzde: Math.round(oran * 10) / 10 };
}

export function indirimliFiyatHesapla(fiyat, indirimYuzde) {
  const temelFiyat = Number(fiyat);
  const oran = Number(indirimYuzde);
  if (!Number.isFinite(temelFiyat) || temelFiyat < 0) throw new Error("Ürün fiyatı geçersiz.");
  if (!Number.isFinite(oran) || oran <= 0) return paraYuvarla(temelFiyat);
  return paraYuvarla(temelFiyat * (1 - Math.min(90, oran) / 100));
}

export function dogrulanmisOneriIndirimYuzdesi({ indirimYuzde, oneriAdedi, toplamAdet }) {
  const oran = Number(indirimYuzde);
  const oneriMiktari = Math.floor(Number(oneriAdedi));
  const toplamMiktar = Math.floor(Number(toplamAdet));
  if (!Number.isFinite(oran) || oran <= 0 || toplamMiktar < 1 || oneriMiktari !== toplamMiktar) return 0;
  return Math.min(50, oran);
}

export function enAvantajliTemelFiyatiSec({ temelFiyat, kampanyaYuzde = 0, oneriIndirimYuzde = 0 }) {
  const normalFiyat = paraYuvarla(temelFiyat);
  const adaylar = [
    { kaynak: null, fiyat: normalFiyat, indirimYuzde: 0 },
    { kaynak: "kampanya", fiyat: indirimliFiyatHesapla(normalFiyat, kampanyaYuzde), indirimYuzde: Number(kampanyaYuzde) || 0 },
    { kaynak: "oneri", fiyat: indirimliFiyatHesapla(normalFiyat, oneriIndirimYuzde), indirimYuzde: Number(oneriIndirimYuzde) || 0 },
  ];
  return adaylar.reduce((enIyi, aday) => aday.fiyat < enIyi.fiyat ? aday : enIyi, adaylar[0]);
}
