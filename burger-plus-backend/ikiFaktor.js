import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { generateSecret, generateURI, verify } from "otplib";

const URETIM = process.env.NODE_ENV === "production";
const YEREL_ANAHTAR = "yalnizca-yerel-iki-faktor-sifreleme-anahtari";
const HAM_ANAHTAR = String(process.env.MFA_ENCRYPTION_KEY || (URETIM ? "" : YEREL_ANAHTAR));

if (HAM_ANAHTAR.length < 32) {
  throw new Error("MFA_ENCRYPTION_KEY en az 32 karakter olmali ve production ortaminda zorunludur.");
}
if (!URETIM && !process.env.MFA_ENCRYPTION_KEY) {
  console.warn("UYARI: Yerel MFA_ENCRYPTION_KEY kullaniliyor; canli ortamda guclu ve kalici bir anahtar tanimlayin.");
}

const SIFRELEME_ANAHTARI = createHash("sha256").update(HAM_ANAHTAR).digest();
const KURTARMA_HMAC_ANAHTARI = createHash("sha256").update(`kurtarma:${HAM_ANAHTAR}`).digest();

export function ikiFaktorSirriUret() {
  return generateSecret({ length: 20 });
}

export function ikiFaktorUriUret(secret, email) {
  return generateURI({ issuer: "MasanPOS", label: String(email || "hesap"), secret });
}

export async function ikiFaktorKoduGecerliMi(secret, token) {
  const temiz = String(token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(temiz)) return false;
  const sonuc = await verify({ secret, token: temiz, epochTolerance: 30 });
  return sonuc.valid === true;
}

export function ikiFaktorSirriSifrele(secret) {
  const iv = randomBytes(12);
  const sifreleyici = createCipheriv("aes-256-gcm", SIFRELEME_ANAHTARI, iv);
  const sifreli = Buffer.concat([sifreleyici.update(String(secret), "utf8"), sifreleyici.final()]);
  const etiket = sifreleyici.getAuthTag();
  return [iv, etiket, sifreli].map((parca) => parca.toString("base64url")).join(".");
}

export function ikiFaktorSirriCoz(sifreliDeger) {
  const parcalar = String(sifreliDeger || "").split(".");
  if (parcalar.length !== 3) throw new Error("İki adımlı doğrulama anahtarı okunamadı.");
  const [iv, etiket, sifreli] = parcalar.map((parca) => Buffer.from(parca, "base64url"));
  const cozucu = createDecipheriv("aes-256-gcm", SIFRELEME_ANAHTARI, iv);
  cozucu.setAuthTag(etiket);
  return Buffer.concat([cozucu.update(sifreli), cozucu.final()]).toString("utf8");
}

function kurtarmaKodunuNormallestir(kod) {
  return String(kod || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function kurtarmaKoduHashle(kod) {
  return createHmac("sha256", KURTARMA_HMAC_ANAHTARI)
    .update(kurtarmaKodunuNormallestir(kod))
    .digest("hex");
}

export function kurtarmaKodlariUret(adet = 8) {
  const alfabe = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: adet }, () => {
    const rastgele = randomBytes(10);
    const ham = Array.from(rastgele, (deger) => alfabe[deger % alfabe.length]).join("").slice(0, 10);
    return `${ham.slice(0, 5)}-${ham.slice(5)}`;
  });
}

export function kurtarmaKoduBicimindeMi(kod) {
  return /^[A-HJ-NP-Z2-9]{5}-?[A-HJ-NP-Z2-9]{5}$/i.test(String(kod || "").trim());
}
