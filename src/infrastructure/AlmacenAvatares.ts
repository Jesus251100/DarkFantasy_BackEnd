import { randomUUID } from 'node:crypto'

const EXTENSIONES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_BYTES = 5 * 1024 * 1024

function configuracion() {
  const base = process.env.SUPABASE_URL?.trim().replace(/\/$/, '')
  // Prefer the current `sb_secret_...` key. The legacy service_role JWT stays
  // supported so existing local deployments can keep working during migration.
  const llave = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const bucket = process.env.AVATARS_BUCKET?.trim() || 'avatars'
  if (!base || !llave) throw new Error('El almacenamiento de avatares no está configurado en el backend.')
  const headers: Record<string, string> = { apikey: llave }
  if (!llave.startsWith('sb_secret_')) headers.Authorization = `Bearer ${llave}`
  return { base, bucket, headers }
}

export class AlmacenAvatares {
  async guardar(usuarioId: string, tipo: string, archivo: Buffer): Promise<string> {
    const extension = EXTENSIONES[tipo]
    if (!extension) throw Object.assign(new Error('Usa una imagen JPG, PNG o WebP.'), { status: 415 })
    if (!archivo.length || archivo.length > MAX_BYTES) {
      throw Object.assign(new Error('La imagen debe pesar entre 1 byte y 5 MB.'), { status: 413 })
    }
    const firmaValida = tipo === 'image/jpeg'
      ? archivo[0] === 0xff && archivo[1] === 0xd8 && archivo[2] === 0xff
      : tipo === 'image/png'
        ? archivo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : archivo.toString('ascii', 0, 4) === 'RIFF' && archivo.toString('ascii', 8, 12) === 'WEBP'
    if (!firmaValida) throw Object.assign(new Error('El contenido del archivo no coincide con su formato de imagen.'), { status: 415 })
    const { base, bucket, headers } = configuracion()
    const ruta = `${usuarioId}/${randomUUID()}.${extension}`
    const response = await fetch(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${ruta.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': tipo,
        'x-upsert': 'true',
        'cache-control': '3600',
      },
      body: new Uint8Array(archivo),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      const mensaje = response.status === 404
        ? 'No existe el bucket de avatares en Supabase Storage.'
        : 'Supabase no pudo guardar la imagen. Revisa el bucket y su configuración.'
      throw Object.assign(new Error(mensaje), { status: 502 })
    }
    return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${ruta.split('/').map(encodeURIComponent).join('/')}`
  }

  async borrar(urlPublica: string | null): Promise<void> {
    if (!urlPublica) return
    const { base, bucket, headers } = configuracion()
    const prefijo = `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/`
    if (!urlPublica.startsWith(prefijo)) return
    const ruta = urlPublica.slice(prefijo.length)
    const response = await fetch(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${ruta}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok && response.status !== 404) {
      throw new Error('No se pudo borrar la imagen anterior de Supabase Storage.')
    }
  }
}

export const almacenAvatares = new AlmacenAvatares()
