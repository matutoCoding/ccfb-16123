// 降层建议引擎: 枚举各箱列降一层的效果, 满足视域前提下尽量少动箱
import type { Ship, StowageCell, LoweringSuggestion, VisibilityResult } from '../types';
import { buildColumnBoxes, cellKey, rowY } from './stowage';
import { assembleSceneBoxes, solveVisibility, type SceneBox } from './visibility';

export interface SuggestionOptions {
  /** 粗扫步长(度), 用于候选排序 */
  coarseStepDeg?: number;
  /** 最终返回的最大建议条数 */
  maxResults?: number;
  eyeIds?: string[];
}

/** 对单个箱列做"降一层"试算(移除该列最顶部箱; 40尺箱跨两槽会被整体移除) */
function withTopRemoved(cells: StowageCell[], targetKey: string): StowageCell[] {
  return cells.filter((c) => cellKey(c.bay, c.row, c.tier) !== targetKey);
}

function quickSolve(ship: Ship, cells: StowageCell[], stepDeg: number, eyeIds?: string[]): VisibilityResult {
  const cols = buildColumnBoxes(ship, cells);
  const boxes: SceneBox[] = assembleSceneBoxes(ship, cols);
  return solveVisibility(ship, boxes, { stepDeg, eyeIds });
}

/**
 * 生成降层建议。
 * 策略: 对当前每个有甲板箱的列, 移除其顶部箱后粗扫; 取有改善的候选,
 * 再按"是否全合规 → 船首盲区改善量 → 移动箱量"排序, 精算前 N 条。
 */
export function generateSuggestions(
  ship: Ship,
  cells: StowageCell[],
  baseline: VisibilityResult,
  opts: SuggestionOptions = {},
): LoweringSuggestion[] {
  const coarse = opts.coarseStepDeg ?? 1;
  const maxResults = opts.maxResults ?? 12;
  const baseBow = baseline.bowBlindDistance;
  const baseMaxSector = baseline.sectors.reduce((m, s) => Math.max(m, s.angleDeg), 0);
  const allPass = baseline.checks.every((c) => c.passed);

  // 候选: 每列顶部箱(去重, 40尺箱在两槽中出现两次)
  const cols = buildColumnBoxes(ship, cells);
  const seen = new Set<string>();
  const candidates = cols
    .map((c) => ({ key: c.topCellKey, slot: c.slot, row: c.row, tier: c.topTier, topZ: c.max.z }))
    .filter((c) => {
      if (seen.has(c.key)) return false;
      seen.add(c.key);
      return true;
    });

  interface Ranked extends LoweringSuggestion {
    coarsePass: boolean;
  }
  const ranked: Ranked[] = [];

  for (const cand of candidates) {
    const trial = withTopRemoved(cells, cand.key);
    const r = quickSolve(ship, trial, coarse, opts.eyeIds);
    const bow = r.bowBlindDistance;
    const maxSector = r.sectors.reduce((m, s) => Math.max(m, s.angleDeg), 0);
    const improvement = (Number.isFinite(baseBow) ? baseBow : 1e6) - (Number.isFinite(bow) ? bow : 1e6);
    if (improvement <= 0.05 && maxSector >= baseMaxSector - 0.01) continue;
    const moved = trial.length !== cells.length ? cells.length - trial.length : 1;
    ranked.push({
      cellKey: cand.key,
      bay: cols.find((c) => c.topCellKey === cand.key)?.slot ?? cand.slot,
      row: cand.row,
      tier: cand.tier,
      currentTopZ: cand.topZ,
      proposedTopZ: cand.topZ - ship.tierHeight,
      containersMoved: moved,
      projectedBowBlind: bow,
      projectedMaxSectorDeg: maxSector,
      projectedPass: r.checks.every((c) => c.passed),
      improvementM: improvement,
      coarsePass: r.checks.every((c) => c.passed),
    });
  }

  // 排序: 合规优先, 然后改善量大, 然后动箱少
  ranked.sort((a, b) => {
    if (a.projectedPass !== b.projectedPass) return a.projectedPass ? -1 : 1;
    if (Math.abs(b.improvementM - a.improvementM) > 0.5) return b.improvementM - a.improvementM;
    return a.containersMoved - b.containersMoved;
  });

  // 已经全部合规时, 只保留零建议(无需动箱)
  if (allPass) return [];

  // 对粗排前 N 做精算(0.25°)
  const top = ranked.slice(0, maxResults);
  return top.map((s) => {
    const trial = withTopRemoved(cells, s.cellKey);
    const fine = quickSolve(ship, trial, 0.25, opts.eyeIds);
    return {
      ...s,
      projectedBowBlind: fine.bowBlindDistance,
      projectedMaxSectorDeg: fine.sectors.reduce((m, x) => Math.max(m, x.angleDeg), 0),
      projectedPass: fine.checks.every((c) => c.passed),
      bay: s.bay,
    };
  });
}

/** 单列降一层试算(点击三维中箱列时调用, 全精度) */
export function evaluateSingleLowering(
  ship: Ship,
  cells: StowageCell[],
  cellKeyToLower: string,
  eyeIds?: string[],
): { result: VisibilityResult; nextCells: StowageCell[] } {
  const nextCells = withTopRemoved(cells, cellKeyToLower);
  const result = quickSolve(ship, nextCells, 0.25, eyeIds);
  return { result, nextCells };
}

/** 将建议回写到配载: 移除建议中的顶部箱 */
export function applySuggestions(cells: StowageCell[], suggestions: LoweringSuggestion[]): StowageCell[] {
  const keys = new Set(suggestions.map((s) => s.cellKey));
  return cells.filter((c) => !keys.has(cellKey(c.bay, c.row, c.tier)));
}

export interface GroupPlan {
  /** 需要移除的箱(完整 cell) */
  removedCells: StowageCell[];
  movedCount: number;
  projected: VisibilityResult;
  pass: boolean;
  /** 被清空的外侧 row 编号列表 */
  clearedRows: number[];
}

/**
 * 成组降层: 当单箱降层无法收敛(典型: 外侧 row 堆满造成宽扇形),
 * 按 row 距中纵剖面由远到近成批清空外侧列, 找首个合规方案。
 * 用 1° 粗扫保证速度; 返回 null 表示清空到中央仍不合规。
 */
export function planGroupLowering(
  ship: Ship,
  cells: StowageCell[],
  eyeIds?: string[],
): GroupPlan | null {
  const totalRows = ship.rowCount * 2;
  // row 按 |y| 降序(最外侧先清)
  const orderedRows = [...Array.from({ length: totalRows }, (_, i) => i + 1)].sort(
    (a, b) => Math.abs(rowY(ship, b)) - Math.abs(rowY(ship, a)),
  );
  let working = cells;
  const cleared: number[] = [];
  // 每次清一对对称 row(左/右), 最多清到只剩中央 1/3
  const stopAt = Math.round(totalRows * 0.34);
  for (let i = 0; i < orderedRows.length; i += 2) {
    const pair = orderedRows.slice(i, i + 2);
    cleared.push(...pair);
    const keep = new Set(pair);
    working = working.filter((c) => !keep.has(c.row));
    const r = quickSolve(ship, working, 1, eyeIds);
    if (r.checks.every((c) => c.passed)) {
      // 精算复核
      const fine = quickSolve(ship, working, 0.25, eyeIds);
      const removed = cells.filter((c) => !working.includes(c));
      return {
        removedCells: removed,
        movedCount: removed.length,
        projected: fine,
        pass: fine.checks.every((c) => c.passed),
        clearedRows: cleared,
      };
    }
    if (totalRows - cleared.length <= stopAt) break;
  }
  return null;
}
