import { createMetroMapRenderer } from "../core/mapRenderer.js";
import {
  changePassword,
  getDefaultCredentials,
  getSession,
  initializeAuth,
  isAuthenticated,
  login,
  logout
} from "../services/authService.js";
import {
  loadNetworkBundle,
  resetNetworkBundle,
  saveNetworkBundle
} from "../services/dataService.js";
import {
  normalizeStationSequence,
  removeConnection,
  removeStation,
  upsertConnection,
  upsertStation,
  validateBundle
} from "../services/networkEditorService.js";
import { optimizeStationLayout } from "../services/layoutService.js";
import { deepClone } from "../utils/object.js";

const loginSection = document.getElementById("login-section");
const adminSection = document.getElementById("admin-section");
const bootstrapWarning = document.getElementById("bootstrap-warning");
const loginForm = document.getElementById("login-form");
const loginSubmitButton = document.getElementById("login-submit");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginMessage = document.getElementById("login-message");
const credentialsHint = document.getElementById("credentials-hint");
const sessionBadge = document.getElementById("session-badge");
const passwordForm = document.getElementById("password-form");
const currentPasswordInput = document.getElementById("current-password");
const newPasswordInput = document.getElementById("new-password");
const confirmPasswordInput = document.getElementById("confirm-password");
const passwordFeedback = document.getElementById("password-feedback");

if (bootstrapWarning) {
  bootstrapWarning.classList.add("hidden");
}

const saveButton = document.getElementById("save-network");
const optimizeLayoutButton = document.getElementById("optimize-layout");
const populateDemoButton = document.getElementById("populate-demo");
const clearNetworkButton = document.getElementById("clear-network");
const importNetworkButton = document.getElementById("import-network");
const exportNetworkButton = document.getElementById("export-network");
const importNetworkFileInput = document.getElementById("import-network-file");
const logoutButton = document.getElementById("logout-admin");
const adminFeedback = document.getElementById("admin-feedback");

const stationSelect = document.getElementById("station-select");
const stationIdInput = document.getElementById("station-id");
const stationNameInput = document.getElementById("station-name");
const stationXInput = document.getElementById("station-x");
const stationYInput = document.getElementById("station-y");
const stationLabelDxInput = document.getElementById("station-label-dx");
const stationLabelDyInput = document.getElementById("station-label-dy");
const stationNewButton = document.getElementById("station-new");
const stationSaveButton = document.getElementById("station-save");
const stationDeleteButton = document.getElementById("station-delete");
const stationTableBody = document.getElementById("station-table-body");

const lineSelect = document.getElementById("line-select");
const lineIdInput = document.getElementById("line-id");
const lineNameInput = document.getElementById("line-name");
const lineColorInput = document.getElementById("line-color");
const lineStationsInput = document.getElementById("line-stations");
const lineNewButton = document.getElementById("line-new");
const lineSaveButton = document.getElementById("line-save");
const lineDeleteButton = document.getElementById("line-delete");
const lineTableBody = document.getElementById("line-table-body");
const mapContextMenu = document.getElementById("map-context-menu");
const contextMenuTitle = document.getElementById("context-menu-title");
const contextEditButton = document.getElementById("context-edit");
const contextRenameButton = document.getElementById("context-rename");
const contextHighlightButton = document.getElementById("context-highlight");
const contextDeleteButton = document.getElementById("context-delete");
const mapShell = document.querySelector(".mini-map-shell");

const mapRenderer = createMetroMapRenderer({
  svg: document.getElementById("admin-map"),
  tooltip: document.getElementById("admin-tooltip"),
  statusElement: document.getElementById("admin-map-status"),
  onStationClick: handleStationMapClick,
  onLineClick: handleLineMapClick,
  onMapBackgroundClick: () => hideContextMenu()
});

const state = {
  bundle: null,
  contextTarget: null
};

function setLoginMessage(message, isError = false) {
  loginMessage.textContent = message;
  loginMessage.style.color = isError ? "var(--danger)" : "var(--text-muted)";
}

function setAdminFeedback(message, type = "info") {
  adminFeedback.textContent = message;
  if (type === "error") {
    adminFeedback.style.color = "var(--danger)";
    return;
  }
  if (type === "ok") {
    adminFeedback.style.color = "var(--ok)";
    return;
  }
  adminFeedback.style.color = "var(--text-muted)";
}

function setPasswordFeedback(message, type = "info") {
  if (!passwordFeedback) {
    return;
  }

  passwordFeedback.textContent = message;

  if (type === "error") {
    passwordFeedback.style.color = "var(--danger)";
    return;
  }

  if (type === "ok") {
    passwordFeedback.style.color = "var(--ok)";
    return;
  }

  passwordFeedback.style.color = "var(--text-muted)";
}

function buildExportFileName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return "metro-network-" + year + month + day + "-" + hours + minutes + seconds + ".json";
}

function downloadJsonFile(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function normalizeImportedBundle(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Le fichier JSON est invalide.");
  }

  if (Array.isArray(parsed.stations) && Array.isArray(parsed.connections)) {
    return {
      config: deepClone(state.bundle?.config || {}),
      data: {
        stations: parsed.stations,
        connections: parsed.connections
      }
    };
  }

  if (Array.isArray(parsed.data?.stations) && Array.isArray(parsed.data?.connections)) {
    return {
      config: (parsed.config && typeof parsed.config === "object")
        ? parsed.config
        : deepClone(state.bundle?.config || {}),
      data: {
        stations: parsed.data.stations,
        connections: parsed.data.connections
      }
    };
  }

  throw new Error("Format JSON non supporte. Attendu: { config, data } ou { stations, connections }.");
}

function isContextMenuVisible() {
  return Boolean(mapContextMenu) && !mapContextMenu.classList.contains("hidden");
}

function hideContextMenu() {
  if (!mapContextMenu) {
    return;
  }

  mapContextMenu.classList.add("hidden");
  mapContextMenu.setAttribute("aria-hidden", "true");
  state.contextTarget = null;
}

function placeContextMenu(clientX, clientY) {
  if (!mapContextMenu || !mapShell) {
    return;
  }

  const shellRect = mapShell.getBoundingClientRect();
  const gutter = 8;

  let left = clientX - shellRect.left + 10;
  let top = clientY - shellRect.top + 10;

  const menuWidth = mapContextMenu.offsetWidth || 230;
  const menuHeight = mapContextMenu.offsetHeight || 180;

  left = Math.max(gutter, Math.min(left, shellRect.width - menuWidth - gutter));
  top = Math.max(gutter, Math.min(top, shellRect.height - menuHeight - gutter));

  mapContextMenu.style.left = left + "px";
  mapContextMenu.style.top = top + "px";
}

function selectStationInEditor(stationId) {
  refreshEditor(stationId, lineSelect.value);
}

function selectLineInEditor(lineId) {
  refreshEditor(stationSelect.value, lineId);
  mapRenderer.setActiveLine(lineId);
}

function openContextMenu(target, event) {
  if (!mapContextMenu || !contextMenuTitle) {
    return;
  }

  state.contextTarget = target;

  if (target.type === "station") {
    contextMenuTitle.textContent = "Station: " + target.stationName + " (" + target.stationId + ")";
    contextHighlightButton.textContent = "Surligner une ligne passante";
    contextHighlightButton.disabled = target.lineIds.length === 0;
  } else {
    contextMenuTitle.textContent = "Ligne: " + target.lineName + " (" + target.lineId + ")";
    contextHighlightButton.textContent = "Mettre cette ligne en surbrillance";
    contextHighlightButton.disabled = false;
  }

  mapContextMenu.classList.remove("hidden");
  mapContextMenu.setAttribute("aria-hidden", "false");
  placeContextMenu(event.clientX, event.clientY);
}

function handleStationMapClick(payload, event) {
  if (!state.bundle) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  openContextMenu(
    {
      type: "station",
      stationId: payload.stationId,
      stationName: payload.station.name,
      lineIds: payload.lineIds
    },
    event
  );
}

function handleLineMapClick(payload, event) {
  if (!state.bundle) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  mapRenderer.setActiveLine(payload.lineId);
  openContextMenu(
    {
      type: "line",
      lineId: payload.lineId,
      lineName: payload.line.name
    },
    event
  );
}

function runContextEditAction() {
  const target = state.contextTarget;
  if (!target) {
    return;
  }

  if (target.type === "station") {
    selectStationInEditor(target.stationId);
    setAdminFeedback("Station chargee dans le formulaire d'edition.", "ok");
    hideContextMenu();
    return;
  }

  selectLineInEditor(target.lineId);
  setAdminFeedback("Ligne chargee dans le formulaire d'edition.", "ok");
  hideContextMenu();
}

function runContextRenameAction() {
  const target = state.contextTarget;
  if (!target || !state.bundle) {
    return;
  }

  if (target.type === "station") {
    const station = state.bundle.data.stations.find((item) => item.id === target.stationId);
    if (!station) {
      setAdminFeedback("Station introuvable.", "error");
      return;
    }

    const nextName = window.prompt("Nouveau nom pour la station", station.name);
    if (nextName === null) {
      return;
    }

    const cleanedName = nextName.trim();
    if (!cleanedName) {
      setAdminFeedback("Le nom de station ne peut pas etre vide.", "error");
      return;
    }

    upsertStation(state.bundle, {
      id: station.id,
      name: cleanedName,
      x: station.x,
      y: station.y,
      labelDx: station.labelDx,
      labelDy: station.labelDy
    });

    refreshEditor(station.id, lineSelect.value);
    setAdminFeedback("Station renommee depuis la carte.", "ok");
    hideContextMenu();
    return;
  }

  const line = state.bundle.data.connections.find((item) => item.lineId === target.lineId);
  if (!line) {
    setAdminFeedback("Ligne introuvable.", "error");
    return;
  }

  const nextName = window.prompt("Nouveau nom pour la ligne", line.name);
  if (nextName === null) {
    return;
  }

  const cleanedName = nextName.trim();
  if (!cleanedName) {
    setAdminFeedback("Le nom de ligne ne peut pas etre vide.", "error");
    return;
  }

  upsertConnection(state.bundle, {
    lineId: line.lineId,
    name: cleanedName,
    stations: [...line.stations],
    color: state.bundle.config.lines?.[line.lineId] || "#78a7d0"
  });

  refreshEditor(stationSelect.value, line.lineId);
  setAdminFeedback("Ligne renommee depuis la carte.", "ok");
  hideContextMenu();
}

function runContextHighlightAction() {
  const target = state.contextTarget;
  if (!target) {
    return;
  }

  if (target.type === "line") {
    mapRenderer.setActiveLine(target.lineId);
    setAdminFeedback("Ligne " + target.lineId + " mise en surbrillance.", "ok");
    hideContextMenu();
    return;
  }

  if (!target.lineIds.length) {
    setAdminFeedback("Aucune ligne a surligner pour cette station.", "error");
    return;
  }

  mapRenderer.setActiveLine(target.lineIds[0]);
  setAdminFeedback("Ligne " + target.lineIds[0] + " surlignee depuis la station.", "ok");
  hideContextMenu();
}

function runContextDeleteAction() {
  const target = state.contextTarget;
  if (!target || !state.bundle) {
    return;
  }

  if (target.type === "station") {
    const confirmed = window.confirm(
      "Supprimer la station " + target.stationId + " et ses references dans les lignes ?"
    );

    if (!confirmed) {
      return;
    }

    removeStation(state.bundle, target.stationId);
    refreshEditor("", lineSelect.value);
    setAdminFeedback("Station supprimee depuis la carte.", "ok");
    hideContextMenu();
    return;
  }

  const confirmed = window.confirm("Supprimer la ligne " + target.lineId + " ?");
  if (!confirmed) {
    return;
  }

  removeConnection(state.bundle, target.lineId);
  refreshEditor(stationSelect.value, "");
  setAdminFeedback("Ligne supprimee depuis la carte.", "ok");
  hideContextMenu();
}

function fillStationForm(station) {
  if (!station) {
    stationIdInput.value = "";
    stationNameInput.value = "";
    stationXInput.value = "";
    stationYInput.value = "";
    stationLabelDxInput.value = "";
    stationLabelDyInput.value = "";
    return;
  }

  stationIdInput.value = station.id;
  stationNameInput.value = station.name;
  stationXInput.value = station.x;
  stationYInput.value = station.y;
  stationLabelDxInput.value = station.labelDx ?? "";
  stationLabelDyInput.value = station.labelDy ?? "";
}

function fillLineForm(line) {
  if (!line) {
    lineIdInput.value = "";
    lineNameInput.value = "";
    lineColorInput.value = "#78a7d0";
    lineStationsInput.value = "";
    return;
  }

  lineIdInput.value = line.lineId;
  lineNameInput.value = line.name;
  lineColorInput.value = state.bundle.config.lines?.[line.lineId] || "#78a7d0";
  lineStationsInput.value = line.stations.join(", ");
}

function getStationUsageMap() {
  const usage = new Map();
  for (const station of state.bundle.data.stations) {
    usage.set(station.id, 0);
  }

  for (const line of state.bundle.data.connections) {
    for (const stationId of line.stations) {
      usage.set(stationId, (usage.get(stationId) || 0) + 1);
    }
  }

  return usage;
}

function renderStationTable() {
  const usageMap = getStationUsageMap();
  const sortedStations = [...state.bundle.data.stations].sort((a, b) => a.id.localeCompare(b.id));

  stationTableBody.innerHTML = "";

  for (const station of sortedStations) {
    const row = document.createElement("tr");
    row.innerHTML =
      "<td>" + station.id + "</td>" +
      "<td>" + station.name + "</td>" +
      "<td>" + Math.round(station.x) + " / " + Math.round(station.y) + "</td>" +
      "<td><span class=\"badge\">" + (usageMap.get(station.id) || 0) + "</span></td>";
    stationTableBody.appendChild(row);
  }
}

function renderLineTable() {
  const sortedLines = [...state.bundle.data.connections].sort((a, b) => a.lineId.localeCompare(b.lineId));

  lineTableBody.innerHTML = "";

  for (const line of sortedLines) {
    const row = document.createElement("tr");
    row.innerHTML =
      "<td>" + line.lineId + "</td>" +
      "<td>" + line.name + "</td>" +
      "<td>" + line.stations.length + "</td>" +
      "<td><span style=\"display:inline-block;width:18px;height:12px;border-radius:999px;background:" +
      (state.bundle.config.lines?.[line.lineId] || "#78a7d0") +
      ";\"></span></td>";
    lineTableBody.appendChild(row);
  }
}

function renderStationSelect(selectedId = "") {
  const sortedStations = [...state.bundle.data.stations].sort((a, b) => a.id.localeCompare(b.id));

  stationSelect.innerHTML = "<option value=''>Nouvelle station</option>";

  for (const station of sortedStations) {
    const option = document.createElement("option");
    option.value = station.id;
    option.textContent = station.id + " - " + station.name;
    stationSelect.appendChild(option);
  }

  stationSelect.value = selectedId && sortedStations.some((item) => item.id === selectedId) ? selectedId : "";
}

function renderLineSelect(selectedId = "") {
  const sortedLines = [...state.bundle.data.connections].sort((a, b) => a.lineId.localeCompare(b.lineId));

  lineSelect.innerHTML = "<option value=''>Nouvelle ligne</option>";

  for (const line of sortedLines) {
    const option = document.createElement("option");
    option.value = line.lineId;
    option.textContent = line.lineId + " - " + line.name;
    lineSelect.appendChild(option);
  }

  lineSelect.value = selectedId && sortedLines.some((item) => item.lineId === selectedId) ? selectedId : "";
}

function refreshPreview(preserveView = true) {
  mapRenderer.setBundle(state.bundle, { preserveView });
}

function refreshEditor(selectedStationId = "", selectedLineId = "") {
  hideContextMenu();
  renderStationSelect(selectedStationId);
  renderLineSelect(selectedLineId);

  const station = state.bundle.data.stations.find((item) => item.id === stationSelect.value) || null;
  const line = state.bundle.data.connections.find((item) => item.lineId === lineSelect.value) || null;

  fillStationForm(station);
  fillLineForm(line);
  renderStationTable();
  renderLineTable();
  refreshPreview(true);
}

function saveStation() {
  try {
    const station = upsertStation(state.bundle, {
      id: stationIdInput.value,
      name: stationNameInput.value,
      x: stationXInput.value,
      y: stationYInput.value,
      labelDx: stationLabelDxInput.value,
      labelDy: stationLabelDyInput.value
    });

    refreshEditor(station.id, lineSelect.value);
    setAdminFeedback("Station " + station.id + " enregistree en memoire.", "ok");
  } catch (error) {
    setAdminFeedback(error.message, "error");
  }
}

function deleteStation() {
  const stationId = stationSelect.value || stationIdInput.value;
  if (!stationId) {
    setAdminFeedback("Selectionne une station a supprimer.", "error");
    return;
  }

  removeStation(state.bundle, stationId);
  refreshEditor("", lineSelect.value);
  setAdminFeedback("Station " + stationId.toUpperCase() + " supprimee.", "ok");
}

function saveLine() {
  try {
    const connection = upsertConnection(state.bundle, {
      lineId: lineIdInput.value,
      name: lineNameInput.value,
      color: lineColorInput.value,
      stations: normalizeStationSequence(lineStationsInput.value)
    });

    refreshEditor(stationSelect.value, connection.lineId);
    setAdminFeedback("Ligne " + connection.lineId + " enregistree en memoire.", "ok");
  } catch (error) {
    setAdminFeedback(error.message, "error");
  }
}

function deleteLine() {
  const lineId = lineSelect.value || lineIdInput.value;
  if (!lineId) {
    setAdminFeedback("Selectionne une ligne a supprimer.", "error");
    return;
  }

  removeConnection(state.bundle, lineId);
  refreshEditor(stationSelect.value, "");
  setAdminFeedback("Ligne " + String(lineId).toUpperCase() + " supprimee.", "ok");
}

function persistNetwork() {
  const validation = validateBundle(state.bundle);
  if (!validation.valid) {
    setAdminFeedback(validation.errors.join(" | "), "error");
    return;
  }

  state.bundle = saveNetworkBundle(state.bundle);
  refreshPreview(true);
  setAdminFeedback("Reseau sauvegarde. Les 3 pages utilisent maintenant cette version.", "ok");
}

function optimizeLayout() {
  if (!state.bundle) {
    setAdminFeedback("Aucun reseau charge.", "error");
    return;
  }

  if (!Array.isArray(state.bundle.data?.stations) || state.bundle.data.stations.length < 2) {
    setAdminFeedback("Il faut au moins deux stations pour optimiser le placement.", "error");
    return;
  }

  const selectedStationId = stationSelect.value;
  const selectedLineId = lineSelect.value;

  const result = optimizeStationLayout(state.bundle);
  state.bundle = result.bundle;
  refreshEditor(selectedStationId, selectedLineId);

  setAdminFeedback(
    "Placement optimise: " +
      result.movedStations +
      " stations ajustees, deplacement moyen " +
      result.averageShift.toFixed(1) +
      " px.",
    "ok"
  );
}

function populateWithDemo() {
  state.bundle = resetNetworkBundle();
  state.bundle = saveNetworkBundle(state.bundle);
  refreshEditor();
  setAdminFeedback("Donnees de demo rechargees puis sauvegardees.", "ok");
}

function clearCurrentMap() {
  if (!state.bundle) {
    setAdminFeedback("Aucun reseau charge.", "error");
    return;
  }

  const nextBundle = {
    config: deepClone(state.bundle.config || {}),
    data: {
      stations: [],
      connections: []
    }
  };

  nextBundle.config.lines = {};

  state.bundle = saveNetworkBundle(nextBundle);
  refreshEditor();
  setAdminFeedback("Carte vide sauvegardee (stations et lignes supprimees).", "ok");
}

function exportNetworkToJson() {
  if (!state.bundle) {
    setAdminFeedback("Aucun reseau a exporter.", "error");
    return;
  }

  downloadJsonFile(buildExportFileName(), state.bundle);
  setAdminFeedback("Export JSON effectue.", "ok");
}

function openImportDialog() {
  importNetworkFileInput.click();
}

async function importNetworkFromJsonFile(file) {
  if (!file) {
    return;
  }

  const rawContent = await file.text();
  let parsed;

  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new Error("Le fichier n'est pas un JSON valide.");
  }

  const importedBundle = normalizeImportedBundle(parsed);
  const validation = validateBundle(importedBundle);
  if (!validation.valid) {
    throw new Error("Donnees invalides: " + validation.errors.join(" | "));
  }

  state.bundle = saveNetworkBundle(importedBundle);
  refreshEditor();
  setAdminFeedback("Import JSON reussi et sauvegarde appliquee.", "ok");
}

async function ensureBundleLoaded() {
  if (state.bundle) {
    return;
  }

  state.bundle = await loadNetworkBundle({ preferStorage: true });
  refreshEditor();
}

async function refreshAuthView() {
  const authenticated = isAuthenticated();
  loginSection.classList.toggle("hidden", authenticated);
  adminSection.classList.toggle("hidden", !authenticated);

  if (!authenticated) {
    setLoginMessage("Authentification admin requise.");
    return;
  }

  const session = getSession();
  sessionBadge.textContent = session ? "Session: " + session.username : "Session active";
  await ensureBundleLoaded();
}

async function tryLogin() {
  const ok = await login(usernameInput.value, passwordInput.value);
  if (!ok) {
    setLoginMessage("Identifiants invalides.", true);
    return;
  }

  usernameInput.value = "";
  passwordInput.value = "";
  setLoginMessage("Connexion reussie.");

  try {
    await refreshAuthView();
  } catch (error) {
    console.error(error);
    setLoginMessage("Connexion etablie, mais chargement admin impossible (stockage navigateur bloque?).", true);
  }
}

function attachEvents() {
  const defaults = getDefaultCredentials();
  credentialsHint.textContent =
    "Identifiants initiaux: " + defaults.username + " / " + defaults.password + " (a changer apres connexion).";

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    tryLogin().catch((error) => {
      console.error(error);
      setLoginMessage("Erreur de connexion inattendue.", true);
    });
  });

  loginSubmitButton.addEventListener("click", () => {
    tryLogin().catch((error) => {
      console.error(error);
      setLoginMessage("Erreur de connexion inattendue.", true);
    });
  });

  passwordInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    tryLogin().catch((error) => {
      console.error(error);
      setLoginMessage("Erreur de connexion inattendue.", true);
    });
  });

  logoutButton.addEventListener("click", () => {
    logout();
    setAdminFeedback("Session fermee.", "info");
    refreshAuthView().catch(console.error);
  });

  saveButton.addEventListener("click", persistNetwork);
  optimizeLayoutButton.addEventListener("click", optimizeLayout);
  populateDemoButton.addEventListener("click", populateWithDemo);
  clearNetworkButton.addEventListener("click", clearCurrentMap);
  exportNetworkButton.addEventListener("click", exportNetworkToJson);
  importNetworkButton.addEventListener("click", openImportDialog);
  importNetworkFileInput.addEventListener("change", () => {
    const [file] = Array.from(importNetworkFileInput.files || []);
    if (!file) {
      return;
    }

    importNetworkFromJsonFile(file)
      .catch((error) => {
        console.error(error);
        setAdminFeedback(error.message, "error");
      })
      .finally(() => {
        importNetworkFileInput.value = "";
      });
  });

  if (passwordForm) {
    passwordForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const currentPassword = String(currentPasswordInput.value || "");
      const nextPassword = String(newPasswordInput.value || "");
      const confirmation = String(confirmPasswordInput.value || "");

      if (nextPassword.length < 8) {
        setPasswordFeedback("Le nouveau mot de passe doit contenir au moins 8 caracteres.", "error");
        return;
      }

      if (nextPassword !== confirmation) {
        setPasswordFeedback("La confirmation du mot de passe ne correspond pas.", "error");
        return;
      }

      changePassword(currentPassword, nextPassword)
        .then(() => {
          currentPasswordInput.value = "";
          newPasswordInput.value = "";
          confirmPasswordInput.value = "";
          setPasswordFeedback("Mot de passe mis a jour (verification par hash).", "ok");
        })
        .catch((error) => {
          console.error(error);
          setPasswordFeedback(error.message, "error");
        });
    });
  }

  if (contextEditButton) {
    contextEditButton.addEventListener("click", runContextEditAction);
  }
  if (contextRenameButton) {
    contextRenameButton.addEventListener("click", runContextRenameAction);
  }
  if (contextHighlightButton) {
    contextHighlightButton.addEventListener("click", runContextHighlightAction);
  }
  if (contextDeleteButton) {
    contextDeleteButton.addEventListener("click", runContextDeleteAction);
  }

  document.addEventListener("click", (event) => {
    if (!isContextMenuVisible() || !mapContextMenu) {
      return;
    }

    if (event.target instanceof Element && mapContextMenu.contains(event.target)) {
      return;
    }

    hideContextMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    hideContextMenu();
  });

  stationSelect.addEventListener("change", () => {
    const station = state.bundle.data.stations.find((item) => item.id === stationSelect.value) || null;
    fillStationForm(station);
  });

  stationNewButton.addEventListener("click", () => {
    stationSelect.value = "";
    fillStationForm(null);
  });

  stationSaveButton.addEventListener("click", saveStation);
  stationDeleteButton.addEventListener("click", deleteStation);

  lineSelect.addEventListener("change", () => {
    const line = state.bundle.data.connections.find((item) => item.lineId === lineSelect.value) || null;
    fillLineForm(line);
  });

  lineNewButton.addEventListener("click", () => {
    lineSelect.value = "";
    fillLineForm(null);
  });

  lineSaveButton.addEventListener("click", saveLine);
  lineDeleteButton.addEventListener("click", deleteLine);
}

async function init() {
  await initializeAuth();
  attachEvents();
  await refreshAuthView();
}

init().catch((error) => {
  console.error(error);
  setLoginMessage("Initialisation securite impossible: " + error.message, true);
  setAdminFeedback("Erreur lors de l'initialisation admin.", "error");
});
