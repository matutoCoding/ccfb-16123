// 配载几何: 把集装箱按 (bay 槽, row) 合并为遮挡用 AABB 列; bay 位文本导入
import type { Ship, StowageCell, Container, Vec3 } from '../types';

export interface ColumnBox {
  /** 20尺槽序号(内部 0..bayCount-1) */
  slot: number;
  row: number;
  min: Vec3;
  max: Vec3;
  /** 顶部箱的 cell key, 用于擦边高亮 */
  topCellKey: string;
  topTier: number;
}

export const cellKey = (bay: number, row: number, tier: number): string =>
  `${bay}-${row}-${tier}`;

/** 展示用 bay 编号(偶数=20尺槽): 槽 i -> 02,04,06... */
export function slotToBayNo(slot: number): number {
  return slot * 2 + 2;
}
/** 40尺箱所在奇数 bay -> 两个 20尺槽序号 */
export function bayNoToSlots(bayNo: number, size: Container['size']): number[] {
  if (size === 'TEU40') {
    const centerSlot = (bayNo - 1) / 2; // 奇数 bay 03 -> 槽 1
    return [centerSlot - 1, centerSlot];
  }
  return [(bayNo - 2) / 2];
}

/**
 * 槽中心 x(船体坐标)。
 * 集装箱船 bay 区位于驾驶台前方、艏楼后方: 槽 0 最靠近驾驶台, 槽号增大向船首排列,
 * 最前槽远端不超过船首的 82%(留艏楼位置)。
 */
export function slotCenterX(ship: Ship, slot: number): number {
  const bowLimit = ship.loa * 0.82;
  const totalLen = ship.bayCount * ship.bayPitch;
  const startX = bowLimit - totalLen; // 第一槽近端
  return startX + (slot + 0.5) * ship.bayPitch;
}

/** row 编号(01,02..) -> 横向 y; 奇数左舷(+y), 偶数右舷(-y) */
export function rowY(ship: Ship, row: number): number {
  const idx = Math.ceil(row / 2); // 1,1,2,2...
  const mag = (idx - 0.5) * ship.rowPitch;
  return row % 2 === 1 ? mag : -mag;
}

interface TierBox {
  z0: number;
  z1: number;
  tier: number;
  key: string;
  size: Container['size'];
}

/**
 * 由配载构建遮挡箱列(仅甲板上 tier>=80 参与视域遮挡)。
 * 同一 (slot,row) 上连续层合并为一个 AABB; 40尺箱同时进入两个相邻槽。
 */
export function buildColumnBoxes(ship: Ship, cells: StowageCell[]): ColumnBox[] {
  // map: slot -> row -> tier boxes
  const grid = new Map<number, Map<number, TierBox[]>>();
  const addBox = (slot: number, row: number, tb: TierBox) => {
    let m = grid.get(slot);
    if (!m) {
      m = new Map();
      grid.set(slot, m);
    }
    const arr = m.get(row);
    if (arr) arr.push(tb);
    else m.set(row, [tb]);
  };

  for (const c of cells) {
    if (c.tier < 80) continue; // 舱内不挡视线
    const tierIdx = (c.tier - 82) / 2; // 82->0, 84->1
    const h = c.container.type === 'highcube' ? ship.hcTierHeight : ship.tierHeight;
    const z0 = ship.hatchTopZ + tierIdx * ship.tierHeight; // 层高差按标准距, 高箱顶更高
    const z1 = z0 + h;
    const slots = bayNoToSlots(c.bay, c.container.size);
    const key = cellKey(c.bay, c.row, c.tier);
    for (const slot of slots) {
      if (slot < 0 || slot >= ship.bayCount) continue;
      addBox(slot, c.row, { z0, z1, tier: c.tier, key, size: c.container.size });
    }
  }

  const out: ColumnBox[] = [];
  for (const [slot, rowMap] of grid) {
    for (const [row, tierBoxes] of rowMap) {
      tierBoxes.sort((a, b) => a.z0 - b.z0);
      // 合并 z 向相接/重叠的连续段
      const runs: TierBox[][] = [];
      let run: TierBox[] = [];
      for (const tb of tierBoxes) {
        if (run.length === 0 || tb.z0 <= run[run.length - 1].z1 + 0.02) {
          run.push(tb);
        } else {
          runs.push(run);
          run = [tb];
        }
      }
      if (run.length) runs.push(run);
      const cx = slotCenterX(ship, slot);
      const cy = rowY(ship, row);
      // ISO 真实箱外尺寸(留出厂间隙, 视线可从 bay/row 间隙穿过):
      // 20 尺 6.058m, 40 尺 12.192m, 宽 2.438m
      const boxWid = 2.438;
      for (const r of runs) {
        const top = r[r.length - 1];
        const boxLen = top.size === 'TEU40' ? 12.192 : 6.058;
        out.push({
          slot,
          row,
          min: { x: cx - boxLen / 2, y: cy - boxWid / 2, z: r[0].z0 },
          max: { x: cx + boxLen / 2, y: cy + boxWid / 2, z: top.z1 },
          topCellKey: top.key,
          topTier: top.tier,
        });
      }
    }
  }
  return out;
}

/**
 * 解析配载软件导出的 bay 位文本。支持两种行格式(可混用, # 开头注释):
 *   BAY 03
 *   ROW 01 TIER 82 40HC DG 3
 *   ROW 02 TIER 84 20MT
 * 或 CSV: 03,01,82,40HC,DG,3
 * 尺寸类型 token: 20/20STD/20HC/20DG/20MT, 40/40STD/40HC/40DG/40MT
 */
export function parseBayText(text: string): { cells: StowageCell[]; errors: string[] } {
  const cells: StowageCell[] = [];
  const errors: string[] = [];
  let curBay: number | null = null;

  const parseToken = (tok: string): Container | null => {
    const t = tok.toUpperCase();
    const m = /^(20|40)(STD|HC|DG|MT)?$/.exec(t);
    if (!m) return null;
    const size: Container['size'] = m[1] === '20' ? 'TEU20' : 'TEU40';
    const suffix = m[2] ?? 'STD';
    if (suffix === 'HC') return { size, type: 'highcube' };
    if (suffix === 'MT') return { size, type: 'empty' };
    return { size, type: 'standard' };
  };

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    try {
      if (line.toUpperCase().startsWith('BAY')) {
        const m = /BAY\s+(\d+)/i.exec(line);
        if (!m) throw new Error('BAY 行格式错误');
        curBay = parseInt(m[1], 10);
        return;
      }
      if (line.toUpperCase().startsWith('ROW')) {
        if (curBay === null) throw new Error('ROW 行前缺少 BAY');
        const m = /ROW\s+(\d+)\s+TIER\s+(\d+)\s+(\S+)(?:\s+DG\s+([\d.]+))?/i.exec(line);
        if (!m) throw new Error('ROW 行格式错误');
        const row = parseInt(m[1], 10);
        const tier = parseInt(m[2], 10);
        const cont = parseToken(m[3]);
        if (!cont) throw new Error(`未知箱型 ${m[3]}`);
        if (/DG/i.test(m[3]) || m[4]) {
          cont.type = 'dangerous';
          cont.imdgClass = m[4] ?? '9';
        }
        cells.push({ bay: curBay, row, tier, container: cont });
        return;
      }
      // CSV 形式
      const parts = line.split(/[,\t;]+/).map((s) => s.trim());
      if (parts.length >= 4) {
        const bay = parseInt(parts[0], 10);
        const row = parseInt(parts[1], 10);
        const tier = parseInt(parts[2], 10);
        const cont = parseToken(parts[3]);
        if (!cont) throw new Error(`未知箱型 ${parts[3]}`);
        if ((parts[4] ?? '').toUpperCase() === 'DG' || parts[3].toUpperCase().includes('DG')) {
          cont.type = 'dangerous';
          cont.imdgClass = parts[5] ?? '9';
        }
        if ((parts[4] ?? '').toUpperCase() === 'MT') cont.type = 'empty';
        cells.push({ bay, row, tier, container: cont });
        return;
      }
      throw new Error('无法识别的行');
    } catch (e) {
      errors.push(`第 ${idx + 1} 行: ${(e as Error).message}`);
    }
  });
  return { cells, errors };
}

/** 导出 bay 位文本(供回写配载软件对账) */
export function toBayText(cells: StowageCell[]): string {
  const byBay = new Map<number, StowageCell[]>();
  for (const c of cells) {
    const arr = byBay.get(c.bay) ?? [];
    arr.push(c);
    byBay.set(c.bay, arr);
  }
  const lines: string[] = ['# BVS bay 位导出'];
  for (const bay of [...byBay.keys()].sort((a, b) => a - b)) {
    lines.push(`BAY ${String(bay).padStart(2, '0')}`);
    for (const c of byBay.get(bay)!.sort((a, b) => a.row - b.row || a.tier - b.tier)) {
      const sz = c.container.size === 'TEU20' ? '20' : '40';
      let suf = 'STD';
      if (c.container.type === 'highcube') suf = 'HC';
      if (c.container.type === 'empty') suf = 'MT';
      if (c.container.type === 'dangerous') suf = 'DG';
      const dg = c.container.type === 'dangerous' ? ` DG ${c.container.imdgClass ?? '9'}` : '';
      lines.push(`ROW ${String(c.row).padStart(2, '0')} TIER ${c.tier} ${sz}${suf}${dg}`);
    }
  }
  return lines.join('\n');
}
