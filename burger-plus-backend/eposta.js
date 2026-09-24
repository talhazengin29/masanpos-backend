// ============================================================================
// E-posta gönderimi (Resend). Şimdilik yalnızca şifre sıfırlama akışı kullanır.
// ============================================================================

import { Resend } from "resend";

let istemci = null;
function istemciAl() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY backend ortam değişkenlerinde tanımlı değil.");
  if (!istemci) istemci = new Resend(apiKey);
  return istemci;
}

export async function sifirlamaEpostasiGonder(email, ad, link) {
  const gonderen = String(process.env.RESEND_GONDEREN || "MasanPOS <onboarding@resend.dev>").trim();
  const { error } = await istemciAl().emails.send({
    from: gonderen,
    to: email,
    subject: "MasanPOS — Şifre sıfırlama",
    html: sifirlamaHtml(ad, link),
  });
  if (error) throw new Error(error.message || "Sıfırlama e-postası gönderilemedi.");
}

function sifirlamaHtml(ad, link) {
  const guvenliAd = String(ad || "").replace(/[<>&]/g, "");
  return `<!doctype html>
<html lang="tr">
  <body style="margin:0;padding:0;background:#0d0d0d;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#15110f;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px 28px;">
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <span style="display:inline-block;color:#00c99a;font-size:22px;font-weight:800;letter-spacing:.02em;">MasanPOS</span>
              </td>
            </tr>
            <tr>
              <td style="color:#ffffff;font-size:18px;font-weight:700;padding-bottom:12px;">
                Merhaba ${guvenliAd},
              </td>
            </tr>
            <tr>
              <td style="color:rgba(255,255,255,0.72);font-size:14px;line-height:1.6;padding-bottom:24px;">
                Şifreni sıfırlamak için aşağıdaki bağlantıya tıkla.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${link}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#ff8a2b,#ff5600);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">
                  Şifremi Sıfırla
                </a>
              </td>
            </tr>
            <tr>
              <td style="color:rgba(255,255,255,0.45);font-size:12px;line-height:1.6;padding-bottom:6px;">
                Bu bağlantı 30 dakika geçerlidir.
              </td>
            </tr>
            <tr>
              <td style="color:rgba(255,255,255,0.45);font-size:12px;line-height:1.6;">
                Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
