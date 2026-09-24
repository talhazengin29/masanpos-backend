// Konsept varsayılan logoları.
//
// Kendi logosunu yüklememiş işletmelerde bu görsel kullanılır; logo yükleyen
// işletmede hiçbir şey değişmez (bkz. temaCoz aşağıda). Dosyalar frontend'in
// kök public klasöründe durur (masanpos-web/apps/landing/public/gorseller),
// yayında sitenin kökünden servis edilir: /gorseller/...
//
// Not: yerel geliştirmede müşteri uygulaması ayrı portta çalıştığı için bu yol
// 404 döner ve arayüz işletme adını metin olarak gösterir (MarkaLogosu'ndaki
// onError yedeği). Yayında sorun olmaz.
//
// burger'e bilerek varsayılan verilmedi: müşteri uygulaması "burger-plus"
// için zaten paket içindeki BurgerPlusLogosu bileşenini kullanıyor.
export const KONSEPTLER = {
  burger: {
    ad: "Burger",
    renkler: {
      accent: "#FF6B00",
      accentGlow: "rgba(255,107,0,0.4)",
      bgPrimary: "#0D0D0D",
      bgCard: "rgba(255,255,255,0.06)",
    },
    font: { baslik: "Montserrat", govde: "Plus Jakarta Sans" },
    metinler: {
      slogan: "Lezzetli Yemek, Harika Deneyim!",
      sloganVurgu: "Harika Deneyim!",
      kampanyaBaslik: "Ye Kazan",
      damgaMetni: "{hedef} Burger Ye, 1 Burger HEDİYE!",
      damgaBirim: "Burger",
      sepetBos: "Sepetin şu an boş",
      urunBolumBaslik: "Popüler Ürünler",
      aramaPlaceholder: "Menüde ara...",
    },
    kategoriler: ["Burgerler", "Yan Lezzetler", "İçecekler", "Tatlılar"],
  },
  cafe: {
    ad: "Cafe",
    varsayilanLogo: "/gorseller/konsept-cafe-logo.png",
    renkler: {
      accent: "#C8873E",
      accentGlow: "rgba(200,135,62,0.4)",
      bgPrimary: "#0F0D0B",
      bgCard: "rgba(255,248,240,0.05)",
    },
    font: { baslik: "Playfair Display", govde: "Plus Jakarta Sans" },
    metinler: {
      slogan: "Günün Her Anına Eşlik Eden Lezzet",
      sloganVurgu: "Eşlik Eden Lezzet",
      kampanyaBaslik: "İç Kazan",
      damgaMetni: "{hedef} Kahve İç, 1 Kahve HEDİYE!",
      damgaBirim: "Kahve",
      sepetBos: "Sepetin şu an boş",
      urunBolumBaslik: "Öne Çıkanlar",
      aramaPlaceholder: "Kahve, tatlı ara...",
    },
    kategoriler: ["Sıcak İçecekler", "Soğuk İçecekler", "Tatlılar", "Atıştırmalık"],
  },
  pizza: {
    ad: "Pizza",
    varsayilanLogo: "/gorseller/konsept-pizza-logo.png",
    renkler: {
      accent: "#E63946",
      accentGlow: "rgba(230,57,70,0.4)",
      bgPrimary: "#0D0A0A",
      bgCard: "rgba(255,255,255,0.06)",
    },
    font: { baslik: "Baloo 2", govde: "Plus Jakarta Sans" },
    metinler: {
      slogan: "Taş Fırından Sofrana",
      sloganVurgu: "Sofrana",
      kampanyaBaslik: "Ye Kazan",
      damgaMetni: "{hedef} Pizza Ye, 1 Pizza HEDİYE!",
      damgaBirim: "Pizza",
      sepetBos: "Sepetin şu an boş",
      urunBolumBaslik: "Fırından Yeni Çıkanlar",
      aramaPlaceholder: "Pizza, makarna ara...",
    },
    kategoriler: ["Pizzalar", "Makarnalar", "Başlangıçlar", "İçecekler"],
  },
};

export const KONSEPT_ADLARI = Object.freeze(Object.keys(KONSEPTLER));
export const TEMA_RENK_ALANLARI = Object.freeze(["accent", "accentGlow", "bgPrimary", "bgCard"]);
export const TEMA_METIN_ALANLARI = Object.freeze([
  "slogan", "sloganVurgu", "kampanyaBaslik", "damgaMetni",
  "damgaBirim", "sepetBos", "urunBolumBaslik", "aramaPlaceholder",
]);

const HEX_RENK_DESENI = /^#[0-9a-f]{6}$/i;
const RGBA_RENK_DESENI = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i;

function renkGecerliMi(deger) {
  if (HEX_RENK_DESENI.test(deger)) return true;
  const eslesme = deger.match(RGBA_RENK_DESENI);
  if (!eslesme) return false;
  return eslesme.slice(1, 4).every((kanal) => Number(kanal) <= 255)
    && Number(eslesme[4]) >= 0 && Number(eslesme[4]) <= 1;
}

function temaMetniniTemizle(deger) {
  return [...String(deger || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()]
    .slice(0, 120)
    .join("");
}

export function temaGirdisiniTemizle(girdi = {}, mevcutIsletme = {}) {
  if (!girdi || typeof girdi !== "object" || Array.isArray(girdi)) throw new Error("Tema bilgisi geçersiz.");
  const konsept = String(girdi.konsept || mevcutIsletme.konsept || "burger").trim().toLowerCase();
  if (!KONSEPTLER[konsept]) throw new Error("Konsept yalnızca burger, cafe veya pizza olabilir.");

  const mevcutTema = mevcutIsletme.tema && typeof mevcutIsletme.tema === "object" && !Array.isArray(mevcutIsletme.tema)
    ? mevcutIsletme.tema
    : {};
  const renkler = { ...(mevcutTema.renkler || {}) };
  if (girdi.renkler != null) {
    if (typeof girdi.renkler !== "object" || Array.isArray(girdi.renkler)) throw new Error("Tema renkleri geçersiz.");
    for (const alan of TEMA_RENK_ALANLARI) {
      if (!(alan in girdi.renkler)) continue;
      const deger = String(girdi.renkler[alan] || "").trim();
      if (!renkGecerliMi(deger)) throw new Error(`${alan} rengi hex veya rgba biçiminde olmalıdır.`);
      renkler[alan] = deger;
    }
  }

  const metinler = { ...(mevcutTema.metinler || {}) };
  if (girdi.metinler != null) {
    if (typeof girdi.metinler !== "object" || Array.isArray(girdi.metinler)) throw new Error("Tema metinleri geçersiz.");
    for (const alan of TEMA_METIN_ALANLARI) {
      if (!(alan in girdi.metinler)) continue;
      const temiz = temaMetniniTemizle(girdi.metinler[alan]);
      if (temiz) metinler[alan] = temiz;
      else delete metinler[alan];
    }
  }

  let tumuGorseli = mevcutTema.tumuGorseli || null;
  if (girdi.tumuGorseli !== undefined) {
    const deger = String(girdi.tumuGorseli || "").trim().slice(0, 1000);
    if (!deger) {
      tumuGorseli = null;
    } else {
      try {
        const url = new URL(deger);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new Error("Tümü görseli geçerli bir http/https adresi olmalıdır.");
      }
      tumuGorseli = deger;
    }
  }

  let arkaPlanGorseli = mevcutTema.arkaPlanGorseli || null;
  if (girdi.arkaPlanGorseli !== undefined) {
    const deger = String(girdi.arkaPlanGorseli || "").trim().slice(0, 1000);
    if (!deger) {
      arkaPlanGorseli = null;
    } else {
      try {
        const url = new URL(deger);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new Error("Tema arka plani gecerli bir http/https adresi olmalidir.");
      }
      arkaPlanGorseli = deger;
    }
  }

  const logoOlcegiHam = girdi.logoOlcegi == null ? (mevcutTema.logoOlcegi ?? 100) : girdi.logoOlcegi;
  const logoOlcegi = Number(logoOlcegiHam);
  if (!Number.isFinite(logoOlcegi) || logoOlcegi < 60 || logoOlcegi > 180) {
    throw new Error("Logo boyutu %60 ile %180 arasında olmalıdır.");
  }

  const logoKonumXHam = girdi.logoKonumX == null ? (mevcutTema.logoKonumX ?? 0) : girdi.logoKonumX;
  const logoKonumYHam = girdi.logoKonumY == null ? (mevcutTema.logoKonumY ?? 0) : girdi.logoKonumY;
  const logoKonumX = Number(logoKonumXHam);
  const logoKonumY = Number(logoKonumYHam);
  if (!Number.isFinite(logoKonumX) || logoKonumX < -80 || logoKonumX > 80) {
    throw new Error("Logo yatay konumu -80 ile 80 piksel arasında olmalıdır.");
  }
  if (!Number.isFinite(logoKonumY) || logoKonumY < -30 || logoKonumY > 30) {
    throw new Error("Logo dikey konumu -30 ile 30 piksel arasında olmalıdır.");
  }

  const gorunum = girdi.gorunum == null ? (mevcutTema.gorunum || "koyu") : String(girdi.gorunum).trim().toLowerCase();
  if (!["koyu", "acik"].includes(gorunum)) {
    throw new Error("Uygulama görünümü yalnızca koyu veya açık olabilir.");
  }

  return {
    konsept,
    tema: {
      ...(mevcutTema.font ? { font: mevcutTema.font } : {}),
      ozelPalet: girdi.ozelPalet == null ? mevcutTema.ozelPalet === true : girdi.ozelPalet === true,
      renkler,
      metinler,
      gorunum,
      logoOlcegi: Math.round(logoOlcegi),
      logoKonumX: Math.round(logoKonumX),
      logoKonumY: Math.round(logoKonumY),
      ...(tumuGorseli ? { tumuGorseli } : {}),
      ...(arkaPlanGorseli ? { arkaPlanGorseli } : {}),
    },
  };
}

export function temaCoz(isletme) {
  const konsept = KONSEPTLER[isletme?.konsept] ? isletme.konsept : "burger";
  const varsayilan = KONSEPTLER[konsept];
  const ozel = isletme?.tema && typeof isletme.tema === "object" && !Array.isArray(isletme.tema)
    ? isletme.tema
    : {};
  return {
    renkler: ozel.ozelPalet
      ? { ...varsayilan.renkler, ...(ozel.renkler || {}) }
      : { ...varsayilan.renkler },
    font: { ...varsayilan.font, ...(ozel.font || {}) },
    metinler: { ...varsayilan.metinler, ...(ozel.metinler || {}) },
    ceviriler: { en: ozel.ceviriler?.en || {} },
    ceviriDurumu: ozel.ceviriler?.durum || "bekliyor",
    ozelPalet: ozel.ozelPalet === true,
    gorunum: ozel.gorunum === "acik" ? "acik" : "koyu",
    tumuGorseli: ozel.tumuGorseli || null,
    arkaPlanGorseli: ozel.arkaPlanGorseli || null,
    logoOlcegi: Math.min(180, Math.max(60, Number(ozel.logoOlcegi) || 100)),
    logoKonumX: Math.min(80, Math.max(-80, Number(ozel.logoKonumX) || 0)),
    logoKonumY: Math.min(30, Math.max(-30, Number(ozel.logoKonumY) || 0)),
    konsept,
    // Sıra önemli: işletmenin kendi yüklediği logo her zaman önce gelir,
    // yoksa konseptin varsayılan logosuna düşülür.
    logoUrl: isletme?.logoUrl || isletme?.logo_url || varsayilan.varsayilanLogo || null,
  };
}
