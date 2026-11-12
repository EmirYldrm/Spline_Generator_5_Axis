const BUILTIN_MACHINES = {
  default: {
    id: "default",
    name: "Varsayılan Makine",
    axisMap: { x: "X", y: "Y", z: "Z", c: "C", a: "A" },
    outputOrder: ["X", "Y", "Z", "C", "A"],
    passthroughAxes: [],
    output: {
      decimals: 1,
      lineEnding: "\n",
      header: ["G90", "G21"],
      safeMoveCommand: "G0",
      weldOnCommand: "M3",
      weldOffCommand: "M5",
      footer: [],
      lineNumbers: false
    },
    defaults: { feed: 300 }
  },
  "ankara-6eksen": {
    id: "ankara-6eksen",
    name: "6 Eksen Ankara",
    axisMap: { x: "X", y: "Y", z: "W", c: "C", a: "A" },
    outputOrder: ["X", "Y", "W", "A", "C"],
    passthroughAxes: [{ letter: "Z", label: "Z (taşlama kafası)", mode: "fixed", value: 0, emit: true }],
    output: {
      decimals: 3,
      lineEnding: "\r\n",
      header: ["G90 G21"],
      safeMoveCommand: "G0",
      weldOnCommand: "M3",
      weldOffCommand: "M5",
      footer: ["M30"],
      lineNumbers: false
    },
    defaults: { feed: 500 }
  }
};

function getMachine(input) {
  const candidate = input && typeof input === "object" ? input.id || input.name : input;
  const id = String(candidate || "default").trim() || "default";
  if (globalThis.BUILTIN_MACHINES && globalThis.BUILTIN_MACHINES[id]) {
    return globalThis.BUILTIN_MACHINES[id];
  }
  return BUILTIN_MACHINES[id] || BUILTIN_MACHINES.default;
}

function resolveMachine(input) {
  return getMachine(input);
}

function cleanLines(text) {
  if (text === undefined || text === null || text === "") return [];
  return String(text).split(/\r?\n/).flatMap(line => String(line).split(/\r/)).map(line => line.trim()).filter(Boolean);
}

function formatNumber(value, decimals) {
  const precision = Math.max(0, Math.min(6, Number(decimals) || 0));
  return Number(value).toFixed(precision);
}

function buildOrderMap(axisMap) {
  const result = {};
  for (const [logicalAxis, letter] of Object.entries(axisMap || {})) {
    result[String(letter).toUpperCase()] = logicalAxis;
  }
  return result;
}

function pointWordsForOutput(point, outputOrder, axisMap, passthroughAxes, overrides = {}) {
  const values = {};
  const reverseMap = buildOrderMap(axisMap);
  const order = Array.isArray(outputOrder) && outputOrder.length ? outputOrder : Object.values(axisMap || {});
  for (const letter of order) {
    const normalized = String(letter).toUpperCase();
    const logicalAxis = reverseMap[normalized];
    if (logicalAxis && Object.prototype.hasOwnProperty.call(point, logicalAxis)) {
      const raw = overrides[logicalAxis] ?? point[logicalAxis];
      values[normalized] = Number(raw);
      continue;
    }
    const passthrough = (Array.isArray(passthroughAxes) ? passthroughAxes : []).find(axis =>
      String(axis?.letter || "").toUpperCase() === normalized
    );
    if (passthrough && passthrough.emit && passthrough.value !== undefined) {
      values[normalized] = Number(passthrough.value);
    }
  }
  return values;
}

function composeMove(command, point, outputOrder, axisMap, passthroughAxes, decimals, override = {}) {
  const values = pointWordsForOutput(point, outputOrder, axisMap, passthroughAxes, override);
  return `${command} ${outputOrder
    .filter(letter => Object.prototype.hasOwnProperty.call(values, String(letter).toUpperCase()))
    .map(letter => `${String(letter).toUpperCase()}${formatNumber(values[String(letter).toUpperCase()], decimals)}`)
    .join(" ")}`.trim();
}

function pointLine(point, feed, decimals, machine, outputOrder, axisMap, passthroughAxes) {
  const values = pointWordsForOutput(point, outputOrder, axisMap, passthroughAxes);
  const tokens = [];
  for (const letter of outputOrder) {
    const normalized = String(letter).toUpperCase();
    if (Object.prototype.hasOwnProperty.call(values, normalized)) {
      tokens.push(`${normalized}${formatNumber(values[normalized], decimals)}`);
    }
  }
  tokens.push(`F${formatNumber(feed, decimals)}`);
  return `G1 ${tokens.join(" ")}`;
}

export function generateGcode(path, settings = {}) {
  if (!Array.isArray(path) || path.length < 2) {
    throw new Error("G-code üretmek için en az iki çıkış noktası gereklidir.");
  }

  const machine = resolveMachine(settings.machineId || settings.machine || settings.profile || "default");
  const axisMap = machine.axisMap || { x: "X", y: "Y", z: "Z", c: "C", a: "A" };
  const outputOrder = Array.isArray(settings.outputOrder) && settings.outputOrder.length
    ? settings.outputOrder
    : Array.isArray(machine.outputOrder) && machine.outputOrder.length
      ? machine.outputOrder
      : Object.values(axisMap).map(letter => String(letter).toUpperCase());
  const passthroughAxes = Array.isArray(machine.passthroughAxes) ? machine.passthroughAxes : [];
  const defaultSafeOrder = outputOrder.filter(letter => ["X", "Y", "Z"].includes(String(letter).toUpperCase()));
  const decimals = Math.max(0, Math.min(6, Number(settings.decimals ?? machine.output?.decimals ?? 1) || 0));
  const feed = Number(settings.feedRate ?? machine.defaults?.feed ?? 300);
  if (!Number.isFinite(feed) || feed <= 0) throw new Error("Kaynak hızı sıfırdan büyük olmalıdır.");
  const safeZ = Number(settings.safeZ ?? 0);
  const startDelay = Math.max(0, Number(settings.startDelay) || 0);
  const endDelay = Math.max(0, Number(settings.endDelay) || 0);
  const retract = Math.max(0, Number(settings.retract) || 0);
  const firstFeed = Number(settings.firstFeed) > 0 ? Number(settings.firstFeed) : feed;
  const lastFeed = Number(settings.lastFeed) > 0 ? Number(settings.lastFeed) : feed;
  if (!Number.isFinite(safeZ)) throw new Error("Güvenli Z değeri geçerli olmalıdır.");

  const first = path[0];
  const last = path[path.length - 1];
  const lines = [...cleanLines(settings.header ?? machine.output?.header ?? ["G90", "G21"])];
  const safeCommand = (settings.safeMoveCommand || machine.output?.safeMoveCommand || "G0").toUpperCase();
  const weldStart = (settings.weldStart ?? machine.output?.weldOnCommand ?? "M3");
  const weldEnd = (settings.weldEnd ?? machine.output?.weldOffCommand ?? "M5");
  const footer = settings.footer ?? machine.output?.footer ?? [];
  const lineEnding = settings.lineEnding || machine.output?.lineEnding || "\n";

  if (machine.id === "default") {
    lines.push(composeMove(safeCommand, { ...first, z: safeZ }, defaultSafeOrder, axisMap, passthroughAxes, decimals, { z: safeZ }));
    lines.push(composeMove(safeCommand, { ...first, z: first.z }, ["Z"], axisMap, passthroughAxes, decimals, { z: first.z }));
  } else {
    lines.push(composeMove(safeCommand, { ...first, z: safeZ }, outputOrder, axisMap, passthroughAxes, decimals, { z: safeZ }));
  }
  lines.push(...cleanLines(weldStart));
  if (startDelay > 0) lines.push(`G4 P${formatNumber(startDelay, decimals)}`);

  for (let i = 0; i < path.length; i += 1) {
    const segmentFeed = i === path.length - 1 ? lastFeed : i === 1 ? firstFeed : feed;
    lines.push(pointLine(path[i], segmentFeed, decimals, machine, outputOrder, axisMap, passthroughAxes));
  }

  if (endDelay > 0) lines.push(`G4 P${formatNumber(endDelay, decimals)}`);
  lines.push(...cleanLines(weldEnd));
  if (machine.id === "default") {
    lines.push(composeMove(safeCommand, { ...last, z: last.z + retract }, ["Z"], axisMap, passthroughAxes, decimals, { z: last.z + retract }));
    if (Math.abs(safeZ - (last.z + retract)) > 10 ** -decimals) {
      lines.push(composeMove(safeCommand, { ...last, z: safeZ }, ["Z"], axisMap, passthroughAxes, decimals, { z: safeZ }));
    }
  } else {
    lines.push(composeMove(safeCommand, { ...last, z: last.z + retract }, outputOrder, axisMap, passthroughAxes, decimals, { z: last.z + retract }));
    if (Math.abs(safeZ - (last.z + retract)) > 10 ** -decimals) {
      lines.push(composeMove(safeCommand, { ...last, z: safeZ }, outputOrder, axisMap, passthroughAxes, decimals, { z: safeZ }));
    }
  }
  lines.push(...cleanLines(footer));

  if (settings.lineNumbers || machine.output?.lineNumbers) {
    return lines.map((line, index) => `N${(index + 1) * 10} ${line}`).join(lineEnding);
  }
  return lines.join(lineEnding);
}

export { formatNumber };
