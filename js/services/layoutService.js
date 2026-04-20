import { deepClone } from "../utils/object.js";

function buildUniqueEdges(connections) {
  const keySet = new Set();
  const edges = [];

  for (const line of connections) {
    for (let index = 0; index < line.stations.length - 1; index += 1) {
      const a = line.stations[index];
      const b = line.stations[index + 1];
      const key = a < b ? a + "|" + b : b + "|" + a;

      if (keySet.has(key)) {
        continue;
      }

      keySet.add(key);
      edges.push([a, b]);
    }
  }

  return edges;
}

function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

export function optimizeStationLayout(bundle, options = {}) {
  const nextBundle = deepClone(bundle);
  const stations = nextBundle?.data?.stations || [];
  const connections = nextBundle?.data?.connections || [];

  if (stations.length < 2) {
    return {
      bundle: nextBundle,
      iterations: 0,
      movedStations: 0,
      totalShift: 0,
      averageShift: 0
    };
  }

  const stationIndexById = new Map();
  for (let index = 0; index < stations.length; index += 1) {
    stationIndexById.set(stations[index].id, index);
  }

  const edges = buildUniqueEdges(connections)
    .map(([fromId, toId]) => {
      if (!stationIndexById.has(fromId) || !stationIndexById.has(toId)) {
        return null;
      }
      return [stationIndexById.get(fromId), stationIndexById.get(toId)];
    })
    .filter(Boolean);

  const positions = stations.map((station) => ({
    x: Number(station.x),
    y: Number(station.y)
  }));
  const initialPositions = stations.map((station) => ({
    x: Number(station.x),
    y: Number(station.y)
  }));

  const edgeLengths = edges.map(([fromIndex, toIndex]) => {
    const from = initialPositions[fromIndex];
    const to = initialPositions[toIndex];
    return Math.hypot(to.x - from.x, to.y - from.y);
  });

  const targetEdgeLength =
    options.targetEdgeLength ||
    Math.max(90, Math.min(210, median(edgeLengths) || 130));

  const iterationCount =
    Number.isInteger(options.iterationCount) && options.iterationCount > 0
      ? options.iterationCount
      : 260;

  const repulsionStrength = (options.repulsionStrength || 1.15) * targetEdgeLength * targetEdgeLength;
  const springStrength = options.springStrength || 0.024;
  const anchorStrength = options.anchorStrength || 0.015;
  const minSpacing = options.minSpacing || targetEdgeLength * 0.44;
  const snapGrid = options.snapGrid || 2;

  const initialCentroid = initialPositions.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  initialCentroid.x /= initialPositions.length;
  initialCentroid.y /= initialPositions.length;

  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    const forces = positions.map(() => ({ x: 0, y: 0 }));
    const cooling = 0.3 - (0.22 * iteration) / Math.max(1, iterationCount - 1);

    // Pairwise repulsion to reduce overlaps and improve station readability.
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const distanceSquared = dx * dx + dy * dy + 0.01;
        const distance = Math.sqrt(distanceSquared);

        const nx = dx / distance;
        const ny = dy / distance;

        const repulsion = repulsionStrength / distanceSquared;
        forces[i].x -= nx * repulsion;
        forces[i].y -= ny * repulsion;
        forces[j].x += nx * repulsion;
        forces[j].y += ny * repulsion;

        if (distance < minSpacing) {
          const extra = (minSpacing - distance) * 0.24;
          forces[i].x -= nx * extra;
          forces[i].y -= ny * extra;
          forces[j].x += nx * extra;
          forces[j].y += ny * extra;
        }
      }
    }

    // Springs on connected stations to keep line continuity coherent.
    for (const [fromIndex, toIndex] of edges) {
      const from = positions[fromIndex];
      const to = positions[toIndex];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const nx = dx / distance;
      const ny = dy / distance;

      const spring = (distance - targetEdgeLength) * springStrength;
      forces[fromIndex].x += nx * spring;
      forces[fromIndex].y += ny * spring;
      forces[toIndex].x -= nx * spring;
      forces[toIndex].y -= ny * spring;
    }

    // Anchor force to preserve global map shape and avoid drift.
    for (let index = 0; index < positions.length; index += 1) {
      const anchorDx = initialPositions[index].x - positions[index].x;
      const anchorDy = initialPositions[index].y - positions[index].y;
      forces[index].x += anchorDx * anchorStrength;
      forces[index].y += anchorDy * anchorStrength;
    }

    for (let index = 0; index < positions.length; index += 1) {
      positions[index].x += forces[index].x * cooling;
      positions[index].y += forces[index].y * cooling;
    }
  }

  const optimizedCentroid = positions.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  optimizedCentroid.x /= positions.length;
  optimizedCentroid.y /= positions.length;

  const centroidShiftX = initialCentroid.x - optimizedCentroid.x;
  const centroidShiftY = initialCentroid.y - optimizedCentroid.y;

  let movedStations = 0;
  let totalShift = 0;

  for (let index = 0; index < stations.length; index += 1) {
    const rawX = positions[index].x + centroidShiftX;
    const rawY = positions[index].y + centroidShiftY;

    const snappedX = Math.round(rawX / snapGrid) * snapGrid;
    const snappedY = Math.round(rawY / snapGrid) * snapGrid;

    const delta = Math.hypot(snappedX - initialPositions[index].x, snappedY - initialPositions[index].y);
    if (delta > 0.6) {
      movedStations += 1;
    }

    totalShift += delta;
    stations[index].x = snappedX;
    stations[index].y = snappedY;
  }

  return {
    bundle: nextBundle,
    iterations: iterationCount,
    movedStations,
    totalShift,
    averageShift: totalShift / stations.length
  };
}
