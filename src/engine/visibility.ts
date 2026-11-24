// 视域求解核心 —— 逐方位角纵剖面切线法(解析几何, 非深度缓冲)
//
// 原理: 对每个方位角取过眼位的垂直平面, 求每个遮挡盒(随纵倾成为 OBB)与该平面的
// 截面多边形。截面内离眼位最远的可见顶点决定视线切点:
//   眼高 h, 切点 (r_v, z_v) => 切点到眼位的水平距离 R = h*r_v / (h - z_v)
// 平吃水、箱顶为矩形远上角时退化为手算公式 R = h*d/(h-h0), 浮点级一致。
import type {
  Ship,
  EyePosition,
  AzimuthSample,
  BlindSector,
  SolasCheck,
  VisibilityResult,
  ObstructionKind,
  Vec3,
} from '../types';
import {
  shipToWater,
  trimAngleRad,
  norm360,
  DEG2RAD,
} from './math3d';
import type { ColumnBox } from './stowage';

export interface SceneBox {
  id: string;
  kind: ObstructionKind | 'container';
  min: Vec3;
  max: Vec3;
  cellKey?: string;
}

interface WaterBox {
  id: string;
  kind: SceneBox['kind'];
  cellKey?: string;
  corners: Vec3[]; // 8 角点(水面坐标)
  edges: [number, number][]; // 12 条棱
  cx: number;
  cy: number;
  footprintRadius: number;
}

const BOX_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function toWaterBox(b: SceneBox, tau: number, draftAft: number): WaterBox {
  const { min, max } = b;
  const shipCorners: Vec3[] = [
    { x: min.x, y: min.y, z: min.z }, { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: max.y, z: min.z }, { x: min.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z }, { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: max.z }, { x: min.x, y: max.y, z: max.z },
  ];
  const corners = shipCorners.map((p) => shipToWater(p, tau, draftAft));
  const cx = corners.reduce((s, c) => s + c.x, 0) / 8;
  const cy = corners.reduce((s, c) => s + c.y, 0) / 8;
  let footprintRadius = 0;
  for (const c of corners) {
    footprintRadius = Math.max(footprintRadius, Math.hypot(c.x - cx, c.y - cy));
  }
  return { id: b.id, kind: b.kind, cellKey: b.cellKey, corners, edges: BOX_EDGES, cx, cy, footprintRadius };
}

/** 2D 射线 vs 矩形(水面投影)远交点距离; 用于求船舷边缘距离 */
function rayRectExit(
  ox: number, oy: number, dx: number, dy: number,
  xmin: number, xmax: number, ymin: number, ymax: number,
): number {
  let tMin = 0;
  let tMax = Infinity;
  const slabs: [number, number, number, number][] = [
    [ox, dx, xmin, xmax], [oy, dy, ymin, ymax],
  ];
  for (const [o, d, lo, hi] of slabs) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return 0;
    } else {
      const t1 = (lo - o) / d;
      const t2 = (hi - o) / d;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
    }
  }
  return tMax === Infinity ? 0 : Math.max(0, tMax);
}

/**
 * 视线越过船体顶边的水平距离(自眼位)。
 * 船首顶边点 (loa, z=干舷甲板高) 经纵倾旋转后的水面坐标, 投影到视线方向。
 * 侧向(az≠0)船舷边先碰到时由 2D 矩形远交点给出, 取两者较小值。
 */
function hullEdgeDistance(
  ship: Ship,
  eye: Vec3,
  tau: number,
  dx: number, dy: number,
): number {
  const c = Math.cos(tau);
  const s = Math.sin(tau);
  const deckZ = Math.max((ship.draftAft + ship.draftFwd) / 2 + 2.5, ship.depth - 4);
  // 船首顶边(中纵剖面)的水面坐标
  const bowX = ship.loa * c - deckZ * s;
  // 过眼位视线(方位角)与船首垂直面 x_w = bowX 的交点距离
  let topEdge = Infinity;
  if (dx > 1e-9) {
    const t = (bowX - eye.x) / dx;
    if (t > 0) {
      const yAt = eye.y + t * dy;
      if (Math.abs(yAt) <= ship.beam / 2 + 1e-6) topEdge = t;
    }
  }
  // 侧向: 2D 矩形(船体水面投影)远交点
  const rect = rayRectExit(
    eye.x, eye.y, dx, dy,
    0, ship.loa * c, -ship.beam / 2, ship.beam / 2,
  );
  return Math.min(topEdge, rect);
}

interface BoxAngle {
  center: number;
  half: number;
}

interface AzSolve {
  rEye: number;
  fullBlind: boolean;
  id: string | null;
  kind: SceneBox['kind'] | null;
  cellKey: string | null;
}
/** 单方位角: 对所有候选盒求截面切线, 返回最远切点距离(自眼位) */
function solveBoxesAtAz(
  boxes: WaterBox[],
  boxAngles: BoxAngle[],
  eye: Vec3,
  a: number,
  dx: number, dy: number,
  nx: number, ny: number,
  plane: number,
): AzSolve {
  const h = eye.z;
  let worstREye = 0;
  let worstId: string | null = null;
  let worstKind: SceneBox['kind'] | null = null;
  let worstCellKey: string | null = null;

  for (let bi = 0; bi < boxes.length; bi++) {
    const ba = boxAngles[bi];
    const da = Math.atan2(Math.sin(a - ba.center), Math.cos(a - ba.center));
    if (Math.abs(da) > ba.half + 1e-9) continue;
    const b = boxes[bi];

    // 眼位三维上处于船体盒内部(驾驶台建在主船体盒之上时不该发生; 若盒包到眼位则该盒是观察平台): 跳过
    if (b.kind === 'hull') {
      const xs = b.corners.map((c) => c.x);
      const ys = b.corners.map((c) => c.y);
      const zs = b.corners.map((c) => c.z);
      const inside3D =
        eye.x >= Math.min(...xs) - 1e-6 && eye.x <= Math.max(...xs) + 1e-6 &&
        eye.y >= Math.min(...ys) - 1e-6 && eye.y <= Math.max(...ys) + 1e-6 &&
        eye.z >= Math.min(...zs) - 1e-6 && eye.z <= Math.max(...zs) + 1e-6;
      if (inside3D) continue;
    }

    let minDepression = Infinity; // 上切线: 所有截面顶点中最小的俯角正切 (h-z_v)/r_v
    let aboveEye = false;
    for (const [i0, i1] of b.edges) {
      const A = b.corners[i0];
      const B = b.corners[i1];
      const ex = B.x - A.x;
      const ey = B.y - A.y;
      const ez = B.z - A.z;
      const denom = nx * ex + ny * ey;
      if (Math.abs(denom) < 1e-12) continue;
      const t = (plane - (nx * A.x + ny * A.y)) / denom;
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      const px = A.x + t * ex;
      const py = A.y + t * ey;
      const pz = A.z + t * ez;
      const r = (px - eye.x) * dx + (py - eye.y) * dy;
      if (r <= 1e-6) continue; // 眼后方交点不算
      if (pz >= eye.z - 1e-9) {
        aboveEye = true;
        continue;
      }
      // 上切线条件: 线上方无多边形点 => 俯角正切(眼位相对高度/水平距)取各顶点最小值
      const depression = (eye.z - pz) / r;
      if (depression < minDepression) {
        minDepression = depression;
      }
    }
    if (aboveEye) {
      return { rEye: Infinity, fullBlind: true, id: b.id, kind: b.kind, cellKey: b.cellKey ?? null };
    }
    if (!Number.isFinite(minDepression) || minDepression <= 1e-12) continue;
    const rEye = h / minDepression;
    if (rEye > worstREye) {
      worstREye = rEye;
      worstId = b.id;
      worstKind = b.kind;
      worstCellKey = b.cellKey ?? null;
    }
  }
  return { rEye: worstREye, fullBlind: false, id: worstId, kind: worstKind, cellKey: worstCellKey };
}

function angleInArc(az: number, from: number, to: number): boolean {
  const a = norm360(az);
  const f = norm360(from);
  const t = norm360(to);
  if (f <= t) return a >= f && a <= t;
  return a >= f || a <= t; // 跨 0°
}

function solveOneEye(
  ship: Ship,
  boxes: WaterBox[],
  eyeDef: EyePosition,
  stepDeg: number,
): AzimuthSample[] {
  const tau = trimAngleRad(ship.draftAft, ship.draftFwd, ship.loa);
  const eye = shipToWater(eyeDef.pos, tau, ship.draftAft);
  const count = Math.round(360 / stepDeg);
  const samples: AzimuthSample[] = new Array(count);

  const boxAngles: BoxAngle[] = boxes.map((b) => {
    const dxc = b.cx - eye.x;
    const dyc = b.cy - eye.y;
    const dc = Math.hypot(dxc, dyc);
    const half = dc > 1e-6 ? Math.asin(Math.min(1, b.footprintRadius / dc)) : Math.PI;
    return { center: Math.atan2(-dyc, dxc), half };
  });

  for (let i = 0; i < count; i++) {
    const az = i * stepDeg;
    const a = az * DEG2RAD;
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const nx = -dy;
    const ny = dx;
    const plane = nx * eye.x + ny * eye.y;

    const res = solveBoxesAtAz(boxes, boxAngles, eye, a, dx, dy, nx, ny, plane);
    const hullEdge = hullEdgeDistance(ship, eye, tau, dx, dy);
    const mullion = eyeDef.mullions.some((m) => angleInArc(az, m.azFrom, m.azTo));
    // SOLAS 水面盲区: 视线切点延伸到船体边距之外, 舷外水面才被挡。
    // 工程阈值 BLIND_THRESHOLD: 舷外延伸不足 1m 的擦边遮挡不计盲区(PSC 实操口径, 也吸收采样量化)。
    const BLIND_THRESHOLD = 1.0;
    const overhang = res.rEye - hullEdge;
    const beyondHull = overhang > BLIND_THRESHOLD;
    const reported = Math.max(0, overhang);

    if (res.fullBlind || mullion) {
      samples[i] = {
        azimuth: az,
        blindDistance: Infinity,
        blockerId: res.fullBlind ? res.id : null,
        blockerKind: res.fullBlind ? res.kind : null,
        mullionBlocked: mullion,
        grazingCellKey: res.fullBlind ? res.cellKey : null,
      };
    } else {
      samples[i] = {
        azimuth: az,
        blindDistance: beyondHull ? reported : 0,
        blockerId: beyondHull ? res.id : null,
        blockerKind: beyondHull ? res.kind : null,
        mullionBlocked: false,
        grazingCellKey: beyondHull ? res.cellKey : null,
      };
    }
  }
  return samples;
}

/** 多眼位合并: 同方位取最小盲区(两人分站左右时视线合并); 竖梃仅当所有眼位都被挡才算盲 */
function mergeEyes(perEye: AzimuthSample[][]): AzimuthSample[] {
  const n = perEye[0].length;
  const out: AzimuthSample[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let best = perEye[0][i];
    for (let k = 1; k < perEye.length; k++) {
      if (perEye[k][i].blindDistance < best.blindDistance) best = perEye[k][i];
    }
    const mullion = perEye.every((s) => s[i].mullionBlocked);
    out[i] = mullion
      ? { ...best, mullionBlocked: true, blindDistance: Infinity, blockerId: best.blockerId, blockerKind: best.blockerKind }
      : { ...best, mullionBlocked: false };
  }
  return out;
}

/** 盲区扇形识别(支持 360° 首尾相接)。
 * 船体固有盲区豁免角度判项; SOLAS V/22 的 10°/20° 只考核前向半弧(270°..360°..90°),
 * 侧向(90°..270°)盲区仅展示不判角度。 */
export function identifySectors(samples: AzimuthSample[], stepDeg: number): BlindSector[] {
  const isBlind = (s: AzimuthSample) =>
    s.mullionBlocked || !Number.isFinite(s.blindDistance) || s.blindDistance > 1.0;
  const isForward = (az: number) => az <= 90 + 1e-6 || az >= 270 - 1e-6;
  const n = samples.length;
  const sectors: BlindSector[] = [];
  const marked = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (marked[i] || !isBlind(samples[i])) continue;
    let start = i;
    let guard = 0;
    while (guard++ < n && isBlind(samples[(start - 1 + n) % n]) && !marked[(start - 1 + n) % n]) {
      start = (start - 1 + n) % n;
    }
    const idxs: number[] = [];
    let j = start;
    while (!marked[j] && isBlind(samples[j])) {
      marked[j] = true;
      idxs.push(j);
      j = (j + 1) % n;
      if (j === start) break;
    }
    if (idxs.length === n) {
      sectors.push({ azFrom: 0, azTo: 360, angleDeg: 360, maxBlindDistance: Infinity, blockerIds: [] });
      break;
    }
    const azFrom = samples[idxs[0]].azimuth;
    const azToRaw = samples[idxs[idxs.length - 1]].azimuth + stepDeg;
    let maxD = 0;
    const ids = new Set<string>();
    let hullOnly = true;
    let hasForward = false;
    let forwardBlindSteps = 0;
    for (const k of idxs) {
      const s = samples[k];
      if (Number.isFinite(s.blindDistance)) maxD = Math.max(maxD, s.blindDistance);
      else maxD = Infinity;
      if (s.blockerId) {
        ids.add(s.blockerId);
        if (s.blockerKind !== 'hull') hullOnly = false;
      }
      if (s.mullionBlocked) hullOnly = false;
      if (isForward(s.azimuth)) {
        hasForward = true;
        if (s.blockerKind !== 'hull' && !s.mullionBlocked) forwardBlindSteps++;
        if (s.mullionBlocked) forwardBlindSteps++;
      }
    }
    const sector: BlindSector = {
      azFrom,
      azTo: Math.min(360, azToRaw),
      // 角度判项只计前向部分的货物/竖梃盲步; 纯侧向或纯船体固有扇形角度记 0(豁免)
      angleDeg: hullOnly || !hasForward ? 0 : forwardBlindSteps * stepDeg,
      maxBlindDistance: maxD,
      blockerIds: [...ids],
      hullInherent: hullOnly,
    };
    sectors.push(sector);
  }
  return sectors.sort((a, b) => a.azFrom - b.azFrom);
}

function buildChecks(ship: Ship, samples: AzimuthSample[], sectors: BlindSector[]): SolasCheck[] {
  const checks: SolasCheck[] = [];
  const distLimit = Math.min(2 * ship.loa, 500);

  // 1. 船首盲区距离(自船首起算, PSC 通行口径)
  const bow = samples[0];
  const bowD = bow.blindDistance;
  checks.push({
    id: 'solas-distance',
    label: '船首前方盲区距离',
    regulation: 'SOLAS V/22: 不超过 2 倍船长或 500 m(取小者)',
    passed: bowD <= distLimit,
    actual: Number.isFinite(bowD) ? `${bowD.toFixed(1)} m` : '全盲(遮挡物高于眼位)',
    limit: `≤ ${distLimit} m`,
    detail: '距离自船首前缘起算; 极坐标图按自眼位半径绘制',
  });

  // 2. 单个扇形 ≤10°
  const maxSector = sectors.reduce((m, s) => Math.max(m, s.angleDeg), 0);
  checks.push({
    id: 'solas-single-sector',
    label: '单个盲区扇形角度',
    regulation: 'SOLAS V/22: 每一盲区扇形不超过 10°',
    passed: maxSector <= 10 + 1e-6,
    actual: `${maxSector.toFixed(2)}°`,
    limit: '≤ 10°',
    detail: '货物、绑扎设备等造成的独立盲区扇形',
  });

  // 3. 前向半弧盲区总和 ≤20°(排除船体固有盲区)
  const forward = samples.filter((s) => s.azimuth <= 90 + 1e-6 || s.azimuth >= 270 - 1e-6);
  const blindCount = forward.filter(
    (s) =>
      (s.mullionBlocked || !Number.isFinite(s.blindDistance) || s.blindDistance > 1.0) &&
      s.blockerKind !== 'hull',
  ).length;
  const totalArc = (blindCount / forward.length) * 180;
  checks.push({
    id: 'solas-total-arc',
    label: '前向盲区扇形总和',
    regulation: 'SOLAS V/22: 前向半弧内盲区总角度不超过 20°',
    passed: totalArc <= 20 + 1e-6,
    actual: `${totalArc.toFixed(2)}°`,
    limit: '≤ 20°',
    detail: '船首左右各 90° 范围统计',
  });

  // 4. 清晰扇形间隔 ≥5°(MSC/Circ.1149 建议)
  const realSectors = sectors.filter((s) => s.angleDeg < 360);
  let minGap = 360;
  for (let i = 0; i < realSectors.length; i++) {
    const cur = realSectors[i];
    const next = realSectors[(i + 1) % realSectors.length];
    const gap = i === realSectors.length - 1
      ? 360 - cur.azTo + next.azFrom
      : next.azFrom - cur.azTo;
    minGap = Math.min(minGap, gap);
  }
  checks.push({
    id: 'solas-clear-gap',
    label: '盲区之间清晰扇形',
    regulation: 'MSC/Circ.1149 建议: 相邻盲区间清晰扇形 ≥ 5°',
    passed: realSectors.length <= 1 || minGap >= 5 - 1e-6,
    actual: realSectors.length <= 1 ? '无相邻盲区' : `${minGap.toFixed(2)}°`,
    limit: '≥ 5°',
    detail: '指导性质, PSC 可作观察项',
  });

  return checks;
}

export interface SolveOptions {
  stepDeg?: number;
  eyeIds?: string[];
}

/** 主求解入口 */
export function solveVisibility(
  ship: Ship,
  sceneBoxes: SceneBox[],
  opts: SolveOptions = {},
): VisibilityResult {
  const t0 = performance.now();
  const stepDeg = opts.stepDeg ?? 0.25;
  const tau = trimAngleRad(ship.draftAft, ship.draftFwd, ship.loa);
  const wBoxes = sceneBoxes.map((b) => toWaterBox(b, tau, ship.draftAft));

  const eyes = opts.eyeIds && opts.eyeIds.length
    ? ship.eyePositions.filter((e) => opts.eyeIds!.includes(e.id))
    : ship.eyePositions;

  const perEye = eyes.map((eye) => solveOneEye(ship, wBoxes, eye, stepDeg));
  const samples = perEye.length === 1 ? perEye[0] : mergeEyes(perEye);
  const sectors = identifySectors(samples, stepDeg);
  const checks = buildChecks(ship, samples, sectors);

  const bowBlind = samples[0].blindDistance;
  const forward = samples.filter((s) => s.azimuth <= 90 + 1e-6 || s.azimuth >= 270 - 1e-6);
  const totalBlindArc = (forward.filter(
    (s) =>
      (s.mullionBlocked || !Number.isFinite(s.blindDistance) || s.blindDistance > 1.0) &&
      s.blockerKind !== 'hull',
  ).length / forward.length) * 180;

  return {
    eyeId: eyes.map((e) => e.id).join('+'),
    eyeName: eyes.map((e) => e.name).join(' + '),
    stepDeg,
    samples,
    sectors,
    bowBlindDistance: bowBlind,
    totalBlindArcDeg: totalBlindArc,
    checks,
    elapsedMs: performance.now() - t0,
  };
}

/** 组装场景盒: 船体(主船体到干舷甲板 + 艏楼) + 固定遮挡物 + 集装箱列 */
export function assembleSceneBoxes(ship: Ship, columns: ColumnBox[]): SceneBox[] {
  const boxes: SceneBox[] = [];
  // 主船体: 干舷甲板高度取 max(平均吃水+2.5, 型深-4), 保证驾驶台/舱盖始终在其上方
  const deckZ = Math.max((ship.draftAft + ship.draftFwd) / 2 + 2.5, ship.depth - 4);
  boxes.push({
    id: 'hull-main',
    kind: 'hull',
    min: { x: 0, y: -ship.beam / 2, z: 0 },
    max: { x: ship.loa, y: ship.beam / 2, z: deckZ },
  });
  if (ship.forecastleHeight > 0) {
    // 艏楼: 船首 18% 长度, 从主甲板(deckZ)向上到艏楼甲板 forecastleHeight
    const deckZ0 = Math.max((ship.draftAft + ship.draftFwd) / 2 + 2.5, ship.depth - 4);
    boxes.push({
      id: 'hull-forecastle',
      kind: 'hull',
      min: { x: ship.loa * 0.82, y: -ship.beam / 2, z: deckZ0 },
      max: { x: ship.loa, y: ship.beam / 2, z: Math.max(ship.forecastleHeight, deckZ0 + 0.5) },
    });
  }
  for (const o of ship.obstructions) {
    boxes.push({ id: o.id, kind: o.kind, min: o.min, max: o.max });
  }
  for (const c of columns) {
    boxes.push({
      id: `col-${c.slot}-${c.row}`,
      kind: 'container',
      min: c.min,
      max: c.max,
      cellKey: c.topCellKey,
    });
  }
  return boxes;
}
