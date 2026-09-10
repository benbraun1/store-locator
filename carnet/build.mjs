#!/usr/bin/env node
/**
 * Construit l'instantané chiffré du carnet revendeurs et l'injecte dans carnet/index.html.
 *
 * Usage :
 *   CARNET_PASSWORD='…' node carnet/build.mjs --csv export.csv
 *   node carnet/build.mjs --csv export.csv            # le mot de passe est demandé au clavier
 *
 * Le CSV attendu est l'export Matrixify des clients Shopify (même format que
 * « Feuille 1 » du Google Sheet du store locator, ou le CSV publié `_output`) :
 * une ligne « Top Row = TRUE » par client, colonnes Total Orders, Total Spent,
 * Last Order: …, Address ….
 *
 * Le mot de passe n'est jamais écrit dans le dépôt : il sert uniquement à dériver
 * la clé AES-256-GCM (PBKDF2-SHA256, 300 000 itérations) au moment de la construction.
 * Aucune dépendance : Node ≥ 18 (WebCrypto intégré).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto as crypto } from "node:crypto";
import readline from "node:readline";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, "index.html");
const PBKDF2_ITERATIONS = 300_000;
const START_MARK = '<script id="payload" type="application/json">';
const END_MARK = "</script>";

// ── CSV (RFC 4180, champs entre guillemets, retours à la ligne inclus) ──────
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map(h => h.replace(/^﻿/, "").trim());
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const num = v => parseFloat(String(v || "0").replace(",", ".").replace(/\s/g, "")) || 0;
const iso = v => ((v || "").match(/\d{4}-\d{2}-\d{2}/) || [""])[0];
const str = v => (v || "").trim();

function loadStores(csvPath) {
  const rows = parseCSV(readFileSync(csvPath, "utf8"));
  const stores = [];
  rows.forEach((r, i) => {
    if (str(r["Top Row"]).toLowerCase() !== "true") return;
    const totalOrders = Math.round(num(r["Total Orders"]));
    if (totalOrders === 0) return;
    const lastDate = iso(r["Last Order: Processed At"]);
    if (!lastDate) return;

    const contact = `${str(r["First Name"])} ${str(r["Last Name"])}`.trim();
    const name = str(r["Address Company"]) || contact;
    const city = str(r["Address City"]), country = str(r["Address Country"]);
    if (!city && !country) return;

    stores.push({
      id: str(r["ID"]) || String(i),
      name, contact,
      email: str(r["Email"]),
      phone: str(r["Phone"]) || str(r["Address Phone"]),
      address: str(r["Address Line 1"]),
      address2: str(r["Address Line 2"]),
      zip: str(r["Address Zip"]),
      city, country,
      tags: str(r["Tags"]),
      note: str(r["Note"]),
      firstDate: iso(r["First Order: Processed At"]),
      firstAmount: num(r["First Order: Price Total"]),
      lastDate,
      lastAmount: num(r["Last Order: Price Total"]),
      lastOrder: str(r["Last Order: Name"]),
      lifetime: num(r["Total Spent"]),
      totalOrders,
    });
  });
  stores.sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
  return stores;
}

// ── Chiffrement ─────────────────────────────────────────────────────────────
async function encrypt(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const b64 = u8 => Buffer.from(u8).toString("base64");
  return { v: 1, kdf: "PBKDF2-SHA256", iter: PBKDF2_ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

function inject(payload) {
  const html = readFileSync(INDEX, "utf8");
  const start = html.indexOf(START_MARK);
  if (start < 0) throw new Error(`Marqueur introuvable dans ${INDEX}`);
  const end = html.indexOf(END_MARK, start + START_MARK.length);
  writeFileSync(INDEX, html.slice(0, start) + START_MARK + "\n" + JSON.stringify(payload) + "\n" + html.slice(end));
}

function askPassword() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Mot de passe du carnet : ", pw => { rl.close(); resolve(pw); });
  });
}

// ── Main ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const csvPath = opt("--csv");
if (!csvPath) { console.error("Usage : node carnet/build.mjs --csv export.csv [--source 'libellé']"); process.exit(2); }

const password = process.env.CARNET_PASSWORD || (await askPassword());
if (!password) { console.error("Mot de passe vide."); process.exit(2); }

const stores = loadStores(csvPath);
if (!stores.length) { console.error("Aucune boutique avec commande trouvée dans le CSV."); process.exit(1); }

const data = { generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), source: opt("--source") || basename(csvPath), stores };
const plaintext = new TextEncoder().encode(JSON.stringify(data));
inject(await encrypt(plaintext, password));
console.log(`${stores.length} boutiques chiffrées (${Math.round(plaintext.length / 1024)} Ko en clair) → carnet/index.html`);
