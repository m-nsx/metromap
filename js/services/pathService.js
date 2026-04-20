function euclideanDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function addEdge(graph, fromId, toId, lineId, weight) {
  if (!graph.has(fromId)) {
    graph.set(fromId, new Map());
  }

  const neighbors = graph.get(fromId);
  const existing = neighbors.get(toId);

  if (existing) {
    existing.weight = Math.min(existing.weight, weight);
    existing.lineIds.add(lineId);
    return;
  }

  neighbors.set(toId, {
    weight,
    lineIds: new Set([lineId])
  });
}

function buildGraph(data) {
  const stationById = new Map(data.stations.map((station) => [station.id, station]));
  const graph = new Map();

  for (const line of data.connections) {
    for (let index = 0; index < line.stations.length - 1; index += 1) {
      const fromId = line.stations[index];
      const toId = line.stations[index + 1];
      const fromStation = stationById.get(fromId);
      const toStation = stationById.get(toId);

      if (!fromStation || !toStation) {
        continue;
      }

      const distance = euclideanDistance(fromStation, toStation);
      addEdge(graph, fromId, toId, line.lineId, distance);
      addEdge(graph, toId, fromId, line.lineId, distance);
    }
  }

  return {
    graph,
    stationById
  };
}

function chooseLineForSegment(lineIds, previousLineId) {
  if (previousLineId && lineIds.includes(previousLineId)) {
    return previousLineId;
  }
  return lineIds[0] || null;
}

export function findShortestPath(data, startId, endId) {
  if (!startId || !endId) {
    throw new Error("Le depart et l'arrivee sont obligatoires.");
  }

  if (startId === endId) {
    const station = data.stations.find((item) => item.id === startId);
    if (!station) {
      return null;
    }

    return {
      stationIds: [startId],
      totalDistance: 0,
      transfers: 0,
      linesUsed: [],
      segments: []
    };
  }

  const { graph, stationById } = buildGraph(data);

  if (!stationById.has(startId) || !stationById.has(endId)) {
    return null;
  }

  const distances = new Map();
  const previous = new Map();
  const visited = new Set();

  for (const station of data.stations) {
    distances.set(station.id, Number.POSITIVE_INFINITY);
  }
  distances.set(startId, 0);

  while (visited.size < data.stations.length) {
    let currentId = null;
    let currentDistance = Number.POSITIVE_INFINITY;

    for (const [stationId, distance] of distances.entries()) {
      if (!visited.has(stationId) && distance < currentDistance) {
        currentDistance = distance;
        currentId = stationId;
      }
    }

    if (currentId === null || currentDistance === Number.POSITIVE_INFINITY) {
      break;
    }

    if (currentId === endId) {
      break;
    }

    visited.add(currentId);

    const neighbors = graph.get(currentId) || new Map();
    for (const [neighborId, edge] of neighbors.entries()) {
      if (visited.has(neighborId)) {
        continue;
      }

      const candidateDistance = currentDistance + edge.weight;
      if (candidateDistance < distances.get(neighborId)) {
        distances.set(neighborId, candidateDistance);
        previous.set(neighborId, {
          node: currentId,
          lineIds: Array.from(edge.lineIds)
        });
      }
    }
  }

  if (distances.get(endId) === Number.POSITIVE_INFINITY) {
    return null;
  }

  const stationIds = [endId];
  let walker = endId;

  while (walker !== startId) {
    const prev = previous.get(walker);
    if (!prev) {
      return null;
    }
    stationIds.unshift(prev.node);
    walker = prev.node;
  }

  const segments = [];
  const linesUsedSet = new Set();
  let previousLineId = null;
  let transfers = 0;

  for (let i = 1; i < stationIds.length; i += 1) {
    const fromId = stationIds[i - 1];
    const toId = stationIds[i];
    const edge = graph.get(fromId)?.get(toId);

    if (!edge) {
      continue;
    }

    const candidateLines = Array.from(edge.lineIds);
    const lineId = chooseLineForSegment(candidateLines, previousLineId);

    if (previousLineId && lineId && previousLineId !== lineId) {
      transfers += 1;
    }

    if (lineId) {
      linesUsedSet.add(lineId);
    }

    segments.push({
      fromId,
      toId,
      fromName: stationById.get(fromId)?.name || fromId,
      toName: stationById.get(toId)?.name || toId,
      lineId,
      distance: edge.weight
    });

    previousLineId = lineId;
  }

  return {
    stationIds,
    totalDistance: distances.get(endId),
    transfers,
    linesUsed: Array.from(linesUsedSet),
    segments
  };
}
