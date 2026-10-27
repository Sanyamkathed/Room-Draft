import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Fetching a URL the user pasted, without letting it reach anything private.
 *
 * The import route fetches arbitrary links on the user's behalf, which makes it
 * a textbook SSRF target: "http://localhost:8000/admin", a cloud metadata
 * address, or a hostname that resolves to the office printer. So:
 *
 *  - only http(s), on the default ports, with no credentials in the URL;
 *  - the hostname is resolved and EVERY address checked against private,
 *    loopback, link-local and other reserved ranges;
 *  - that check runs inside the socket's own DNS lookup, so the address that
 *    passed is the address connected to (no DNS-rebinding window between a
 *    pre-check and the real request);
 *  - redirects are followed by hand, re-checking every hop;
 *  - hard caps on time and bytes, so a slow or endless response can't tie
 *    the server up.
 */

export class FetchRefused extends Error {}

const MAX_REDIRECTS = 4;
const TOO_LARGE = "That file is too large to import. Save the image and upload it instead.";

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

function inV4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** An IPv6 address as eight 16-bit groups, with any dotted IPv4 tail folded in. */
function v6Groups(ip: string): number[] {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4ToInt(tail[1]);
    s = s.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((g) => parseInt(g, 16));
}

function groupsToV4(hi: number, lo: number): string {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return !BLOCKED_V4.some(([b, n]) => inV4(ip, b, n));
  if (!net.isIPv6(ip)) return false;
  const g = v6Groups(ip);
  // ::ffff:a.b.c.d and the old ::a.b.c.d both reach IPv4 directly, so they
  // are only as public as the IPv4 address inside them. Written in hex
  // (::ffff:7f00:1 — which is how URL normalises them) they look nothing like
  // 127.0.0.1, which is why this works on the numbers, not the text.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return false; // :: and ::1
    return isPublicAddress(groupsToV4(g[6], g[7]));
  }
  // Everything else must be global unicast (2000::/3). That alone rules out
  // loopback, link-local, unique-local, multicast and the NAT64 prefix.
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo tunnels
  if (g[0] === 0x2002) return isPublicAddress(groupsToV4(g[1], g[2])); // 6to4 carries an IPv4 address
  return true;
}

/** DNS lookup that refuses to hand the socket a non-public address. */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (!list.length || bad) {
      return callback(new FetchRefused("That address isn't on the public internet."), "", 4);
    }
    if ((options as dns.LookupOptions).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

export function assertFetchableUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchRefused("That doesn't look like a link.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new FetchRefused("Only http and https links can be imported.");
  }
  if (u.username || u.password) throw new FetchRefused("Links with a login in them can't be imported.");
  if (u.port && u.port !== "80" && u.port !== "443") {
    throw new FetchRefused("Links to unusual ports can't be imported.");
  }
  // An IP literal skips DNS, so check it directly.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) {
    throw new FetchRefused("That address isn't on the public internet.");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchRefused("That address isn't on the public internet.");
  }
  return u;
}

export interface SafeResponse {
  url: URL;
  status: number;
  contentType: string;
  body: Buffer;
}

function once(url: URL, maxBytes: number, timeoutMs: number, accept: string): Promise<SafeResponse & { location?: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        timeout: timeoutMs,
        headers: {
          // A plain browser-like UA: many sites serve their Open Graph tags
          // only to agents they recognise. No cookies, no credentials, ever.
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 RoomDraft-import",
          accept,
          "accept-language": "en-IN,en;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ url, status, contentType: "", body: Buffer.alloc(0), location: res.headers.location });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new FetchRefused(TOO_LARGE));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new FetchRefused(TOO_LARGE));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            url,
            status,
            contentType: String(res.headers["content-type"] ?? "").toLowerCase(),
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new FetchRefused("That site took too long to answer.")));
    req.on("error", (e) => reject(e instanceof FetchRefused ? e : new FetchRefused("Couldn't reach that site.")));
    req.end();
  });
}

/** GET a public URL with every guard above. Follows redirects by hand. */
export async function safeGet(
  raw: string,
  { maxBytes, timeoutMs = 8000, accept = "*/*" }: { maxBytes: number; timeoutMs?: number; accept?: string },
): Promise<SafeResponse> {
  let url = assertFetchableUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await once(url, maxBytes, timeoutMs, accept);
    if (!res.location) return res;
    url = assertFetchableUrl(new URL(res.location, url).toString());
  }
  throw new FetchRefused("That link redirects too many times.");
}
