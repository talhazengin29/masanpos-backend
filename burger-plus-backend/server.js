// ============================================================================
// MasanPOS — Backend sunucusu (PostgreSQL)
// Express (HTTP API) + Socket.io (anlik guncelleme) + PostgreSQL (kalici veri).
//
// Cok-telefon senaryosu: ayni masaya baglanan herkes o masanin "odasina"
// katilir. Biri urun eklediginde o odadaki HERKESE aninda haber gider.
// ============================================================================

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import pool, {
  tablolariHazirla,
  masaSiparisleriniGetir,
  kalemEkle,
  masaDurumGuncelle,
  tumAcikMasalar,
  masaKapat,
  kullaniciProfilGuncelle,
  kullaniciSiparisleriniGetir,
  davetOzetiniGetir,
  odemeTaslagiOlustur,
  odemeSimulasyonOnayla,
  odemeIyzicoOlarakOnayla,
  odemeCuzdanlaOnayla,
  odemeGetir,
  odemeSaglayiciTokenKaydet,
  odemeIyzicoBaslatiminiTalepEt,
  odemeIyzicoBaslatiminiBirak,
  odemeSaglayiciTokeniniGetir,
  iyzicoTokeniyleOdemeGetir,
  odemeMutfagaAktarildi,
  nakitMasaDurumunuGetir,
  nakitMasalariniGetir,
  nakitMasasiniAc,
  nakitSiparisOlustur,
  nakitSiparisiOnayla,
  nakitSiparisiReddet,
  nakitSiparisiTahsilEt,
  suresiDolanStokRezervasyonlariniBirak,
  siparisStogunuKesinlestir,
  odemeMutfakAktariminiTalepEt,
  odemeMutfakAktariminiBirak,
} from "./db.js";
import { iyzicoCheckoutBaslat, iyzicoSonucuGetir, iyzicoDonusAdresi } from "./iyzico.js";
import {
  adminTablolariHazirla,
  ilkYerelAdminOlustur,
  yerelAdminKurulumGerekli,
  urunleriGetir,
  onerileriGetir,
  oneriIndirimAyariniGetir,
  oneriIndirimAyariniKaydet,
  urunKaydet,
  menuTaslaginiKaydet,
  urunAktiflikDegistir,
  urunArsivle,
  kategorileriGetir,
  kategoriKaydet,
  personelleriGetir,
  personelKaydet,
  vardiyaDegistir,
  dashboardGetir,
  satisRaporuGetir,
  duyurulariGetir,
  duyuruKaydet,
  kampanyalariGetir,
  kampanyaTaslagiGetir,
  kampanyaKaydet,
  kategoriArsivle,
  personelArsivle,
  duyuruArsivle,
  kampanyaArsivle,
  yonetimVarliginiGetir,
  revizyonKaydet,
  revizyonKayitlariniGetir,
  canliSatislariGetir,
  gecmisSatislariGetir,
  mutfakKayitlariniGetir,
  musteriKayitlariniGetir,
  personelKayitlariniGetir,
  kurulumAyarlariGetir,
  eksikCevirileriTamamla,
} from "./adminDb.js";
import { ceviriYapilandirmasi } from "./ceviri.js";
import { menuGorseliniAnalizEt } from "./menuAktarimi.js";
import { operasyonNabziniGetir } from "./operasyonDb.js";
import {
  gorselYukle, logoYukle, temaArkaPlaniYukle, storageDosyasiniSil,
  sikayetGorseliYukle, sikayetGorseliKullaniciyaAitMi,
  giderBelgesiYukle, giderBelgesiIsletmeyeAitMi,
} from "./storage.js";
import { temaCoz } from "./konseptler.js";
import {
  kayitOl, girisYap, girisYapGenel, korumaliMiddleware, adminMiddleware, rolMiddleware,
  opsiyonelKullaniciMiddleware, tokenDogrula,
  sifirlamaTalepEt, sifirlamaTokenGecerliMi, sifreyiSifirla,
  ikiFaktorGirisiniTamamla, ikiFaktorKurulumBaslat, ilkGirisSifreBelirle,
  ikiFaktorKurulumOnayla, ikiFaktorDevreDisiBirak,
  superAdminGiris, superAdminIkiFaktorGirisiniTamamla, superAdminMiddleware,
  superAdminErisimTokeniUret, impersonationTokeniniDogrula,
  masaErisimTokeniUret, masaErisimTokeniniDogrula,
} from "./auth.js";
import {
  sadakatTablolariHazirla, sadakatOzetiniGetir, puanlaOdulSatinAl,
  kullaniciOdulunuSipariseDonustur, adminOdulleriGetir, adminOdulKaydet, adminOdulArsivle,
  sadakatAyariniGetir, adminSadakatAyariniGetir, adminSadakatAyariniKaydet,
  sadakatCevirisiniTamamla,
} from "./sadakatDb.js";
import {
  cuzdanTablolariHazirla, cuzdanAyariniGetir, adminCuzdanAyariniKaydet,
  cuzdanOzetiniGetir, kasaMusteriAra, kasaSonYuklemeleriGetir, kasadanCuzdanYukle, adminCuzdanRaporunuGetir,
} from "./cuzdanDb.js";
import {
  isletmeTablosunuHazirla, isletmeMigrationunuCalistir, isletmeSlugIleGetir, isletmeIdIleGetir,
  isletmeOlustur, isletmeTemasiniGuncelle, isletmeLogosunuGuncelle, isletmeTemaCevirisiniTamamla,
} from "./isletmeDb.js";
import {
  superAdminTablolariniHazirla, ilkSuperAdminiHazirla,
  superAdminKaydiEkle, superAdminKayitlariniGetir, superIsletmeleriGetir,
  superIsletmeDetayiGetir, superIsletmeBilgileriniGuncelle, superIsletmeDurumunuGuncelle,
  superIsletmeSilmeOzeti, superIsletmeyiYumusakSil, platformOzetiniGetir,
  ciroRaporunuGetir, buyumeRaporunuGetir, siparisRaporunuGetir, kullaniciRaporunuGetir,
  abonelikleriGetir, abonelikOlustur, abonelikGuncelle, gelirRaporunuGetir,
  isletmeAdminleriniGetir, isletmeAdminHesabiniAyarla, isletmeAdmininiGuncelle, isletmeAdmininiSil,
} from "./superAdminDb.js";
import { slugOlustur } from "./slug.js";
import {
  masaPlaniOlustur,
  masaZekasiTablolariniHazirla,
  masaZekasiOturumunuGetir,
  masaZekasiOturumunaKatil,
  masaZekasiTercihiniKaydet,
  masaZekasiOrtakTercihleriniGetir,
  masaZekasiOturumunuKapat,
} from "./masaZekasi.js";
import { isletmeKurulumunuYap, slugMusaitlikDurumu } from "./kurulumDb.js";
import {
  personelCagriTablolariHazirla, masaCagriOturumuBaslat, masaPersonelCagrisiniGetir,
  masaPersonelCagrisiOlustur, aktifPersonelCagrilariniGetir,
  personelCagrisiDurumGuncelle, masaCagriOturumlariniKapat,
} from "./personelCagriDb.js";
import {
  sikayetTablosunuHazirla, musteriSikayetleriniGetir, sikayetOlustur,
  adminSikayetleriniGetir, adminSikayetGuncelle,
} from "./sikayetDb.js";
import { rezervasyonTablosunuHazirla, rezervasyonlariGetir, rezervasyonOlustur, rezervasyonGuncelle, rezervasyonSil } from "./rezervasyonDb.js";
import { salonKrokisiniGetir, salonKrokisiniKaydet } from "./salonKrokiDb.js";
import { degerlendirmeTablolariniHazirla, siparisDegerlendirmesiOlustur, adminDegerlendirmeRaporunuGetir } from "./degerlendirmeDb.js";
import {
  giderTablolariniHazirla, finansMerkeziniGetir, giderKategorisiKaydet, giderKategorisiArsivle,
  tedarikciKaydet, tedarikciArsivle, giderKaydet, giderDurumuGuncelle,
  tedarikciOdemesiKaydet, duzenliGiderKaydet, duzenliGiderArsivle,
  finansRaporunuGetir, giderButceleriniKaydet,
} from "./giderDb.js";
import {
  receteTablolariniHazirla, receteStokMerkeziniGetir, hammaddeKaydet,
  hammaddeStokHareketiKaydet, urunRecetesiKaydet,
} from "./receteDb.js";
import { landingChatYaniti } from "./landingChat.js";
import {
  eskiOneriAtiflariniTemizle, oneriAtifTablolariniHazirla, oneriOlayiKaydet, oneriOturumuOlustur,
  oneriReferansiOlustur, oneriReferansiniDogrula,
} from "./oneriAtif.js";
import {
  basvuruTablosunuHazirla, landingBasvurusuOlustur,
  superBasvurulariGetir, superBasvuruOzetiniGetir, superBasvuruGuncelle,
} from "./basvuruDb.js";
import {
  idempotencyIstegiOzeti,
  idempotencyTablosunuHazirla,
  idempotentIslemCalistir,
} from "./idempotency.js";

const app = express();
app.disable("x-powered-by");
const URETIM = process.env.NODE_ENV === "production";
if (URETIM) app.set("trust proxy", 1);
function istemciHataMesaji(hata, varsayilan) {
  const mesaj = String(hata?.message || "").trim();
  const altyapiKodu = /^\d{5}$/.test(String(hata?.code || ""))
    || /^(ECONN|ENOTFOUND|ETIMEDOUT|EAI_)/.test(String(hata?.code || ""));
  const altyapiMesaji = /(SELECT|INSERT|UPDATE|DELETE|ALTER TABLE|column |relation |constraint |syntax error|ECONN|stack)/i.test(mesaj);
  if (!mesaj || (URETIM && (altyapiKodu || altyapiMesaji))) return varsayilan;
  return mesaj.slice(0, 240);
}
function originiNormallestir(origin) {
  const ham = String(origin || "").trim();
  if (!ham) return "";
  const protokollu = /^https?:\/\//i.test(ham)
    ? ham
    : /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(ham) ? `http://${ham}` : `https://${ham}`;
  try {
    const url = new URL(protokollu);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}
const izinliOriginler = new Set(
  [process.env.FRONTEND_URL, ...(process.env.CORS_ORIGINS || "").split(",")]
    .map(originiNormallestir)
    .filter(Boolean)
);
if (!URETIM) {
  ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:5176", "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175", "http://127.0.0.1:5176"]
    .forEach((origin) => izinliOriginler.add(origin));
}
if (URETIM && izinliOriginler.size === 0) {
  throw new Error("Production ortamında FRONTEND_URL veya CORS_ORIGINS tanımlanmalıdır.");
}
function originIzinli(origin) {
  return !origin || izinliOriginler.has(originiNormallestir(origin));
}
const corsAyarlari = {
  origin(origin, callback) {
    if (originIzinli(origin)) return callback(null, true);
    const hata = new Error("Bu origin icin CORS izni yok.");
    hata.kod = "CORS_ENGELLENDI";
    callback(hata);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Isletme", "X-Masa-Token", "X-Masa-Oturum", "Idempotency-Key"],
  exposedHeaders: ["Idempotency-Key", "Idempotency-Replayed"],
  maxAge: 600,
  optionsSuccessStatus: 204,
};
// İyzico'nun ödeme sayfası callback'i tarayıcıdan otomatik form-post ile
// gönderir; bu istek kendi domainini Origin header'ında taşır ve frontend
// allowlist'inde olmadığı için engellenirdi. Bu rota bizim JS'imizden değil
// doğrudan İyzico'dan geldiği için origin allowlist'inin dışında tutulur.
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use((req, res, next) => {
  if (req.path === "/api/odeme/iyzico/callback") return next();
  cors(corsAyarlari)(req, res, next);
});
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
function istekGovdesiGuvenliMi(deger, derinlik = 0, durum = { alan: 0 }) {
  if (deger == null || typeof deger !== "object") return true;
  if (derinlik > 8 || durum.alan > 250) return false;
  if (Array.isArray(deger) && deger.length > 100) return false;
  for (const [anahtar, altDeger] of Object.entries(deger)) {
    durum.alan += 1;
    if (["__proto__", "prototype", "constructor"].includes(anahtar)) return false;
    if (!istekGovdesiGuvenliMi(altDeger, derinlik + 1, durum)) return false;
  }
  return durum.alan <= 250;
}
app.use("/api", (req, res, next) => {
  if (!istekGovdesiGuvenliMi(req.body)) {
    return res.status(400).json({ hata: "İstek gövdesi izin verilen yapıyı aşıyor." });
  }
  const kimlikYaniti = /^\/(?:giris(?:-genel)?|giris\/|kayit$|ben$|sifre-sifir)/.test(req.path);
  if (req.headers.authorization || kimlikYaniti || req.path.startsWith("/admin") || req.path.startsWith("/super")) {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
  }
  next();
});
const genelApiLimiti = rateLimit({
  windowMs: 60_000,
  limit: URETIM ? 300 : 1200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.originalUrl.startsWith("/api/admin/"),
  message: { hata: "Çok fazla istek gönderildi. Lütfen kısa süre sonra tekrar deneyin." },
});
const yonetimApiLimiti = rateLimit({
  windowMs: 60_000,
  limit: URETIM ? 600 : 1800,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { hata: "Yönetim paneli istek sınırına ulaştı. Lütfen kısa süre sonra tekrar deneyin." },
});
app.use("/api/admin", yonetimApiLimiti);
app.use("/api", genelApiLimiti);
const kimlikLimiti = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const kimlikEmailLimiti = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254);
    return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip)}`;
  },
  message: { hata: "Çok fazla başarısız giriş denemesi yapıldı. 15 dakika sonra tekrar deneyin." },
});
const sifreSifirlamaLimiti = rateLimit({
  windowMs: 15 * 60_000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false,
  message: { hata: "Çok fazla istek gönderildi. Lütfen kısa süre sonra tekrar deneyin." },
});
const ikiFaktorLimiti = rateLimit({
  windowMs: 10 * 60_000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false,
  message: { hata: "Çok fazla iki adımlı doğrulama denemesi yapıldı. Lütfen daha sonra tekrar deneyin." },
});
const superAdminGirisLimiti = rateLimit({
  windowMs: 15 * 60_000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false,
  message: { hata: "Çok fazla super admin giriş denemesi yapıldı. 15 dakika sonra tekrar deneyin." },
});
const nakitSiparisLimiti = rateLimit({
  windowMs: 5 * 60_000, limit: URETIM ? 12 : 60, standardHeaders: "draft-8", legacyHeaders: false,
  message: { hata: "Çok fazla nakit sipariş isteği gönderildi. Lütfen personelden yardım isteyin." },
});
const personelCagriOturumLimiti = rateLimit({
  // Restoran Wi-Fi'sindeki tüm müşteriler aynı dış IP'yi paylaşabilir. Asıl
  // kötüye kullanım sınırı aşağıdaki masa/cihaz kurallarıdır; IP limiti kaba emniyet ağıdır.
  windowMs: 15 * 60_000, limit: URETIM ? 120 : 300, standardHeaders: "draft-8", legacyHeaders: false,
  message: { hata: "Çok fazla masa oturumu istendi. Lütfen personelden yardım isteyin." },
});
const personelCagriLimiti = rateLimit({
  windowMs: 10 * 60_000, limit: URETIM ? 120 : 300, standardHeaders: "draft-8", legacyHeaders: false,
  message: { hata: "Çok fazla personel çağrısı gönderildi. Lütfen bir süre bekleyin." },
});
const sikayetLimiti = rateLimit({
  windowMs: 15 * 60_000, limit: URETIM ? 60 : 180, standardHeaders: "draft-8", legacyHeaders: false,
  message: { hata: "Çok fazla geri bildirim isteği gönderildi. Lütfen kısa süre sonra tekrar deneyin." },
});
const masaZekasiLimiti = rateLimit({
  windowMs: 10 * 60_000, limit: URETIM ? 90 : 300, standardHeaders: "draft-8", legacyHeaders: false,
  message: { hata: "Çok fazla öneri istendi. Lütfen kısa süre sonra tekrar deneyin." },
});
const oneriOlayLimiti = rateLimit({
  // Restoran Wi-Fi'sinde çok sayıda müşteri aynı IP'yi paylaşır ve her öneri
  // görüntülenme/tıklama/ekleme için ayrı olay üretir. Genel API limiti ayrıca geçerlidir.
  windowMs: 10 * 60_000, limit: URETIM ? 900 : 2400, standardHeaders: "draft-8", legacyHeaders: false,
  message: { hata: "Çok fazla öneri olayı gönderildi. Lütfen kısa süre sonra tekrar deneyin." },
});
const landingChatLimiti = rateLimit({
  windowMs: 5 * 60_000,
  limit: URETIM ? 20 : 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { hata: "Sohbet sınırına ulaştınız. Lütfen birkaç dakika sonra tekrar deneyin." },
});
const landingBasvuruLimiti = rateLimit({
  windowMs: 15 * 60_000,
  limit: URETIM ? 5 : 50,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { hata: "Çok fazla başvuru gönderildi. Lütfen 15 dakika sonra tekrar deneyin." },
});
const dosyaYuklemeLimiti = rateLimit({
  windowMs: 15 * 60_000,
  limit: URETIM ? 30 : 150,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { hata: "Dosya yükleme sınırına ulaşıldı. Lütfen daha sonra tekrar deneyin." },
});
const menuAktarimLimiti = rateLimit({
  windowMs: 15 * 60_000,
  limit: URETIM ? 8 : 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { hata: "Menü analiz sınırına ulaşıldı. Lütfen 15 dakika sonra tekrar deneyin." },
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: corsAyarlari,
  maxHttpBufferSize: 100_000,
  perMessageDeflate: false,
  allowRequest: (req, callback) => callback(null, originIzinli(req.headers.origin)),
});
const oda = (isletmeId, ad) => `i${isletmeId}:${ad}`;

// --- HTTP API ---

// Tenant bilgisini öğrenmek için kullanılan bu uç, doğal olarak henüz
// X-Isletme başlığı gerektirmez. Diğer /api uçları aşağıdaki middleware'den geçer.
function temaliIsletmeYaniti(isletme) {
  return {
    isletme: {
      id: isletme.id,
      slug: isletme.slug,
      ad: isletme.ad,
      konsept: isletme.konsept,
      logoUrl: isletme.logoUrl,
      aktif: isletme.aktif,
    },
    tema: temaCoz(isletme),
  };
}

app.get("/api/isletme/:slug", async (req, res) => {
  const isletme = await isletmeSlugIleGetir(req.params.slug);
  if (!isletme) return res.status(404).json({ hata: "İşletme bulunamadı." });
  if (!isletme.aktif) {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const erisim = token ? await impersonationTokeniniDogrula(token, isletme.id) : null;
    if (!erisim) return res.status(404).json({ hata: "İşletme bulunamadı." });
  }
  res.json(temaliIsletmeYaniti(isletme));
});

// Tek panelden giris: hangi isletmeye ait oldugu X-Isletme header'i olmadan,
// yalnizca e-posta+sifreden bulunur (bkz. auth.js#girisYapGenel). Bu yuzden
// isletmeMiddleware'den ONCE tanimli olmali; aksi halde header zorunlu hale gelir.
app.post("/api/giris-genel", kimlikLimiti, kimlikEmailLimiti, async (req, res) => {
  const sonuc = await girisYapGenel(req.body);
  if (sonuc.hata) return res.status(401).json(sonuc);
  res.json(sonuc);
});

// Landing satış asistanı tenant seçimi gerektirmez. API anahtarı yalnızca
// sunucuda kalır; hazır cevaplar AI kotasını tüketmeden doğrudan döner.
app.post("/api/landing/chat", landingChatLimiti, async (req, res) => {
  const sonuc = await landingChatYaniti(req.body || {});
  if (sonuc.hata) return res.status(sonuc.durum || 400).json({ hata: sonuc.hata });
  res.json(sonuc);
});

// Tanıtım sitesi başvuruları tenant bağlamından bağımsızdır. Honeypot ve süre
// kontrolü basvuruDb içinde; IP sınırı hem uygulama hem veritabanı katmanındadır.
app.post("/api/landing/basvurular", landingBasvuruLimiti, async (req, res) => {
  try {
    const sonuc = await landingBasvurusuOlustur(pool, req.body || {}, {
      ip: req.ip || req.socket.remoteAddress || "",
      ipTuzu: process.env.BASVURU_IP_TUZU || process.env.JWT_SECRET || "menule-basvuru",
      userAgent: req.headers["user-agent"] || "",
      kampanya: {
        source: req.body?.utmSource,
        medium: req.body?.utmMedium,
        campaign: req.body?.utmCampaign,
        referrer: req.body?.referrer,
      },
    });
    res.status(201).json({ basarili: true, basvuruId: sonuc.basvuru?.id || null });
  } catch (e) {
    res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Başvuru alınamadı.") });
  }
});

async function isletmeMiddleware(req, res, next) {
  try {
    if (req.path === "/super" || req.path.startsWith("/super/")) return next();
    const callbackMu = req.method === "POST" && req.path === "/odeme/iyzico/callback";
    const eskiDonusMu = req.method === "GET" && /^\/odeme\/iyzico\/[^/]+\/odeme-basarili$/.test(req.path);
    if (callbackMu || eskiDonusMu) return next();
    const slug = req.headers["x-isletme"] || req.query.isletme;
    if (!slug) return res.status(400).json({ hata: "İşletme belirtilmedi." });
    const isletme = await isletmeSlugIleGetir(slug);
    if (!isletme) return res.status(404).json({ hata: "İşletme bulunamadı." });
    if (!isletme.aktif) {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const erisim = token ? await impersonationTokeniniDogrula(token, isletme.id) : null;
      if (!erisim) return res.status(404).json({ hata: "İşletme bulunamadı." });
    }
    req.isletme = isletme;
    next();
  } catch (hata) {
    next(hata);
  }
}

app.use("/api", isletmeMiddleware);

// Kayit ol
app.post("/api/kayit", kimlikLimiti, async (req, res) => {
  const sonuc = await kayitOl(req.isletme.id, req.body);
  if (sonuc.hata) return res.status(400).json(sonuc);
  res.json(sonuc);
});

// Giris yap
app.post("/api/giris", kimlikLimiti, kimlikEmailLimiti, async (req, res) => {
  const sonuc = await girisYap(req.isletme.id, req.body);
  if (sonuc.hata) return res.status(401).json(sonuc);
  res.json(sonuc);
});

app.post("/api/giris/2fa", ikiFaktorLimiti, async (req, res) => {
  const sonuc = await ikiFaktorGirisiniTamamla(req.isletme.id, req.body?.ikiFaktorToken, req.body?.kod);
  if (sonuc.hata) return res.status(401).json(sonuc);
  res.json(sonuc);
});

// Geçici şifreyle girişten sonraki zorunlu adım: bkz. auth.js#girisYap
// (sifreDegisimGerekli) ve #ilkGirisSifreBelirle.
app.post("/api/giris/ilk-sifre", ikiFaktorLimiti, async (req, res) => {
  const sonuc = await ilkGirisSifreBelirle(req.isletme.id, req.body?.gecisToken, req.body?.yeniSifre);
  if (sonuc.hata) return res.status(400).json(sonuc);
  res.json(sonuc);
});

// Sifremi unuttum: talep her zaman ayni mesajla doner (kullanici sizdirmaz).
app.post("/api/sifre-sifirlama-talep", sifreSifirlamaLimiti, async (req, res) => {
  await sifirlamaTalepEt(req.isletme.id, req.isletme.slug, req.body?.email);
  res.json({ mesaj: "E-posta adresiniz kayıtlıysa sıfırlama bağlantısı gönderildi." });
});

app.post("/api/sifre-sifirla/dogrula", sifreSifirlamaLimiti, async (req, res) => {
  res.json({ gecerli: await sifirlamaTokenGecerliMi(req.isletme.id, req.body?.token) });
});

app.post("/api/sifre-sifirla", sifreSifirlamaLimiti, async (req, res) => {
  const sonuc = await sifreyiSifirla(req.isletme.id, req.body?.token, req.body?.yeniSifre);
  if (sonuc.hata) return res.status(400).json(sonuc);
  res.json(sonuc);
});

// Ben kimim (token ile guncel kullanici bilgisi — sayfa yenilenince oturum korunur)
app.get("/api/ben", korumaliMiddleware(), (req, res) => {
  res.json({ kullanici: req.kullanici });
});

app.post("/api/2fa/kurulum-baslat", ikiFaktorLimiti, korumaliMiddleware(), async (req, res) => {
  const sonuc = await ikiFaktorKurulumBaslat(req.isletme.id, req.kullanici.id, req.body?.sifre);
  if (sonuc.hata) return res.status(400).json(sonuc);
  res.json(sonuc);
});

app.post("/api/2fa/kurulum-onayla", ikiFaktorLimiti, korumaliMiddleware(), async (req, res) => {
  const sonuc = await ikiFaktorKurulumOnayla(req.isletme.id, req.kullanici.id, req.body?.kod);
  if (sonuc.hata) return res.status(400).json(sonuc);
  res.json(sonuc);
});

app.post("/api/2fa/kapat", ikiFaktorLimiti, korumaliMiddleware(), async (req, res) => {
  const sonuc = await ikiFaktorDevreDisiBirak(req.isletme.id, req.kullanici.id, req.body?.sifre, req.body?.kod);
  if (sonuc.hata) return res.status(400).json(sonuc);
  res.json(sonuc);
});

app.get("/api/davetim", korumaliMiddleware(), async (req, res) => {
  try {
    res.json({ davet: await davetOzetiniGetir(req.isletme.id, req.kullanici.id) });
  } catch (e) {
    res.status(400).json({ hata: istemciHataMesaji(e, "Davet bilgileri alınamadı.") });
  }
});

// Profil guncelle (email + telefon; ad/soyad/cinsiyet degismez)
app.post("/api/profil", korumaliMiddleware(), async (req, res) => {
  const { email, telefon } = req.body || {};
  const sonuc = await kullaniciProfilGuncelle(req.isletme.id, req.kullanici.id, { email, telefon });
  if (sonuc.hata) return res.status(400).json(sonuc);
  res.json(sonuc);
});

app.get("/api/siparislerim", korumaliMiddleware(), async (req, res) => {
  res.json({ siparisler: await kullaniciSiparisleriniGetir(req.isletme.id, req.kullanici.id) });
});
app.post("/api/siparislerim/:id/degerlendirme", korumaliMiddleware(), async (req, res) => {
  try {
    const degerlendirme = await siparisDegerlendirmesiOlustur(req.isletme.id, req.kullanici.id, req.params.id, req.body || {}, pool);
    io.to(oda(req.isletme.id, "yonetim")).emit("degerlendirmeler-guncellendi", { id: degerlendirme.id });
    res.status(201).json({ degerlendirme });
  } catch (e) { res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Değerlendirme kaydedilemedi.") }); }
});

app.get("/api/sadakat", korumaliMiddleware(), async (req, res) => {
  try {
    res.json({ sadakat: await sadakatOzetiniGetir(req.isletme.id, pool, req.kullanici.id) });
  } catch (e) {
    res.status(400).json({ hata: istemciHataMesaji(e, "Sadakat bilgileri alinamadi.") });
  }
});

app.get("/api/cuzdan", korumaliMiddleware(), async (req, res) => {
  try {
    res.json({ cuzdan: await cuzdanOzetiniGetir(req.isletme.id, pool, req.kullanici.id) });
  } catch (e) {
    res.status(400).json({ hata: istemciHataMesaji(e, "Cüzdan bilgileri alınamadı.") });
  }
});

app.post("/api/sadakat/oduller/:id/satin-al", korumaliMiddleware(), async (req, res) => {
  try {
    await puanlaOdulSatinAl(req.isletme.id, pool, req.kullanici.id, req.params.id, req.body?.istekAnahtari);
    res.json({ sadakat: await sadakatOzetiniGetir(req.isletme.id, pool, req.kullanici.id) });
  } catch (e) {
    res.status(400).json({ hata: istemciHataMesaji(e, "Odul alinamadi.") });
  }
});

app.post("/api/sadakat/hediyeler/:id/kullan", korumaliMiddleware(), async (req, res) => {
  try {
    const kisiAdi = `${req.kullanici.ad} ${req.kullanici.soyad}`.trim();
    const odeme = await kullaniciOdulunuSipariseDonustur(
      req.isletme.id, pool, req.kullanici.id, req.params.id, req.body?.masaNo, kisiAdi
    );
    await onaylananOdemeyiMutfagaAktar(odeme);
    res.json({
      odeme: { ...odeme, mutfagaAktarildi: true },
      sadakat: await sadakatOzetiniGetir(req.isletme.id, pool, req.kullanici.id),
    });
  } catch (e) {
    res.status(400).json({ hata: istemciHataMesaji(e, "Hediye kullanilamadi.") });
  }
});

app.get("/api/masa/:masaNo", async (req, res) => {
  const masaNo = guvenliMasaNo(req.params.masaNo);
  if (!masaNo) return res.status(400).json({ hata: "Masa numarasi gecersiz." });
  if (!masaErisimTokeniniDogrula(req.headers["x-masa-token"], req.isletme.id, masaNo)) {
    return res.status(403).json({ hata: "Masa QR erisimi gecersiz." });
  }
  res.json(await masaSiparisleriniGetir(req.isletme.id, masaNo));
});

async function personelCagrilariniYayinla(isletmeId) {
  const cagrilar = await aktifPersonelCagrilariniGetir(isletmeId, pool);
  io.to(oda(isletmeId, "salon")).emit("personel-cagrilari-guncellendi", cagrilar);
  return cagrilar;
}

app.post("/api/masa/:masaNo/cagri-oturumu", personelCagriOturumLimiti, async (req, res) => {
  try {
    const masaNo = guvenliMasaNo(req.params.masaNo);
    if (!masaNo) return res.status(400).json({ hata: "Masa numarası geçersiz." });
    if (!masaErisimTokeniniDogrula(req.headers["x-masa-token"], req.isletme.id, masaNo)) {
      return res.status(403).json({ hata: "Masa QR erişimi geçersiz." });
    }
    const oturum = await masaCagriOturumuBaslat(req.isletme.id, pool, masaNo, req.body?.cihazAnahtari);
    res.status(201).json({ oturum });
  } catch (e) { res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Masa oturumu açılamadı.") }); }
});

app.get("/api/masa/:masaNo/personel-cagrisi", async (req, res) => {
  try {
    const masaNo = guvenliMasaNo(req.params.masaNo);
    if (!masaNo) return res.status(400).json({ hata: "Masa numarası geçersiz." });
    const cagri = await masaPersonelCagrisiniGetir(req.isletme.id, pool, masaNo, req.headers["x-masa-oturum"]);
    res.json({ cagri });
  } catch (e) { res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Personel çağrısı alınamadı.") }); }
});

app.post("/api/masa/:masaNo/personel-cagrisi", personelCagriLimiti, async (req, res) => {
  try {
    const masaNo = guvenliMasaNo(req.params.masaNo);
    if (!masaNo) return res.status(400).json({ hata: "Masa numarası geçersiz." });
    const cagri = await masaPersonelCagrisiOlustur(
      req.isletme.id, pool, masaNo, req.headers["x-masa-oturum"], req.body?.neden, req.body?.istekAnahtari
    );
    io.to(oda(req.isletme.id, `masa-${masaNo}`)).emit("personel-cagrisi-guncellendi", cagri);
    await personelCagrilariniYayinla(req.isletme.id);
    res.status(201).json({ cagri });
  } catch (e) { res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Personel çağrılamadı.") }); }
});

app.get("/api/personel/personel-cagrilari", rolMiddleware(["salon", "kasiyer"]), async (req, res) => {
  res.json({ cagrilar: await aktifPersonelCagrilariniGetir(req.isletme.id, pool) });
});

app.patch("/api/personel/personel-cagrilari/:id", rolMiddleware(["salon", "kasiyer"]), async (req, res) => {
  try {
    const cagri = await personelCagrisiDurumGuncelle(req.isletme.id, pool, req.params.id, req.body?.durum, req.kullanici?.id);
    io.to(oda(req.isletme.id, `masa-${cagri.masaNo}`)).emit("personel-cagrisi-guncellendi", cagri);
    await personelCagrilariniYayinla(req.isletme.id);
    res.json({ cagri });
  } catch (e) { res.status(400).json({ hata: istemciHataMesaji(e, "Çağrı güncellenemedi.") }); }
});

const rezervasyonRolu = () => rolMiddleware(["salon", "kasiyer"]);
app.get("/api/personel/rezervasyonlar", rezervasyonRolu(), async (req, res) => res.json({ rezervasyonlar: await rezervasyonlariGetir(req.isletme.id, pool, req.query) }));
app.post("/api/personel/rezervasyonlar", rezervasyonRolu(), async (req, res) => { try { res.status(201).json({ rezervasyon: await rezervasyonOlustur(req.isletme.id,pool,req.body,req.kullanici?.id) }); } catch(e){ res.status(e.status||400).json({hata:istemciHataMesaji(e,"Rezervasyon oluşturulamadı.")}); } });
app.patch("/api/personel/rezervasyonlar/:id", rezervasyonRolu(), async (req,res)=>{try{res.json({rezervasyon:await rezervasyonGuncelle(req.isletme.id,pool,req.params.id,req.body,req.kullanici?.id)});}catch(e){res.status(e.status||400).json({hata:istemciHataMesaji(e,"Rezervasyon güncellenemedi.")});}});
app.delete("/api/personel/rezervasyonlar/:id", rezervasyonRolu(), async (req,res)=>{try{await rezervasyonSil(req.isletme.id,pool,req.params.id);res.status(204).end();}catch(e){res.status(e.status||400).json({hata:istemciHataMesaji(e,"Rezervasyon silinemedi.")});}});
app.get("/api/personel/salon-krokisi", rezervasyonRolu(), async (req, res) => {
  res.json({ kroki: await salonKrokisiniGetir(req.isletme.id, pool) });
});

app.get("/api/mutfak", rolMiddleware(["mutfak", "salon", "kasiyer"]), async (req, res) => {
  res.json(await tumAcikMasalar(req.isletme.id));
});
// Aktif ürün kataloğu müşteri uygulamasına açıktır.
app.get("/api/urunler", async (req, res) => {
  await suresiDolanStokRezervasyonlariniBirak(req.isletme.id);
  res.json({ urunler: await urunleriGetir(req.isletme.id) });
});
app.post("/api/masa-zekasi/oner", masaZekasiLimiti, opsiyonelKullaniciMiddleware(), async (req, res) => {
  try {
    await suresiDolanStokRezervasyonlariniBirak(req.isletme.id);
    const [urunler, kampanyalar, masalar] = await Promise.all([
      urunleriGetir(req.isletme.id),
      kampanyalariGetir(req.isletme.id),
      tumAcikMasalar(req.isletme.id),
    ]);
    res.json(masaPlaniOlustur({
      urunler,
      kampanyalar,
      masalar,
      tercihler: req.body || {},
      uye: Boolean(req.kullanici),
    }));
  } catch (e) {
    res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Sipariş planı oluşturulamadı.") });
  }
});
function masaZekasiErisiminiDogrula(req, res) {
  const masaNo = guvenliMasaNo(req.params.masaNo);
  if (!masaNo) { res.status(400).json({ hata: "Masa numarası geçersiz." }); return null; }
  if (!masaErisimTokeniniDogrula(req.headers["x-masa-token"], req.isletme.id, masaNo)) {
    res.status(403).json({ hata: "Masa QR erişimi geçersiz." }); return null;
  }
  return masaNo;
}
app.post("/api/masa/:masaNo/zeka-oturumu/katil", masaZekasiLimiti, async (req, res) => {
  try {
    const masaNo = masaZekasiErisiminiDogrula(req, res); if (!masaNo) return;
    const oturum = await masaZekasiOturumunaKatil(req.isletme.id, pool, masaNo, req.body?.cihazAnahtari, req.body?.ad);
    io.to(oda(req.isletme.id, `masa-${masaNo}`)).emit("masa-zekasi-guncellendi", await masaZekasiOturumunuGetir(req.isletme.id, pool, masaNo));
    res.status(201).json({ oturum });
  } catch (e) { res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Ortak masa oturumuna katılınamadı.") }); }
});
app.put("/api/masa/:masaNo/zeka-oturumu/tercihim", masaZekasiLimiti, async (req, res) => {
  try {
    const masaNo = masaZekasiErisiminiDogrula(req, res); if (!masaNo) return;
    const oturum = await masaZekasiTercihiniKaydet(req.isletme.id, pool, masaNo, req.body?.cihazAnahtari, req.body?.tercihler);
    io.to(oda(req.isletme.id, `masa-${masaNo}`)).emit("masa-zekasi-guncellendi", await masaZekasiOturumunuGetir(req.isletme.id, pool, masaNo));
    res.json({ oturum });
  } catch (e) { res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Tercihler kaydedilemedi.") }); }
});
app.post("/api/masa/:masaNo/zeka-oturumu/oner", masaZekasiLimiti, opsiyonelKullaniciMiddleware(), async (req, res) => {
  try {
    const masaNo = masaZekasiErisiminiDogrula(req, res); if (!masaNo) return;
    await suresiDolanStokRezervasyonlariniBirak(req.isletme.id);
    const [tercihler, urunler, kampanyalar, masalar, oturum] = await Promise.all([
      masaZekasiOrtakTercihleriniGetir(req.isletme.id, pool, masaNo, req.body?.cihazAnahtari),
      urunleriGetir(req.isletme.id), kampanyalariGetir(req.isletme.id), tumAcikMasalar(req.isletme.id),
      masaZekasiOturumunuGetir(req.isletme.id, pool, masaNo, req.body?.cihazAnahtari),
    ]);
    res.json({ ...masaPlaniOlustur({ urunler, kampanyalar, masalar, tercihler, uye: Boolean(req.kullanici) }), oturum });
  } catch (e) { res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Ortak sipariş planı oluşturulamadı.") }); }
});
app.get("/api/oneriler", masaZekasiLimiti, opsiyonelKullaniciMiddleware(), async (req, res) => {
  try {
    const urunIdleri = String(req.query.urunler || "")
      .split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 30);
    const { urunler, indirimAyari } = await onerileriGetir(req.isletme.id, urunIdleri);
    const oturum = await oneriOturumuOlustur(pool, {
      isletmeId: req.isletme.id,
      kullaniciId: req.kullanici?.id || null,
      kaynakUrunIdleri: urunIdleri,
      onerilenUrunIdleri: urunler.map((urun) => Number(urun.id)),
    });
    const oneriReferansi = oturum ? oneriReferansiOlustur({
      oturumId: oturum.id, isletmeId: req.isletme.id, urunIdleri: oturum.urunIdleri,
      indirimYuzde: indirimAyari.aktif ? indirimAyari.indirimYuzde : 0,
    }) : null;
    res.json({ urunler, oneriReferansi, indirimAyari, sonGecerlilik: oturum?.sonGecerlilik || null });
  } catch (e) {
    res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Öneriler hazırlanamadı."), ...(e.kod ? { kod: e.kod } : {}) });
  }
});
app.post("/api/oneriler/olay", oneriOlayLimiti, async (req, res) => {
  try {
    const urunId = Number(req.body?.urunId);
    const referans = oneriReferansiniDogrula(req.body?.referans, { isletmeId: req.isletme.id, urunId });
    const sonuc = await oneriOlayiKaydet(pool, {
      isletmeId: req.isletme.id,
      oturumId: referans.sid,
      urunId,
      olayTuru: req.body?.olay,
      adet: req.body?.adet || 1,
      olayAnahtari: req.body?.olayAnahtari,
    });
    res.status(sonuc.kaydedildi ? 201 : 200).json(sonuc);
  } catch (e) {
    res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Öneri olayı kaydedilemedi."), ...(e.kod ? { kod: e.kod } : {}) });
  }
});
app.get("/api/kategoriler", async (req, res) => {
  res.json({ kategoriler: await kategorileriGetir(req.isletme.id) });
});
app.get("/api/duyurular", async (req, res) => {
  res.json({ duyurular: await duyurulariGetir(req.isletme.id) });
});
app.get("/api/kampanyalar", async (req, res) => { res.json({ kampanyalar: await kampanyalariGetir(req.isletme.id) }); });
app.get("/api/sadakat-ayari", async (req, res) => {
  res.json({ damgaKarti: await sadakatAyariniGetir(req.isletme.id, pool) });
});

function idempotencyAktoru(req, yedekTur, yedekId) {
  if (req.kullanici?.id) return { aktorTuru: "kullanici", aktorId: String(req.kullanici.id) };
  return { aktorTuru: yedekTur, aktorId: String(yedekId || "anonim") };
}

async function idempotentYanitiGonder(req, res, kapsam, aktor, islem) {
  const anahtar = req.get("Idempotency-Key");
  const sonuc = await idempotentIslemCalistir(pool, {
    isletmeId: req.isletme.id,
    kapsam,
    anahtar,
    ...aktor,
    istekOzeti: idempotencyIstegiOzeti({
      metot: req.method,
      yol: String(req.originalUrl || req.path).split("?")[0],
      govde: req.body ?? null,
    }),
  }, () => islem(String(anahtar).trim()));
  res.set("Idempotency-Key", String(anahtar).trim());
  res.set("Idempotency-Replayed", sonuc.tekrar ? "true" : "false");
  return res.status(sonuc.durumKodu).json(sonuc.govde);
}

// Ödeme sağlayıcısı bağlanmadan önce de sipariş ve tutar backend'de güvenli
// taslak olarak hazırlanır. İyzico entegrasyonunda yalnızca onay endpointi
// değişecek; taslak ve mutfağa aktarım akışı aynı kalacak.
app.post("/api/odeme/taslak", opsiyonelKullaniciMiddleware(), async (req, res) => {
  try {
    const kullanici = req.kullanici || null;
    await idempotentYanitiGonder(
      req,
      res,
      "odeme-taslagi",
      idempotencyAktoru(req, req.body?.masaNo ? "masa" : "misafir", req.body?.masaNo || "algotur"),
      async (istekAnahtari) => {
        const kisiAdi = kullanici ? `${kullanici.ad} ${kullanici.soyad}` : "Misafir";
        const odeme = await odemeTaslagiOlustur(req.isletme.id, {
          kullaniciId: kullanici?.id || null,
          masaNo: req.body?.masaNo || null,
          yontem: req.body?.yontem,
          urunler: req.body?.urunler,
          kisiAdi,
          idempotencyAnahtari: istekAnahtari,
        });
        return { durumKodu: 201, govde: { odeme } };
      },
    );
  } catch (e) {
    res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Ödeme taslağı oluşturulamadı."), ...(e.kod ? { kod: e.kod } : {}) });
  }
});

// Yalnızca geliştirmede gerçek ödeme sağlayıcısı yerine akışı test eder.
// Render/production ortamında kapalıdır; İyzico sonucu bu endpointin yerini alır.
app.post("/api/odeme/:id/simulasyon-onay", opsiyonelKullaniciMiddleware(), async (req, res) => {
  if (URETIM || process.env.ODEME_SIMULASYON_AKTIF !== "true") {
    return res.status(404).json({ hata: "Kaynak bulunamadi." });
  }
  try {
    await idempotentYanitiGonder(
      req, res, "odeme-simulasyon-onay",
      idempotencyAktoru(req, "odeme", req.params.id),
      async () => {
        const sonuc = await odemeSimulasyonOnayla(req.isletme.id, req.params.id, req.kullanici?.id || null);
        const odeme = sonuc.odeme;
        await onaylananOdemeyiMutfagaAktar(odeme);
        return { durumKodu: 200, govde: { odeme: { ...odeme, mutfagaAktarildi: true } } };
      },
    );
  } catch (e) {
    res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Test ödemesi onaylanamadı."), ...(e.kod ? { kod: e.kod } : {}) });
  }
});

app.post("/api/odeme/:id/cuzdan-onay", korumaliMiddleware(), async (req, res) => {
  try {
    await idempotentYanitiGonder(
      req, res, "odeme-cuzdan-onay", idempotencyAktoru(req, "odeme", req.params.id),
      async () => {
        const ayar = await cuzdanAyariniGetir(req.isletme.id, pool);
        if (!ayar.aktif) {
          const hata = new Error("Cüzdan ödemeleri şu anda kullanılamıyor.");
          hata.status = 403;
          throw hata;
        }
        const sonuc = await odemeCuzdanlaOnayla(req.isletme.id, req.params.id, req.kullanici.id);
        const odeme = sonuc.odeme;
        await onaylananOdemeyiMutfagaAktar(odeme);
        const cuzdan = await cuzdanOzetiniGetir(req.isletme.id, pool, req.kullanici.id);
        return { durumKodu: 200, govde: { odeme: { ...odeme, mutfagaAktarildi: true }, cuzdan } };
      },
    );
  } catch (e) {
    res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Cüzdan ödemesi tamamlanamadı."), ...(e.kod ? { kod: e.kod } : {}) });
  }
});

app.post("/api/odeme/:id/iyzico-baslat", opsiyonelKullaniciMiddleware(), async (req, res) => {
  try {
    await idempotentYanitiGonder(
      req, res, "iyzico-baslat", idempotencyAktoru(req, "odeme", req.params.id),
      async () => {
        const odeme = await odemeGetir(req.isletme.id, req.params.id);
        if (!odeme) {
          const hata = new Error("Ödeme taslağı bulunamadı."); hata.status = 404; throw hata;
        }
        if (odeme.kullaniciId && !req.kullanici) {
          const hata = new Error("Bu ödeme için giriş gerekli."); hata.status = 401; throw hata;
        }
        if (req.kullanici && odeme.kullaniciId && Number(req.kullanici.id) !== Number(odeme.kullaniciId)) {
          const hata = new Error("Bu ödeme taslağı başka bir hesaba ait."); hata.status = 403; throw hata;
        }
        if (odeme.durum !== "bekliyor") throw new Error("Bu ödeme taslağı yeniden başlatılamaz.");
        const baslatim = await odemeIyzicoBaslatiminiTalepEt(req.isletme.id, odeme.id);
        if (baslatim.durum === "tamamlandi") {
          return { durumKodu: 200, govde: { paymentPageUrl: baslatim.paymentPageUrl } };
        }
        if (baslatim.durum !== "alindi") {
          const hata = new Error("Bu odeme icin odeme sayfasi zaten hazirlaniyor.");
          hata.status = 409;
          hata.kod = "PAYMENT_SESSION_IN_PROGRESS";
          throw hata;
        }
        try {
          const form = await iyzicoCheckoutBaslat(odeme, req.body?.alici, req.ip);
          await odemeSaglayiciTokenKaydet(req.isletme.id, odeme.id, form.token, form.paymentPageUrl);
          return { durumKodu: 200, govde: { paymentPageUrl: form.paymentPageUrl } };
        } catch (hata) {
          await odemeIyzicoBaslatiminiBirak(req.isletme.id, odeme.id).catch(() => {});
          throw hata;
        }
      },
    );
  } catch (e) {
    console.error("İyzico ödeme formu başlatılamadı:", {
      mesaj: e.message,
      kod: e.iyzicoKod || "yok",
      ortam: String(process.env.IYZICO_BASE_URL || "sandbox").trim(),
    });
    res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "İyzico ödeme formu başlatılamadı."), ...(e.kod ? { kod: e.kod } : {}) });
  }
});

app.post("/api/odeme/iyzico/callback", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  let odeme = null;
  try {
    if (!token) throw new Error("İyzico ödeme tokenı bulunamadı.");
    odeme = await iyzicoTokeniyleOdemeGetir(token);
    if (!odeme) throw new Error("Ödeme oturumu bulunamadı.");
    const callbackIsletmesi = await isletmeIdIleGetir(odeme.isletmeId);
    if (!callbackIsletmesi?.aktif) throw new Error("Ödemeye ait işletme bulunamadı.");
    odeme.slug = callbackIsletmesi.slug;
    await iyzicoOdemesiniKesinlestir(odeme, token);
    res.redirect(303, iyzicoDonusAdresi(odeme.slug, odeme.id));
  } catch (e) {
    console.error("İyzico callback:", e.message);
    const donus = iyzicoDonusAdresi(odeme?.slug || "burger-plus", odeme?.id || "");
    const ayirac = donus.includes("?") ? "&" : "?";
    res.redirect(303, `${donus}${ayirac}odemeHatasi=${encodeURIComponent("Ödeme onaylanamadı.")}`);
  }
});

// Callback ağ/proxy/yönlendirme nedeniyle tamamlanamazsa sonuç sayfası aynı
// token'ı sunucu tarafında İyzico'dan sorgulayarak ödemeyi güvenle kesinleştirir.
app.post("/api/odeme/:id/iyzico-dogrula", opsiyonelKullaniciMiddleware(), async (req, res) => {
  try {
    await idempotentYanitiGonder(
      req, res, "iyzico-dogrula", idempotencyAktoru(req, "odeme", req.params.id),
      async () => {
        const odeme = await odemeGetir(req.isletme.id, req.params.id);
        if (!odeme) {
          const hata = new Error("Ödeme bulunamadı."); hata.status = 404; throw hata;
        }
        if (odeme.kullaniciId && !req.kullanici) {
          const hata = new Error("Bu ödeme için giriş gerekli."); hata.status = 401; throw hata;
        }
        if (req.kullanici && odeme.kullaniciId && Number(req.kullanici.id) !== Number(odeme.kullaniciId)) {
          const hata = new Error("Bu ödeme başka bir hesaba ait."); hata.status = 403; throw hata;
        }
        if (odeme.durum === "basarili") {
          await onaylananOdemeyiMutfagaAktarGuvenli(odeme);
          return { durumKodu: 200, govde: { odeme } };
        }
        const token = await odemeSaglayiciTokeniniGetir(req.isletme.id, odeme.id);
        if (!token) {
          const hata = new Error("İyzico ödeme oturumu henüz hazır değil."); hata.status = 409; throw hata;
        }
        const kesinlesen = await iyzicoOdemesiniKesinlestir(odeme, token);
        return { durumKodu: 200, govde: { odeme: kesinlesen } };
      },
    );
  } catch (e) {
    console.error("İyzico ödeme yeniden doğrulama:", { odemeId: req.params.id, mesaj: e.message });
    res.status(e.status || 409).json({ hata: istemciHataMesaji(e, "Ödeme henüz doğrulanamadı."), ...(e.kod ? { kod: e.kod } : {}) });
  }
});

// FRONTEND_URL geçmişte protokolsüz girildiyse Express mutlak Vercel adresini
// backend altında göreli bir yol sanıyordu. Eski dönüş linklerini güvenli,
// yapılandırılmış frontend adresine taşıyan uyumluluk rotası.
app.get("/api/odeme/iyzico/:yanlisHost/odeme-basarili", (req, res) => {
  const odemeId = String(req.query?.odeme || "").trim();
  const slug = String(req.query?.isletme || "burger-plus").trim();
  res.redirect(303, iyzicoDonusAdresi(slug, odemeId));
});

app.get("/api/odeme/:id/sonuc", opsiyonelKullaniciMiddleware(), async (req, res) => {
  let odeme = await odemeGetir(req.isletme.id, req.params.id);
  if (!odeme) return res.status(404).json({ hata: "Ödeme bulunamadı." });
  if (odeme.kullaniciId && !req.kullanici) return res.status(401).json({ hata: "Bu ödeme için giriş gerekli." });
  if (req.kullanici && odeme.kullaniciId && Number(req.kullanici.id) !== Number(odeme.kullaniciId)) {
    return res.status(403).json({ hata: "Bu ödeme başka bir hesaba ait." });
  }
  // Sağlayıcı ödemeyi onayladıktan sonra mutfak aktarımı geçici bir DB/socket
  // hatasıyla yarıda kalmış olabilir. Kalem ekleme işlemi ödeme kimliğiyle
  // idempotent olduğundan sonuç sorgusu güvenle yeniden deneyebilir.
  if (odeme.durum === "basarili" && !odeme.mutfagaAktarildi) {
    await onaylananOdemeyiMutfagaAktarGuvenli(odeme);
    odeme = await odemeGetir(req.isletme.id, req.params.id) || odeme;
  }
  res.json({ odeme });
});

app.post("/api/yerel-admin-kurulum", yerelAdminKurulum);
app.get("/api/yerel-admin-durum", async (req, res) => {
  const ip = req.socket.remoteAddress || "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) return res.json({ kurulumGerekli: false });
  res.json({ kurulumGerekli: await yerelAdminKurulumGerekli(req.isletme.id) });
});

async function yerelAdminKurulum(req, res) {
  try {
    const ip = req.socket.remoteAddress || "";
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) {
      return res.status(403).json({ hata: "İlk admin kurulumu yalnızca bu bilgisayardan yapılabilir." });
    }
    await ilkYerelAdminOlustur(req.isletme.id, req.body || {});
    res.json({ basarili: true });
  } catch (e) {
    res.status(400).json({ hata: istemciHataMesaji(e, "İlk yönetici oluşturulamadı.") });
  }
}

const admin = adminMiddleware();
const guvenli = (islem) => async (req, res) => {
  try {
    const veri = await islem(req, res);
    if (!res.headersSent) res.json(veri ?? { basarili: true });
  } catch (e) {
    console.error("Admin API:", e.message);
    if (!res.headersSent) res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "İşlem tamamlanamadı."), ...(e.kod ? { kod: e.kod } : {}) });
  }
};

const salonRolu = () => rolMiddleware(["salon", "kasiyer"]);
const operasyonNabziDegisikliginiYayinla = (tenantId, tur, detay = {}) => {
  io.to(oda(tenantId, "yonetim")).emit("operasyon-nabzi-guncellendi", {
    tur,
    ...detay,
    zaman: new Date().toISOString(),
  });
};

const nakitDegisikliginiYayinla = (tenantId, masaNo, siparis = null) => {
  io.to(oda(tenantId, "salon")).emit("nakit-guncellendi", { masaNo });
  if (masaNo) {
    io.to(oda(tenantId, `masa-${masaNo}`)).emit("nakit-masa-guncellendi", {
      masaNo,
      ...(siparis ? { siparis } : {}),
    });
  }
  operasyonNabziDegisikliginiYayinla(tenantId, "nakit", {
    masaNo,
    ...(siparis?.siparisNo ? { siparisNo: siparis.siparisNo } : {}),
    ...(siparis?.durum ? { durum: siparis.durum } : {}),
  });
};

app.get("/api/sikayetlerim", korumaliMiddleware(), async (req, res) => {
  try {
    res.json({ sikayetler: await musteriSikayetleriniGetir(req.isletme.id, pool, req.kullanici.id) });
  } catch (e) { res.status(400).json({ hata: istemciHataMesaji(e, "Şikayetler alınamadı.") }); }
});

app.post(
  "/api/sikayet-gorseli",
  dosyaYuklemeLimiti,
  sikayetLimiti,
  korumaliMiddleware(),
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "5mb" }),
  async (req, res) => {
    try {
      const gorselUrl = await sikayetGorseliYukle(req.body, req.isletme.id, req.kullanici.id, req.headers["content-type"]);
      res.status(201).json({ gorselUrl });
    } catch (e) { res.status(400).json({ hata: istemciHataMesaji(e, "Görsel yüklenemedi.") }); }
  }
);

app.post("/api/sikayetler", sikayetLimiti, korumaliMiddleware(), async (req, res) => {
  try {
    if (!sikayetGorseliKullaniciyaAitMi(req.body?.gorselUrl, req.isletme.id, req.kullanici.id)) {
      return res.status(400).json({ hata: "Şikayet görseli bu kullanıcıya ait değil." });
    }
    const sikayet = await sikayetOlustur(req.isletme.id, pool, req.kullanici.id, req.body || {});
    io.to(oda(req.isletme.id, "yonetim")).emit("sikayetler-guncellendi", { id: sikayet.id, durum: sikayet.durum });
    res.status(201).json({ sikayet });
  } catch (e) { res.status(e.status || 400).json({ hata: istemciHataMesaji(e, "Şikayet gönderilemedi.") }); }
});

app.get("/api/nakit/masa/:masaNo/durum", guvenli(async (req, res) => {
  const masaNo = guvenliMasaNo(req.params.masaNo);
  if (!masaNo) return res.status(400).json({ hata: "Masa numarasi gecersiz." });
  if (!masaErisimTokeniniDogrula(req.headers["x-masa-token"], req.isletme.id, masaNo)) {
    return res.status(403).json({ hata: "Masa QR erisimi gecersiz." });
  }
  return nakitMasaDurumunuGetir(req.isletme.id, masaNo);
}));

app.post("/api/nakit/siparis", nakitSiparisLimiti, opsiyonelKullaniciMiddleware(), guvenli(async (req, res) => {
  const kullanici = req.kullanici || null;
  return idempotentYanitiGonder(
    req, res, "nakit-siparis", idempotencyAktoru(req, "masa", req.body?.masaNo),
    async (istekAnahtari) => {
      const siparis = await nakitSiparisOlustur(req.isletme.id, {
        kullaniciId: kullanici?.id || null,
        masaNo: req.body?.masaNo,
        urunler: req.body?.urunler,
        kisiAdi: kullanici ? `${kullanici.ad} ${kullanici.soyad}`.trim() : "Misafir",
        idempotencyAnahtari: istekAnahtari,
      });
      nakitDegisikliginiYayinla(req.isletme.id, siparis.masaNo, siparis);
      return { durumKodu: 201, govde: { siparis } };
    },
  );
}));

app.get("/api/nakit/masalar", salonRolu(), guvenli(async (req) => ({
  masalar: await nakitMasalariniGetir(req.isletme.id),
})));

app.post("/api/nakit/masalar/:masaNo/ac", salonRolu(), guvenli(async (req) => {
  const masa = await nakitMasasiniAc(req.isletme.id, req.params.masaNo, req.kullanici.id);
  nakitDegisikliginiYayinla(req.isletme.id, masa.masaNo);
  return { masa };
}));

app.post("/api/nakit/siparis/:id/onayla", salonRolu(), guvenli(async (req, res) => {
  return idempotentYanitiGonder(req, res, "nakit-siparis-onay", idempotencyAktoru(req, "personel", "bilinmiyor"), async () => {
    const siparis = await nakitSiparisiOnayla(req.isletme.id, req.params.id);
    await onaylananOdemeyiMutfagaAktar(siparis);
    nakitDegisikliginiYayinla(req.isletme.id, siparis.masaNo, { ...siparis, durum: "nakit_bekliyor" });
    return { durumKodu: 200, govde: { siparis: { ...siparis, durum: "nakit_bekliyor", mutfagaAktarildi: true } } };
  });
}));

app.post("/api/nakit/siparis/:id/reddet", salonRolu(), guvenli(async (req, res) => {
  return idempotentYanitiGonder(req, res, "nakit-siparis-red", idempotencyAktoru(req, "personel", "bilinmiyor"), async () => {
    const siparis = await nakitSiparisiReddet(req.isletme.id, req.params.id);
    nakitDegisikliginiYayinla(req.isletme.id, siparis.masaNo, siparis);
    return { durumKodu: 200, govde: { siparis } };
  });
}));

app.post("/api/nakit/siparis/:id/tahsil", salonRolu(), guvenli(async (req, res) => {
  return idempotentYanitiGonder(req, res, "nakit-siparis-tahsil", idempotencyAktoru(req, "personel", "bilinmiyor"), async () => {
    const sonuc = await nakitSiparisiTahsilEt(req.isletme.id, req.params.id);
    const siparis = sonuc.odeme;
    nakitDegisikliginiYayinla(req.isletme.id, siparis.masaNo, siparis);
    return { durumKodu: 200, govde: { siparis } };
  });
}));

app.get("/api/kasa/cuzdan/musteriler", salonRolu(), guvenli(async (req) => ({
  musteriler: await kasaMusteriAra(req.isletme.id, pool, req.query.q),
})));

app.get("/api/kasa/cuzdan/son-yuklemeler", salonRolu(), guvenli(async (req) => ({
  yuklemeler: await kasaSonYuklemeleriGetir(req.isletme.id, pool),
  ayar: await cuzdanAyariniGetir(req.isletme.id, pool),
})));

app.post("/api/kasa/cuzdan/yukle", salonRolu(), guvenli(async (req) => {
  const t = req.isletme.id;
  const yukleme = await kasadanCuzdanYukle(t, pool, req.kullanici.id, req.body || {});
  io.to(oda(t, `kullanici-${Number(req.body?.kullaniciId)}`)).emit("cuzdan-guncellendi", { bakiye: yukleme.bakiye });
  io.to(oda(t, "salon")).emit("cuzdan-kasa-guncellendi", { kullaniciId: Number(req.body?.kullaniciId) });
  return { yukleme };
}));

const superAdmin = superAdminMiddleware();
const MUTASYON_METOTLARI = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function denetimIcinTemizle(deger, derinlik = 0) {
  if (derinlik > 4 || deger == null) return deger;
  if (Array.isArray(deger)) return deger.slice(0, 30).map((oge) => denetimIcinTemizle(oge, derinlik + 1));
  if (typeof deger !== "object") return typeof deger === "string" ? deger.slice(0, 500) : deger;
  return Object.fromEntries(Object.entries(deger).slice(0, 50).map(([anahtar, icerik]) => [
    anahtar,
    /(sifre|token|secret|sirri|kod)/i.test(anahtar) ? "[GİZLİ]" : denetimIcinTemizle(icerik, derinlik + 1),
  ]));
}

function superAdminDenetimMiddleware(req, res, next) {
  if (!MUTASYON_METOTLARI.has(req.method)) return next();
  res.on("finish", () => {
    if (!req.superAdmin?.id || res.locals.denetimAtla) return;
    superAdminKaydiEkle(req.superAdmin.id, {
      islem: res.locals.denetimIslemi || `${req.method} ${req.originalUrl.split("?")[0]}`,
      hedefIsletmeId: res.locals.hedefIsletmeId || null,
      detay: { durum: res.statusCode, girdi: denetimIcinTemizle(req.body || {}), ...(res.locals.denetimDetay || {}) },
      ip: req.ip || req.socket.remoteAddress || "",
    }).catch((hata) => console.error("Super admin denetim kaydı yazılamadı:", hata.message));
  });
  next();
}

// Super admin uçları tenant bağlamından bağımsızdır. Kimlik uçları hariç tümü
// yalnızca tip='super-admin' olan kısa ömürlü token ile açılır.
app.use("/api/super", superAdminDenetimMiddleware);

app.post("/api/super/giris", superAdminGirisLimiti, guvenli(async (req, res) => {
  const sonuc = await superAdminGiris(req.body?.email, req.body?.sifre);
  if (sonuc.hata) return res.status(401).json(sonuc);
  return sonuc;
}));

app.post("/api/super/giris/iki-faktor", superAdminGirisLimiti, guvenli(async (req, res) => {
  const sonuc = await superAdminIkiFaktorGirisiniTamamla(req.body?.ikiFaktorToken, req.body?.kod);
  if (sonuc.hata) return res.status(401).json(sonuc);
  req.superAdmin = sonuc.superAdmin;
  res.locals.denetimIslemi = "super-admin-giris";
  return sonuc;
}));

app.get("/api/super/ben", superAdmin, (req, res) => res.json({ superAdmin: req.superAdmin }));
app.post("/api/super/cikis", superAdmin, (req, res) => {
  res.locals.denetimIslemi = "super-admin-cikis";
  res.json({ basarili: true });
});

app.get("/api/super/slug-kontrol", superAdmin, guvenli(async (req) => {
  const sonuc = await slugMusaitlikDurumu(req.query.slug);
  return { ...sonuc, uretilenSlug: slugOlustur(req.query.slug) };
}));
app.post("/api/super/isletmeler/kurulum", superAdmin, guvenli(async (req, res) => {
  const sonuc = await isletmeKurulumunuYap(
    req.superAdmin.id,
    req.body || {},
    req.ip || req.socket.remoteAddress || ""
  );
  (async () => {
    await eksikCevirileriTamamla(sonuc.isletme.id);
    await sadakatCevirisiniTamamla(sonuc.isletme.id, pool);
    await isletmeTemaCevirisiniTamamla(sonuc.isletme.id);
  })().catch((hata) => console.error(`Yeni işletme çevirileri tamamlanamadı -> ${sonuc.isletme.id}:`, hata.message));
  // Bu işlem günlüğü kurulum transaction'ı içinde yazıldı; ikinci bir kayıt oluşturma.
  res.locals.denetimAtla = true;
  return sonuc;
}));

app.get("/api/super/isletmeler", superAdmin, guvenli(async () => ({ isletmeler: await superIsletmeleriGetir() })));
app.get("/api/super/isletmeler/:id", superAdmin, guvenli(async (req) => {
  const isletme = await superIsletmeDetayiGetir(req.params.id);
  if (!isletme) throw new Error("İşletme bulunamadı.");
  return { isletme, tema: temaCoz(isletme) };
}));
app.post("/api/super/isletmeler", superAdmin, guvenli(async (req, res) => {
  let isletme;
  const olusan = await isletmeOlustur({
    slug: req.body?.slug, ad: req.body?.ad, konsept: req.body?.konsept,
    aktif: req.body?.aktif !== false, tema: {},
  }, async (baglanti, temelIsletme) => {
    isletme = await superIsletmeBilgileriniGuncelle(temelIsletme.id, req.body || {}, baglanti);
    await abonelikOlustur({
      isletmeId: temelIsletme.id, plan: req.body?.plan || "baslangic", aylikUcret: req.body?.aylikUcret || 0,
      durum: req.body?.abonelikDurumu || "deneme", baslangicTarihi: new Date().toISOString().slice(0, 10),
      bitisTarihi: req.body?.bitisTarihi || null, notlar: req.body?.abonelikNotlari || "",
    }, baglanti);
  });
  res.locals.hedefIsletmeId = olusan.id;
  res.locals.denetimIslemi = "isletme-olusturma";
  res.locals.denetimDetay = { slug: olusan.slug };
  return { isletme: await superIsletmeDetayiGetir(olusan.id), tema: temaCoz(isletme) };
}));
app.put("/api/super/isletmeler/:id", superAdmin, guvenli(async (req, res) => {
  const isletme = await superIsletmeBilgileriniGuncelle(req.params.id, req.body || {});
  res.locals.hedefIsletmeId = isletme.id;
  res.locals.denetimIslemi = "isletme-guncelleme";
  return { isletme, tema: temaCoz(isletme) };
}));
app.patch("/api/super/isletmeler/:id/durum", superAdmin, guvenli(async (req, res) => {
  if (typeof req.body?.aktif !== "boolean") throw new Error("aktif alanı boolean olmalıdır.");
  const isletme = await superIsletmeDurumunuGuncelle(req.params.id, req.body.aktif);
  res.locals.hedefIsletmeId = isletme.id;
  res.locals.denetimIslemi = req.body.aktif ? "isletme-aktiflestirme" : "isletme-askiya-alma";
  return { isletme };
}));
app.delete("/api/super/isletmeler/:id", superAdmin, async (req, res) => {
  try {
    const ozet = await superIsletmeSilmeOzeti(req.params.id);
    res.locals.hedefIsletmeId = ozet.id;
    res.locals.denetimIslemi = "isletme-silme-denemesi";
    if (!req.body?.onaySlug || req.body.onaySlug !== ozet.slug) {
      return res.status(400).json({ hata: "Silme onayı için işletme slug'ını birebir yazın.", onayGerekli: true, silmeOzeti: ozet });
    }
    const silme = await superIsletmeyiYumusakSil(req.params.id);
    res.locals.denetimIslemi = "isletme-yumusak-silme";
    res.locals.denetimDetay = { slug: ozet.slug, silmeOzeti: ozet, kaliciSilinmeTarihi: silme.kaliciSilinmeTarihi };
    res.json({ basarili: true, silmeOzeti: ozet, ...silme });
  } catch (hata) {
    res.status(400).json({ hata: hata.message });
  }
});

// İşletmenin yönetici hesabı: super admin e-posta ve şifreyi belirler,
// işletme sahibi bu bilgilerle kendi paneline girer.
app.get("/api/super/isletmeler/:id/admin", superAdmin, guvenli(async (req) => ({
  adminler: await isletmeAdminleriniGetir(req.params.id),
})));
app.post("/api/super/isletmeler/:id/admin", superAdmin, guvenli(async (req, res) => {
  const sonuc = await isletmeAdminHesabiniAyarla(req.params.id, req.body || {});
  res.locals.hedefIsletmeId = Number(req.params.id);
  res.locals.denetimIslemi = sonuc.olusturuldu ? "isletme-admin-olusturma" : "isletme-admin-sifre-yenileme";
  // Şifre denetim günlüğüne yazılmaz; denetimIcinTemizle zaten maskeliyor.
  res.locals.denetimDetay = { adminEmail: sonuc.admin.email };
  return sonuc;
}));
app.put("/api/super/isletmeler/:id/admin/:adminId", superAdmin, guvenli(async (req, res) => {
  const sonuc = await isletmeAdmininiGuncelle(req.params.id, req.params.adminId, req.body || {});
  res.locals.hedefIsletmeId = Number(req.params.id);
  res.locals.denetimIslemi = "isletme-admin-guncelleme";
  res.locals.denetimDetay = { adminId: Number(req.params.adminId), adminEmail: sonuc.admin.email, sifreYenilendi: sonuc.sifreYenilendi };
  return sonuc;
}));
app.delete("/api/super/isletmeler/:id/admin/:adminId", superAdmin, guvenli(async (req, res) => {
  const sonuc = await isletmeAdmininiSil(req.params.id, req.params.adminId);
  res.locals.hedefIsletmeId = Number(req.params.id);
  res.locals.denetimIslemi = "isletme-admin-silme";
  res.locals.denetimDetay = { adminId: sonuc.adminId, adminEmail: sonuc.email };
  return sonuc;
}));

app.get("/api/super/ozet", superAdmin, guvenli(() => platformOzetiniGetir()));
app.get("/api/super/rapor/ciro", superAdmin, guvenli((req) => ciroRaporunuGetir(req.query.gun, req.query.baslangic, req.query.bitis)));
app.get("/api/super/rapor/buyume", superAdmin, guvenli((req) => buyumeRaporunuGetir(req.query.ay)));
app.get("/api/super/rapor/siparis", superAdmin, guvenli((req) => siparisRaporunuGetir(req.query.gun, req.query.baslangic, req.query.bitis)));
app.get("/api/super/rapor/kullanici", superAdmin, guvenli((req) => kullaniciRaporunuGetir(req.query.baslangic, req.query.bitis)));

app.get("/api/super/abonelikler", superAdmin, guvenli(async () => ({ abonelikler: await abonelikleriGetir() })));
app.post("/api/super/abonelikler", superAdmin, guvenli(async (req, res) => {
  const abonelik = await abonelikOlustur(req.body || {});
  res.locals.hedefIsletmeId = abonelik.isletmeId;
  res.locals.denetimIslemi = "abonelik-olusturma";
  return { abonelik };
}));
app.put("/api/super/abonelikler/:id", superAdmin, guvenli(async (req, res) => {
  const abonelik = await abonelikGuncelle(req.params.id, req.body || {});
  res.locals.hedefIsletmeId = abonelik.isletmeId;
  res.locals.denetimIslemi = "abonelik-guncelleme";
  return { abonelik };
}));
app.get("/api/super/gelir", superAdmin, guvenli((req) => gelirRaporunuGetir(req.query.ay)));

app.get("/api/super/basvurular", superAdmin, guvenli(async (req) => ({
  basvurular: await superBasvurulariGetir(pool, req.query || {}),
  ozet: await superBasvuruOzetiniGetir(pool),
})));
app.patch("/api/super/basvurular/:id", superAdmin, guvenli(async (req, res) => {
  const basvuru = await superBasvuruGuncelle(pool, req.params.id, req.body || {}, req.superAdmin.id);
  res.locals.denetimIslemi = "satis-basvurusu-guncelleme";
  res.locals.denetimDetay = { basvuruId: basvuru.id, durum: basvuru.durum };
  return { basvuru };
}));

app.post("/api/super/isletmeler/:id/erisim-tokeni", superAdmin, guvenli(async (req, res) => {
  const isletme = await superIsletmeDetayiGetir(req.params.id);
  if (!isletme || isletme.silinmeTarihi) throw new Error("İşletme bulunamadı veya silinmek üzere işaretli.");
  const token = superAdminErisimTokeniUret(req.superAdmin.id, isletme);
  res.locals.hedefIsletmeId = isletme.id;
  res.locals.denetimIslemi = "isletme-adina-erisim";
  res.locals.denetimDetay = { slug: isletme.slug, sureDakika: 30 };
  return { token, sonGecerlilikDakika: 30, isletme: { id: isletme.id, slug: isletme.slug, ad: isletme.ad } };
}));
app.post("/api/super/isletmeler/:id/masa-erisim-tokenlari", superAdmin, guvenli(async (req, res) => {
  const isletme = await superIsletmeDetayiGetir(req.params.id);
  if (!isletme || isletme.silinmeTarihi) throw new Error("Isletme bulunamadi veya silinmek uzere isaretli.");
  const adet = Math.min(500, Math.max(1, Number(req.body?.masaSayisi) || Number(isletme.masaSayisi) || 10));
  res.locals.hedefIsletmeId = isletme.id;
  res.locals.denetimIslemi = "masa-qr-tokenlari-uretme";
  return {
    tokenlar: Array.from({ length: adet }, (_, indeks) => {
      const masaNo = String(indeks + 1);
      return { masaNo, token: masaErisimTokeniUret(isletme.id, masaNo) };
    }),
  };
}));
app.get("/api/super/kayitlar", superAdmin, guvenli(async (req) => ({
  kayitlar: await superAdminKayitlariniGetir({
    limit: req.query.limit, islem: req.query.islem, isletmeId: req.query.isletmeId,
    baslangic: req.query.baslangic, bitis: req.query.bitis,
  }),
})));

// Impersonation ile yapılan işletme admini mutasyonları da platform denetim
// günlüğüne yazılır. Middleware yanıt sonunda adminMiddleware'in eklediği kimliği okur.
app.use("/api/admin", (req, res, next) => {
  if (!MUTASYON_METOTLARI.has(req.method)) return next();
  res.on("finish", () => {
    if (!req.impersonatedBy) return;
    superAdminKaydiEkle(req.impersonatedBy, {
      islem: `impersonation ${req.method} ${req.originalUrl.split("?")[0]}`,
      hedefIsletmeId: req.isletme?.id,
      detay: { durum: res.statusCode, girdi: denetimIcinTemizle(req.body || {}) },
      ip: req.ip || req.socket.remoteAddress || "",
    }).catch((hata) => console.error("Impersonation denetim kaydı yazılamadı:", hata.message));
  });
  next();
});

app.get("/api/admin/dashboard", admin, guvenli((req) => dashboardGetir(req.isletme.id)));
app.get("/api/admin/operasyon-nabzi", admin, guvenli((req) => operasyonNabziniGetir(req.isletme.id)));
app.get("/api/admin/degerlendirmeler", admin, guvenli(async (req) => ({
  rapor: await adminDegerlendirmeRaporunuGetir(req.isletme.id, pool, req.query?.gun),
})));
app.get("/api/admin/salon-krokisi", admin, guvenli(async (req) => ({ kroki: await salonKrokisiniGetir(req.isletme.id, pool) })));
app.put("/api/admin/salon-krokisi", admin, guvenli(async (req) => {
  const kroki = await salonKrokisiniKaydet(req.isletme.id, pool, req.body?.kroki || req.body);
  io.to(oda(req.isletme.id, "salon")).emit("salon-krokisi-guncellendi", kroki);
  return { kroki };
}));
app.get("/api/admin/sikayetler", admin, guvenli(async (req) => ({
  sikayetler: await adminSikayetleriniGetir(req.isletme.id, pool, req.query?.durum),
})));
app.patch("/api/admin/sikayetler/:id", admin, guvenli(async (req) => {
  const sikayet = await adminSikayetGuncelle(req.isletme.id, pool, req.params.id, req.body || {}, req.kullanici?.id);
  io.to(oda(req.isletme.id, "yonetim")).emit("sikayetler-guncellendi", { id: sikayet.id, durum: sikayet.durum });
  return { sikayet };
}));
app.get("/api/admin/ben", admin, (req, res) => res.json({ kullanici: req.kullanici, impersonation: req.impersonation || null }));
app.get("/api/admin/kurulum-ayarlari", admin, guvenli((req) => kurulumAyarlariGetir(req.isletme.id)));
app.post("/api/admin/masa-erisim-tokenlari", admin, guvenli(async (req) => {
  const adet = Math.min(500, Math.max(1, Number(req.body?.masaSayisi) || 10));
  return {
    tokenlar: Array.from({ length: adet }, (_, indeks) => {
      const masaNo = String(indeks + 1);
      return { masaNo, token: masaErisimTokeniUret(req.isletme.id, masaNo) };
    }),
  };
}));
app.put("/api/admin/tema", admin, guvenli(async (req) => {
  const isletme = await isletmeTemasiniGuncelle(req.isletme.id, req.body || {});
  const yanit = temaliIsletmeYaniti(isletme);
  io.to(oda(req.isletme.id, "genel")).emit("tema-guncellendi", yanit);
  return yanit;
}));
app.post(
  "/api/admin/logo",
  dosyaYuklemeLimiti,
  admin,
  express.raw({ type: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"], limit: "2mb" }),
  guvenli(async (req) => {
    const eskiLogo = req.isletme.logoUrl;
    const yeniLogo = await logoYukle(req.body, req.isletme.id, req.headers["content-type"]);
    let isletme;
    try {
      isletme = await isletmeLogosunuGuncelle(req.isletme.id, yeniLogo);
    } catch (hata) {
      await storageDosyasiniSil(yeniLogo).catch(() => {});
      throw hata;
    }
    if (eskiLogo && eskiLogo !== yeniLogo) {
      await storageDosyasiniSil(eskiLogo).catch((hata) => console.error("Eski logo silinemedi:", hata.message));
    }
    const yanit = temaliIsletmeYaniti(isletme);
    io.to(oda(req.isletme.id, "genel")).emit("tema-guncellendi", yanit);
    return yanit;
  })
);
app.post(
  "/api/admin/tema-arka-plani",
  dosyaYuklemeLimiti,
  admin,
  express.raw({ type: "image/*", limit: "5mb" }),
  guvenli(async (req) => {
    const eskiArkaPlan = req.isletme.tema?.arkaPlanGorseli || null;
    const yeniArkaPlan = await temaArkaPlaniYukle(req.body, req.isletme.id, req.headers["content-type"]);
    let isletme;
    try {
      isletme = await isletmeTemasiniGuncelle(req.isletme.id, { arkaPlanGorseli: yeniArkaPlan });
    } catch (hata) {
      await storageDosyasiniSil(yeniArkaPlan).catch(() => {});
      throw hata;
    }
    if (eskiArkaPlan && eskiArkaPlan !== yeniArkaPlan) {
      await storageDosyasiniSil(eskiArkaPlan).catch((hata) => console.error("Eski tema arka plani silinemedi:", hata.message));
    }
    const yanit = temaliIsletmeYaniti(isletme);
    io.to(oda(req.isletme.id, "genel")).emit("tema-guncellendi", yanit);
    return yanit;
  }),
);
app.delete("/api/admin/tema-arka-plani", admin, guvenli(async (req) => {
  const eskiArkaPlan = req.isletme.tema?.arkaPlanGorseli || null;
  const isletme = await isletmeTemasiniGuncelle(req.isletme.id, { arkaPlanGorseli: null });
  if (eskiArkaPlan) {
    await storageDosyasiniSil(eskiArkaPlan).catch((hata) => console.error("Tema arka plani silinemedi:", hata.message));
  }
  const yanit = temaliIsletmeYaniti(isletme);
  io.to(oda(req.isletme.id, "genel")).emit("tema-guncellendi", yanit);
  return yanit;
}));
app.get("/api/admin/urunler", admin, guvenli(async (req) => ({ urunler: await urunleriGetir(req.isletme.id, { tumu: true, stokDetayi: true }) })));
app.post(
  "/api/admin/menu-aktarim/analiz",
  menuAktarimLimiti,
  admin,
  express.raw({ type: ["image/png", "image/jpeg", "image/webp", "application/pdf"], limit: "8mb" }),
  guvenli(async (req) => ({ taslak: await menuGorseliniAnalizEt(req.body) }))
);
app.post("/api/admin/menu-aktarim/onayla", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const sonuc = await menuTaslaginiKaydet(t, req.body?.urunler);
  await revizyonKaydet(t, {
    yapan: req.kullanici,
    varlikTuru: "menu_aktarimi",
    varlikId: new Date().toISOString(),
    islem: "toplu_ekleme",
    aciklama: `${sonuc.eklenenler.length} ürün menü görselinden pasif taslak olarak eklendi.`,
    yeniDeger: { eklenenUrunIdleri: sonuc.eklenenler.map((urun) => urun.id), atlananSayisi: sonuc.atlananlar.length },
  });
  io.to(oda(t, "genel")).emit("urunler-guncellendi", await urunleriGetir(t));
  operasyonNabziDegisikliginiYayinla(t, "urun", { topluAktarim: true, adet: sonuc.eklenenler.length });
  return { sonuc };
}));
app.get("/api/admin/recete-stok", admin, guvenli(async (req) => receteStokMerkeziniGetir(req.isletme.id, pool)));
app.post("/api/admin/hammaddeler", admin, guvenli(async (req) => {
  const hammadde = await hammaddeKaydet(req.isletme.id, pool, req.body || {});
  io.to(oda(req.isletme.id, "yonetim")).emit("recete-stok-guncellendi");
  operasyonNabziDegisikliginiYayinla(req.isletme.id, "stok", { hammaddeId: hammadde.id });
  return { hammadde };
}));
app.post("/api/admin/hammaddeler/:id/stok-hareketi", admin, guvenli(async (req) => {
  const sonuc = await hammaddeStokHareketiKaydet(req.isletme.id, pool, req.params.id, req.body || {}, req.kullanici?.id);
  io.to(oda(req.isletme.id, "yonetim")).emit("recete-stok-guncellendi");
  operasyonNabziDegisikliginiYayinla(req.isletme.id, "stok", { hammaddeId: Number(req.params.id) });
  return sonuc;
}));
app.put("/api/admin/urunler/:id/recete", admin, guvenli(async (req) => {
  await urunRecetesiKaydet(req.isletme.id, pool, req.params.id, req.body?.satirlar || [], {
    malzemeleriOtomatikGuncelle: req.body?.malzemeleriOtomatikGuncelle !== false,
  });
  io.to(oda(req.isletme.id, "yonetim")).emit("recete-stok-guncellendi");
  operasyonNabziDegisikliginiYayinla(req.isletme.id, "stok", { urunId: Number(req.params.id) });
  return { basarili: true };
}));
app.post("/api/admin/urunler", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = req.body.id ? await yonetimVarliginiGetir(t, "urun", req.body.id) : null;
  const urun = await urunKaydet(t, req.body);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "urun", varlikId: urun.id, islem: eski ? "guncelleme" : "ekleme", aciklama: eski ? `${urun.ad} ürünü güncellendi.` : `${urun.ad} ürünü eklendi.`, eskiDeger: eski, yeniDeger: urun });
  io.to(oda(t, "genel")).emit("urunler-guncellendi", await urunleriGetir(t));
  operasyonNabziDegisikliginiYayinla(t, "urun", { urunId: urun.id });
  return { urun };
}));
app.patch("/api/admin/urunler/:id/aktif", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = await yonetimVarliginiGetir(t, "urun", req.params.id);
  await urunAktiflikDegistir(t, req.params.id, req.body.aktif);
  const yeni = await yonetimVarliginiGetir(t, "urun", req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "urun", varlikId: req.params.id, islem: "durum", aciklama: `${eski?.ad || "Ürün"} ${req.body.aktif ? "yayına alındı" : "pasife alındı"}.`, eskiDeger: eski, yeniDeger: yeni });
  io.to(oda(t, "genel")).emit("urunler-guncellendi", await urunleriGetir(t));
  operasyonNabziDegisikliginiYayinla(t, "urun", { urunId: Number(req.params.id), aktif: req.body.aktif === true });
}));
app.delete("/api/admin/urunler/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = await yonetimVarliginiGetir(t, "urun", req.params.id);
  await urunArsivle(t, req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "urun", varlikId: req.params.id, islem: "arsivleme", aciklama: `${eski?.ad || "Ürün"} katalogdan arşivlendi.`, eskiDeger: eski });
  io.to(oda(t, "genel")).emit("urunler-guncellendi", await urunleriGetir(t));
  operasyonNabziDegisikliginiYayinla(t, "urun", { urunId: Number(req.params.id), arsivli: true });
}));
app.post("/api/admin/gorseller", dosyaYuklemeLimiti, admin, express.raw({ type: "image/*", limit: "5mb" }), guvenli(async (req) => {
  const gorsel = await gorselYukle(req.body, req.headers["content-type"]);
  return { gorsel };
}));
app.post(
  "/api/admin/gider-belgesi",
  dosyaYuklemeLimiti,
  admin,
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "5mb" }),
  guvenli(async (req) => ({ belgeUrl: await giderBelgesiYukle(req.body, req.isletme.id, req.headers["content-type"]) }))
);
app.get("/api/admin/finans", admin, guvenli(async (req) => finansMerkeziniGetir(req.isletme.id, pool, req.query || {})));
app.get("/api/admin/finans/rapor", admin, guvenli(async (req) => finansRaporunuGetir(req.isletme.id, pool, req.query || {})));
app.post("/api/admin/gider-butceleri", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const butce = await giderButceleriniKaydet(t, pool, req.kullanici?.id, req.body || {});
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "gider_butcesi", varlikId: butce.donem, islem: "guncelleme", aciklama: `${butce.donem.slice(0, 7)} gider bütçesi güncellendi.`, yeniDeger: butce });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "butce", donem: butce.donem });
  return { butce };
}));
app.post("/api/admin/gider-kategorileri", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const kategori = await giderKategorisiKaydet(t, pool, req.body || {});
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "gider_kategorisi", varlikId: kategori.id, islem: req.body?.id ? "guncelleme" : "ekleme", aciklama: `${kategori.ad} gider kategorisi kaydedildi.`, yeniDeger: kategori });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "kategori", id: kategori.id });
  return { kategori };
}));
app.delete("/api/admin/gider-kategorileri/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  await giderKategorisiArsivle(t, pool, req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "gider_kategorisi", varlikId: req.params.id, islem: "arsivleme", aciklama: "Gider kategorisi arşivlendi." });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "kategori", id: Number(req.params.id) });
}));
app.post("/api/admin/tedarikciler", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const tedarikci = await tedarikciKaydet(t, pool, req.body || {});
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "tedarikci", varlikId: tedarikci.id, islem: req.body?.id ? "guncelleme" : "ekleme", aciklama: `${tedarikci.ad} tedarikçisi kaydedildi.`, yeniDeger: tedarikci });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "tedarikci", id: tedarikci.id });
  return { tedarikci };
}));
app.delete("/api/admin/tedarikciler/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  await tedarikciArsivle(t, pool, req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "tedarikci", varlikId: req.params.id, islem: "arsivleme", aciklama: "Tedarikçi arşivlendi." });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "tedarikci", id: Number(req.params.id) });
}));
app.post("/api/admin/giderler", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  if (!giderBelgesiIsletmeyeAitMi(req.body?.belgeUrl, t)) throw new Error("Gider belgesi bu işletmeye ait değil.");
  const gider = await giderKaydet(t, pool, req.kullanici?.id, req.body || {});
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "gider", varlikId: gider.id, islem: req.body?.id ? "guncelleme" : "ekleme", aciklama: `${gider.baslik} gideri onaya gönderildi.`, yeniDeger: gider });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "gider", id: gider.id });
  return { gider };
}));
app.patch("/api/admin/giderler/:id/durum", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const gider = await giderDurumuGuncelle(t, pool, req.kullanici?.id, req.params.id, req.body?.durum, req.body?.neden);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "gider", varlikId: gider.id, islem: gider.durum, aciklama: `${gider.baslik} gideri ${gider.durum}.`, yeniDeger: gider });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "gider", id: gider.id, durum: gider.durum });
  return { gider };
}));
app.delete("/api/admin/giderler/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const gider = await giderDurumuGuncelle(t, pool, req.kullanici?.id, req.params.id, "iptal", req.body?.neden);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "gider", varlikId: gider.id, islem: "iptal", aciklama: `${gider.baslik} gideri ters kayıtla iptal edildi.`, yeniDeger: gider });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "gider", id: gider.id, durum: "iptal" });
  return { gider };
}));
app.post("/api/admin/duzenli-giderler", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const id = await duzenliGiderKaydet(t, pool, req.kullanici?.id, req.body || {});
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "duzenli_gider", varlikId: id, islem: req.body?.id ? "guncelleme" : "ekleme", aciklama: `${req.body?.baslik || "Düzenli gider"} planı kaydedildi.` });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "duzenli_gider", id });
  return { id };
}));
app.delete("/api/admin/duzenli-giderler/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  await duzenliGiderArsivle(t, pool, req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "duzenli_gider", varlikId: req.params.id, islem: "arsivleme", aciklama: "Düzenli gider planı durduruldu." });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "duzenli_gider", id: Number(req.params.id) });
}));
app.post("/api/admin/tedarikciler/:id/odemeler", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const odeme = await tedarikciOdemesiKaydet(t, pool, req.kullanici?.id, req.params.id, req.body || {});
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "tedarikci_odeme", varlikId: odeme.id, islem: "ekleme", aciklama: `Tedarikçiye ${odeme.tutar} TL ödeme kaydedildi.`, yeniDeger: odeme });
  io.to(oda(t, "yonetim")).emit("finans-guncellendi", { tur: "tedarikci_odeme", id: odeme.id });
  return { odeme };
}));
app.get("/api/admin/kategoriler", admin, guvenli(async (req) => ({ kategoriler: await kategorileriGetir(req.isletme.id, { tumu: true }) })));
app.post("/api/admin/kategoriler", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = req.body.id ? await yonetimVarliginiGetir(t, "kategori", req.body.id) : null;
  const kategori = await kategoriKaydet(t, req.body);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "kategori", varlikId: kategori.id, islem: eski ? "guncelleme" : "ekleme", aciklama: `${kategori.ad} kategorisi ${eski ? "güncellendi" : "eklendi"}.`, eskiDeger: eski, yeniDeger: kategori });
  io.to(oda(t, "genel")).emit("kategoriler-guncellendi", await kategorileriGetir(t));
  io.to(oda(t, "genel")).emit("urunler-guncellendi", await urunleriGetir(t));
  return { kategori };
}));
app.delete("/api/admin/kategoriler/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = await yonetimVarliginiGetir(t, "kategori", req.params.id);
  await kategoriArsivle(t, req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "kategori", varlikId: req.params.id, islem: "arsivleme", aciklama: `${eski?.ad || "Kategori"} arşivlendi.`, eskiDeger: eski });
  io.to(oda(t, "genel")).emit("kategoriler-guncellendi", await kategorileriGetir(t));
}));
app.get("/api/admin/personeller", admin, guvenli(async (req) => ({ personeller: await personelleriGetir(req.isletme.id) })));
app.post("/api/admin/personeller", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = req.body.id ? await yonetimVarliginiGetir(t, "personel", req.body.id) : null;
  const personel = await personelKaydet(t, req.body);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "personel", varlikId: personel.id, islem: eski ? "guncelleme" : "ekleme", aciklama: `${personel.ad} ${personel.soyad} personel kaydı ${eski ? "güncellendi" : "eklendi"}.`, eskiDeger: eski, yeniDeger: personel });
  operasyonNabziDegisikliginiYayinla(t, "personel", { personelId: personel.id });
  return { personel };
}));
app.delete("/api/admin/personeller/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = await yonetimVarliginiGetir(t, "personel", req.params.id);
  await personelArsivle(t, req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "personel", varlikId: req.params.id, islem: "arsivleme", aciklama: `${eski?.ad || "Personel"} ${eski?.soyad || ""} ekipten arşivlendi.`, eskiDeger: eski });
  operasyonNabziDegisikliginiYayinla(t, "personel", { personelId: Number(req.params.id), arsivli: true });
}));
app.post("/api/admin/personeller/:id/vardiya", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  await vardiyaDegistir(t, req.params.id, req.body.islem);
  const personel = await yonetimVarliginiGetir(t, "personel", req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "vardiya", varlikId: req.params.id, islem: req.body.islem, aciklama: `${personel?.ad || "Personel"} için vardiya ${req.body.islem === "giris" ? "başlatıldı" : "kapatıldı"}.` });
  operasyonNabziDegisikliginiYayinla(t, "vardiya", { personelId: Number(req.params.id), islem: req.body.islem });
}));
app.get("/api/admin/raporlar/satis", admin, guvenli((req) => satisRaporuGetir(req.isletme.id, req.query.gun)));
app.get("/api/admin/satislar/canli", admin, guvenli(async (req) => ({ satislar: await canliSatislariGetir(req.isletme.id, req.query) })));
app.get("/api/admin/satislar/gecmis", admin, guvenli(async (req) => ({ satislar: await gecmisSatislariGetir(req.isletme.id, req.query) })));
app.get("/api/admin/kayitlar/mutfak", admin, guvenli(async (req) => ({ kayitlar: await mutfakKayitlariniGetir(req.isletme.id, req.query) })));
app.get("/api/admin/kayitlar/musteriler", admin, guvenli(async (req) => ({ musteriler: await musteriKayitlariniGetir(req.isletme.id, req.query) })));
app.get("/api/admin/kayitlar/personel", admin, guvenli(async (req) => personelKayitlariniGetir(req.isletme.id, req.query)));
app.get("/api/admin/revizyonlar", admin, guvenli(async (req) => ({ revizyonlar: await revizyonKayitlariniGetir(req.isletme.id, req.query) })));
app.get("/api/admin/duyurular", admin, guvenli(async (req) => ({ duyurular: await duyurulariGetir(req.isletme.id, { tumu: true }) })));
app.post("/api/admin/duyurular", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const duyuru = await duyuruKaydet(t, req.body);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "duyuru", varlikId: duyuru.id, islem: "ekleme", aciklama: `${duyuru.baslik} duyurusu yayınlandı.`, yeniDeger: duyuru });
  io.to(oda(t, "genel")).emit("duyurular-guncellendi", await duyurulariGetir(t));
  return { duyuru };
}));
app.delete("/api/admin/duyurular/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = await yonetimVarliginiGetir(t, "duyuru", req.params.id);
  await duyuruArsivle(t, req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "duyuru", varlikId: req.params.id, islem: "arsivleme", aciklama: `${eski?.baslik || "Duyuru"} yayından kaldırıldı.`, eskiDeger: eski });
  io.to(oda(t, "genel")).emit("duyurular-guncellendi", await duyurulariGetir(t));
}));
app.get("/api/admin/kampanyalar", admin, guvenli(async (req) => ({ kampanyalar: await kampanyalariGetir(req.isletme.id, { tumu: true }) })));
app.get("/api/admin/kampanyalar/taslak", admin, guvenli(async (req) => kampanyaTaslagiGetir(req.isletme.id, req.query.gun)));
app.get("/api/admin/oneri-indirim-ayari", admin, guvenli(async (req) => ({ ayar: await oneriIndirimAyariniGetir(req.isletme.id) })));
app.put("/api/admin/oneri-indirim-ayari", admin, guvenli(async (req) => {
  const ayar = await oneriIndirimAyariniKaydet(req.isletme.id, req.body);
  await revizyonKaydet(req.isletme.id, {
    yapan: req.kullanici, varlikTuru: "oneri_indirimi", islem: "guncelleme",
    aciklama: ayar.aktif ? `Sepete özel öneri indirimi %${ayar.indirimYuzde} olarak açıldı.` : "Sepete özel öneri indirimi kapatıldı.",
    yeniDeger: ayar,
  });
  io.to(oda(req.isletme.id, "genel")).emit("oneri-indirim-ayari-guncellendi", ayar);
  return { ayar };
}));
app.get("/api/admin/ceviri-durumu", admin, guvenli(async () => ceviriYapilandirmasi()));
app.post("/api/admin/ceviriler/tamamla", admin, guvenli(async (req) => {
  const yapilandirma = ceviriYapilandirmasi();
  if (!yapilandirma.aktif) {
    const hata = new Error("AI çevirisi için GEMINI_API_KEY tanımlanmalıdır.");
    hata.status = 503;
    throw hata;
  }
  const ozet = await eksikCevirileriTamamla(req.isletme.id);
  const sadakatCevirisi = await sadakatCevirisiniTamamla(req.isletme.id, pool);
  const temaliIsletme = await isletmeTemaCevirisiniTamamla(req.isletme.id);
  io.to(oda(req.isletme.id, "genel")).emit("urunler-guncellendi", await urunleriGetir(req.isletme.id));
  io.to(oda(req.isletme.id, "genel")).emit("kategoriler-guncellendi", await kategorileriGetir(req.isletme.id));
  io.to(oda(req.isletme.id, "genel")).emit("kampanyalar-guncellendi", await kampanyalariGetir(req.isletme.id));
  io.to(oda(req.isletme.id, "genel")).emit("duyurular-guncellendi", await duyurulariGetir(req.isletme.id));
  io.to(oda(req.isletme.id, "genel")).emit("sadakat-ayari-guncellendi", await sadakatAyariniGetir(req.isletme.id, pool));
  io.to(oda(req.isletme.id, "genel")).emit("tema-guncellendi", temaliIsletmeYaniti(temaliIsletme));
  return { ozet: { ...ozet, sadakat: sadakatCevirisi.durum, tema: temaliIsletme.tema?.ceviriler?.durum || "bekliyor" } };
}));
app.post("/api/admin/kampanyalar", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = req.body.id ? await yonetimVarliginiGetir(t, "kampanya", req.body.id) : null;
  const kampanya = await kampanyaKaydet(t, req.body);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "kampanya", varlikId: kampanya.id, islem: eski ? "guncelleme" : "ekleme", aciklama: `${kampanya.baslik} kampanyası ${eski ? "güncellendi" : "oluşturuldu"}.`, eskiDeger: eski, yeniDeger: kampanya });
  io.to(oda(t, "genel")).emit("kampanyalar-guncellendi", await kampanyalariGetir(t));
  return { kampanya };
}));
app.delete("/api/admin/kampanyalar/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = await yonetimVarliginiGetir(t, "kampanya", req.params.id);
  await kampanyaArsivle(t, req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "kampanya", varlikId: req.params.id, islem: "arsivleme", aciklama: `${eski?.baslik || "Kampanya"} arşivlendi.`, eskiDeger: eski });
  io.to(oda(t, "genel")).emit("kampanyalar-guncellendi", await kampanyalariGetir(t));
}));
app.get("/api/admin/oduller", admin, guvenli(async (req) => ({ oduller: await adminOdulleriGetir(req.isletme.id, pool) })));
app.get("/api/admin/sadakat-ayari", admin, guvenli(async (req) => ({ damgaKarti: await adminSadakatAyariniGetir(req.isletme.id, pool) })));
app.put("/api/admin/sadakat-ayari", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = await adminSadakatAyariniGetir(t, pool);
  const damgaKarti = await adminSadakatAyariniKaydet(t, pool, req.body || {});
  await revizyonKaydet(t, {
    yapan: req.kullanici, varlikTuru: "sadakat", varlikId: null, islem: "guncelleme",
    aciklama: `Damga kartı ${damgaKarti.aktif ? "güncellendi" : "duraklatıldı"}.`, eskiDeger: eski, yeniDeger: damgaKarti,
  });
  io.to(oda(t, "genel")).emit("sadakat-ayari-guncellendi", damgaKarti);
  return { damgaKarti };
}));
app.get("/api/admin/cuzdan-ayari", admin, guvenli(async (req) => ({ cuzdanAyari: await cuzdanAyariniGetir(req.isletme.id, pool) })));
app.get("/api/admin/cuzdan-raporu", admin, guvenli(async (req) => ({ cuzdanRaporu: await adminCuzdanRaporunuGetir(req.isletme.id, pool) })));
app.put("/api/admin/cuzdan-ayari", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = await cuzdanAyariniGetir(t, pool);
  const cuzdanAyari = await adminCuzdanAyariniKaydet(t, pool, req.body || {});
  await revizyonKaydet(t, {
    yapan: req.kullanici, varlikTuru: "cuzdan", varlikId: null, islem: "guncelleme",
    aciklama: `Cüzdan programı ${cuzdanAyari.aktif ? "güncellendi" : "duraklatıldı"}.`, eskiDeger: eski, yeniDeger: cuzdanAyari,
  });
  io.to(oda(t, "genel")).emit("cuzdan-ayari-guncellendi", cuzdanAyari);
  return { cuzdanAyari };
}));
app.post("/api/admin/oduller", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = req.body.id ? await yonetimVarliginiGetir(t, "odul", req.body.id) : null;
  const oduller = await adminOdulKaydet(t, pool, req.body);
  const yeni = req.body.id ? await yonetimVarliginiGetir(t, "odul", req.body.id) : [...oduller].filter((odul) => odul.ad === String(req.body.ad || "").trim() && Number(odul.urunId) === Number(req.body.urunId)).sort((a, b) => Number(b.id) - Number(a.id))[0];
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "odul", varlikId: yeni?.id, islem: eski ? "guncelleme" : "ekleme", aciklama: `${req.body.ad || "Ödül"} puan marketinde ${eski ? "güncellendi" : "oluşturuldu"}.`, eskiDeger: eski, yeniDeger: yeni });
  io.to(oda(t, "genel")).emit("oduller-guncellendi");
  return { oduller };
}));
app.delete("/api/admin/oduller/:id", admin, guvenli(async (req) => {
  const t = req.isletme.id;
  const eski = await yonetimVarliginiGetir(t, "odul", req.params.id);
  await adminOdulArsivle(t, pool, req.params.id);
  await revizyonKaydet(t, { yapan: req.kullanici, varlikTuru: "odul", varlikId: req.params.id, islem: "arsivleme", aciklama: `${eski?.ad || "Ödül"} puan marketinden arşivlendi.`, eskiDeger: eski });
  io.to(oda(t, "genel")).emit("oduller-guncellendi");
}));

app.get("/", (req, res) => res.send("MasanPOS backend calisiyor (PostgreSQL)"));

// Saglik kontrolu — Render/izleme araclari icin
app.get("/saglik", (req, res) => res.json({ durum: "calisiyor", zaman: new Date().toISOString() }));

async function onaylananOdemeyiMutfagaAktarGuvenli(odeme) {
  try {
    await onaylananOdemeyiMutfagaAktar(odeme);
  } catch (aktarimHatasi) {
    console.error("Ödeme başarılı, mutfak aktarımı tamamlanamadı:", {
      odemeId: odeme.id,
      isletmeId: odeme.isletmeId,
      mesaj: aktarimHatasi.message,
    });
  }
}

async function iyzicoOdemesiniKesinlestir(odeme, token) {
  await iyzicoSonucuGetir(odeme, token);
  const sonuc = await odemeIyzicoOlarakOnayla(odeme.isletmeId, odeme.id, token);
  await onaylananOdemeyiMutfagaAktarGuvenli(sonuc.odeme);
  return sonuc.odeme;
}

async function onaylananOdemeyiMutfagaAktar(odeme) {
  if (odeme.mutfagaAktarildi) return;
  const tenantId = Number(odeme.isletmeId);
  if (!Number.isSafeInteger(tenantId) || tenantId < 1) throw new Error("Ödemeye ait işletme bilgisi geçersiz.");
  const aktarim = await odemeMutfakAktariminiTalepEt(tenantId, odeme.id);
  if (aktarim.durum !== "alindi") return;
  const aktarilacak = aktarim.odeme;
  const masaNo = aktarilacak.masaNo || "algotur";
  try {
    await masaSirayaAl(tenantId, masaNo, async () => {
      await siparisStogunuKesinlestir(tenantId, aktarilacak.id, aktarilacak.urunler);
      io.to(oda(tenantId, "genel")).emit("urunler-guncellendi", await urunleriGetir(tenantId));
      for (const [kalemNo, urun] of aktarilacak.urunler.entries()) {
        await kalemEkle(
          tenantId, masaNo, urun, aktarilacak.kisiAdi, urun.secimler, urun.haricMalzemeler,
          aktarilacak.siparisNo, aktarilacak.id, kalemNo
        );
      }
      await odemeMutfagaAktarildi(tenantId, aktarilacak.id);
      const tumMasalar = await tumAcikMasalar(tenantId);
      io.to(oda(tenantId, `masa-${masaNo}`)).emit("masa-guncellendi", await masaSiparisleriniGetir(tenantId, masaNo));
      io.to(oda(tenantId, "mutfak")).emit("mutfak-guncellendi", tumMasalar);
      io.to(oda(tenantId, "salon")).emit("salon-guncellendi", tumMasalar);
      io.to(oda(tenantId, "yonetim")).emit("yonetim-satis-guncellendi", {
        siparisNo: aktarilacak.siparisNo,
        masaNo: aktarilacak.masaNo || "algotur",
        kisiAdi: aktarilacak.kisiAdi,
        tutar: aktarilacak.tutar,
        urunAdedi: aktarilacak.urunler.reduce((toplam, urun) => toplam + Math.max(1, Number(urun.adet || 1)), 0),
        urunler: aktarilacak.urunler.map((urun) => ({ ad: urun.ad, adet: Math.max(1, Number(urun.adet || 1)), fiyat: urun.fiyat })),
        durum: "yeni",
        olusturma: new Date().toISOString(),
      });
      operasyonNabziDegisikliginiYayinla(tenantId, "siparis", {
        masaNo,
        siparisNo: aktarilacak.siparisNo,
        durum: "yeni",
      });
    });
  } catch (hata) {
    await odemeMutfakAktariminiBirak(tenantId, aktarilacak.id).catch(() => {});
    throw hata;
  }
}

// --- Socket.io ---
// Aynı masaya ait olayları sıraya al. Böylece çok ürünlü sipariş, durum
// değiştirme ve masa kapatma olayları birbirini geçip eski ekran verisini
// yeniden yayınlayamaz.
const masaKuyruklari = new Map();
function masaSirayaAl(isletmeId, masaNo, islem) {
  const anahtar = `${isletmeId}:${masaNo}`;
  const onceki = masaKuyruklari.get(anahtar) || Promise.resolve();
  const sonraki = onceki.catch(() => {}).then(islem);
  masaKuyruklari.set(anahtar, sonraki);
  const temizle = () => {
    if (masaKuyruklari.get(anahtar) === sonraki) masaKuyruklari.delete(anahtar);
  };
  sonraki.then(temizle, temizle);
  return sonraki;
}

function guvenliMasaNo(masaNo) {
  const deger = String(masaNo || "").trim();
  return /^[A-Za-z0-9_-]{1,30}$/.test(deger) ? deger : null;
}

function socketRoluVar(socket, roller) {
  return socket.kullanici?.rol === "admin" || roller.includes(socket.kullanici?.rol);
}

io.use(async (socket, sonraki) => {
  try {
    const slug = socket.handshake.auth?.isletme || socket.handshake.query?.isletme;
    const isletme = await isletmeSlugIleGetir(slug);
    if (!isletme) return sonraki(new Error("İşletme bulunamadı"));
    const token = String(socket.handshake.auth?.token || "").trim();
    const impersonation = token ? await impersonationTokeniniDogrula(token, isletme.id) : null;
    if (!isletme.aktif && !impersonation) return sonraki(new Error("İşletme bulunamadı"));
    socket.data.isletmeId = isletme.id;
    socket.data.isletmeSlug = isletme.slug;
    socket.kullanici = impersonation
      ? { id: null, ad: impersonation.superAdmin.ad, email: impersonation.superAdmin.email, rol: "admin" }
      : token ? await tokenDogrula(token, isletme.id) : null;
    if (impersonation) socket.data.impersonatedBy = impersonation.superAdmin.id;
    if (token && !socket.kullanici) return sonraki(new Error("Oturum gecersiz."));
    sonraki();
  } catch {
    sonraki(new Error("Oturum dogrulanamadi."));
  }
});

io.on("connection", (socket) => {
  console.log("Baglandi:", socket.id);
  socket.join(oda(socket.data.isletmeId, "genel"));
  oneriIndirimAyariniGetir(socket.data.isletmeId)
    .then((ayar) => socket.emit("oneri-indirim-ayari-guncellendi", ayar))
    .catch((hata) => console.error("Öneri indirim ayarı sokete gönderilemedi:", hata.message));
  if (socket.kullanici?.id) {
    socket.join(oda(socket.data.isletmeId, `kullanici-${socket.kullanici.id}`));
  }

  // HTTP limitleri Socket.IO paketlerini kapsamaz. Her bağlantı için ayrı
  // kayan pencere, event yağmurunun CPU ve veritabanını tüketmesini önler.
  let pencereBaslangici = Date.now();
  let olaySayisi = 0;
  socket.use((_paket, sonraki) => {
    const simdi = Date.now();
    if (simdi - pencereBaslangici >= 60_000) {
      pencereBaslangici = simdi;
      olaySayisi = 0;
    }
    olaySayisi += 1;
    if (olaySayisi > 120) return sonraki(new Error("Socket istek sınırı aşıldı."));
    sonraki();
  });
  socket.on("error", (hata) => {
    if (hata?.message === "Socket istek sınırı aşıldı.") socket.disconnect(true);
  });

  socket.on("masaya-katil", async (gelen, tamamlandi) => {
    const tenantId = socket.data.isletmeId;
    const masaNo = guvenliMasaNo(typeof gelen === "object" ? gelen?.masaNo : gelen);
    const masaToken = typeof gelen === "object" ? gelen?.masaToken : "";
    const personelErisimi = socketRoluVar(socket, ["mutfak", "salon", "kasiyer"]);
    if (!masaNo || (!personelErisimi && !masaErisimTokeniniDogrula(masaToken, tenantId, masaNo))) {
      if (typeof tamamlandi === "function") tamamlandi({ basarili: false, hata: "Masa QR erisimi gecersiz." });
      return;
    }
    socket.join(oda(tenantId, `masa-${masaNo}`));
    socket.emit("masa-guncellendi", await masaSiparisleriniGetir(tenantId, masaNo));
    socket.emit("nakit-masa-guncellendi", await nakitMasaDurumunuGetir(tenantId, masaNo));
    if (typeof tamamlandi === "function") tamamlandi({ basarili: true });
    console.log(`${socket.id} -> ${oda(tenantId, `masa-${masaNo}`)}`);
  });

  socket.on("urun-ekle", ({ masaNo, urun, kisiAdi, secimler, haricMalzemeler, siparisNo }, tamamlandi) => {
    const tenantId = socket.data.isletmeId;
    masaNo = guvenliMasaNo(masaNo);
    if (!masaNo || process.env.LEGACY_SOCKET_SIPARIS_AKTIF !== "true" || !socketRoluVar(socket, ["mutfak", "salon", "kasiyer"])) {
      if (typeof tamamlandi === "function") tamamlandi({ basarili: false, hata: "Bu siparis yolu kullanima kapali." });
      return;
    }
    masaSirayaAl(tenantId, masaNo, async () => {
      const guncel = await kalemEkle(
        tenantId, masaNo, urun, kisiAdi, secimler || urun?.secimler || {},
        haricMalzemeler || urun?.haricMalzemeler || [], siparisNo
      );
      io.to(oda(tenantId, `masa-${masaNo}`)).emit("masa-guncellendi", guncel);
      const tumMasalar = await tumAcikMasalar(tenantId);
      io.to(oda(tenantId, "mutfak")).emit("mutfak-guncellendi", tumMasalar);
      io.to(oda(tenantId, "salon")).emit("salon-guncellendi", tumMasalar);
      if (typeof tamamlandi === "function") tamamlandi({ basarili: true });
    }).catch((e) => {
      console.error("Ürün ekleme hatası:", e.message);
      if (typeof tamamlandi === "function") tamamlandi({ basarili: false, hata: istemciHataMesaji(e) });
    });
  });

  socket.on("mutfaga-katil", async () => {
    if (!socketRoluVar(socket, ["mutfak"])) return;
    const tenantId = socket.data.isletmeId;
    socket.join(oda(tenantId, "mutfak"));
    socket.emit("mutfak-guncellendi", await tumAcikMasalar(tenantId));
    console.log(`${socket.id} -> ${oda(tenantId, "mutfak")}`);
  });

  // Salon personeli odasi (garson/kasiyer). Tum acik masalari gorur.
  socket.on("salona-katil", async () => {
    if (!socketRoluVar(socket, ["salon", "kasiyer"])) return;
    const tenantId = socket.data.isletmeId;
    socket.join(oda(tenantId, "salon"));
    socket.emit("salon-guncellendi", await tumAcikMasalar(tenantId));
    socket.emit("personel-cagrilari-guncellendi", await aktifPersonelCagrilariniGetir(tenantId, pool));
    console.log(`${socket.id} -> ${oda(tenantId, "salon")}`);
  });

  socket.on("yonetime-katil", async () => {
    if (!socketRoluVar(socket, [])) return;
    const tenantId = socket.data.isletmeId;
    socket.join(oda(tenantId, "yonetim"));
    socket.emit("yonetim-satislar", await canliSatislariGetir(tenantId, { limit: 50 }));
  });

  socket.on("masa-durum-degistir", ({ masaNo, siparisNo, durum }, tamamlandi) => {
    const tenantId = socket.data.isletmeId;
    masaNo = guvenliMasaNo(masaNo);
    if (!masaNo || !socketRoluVar(socket, ["mutfak"])) {
      if (typeof tamamlandi === "function") tamamlandi({ basarili: false, hata: "Yetkisiz islem." });
      return;
    }
    masaSirayaAl(tenantId, masaNo, async () => {
      const guncel = await masaDurumGuncelle(tenantId, masaNo, durum, socket.kullanici?.id, siparisNo);
      if (guncel) {
        io.to(oda(tenantId, `masa-${masaNo}`)).emit("masa-guncellendi", guncel);
        const tumMasalar = await tumAcikMasalar(tenantId);
        io.to(oda(tenantId, "mutfak")).emit("mutfak-guncellendi", tumMasalar);
        io.to(oda(tenantId, "salon")).emit("salon-guncellendi", tumMasalar);
        io.to(oda(tenantId, "yonetim")).emit("yonetim-operasyon-guncellendi", { masaNo, siparisNo, durum, zaman: new Date().toISOString() });
        operasyonNabziDegisikliginiYayinla(tenantId, "mutfak", { masaNo, siparisNo, durum });
      }
      if (typeof tamamlandi === "function") tamamlandi({ basarili: true });
    }).catch((e) => {
      console.error("Durum değiştirme hatası:", e.message);
      if (typeof tamamlandi === "function") tamamlandi({ basarili: false, hata: istemciHataMesaji(e) });
    });
  });

  // Salon: masayi kapat (musteriler kalkinca). Oturum kapanir, yeni gelen temiz baslar.
  socket.on("masa-kapat", (gelenMasaNo, tamamlandi) => {
    const tenantId = socket.data.isletmeId;
    const masaNo = guvenliMasaNo(gelenMasaNo);
    if (!masaNo || !socketRoluVar(socket, ["salon", "kasiyer"])) {
      if (typeof tamamlandi === "function") tamamlandi({ basarili: false, hata: "Yetkisiz islem." });
      return;
    }
    masaSirayaAl(tenantId, masaNo, async () => {
      const bos = await masaKapat(tenantId, masaNo, socket.kullanici?.id);
      await masaCagriOturumlariniKapat(tenantId, pool, masaNo);
      await masaZekasiOturumunuKapat(tenantId, pool, masaNo);
      io.to(oda(tenantId, `masa-${masaNo}`)).emit("masa-guncellendi", bos);
      io.to(oda(tenantId, `masa-${masaNo}`)).emit("masa-kapandi", { masaNo });
      const tumMasalar = await tumAcikMasalar(tenantId);
      io.to(oda(tenantId, "mutfak")).emit("mutfak-guncellendi", tumMasalar);
      io.to(oda(tenantId, "salon")).emit("salon-guncellendi", tumMasalar);
      await personelCagrilariniYayinla(tenantId);
      nakitDegisikliginiYayinla(tenantId, masaNo);
      io.to(oda(tenantId, "yonetim")).emit("yonetim-operasyon-guncellendi", { masaNo, durum: "kapali", zaman: new Date().toISOString() });
      operasyonNabziDegisikliginiYayinla(tenantId, "masa", { masaNo, durum: "kapali" });
      if (typeof tamamlandi === "function") tamamlandi({ basarili: true });
      console.log(`Masa ${masaNo} kapatildi`);
    }).catch((e) => {
      console.error("Masa kapatma hatası:", e.message);
      if (typeof tamamlandi === "function") tamamlandi({ basarili: false, hata: istemciHataMesaji(e) });
    });
  });

  socket.on("disconnect", () => console.log("Ayrildi:", socket.id));
});

// API istemcileri her durumda JSON bekler. Bilinmeyen bir API rotasinda
// Express'in varsayilan HTML 404 sayfasini dondurmek JSON ayrıştırma hatasina
// yol acar ve asil problemi gizler.
app.use("/api", (_req, res) => {
  res.status(404).json({ hata: "İstenen API servisi bulunamadı." });
});

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({ hata: "Yüklenen dosya izin verilen boyutu aşıyor." });
  }
  if (err?.kod === "CORS_ENGELLENDI") {
    return res.status(403).json({ hata: "Bu adresin backend erişimine izin verilmiyor." });
  }
  console.error("Beklenmeyen HTTP hatası:", err?.message || err);
  res.status(500).json({ hata: "Sunucu isteği tamamlayamadı." });
});

const PORT = process.env.PORT || 4000;

async function mevcutCevirileriArkaPlandaTamamla() {
  const yapilandirma = ceviriYapilandirmasi();
  if (!yapilandirma.aktif || !yapilandirma.baslangictaTamamla) return;
  const sonuc = await pool.query("SELECT id FROM isletmeler WHERE aktif=true ORDER BY id");
  for (const satir of sonuc.rows) {
    try {
      const ozet = await eksikCevirileriTamamla(satir.id);
      const sadakat = await sadakatCevirisiniTamamla(satir.id, pool);
      const temaliIsletme = await isletmeTemaCevirisiniTamamla(satir.id);
      io.to(oda(satir.id, "genel")).emit("urunler-guncellendi", await urunleriGetir(satir.id));
      io.to(oda(satir.id, "genel")).emit("kategoriler-guncellendi", await kategorileriGetir(satir.id));
      io.to(oda(satir.id, "genel")).emit("kampanyalar-guncellendi", await kampanyalariGetir(satir.id));
      io.to(oda(satir.id, "genel")).emit("duyurular-guncellendi", await duyurulariGetir(satir.id));
      io.to(oda(satir.id, "genel")).emit("sadakat-ayari-guncellendi", await sadakatAyariniGetir(satir.id, pool));
      io.to(oda(satir.id, "genel")).emit("tema-guncellendi", temaliIsletmeYaniti(temaliIsletme));
      console.log(`AI ceviri taramasi bitti -> isletme ${satir.id}`, {
        ...ozet,
        sadakat: sadakat.durum,
        sadakatHatasi: sadakat.hata || undefined,
      });
    } catch (hata) {
      console.error(`AI ceviri tamamlanamadi -> isletme ${satir.id}:`, hata.message);
    }
  }
}

// Once tablolari hazirla, sonra sunucuyu baslat.
// 0.0.0.0: bulut ortamlarinda (Render vb.) disaridan erisim icin gerekli.
let varsayilanIsletmeId;
isletmeTablosunuHazirla()
  .then((isletme) => {
    varsayilanIsletmeId = isletme.id;
    return tablolariHazirla(varsayilanIsletmeId);
  })
  .then(() => idempotencyTablosunuHazirla(pool))
  .then(() => oneriAtifTablolariniHazirla(pool))
  .then(() => adminTablolariHazirla(varsayilanIsletmeId))
  .then(() => sadakatTablolariHazirla(varsayilanIsletmeId, pool))
  .then(() => cuzdanTablolariHazirla(pool))
  .then(() => personelCagriTablolariHazirla(pool))
  .then(() => sikayetTablosunuHazirla(pool))
  .then(() => rezervasyonTablosunuHazirla(pool))
  .then(() => degerlendirmeTablolariniHazirla(pool))
  .then(() => giderTablolariniHazirla(pool))
  .then(() => receteTablolariniHazirla(pool))
  .then(() => masaZekasiTablolariniHazirla(pool))
  .then(() => isletmeMigrationunuCalistir(varsayilanIsletmeId))
  .then(() => superAdminTablolariniHazirla())
  .then(() => basvuruTablosunuHazirla(pool))
  .then(() => ilkSuperAdminiHazirla())
  .then(() => {
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`MasanPOS backend calisiyor -> port ${PORT}`);
      mevcutCevirileriArkaPlandaTamamla().catch((hata) => console.error("AI ceviri taramasi baslatilamadi:", hata.message));
      eskiOneriAtiflariniTemizle(pool).catch((hata) => console.error("Eski oneri atiflari temizlenemedi:", hata.message));
      const oneriTemizlikZamanlayicisi = setInterval(() => {
        eskiOneriAtiflariniTemizle(pool).catch((hata) => console.error("Eski oneri atiflari temizlenemedi:", hata.message));
      }, 24 * 60 * 60_000);
      oneriTemizlikZamanlayicisi.unref();
    });
  })
  .catch((err) => {
    console.error("Veritabanina baglanilamadi:", err.message);
    console.error("(DATABASE_URL veya .env ayarlari dogru mu?)");
    process.exit(1);
  });
