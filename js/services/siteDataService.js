import { deepClone } from "../utils/object.js";

const DEFAULT_NETWORK_URL = "data/metro-network.json";

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

export async function loadSiteNetworkBundle(options = {}) {
  const url = options.url || DEFAULT_NETWORK_URL;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Impossible de charger le reseau JSON: " + url + " (" + response.status + ")");
  }

  const parsed = await response.json();
  const bundle = sanitizeBundle(parsed);

  if (!bundle) {
    throw new Error("Le JSON du reseau ne respecte pas le format attendu ({ config, data }).");
  }

  return bundle;
}

export function getDefaultSiteNetworkUrl() {
  return DEFAULT_NETWORK_URL;
}
