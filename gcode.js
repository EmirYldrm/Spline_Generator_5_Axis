function cleanLines(text) {
  return String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function formatNumber(value, decimals) {
  const precision = Math.max(0, Math.min(6, Number(decimals) || 0));
  return Number(value).toFixed(precision);
}

function pointLine(point, feed, decimals) {
  return `G1 X${formatNumber(point.x, decimals)} Y${formatNumber(point.y, decimals)} ` +
    `Z${formatNumber(point.z, decimals)} C${formatNumber(point.c, decimals)} ` +
    `A${formatNumber(point.a, decimals)} F${formatNumber(feed, decimals)}`;
}

export function generateGcode(path, settings = {}) {
  if (!Array.isArray(path) || path.length < 2) {
    throw new Error("G-code üretmek için en az iki çıkış noktası gereklidir.");
  }
  const decimals = Math.max(0, Math.min(6, Number(settings.decimals) || 0));
  const feed = Number(settings.feedRate);
  if (!Number.isFinite(feed) || feed <= 0) throw new Error("Kaynak hızı sıfırdan büyük olmalıdır.");
  const safeZ = Number(settings.safeZ);
  const startDelay = Math.max(0, Number(settings.startDelay) || 0);
  const endDelay = Math.max(0, Number(settings.endDelay) || 0);
  const retract = Math.max(0, Number(settings.retract) || 0);
  const firstFeed = Number(settings.firstFeed) > 0 ? Number(settings.firstFeed) : feed;
  const lastFeed = Number(settings.lastFeed) > 0 ? Number(settings.lastFeed) : feed;
  if (!Number.isFinite(safeZ)) throw new Error("Güvenli Z değeri geçerli olmalıdır.");

  const first = path[0];
  const last = path[path.length - 1];
  const lines = cleanLines(settings.header);
  lines.push(
    `G0 X${formatNumber(first.x, decimals)} Y${formatNumber(first.y, decimals)} Z${formatNumber(safeZ, decimals)}`,
    `G0 Z${formatNumber(first.z, decimals)}`
  );
  lines.push(...cleanLines(settings.weldStart));
  if (startDelay > 0) lines.push(`G4 P${formatNumber(startDelay, decimals)}`);

  for (let i = 0; i < path.length; i += 1) {
    const segmentFeed = i === path.length - 1 ? lastFeed : i === 1 ? firstFeed : feed;
    lines.push(pointLine(path[i], segmentFeed, decimals));
  }

  if (endDelay > 0) lines.push(`G4 P${formatNumber(endDelay, decimals)}`);
  lines.push(...cleanLines(settings.weldEnd));
  lines.push(`G0 Z${formatNumber(last.z + retract, decimals)}`);
  if (Math.abs(safeZ - last.z - retract) > 10 ** -decimals) {
    lines.push(`G0 Z${formatNumber(safeZ, decimals)}`);
  }
  lines.push(...cleanLines(settings.footer));

  if (settings.lineNumbers) {
    return lines.map((line, index) => `N${(index + 1) * 10} ${line}`).join("\n");
  }
  return lines.join("\n");
}

export { formatNumber };
