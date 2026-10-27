import type { AestheticId } from "./types";

/**
 * A real room for each aesthetic, so a card shows what the style looks like
 * lived in rather than an abstract swatch.
 *
 * All photos are from Unsplash under the Unsplash License (free to use, no
 * permission needed). They load from Unsplash's image CDN, sized per request.
 */
const PHOTOS: Record<AestheticId, string> = {
  "dark-academia": "1722182877533-7378b60bf1e8",
  minimalist: "1781572725438-ac8c41476752",
  cyberpunk: "1616588589676-62b3bd4ff6d2",
  anime: "1701281941420-d3ad09f5380c",
  gaming: "1775410633801-5d7997f795c6",
  cozy: "1552858725-a19e7fcd3ac4",
  scandinavian: "1583847268964-b28dc8f51f92",
  y2k: "1652882860938-f90aa298e644",
  indie: "1743867840110-ee532b7c6fb9",
  retro: "1632119580908-ae947d4c7691",
  streetwear: "1633464129147-777bdcc97c1d",
  neon: "1543726969-a1da85a6d334",
  moody: "1552858725-2758b5fb1286",
  "clean-desk": "1762983870490-63e5ba07105b",
  creator: "1632582204758-5ac65783517a",
};

/** A cropped, compressed URL for the aesthetic's room photo. */
export function aestheticPhoto(id: AestheticId, width = 640, height = 800): string {
  return `https://images.unsplash.com/photo-${PHOTOS[id]}?w=${width}&h=${height}&fit=crop&auto=format&q=70`;
}
