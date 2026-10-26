import { loadImage } from "@/lib/utils/image";

/**
 * The colours of an item, read from its photo.
 *
 * A matched 3D model (a sofa, a table) is only convincing in the photo's own
 * colours. The middle of the brightness range is the body — the fabric of a
 * sofa, the top of a table; the darkest few percent are its legs and base;
 * the brightest are highlights and light accents (throw pillows).
 */
export interface ItemColours {
  main: string;
  dark: string;
  light: string;
}

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

export async function coloursFrom(src: string): Promise<ItemColours | null> {
  try {
    const img = await loadImage(src);
    const N = 96;
    const s = N / Math.max(img.naturalWidth, img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * s));
    const h = Math.max(1, Math.round(img.naturalHeight * s));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const px: [number, number, number, number][] = [];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      px.push([d[i], d[i + 1], d[i + 2], 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]]);
    }
    if (px.length < 30) return null;
    px.sort((a, b) => a[3] - b[3]);
    const avg = (from: number, to: number) => {
      const a = px.slice(Math.floor(px.length * from), Math.max(Math.floor(px.length * from) + 1, Math.floor(px.length * to)));
      const sum = a.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      return hex(sum[0] / a.length, sum[1] / a.length, sum[2] / a.length);
    };
    return { main: avg(0.35, 0.75), dark: avg(0, 0.06), light: avg(0.9, 1) };
  } catch {
    return null;
  }
}

/** What a name says the item is, for the matched-model question's default. */
export function guessTemplate(name: string): "sofa" | "armchair" | "table" | "mirror" | null {
  const n = name.toLowerCase();
  if (/\bmirror/.test(n)) return "mirror";
  if (/\b(sofa|couch|loveseat|settee|sectional|divan)/.test(n)) return "sofa";
  if (/\b(armchair|accent chair|lounge chair|club chair|recliner)/.test(n)) return "armchair";
  if (/\b(table|desk)/.test(n)) return "table";
  return null;
}

/** A mirror frame's finish, if the name says. */
export function guessFrame(name: string): string | null {
  const n = name.toLowerCase();
  if (/\b(gold|brass)/.test(n)) return "#c9a24a";
  if (/\b(silver|chrome)/.test(n)) return "#b8bcc2";
  if (/\b(wood|wooden|oak|walnut|teak|rattan|bamboo)/.test(n)) return "#9a6a3e";
  if (/\bwhite\b/.test(n)) return "#ecebe7";
  if (/\bblack\b/.test(n)) return "#1b1b1d";
  return null;
}
