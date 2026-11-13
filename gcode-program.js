const AXES = ["x", "y", "z", "c", "a"];
const AXIS_WORD = /([XYZWAC])\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/gi;
const FEED_WORD = /(?:^|\s)F\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?=\s|$)/i;
const MACHINE_IDS = ["default", "ankara-6eksen"];

function splitLines(text) {
  const lines = [];
  const expression = /\r\n|\n|\r/g;
  let start = 0;
  let match;
  while ((match = expression.exec(text))) {
    lines.push({ content: text.slice(start, match.index), ending: match[0] });
    start = expression.lastIndex;
  }
  if (start < text.length || !lines.length) {
    lines.push({ content: text.slice(start), ending: "" });
  }
  return lines;
}

function parseLine(content) {
  let code = "";
  const comments = [];
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === ";") {
      comments.push(content.slice(index));
      break;
    }
    if (character === "(") {
      const end = content.indexOf(")", index + 1);
      if (end < 0) {
        comments.push(content.slice(index));
        break;
      }
      comments.push(content.slice(index, end + 1));
      index = end;
      continue;
    }
    code += character;
  }
  return { code: code.trim(), comments };
}

function readWords(code) {
  const values = {};
  for (const match of code.matchAll(AXIS_WORD)) {
    values[match[1].toLowerCase()] = Number(match[2]);
  }
  const feed = code.match(FEED_WORD);
  return { values, feed: feed ? Number(feed[1]) : null };
}

function hasCommand(code, letter, number) {
  return new RegExp(`\\b${letter}0?${number}\\b`, "i").test(code);
}

function formatNumber(value, decimals) {
  return Number(value).toFixed(decimals);
}

function generatedLines(path, feed, decimals) {
  return path.map(point => {
    const words = AXES.map(axis =>
      `${axis.toUpperCase()}${formatNumber(point[axis], decimals)}`
    );
    if (feed !== null) words.push(`F${formatNumber(feed, decimals)}`);
    return `G1 ${words.join(" ")}`;
  });
}

function logicalAxisForLetter(letter, machineId) {
  const axis = letter.toLowerCase();
  if (machineId === "ankara-6eksen") {
    if (axis === "w") return "z";
    if (axis === "z") return null;
  }
  return AXES.includes(axis) ? axis : null;
}

function applyMachineWords(values, modal, machineId) {
  let hasLogicalAxis = false;
  for (const [letter, value] of Object.entries(values)) {
    const axis = logicalAxisForLetter(letter, machineId);
    if (!axis) continue;
    modal[axis] = value;
    hasLogicalAxis = true;
  }
  return hasLogicalAxis;
}

function outputLines(path, feed, decimals, machineId) {
  if (machineId !== "ankara-6eksen") return generatedLines(path, feed, decimals);
  return path.map(point => {
    const words = ["x", "y", "z"].map(axis =>
      `${axis === "z" ? "W" : axis.toUpperCase()}${formatNumber(point[axis], decimals)}`
    );
    words.push(`A${formatNumber(point.a, decimals)}`, `C${formatNumber(point.c, decimals)}`);
    if (feed !== null) words.push(`F${formatNumber(feed, decimals)}`);
    return `G1 ${words.join(" ")}`;
  });
}

export function applySplineToProgram(program, generatePath, splineSettings = {}, decimals = 3, selectedMachine = "default") {
  if (typeof generatePath !== "function") {
    throw new Error("Spline üretim fonksiyonu bulunamadı.");
  }
  const machineId = MACHINE_IDS.includes(selectedMachine) ? selectedMachine : "default";
  const precision = Math.max(0, Math.min(6, Number(decimals) || 0));
  const lines = splitLines(String(program ?? ""));
  const modal = { x: 0, y: 0, z: 0, c: 0, a: 0 };
  let modalFeed = null;
  let activeBlock = null;
  const blocks = [];

  lines.forEach((line, index) => {
    const { code, comments } = parseLine(line.content);
    if (!code) return;
    const startsWeld = hasCommand(code, "M", 3);
    const endsWeld = hasCommand(code, "M", 5);
    if (startsWeld) {
      activeBlock = { lineIndices: [], points: [], feeds: [], firstFeed: null, inheritedFeed: modalFeed };
      blocks.push(activeBlock);
    }

    const isLinearMove = hasCommand(code, "G", 1);
    if (isLinearMove) {
      const { values, feed } = readWords(code);
      if (feed !== null) modalFeed = feed;
      const hasLogicalAxis = applyMachineWords(values, modal, machineId);
      if (activeBlock) {
        activeBlock.lineIndices.push(index);
        activeBlock.points.push({ ...modal });
        activeBlock.feeds.push(modalFeed);
        if (activeBlock.lineIndices.length === 1) {
          activeBlock.firstFeed = feed ?? activeBlock.inheritedFeed;
        }
        if (!hasLogicalAxis) {
          throw new Error(`Satır ${index + 1}: G1 hareketinde XYZAC koordinatı bulunamadı.`);
        }
      }
    } else {
      const { values, feed } = readWords(code);
      applyMachineWords(values, modal, machineId);
      if (feed !== null) modalFeed = feed;
    }

    if (endsWeld) activeBlock = null;
    if (!comments.length && !code) return;
  });

  const replacements = new Map();
  const removed = new Set();
  let convertedBlocks = 0;
  let skippedBlocks = 0;
  for (const block of blocks) {
    if (block.lineIndices.length < 2) {
      if (block.lineIndices.length === 1) {
        skippedBlocks += 1;
        block.pathPoints = block.points;
      }
      continue;
    }
    const result = generatePath(block.points, splineSettings);
    if (!result || !Array.isArray(result.points) || result.points.length < 2) {
      throw new Error("Kaynak bloğu için geçerli spline yolu üretilemedi.");
    }
    block.pathPoints = result.points;
    const firstIndex = block.lineIndices[0];
    const firstEnding = lines[firstIndex].ending || lines.find(line => line.ending)?.ending || "\n";
    const output = outputLines(result.points, block.firstFeed, precision, machineId);
    const hasComments = block.lineIndices.some(index => parseLine(lines[index].content).comments.length > 0);
    const generated = output.map(content => ({ content, ending: firstEnding }));
    if (!hasComments) generated[generated.length - 1].ending = lines[block.lineIndices.at(-1)].ending;
    replacements.set(firstIndex, generated);
    block.lineIndices.forEach(index => {
      removed.add(index);
      const comments = parseLine(lines[index].content).comments;
      if (comments.length) {
        removed.delete(index);
        lines[index] = { ...lines[index], content: comments.join(" ") };
      }
    });
    convertedBlocks += 1;
  }

  const output = [];
  lines.forEach((line, index) => {
    if (replacements.has(index)) output.push(...replacements.get(index));
    if (!removed.has(index)) output.push(line);
  });
  return {
    text: output.map(line => line.content + line.ending).join(""),
    convertedBlocks,
    skippedBlocks,
    weldBlocks: blocks
      .filter(block => block.points.length)
      .map(block => ({ points: block.points, path: block.pathPoints || block.points }))
  };
}
