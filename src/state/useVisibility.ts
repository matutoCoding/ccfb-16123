// 视域计算 hook: 船+配载+眼位选择 -> 场景盒 -> 求解, 输入变化自动重算
import { useMemo, useState } from 'react';
import type { Ship, StowagePlan, LoweringSuggestion } from '../types';
import { buildColumnBoxes } from '../engine/stowage';
import { assembleSceneBoxes, solveVisibility } from '../engine/visibility';
import { generateSuggestions } from '../engine/suggest';

export function useVisibility(ship: Ship | null, plan: StowagePlan | null, eyeIds: string[], stepDeg = 0.25) {
  const [suggestions, setSuggestions] = useState<LoweringSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  const { result, columns, sceneBoxes } = useMemo(() => {
    if (!ship) return { result: null, columns: [], sceneBoxes: [] };
    const cols = buildColumnBoxes(ship, plan?.cells ?? []);
    const boxes = assembleSceneBoxes(ship, cols);
    const res = solveVisibility(ship, boxes, { stepDeg, eyeIds: eyeIds.length ? eyeIds : undefined });
    return { result: res, columns: cols, sceneBoxes: boxes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ship, plan, JSON.stringify(eyeIds), stepDeg]);

  const runSuggestions = async () => {
    if (!ship || !plan || !result) return;
    setSuggesting(true);
    // 让 UI 先进入 loading
    await new Promise((r) => setTimeout(r, 10));
    const s = generateSuggestions(ship, plan.cells, result, { eyeIds: eyeIds.length ? eyeIds : undefined });
    setSuggestions(s);
    setSuggesting(false);
  };

  return { result, columns, sceneBoxes, suggestions, suggesting, runSuggestions, setSuggestions };
}
