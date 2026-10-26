import { Box3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * The real object, in 3D, from one photo.
 *
 * Matched models get the TYPE right (a sofa is a sofa) but not the piece:
 * a curved bouclé sofa with walnut trim comes back as a generic box sofa.
 * An image-to-3D model reconstructs the actual item — its shape, its back,
 * its texture — as a textured mesh (GLB).
 *
 * Model: TRELLIS (Microsoft, MIT licence), via the public Hugging Face Space
 * `trellis-community/TRELLIS`, which runs on free ZeroGPU hardware. The call
 * goes from the user's own browser, so the free daily GPU allowance is per
 * person (about one model a day) and nothing is billed to anyone. When it runs
 * out, the time until it resets is remembered and shown. The photo is
 * sent to that Space; the UI says so before anything is uploaded.
 *
 * The Space's protocol is Gradio's queue: upload → join the queue for an
 * event → read its result from an event stream. Endpoints are looked up by
 * name from the Space's config, so a reordered app still works, and a
 * changed one fails with a clear message instead of a wrong call.
 */

const SPACE = (process.env.NEXT_PUBLIC_IMAGE_TO_3D_SPACE ?? "https://trellis-community-trellis.hf.space").replace(/\/$/, "");
/** A generated GLB is ~1–3 MB; anything far bigger isn't what we asked for. */
const MAX_GLB = 15_000_000;

export interface GeneratedModel {
  /** data:model/gltf-binary;base64,… — self-contained, nothing fetched later. */
  dataUrl: string;
  /** Natural proportions of the model (any unit): width, height, depth. */
  size: [number, number, number];
}

export type GenerateStatus =
  | { stage: "upload" }
  | { stage: "queue"; position: number }
  | { stage: "building"; etaSeconds?: number }
  | { stage: "download" };

export class GenerateError extends Error {
  constructor(
    message: string,
    /** Out of free GPU time for today — worth saying differently from "it broke". */
    public quota = false,
    /** When the free GPU time comes back (epoch ms), if the service said. */
    public resetAt?: number,
  ) {
    super(message);
  }
}

interface Dep {
  id?: number;
  api_name?: string | null;
  inputs: number[];
}

const RESET_KEY = "aura:3d-reset";

// Earlier builds could keep a Hugging Face token here; that option is gone,
// so don't leave one sitting in the browser.
try {
  if (typeof localStorage !== "undefined") localStorage.removeItem("aura:hf-token");
} catch {
  // Storage blocked: nothing stored either.
}

/**
 * When this device's free 3D time comes back, if it has run out — remembered
 * so a reload still shows the countdown instead of trying (and failing) again.
 */
export function quotaResetAt(): number | null {
  try {
    const t = Number(localStorage.getItem(RESET_KEY));
    return t > Date.now() ? t : null;
  } catch {
    return null;
  }
}
function rememberReset(at: number) {
  try {
    localStorage.setItem(RESET_KEY, String(at));
  } catch {
    // Private mode: the countdown just won't survive a reload.
  }
}

export async function generateModel(
  image: Blob,
  onStatus: (s: GenerateStatus) => void = () => {},
  signal?: AbortSignal,
): Promise<GeneratedModel> {
  const reset = quotaResetAt();
  if (reset) throw new GenerateError("Today's free 3D time on this device is used up.", true, reset);
  const config = (await getJson(`${SPACE}/config`, signal)) as { dependencies: Dep[] };
  const fn = (name: string) => {
    const i = config.dependencies.findIndex((d) => d.api_name === name);
    if (i < 0) throw new GenerateError("The 3D service changed — try again later.");
    return { index: config.dependencies[i].id ?? i, inputs: config.dependencies[i].inputs.length };
  };
  const start = fn("start_session");
  const prep = fn("preprocess_image");
  const gen = fn("generate_and_extract_glb");
  if (gen.inputs !== 11) throw new GenerateError("The 3D service changed — try again later.");

  const session = Math.random().toString(36).slice(2, 13);

  onStatus({ stage: "upload" });
  const form = new FormData();
  form.append("files", image, "item.png");
  const up = await fetch(`${SPACE}/gradio_api/upload`, { method: "POST", body: form, signal });
  if (!up.ok) throw new GenerateError("Couldn't reach the 3D service.");
  const [path] = (await up.json()) as string[];
  const file = { path, meta: { _type: "gradio.FileData" } };

  await run(start.index, [], session, onStatus, signal);
  const pre = await run(prep.index, [file], session, onStatus, signal);
  const prepared = pre[0];
  // image, multi-image list, is-multi-image, seed, structure guidance + steps,
  // detail guidance + steps, multi-image mode, mesh simplify, texture size.
  const out = await run(gen.index, [prepared, [], false, 0, 7.5, 12, 3, 12, "stochastic", 0.95, 1024], session, onStatus, signal);
  const glb = out.find((o): o is { url: string } => Boolean(o && typeof o === "object" && /\.glb$/i.test(String((o as { url?: string }).url))));
  if (!glb) throw new GenerateError("The 3D service didn't return a model.");

  onStatus({ stage: "download" });
  if (!glb.url.startsWith(SPACE + "/")) throw new GenerateError("The 3D service returned an unexpected link.");
  const res = await fetch(glb.url, { signal });
  if (!res.ok) throw new GenerateError("Couldn't download the 3D model.");
  const buf = await res.arrayBuffer();
  checkGlb(buf);
  const size = await measure(buf);
  return { dataUrl: `data:model/gltf-binary;base64,${toBase64(new Uint8Array(buf))}`, size };
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new GenerateError("The 3D service is unavailable right now.");
  return r.json();
}

/** Join the queue for one event and wait for its result. */
async function run(
  fnIndex: number,
  data: unknown[],
  session: string,
  onStatus: (s: GenerateStatus) => void,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const join = await fetch(`${SPACE}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, fn_index: fnIndex, session_hash: session, event_data: null, trigger_id: null }),
    signal,
  });
  if (!join.ok) throw new GenerateError("The 3D service is busy — try again in a minute.");

  const stream = await fetch(`${SPACE}/gradio_api/queue/data?session_hash=${session}`, { signal });
  if (!stream.ok || !stream.body) throw new GenerateError("Lost the connection to the 3D service.");
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const msg = JSON.parse(line.slice(5)) as {
          msg: string;
          rank?: number;
          rank_eta?: number;
          success?: boolean;
          output?: { data?: unknown[]; error?: string | null };
        };
        if (msg.msg === "estimation") {
          if ((msg.rank ?? 0) > 0) onStatus({ stage: "queue", position: msg.rank ?? 0 });
          else onStatus({ stage: "building", etaSeconds: msg.rank_eta });
        } else if (msg.msg === "process_completed") {
          if (!msg.success) {
            const err = String(msg.output?.error ?? "");
            if (/quota|exceeded/i.test(err)) {
              // "Try again in 23:53:33" (h:m:s); without it, assume a day.
              const wait = err.match(/again in (\d+):(\d+)(?::(\d+))?/);
              const ms = wait
                ? ((Number(wait[1]) * 60 + Number(wait[2])) * 60 + Number(wait[3] ?? 0)) * 1000
                : 24 * 3600 * 1000;
              const at = Date.now() + ms;
              rememberReset(at);
              throw new GenerateError("Today's free 3D time on this device is used up.", true, at);
            }
            throw new GenerateError("The 3D service couldn't build this one.");
          }
          return msg.output?.data ?? [];
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  throw new GenerateError("Lost the connection to the 3D service.");
}

/**
 * Only a self-contained binary glTF is accepted: the right magic number, a
 * sane size, and no resource fetched from anywhere when it's loaded.
 */
function checkGlb(buf: ArrayBuffer) {
  if (buf.byteLength < 20 || buf.byteLength > MAX_GLB) throw new GenerateError("The 3D model wasn't usable.");
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== 0x46546c67 /* "glTF" */) throw new GenerateError("The 3D model wasn't usable.");
  const jsonLen = v.getUint32(12, true);
  if (v.getUint32(16, true) !== 0x4e4f534a /* "JSON" */ || 20 + jsonLen > buf.byteLength) {
    throw new GenerateError("The 3D model wasn't usable.");
  }
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };
  const external = [...(json.buffers ?? []), ...(json.images ?? [])].some((r) => r.uri !== undefined);
  if (external) throw new GenerateError("The 3D model wasn't usable.");
}

async function measure(buf: ArrayBuffer): Promise<[number, number, number]> {
  const gltf = await new GLTFLoader().parseAsync(buf.slice(0), "");
  const b = new Box3().setFromObject(gltf.scene);
  const s = b.getSize(b.min.clone());
  return [Math.max(1e-4, s.x), Math.max(1e-4, s.y), Math.max(1e-4, s.z)];
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
