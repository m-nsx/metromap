const SESSION_KEY = "metro-admin-session-v1";
const CREDENTIALS_KEY = "metro-admin-credentials-v2";
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "metro-2026";
const DEFAULT_PBKDF2_ITERATIONS = 150000;

let inMemorySession = null;
let inMemoryCredentials = null;

function getCryptoSubtle() {
  const subtle = globalThis?.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto indisponible: impossible d'authentifier de maniere securisee.");
  }
  return subtle;
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn("Lecture localStorage indisponible pour la cle " + key + ".", error);
    return null;
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn("Ecriture localStorage indisponible pour la cle " + key + ".", error);
    return false;
  }
}

function clearStoredValue(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn("Suppression localStorage indisponible pour la cle " + key + ".", error);
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const cleaned = String(hex || "").trim().toLowerCase();
  if (!cleaned || cleaned.length % 2 !== 0) {
    return new Uint8Array();
  }

  const result = new Uint8Array(cleaned.length / 2);
  for (let index = 0; index < cleaned.length; index += 2) {
    result[index / 2] = Number.parseInt(cleaned.slice(index, index + 2), 16);
  }

  return result;
}

function timingSafeEqualHex(leftHex, rightHex) {
  const left = hexToBytes(leftHex);
  const right = hexToBytes(rightHex);

  if (left.length !== right.length || left.length === 0) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}

function createSaltHex(size = 16) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function derivePasswordHashHex(password, saltHex, iterations) {
  const subtle = getCryptoSubtle();
  const encoder = new TextEncoder();

  const passKey = await subtle.importKey(
    "raw",
    encoder.encode(String(password || "")),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex),
      iterations,
      hash: "SHA-256"
    },
    passKey,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

function normalizeSession(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const username = String(candidate.username || "").trim();
  if (!username) {
    return null;
  }

  return {
    username,
    loginAt: candidate.loginAt ? String(candidate.loginAt) : new Date().toISOString()
  };
}

function normalizeCredentials(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const username = String(candidate.username || "").trim();
  const saltHex = String(candidate.saltHex || "").trim().toLowerCase();
  const hashHex = String(candidate.hashHex || "").trim().toLowerCase();
  const iterations = Number(candidate.iterations);

  if (!username || !saltHex || !hashHex || !Number.isInteger(iterations) || iterations < 10000) {
    return null;
  }

  return {
    username,
    saltHex,
    hashHex,
    iterations,
    updatedAt: candidate.updatedAt ? String(candidate.updatedAt) : new Date().toISOString()
  };
}

async function createCredentialsRecord(username, password) {
  const cleanedUser = String(username || "").trim();
  const saltHex = createSaltHex();
  const hashHex = await derivePasswordHashHex(password, saltHex, DEFAULT_PBKDF2_ITERATIONS);

  return {
    username: cleanedUser,
    saltHex,
    hashHex,
    iterations: DEFAULT_PBKDF2_ITERATIONS,
    updatedAt: new Date().toISOString()
  };
}

async function ensureCredentials() {
  if (inMemoryCredentials) {
    return { ...inMemoryCredentials };
  }

  const raw = readStoredValue(CREDENTIALS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const normalized = normalizeCredentials(parsed);
      if (normalized) {
        inMemoryCredentials = normalized;
        return { ...normalized };
      }
    } catch (error) {
      console.warn("Credentials stockees invalides, regeneration.", error);
    }
  }

  const defaults = await createCredentialsRecord(DEFAULT_USERNAME, DEFAULT_PASSWORD);
  inMemoryCredentials = defaults;
  writeStoredValue(CREDENTIALS_KEY, JSON.stringify(defaults));
  return { ...defaults };
}

async function verifyPassword(password, credentials) {
  const computedHashHex = await derivePasswordHashHex(password, credentials.saltHex, credentials.iterations);
  return timingSafeEqualHex(computedHashHex, credentials.hashHex);
}

export async function initializeAuth() {
  await ensureCredentials();
}

export async function login(username, password) {
  const cleanedUser = String(username || "").trim();
  const credentials = await ensureCredentials();

  if (cleanedUser !== credentials.username) {
    return false;
  }

  const verified = await verifyPassword(String(password || ""), credentials);
  if (!verified) {
    return false;
  }

  const session = {
    username: credentials.username,
    loginAt: new Date().toISOString()
  };

  inMemorySession = session;
  writeStoredValue(SESSION_KEY, JSON.stringify(session));
  return true;
}

export async function changePassword(currentPassword, nextPassword) {
  const next = String(nextPassword || "");
  if (next.length < 8) {
    throw new Error("Le nouveau mot de passe doit contenir au moins 8 caracteres.");
  }

  const credentials = await ensureCredentials();
  const verified = await verifyPassword(String(currentPassword || ""), credentials);
  if (!verified) {
    throw new Error("Le mot de passe actuel est incorrect.");
  }

  const updated = await createCredentialsRecord(credentials.username, next);
  inMemoryCredentials = updated;
  writeStoredValue(CREDENTIALS_KEY, JSON.stringify(updated));
  return true;
}

export function logout() {
  inMemorySession = null;
  clearStoredValue(SESSION_KEY);
}

export function getSession() {
  if (inMemorySession) {
    return { ...inMemorySession };
  }

  const raw = readStoredValue(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeSession(parsed);
    if (normalized) {
      inMemorySession = normalized;
      return { ...normalized };
    }

    return null;
  } catch (error) {
    return null;
  }
}

export function isAuthenticated() {
  return Boolean(getSession());
}

export function getDefaultCredentials() {
  return {
    username: DEFAULT_USERNAME,
    password: DEFAULT_PASSWORD
  };
}
