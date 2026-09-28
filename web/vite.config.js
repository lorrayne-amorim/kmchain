import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// As rotas em api/*.js sao Serverless Functions da Vercel (padrao
// `handler(req, res)`), que so existem quando o Vercel monta o servidor.
// Este plugin recria o mesmo contrato durante o `npm run dev`: qualquer
// /api/<caminho> e servido por api/<caminho>.js (GET ou POST), com as
// variaveis do .env.local disponiveis em process.env - como na Vercel.
function apiDev(env) {
  return {
    name: 'api-dev',
    configureServer(server) {
      for (const [chave, valor] of Object.entries(env)) {
        if (!chave.startsWith('VITE_') && process.env[chave] === undefined) process.env[chave] = valor
      }

      // Segredos e modulos internos nunca saem do servidor de desenvolvimento,
      // nem por variantes de URL (?raw, ?import, codificacao) que o Vite aceita.
      server.middlewares.use((req, res, next) => {
        let caminho = req.url ?? ''
        try { caminho = decodeURIComponent(caminho) } catch { /* mantem o original */ }
        if (/(^|[\\/])\.env/i.test(caminho) || /[\\/]api[\\/]_/.test(caminho)) {
          res.statusCode = 404
          return res.end()
        }
        next()
      })

      server.middlewares.use('/api', async (req, res, next) => {
        const caminho = new URL(req.url, 'http://local').pathname.replace(/^\/+|\/+$/g, '')
        // Arquivos com "_" sao modulos internos, nao rotas.
        if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(caminho)) return next()
        const arquivo = path.join(server.config.root, 'api', `${caminho}.js`)
        if (!existsSync(arquivo)) return next()

        try {
          if (req.method === 'POST' || req.method === 'PATCH') {
            const bruto = await new Promise((resolve, reject) => {
              const partes = []
              req.on('data', (parte) => partes.push(parte))
              req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')))
              req.on('error', reject)
            })
            req.body = bruto ? JSON.parse(bruto) : {}
          }
          req.url = req.originalUrl ?? req.url

          res.status = (codigo) => {
            res.statusCode = codigo
            return res
          }
          res.json = (dados) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(dados))
          }
          res.send = (dados) => res.end(dados)

          const { default: handler } = await server.ssrLoadModule(arquivo)
          await handler(req, res)
        } catch (erro) {
          console.error(`[api-dev] ${caminho}:`, erro)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ erro: 'Não foi possível concluir a operação.', codigo: 'interno' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiDev(env)],
  }
})
