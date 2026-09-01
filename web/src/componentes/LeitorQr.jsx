import { useEffect } from "react";
import { Html5Qrcode } from "html5-qrcode";

// Leitor embutido, util na demonstracao da banca com o celular.
export default function LeitorQr({ aoLer }) {
    useEffect(() => {
        const leitor = new Html5Qrcode("area-camera");
        leitor.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: 240 },
            (texto) => {
                const chassi = new URL(texto).searchParams.get("chassi");
                if (chassi) {
                    aoLer(chassi);
                    leitor.stop();
                }
            },
            () => { }
        );
        return () => leitor.stop().catch(() => { });
    }, []);

    return <div id="area-camera" style={{ width: 280 }} />;
}