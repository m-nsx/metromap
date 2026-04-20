import { toNumber, uniqueValues } from "../utils/object.js";

function normalizeId(value, fieldName) {
  const id = String(value || "").trim().toUpperCase();
  if (!id) {
    throw new Error("Le champ " + fieldName + " est obligatoire.");
  }
  return id;
}

function findStationIndex(data, stationId) {
  return data.stations.findIndex((station) => station.id === stationId);
}

function findConnectionIndex(data, lineId) {
  return data.connections.findIndex((line) => line.lineId === lineId);
}

export function normalizeStationSequence(input) {
  return uniqueValues(
    String(input || "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );
}

export function upsertStation(bundle, stationInput) {
  const stationId = normalizeId(stationInput.id, "ID station");
  const station = {
    id: stationId,
    name: String(stationInput.name || "").trim(),
    x: toNumber(stationInput.x, "X"),
    y: toNumber(stationInput.y, "Y")
  };

  if (!station.name) {
    throw new Error("Le nom de station est obligatoire.");
  }

  if (String(stationInput.labelDx || "").trim() !== "") {
    station.labelDx = toNumber(stationInput.labelDx, "Label X");
  }
  if (String(stationInput.labelDy || "").trim() !== "") {
    station.labelDy = toNumber(stationInput.labelDy, "Label Y");
  }

  const index = findStationIndex(bundle.data, stationId);
  if (index >= 0) {
    bundle.data.stations[index] = station;
  } else {
    bundle.data.stations.push(station);
  }

  return station;
}

export function removeStation(bundle, stationIdInput) {
  const stationId = normalizeId(stationIdInput, "ID station");

  bundle.data.stations = bundle.data.stations.filter((station) => station.id !== stationId);

  for (const line of bundle.data.connections) {
    line.stations = line.stations.filter((id) => id !== stationId);
  }

  bundle.data.connections = bundle.data.connections.filter((line) => line.stations.length >= 2);
}

export function upsertConnection(bundle, connectionInput) {
  const lineId = normalizeId(connectionInput.lineId, "ID ligne");
  const name = String(connectionInput.name || "").trim() || ("Ligne " + lineId);
  const stations = Array.isArray(connectionInput.stations)
    ? connectionInput.stations.map((id) => normalizeId(id, "station de ligne"))
    : normalizeStationSequence(connectionInput.stations);

  if (stations.length < 2) {
    throw new Error("Une ligne doit contenir au moins deux stations.");
  }

  const stationIds = new Set(bundle.data.stations.map((station) => station.id));
  for (const stationId of stations) {
    if (!stationIds.has(stationId)) {
      throw new Error("Station inconnue dans la ligne " + lineId + " : " + stationId);
    }
  }

  const connection = {
    lineId,
    name,
    stations
  };

  const index = findConnectionIndex(bundle.data, lineId);
  if (index >= 0) {
    bundle.data.connections[index] = connection;
  } else {
    bundle.data.connections.push(connection);
  }

  if (!bundle.config.lines) {
    bundle.config.lines = {};
  }

  const color = String(connectionInput.color || "").trim();
  if (color) {
    bundle.config.lines[lineId] = color;
  } else if (!bundle.config.lines[lineId]) {
    bundle.config.lines[lineId] = "#78a7d0";
  }

  return connection;
}

export function removeConnection(bundle, lineIdInput) {
  const lineId = normalizeId(lineIdInput, "ID ligne");
  bundle.data.connections = bundle.data.connections.filter((line) => line.lineId !== lineId);
  if (bundle.config.lines && Object.prototype.hasOwnProperty.call(bundle.config.lines, lineId)) {
    delete bundle.config.lines[lineId];
  }
}

export function validateBundle(bundle) {
  const errors = [];
  const stationIds = bundle.data.stations.map((station) => station.id);
  const uniqueStationIds = new Set(stationIds);

  if (stationIds.length !== uniqueStationIds.size) {
    errors.push("Les ID de station doivent etre uniques.");
  }

  for (const station of bundle.data.stations) {
    if (!station.name || !String(station.name).trim()) {
      errors.push("Une station n'a pas de nom : " + station.id);
    }
    if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) {
      errors.push("Coordonnees invalides pour la station " + station.id);
    }
  }

  const lineIds = bundle.data.connections.map((line) => line.lineId);
  const uniqueLineIds = new Set(lineIds);
  if (lineIds.length !== uniqueLineIds.size) {
    errors.push("Les ID de ligne doivent etre uniques.");
  }

  for (const line of bundle.data.connections) {
    if (!line.stations || line.stations.length < 2) {
      errors.push("La ligne " + line.lineId + " doit avoir au moins deux stations.");
      continue;
    }
    for (const stationId of line.stations) {
      if (!uniqueStationIds.has(stationId)) {
        errors.push("La ligne " + line.lineId + " reference une station inconnue: " + stationId);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
