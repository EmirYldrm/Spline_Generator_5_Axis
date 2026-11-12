const MACHINE_KEY = "swSpline:machine";
const MACHINE_SETTINGS_PREFIX = "swSpline:machine:";

const deepClone = value => JSON.parse(JSON.stringify(value));

function safeStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export const BUILTIN_MACHINES = Object.freeze({
  default: Object.freeze({
    id: "default",
    name: "Varsayılan Makine",
    builtin: true,
    axisMap: { x: "X", y: "Y", z: "Z", c: "C", a: "A" },
    outputOrder: ["X", "Y", "Z", "C", "A"],
    axisSign: { x: 1, y: 1, z: 1, c: 1, a: 1 },
    passthroughAxes: [],
    input: {
      acceptedRapid: ["G0", "G00"],
      acceptedLinear: ["G1", "G01"],
      commentStyles: [";", "()"],
      weldOn: ["M3"],
      weldOff: ["M5"],
      modalAxes: true
    },
    output: {
      decimals: 1,
      lineEnding: "\n",
      commentsInOutput: false,
      header: ["G90", "G21"],
      safeMoveCommand: "G0",
      weldOnCommand: "M3",
      weldOffCommand: "M5",
      footer: [],
      lineNumbers: false
    },
    defaults: { feed: 300, step: 2 }
  }),
  "ankara-6eksen": Object.freeze({
    id: "ankara-6eksen",
    name: "6 Eksen Ankara",
    builtin: true,
    axisMap: { x: "X", y: "Y", z: "W", c: "C", a: "A" },
    outputOrder: ["X", "Y", "W", "A", "C"],
    axisSign: { x: 1, y: 1, z: 1, c: 1, a: 1 },
    passthroughAxes: [
      { letter: "Z", label: "Z (taşlama kafası)", mode: "fixed", value: 0, emit: false }
    ],
    input: {
      acceptedRapid: ["G0", "G00"],
      acceptedLinear: ["G1", "G01"],
      commentStyles: [";", "()"],
      weldOn: ["M3"],
      weldOff: ["M5"],
      modalAxes: true
    },
    output: {
      decimals: 3,
      lineEnding: "\r\n",
      commentsInOutput: true,
      header: ["G90 G21"],
      safeMoveCommand: "G0",
      weldOnCommand: "M3",
      weldOffCommand: "M5",
      footer: ["M30"],
      lineNumbers: false
    },
    defaults: { feed: 500, step: 1 }
  })
});

function machineFromStorage() {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem("swSpline:machines");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadUserMachines() {
  return deepClone(machineFromStorage());
}

export function saveUserMachines(machines) {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.setItem("swSpline:machines", JSON.stringify(machines || {}));
    return true;
  } catch {
    return false;
  }
}

export function getMachine(id) {
  const candidate = typeof id === "string" ? id.trim() : "";
  const allMachines = { ...BUILTIN_MACHINES, ...machineFromStorage() };
  const machine = allMachines[candidate] || allMachines.default || BUILTIN_MACHINES.default;
  return deepClone(machine);
}

export function getMachineSelection() {
  const storage = safeStorage();
  if (!storage) return "default";
  try {
    const value = storage.getItem(MACHINE_KEY);
    return value || "default";
  } catch {
    return "default";
  }
}

export function setMachineSelection(id) {
  const storage = safeStorage();
  if (!storage) return false;
  const target = getMachine(id).id || "default";
  try {
    storage.setItem(MACHINE_KEY, target);
    return true;
  } catch {
    return false;
  }
}

export function getMachineSettings(machineId) {
  const storage = safeStorage();
  if (!storage) return {};
  const id = getMachine(machineId).id || "default";
  try {
    const raw = storage.getItem(`${MACHINE_SETTINGS_PREFIX}${id}:settings`);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

export function saveMachineSettings(machineId, settings) {
  const storage = safeStorage();
  if (!storage) return false;
  const id = getMachine(machineId).id || "default";
  try {
    storage.setItem(`${MACHINE_SETTINGS_PREFIX}${id}:settings`, JSON.stringify(settings || {}));
    return true;
  } catch {
    return false;
  }
}

export function validateMachine(machine) {
  if (!machine || typeof machine !== "object") {
    throw new Error("Makine profili nesne olmalıdır.");
  }
  if (!machine.id || !String(machine.id).trim()) {
    throw new Error("Makine kimliği boş olamaz.");
  }
  if (!machine.name || !String(machine.name).trim()) {
    throw new Error("Makine adı boş olamaz.");
  }
  const axisMap = machine.axisMap && typeof machine.axisMap === "object" ? machine.axisMap : {};
  const seen = new Set();
  for (const [logicalAxis, letter] of Object.entries(axisMap)) {
    if (!logicalAxis || !String(letter || "").trim()) {
      throw new Error(`"${logicalAxis || "?"}" ekseninin harfi boş olamaz.`);
    }
    if (seen.has(String(letter).toUpperCase())) {
      throw new Error(`Aynı G-code harfi iki mantıksal eksene atanamaz: ${String(letter).toUpperCase()}`);
    }
    seen.add(String(letter).toUpperCase());
  }
  const outputOrder = Array.isArray(machine.outputOrder) ? machine.outputOrder : [];
  const allowed = new Set(Object.values(axisMap).map(letter => String(letter).toUpperCase()));
  for (const letter of outputOrder) {
    const normalized = String(letter).toUpperCase();
    if (!allowed.has(normalized) && !machine.passthroughAxes?.some(axis => String(axis.letter || "").toUpperCase() === normalized)) {
      throw new Error(`Çıktı sırasına dahil edilen eksen görünmüyor: ${normalized}`);
    }
  }
  return true;
}

export function toMachinePoint(logical, machine) {
  const profile = getMachine(machine && machine.id ? machine.id : machine);
  const axisMap = profile.axisMap || {};
  const words = {};
  if (logical && typeof logical === "object") {
    for (const [logicalAxis, letter] of Object.entries(axisMap)) {
      if (Object.hasOwn(logical, logicalAxis) && logical[logicalAxis] !== undefined) {
        words[String(letter)] = Number(logical[logicalAxis]);
      }
    }
  }
  const passthrough = Array.isArray(profile.passthroughAxes) ? profile.passthroughAxes : [];
  for (const axis of passthrough) {
    if (axis && axis.emit && axis.letter && axis.value !== undefined) {
      words[String(axis.letter)] = Number(axis.value);
    }
  }
  return words;
}

export function toLogicalPoint(machineWords, machine) {
  const profile = getMachine(machine && machine.id ? machine.id : machine);
  const axisMap = profile.axisMap || {};
  const inverse = {};
  if (machineWords && typeof machineWords === "object") {
    for (const [logicalAxis, letter] of Object.entries(axisMap)) {
      const normalized = String(letter);
      if (Object.hasOwn(machineWords, normalized) && machineWords[normalized] !== undefined) {
        inverse[logicalAxis] = Number(machineWords[normalized]);
      }
    }
  }
  return inverse;
}

export const MACHINE_DEFAULTS = deepClone(BUILTIN_MACHINES.default);
