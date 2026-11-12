const AXES = ["x", "y", "z", "c", "a"];
const TAU = Math.PI * 2;

function assertPoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("Spline için en az iki nokta gereklidir.");
  }
  for (const [index, point] of points.entries()) {
    for (const axis of AXES) {
      if (!Number.isFinite(Number(point[axis]))) {
        throw new Error(`${index + 1}. noktanın ${axis.toUpperCase()} değeri geçerli değil.`);
      }
    }
  }
}

function distance3(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function unwrapValue(value, previous, direction = 0) {
  let delta = value - previous;
  if (Math.abs(delta) > 180 && direction && Math.sign(delta) === direction) {
    return previous + delta;
  }
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return previous + delta;
}

function preparePoints(points, settings) {
  const result = points.map(point => ({
    x: Number(point.x), y: Number(point.y), z: Number(point.z),
    c: Number(point.c), a: Number(point.a)
  }));
  if (settings.unwrap !== false) {
    let cDirection = 0;
    let aDirection = 0;
    for (let i = 1; i < result.length; i += 1) {
      const rawC = result[i].c;
      const rawA = result[i].a;
      const nextC = unwrapValue(rawC, result[i - 1].c, cDirection);
      const nextA = unwrapValue(rawA, result[i - 1].a, aDirection);
      const cDelta = nextC - result[i - 1].c;
      const aDelta = nextA - result[i - 1].a;
      if (Math.abs(cDelta) > 1e-9) cDirection = Math.sign(cDelta);
      if (Math.abs(aDelta) > 1e-9) aDirection = Math.sign(aDelta);
      result[i].c = nextC;
      result[i].a = nextA;
    }
  }
  return result;
}

function makeKnots(points, centripetal) {
  const knots = [0];
  for (let i = 1; i < points.length; i += 1) {
    const chord = distance3(points[i - 1], points[i]);
    knots.push(knots[i - 1] + Math.max(centripetal ? Math.sqrt(chord) : chord, 1e-5));
  }
  return knots;
}

function solveTridiagonal(lower, diagonal, upper, rhs) {
  const n = diagonal.length;
  const c = upper.slice();
  const d = rhs.slice();
  const b = diagonal.slice();
  for (let i = 1; i < n; i += 1) {
    const factor = lower[i] / b[i - 1];
    b[i] -= factor * c[i - 1];
    d[i] -= factor * d[i - 1];
  }
  const answer = new Array(n);
  answer[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i -= 1) {
    answer[i] = (d[i] - c[i] * answer[i + 1]) / b[i];
  }
  return answer;
}

function cubicSecondDerivatives(points, knots, axis, clamped) {
  const n = points.length;
  if (n <= 2) return new Array(n).fill(0);
  const lower = new Array(n).fill(0);
  const diagonal = new Array(n).fill(0);
  const upper = new Array(n).fill(0);
  const rhs = new Array(n).fill(0);
  const firstH = knots[1] - knots[0];
  const lastH = knots[n - 1] - knots[n - 2];

  if (clamped) {
    diagonal[0] = 2 * firstH;
    upper[0] = firstH;
    rhs[0] = 6 * ((points[1][axis] - points[0][axis]) / firstH -
      (points[1][axis] - points[0][axis]) / firstH);
    lower[n - 1] = lastH;
    diagonal[n - 1] = 2 * lastH;
    rhs[n - 1] = 6 * ((points[n - 1][axis] - points[n - 2][axis]) / lastH -
      (points[n - 1][axis] - points[n - 2][axis]) / lastH);
  } else {
    diagonal[0] = 1;
    diagonal[n - 1] = 1;
  }

  for (let i = 1; i < n - 1; i += 1) {
    const before = knots[i] - knots[i - 1];
    const after = knots[i + 1] - knots[i];
    lower[i] = before;
    diagonal[i] = 2 * (before + after);
    upper[i] = after;
    rhs[i] = 6 * ((points[i + 1][axis] - points[i][axis]) / after -
      (points[i][axis] - points[i - 1][axis]) / before);
  }
  return solveTridiagonal(lower, diagonal, upper, rhs);
}

function buildCurve(points, settings) {
  const method = settings.method || "centripetal";
  const closed = Boolean(settings.closed);
  let controlPoints = points.slice();
  if (closed) {
    const first = controlPoints[0];
    const last = controlPoints[controlPoints.length - 1];
    if (distance3(first, last) < 1e-9 &&
      Math.abs(first.c - last.c) < 1e-9 && Math.abs(first.a - last.a) < 1e-9) {
      controlPoints = controlPoints.slice(0, -1);
    }
    const closing = { ...controlPoints[0] };
    if (settings.unwrap !== false) {
      closing.c = unwrapValue(closing.c, controlPoints[controlPoints.length - 1].c);
      closing.a = unwrapValue(closing.a, controlPoints[controlPoints.length - 1].a);
    }
    controlPoints = controlPoints.concat([closing]);
  }

  const knots = makeKnots(controlPoints, method === "centripetal");
  const derivatives = {};
  const second = {};
  if (method === "natural" || method === "clamped") {
    for (const axis of AXES) second[axis] = cubicSecondDerivatives(controlPoints, knots, axis, method === "clamped");
  } else if (method === "centripetal") {
    for (const axis of AXES) {
      derivatives[axis] = controlPoints.map((point, index) => {
        if (index === 0) {
          if (closed && controlPoints.length > 3) {
            const prev = controlPoints[controlPoints.length - 2];
            const span = (knots[1] - knots[0]) + (knots[controlPoints.length - 1] - knots[controlPoints.length - 2]);
            return (controlPoints[1][axis] - prev[axis]) / span;
          }
          return (controlPoints[1][axis] - point[axis]) / (knots[1] - knots[0]);
        }
        if (index === controlPoints.length - 1) {
          if (closed && controlPoints.length > 3) {
            const prev = controlPoints[controlPoints.length - 2];
            const span = (knots[1] - knots[0]) + (knots[index] - knots[index - 1]);
            return (controlPoints[1][axis] - prev[axis]) / span;
          }
          return (point[axis] - controlPoints[index - 1][axis]) / (knots[index] - knots[index - 1]);
        }
        return (controlPoints[index + 1][axis] - controlPoints[index - 1][axis]) /
          (knots[index + 1] - knots[index - 1]);
      });
    }
  }

  function evaluate(segment, t) {
    const h = knots[segment + 1] - knots[segment];
    const u = Math.max(0, Math.min(1, (t - knots[segment]) / h));
    const p0 = controlPoints[segment];
    const p1 = controlPoints[segment + 1];
    const result = {};
    for (const axis of AXES) {
      if (method === "linear" || (method !== "centripetal" && controlPoints.length === 2)) {
        result[axis] = p0[axis] + (p1[axis] - p0[axis]) * u;
      } else if (method === "natural" || method === "clamped") {
        const m0 = second[axis][segment];
        const m1 = second[axis][segment + 1];
        result[axis] = m0 * Math.pow(1 - u, 3) * h * h / 6 +
          m1 * Math.pow(u, 3) * h * h / 6 +
          (p0[axis] - m0 * h * h / 6) * (1 - u) +
          (p1[axis] - m1 * h * h / 6) * u;
      } else {
        const m0 = derivatives[axis][segment] * h;
        const m1 = derivatives[axis][segment + 1] * h;
        result[axis] = (2 * u ** 3 - 3 * u ** 2 + 1) * p0[axis] +
          (u ** 3 - 2 * u ** 2 + u) * m0 +
          (-2 * u ** 3 + 3 * u ** 2) * p1[axis] +
          (u ** 3 - u ** 2) * m1;
      }
    }
    return result;
  }

  return { points: controlPoints, knots, evaluate };
}

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared < 1e-18) return distance3(point, start);
  const fraction = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz) / lengthSquared));
  return Math.hypot(point.x - start.x - fraction * dx,
    point.y - start.y - fraction * dy, point.z - start.z - fraction * dz);
}

function adaptiveSamples(curve, tolerance, rotaryStep) {
  const output = [];
  const maxDepth = 14;
  function subdivide(segment, t0, p0, t1, p1, depth) {
    const tm = (t0 + t1) / 2;
    const tq1 = (3 * t0 + t1) / 4;
    const tq3 = (t0 + 3 * t1) / 4;
    const midpoint = curve.evaluate(segment, tm);
    const quarter1 = curve.evaluate(segment, tq1);
    const quarter3 = curve.evaluate(segment, tq3);
    const chordError = Math.max(pointLineDistance(midpoint, p0, p1),
      pointLineDistance(quarter1, p0, p1), pointLineDistance(quarter3, p0, p1));
    const angleDelta = Math.max(Math.abs(p1.c - p0.c), Math.abs(p1.a - p0.a));
    const tooLong = distance3(p0, p1) > 20;
    if (depth < maxDepth && (chordError > tolerance || angleDelta > rotaryStep || tooLong)) {
      subdivide(segment, t0, p0, tm, midpoint, depth + 1);
      subdivide(segment, tm, midpoint, t1, p1, depth + 1);
    } else {
      output.push({ t: t1, point: p1 });
    }
  }

  output.push({ t: curve.knots[0], point: curve.evaluate(0, curve.knots[0]) });
  for (let segment = 0; segment < curve.knots.length - 1; segment += 1) {
    const t0 = curve.knots[segment];
    const t1 = curve.knots[segment + 1];
    subdivide(segment, t0, curve.evaluate(segment, t0), t1, curve.evaluate(segment, t1), 0);
  }
  return output;
}

function cumulativeLengths(samples) {
  const lengths = [0];
  for (let i = 1; i < samples.length; i += 1) {
    lengths.push(lengths[i - 1] + distance3(samples[i - 1].point, samples[i].point));
  }
  return lengths;
}

function curvatureStep(samples, tolerance) {
  let minimumRadius = Infinity;
  for (let i = 1; i < samples.length - 1; i += 1) {
    const a = samples[i - 1].point;
    const b = samples[i].point;
    const c = samples[i + 1].point;
    const ab = distance3(a, b);
    const bc = distance3(b, c);
    const ac = distance3(a, c);
    const cross = Math.hypot(
      (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
      (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    );
    if (cross > 1e-9) minimumRadius = Math.min(minimumRadius, ab * bc * ac / (2 * cross));
  }
  return Math.max(0.1, Math.min(10, Math.sqrt(8 * Math.max(minimumRadius, 0.01) * tolerance)));
}

function interpolateAt(samples, lengths, distance) {
  let low = 0;
  let high = lengths.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lengths[middle] < distance) low = middle + 1;
    else high = middle;
  }
  const index = Math.max(1, low);
  const span = lengths[index] - lengths[index - 1];
  const fraction = span > 0 ? (distance - lengths[index - 1]) / span : 0;
  const a = samples[index - 1].point;
  const b = samples[index].point;
  const point = {};
  for (const axis of AXES) point[axis] = a[axis] + (b[axis] - a[axis]) * fraction;
  return point;
}

/**
 * Generate a sampled, arc-length-resampled path. All rotary values share the
 * XYZ-derived spline parameter and remain unwrapped when enabled.
 */
export function generatePath(inputPoints, settings = {}) {
  assertPoints(inputPoints);
  const points = preparePoints(inputPoints, settings);
  const closed = Boolean(settings.closed);
  const method = settings.method || "centripetal";
  if (!["linear", "centripetal", "natural", "clamped"].includes(method)) {
    throw new Error(`Bilinmeyen spline yöntemi: ${method}`);
  }
  if ((settings.samplingMode || "step") === "step" && settings.step !== undefined &&
      (!Number.isFinite(Number(settings.step)) || Number(settings.step) < 0.01)) {
    throw new Error("Sabit örnekleme adımı en az 0.01 mm olmalıdır.");
  }
  if (settings.samplingMode === "tolerance" && settings.chordTolerance !== undefined &&
      (!Number.isFinite(Number(settings.chordTolerance)) || Number(settings.chordTolerance) < 0.001)) {
    throw new Error("Chordal tolerans en az 0.001 mm olmalıdır.");
  }
  if (settings.rotaryStep !== undefined &&
      (!Number.isFinite(Number(settings.rotaryStep)) || Number(settings.rotaryStep) < 0.1)) {
    throw new Error("Maksimum rotary adımı en az 0.1° olmalıdır.");
  }
  const curve = buildCurve(points, { ...settings, method, closed });

  const tolerance = settings.samplingMode === "tolerance"
    ? Math.max(0.001, Number(settings.chordTolerance) || 0.25)
    : Math.max(0.001, (Number(settings.step) || 2) * 0.1);
  const rotaryStep = Math.max(0.1, Number(settings.rotaryStep) || 5);
  const dense = adaptiveSamples(curve, tolerance, rotaryStep);
  const lengths = cumulativeLengths(dense);
  const totalLength = lengths[lengths.length - 1];
  if (totalLength < 1e-10) {
    return { points: dense.map(sample => sample.point), length: 0 };
  }
  const spacing = settings.samplingMode === "tolerance"
    ? curvatureStep(dense, tolerance)
    : Math.max(0.01, Number(settings.step) || 2);
  const entries = [];
  const anchorDistances = [totalLength];

  // Keep the user-recorded knots exactly represented in the output as well.
  for (let i = 1; i < curve.knots.length - 1; i += 1) {
    const knotT = curve.knots[i];
    const sampleIndex = dense.findIndex(sample => Math.abs(sample.t - knotT) < 1e-9);
    if (sampleIndex >= 0) {
      anchorDistances.push(lengths[sampleIndex]);
      entries.push({ distance: lengths[sampleIndex], point: dense[sampleIndex].point });
    }
  }
  for (let distance = 0; distance < totalLength; distance += spacing) {
    if (!anchorDistances.some(anchor => Math.abs(anchor - distance) < spacing * 0.1)) {
      entries.push({ distance, point: interpolateAt(dense, lengths, distance) });
    }
  }
  entries.push({ distance: totalLength, point: interpolateAt(dense, lengths, totalLength) });
  for (let i = 1; i < dense.length; i += 1) {
    if (distance3(dense[i - 1].point, dense[i].point) < 1e-10) {
      entries.push({ distance: lengths[i], point: dense[i].point });
    }
  }
  entries.sort((a, b) => a.distance - b.distance);
  const sampled = [];
  for (const entry of entries) {
    const previous = sampled[sampled.length - 1];
    if (!previous || AXES.some(axis => Math.abs(previous[axis] - entry.point[axis]) > 1e-9)) {
      sampled.push(entry.point);
    }
  }
  return { points: sampled, length: totalLength };
}

export function getToolDirection(cDegrees, aDegrees, reverseC = false, reverseA = false) {
  // Verify angle signs and torch offset against the actual machine kinematics before production use.
  const c = (Number(cDegrees) * (reverseC ? -1 : 1)) * Math.PI / 180;
  const a = (Number(aDegrees) * (reverseA ? -1 : 1)) * Math.PI / 180;
  return {
    x: -Math.sin(a) * Math.cos(c),
    y: -Math.sin(a) * Math.sin(c),
    z: -Math.cos(a)
  };
}

export { AXES };
