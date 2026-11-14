import nodemailer from 'nodemailer'
import * as SibApiV3Sdk from '@getbrevo/brevo'
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

  if (real && esHostLocal(host)) {
    host = 'smtp.gmail.com'
    port = port === 0 || port === 1025 ? 587 : port
  }
  if (!host) host = '127.0.0.1'
  if (!Number.isFinite(port) || port <= 0) port = 1025

  const secure = process.env.SMTP_SECURE === 'true' || port === 465
  const from =
    process.env.SMTP_FROM?.trim() ||
    process.env.SENDER_EMAIL?.trim() ||
    (user ? `Dark Fantasy <${user}>` : 'Dark Fantasy <no-reply@darkfantasy.local>')

  return { host, port, secure, user, pass, from, real }
}

export class CorreoSmtp implements IEnviadorCorreo {
  async enviarCodigo(correo: string, codigo: string, motivo: 'registro' | 'clave' = 'registro'): Promise<void> {
    // 1. Si detecta la API de Brevo, usa Brevo (Ideal para producción en Render gratuito)
    const apiKeyBrevo = process.env.BREVO_API_KEY?.trim()
    if (apiKeyBrevo) {
      await enviarConBrevo(correo, codigo, motivo, apiKeyBrevo)
      return
    }

    // 2. Si no, intenta por SMTP tradicional / Local (Mailpit)
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

    await transporte.sendMail({ from: cfg.from, to: correo, ...contenidoCodigo(codigo, motivo) })
  }

  bandejaLocal(): string | undefined {
    if (process.env.BREVO_API_KEY?.trim()) return undefined
    const cfg = smtpConfig()
    if (cfg.real) return undefined
    if (esHostLocal(cfg.host) || cfg.port === 1025) return 'http://127.0.0.1:8025'
    return undefined
  }
}

function contenidoCodigo(codigo: string, motivo: 'registro' | 'clave') {
  const esClave = motivo === 'clave'
  const titulo = esClave ? 'Tu código para cambiar la contraseña es:' : 'Tu código de verificación es:'
  const aviso = esClave ? 'Si no pediste este cambio, ignora el mensaje.' : 'Si no pediste esta cuenta, ignora el mensaje.'
  return {
    subject: 'Tu código de Dark Fantasy',
    text: `${titulo.replace(/:$/, '')} ${codigo}. Vale 10 minutos. ${aviso}`,
    html: `
      <div style="font-family:Georgia,serif;background:#0b1220;color:#e8eef4;padding:24px">
        <h1 style="color:#e8c86a;font-size:20px;margin:0 0 12px">Dark Fantasy</h1>
        <p>${titulo}</p>
        <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#3dce6a;margin:16px 0">${codigo}</p>
        <p style="color:#9aa8b8;font-size:13px">Vale 10 minutos. ${aviso}</p>
      </div>
    `,
  }
}

async function enviarConBrevo(
  correo: string,
  codigo: string,
  motivo: 'registro' | 'clave',
  apiKey: string,
): Promise<void> {
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi()
  const auth = apiInstance.authentications['apiKey'] as { apiKey: string }
  auth.apiKey = apiKey

  const remitenteEmail = process.env.SENDER_EMAIL?.trim() || process.env.SMTP_USER?.trim() || 'totolino4000@gmail.com'
  const remitenteNombre = process.env.SENDER_NAME?.trim() || 'Dark Fantasy'

  const contenido = contenidoCodigo(codigo, motivo)

  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail({
    subject: contenido.subject,
    htmlContent: contenido.html,
    textContent: contenido.text,
    sender: { name: remitenteNombre, email: remitenteEmail },
    to: [{ email: correo }],
  })

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail)
  } catch (error) {
    throw new Error(`Error al enviar correo con Brevo: ${error instanceof Error ? error.message : String(error)}`)
  }
}