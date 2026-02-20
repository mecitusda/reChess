import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();
function hasSmtpEnv() {
  return (
    !!process.env.SMTP_HOST &&
    !!process.env.SMTP_PORT &&
    !!process.env.SMTP_USER &&
    !!process.env.SMTP_PASS
  );
}

function smtpTransport() {
  const host = String(process.env.SMTP_HOST || "");
  const port = Number(process.env.SMTP_PORT || 0);
  const user = String(process.env.SMTP_USER || "");
  const pass = String(process.env.SMTP_PASS || "");
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export async function sendPasswordResetCodeEmail({
  to,
  code,
  minutesValid,
}) {
  const subject = "reChess • Şifre sıfırlama kodu";

  if (!hasSmtpEnv()) {
    console.log(`[password-reset] code for ${to}: ${code} (valid ${minutesValid}m)`);
    return { ok: true, mode: "console" };
  }

  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER);
  const transport = smtpTransport();

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.45;color:#0b1220">
    <div style="max-width:520px;margin:0 auto;padding:18px">
      <div style="font-size:18px;font-weight:800;margin-bottom:10px">Şifre sıfırlama</div>
      <div style="font-size:14px;color:#334155;margin-bottom:16px">
        Aşağıdaki kodu kullanarak şifreni ${minutesValid} dakika içinde değiştirebilirsin.
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:14px;padding:14px;background:#f8fafc">
        <div style="font-size:12px;color:#64748b;font-weight:700;margin-bottom:6px">KOD</div>
        <div style="font-size:28px;letter-spacing:0.22em;font-weight:900">${code}</div>
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:14px">
        Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.
      </div>
    </div>
  </div>
  `;

  await transport.sendMail({
    from,
    to,
    subject,
    html,
  });

  return { ok: true, mode: "smtp" };
}

