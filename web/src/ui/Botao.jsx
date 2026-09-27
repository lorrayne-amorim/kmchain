import Icone from "./Icone";

// variante: primario | secundario | fantasma | perigo
// tamanho: normal | p (compacto) | g (CTA principal)
export default function Botao({
    variante = "primario",
    tamanho = "normal",
    largo = false,
    carregando = false,
    icone,
    className = "",
    children,
    ...resto
}) {
    const classes = [
        "botao",
        `botao-${variante}`,
        tamanho !== "normal" && `botao-${tamanho}`,
        largo && "botao-largo",
        className
    ].filter(Boolean).join(" ");

    return (
        <button
            type="button"
            {...resto}
            className={classes}
            disabled={resto.disabled || carregando}
            aria-busy={carregando || undefined}
        >
            {carregando
                ? <Icone nome="carregando" className="girando" />
                : icone && <Icone nome={icone} />}
            {children}
        </button>
    );
}
