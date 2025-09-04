// helpers/images.ts
const UA = process.env.IMG_UA || "Mozilla/5.0 (DiscordBot; +https://discord.com)";
export async function fetchImageBuffer(url) {
    const res = await fetch(url, {
        headers: {
            "User-Agent": UA,
            "Accept": "image/*",
            "Referer": "https://discord.com",
        },
        redirect: "follow",
    });
    if (!res.ok) {
        // Fallback opcional vía proxy público (si lo quieres):
        // const prox = "https://images.weserv.nl/?url=" + encodeURIComponent(url.replace(/^https?:\/\//,""));
        // const p = await fetch(prox);
        // if (!p.ok) throw new Error(`Image fetch failed ${res.status} and proxy ${p.status}`);
        // return Buffer.from(await p.arrayBuffer());
        throw new Error(`Image fetch failed ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
}
//# sourceMappingURL=images.js.map