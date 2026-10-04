// Unica Serverless Function do projeto: recebe todas as rotas /api (ver
// vercel.json) e entrega ao roteador em servidor/rotas.js.
import { rotear } from "../servidor/rotas.js";

export default function handler(req, res) {
    return rotear(req, res);
}
