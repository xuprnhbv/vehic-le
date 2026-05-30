// Sends the account-verification email over SMTP (Nodemailer). If SMTP isn't
// configured (no SMTP_HOST), we skip sending and just log the link — handy in
// dev so you can verify accounts without a real mail server.

const nodemailer = require("nodemailer");

const APP_BASE_URL = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MAIL_FROM = process.env.MAIL_FROM || "Vehic-le <no-reply@example.com>";

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465, // implicit TLS on 465, STARTTLS otherwise
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

function verifyUrl(token) {
  return `${APP_BASE_URL}/api/auth/verify?token=${token}`;
}

async function sendVerificationEmail(user, token) {
  const url = verifyUrl(token);

  if (!transport) {
    // Dev fallback — no SMTP configured.
    console.log(`[mailer] (no SMTP) verification link for ${user.email}: ${url}`);
    return;
  }

  await transport.sendMail({
    from: MAIL_FROM,
    to: user.email,
    subject: "אימות חשבון · Vehic-le",
    text: `שלום ${user.username},\n\nכדי לאמת את החשבון שלך לחץ על הקישור:\n${url}\n\nהקישור תקף ל-24 שעות.`,
    html: `
      <div dir="rtl" style="font-family: sans-serif; line-height: 1.6;">
        <h2>ברוך הבא ל-Vehic-le 🚗</h2>
        <p>שלום ${user.username}, כדי לאמת את כתובת המייל שלך לחץ על הכפתור:</p>
        <p><a href="${url}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">אמת את החשבון</a></p>
        <p style="color:#666;font-size:13px;">או העתק את הקישור: <br>${url}</p>
        <p style="color:#999;font-size:12px;">הקישור תקף ל-24 שעות.</p>
      </div>`,
  });
  console.log(`[mailer] verification email sent to ${user.email}`);
}

module.exports = { sendVerificationEmail };
