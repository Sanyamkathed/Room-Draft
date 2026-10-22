import {
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  PMREMGenerator,
  RGBAFormat,
  type Texture,
  type WebGLRenderer,
} from "three";

/**
 * Procedurally generated environment map.
 *
 * drei's `<Environment preset>` fetches an HDR from a CDN — a hard external
 * dependency for something that only needs to be a plausible sky/floor
 * gradient with a soft key. Synthesising it costs under a millisecond, works
 * offline, and lets the room's own palette tint the reflections so chrome and
 * glass pick up colours that exist in the user's actual photo.
 */

const WIDTH = 64;
const HEIGHT = 32;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB → linear, so the generated map lives in the same space as the renderer. */
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export interface EnvOptions {
  /** Colour of the upper hemisphere. */
  sky?: string;
  /** Colour of the lower hemisphere. */
  ground?: string;
  /** Overall brightness multiplier. */
  intensity?: number;
}

export function createEnvironmentTexture(
  renderer: WebGLRenderer,
  { sky = "#9aa4b2", ground = "#4a443c", intensity = 1 }: EnvOptions = {},
): Texture {
  const data = new Float32Array(WIDTH * HEIGHT * 4);
  const skyRgb = hexToRgb(sky).map(toLinear);
  const groundRgb = hexToRgb(ground).map(toLinear);

  for (let y = 0; y < HEIGHT; y++) {
    // v: 0 at the top of the sphere, 1 at the bottom
    const v = y / (HEIGHT - 1);
    // Soft horizon rather than a hard split, so reflections don't show a seam.
    const t = 1 / (1 + Math.exp(-(v - 0.5) * 9));

    for (let x = 0; x < WIDTH; x++) {
      const u = x / (WIDTH - 1);

      // A broad soft key high on one side gives specular highlights something
      // to catch — without it every glossy surface reads as flat grey.
      const keyU = 0.22;
      const keyV = 0.24;
      const du = Math.min(Math.abs(u - keyU), 1 - Math.abs(u - keyU));
      const dKey = Math.hypot(du * 2.2, v - keyV);
      const key = Math.exp(-(dKey * dKey) / 0.05) * 1.5;

      const i = (y * WIDTH + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = groundRgb[c] * t + skyRgb[c] * (1 - t);
        data[i + c] = (base + key) * intensity;
      }
      data[i + 3] = 1;
    }
  }

  const tex = new DataTexture(data, WIDTH, HEIGHT, RGBAFormat, FloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(tex);

  tex.dispose();
  pmrem.dispose();

  return target.texture;
}
