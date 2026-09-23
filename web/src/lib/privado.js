// Dados que nunca vao para a blockchain: CPF do proprietario atual e quem,
// de fato, realizou cada servico. Ficam no banco SQL, atras de login.
import { BrowserProvider } from "ethers";

// Chamado depois de uma transacao confirmada (cadastro ou leitura), para
// deixar registrado no banco quem fez o servico e, quando houver, os dados
// do proprietario. Falha aqui nunca desfaz a transacao ja gravada em cadeia
// - so avisa, porque o historico publico continua correto sem isso.
export async function registrarPrivado(dados) {
    const resposta = await fetch("/api/privado/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(dados)
    });
    if (!resposta.ok) {
        const { erro } = await resposta.json().catch(() => ({}));
        throw new Error(erro ?? "Não foi possível salvar o registro privado.");
    }
}

// Exclusivo do DETRAN: assina uma mensagem provando o papel em cadeia e
// recebe de volta o CPF/nome do proprietario e quem realizou cada servico.
export async function consultarPrivado(chassi) {
    if (!window.ethereum) throw new Error("Conecte a carteira credenciada pelo DETRAN.");
    const assinante = await new BrowserProvider(window.ethereum).getSigner();

    const emitidoEm = Date.now();
    const mensagem = `KmChain: consultar registros privados de ${chassi} em ${emitidoEm}`;
    const assinatura = await assinante.signMessage(mensagem);

    const resposta = await fetch("/api/privado/consultar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ chassi, emitidoEm, assinatura })
    });
    if (resposta.status === 403) throw new Error("Esta carteira não tem credencial DETRAN.");
    if (!resposta.ok) throw new Error("Não foi possível consultar os registros privados.");
    const { registros } = await resposta.json();
    return registros;
}

// Exclusivo de admin/DETRAN: lista as contas de login aguardando serem
// credenciadas em cadeia (para achar rapido a carteira de quem pediu acesso).
export async function contasPendentes() {
    if (!window.ethereum) throw new Error("Conecte a carteira credenciada.");
    const assinante = await new BrowserProvider(window.ethereum).getSigner();

    const emitidoEm = Date.now();
    const mensagem = `KmChain: listar contas pendentes em ${emitidoEm}`;
    const assinatura = await assinante.signMessage(mensagem);

    const resposta = await fetch("/api/auth/pendentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ emitidoEm, assinatura })
    });
    if (resposta.status === 403) throw new Error("Esta carteira não tem credencial para ver esta lista.");
    if (!resposta.ok) throw new Error("Não foi possível carregar as contas.");
    const { contas } = await resposta.json();
    return contas;
}
