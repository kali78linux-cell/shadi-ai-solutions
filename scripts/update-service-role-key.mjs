#!/usr/bin/env node
/**
 * Replace SUPABASE_SERVICE_ROLE_KEY in .env.local with the new
 * publishable/secret key pair's secret key (sb_s...) from the
 * Supabase Management API. Does NOT print the secret value.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env.local");

const env = fs.readFileSync(envPath, "utf8");
const lines = env.split("\n");
const get = (k) => {
  const l = lines.find((x) => x.startsWith(k + "="));
  return l ? l.slice(k.length + 1).trim() : "";
};

const token = get("SUPABASE_ACCESS_TOKEN");
if (!token) {
  console.error("FATAL: SUPABASE_ACCESS_TOKEN not found in .env.local");
  process.exit(1);
}

const ref = "zcnxrhviyfscyqhavgzj";

const res = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${token}` } }
);

if (!res.ok) {
  const text = await res.text();
  console.error("FATAL: API returned", res.status, text.slice(0, 200));
  process.exit(1);
}

const keys = await res.json();

// Find the secret key. New-format secret keys start with "sb_s".
// The publishable key starts with "sb_p". Legacy JWTs start with "eyJh".
const secretEntry = keys.find((k) => {
  const val = k.api_key || "";
  return val.startsWith("sb_s");
});

if (!secretEntry) {
  console.error("FATAL: No sb_s secret key found in API response.");
  for (const k of keys) {
    const val = k.api_key || "";
    console.log("Available key type:", val.slice(0, 4), "len=", val.length);
  }
  process.exit(1);
}

const newSecret = secretEntry.api_key;

// Confirm it's the matching pair: the publishable key must exist too.
const pubEntry = keys.find((k) => (k.api_key || "").startsWith("sb_p"));

const oldLineIdx = lines.findIndex((l) => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="));
if (oldLineIdx === -1) {
  console.error("FATAL: SUPABASE_SERVICE_ROLE_KEY= not found in .env.local");
  process.exit(1);
}

lines[oldLineIdx] = `SUPABASE_SERVICE_ROLE_KEY=${newSecret}`;

fs.writeFileSync(envPath, lines.join("\n"));

console.log("OK: Replaced SUPABASE_SERVICE_ROLE_KEY in .env.local");
console.log("    New value prefix:", newSecret.slice(0, 4), "length:", newSecret.length);
if (pubEntry) {
  console.log("    Matching publishable key present:", (pubEntry.api_key || "").slice(0, 4), "len=", (pubEntry.api_key || "").length);
}