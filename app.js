import { generatePath, getToolDirection } from "./spline.js";
import { generateGcode } from "./gcode.js";
import { applySplineToProgram } from "./gcode-program.js";
import { createViewer } from "./viewer.js";

const STORAGE_KEY = "swSpline:project";
const MACHINE_STORAGE_KEY = "swSpline:machine";
const SETTING_IDS = [
  "method", "sampling-mode", "sample-step", "chord-tolerance", "rotary-step", "feed-rate",
  "closed-loop", "unwrap-rotary", "reverse-c", "reverse-a", "show-output-points",
  "gcode-header", "safe-z", "weld-start", "start-delay", "weld-end", "end-delay",
  "retract", "first-feed", "last-feed", "decimals", "line-numbers", "gcode-footer"
];
const AXES = ["x", "y", "z", "c", "a"];
const $ = selector => document.querySelector(selector);
const pointsBody = $("#points-body");
const status = $("#app-status");
const parseErrors = $("#parse-errors");
let points = [];
let path = [];
let pathLength = 0;
let pathLengths = [];
let viewer = null;
let fullProgramSource = null;
let programViewerPoints = [];
let programViewerPaths = [];
let selectedMachine = "default";

function restoreMachineSelection() {
  try {
    const saved = localStorage.getItem(MACHINE_STORAGE_KEY);
    if (saved === "default" || saved === "ankara-6eksen") selectedMachine = saved;
  } catch {
    // Machine selection is optional when browser storage is unavailable.
  }
  $("#machine-select").value = selectedMachine;
}

function setMachineSelection(machineId) {
  selectedMachine = machineId === "ankara-6eksen" ? machineId : "default";
  try {
    localStorage.setItem(MACHINE_STORAGE_KEY, selectedMachine);
  } catch {
    // Machine selection is optional when browser storage is unavailable.
  }
}

function showMessage(element, text, kind = "") {
  element.textContent = text;
  element.classList.remove("error", "success");
  if (kind) element.classList.add(kind);
}

function readControl(id) {
  const element = document.getElementById(id);
  return element.type === "checkbox" ? element.checked : element.value;
}

function settingsSnapshot() {
  const settings = {};
  SETTING_IDS.forEach(id => { settings[id] = readControl(id); });
  return settings;
}

function restoreSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  SETTING_IDS.forEach(id => {
    if (!(id in settings)) return;
    const element = document.getElementById(id);
    if (element.type === "checkbox") element.checked = Boolean(settings[id]);
    else element.value = String(settings[id]);
  });
}

function currentSplineSettings() {
  return {
    method: $("#method").value,
    samplingMode: $("#sampling-mode").value,
    step: Number($("#sample-step").value),
    chordTolerance: Number($("#chord-tolerance").value),
    rotaryStep: Number($("#rotary-step").value),
    closed: $("#closed-loop").checked,
    unwrap: $("#unwrap-rotary").checked
  };
}

function currentGcodeSettings() {
  return {
    header: $("#gcode-header").value,
    safeZ: $("#safe-z").value,
    weldStart: $("#weld-start").value,
    startDelay: $("#start-delay").value,
    weldEnd: $("#weld-end").value,
    endDelay: $("#end-delay").value,
    retract: $("#retract").value,
    feedRate: $("#feed-rate").value,
    firstFeed: $("#first-feed").value,
    lastFeed: $("#last-feed").value,
    decimals: $("#decimals").value,
    lineNumbers: $("#line-numbers").checked,
    footer: $("#gcode-footer").value
  };
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      format: "Spline_Generator_5_Axis",
      version: 1,
      points,
      settings: settingsSnapshot()
    }));
  } catch {
    // Storage is optional; the application remains usable for this session.
  }
}

function renderTable() {
  $("#empty-points").classList.toggle("hidden", points.length > 0);
  pointsBody.innerHTML = points.map((point, index) => `
    <tr>
      <td>${index + 1}</td>
      ${["x", "y", "z", "a", "c"].map(axis =>
        `<td><input aria-label="${index + 1}. nokta ${axis.toUpperCase()}" data-index="${index}" data-axis="${axis}" type="number" step="any" value="${point[axis]}"></td>`
      ).join("")}
      <td><div class="row-actions">
        <button type="button" data-action="up" data-index="${index}" aria-label="Yukarı taşı" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-action="down" data-index="${index}" aria-label="Aşağı taşı" ${index === points.length - 1 ? "disabled" : ""}>↓</button>
      </div></td>
      <td><button type="button" class="button quiet" data-action="delete" data-index="${index}">Sil</button></td>
    </tr>`).join("");
  $("#input-count").textContent = String(points.length);
}

function interpolatePath(position, activePath = path, activeLengths = pathLengths) {
  if (!activePath.length) return null;
  if (activePath.length === 1) return activePath[0];
  let segment;
  let fraction;
  if (activeLengths.length > 1 && activeLengths[activeLengths.length - 1] > 1e-10) {
    const target = position * activeLengths[activeLengths.length - 1];
    segment = 1;
    while (segment < activeLengths.length - 1 && activeLengths[segment] < target) segment += 1;
    const span = activeLengths[segment] - activeLengths[segment - 1];
    fraction = span > 0 ? (target - activeLengths[segment - 1]) / span : 0;
    segment -= 1;
  } else {
    segment = Math.min(activePath.length - 2, Math.floor(position * (activePath.length - 1)));
    fraction = position * (activePath.length - 1) - segment;
  }
  const result = {};
  for (const axis of AXES) {
    result[axis] = activePath[segment][axis] +
      (activePath[segment + 1][axis] - activePath[segment][axis]) * fraction;
  }
  return result;
}

function updateSimulation() {
  const fraction = Number($("#path-slider").value) / Number($("#path-slider").max);
  $("#slider-value").textContent = `${Math.round(fraction * 100)}%`;
  const programPath = fullProgramSource !== null
    ? programViewerPaths.find(segment => segment.length > 1) || []
    : path;
  const activePath = fullProgramSource !== null ? programPath : path;
  const activeLengths = fullProgramSource !== null
    ? activePath.reduce((lengths, point, index) => {
      if (index > 0) {
        const previous = activePath[index - 1];
        lengths.push(lengths[index - 1] + Math.hypot(
          point.x - previous.x, point.y - previous.y, point.z - previous.z
        ));
      }
      return lengths;
    }, [0])
    : pathLengths;
  const point = interpolatePath(fraction, activePath, activeLengths);
  if (!point) {
    $("#current-position").textContent = "Simülasyon için geçerli bir yol oluşturun.";
    viewer?.setSimulation(null);
    return;
  }
  $("#current-position").textContent =
    `X ${point.x.toFixed(2)}  Y ${point.y.toFixed(2)}  Z ${point.z.toFixed(2)}  ` +
    `C ${point.c.toFixed(2)}°  A ${point.a.toFixed(2)}°`;
  viewer?.setSimulation(point);
}

function updateStats() {
  if (fullProgramSource !== null) {
    const inputCount = programViewerPoints.length;
    const outputCount = programViewerPaths.reduce((count, segment) => count + segment.length, 0);
    const totalLength = programViewerPaths.reduce((total, segment) => {
      for (let index = 1; index < segment.length; index += 1) {
        total += Math.hypot(
          segment[index].x - segment[index - 1].x,
          segment[index].y - segment[index - 1].y,
          segment[index].z - segment[index - 1].z
        );
      }
      return total;
    }, 0);
    $("#path-length").textContent = outputCount ? `${totalLength.toFixed(2)} mm` : "—";
    $("#input-count").textContent = String(inputCount);
    $("#output-count").textContent = String(outputCount);
    $("#estimated-time").textContent = "—";
    return;
  }
  $("#path-length").textContent = path.length ? `${pathLength.toFixed(2)} mm` : "—";
  $("#output-count").textContent = String(path.length);
  const feed = Number($("#feed-rate").value);
  if (path.length && feed > 0) {
    const seconds = pathLength / feed * 60;
    const minutes = Math.floor(seconds / 60);
    $("#estimated-time").textContent = `${minutes} dk ${Math.round(seconds % 60)} sn`;
  } else {
    $("#estimated-time").textContent = "—";
  }
}

function updateViewer() {
  const isProgramView = fullProgramSource !== null;
  const viewerPoints = isProgramView ? programViewerPoints : points;
  const viewerPaths = isProgramView ? programViewerPaths : [path];
  const viewerPath = viewerPaths.flat();
  viewer?.update(viewerPoints, viewerPath, {
    pathSegments: viewerPaths,
    showOutput: $("#show-output-points").checked,
    getToolDirection: (c, a) => getToolDirection(c, a, $("#reverse-c").checked, $("#reverse-a").checked)
  });
  updateSimulation();
}

function updateGcode() {
  if (fullProgramSource !== null) {
    try {
      const result = applySplineToProgram(
        fullProgramSource,
        generatePath,
        currentSplineSettings(),
        Number($("#decimals").value),
        selectedMachine
      );
      $("#gcode-output").value = result.text;
      programViewerPoints = result.weldBlocks.flatMap(block => block.points);
      programViewerPaths = result.weldBlocks.map(block => block.path);
      updateStats();
      updateViewer();
      const converted = `${result.convertedBlocks} kaynak bloğu spline ile güncellendi.`;
      const skipped = result.skippedBlocks
        ? ` ${result.skippedBlocks} tek G1'li blok değiştirilmedi.`
        : "";
      showMessage(status, converted + skipped, "success");
    } catch (error) {
      $("#gcode-output").value = "";
      programViewerPoints = [];
      programViewerPaths = [];
      updateStats();
      updateViewer();
      showMessage(status, error.message, "error");
    }
    return;
  }
  if (path.length < 2) {
    $("#gcode-output").value = "";
    return;
  }
  try {
    $("#gcode-output").value = generateGcode(path, currentGcodeSettings());
  } catch (error) {
    $("#gcode-output").value = "";
    showMessage(status, error.message, "error");
  }
}

function render({ persist = true } = {}) {
  renderTable();
  path = [];
  pathLength = 0;
  pathLengths = [];
  if (points.length >= 2) {
    try {
      const generated = generatePath(points, currentSplineSettings());
      path = generated.points;
      pathLength = generated.length;
      pathLengths = [0];
      for (let i = 1; i < path.length; i += 1) {
        pathLengths.push(pathLengths[i - 1] + Math.hypot(
          path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z
        ));
      }
      showMessage(status, "Spline ve G-code güncellendi.", "success");
    } catch (error) {
      showMessage(status, error.message, "error");
    }
  } else {
    showMessage(status, points.length ? "Spline için en az iki nokta gerekir." : "");
  }
  updateStats();
  updateViewer();
  updateGcode();
  if (persist) saveLocal();
}

function parseInput(text, basePoints = points) {
  const lines = String(text).split(/\r?\n/);
  const parsed = [];
  const errors = [];
  let modal = basePoints.length ? { ...basePoints[basePoints.length - 1] } : { x: 0, y: 0, z: 0, c: 0, a: 0 };
  let header = null;

  lines.forEach((source, lineIndex) => {
    const clean = source.replace(/\([^)]*\)/g, "").split(";")[0].trim();
    if (!clean) return;
    const tokens = clean.replace(/,/g, " ").trim().split(/\s+/);
    const headings = tokens.map(token => token.replace(/^([XYZCA])(?:\b.*)?$/i, "$1").toLowerCase());
    if (!header && headings.length >= 2 &&
      headings.every(token => AXES.includes(token)) && headings.includes("x") &&
      headings.includes("y") && headings.includes("z")) {
      header = headings;
      return;
    }

    const lineIsGcode = /\b[GM]\d+/i.test(clean) ||
      (/[XYZCA]\s*[-+]?(?:\d|\.)/i.test(clean) && !clean.includes(","));
    const next = { ...modal };

    try {
      if (lineIsGcode) {
        const words = [...clean.matchAll(/([XYZCA])\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/gi)];
        const hasAxis = /(?:^|\s)[XYZCA]\s*/i.test(clean);
        if (hasAxis && !words.length) throw new Error("Eksen değeri okunamadı.");
        if (!words.length) return;
        const malformed = clean.match(/(?:^|\s)([XYZCA])\s*([^\s,]+)/i);
        if (malformed && !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(malformed[2])) {
          throw new Error(`${malformed[1].toUpperCase()} eksen değeri sayısal değil.`);
        }
        words.forEach(([, axis, value]) => { next[axis.toLowerCase()] = Number(value); });
        if (!words.length && !/\bG\d+/i.test(clean)) throw new Error("G-code satırında koordinat bulunamadı.");
      } else {
        const values = tokens;
        if (header) {
          if (values.length > header.length) throw new Error("Başlıktaki eksen sayısından fazla değer var.");
          values.forEach((value, index) => {
            const axis = header[index];
            if (!axis || !Number.isFinite(Number(value))) throw new Error(`Geçersiz değer: ${value}`);
            next[axis] = Number(value);
          });
        } else {
          if (values.length > 5 || values.some(value => !Number.isFinite(Number(value)))) {
            throw new Error("X Y Z C A sırasıyla en fazla beş sayısal değer bekleniyor.");
          }
          values.forEach((value, index) => { next[["x", "y", "z", "c", "a"][index]] = Number(value); });
        }
      }
      if (AXES.some(axis => !Number.isFinite(next[axis]))) throw new Error("Satırda geçersiz eksen değeri var.");
      parsed.push(next);
      modal = next;
    } catch (error) {
      errors.push(`Satır ${lineIndex + 1}: ${error.message}`);
    }
  });
  return { points: parsed, errors };
}

function appendParsedText(text, sourceName = "Metin") {
  const result = parseInput(text);
  if (result.points.length) {
    points = points.concat(result.points);
    render();
  }
  showMessage(parseErrors,
    `${sourceName}: ${result.points.length} nokta eklendi.` +
    (result.errors.length ? `\n${result.errors.join("\n")}` : ""),
    result.errors.length ? "error" : "success");
  if (!result.points.length && !result.errors.length) {
    showMessage(parseErrors, "Okunabilir nokta satırı bulunamadı.", "error");
  }
}

function setPointsFromProject(project) {
  if (!project || !Array.isArray(project.points)) throw new Error("Proje dosyasında nokta dizisi bulunamadı.");
  const imported = project.points.map((point, index) => {
    const normalized = {};
    for (const axis of AXES) {
      const value = Number(point[axis]);
      if (!Number.isFinite(value)) throw new Error(`${index + 1}. noktada ${axis.toUpperCase()} değeri geçersiz.`);
      normalized[axis] = value;
    }
    return normalized;
  });
  points = imported;
  restoreSettings(project.settings);
  render();
}

function loadSample() {
  points = [
    { x: -30, y: 0, z: 20, c: 350, a: 0 },
    { x: -21.2, y: 0, z: 41.2, c: 355, a: 5 },
    { x: 0, y: 0, z: 50, c: 360, a: 10 },
    { x: 21.2, y: 0, z: 41.2, c: 365, a: 5 },
    { x: 30, y: 0, z: 20, c: 370, a: 0 }
  ];
  $("#closed-loop").checked = false;
  render();
}

function applySamplingVisibility() {
  const toleranceMode = $("#sampling-mode").value === "tolerance";
  $("#step-field").classList.toggle("hidden", toleranceMode);
  $("#tolerance-field").classList.toggle("hidden", !toleranceMode);
}

$("#point-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const point = {
    x: Number(form.get("x")), y: Number(form.get("y")), z: Number(form.get("z")),
    a: Number(form.get("a")), c: Number(form.get("c"))
  };
  if (Object.values(point).some(value => !Number.isFinite(value))) {
    showMessage(status, "Tüm eksenlere geçerli sayısal değer girin.", "error");
    return;
  }
  points.push(point);
  render();
});

pointsBody.addEventListener("change", event => {
  const input = event.target.closest("input[data-index][data-axis]");
  if (!input) return;
  const index = Number(input.dataset.index);
  const axis = input.dataset.axis;
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    showMessage(status, "Nokta koordinatı sayısal olmalıdır.", "error");
    input.value = points[index][axis];
    return;
  }
  points[index][axis] = value;
  render();
});

pointsBody.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const index = Number(button.dataset.index);
  const action = button.dataset.action;
  if (action === "delete") points.splice(index, 1);
  if (action === "up" && index > 0) [points[index - 1], points[index]] = [points[index], points[index - 1]];
  if (action === "down" && index < points.length - 1) [points[index + 1], points[index]] = [points[index], points[index + 1]];
  render();
});

$("#parse-text").addEventListener("click", () => appendParsedText($("#points-text").value));
$("#gcode-program-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    $("#gcode-program-source").value = await file.text();
    showMessage(parseErrors, `${file.name} tam program olarak yüklendi.`, "success");
  } catch (error) {
    showMessage(parseErrors, `G-code dosyası okunamadı: ${error.message}`, "error");
  }
  event.target.value = "";
});
$("#spline-program").addEventListener("click", () => {
  const source = $("#gcode-program-source").value;
  if (!source.trim()) {
    showMessage(status, "Önce dönüştürülecek tam G-code programını yükleyin veya yapıştırın.", "error");
    return;
  }
  fullProgramSource = source;
  render({ persist: false });
});
$("#clear-program").addEventListener("click", () => {
  $("#gcode-program-source").value = "";
  fullProgramSource = null;
  programViewerPoints = [];
  programViewerPaths = [];
  render({ persist: false });
});
$("#machine-select").addEventListener("change", event => {
  setMachineSelection(event.target.value);
  render({ persist: false });
  showMessage(status,
    selectedMachine === "ankara-6eksen"
      ? "Ankara seçildi. M3–M5 içindeki spline G1 satırları W ekseniyle yazılacak; G0 satırları korunur."
      : "Default seçildi. M3–M5 içindeki spline G1 satırları XYZAC biçiminde yazılacak.",
    "success");
});
$("#points-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    appendParsedText(await file.text(), file.name);
  } catch (error) {
    showMessage(parseErrors, `Dosya okunamadı: ${error.message}`, "error");
  }
  event.target.value = "";
});
$("#clear-points").addEventListener("click", () => {
  points = [];
  render();
  showMessage(parseErrors, "");
});
$("#sample-button").addEventListener("click", loadSample);
$("#path-slider").addEventListener("input", updateSimulation);
$("#reset-view").addEventListener("click", () => viewer?.reset());

SETTING_IDS.forEach(id => {
  const element = document.getElementById(id);
  element.addEventListener("change", () => {
    if (id === "sampling-mode") applySamplingVisibility();
    render();
  });
  if (element.tagName === "TEXTAREA" || element.type === "number") {
    element.addEventListener("input", () => {
      if (element.type === "number" && element.value === "") return;
      if (id === "sampling-mode") applySamplingVisibility();
      render();
    });
  }
});

$("#project-export").addEventListener("click", () => {
  const project = {
    format: "Spline_Generator_5_Axis",
    version: 1,
    points,
    settings: settingsSnapshot()
  };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Spline_Generator_5_Axis.json";
  link.click();
  URL.revokeObjectURL(url);
});

$("#project-import").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    setPointsFromProject(JSON.parse(await file.text()));
    showMessage(status, "Proje içe aktarıldı.", "success");
  } catch (error) {
    showMessage(status, `Proje içe aktarılamadı: ${error.message}`, "error");
  }
  event.target.value = "";
});

$("#copy-gcode").addEventListener("click", async () => {
  const output = $("#gcode-output").value;
  if (!output) {
    showMessage(status, "Önce en az iki nokta ile G-code oluşturun.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(output);
    showMessage(status, "G-code panoya kopyalandı.", "success");
  } catch (error) {
    showMessage(status, `Panoya kopyalanamadı: ${error.message}`, "error");
  }
});

$("#download-gcode").addEventListener("click", () => {
  const output = $("#gcode-output").value;
  if (!output) {
    showMessage(status, "Önce en az iki nokta ile G-code oluşturun.", "error");
    return;
  }
  const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "spline-kaynak-yolu.nc";
  link.click();
  URL.revokeObjectURL(url);
});

applySamplingVisibility();
restoreMachineSelection();
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const project = JSON.parse(saved);
    if (Array.isArray(project.points)) setPointsFromProject(project);
  }
} catch {
  // Ignore unavailable or malformed optional browser storage.
}
render({ persist: false });

createViewer($("#viewer"), $("#viewer-message"))
  .then(instance => {
    viewer = instance;
    updateViewer();
  })
  .catch(error => {
    $("#viewer-message").textContent = `3D görünüm yüklenemedi: ${error.message}`;
    $("#viewer-message").classList.add("error");
  });
