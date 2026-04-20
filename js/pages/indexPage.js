import { createMetroMapRenderer } from "../core/mapRenderer.js";
import { loadNetworkBundle, saveNetworkBundle } from "../services/dataService.js";
import { deepClone } from "../utils/object.js";

const svg = document.getElementById("metro-map");
const tooltip = document.getElementById("main-tooltip");
const status = document.getElementById("main-status");
const simulateButton = document.getElementById("simulate-update");
const resetViewButton = document.getElementById("reset-view");
const reloadButton = document.getElementById("reload-bundle");

const renderer = createMetroMapRenderer({
  svg,
  tooltip,
  statusElement: status
});

let bundle = null;

function flashStatus(message) {
  renderer.setStatus(message);
  window.setTimeout(() => {
    renderer.clearStatusMessage();
  }, 1700);
}

function simulateDynamicUpdate() {
  if (!bundle) {
    return;
  }

  const nextBundle = deepClone(bundle);
  const movingStations = ["S8", "S9", "S12"];

  for (const stationId of movingStations) {
    const station = nextBundle.data.stations.find((item) => item.id === stationId);
    if (!station) {
      continue;
    }

    station.x += Math.round((Math.random() - 0.5) * 60);
    station.y += Math.round((Math.random() - 0.5) * 40);
  }

  const lineFive = nextBundle.data.connections.find((line) => line.lineId === "L5");
  if (lineFive && !lineFive.stations.includes("S13")) {
    lineFive.stations.push("S13");
  }

  bundle = saveNetworkBundle(nextBundle);
  renderer.setBundle(bundle, { preserveView: true });
  renderer.setActiveLine(null);
  flashStatus("Reseau modifie puis sauvegarde localement.");
}

async function reloadFromStorage() {
  bundle = await loadNetworkBundle({ preferStorage: true });
  renderer.setBundle(bundle);
  renderer.clearRoute();
  flashStatus("Reseau recharge depuis le stockage local.");
}

async function init() {
  bundle = await loadNetworkBundle({ preferStorage: true });
  renderer.setBundle(bundle);

  simulateButton.addEventListener("click", simulateDynamicUpdate);
  resetViewButton.addEventListener("click", () => renderer.resetView());
  reloadButton.addEventListener("click", reloadFromStorage);
}

init().catch((error) => {
  console.error(error);
  renderer.setStatus("Erreur de chargement du reseau.");
});
