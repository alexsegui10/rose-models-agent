#!/usr/bin/env node
/**
 * convert-instagram-export.mjs — self-contained converter from a Meta/Instagram data export
 * to this app's ANONYMIZED_JSON import format (see src/application/conversationImport.ts).
 *
 * Modes:
 *   Convert: node scripts/convert-instagram-export.mjs --inbox <path> --folders <name[:category],name[:category],...> --out <file>
 *   Post:    node scripts/convert-instagram-export.mjs --post [file]   (defaults to private-data/replay-set.json)
 *
 * The converter:
 *   - fixes Meta's double encoding (latin1 bytes reinterpreted as UTF-8, e.g. "Â¿" -> "¿");
 *   - reverses messages to chronological order and keeps only real text messages;
 *   - maps sender "Rose Models" -> role "alex", anything else -> role "candidate";
 *   - anonymizes: candidate participant name -> invented Spanish female first name (stable, seeded
 *     from the folder name hash), phone-like sequences (7+ digits) -> fictional 555-01XX fakes
 *     (7 digits so the app's PII import gate accepts the file), @handles stripped, emails and
 *     URLs replaced with "[enlace]".
 *
 * No repo imports and no third-party dependencies: node built-ins only.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import process from "node:process";

const ALEX_SENDER = "Rose Models";
const DEFAULT_REPLAY_FILE = "private-data/replay-set.json";
const IMPORT_ENDPOINT = "http://localhost:3000/api/simulator/conversation-import";

const INVENTED_NAMES = [
  "Lucía",
  "Carmen",
  "Valeria",
  "Paula",
  "Marta",
  "Irene",
  "Claudia",
  "Noelia",
  "Aitana",
  "Rocío",
  "Alba",
  "Nerea",
  "Daniela",
  "Inés",
  "Silvia",
  "Patricia",
  "Sandra",
  "Elena",
  "Adriana",
  "Olivia",
  "Miriam",
  "Tamara",
  "Verónica",
  "Estela"
];

// Meta auto-generated entries that are UI metadata, not text the person typed.
const META_SYSTEM_PATTERNS = [
  /^Liked a message$/i,
  /^Reacted .+ to your message$/i,
  /sent an attachment\.?$/i,
  /^You missed an? (audio|video) (call|chat)/i,
  /^(Audio|Video) (call|chat) ended/i,
  /^This message is no longer available\.?$/i
];

const SMALL_CAPS_MAP = {
  "ᴀ": "a",
  "ʙ": "b",
  "ᴄ": "c",
  "ᴅ": "d",
  "ᴇ": "e",
  "ꜰ": "f",
  "ɢ": "g",
  "ʜ": "h",
  "ɪ": "i",
  "ᴊ": "j",
  "ᴋ": "k",
  "ʟ": "l",
  "ᴍ": "m",
  "ɴ": "n",
  "ᴏ": "o",
  "ᴘ": "p",
  "ǫ": "q",
  "ʀ": "r",
  "ꜱ": "s",
  "ᴛ": "t",
  "ᴜ": "u",
  "ᴠ": "v",
  "ᴡ": "w",
  "ʏ": "y",
  "ᴢ": "z"
};

const ACCENT_CLASSES = {
  a: "aáàäâãå",
  e: "eéèëê",
  i: "iíìïî",
  o: "oóòöôõ",
  u: "uúùüû",
  n: "nñ",
  c: "cç",
  y: "yý"
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { folders: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--inbox") args.inbox = argv[++i];
    else if (arg === "--folders") args.folders = (argv[++i] ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--post") {
      args.post = true;
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) args.postFile = argv[++i];
    } else fail(`Argumento desconocido: ${arg}`);
  }
  return args;
}

/**
 * Meta double-encodes non-ASCII text: the JSON escapes decode to UTF-8 bytes stored as
 * latin1 code points. Re-encoding the parsed string as latin1 bytes and decoding as UTF-8
 * recovers the real text ("Â¿" -> "¿"). Strings already containing code points above 0xFF
 * or whose re-decode yields U+FFFD are left untouched.
 */
function fixMojibake(value) {
  if (typeof value !== "string") return value;
  for (const char of value) {
    if (char.codePointAt(0) > 0xff) return value;
  }
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("�") ? value : decoded;
}

function hashString(input) {
  // FNV-1a 32-bit: deterministic seed for the invented name and fake phone digits.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function foldToAscii(text) {
  let normalized = text.normalize("NFKC");
  normalized = [...normalized].map((char) => SMALL_CAPS_MAP[char] ?? char).join("");
  return normalized
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

function nameTokens(participantName, folderName) {
  const tokens = new Set();
  const foldedParticipant = foldToAscii(participantName);
  const parts = foldedParticipant.split(/[^a-z]+/).filter((part) => part.length >= 3);
  for (const part of parts) tokens.add(part);
  const folderUser = folderName.replace(/_\d+$/, "").toLowerCase();
  if (folderUser.length >= 3) tokens.add(folderUser);
  return { tokens: [...tokens], phraseParts: parts };
}

function accentInsensitivePattern(token) {
  return [...token].map((char) => (ACCENT_CLASSES[char] ? `[${ACCENT_CLASSES[char]}]` : char)).join("");
}

function boundaryRegex(body) {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "giu");
}

function pickInventedName(seed, forbiddenTokens) {
  for (let offset = 0; offset < INVENTED_NAMES.length; offset++) {
    const candidate = INVENTED_NAMES[(seed + offset) % INVENTED_NAMES.length];
    if (!forbiddenTokens.includes(foldToAscii(candidate))) return candidate;
  }
  return INVENTED_NAMES[seed % INVENTED_NAMES.length];
}

function createAnonymizer(participantName, folderName) {
  const { tokens, phraseParts } = nameTokens(participantName, folderName);
  const seed = hashString(folderName);
  const inventedName = pickInventedName(seed % INVENTED_NAMES.length, tokens);
  const replacers = [];

  if (phraseParts.length > 1) {
    replacers.push(boundaryRegex(phraseParts.map(accentInsensitivePattern).join("[\\s._\\-]+")));
  }
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    replacers.push(boundaryRegex(accentInsensitivePattern(token)));
  }

  let phoneCount = 0;
  const anonymize = (content) => {
    let text = content;
    // URLs and emails first (their digits/handles must not survive), then bare @handles.
    text = text.replace(/(?:https?:\/\/|www\.)[^\s]+/gi, "[enlace]");
    text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[enlace]");
    text = text.replace(/@[A-Za-z0-9._]{2,}/g, "");
    for (const regex of replacers) text = text.replace(regex, inventedName);
    text = text.replace(/\+?\d(?:[\s().\-]?\d){6,}/g, (match) => {
      const fakeTail = String((seed + 17 * phoneCount++) % 100).padStart(2, "0");
      return /[^\d]/.test(match) ? `555-01${fakeTail}` : `55501${fakeTail}`;
    });
    return text.replace(/[ \t]{3,}/g, " ").trim();
  };

  return { anonymize, inventedName };
}

function isMetaSystemMessage(content) {
  return META_SYSTEM_PATTERNS.some((pattern) => pattern.test(content));
}

function slugify(text) {
  return foldToAscii(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function convertFolder(inboxPath, folderSpec, index) {
  const [folderName, category = "general"] = folderSpec.split(":").map((part) => part.trim());
  const messageFile = join(inboxPath, folderName, "message_1.json");
  const data = JSON.parse(readFileSync(messageFile, "utf8"));

  const participants = (data.participants ?? []).map((participant) => fixMojibake(participant.name));
  const candidateName = participants.find((name) => name !== ALEX_SENDER);
  if (!candidateName) fail(`No se encontró participante candidata en ${folderName}`);

  const { anonymize, inventedName } = createAnonymizer(candidateName, folderName);

  const chronological = [...data.messages].reverse().sort((a, b) => (a.timestamp_ms ?? 0) - (b.timestamp_ms ?? 0));
  const messages = [];
  for (const message of chronological) {
    if (typeof message.content !== "string") continue;
    const fixed = fixMojibake(message.content).trim();
    if (!fixed || isMetaSystemMessage(fixed)) continue;
    const content = anonymize(fixed);
    if (!content) continue;
    const role = fixMojibake(message.sender_name) === ALEX_SENDER ? "alex" : "candidate";
    messages.push({ role, content });
  }

  if (messages.length === 0) fail(`La conversación ${folderName} quedó sin mensajes de texto tras el filtrado`);

  return {
    conversation: {
      id: `replay-${index + 1}-${slugify(category)}`,
      status: "RAW_REAL",
      source: "ANONYMIZED_JSON",
      purpose: "EVALUATION",
      category,
      messages
    },
    inventedName,
    messageCount: messages.length
  };
}

function runConvert(args) {
  if (!args.inbox || args.folders.length === 0 || !args.out) {
    fail(
      "Uso: node scripts/convert-instagram-export.mjs --inbox <ruta-inbox> --folders <carpeta[:categoria],...> --out <fichero>\n" +
        "     node scripts/convert-instagram-export.mjs --post [fichero]"
    );
  }

  const conversations = [];
  for (let i = 0; i < args.folders.length; i++) {
    const { conversation, inventedName, messageCount } = convertFolder(args.inbox, args.folders[i], i);
    conversations.push(conversation);
    console.log(`${conversation.id}: ${messageCount} mensajes (candidata -> ${inventedName})`);
  }

  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ version: "1", conversations }, null, 2) + "\n", "utf8");
  console.log(`Escritas ${conversations.length} conversaciones anonimizadas en ${outPath}`);
}

async function runPost(args) {
  const filePath = resolve(args.postFile ?? DEFAULT_REPLAY_FILE);
  let json;
  try {
    json = readFileSync(filePath, "utf8");
  } catch {
    fail(`No existe ${filePath}. Genera primero el fichero con: npm run convert:instagram`);
  }

  let response;
  try {
    response = await fetch(IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json })
    });
  } catch {
    fail(`No se pudo conectar a ${IMPORT_ENDPOINT} — arranca npm run dev primero.`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`Importación rechazada (HTTP ${response.status}): ${JSON.stringify(body)}`);
  }

  const imported = Array.isArray(body.conversations) ? body.conversations : [];
  console.log(`Importadas ${imported.length} conversaciones:`);
  for (const conversation of imported) {
    console.log(`- ${conversation.id} [${conversation.category}] ${conversation.messages.length} mensajes`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.post) {
  await runPost(args);
} else {
  runConvert(args);
}
