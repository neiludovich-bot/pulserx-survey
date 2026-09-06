import { lookup } from "node:dns/promises";
import { Agent, fetch } from "undici";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const) blocked.addSubnet(address, prefix);
export function publicWebsiteAddress(address: string) { return isIP(address) === 4 && !blocked.check(address); }

/** Pin the validated DNS result to the socket; preserve hostname for TLS verification. */
export async function downloadPublicWebsite(value: string) {
  const url = new URL(value);
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(a => !publicWebsiteAddress(a.address))) throw new Error("Website must resolve to public internet addresses");
  const dispatcher = new Agent({ connect: { lookup: (_hostname, options, callback) => {
    if (options.all) callback(null, [addresses[0]]);
    else callback(null, addresses[0].address, 4);
  } } });
  try {
    const response = await fetch(url, { dispatcher, redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "PulseRX-Website-Indexer/1.0" } });
    const parts: Uint8Array[] = []; let size = 0;
    const reader = response.body!.getReader();
    try {
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 24 * 1024 * 1024) throw new Error("Document exceeds 24 MB bound"); parts.push(next.value); }
    } finally { await reader.cancel(); }
    return { status: response.status, location: response.headers.get("location") ?? undefined, type: response.headers.get("content-type") ?? "", bytes: Buffer.concat(parts) };
  } finally { await dispatcher.close(); }
}
