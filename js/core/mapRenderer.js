import { deepClone } from "../utils/object.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_CONFIG = {
  lines: {},
  lineStyle: {
    strokeWidth: 12,
    activeWidthFactor: 1.3,
    inactiveOpacity: 0.18
  },
  stationStyle: {
    radius: 7,
    interchangeRadius: 9.5,
    stroke: "#d8e4f2",
    strokeWidth: 3,
    fill: "#0f1823",
    labelDx: 13,
    labelDy: -12
  },
  display: {
    showGrid: true,
    gridStep: 80,
    padding: 160
  },
  typography: {
    family: '"Outfit", "Sora", "Segoe UI", sans-serif',
    stationFontSize: 14
  },
  navigation: {
    minZoom: 0.7,
    maxZoom: 6
  }
};

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) {
      element.setAttribute(key, String(value));
    }
  }
  return element;
}

function mergeConfig(config = {}) {
  return {
    lines: {
      ...DEFAULT_CONFIG.lines,
      ...(config.lines || {})
    },
    lineStyle: {
      ...DEFAULT_CONFIG.lineStyle,
      ...(config.lineStyle || {})
    },
    stationStyle: {
      ...DEFAULT_CONFIG.stationStyle,
      ...(config.stationStyle || {})
    },
    display: {
      ...DEFAULT_CONFIG.display,
      ...(config.display || {})
    },
    typography: {
      ...DEFAULT_CONFIG.typography,
      ...(config.typography || {})
    },
    navigation: {
      ...DEFAULT_CONFIG.navigation,
      ...(config.navigation || {})
    }
  };
}

function normalizeBundle(inputBundle) {
  const bundle = deepClone(inputBundle || {});
  if (!bundle.data || !Array.isArray(bundle.data.stations) || !Array.isArray(bundle.data.connections)) {
    throw new Error("Bundle invalide pour le rendu de la carte.");
  }

  return {
    config: mergeConfig(bundle.config),
    data: {
      stations: bundle.data.stations,
      connections: bundle.data.connections
    }
  };
}

export function createMetroMapRenderer(options) {
  const svg = options.svg;
  const tooltip = options.tooltip || null;
  const statusElement = options.statusElement || null;
  const enableNavigation = options.enableNavigation !== false;
  const onStationClick = typeof options.onStationClick === "function" ? options.onStationClick : null;
  const onLineClick = typeof options.onLineClick === "function" ? options.onLineClick : null;
  const onMapBackgroundClick = typeof options.onMapBackgroundClick === "function"
    ? options.onMapBackgroundClick
    : null;

  if (!svg) {
    throw new Error("Un element SVG est obligatoire pour initialiser le renderer.");
  }

  const state = {
    bundle: null,
    stationById: new Map(),
    stationLines: new Map(),
    lineById: new Map(),
    activeLineId: null,
    routeStationIds: [],
    baseViewBox: null,
    viewBox: null,
    pan: {
      active: false,
      startX: 0,
      startY: 0,
      startViewBox: null,
      pointerId: null
    },
    customStatusMessage: ""
  };

  function setStatus(message = "") {
    state.customStatusMessage = message;
    if (!statusElement) {
      return;
    }

    if (message) {
      statusElement.textContent = message;
      return;
    }

    if (state.activeLineId) {
      const line = state.lineById.get(state.activeLineId);
      statusElement.textContent = line ? line.name + " en surbrillance" : "Ligne active";
      return;
    }

    if (state.routeStationIds.length > 1) {
      statusElement.textContent = "Itineraire actif: " + state.routeStationIds.length + " stations";
      return;
    }

    statusElement.textContent = "Survolez une ligne ou une station pour explorer la carte.";
  }

  function buildIndexes() {
    state.stationById = new Map();
    state.stationLines = new Map();
    state.lineById = new Map();

    for (const station of state.bundle.data.stations) {
      state.stationById.set(station.id, station);
      state.stationLines.set(station.id, new Set());
    }

    for (const line of state.bundle.data.connections) {
      state.lineById.set(line.lineId, line);
      for (const stationId of line.stations) {
        if (!state.stationLines.has(stationId)) {
          state.stationLines.set(stationId, new Set());
        }
        state.stationLines.get(stationId).add(line.lineId);
      }
    }

    state.routeStationIds = state.routeStationIds.filter((stationId) => state.stationById.has(stationId));
  }

  function computeBaseViewBox() {
    const stations = state.bundle.data.stations;
    const padding = state.bundle.config.display.padding;

    if (stations.length === 0) {
      return {
        x: -320,
        y: -220,
        width: 640,
        height: 440
      };
    }

    const xs = stations.map((station) => station.x);
    const ys = stations.map((station) => station.y);

    const minX = Math.min(...xs) - padding;
    const minY = Math.min(...ys) - padding;
    const maxX = Math.max(...xs) + padding;
    const maxY = Math.max(...ys) + padding;

    return {
      x: minX,
      y: minY,
      width: Math.max(600, maxX - minX),
      height: Math.max(420, maxY - minY)
    };
  }

  function applyViewBox() {
    if (!state.viewBox) {
      return;
    }

    const viewBoxString = [
      state.viewBox.x.toFixed(2),
      state.viewBox.y.toFixed(2),
      state.viewBox.width.toFixed(2),
      state.viewBox.height.toFixed(2)
    ].join(" ");

    svg.setAttribute("viewBox", viewBoxString);
  }

  function hideTooltip() {
    if (!tooltip) {
      return;
    }
    tooltip.classList.remove("visible");
    tooltip.setAttribute("aria-hidden", "true");
  }

  function moveTooltip(event) {
    if (!tooltip) {
      return;
    }
    tooltip.style.left = event.clientX + 16 + "px";
    tooltip.style.top = event.clientY + 16 + "px";
  }

  function showTooltip(label, event) {
    if (!tooltip) {
      return;
    }
    tooltip.textContent = label;
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden", "false");
    moveTooltip(event);
  }

  function setActiveLine(lineId) {
    state.activeLineId = lineId;
    updateLineHighlight();
    if (!state.customStatusMessage) {
      setStatus("");
    }
  }

  function updateLineHighlight() {
    const activeId = state.activeLineId;

    const lines = svg.querySelectorAll(".metro-line");
    const stations = svg.querySelectorAll(".station");

    lines.forEach((lineElement) => {
      const isActive = lineElement.dataset.lineId === activeId;
      lineElement.classList.toggle("is-active", Boolean(activeId) && isActive);
      lineElement.classList.toggle("is-dimmed", Boolean(activeId) && !isActive);
    });

    stations.forEach((stationElement) => {
      const stationId = stationElement.dataset.stationId;
      const stationLines = state.stationLines.get(stationId) || new Set();
      const isOnRoute = state.routeStationIds.includes(stationId);
      const isActiveStation = activeId ? stationLines.has(activeId) : false;

      stationElement.classList.toggle("is-active", Boolean(activeId) && isActiveStation);
      stationElement.classList.toggle("is-dimmed", Boolean(activeId) && !isActiveStation);
      stationElement.classList.toggle("is-route", isOnRoute);
    });
  }

  function renderGrid(parentGroup) {
    const gridGroup = createSvgElement("g", { class: "grid" });
    const step = state.bundle.config.display.gridStep;
    const bounds = state.baseViewBox;
    const xStart = Math.floor(bounds.x / step) * step;
    const yStart = Math.floor(bounds.y / step) * step;
    const xEnd = bounds.x + bounds.width;
    const yEnd = bounds.y + bounds.height;

    for (let x = xStart; x <= xEnd; x += step) {
      gridGroup.appendChild(
        createSvgElement("line", {
          x1: x,
          y1: bounds.y,
          x2: x,
          y2: yEnd
        })
      );
    }

    for (let y = yStart; y <= yEnd; y += step) {
      gridGroup.appendChild(
        createSvgElement("line", {
          x1: bounds.x,
          y1: y,
          x2: xEnd,
          y2: y
        })
      );
    }

    parentGroup.appendChild(gridGroup);
  }

  function renderLines(parentGroup) {
    const linesGroup = createSvgElement("g", { class: "lines" });

    for (const connection of state.bundle.data.connections) {
      const points = connection.stations
        .map((stationId) => state.stationById.get(stationId))
        .filter(Boolean)
        .map((station) => station.x + "," + station.y)
        .join(" ");

      if (!points) {
        continue;
      }

      const color = state.bundle.config.lines[connection.lineId] || "#78a7d0";
      const line = createSvgElement("polyline", {
        class: "metro-line",
        stroke: color,
        points,
        "data-line-id": connection.lineId,
        "data-map-interactive": "true"
      });

      const hitLine = createSvgElement("polyline", {
        class: "metro-line-hit",
        points,
        "data-line-id": connection.lineId,
        "data-map-interactive": "true"
      });

      const activate = () => {
        setStatus("");
        setActiveLine(connection.lineId);
      };

      const deactivate = () => {
        setActiveLine(null);
      };

      const emitLineClick = (event) => {
        if (!onLineClick) {
          return;
        }

        onLineClick(
          {
            lineId: connection.lineId,
            line: deepClone(connection),
            color
          },
          event
        );
      };

      line.addEventListener("mouseenter", activate);
      line.addEventListener("mouseleave", deactivate);
      hitLine.addEventListener("mouseenter", activate);
      hitLine.addEventListener("mouseleave", deactivate);
      line.addEventListener("click", emitLineClick);
      hitLine.addEventListener("click", emitLineClick);
      line.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        emitLineClick(event);
      });
      hitLine.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        emitLineClick(event);
      });

      linesGroup.appendChild(line);
      linesGroup.appendChild(hitLine);
    }

    parentGroup.appendChild(linesGroup);
  }

  function renderRouteOverlay(parentGroup) {
    if (state.routeStationIds.length < 2) {
      return;
    }

    const points = state.routeStationIds
      .map((stationId) => state.stationById.get(stationId))
      .filter(Boolean)
      .map((station) => station.x + "," + station.y)
      .join(" ");

    if (!points) {
      return;
    }

    const routeGroup = createSvgElement("g", { class: "route-layer" });
    routeGroup.appendChild(
      createSvgElement("polyline", {
        class: "route-line-glow",
        points
      })
    );
    routeGroup.appendChild(
      createSvgElement("polyline", {
        class: "route-line",
        points
      })
    );

    parentGroup.appendChild(routeGroup);
  }

  function renderStations(parentGroup) {
    const stationsGroup = createSvgElement("g", { class: "stations" });
    const baseRadius = state.bundle.config.stationStyle.radius;
    const interchangeRadius = state.bundle.config.stationStyle.interchangeRadius;

    for (const station of state.bundle.data.stations) {
      const stationGroup = createSvgElement("g", {
        class: "station",
        "data-station-id": station.id
      });

      const stationLineCount = (state.stationLines.get(station.id) || new Set()).size;
      const radius = stationLineCount > 1 ? interchangeRadius : baseRadius;

      const dot = createSvgElement("circle", {
        class: "station-dot",
        cx: station.x,
        cy: station.y,
        r: radius,
        fill: state.bundle.config.stationStyle.fill,
        stroke: state.bundle.config.stationStyle.stroke,
        "stroke-width": state.bundle.config.stationStyle.strokeWidth
      });

      const hitArea = createSvgElement("circle", {
        class: "station-hit",
        cx: station.x,
        cy: station.y,
        r: radius + 12,
        "data-map-interactive": "true"
      });

      const label = createSvgElement("text", {
        class: "station-label",
        x: station.x + (station.labelDx ?? state.bundle.config.stationStyle.labelDx),
        y: station.y + (station.labelDy ?? state.bundle.config.stationStyle.labelDy)
      });
      label.textContent = station.name;

      hitArea.addEventListener("mouseenter", (event) => {
        const lines = Array.from(state.stationLines.get(station.id) || []).join(", ");
        showTooltip(station.name, event);
        if (!state.customStatusMessage) {
          setStatus(lines ? station.name + " · " + lines : station.name);
        }
      });
      const emitStationClick = (event) => {
        if (!onStationClick) {
          return;
        }

        onStationClick(
          {
            stationId: station.id,
            station: deepClone(station),
            lineIds: Array.from(state.stationLines.get(station.id) || [])
          },
          event
        );
      };

      hitArea.addEventListener("mousemove", moveTooltip);
      hitArea.addEventListener("mouseleave", () => {
        hideTooltip();
        if (!state.customStatusMessage) {
          setStatus("");
        }
      });
      hitArea.addEventListener("click", emitStationClick);
      hitArea.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        emitStationClick(event);
      });

      stationGroup.appendChild(dot);
      stationGroup.appendChild(label);
      stationGroup.appendChild(hitArea);
      stationsGroup.appendChild(stationGroup);
    }

    parentGroup.appendChild(stationsGroup);
  }

  function renderMap() {
    if (!state.bundle) {
      return;
    }

    svg.replaceChildren();
    hideTooltip();

    svg.style.setProperty("--line-width", String(state.bundle.config.lineStyle.strokeWidth));
    svg.style.setProperty(
      "--line-active-width",
      String(state.bundle.config.lineStyle.strokeWidth * state.bundle.config.lineStyle.activeWidthFactor)
    );
    svg.style.setProperty("--line-inactive-opacity", String(state.bundle.config.lineStyle.inactiveOpacity));
    svg.style.setProperty("--font-family", state.bundle.config.typography.family);
    svg.style.setProperty("--station-font-size", state.bundle.config.typography.stationFontSize + "px");

    const rootGroup = createSvgElement("g", { class: "map-root" });

    if (state.bundle.config.display.showGrid) {
      renderGrid(rootGroup);
    }

    renderLines(rootGroup);
    renderRouteOverlay(rootGroup);
    renderStations(rootGroup);

    svg.appendChild(rootGroup);
    updateLineHighlight();
    if (!state.customStatusMessage) {
      setStatus("");
    }
  }

  function clientToMapPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return {
      x: state.viewBox.x + ((clientX - rect.left) / rect.width) * state.viewBox.width,
      y: state.viewBox.y + ((clientY - rect.top) / rect.height) * state.viewBox.height
    };
  }

  function zoomAt(clientX, clientY, deltaY) {
    if (!state.bundle) {
      return;
    }

    const zoomFactor = deltaY < 0 ? 0.9 : 1.1;
    const pointerPoint = clientToMapPoint(clientX, clientY);

    const minWidth = state.baseViewBox.width / state.bundle.config.navigation.maxZoom;
    const maxWidth = state.baseViewBox.width / state.bundle.config.navigation.minZoom;
    const minHeight = state.baseViewBox.height / state.bundle.config.navigation.maxZoom;
    const maxHeight = state.baseViewBox.height / state.bundle.config.navigation.minZoom;

    const nextWidth = Math.min(maxWidth, Math.max(minWidth, state.viewBox.width * zoomFactor));
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, state.viewBox.height * zoomFactor));

    const ratioX = (pointerPoint.x - state.viewBox.x) / state.viewBox.width;
    const ratioY = (pointerPoint.y - state.viewBox.y) / state.viewBox.height;

    state.viewBox.x = pointerPoint.x - ratioX * nextWidth;
    state.viewBox.y = pointerPoint.y - ratioY * nextHeight;
    state.viewBox.width = nextWidth;
    state.viewBox.height = nextHeight;

    applyViewBox();
  }

  function attachNavigation() {
    svg.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, event.deltaY);
      },
      { passive: false }
    );

    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !state.viewBox) {
        return;
      }

      if (event.target instanceof Element && event.target.closest('[data-map-interactive="true"]')) {
        return;
      }

      state.pan.active = true;
      state.pan.startX = event.clientX;
      state.pan.startY = event.clientY;
      state.pan.startViewBox = { ...state.viewBox };
      state.pan.pointerId = event.pointerId;

      svg.classList.add("is-panning");
      svg.setPointerCapture(event.pointerId);
    });

    svg.addEventListener("pointermove", (event) => {
      if (!state.pan.active || !state.pan.startViewBox) {
        return;
      }

      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - state.pan.startX) / rect.width) * state.pan.startViewBox.width;
      const dy = ((event.clientY - state.pan.startY) / rect.height) * state.pan.startViewBox.height;

      state.viewBox.x = state.pan.startViewBox.x - dx;
      state.viewBox.y = state.pan.startViewBox.y - dy;
      applyViewBox();
    });

    const stopPan = () => {
      if (!state.pan.active) {
        return;
      }

      state.pan.active = false;
      svg.classList.remove("is-panning");

      if (state.pan.pointerId !== null) {
        try {
          svg.releasePointerCapture(state.pan.pointerId);
        } catch (error) {
          // Ignore pointer capture errors after interruption.
        }
      }

      state.pan.pointerId = null;
      state.pan.startViewBox = null;
    };

    svg.addEventListener("pointerup", stopPan);
    svg.addEventListener("pointercancel", stopPan);

    if (onMapBackgroundClick) {
      svg.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) {
          return;
        }

        if (event.target.closest('[data-map-interactive="true"]')) {
          return;
        }

        onMapBackgroundClick(event);
      });
    }
  }

  function setBundle(bundle, options = {}) {
    const preserveView = Boolean(options.preserveView);
    state.bundle = normalizeBundle(bundle);
    buildIndexes();

    const nextBaseViewBox = computeBaseViewBox();
    state.baseViewBox = nextBaseViewBox;

    if (!preserveView || !state.viewBox) {
      state.viewBox = { ...nextBaseViewBox };
    }

    applyViewBox();
    renderMap();
  }

  function resetView() {
    if (!state.baseViewBox) {
      return;
    }

    state.viewBox = { ...state.baseViewBox };
    applyViewBox();
  }

  function setRoute(stationIds = []) {
    state.routeStationIds = Array.isArray(stationIds) ? [...stationIds] : [];
    renderMap();
  }

  function clearRoute() {
    setRoute([]);
  }

  function getState() {
    return {
      activeLineId: state.activeLineId,
      routeStationIds: [...state.routeStationIds],
      viewBox: state.viewBox ? { ...state.viewBox } : null,
      bundle: state.bundle ? deepClone(state.bundle) : null
    };
  }

  function clearStatusMessage() {
    state.customStatusMessage = "";
    setStatus("");
  }

  if (enableNavigation) {
    attachNavigation();
  }

  return {
    setBundle,
    renderMap,
    resetView,
    setRoute,
    clearRoute,
    setActiveLine,
    setStatus,
    clearStatusMessage,
    getState
  };
}
