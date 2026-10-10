import nodemailer from 'nodemailer'
import type { IEnviadorCorreo } from '../domain/identidad/IEnviadorCorreo'

type SmtpCfg = {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
  real: boolean
}

function esHostLocal(host: string): boolean {
  const h = host.toLowerCase()
  return !h || h === 'mail' || h === 'mailpit' || h === '127.0.0.1' || h === 'localhost'
}

function smtpConfig(): SmtpCfg {
  const user = process.env.SMTP_USER?.trim() ?? ''
  const pass = (process.env.SMTP_PASS ?? '').replace(/\s+/g, '')
  const real = Boolean(user && pass)
  let host = (process.env.SMTP_HOST ?? '').trim()
  let port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 0

  // Credenciales reales: no mandar a Mailpit aunque Compose siga apuntando a `mail`.
  if (real && esHostLocal(host)) {
    host = 'smtp.gmail.com'
    port = port === 0 || port === 1025 ? 587 : port
  }
  if (!host) host = '127.0.0.1'
  if (!Number.isFinite(port) || port <= 0) port = 1025

  const secure = process.env.SMTP_SECURE === 'true' || port === 465
  const from =
    process.env.SMTP_FROM?.trim() ||
    (user ? `Dark Fantasy <${user}>` : 'Dark Fantasy <no-reply@darkfantasy.local>')

  return { host, port, secure, user, pass, from, real }
}

export class CorreoSmtp implements IEnviadorCorreo {
  async enviarCodigo(correo: string, codigo: string): Promise<void> {
    const cfg = smtpConfig()
    const transporte = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.real ? { user: cfg.user, pass: cfg.pass } : undefined,
      requireTLS: cfg.real && !cfg.secure,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    })

    await transporte.sendMail({
      from: cfg.from,
      to: correo,
      subject: 'Tu código de Dark Fantasy',
      text: `Tu código de verificación es ${codigo}. Vale 10 minutos. Si no pediste esta cuenta, ignora el mensaje.`,
      html: `
        <div style="font-family:Georgia,serif;background:#0b1220;color:#e8eef4;padding:24px">
          <h1 style="color:#e8c86a;font-size:20px;margin:0 0 12px">Dark Fantasy</h1>
          <p>Tu código de verificación es:</p>
          <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#3dce6a;margin:16px 0">${codigo}</p>
          <p style="color:#9aa8b8;font-size:13px">Vale 10 minutos. Si no pediste esta cuenta, ignora el mensaje.</p>
        </div>
      `,
    })
  }

  bandejaLocal(): string | undefined {
    const cfg = smtpConfig()
    if (cfg.real) return undefined
    if (esHostLocal(cfg.host) || cfg.port === 1025) return 'http://127.0.0.1:8025'
    return undefined
  }
}
