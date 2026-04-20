import { createDemoBundle } from "../data/demoData.js";
import { deepClone } from "../utils/object.js";

const STORAGE_KEY = "metro-network-bundle-v2";
let inMemoryBundle = null;

function isObject(value) {
  return value !== null && typeof value === "object";
}

function sanitizeBundle(bundle) {
  if (!isObject(bundle)) {
    return null;
  }
  if (!isObject(bundle.config) || !isObject(bundle.data)) {
    return null;
  }
  if (!Array.isArray(bundle.data.stations) || !Array.isArray(bundle.data.connections)) {
    return null;
  }

  return {
    config: deepClone(bundle.config),
    data: {
      stations: deepClone(bundle.data.stations),
      connections: deepClone(bundle.data.connections)
    }
  };
}

function readStoredBundleRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Lecture localStorage indisponible pour le reseau metro.", error);
    return null;
  }
}

function writeStoredBundle(bundle) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
    return true;
  } catch (error) {
    console.warn("Ecriture localStorage indisponible pour le reseau metro.", error);
    return false;
  }
}

function clearStoredBundle() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Suppression localStorage indisponible pour le reseau metro.", error);
  }
}

export async function fetchData(options = {}) {
  const useExternal = Boolean(options.useExternal);
  const configUrl = options.configUrl || "config.json";
  const dataUrl = options.dataUrl || "data.json";

  if (!useExternal) {
    return createDemoBundle();
  }

  const [configResponse, dataResponse] = await Promise.all([
    fetch(configUrl),
    fetch(dataUrl)
  ]);

  if (!configResponse.ok) {
    throw new Error("Impossible de charger " + configUrl + " (" + configResponse.status + ")");
  }
  if (!dataResponse.ok) {
    throw new Error("Impossible de charger " + dataUrl + " (" + dataResponse.status + ")");
  }

  const [config, data] = await Promise.all([
    configResponse.json(),
    dataResponse.json()
  ]);

  const bundle = sanitizeBundle({ config, data });
  if (!bundle) {
    throw new Error("Les fichiers JSON externes ne respectent pas le format attendu.");
  }

  return bundle;
}

export function loadSavedBundle() {
  if (inMemoryBundle) {
    return sanitizeBundle(inMemoryBundle);
  }

  const raw = readStoredBundleRaw();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeBundle(parsed);
    if (sanitized) {
      inMemoryBundle = deepClone(sanitized);
    }
    return sanitized;
  } catch (error) {
    console.warn("Le stockage local contient des donnees invalides.", error);
    return null;
  }
}

export async function loadNetworkBundle(options = {}) {
  const preferStorage = options.preferStorage !== false;

  if (preferStorage) {
    const saved = loadSavedBundle();
    if (saved) {
      return saved;
    }
  }

  return fetchData(options);
}

export function saveNetworkBundle(bundle) {
  const sanitized = sanitizeBundle(bundle);
  if (!sanitized) {
    throw new Error("Impossible de sauvegarder un bundle invalide.");
  }
  inMemoryBundle = deepClone(sanitized);
  writeStoredBundle(sanitized);
  return sanitized;
}

export function resetNetworkBundle() {
  clearStoredBundle();
  const demoBundle = createDemoBundle();
  inMemoryBundle = deepClone(demoBundle);
  return demoBundle;
}

export function getStorageKey() {
  return STORAGE_KEY;
}
