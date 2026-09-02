import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// As rotas em api/*.js sao Serverless Functions da Vercel (padrao
// `handler(req, res)`), que so existem quando o Vercel monta o servidor.
// Rodando so com `vite`, elas nao sao servidas e o app recebe 404 - por
// isso a MetaMask abria mas o envio do documento falhava. Este plugin
// recria o mesmo contrato localmente durante o `npm run dev`.
function apiDev(env) {
  const rotas = {
    '/api/upload': '/api/upload.js',
    '/api/documento': '/api/documento.js',
  }

  return {
    name: 'api-dev',
    configureServer(server) {
      for (const [rota, modulo] of Object.entries(rotas)) {
        server.middlewares.use(rota, async (req, res, next) => {
          if (req.method !== 'POST') return next()

          for (const chave of ['PINATA_JWT', 'GATEWAY', 'RPC_URL']) {
            if (env[chave]) process.env[chave] = env[chave]
          }

          try {
            const bruto = await new Promise((resolve, reject) => {
              const partes = []
              req.on('data', (parte) => partes.push(parte))
              req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')))
              req.on('error', reject)
            })
            req.body = bruto ? JSON.parse(bruto) : {}

            res.status = (codigo) => {
              res.statusCode = codigo
              return res
            }
            res.json = (dados) => {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(dados))
            }

            const { default: handler } = await server.ssrLoadModule(modulo)
            await handler(req, res)
          } catch (erro) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ erro: erro.message }))
          }
        })
      }
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
