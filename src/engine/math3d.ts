// 三维向量/几何基础 —— 船体坐标与水平(水面)坐标变换
import type { Vec3 } from '../types';

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  len: (a: Vec3): number => Math.hypot(a.x, a.y, a.z),
};

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** 纵倾角(弧度): 尾吃水>首吃水时为正(艏倾向上) */
export function trimAngleRad(draftAft: number, draftFwd: number, loa: number): number {
  return Math.atan2(draftAft - draftFwd, loa);
}

/**
 * 船体坐标 -> 水平(水面)坐标。船 x 轴相对水面上仰 τ(船首抬升时 τ>0):
 *   船 x 轴 -> (cosτ, 0, +sinτ); 船 z 轴 -> (-sinτ, 0, cosτ)
 * 绕 AP 龙骨点旋转, 再平移使水线(船尾处高 dA)落在 z_w=0。
 */
export function shipToWater(p: Vec3, tau: number, draftAft: number): Vec3 {
  const c = Math.cos(tau);
  const s = Math.sin(tau);
  return {
    x: p.x * c - p.z * s,
    y: p.y,
    z: p.x * s + p.z * c - draftAft * c,
  };
}

/** 水平面上方位角(0=船首, 顺时针/右舷为正)对应的水平单位方向 */
export function azimuthDir(azDeg: number): { x: number; y: number } {
  const a = azDeg * DEG2RAD;
  // 船体 y+ 为左舷, 右舷方向 y 为负
  return { x: Math.cos(a), y: -Math.sin(a) };
}

/** 水平坐标点相对眼位的方位角(度, 0..360) */
export function azimuthOf(dx: number, dy: number): number {
  // dy: 船体坐标 y(左舷为正); 方位顺时针 => az = atan2(-dy, dx)
  let a = Math.atan2(-dy, dx) * RAD2DEG;
  if (a < 0) a += 360;
  return a;
}

/** 角度归一化到 0..360 */
export function norm360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** 角差(度)归一化到 -180..180, b 相对 a */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export interface OBB {
  center: Vec3;
  /** 船体对齐的三个半轴长 */
  hx: number;
  hy: number;
  hz: number;
}

/**
 * 射线(水平坐标) vs 船体对齐盒(随纵倾成为 OBB) slab 求交。
 * 射线 origin + t*dir (dir 为水平单位向量, z=0)。
 * 返回 t 区间(仅 t>=0), 不相交返回 null。
 */
export function rayOBB(
  origin: Vec3,
  dir: { x: number; y: number },
  box: OBB,
  tau: number,
): { tNear: number; tFar: number } | null {
  const c = Math.cos(tau);
  const s = Math.sin(tau);
  // OBB 三轴(水面坐标): 船 x 轴 (c,0,+s), 船 y 轴 (0,1,0), 船 z 轴 (-s,0,c)
  const axes = [
    { ax: c, ay: 0, az: s, h: box.hx },
    { ax: 0, ay: 1, az: 0, h: box.hy },
    { ax: -s, ay: 0, az: c, h: box.hz },
  ];
  const ox = origin.x - box.center.x;
  const oy = origin.y - box.center.y;
  const oz = origin.z - box.center.z;
  const dx = dir.x;
  const dy = dir.y;
  let tMin = 0;
  let tMax = Infinity;
  for (const { ax, ay, az, h } of axes) {
    const e = ax * ox + ay * oy + az * oz; // 原点在轴上的相对坐标
    const f = ax * dx + ay * dy; // 方向在轴上的投影
    if (Math.abs(f) < 1e-12) {
      if (-e - h > 0 || -e + h < 0) return null; // 射线平行且在 slab 外
    } else {
      let t1 = (-e - h) / f;
      let t2 = (-e + h) / f;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return null;
    }
  }
  if (tMax < 0) return null;
  return { tNear: Math.max(0, tMin), tFar: tMax };
}
