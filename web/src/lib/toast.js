// Avisos breves ("Copiado", "Função concedida") exibidos por <Toasts />.
const ouvintes = new Set();

export function avisar(texto, tipo = "sucesso") {
    const aviso = { id: `${Date.now()}-${Math.random()}`, texto, tipo };
    ouvintes.forEach((ouvinte) => ouvinte(aviso));
}

export function ouvirAvisos(ouvinte) {
    ouvintes.add(ouvinte);
    return () => ouvintes.delete(ouvinte);
}
