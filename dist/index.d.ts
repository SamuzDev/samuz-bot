import "dotenv/config";
/**
 * Devuelve una URL horizontal de nekos.best (si no encuentra, cae en la primera).
 * @param category  "waifu" | "neko" | "kitsune" | "husbando"
 * @param minAR     relación mínima (1.3 ≈ horizontal clara)
 * @param amount    cuántas candidatas pedir a la API (1..20)
 */
export declare function getLandscapeFromNekosBest(category?: "waifu" | "neko" | "kitsune" | "husbando", minAR?: number, amount?: number): Promise<string | undefined>;
/**
 * Banner "cinemático": blur del fondo + la misma imagen en limpio centrada.
 * Solo usa imágenes HORIZONTALES (minAR). Si no encuentra, usa la última como fallback.
 */
export declare function makeBlurBannerFromUrl(opts: {
    url: string;
    width?: number;
    height?: number;
    overlayDarken?: number;
    border?: boolean;
}): Promise<Buffer<ArrayBufferLike>>;
//# sourceMappingURL=index.d.ts.map