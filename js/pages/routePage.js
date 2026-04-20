import { createMetroMapRenderer } from "../core/mapRenderer.js";
import { loadNetworkBundle } from "../services/dataService.js";
import { findShortestPath } from "../services/pathService.js";

const startSelect = document.getElementById("start-station");
const endSelect = document.getElementById("end-station");
const calculateButton = document.getElementById("calculate-route");
const invertButton = document.getElementById("invert-route");
const clearButton = document.getElementById("clear-route");
const reloadButton = document.getElementById("reload-network");
const resultSummary = document.getElementById("route-summary");
const routeStepsContainer = document.getElementById("route-steps");
const routeMetrics = document.getElementById("route-metrics");
const metricDistance = document.getElementById("metric-distance");
const metricDuration = document.getElementById("metric-duration");
const metricTransfers = document.getElementById("metric-transfers");
const routeLineChips = document.getElementById("route-line-chips");
const plannerMessage = document.getElementById("planner-message");

const renderer = createMetroMapRenderer({
  svg: document.getElementById("route-map"),
  tooltip: document.getElementById("route-tooltip"),
  statusElement: document.getElementById("route-map-status")
});

const state = {
  bundle: null
};

function setPlannerMessage(message, type = "info") {
  plannerMessage.textContent = message;
  if (type === "error") {
    plannerMessage.style.color = "var(--danger)";
    return;
  }
  if (type === "ok") {
    plannerMessage.style.color = "var(--ok)";
    return;
  }
  plannerMessage.style.color = "var(--text-muted)";
}

function buildLineNameMap() {
  return new Map(state.bundle.data.connections.map((line) => [line.lineId, line.name]));
}

function estimateMinutes(distance, transfers) {
  const base = distance / 90;
  return Math.max(2, Math.round(base + transfers * 3));
}

function resetRouteDisplay(message) {
  resultSummary.textContent = message;
  routeStepsContainer.innerHTML = "";
  routeLineChips.innerHTML = "";

  routeMetrics.classList.add("hidden");
  metricDistance.textContent = "-";
  metricDuration.textContent = "-";
  metricTransfers.textContent = "-";
}

function renderLineChips(route, lineNameMap) {
  routeLineChips.innerHTML = "";

  for (const lineId of route.linesUsed) {
    const chip = document.createElement("span");
    chip.className = "route-line-chip";

    const colorDot = document.createElement("span");
    colorDot.className = "route-line-chip-color";
    colorDot.style.background = state.bundle.config.lines?.[lineId] || "#78a7d0";

    const text = document.createElement("span");
    text.textContent = lineNameMap.get(lineId) || lineId;

    chip.appendChild(colorDot);
    chip.appendChild(text);
    routeLineChips.appendChild(chip);
  }
}

function createStepElement(segment, lineNameMap) {
  const item = document.createElement("li");

  const main = document.createElement("div");
  main.className = "route-step-main";

  const stationSpan = document.createElement("span");
  stationSpan.className = "route-step-stations";
  stationSpan.textContent = segment.fromName + " -> " + segment.toName;

  const distanceSpan = document.createElement("span");
  distanceSpan.className = "route-step-distance";
  distanceSpan.textContent = segment.distance.toFixed(1) + " u";

  main.appendChild(stationSpan);
  main.appendChild(distanceSpan);
  item.appendChild(main);

  const lineBadge = document.createElement("span");
  lineBadge.className = "route-step-line";

  const lineDot = document.createElement("span");
  lineDot.className = "route-step-line-dot";
  lineDot.style.background = segment.lineId
    ? (state.bundle.config.lines?.[segment.lineId] || "#78a7d0")
    : "#9ab1c9";

  const lineText = document.createElement("span");
  lineText.textContent = segment.lineId
    ? (lineNameMap.get(segment.lineId) || segment.lineId)
    : "Segment hors ligne";

  lineBadge.appendChild(lineDot);
  lineBadge.appendChild(lineText);
  item.appendChild(lineBadge);

  return item;
}

function renderResult(route) {
  if (!route) {
    resetRouteDisplay("Aucun itineraire trouve pour cette selection.");
    return;
  }

  const lineNameMap = buildLineNameMap();
  const minutes = estimateMinutes(route.totalDistance, route.transfers);
  const startStation = route.segments[0]?.fromName || route.stationIds[0] || "Depart";
  const endStation = route.segments[route.segments.length - 1]?.toName || route.stationIds[0] || "Arrivee";

  resultSummary.textContent = startStation + " -> " + endStation;
  routeMetrics.classList.remove("hidden");
  metricDistance.textContent = route.totalDistance.toFixed(1) + " u";
  metricDuration.textContent = minutes + " min";
  metricTransfers.textContent = String(route.transfers);
  renderLineChips(route, lineNameMap);

  routeStepsContainer.innerHTML = "";

  if (route.segments.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Depart et arrivee identiques.";
    routeStepsContainer.appendChild(item);
    return;
  }

  for (const segment of route.segments) {
    routeStepsContainer.appendChild(createStepElement(segment, lineNameMap));
  }
}

function populateStationSelectors() {
  const selectedStart = startSelect.value;
  const selectedEnd = endSelect.value;

  const stations = [...state.bundle.data.stations].sort((a, b) => a.name.localeCompare(b.name));

  const buildOptions = (selectElement) => {
    selectElement.innerHTML = "";
    for (const station of stations) {
      const option = document.createElement("option");
      option.value = station.id;
      option.textContent = station.name + " (" + station.id + ")";
      selectElement.appendChild(option);
    }
  };

  buildOptions(startSelect);
  buildOptions(endSelect);

  if (stations.length === 0) {
    return;
  }

  const stationIds = new Set(stations.map((station) => station.id));
  startSelect.value = stationIds.has(selectedStart) ? selectedStart : stations[0].id;
  endSelect.value = stationIds.has(selectedEnd)
    ? selectedEnd
    : (stations[Math.min(1, stations.length - 1)].id);
}

function calculateRoute() {
  const startId = startSelect.value;
  const endId = endSelect.value;

  try {
    const route = findShortestPath(state.bundle.data, startId, endId);
    renderResult(route);

    if (!route) {
      renderer.clearRoute();
      setPlannerMessage("Aucun chemin disponible.", "error");
      return;
    }

    renderer.setRoute(route.stationIds);
    renderer.setStatus("Itineraire actif: " + route.stationIds.length + " stations");
    setPlannerMessage("Itineraire calcule avec succes.", "ok");
  } catch (error) {
    console.error(error);
    setPlannerMessage(error.message, "error");
  }
}

async function reloadNetwork() {
  state.bundle = await loadNetworkBundle({ preferStorage: true });
  renderer.setBundle(state.bundle);
  renderer.clearRoute();
  populateStationSelectors();
  resetRouteDisplay("Lance un calcul pour afficher les details d'itineraire.");
  setPlannerMessage("Reseau recharge depuis le stockage local.", "ok");
}

function attachEvents() {
  calculateButton.addEventListener("click", calculateRoute);

  invertButton.addEventListener("click", () => {
    const previousStart = startSelect.value;
    startSelect.value = endSelect.value;
    endSelect.value = previousStart;
  });

  clearButton.addEventListener("click", () => {
    renderer.clearRoute();
    renderer.clearStatusMessage();
    resetRouteDisplay("Lance un calcul pour afficher les details d'itineraire.");
    setPlannerMessage("Itineraire efface.", "info");
  });

  reloadButton.addEventListener("click", () => {
    reloadNetwork().catch((error) => {
      console.error(error);
      setPlannerMessage("Impossible de recharger le reseau.", "error");
    });
  });
}

async function init() {
  await reloadNetwork();
  attachEvents();
}

init().catch((error) => {
  console.error(error);
  setPlannerMessage("Erreur d'initialisation de la page itineraire.", "error");
});
