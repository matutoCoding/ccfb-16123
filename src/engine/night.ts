// 夜航核查: 号灯(前桅灯等)与甲板照明被箱堆遮挡的方位判定
// 在船体坐标系内做 线段 vs AABB slab 求交(不涉及纵倾, 两端与盒同坐标架)
import type { Ship, Vec3, Obstruction } from '../types';
import type { ColumnBox } from './stowage';
import { azimuthOf } from './math3d';

export interface LightTarget {
  id: string;
  name: string;
  pos: Vec3;
}

export interface LightBlockResult {
  light: LightTarget;
  azimuth: number;
  blocked: boolean;
  blockerId: string | null;
  /** 遮挡发生位置(线段参数 t, 0=眼位 1=灯) */
  hitT: number | null;
}

interface BoxLike {
  id: string;
  min: Vec3;
  max: Vec3;
}

function segmentAABB(p0: Vec3, p1: Vec3, b: BoxLike): number | null {
  let tMin = 0;
  let tMax = 1;
  const d: Vec3 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
  const axes: ['x', 'y', 'z'] = ['x', 'y', 'z'];
  for (const ax of axes) {
    const o = p0[ax];
    const lo = b.min[ax];
    const hi = b.max[ax];
    if (Math.abs(d[ax]) < 1e-12) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d[ax];
      let t2 = (hi - o) / d[ax];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
  }
  return tMin;
}

/** 收集船上的号灯位置: 前桅灯取 foremast 顶部, 另可含桅顶灯 */
export function collectLights(ship: Ship): LightTarget[] {
  const lights: LightTarget[] = [];
  const mast = ship.obstructions.find((o) => o.kind === 'foremast');
  if (mast) {
    lights.push({
      id: 'light-foremast',
      name: '前桅灯(主桅顶灯)',
      pos: { x: (mast.min.x + mast.max.x) / 2, y: (mast.min.y + mast.max.y) / 2, z: mast.max.z + 1.5 },
    });
  }
  return lights;
}

/**
 * 从各眼位检查号灯可见性。任一眼位可见即视为驾驶台可见(两人瞭望)。
 * 遮挡物: 集装箱列 + 固定遮挡物(除前桅自身)。
 */
export function checkNavigationLights(
  ship: Ship,
  columns: ColumnBox[],
): LightBlockResult[] {
  const lights = collectLights(ship);
  const boxes: BoxLike[] = [
    ...columns.map<BoxLike>((c) => ({ id: `col-${c.slot}-${c.row}`, min: c.min, max: c.max })),
    ...ship.obstructions
      .filter((o: Obstruction) => o.kind !== 'foremast')
      .map<BoxLike>((o) => ({ id: o.id, min: o.min, max: o.max })),
  ];

  const out: LightBlockResult[] = [];
  for (const light of lights) {
    let anyVisible = false;
    let worst: { blockerId: string; hitT: number } | null = null;
    for (const eye of ship.eyePositions) {
      let blockedHere: { blockerId: string; hitT: number } | null = null;
      for (const b of boxes) {
        const t = segmentAABB(eye.pos, light.pos, b);
        if (t !== null && t >= 0 && t <= 1) {
          blockedHere = { blockerId: b.id, hitT: t };
          break;
        }
      }
      if (!blockedHere) {
        anyVisible = true;
        break;
      }
      worst = blockedHere;
    }
    const az = azimuthOf(light.pos.x - ship.eyePositions[0].pos.x, light.pos.y - ship.eyePositions[0].pos.y);
    out.push({
      light,
      azimuth: az,
      blocked: !anyVisible,
      blockerId: anyVisible ? null : worst?.blockerId ?? null,
      hitT: anyVisible ? null : worst?.hitT ?? null,
    });
  }
  return out;
}
