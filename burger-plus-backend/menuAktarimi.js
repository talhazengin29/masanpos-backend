import sharp from "sharp";

const GEMINI_API_KOKU = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = process.env.GEMINI_MENU_MODEL || process.env.GEMINI_TRANSLATION_MODEL || "gemini-3.1-flash-lite";
const ZAMAN_ASIMI_MS = 45_000;
const EN_FAZLA_URUN = 40;

const MENU_YANIT_SEMASI = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          confidence: { type: "number" },
          products: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                price: { type: "number" },
                currency: { type: "string" },
                confidence: { type: "number" },
              },
              required: ["name", "description", "price", "currency", "confidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "confidence", "products"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
  required: ["categories", "warnings"],
  additionalProperties: false,
};

function temizMetin(deger, sinir) {
  return String(deger || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, sinir);
}

function guvenPuani(deger) {
  const sayi = Number(deger);
  if (!Number.isFinite(sayi)) return 0;
  return Math.max(0, Math.min(1, sayi));
}

export function fiyatCoz(deger) {
  if (typeof deger === "number") return Number.isFinite(deger) ? deger : NaN;
  let metin = String(deger || "").replace(/[^0-9,.-]/g, "").trim();
  if (!metin) return NaN;
  const sonVirgul = metin.lastIndexOf(",");
  const sonNokta = metin.lastIndexOf(".");
  if (sonVirgul > sonNokta) metin = metin.replace(/\./g, "").replace(",", ".");
  else if (sonNokta > sonVirgul && sonVirgul >= 0) metin = metin.replace(/,/g, "");
  else if (sonNokta > 0 && /^\d{1,3}\.\d{3}$/.test(metin)) metin = metin.replace(".", "");
  else if ((metin.match(/\./g) || []).length > 1) metin = metin.replace(/\./g, "");
  else if ((metin.match(/,/g) || []).length > 1) metin = metin.replace(/,/g, "");
  else metin = metin.replace(",", ".");
  const sonuc = Number(metin);
  return Number.isFinite(sonuc) ? sonuc : NaN;
}

export function menuAnaliziniDogrula(ham) {
  const kategoriler = [];
  const otomatikUyarilar = [];
  const urunAnahtarlari = new Set();
  let urunSayisi = 0;
  for (const hamKategori of Array.isArray(ham?.categories) ? ham.categories : []) {
    if (urunSayisi >= EN_FAZLA_URUN) break;
    const ad = temizMetin(hamKategori?.name, 60);
    if (ad.length < 2) continue;
    const urunler = [];
    for (const hamUrun of Array.isArray(hamKategori?.products) ? hamKategori.products : []) {
      if (urunSayisi >= EN_FAZLA_URUN) break;
      const urunAdi = temizMetin(hamUrun?.name, 120);
      const fiyat = fiyatCoz(hamUrun?.price);
      const anahtar = `${ad.toLocaleLowerCase("tr-TR")}\u0000${urunAdi.toLocaleLowerCase("tr-TR")}`;
      if (urunAdi.length < 2 || !Number.isFinite(fiyat) || fiyat < 0 || fiyat > 1_000_000 || urunAnahtarlari.has(anahtar)) continue;
      urunAnahtarlari.add(anahtar);
      const paraBirimi = temizMetin(hamUrun?.currency, 8).toUpperCase() || "TRY";
      const tlUyumlu = ["TRY", "TL", "₺"].includes(paraBirimi);
      if (!tlUyumlu && !otomatikUyarilar.includes("TL dışındaki fiyatlar otomatik seçilmedi.")) otomatikUyarilar.push("TL dışındaki fiyatlar otomatik seçilmedi.");
      urunler.push({
        ad: urunAdi,
        aciklama: temizMetin(hamUrun?.description, 500),
        fiyat: Number(fiyat.toFixed(2)),
        paraBirimi,
        guven: guvenPuani(hamUrun?.confidence),
        secili: tlUyumlu,
      });
      urunSayisi += 1;
    }
    if (urunler.length) kategoriler.push({ ad, guven: guvenPuani(hamKategori?.confidence), urunler });
  }
  if (!kategoriler.length) throw new Error("Görselde kategori, ürün adı ve fiyat eşleşmesi bulunamadı. Daha net ve düz açıdan çekilmiş bir menü deneyin.");
  return {
    kategoriler,
    uyarilar: [...(Array.isArray(ham?.warnings) ? ham.warnings : []).map((uyari) => temizMetin(uyari, 220)).filter(Boolean), ...otomatikUyarilar].slice(0, 10),
    urunSayisi,
    siniraUlasti: urunSayisi >= EN_FAZLA_URUN,
  };
}

function yanitMetniniGetir(yanit) {
  const metin = yanit?.candidates?.[0]?.content?.parts?.map((parca) => parca?.text || "").join("").trim();
  if (!metin) throw new Error("Menü analizi boş yanıt döndürdü.");
  return metin;
}

export async function menuGorseliniAnalizEt(buffer, { fetchImpl = fetch } = {}) {
  if (!process.env.GEMINI_API_KEY) throw new Error("Menü aktarımı için GEMINI_API_KEY tanımlanmalıdır.");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Analiz edilecek menü görseli veya PDF zorunludur.");
  const pdfMi = buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-";
  if (pdfMi && !buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from("%%EOF"))) throw new Error("Menü PDF'i geçerli veya tamamlanmış bir PDF dosyası değil.");
  if (pdfMi && buffer.length > 8 * 1024 * 1024) throw new Error("Menü PDF'i en fazla 8 MB olabilir.");
  if (!pdfMi && buffer.length > 5 * 1024 * 1024) throw new Error("Menü görseli en fazla 5 MB olabilir.");

  let guvenliBelge = buffer;
  let belgeMime = "application/pdf";
  if (!pdfMi) {
    try {
      guvenliBelge = await sharp(buffer, { limitInputPixels: 25_000_000, failOn: "error", animated: false })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();
      belgeMime = "image/jpeg";
    } catch {
      throw new Error("Menü görseli işlenemedi. Geçerli ve bozuk olmayan bir PNG, JPG, WebP veya PDF yükleyin.");
    }
  }

  const talimat = [
    "Bu bir restoran menüsü veri çıkarma görevidir.",
    "Görselde gerçekten yazan kategori başlıklarını, ürün adlarını, ürün açıklamalarını ve fiyatları çıkar.",
    "Türkçe ürün adını ana ad olarak kullan. Aynı ürünün İngilizce veya başka dildeki çevirisini ayrı ürün yapma; varsa description içine alma.",
    "Kategori başlıklarını ürün olarak, para birimi yazılarını fiyatın parçası olarak alma.",
    "Fiyatı yalnızca sayı olarak döndür. TL/₺ için currency alanını TRY yap.",
    "Okunamayan veya kategori-fiyat eşleşmesi belirsiz satırı tahmin ederek uydurma; warnings alanında belirt.",
    `En fazla ${EN_FAZLA_URUN} ürün döndür ve menüdeki okuma sırasını koru.`,
  ].join("\n");
  const denetleyici = new AbortController();
  const zamanlayici = setTimeout(() => denetleyici.abort(), ZAMAN_ASIMI_MS);
  try {
    const yanit = await fetchImpl(`${GEMINI_API_KOKU}/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
      signal: denetleyici.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: talimat },
          { inlineData: { mimeType: belgeMime, data: guvenliBelge.toString("base64") } },
        ] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: MENU_YANIT_SEMASI,
        },
      }),
    });
    if (!yanit.ok) {
      const ayrinti = await yanit.text();
      throw new Error(`Menü analiz servisi yanıt vermedi (${yanit.status}): ${ayrinti.slice(0, 240)}`);
    }
    const veri = await yanit.json();
    return { ...menuAnaliziniDogrula(JSON.parse(yanitMetniniGetir(veri))), model: MODEL };
  } catch (hata) {
    if (hata?.name === "AbortError") throw new Error("Menü analizi zaman aşımına uğradı. Görseli küçültüp tekrar deneyin.");
    if (hata instanceof SyntaxError) throw new Error("Menü analiz servisi geçersiz veri döndürdü. Lütfen tekrar deneyin.");
    throw hata;
  } finally {
    clearTimeout(zamanlayici);
  }
}

export function menuAktarimiYapilandirmasi() {
  return { aktif: Boolean(process.env.GEMINI_API_KEY), saglayici: "gemini", model: MODEL, enFazlaUrun: EN_FAZLA_URUN };
}

export const _test = { temizMetin, guvenPuani, yanitMetniniGetir, MENU_YANIT_SEMASI };
