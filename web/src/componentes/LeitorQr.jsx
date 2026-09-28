import { useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { chassiDoLink } from "../lib/chassi";
import Botao from "../ui/Botao";
import Icone from "../ui/Icone";

// O QR da etiqueta leva para /?chassi=XXXX (ver EtiquetaQr e lib/chassi.js).

const MENSAGENS = {
    iniciando: "Solicitando acesso à câmera…",
    lendo: "Posicione o QR Code dentro da área marcada.",
    invalido: "Este QR Code não é de um veículo KMChain. Tente outro.",
    lido: "QR Code lido. Abrindo o histórico…"
};

// Conteudo do dialogo "Escanear QR Code". Nunca prende a pessoa: se a
// camera falhar, ha sempre "Tentar novamente" e "Digitar chassi".
export default function LeitorQr({ aoLer, aoDigitar }) {
    const id = "camera-" + useId().replace(/[^a-zA-Z0-9]/g, "");
    const [estado, setEstado] = useState("iniciando");
    const [tentativa, setTentativa] = useState(0);
    const aoLerAtual = useRef(aoLer);

    useEffect(() => {
        aoLerAtual.current = aoLer;
    }, [aoLer]);

    useEffect(() => {
        const leitor = new Html5Qrcode(id, { verbose: false });
        let ativo = true;
        let concluido = false;
        let ultimoInvalido = 0;

        const inicio = leitor.start(
            { facingMode: "environment" },
            {
                fps: 10,
                aspectRatio: 1,
                qrbox: (largura, altura) => {
                    const lado = Math.floor(Math.min(largura, altura) * 0.7);
                    return { width: lado, height: lado };
                }
            },
            (texto) => {
                if (concluido || !ativo) return;
                const chassi = chassiDoLink(texto);
                if (chassi) {
                    concluido = true;
                    setEstado("lido");
                    aoLerAtual.current(chassi);
                } else if (Date.now() - ultimoInvalido > 2500) {
                    ultimoInvalido = Date.now();
                    setEstado("invalido");
                    setTimeout(() => ativo && !concluido && setEstado("lendo"), 2500);
                }
            },
            () => { }
        );

        inicio
            .then(() => ativo && setEstado((atual) => (atual === "iniciando" ? "lendo" : atual)))
            .catch((erro) => {
                if (!ativo) return;
                setEstado(/NotAllowed|Permission/i.test(String(erro?.name ?? erro)) ? "negado" : "indisponivel");
            });

        return () => {
            ativo = false;
            inicio.then(() => leitor.stop()).then(() => leitor.clear()).catch(() => { });
        };
    }, [id, tentativa]);

    const falhou = estado === "negado" || estado === "indisponivel";

    return (
        <div className="leitor">
            <div className="leitor-camera">
                <div id={id} className="leitor-video" />
                {estado === "iniciando" && (
                    <div className="leitor-sobreposicao">
                        <Icone nome="carregando" className="girando" tamanho={22} />
                    </div>
                )}
                {falhou && (
                    <div className="leitor-sobreposicao leitor-falha" role="alert">
                        <Icone nome="camera" tamanho={28} />
                        <p className="leitor-falha-titulo">Não foi possível acessar a câmera.</p>
                        <p>
                            {estado === "negado"
                                ? "Permita o acesso à câmera nas configurações do navegador e tente novamente."
                                : "Verifique se o dispositivo tem uma câmera disponível."}
                        </p>
                        <Botao variante="secundario" tamanho="p" onClick={() => {
                            setEstado("iniciando");
                            setTentativa((t) => t + 1);
                        }}>
                            Tentar novamente
                        </Botao>
                    </div>
                )}
            </div>

            {!falhou && (
                <p className={`leitor-status ${estado === "invalido" ? "leitor-status-alerta" : ""}`} role="status">
                    {MENSAGENS[estado]}
                </p>
            )}

            <Botao variante="secundario" largo icone="teclado" onClick={aoDigitar}>
                Digitar chassi
            </Botao>
        </div>
    );
}
