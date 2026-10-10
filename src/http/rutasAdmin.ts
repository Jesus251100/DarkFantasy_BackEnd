import { Router } from 'express'
import { PrismaAdminRepo } from '../infrastructure/PrismaAdminRepo'
import { authObligatoria, soloAdmin } from './auth'

const router = Router()
router.use(authObligatoria, soloAdmin)

const consultas = new PrismaAdminRepo()

router.get('/usuarios', async (_req, res) => {
  const usuarios = await consultas.listarUsuarios()
  res.json({ usuarios })
})

router.get('/actividad', async (_req, res) => {
  const actividad = await consultas.actividad()
  res.json(actividad)
})

router.get('/reportes', async (_req, res) => {
  const reportes = await consultas.reportes()
  res.json(reportes)
})

export default router
