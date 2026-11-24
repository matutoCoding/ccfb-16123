// 页面 4: 视域核查 —— 眼位切换/双眼合并, SOLAS 判项, 极坐标, 三维联动, 降层建议, 夜航, 深度全景
import { useMemo, useState } from 'react';
import type { Ship, StowagePlan, LoweringSuggestion } from '../types';
import { useVisibility } from '../state/useVisibility';
import { PolarChart } from '../components/PolarChart';
import { View3D } from '../components/View3D';
import { sceneBoxToRender } from '../webgl/renderer';
import { cellKey, buildColumnBoxes } from '../engine/stowage';
import { evaluateSingleLowering, planGroupLowering, type GroupPlan } from '../engine/suggest';
import { checkNavigationLights } from '../engine/night';
import { assembleSceneBoxes, solveVisibility } from '../engine/visibility';
import type { SceneRenderer } from '../webgl/renderer';

export function VisibilityPage({ ship, plan, onApplyCells, onScreenshot }: {
  ship: Ship;
  plan: StowagePlan | null;
  onApplyCells: (cells: StowagePlan['cells']) => void;
  onScreenshot: (dataUrl: string) => void;
}) {
  const [selectedEyes, setSelectedEyes] = useState<string[]>(['eye-center', 'eye-port', 'eye-stbd']);
  const [nightMode, setNightMode] = useState(false);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [pickedEval, setPickedEval] = useState<{ bow: number; diff: number } | null>(null);
  const [showPanorama, setShowPanorama] = useState(false);
  const [panoUrl, setPanoUrl] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<SceneRenderer | null>(null);
  const [groupPlan, setGroupPlan] = useState<GroupPlan | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);

  const { result, columns, sceneBoxes, suggestions, suggesting, runSuggestions, setSuggestions } =
    useVisibility(ship, plan, selectedEyes, 0.25);

  const renderBoxes = useMemo(() => sceneBoxes.map(sceneBoxToRender), [sceneBoxes]);
  const distLimit = Math.min(2 * ship.loa, 500);
  const eyeId = selectedEyes[0] ?? null;

  const toggleEye = (id: string) => {
    setSelectedEyes((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPickedKey(null);
    setPickedEval(null);
  };

  const handlePick = (box: { id: string; cellKey?: string; kind: string } | null) => {
    if (!box || box.kind !== 'container' || !box.cellKey || !plan) return;
    setPickedKey(box.cellKey);
    const { result: after } = evaluateSingleLowering(ship, plan.cells, box.cellKey, selectedEyes);
    const before = result?.bowBlindDistance ?? Infinity;
    setPickedEval({
      bow: after.bowBlindDistance,
      diff: (Number.isFinite(before) ? before : 1e6) - (Number.isFinite(after.bowBlindDistance) ? after.bowBlindDistance : 1e6),
    });
  };

  const applySuggestion = (s: LoweringSuggestion) => {
    if (!plan) return;
    const next = plan.cells.filter((c) => cellKey(c.bay, c.row, c.tier) !== s.cellKey);
    onApplyCells(next);
    setSuggestions(suggestions.filter((x) => x.cellKey !== s.cellKey));
    setPickedKey(null);
  };

  const applyAllPass = () => {
    if (!plan || !suggestions.length) return;
    // 贪心: 依次应用能让方案合规的最少建议
    let cells = plan.cells;
    const chosen: LoweringSuggestion[] = [];
    for (const s of suggestions) {
      const trial = cells.filter((c) => cellKey(c.bay, c.row, c.tier) !== s.cellKey);
      const cols = buildColumnBoxes(ship, trial);
      const r = solveVisibility(ship, assembleSceneBoxes(ship, cols), { stepDeg: 0.5, eyeIds: selectedEyes });
      chosen.push(s);
      cells = trial;
      if (r.checks.every((c) => c.passed)) break;
    }
    onApplyCells(cells);
    setSuggestions([]);
    void chosen;
  };

  const runGroupPlan = async () => {
    if (!plan) return;
    setGroupBusy(true);
    await new Promise((r) => setTimeout(r, 10));
    const gp = planGroupLowering(ship, plan.cells, selectedEyes);
    setGroupPlan(gp);
    setGroupBusy(false);
  };

  const applyGroupPlan = () => {
    if (!plan || !groupPlan) return;
    const removeKeys = new Set(groupPlan.removedCells.map((c) => cellKey(c.bay, c.row, c.tier)));
    onApplyCells(plan.cells.filter((c) => !removeKeys.has(cellKey(c.bay, c.row, c.tier))));
    setGroupPlan(null);
  };

  const lightChecks = useMemo(() => checkNavigationLights(ship, columns), [ship, columns]);

  const takeShot = () => {
    if (renderer) onScreenshot(renderer.screenshot());
  };

  const renderPanorama = async () => {
    if (!renderer) return;
    // 通过截图式离屏渲染: 用主 GL 上下文创建全景器会争用, 这里用三维截图代替并展示深度说明
    setShowPanorama(true);
    const gl = (renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
    if (!gl) {
      setPanoUrl(renderer.screenshot());
      return;
    }
    const { PanoramaRenderer } = await import('../webgl/panorama');
    const p = new PanoramaRenderer(gl, 1024, 256);
    const eye = ship.eyePositions.find((e) => e.id === eyeId) ?? ship.eyePositions[0];
    const out = p.render(
      ship,
      eye.pos,
      sceneBoxes.map((b) => ({ min: b.min, max: b.max, color: sceneBoxToRender(b).color })),
      96,
    );
    setPanoUrl(out.dataUrl);
  };

  if (!result) return <div className="page muted">计算中…</div>;

  return (
    <div className="page grid" style={{ gridTemplateColumns: 'minmax(420px, 1.15fr) minmax(380px, 1fr)', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div className="panel">
          <div className="row-flex">
            <h2 style={{ margin: 0 }}>三维视域场景</h2>
            <div className="spacer" />
            <label className="row-flex" style={{ gap: 6 }}>
              <input type="checkbox" checked={nightMode} onChange={(e) => setNightMode(e.target.checked)} />
              夜航模式(号灯/甲板照明)
            </label>
            <button className="btn ghost small" onClick={renderPanorama}>深度全景</button>
            <button className="btn ghost small" onClick={takeShot}>三维截图</button>
          </div>
          <View3D
            ship={ship}
            boxes={renderBoxes}
            result={result}
            eyeId={eyeId}
            nightMode={nightMode}
            onPickBox={handlePick}
            selectedCellKey={pickedKey}
            registerRenderer={setRenderer}
          />
          {nightMode && (
            <div style={{ marginTop: 10 }}>
              <h3>号灯遮挡核查</h3>
              {lightChecks.map((l) => (
                <div key={l.light.id} className={`check-row ${l.blocked ? 'fail' : 'pass'}`}>
                  <span className={`badge ${l.blocked ? 'bad' : 'ok'}`}>{l.blocked ? '被遮挡' : '可见'}</span>
                  <div>
                    <div>{l.light.name}</div>
                    <div className="reg">方位 {l.azimuth.toFixed(1)}°{l.blocked ? ` · 遮挡物 ${l.blockerId}` : ''}</div>
                  </div>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 11 }}>
                夜航时甲板照明按低位漫射处理, 箱堆阴影在三维中以暗面呈现; 前桅灯若被挡, PSC 夜间检查可直接据此提示。
              </p>
            </div>
          )}
          {showPanorama && (
            <div style={{ marginTop: 10 }}>
              <h3>等距柱状深度全景(眼位一周, 近红远蓝)</h3>
              {panoUrl
                ? <img src={panoUrl} alt="深度全景" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
                : <div className="muted">渲染中…</div>}
            </div>
          )}
          {pickedKey && pickedEval && (
            <div className="panel" style={{ marginTop: 10, background: 'var(--bg-panel-2)' }}>
              <h3>箱列 {pickedKey} 降一层试算</h3>
              <div className="row-flex">
                <div className="stat"><span className="num">{Number.isFinite(pickedEval.bow) ? pickedEval.bow.toFixed(1) : '全盲'} m</span><span className="lbl">降后船首盲区</span></div>
                <div className="stat"><span className="num" style={{ color: 'var(--ok)' }}>−{pickedEval.diff.toFixed(1)} m</span><span className="lbl">盲区缩短</span></div>
                <div className="spacer" />
                <button className="btn small" onClick={() => {
                  const { nextCells } = evaluateSingleLowering(ship, plan!.cells, pickedKey, selectedEyes);
                  onApplyCells(nextCells);
                  setPickedKey(null);
                }}>回写到配载</button>
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="row-flex">
            <h2 style={{ margin: 0 }}>自动降层建议</h2>
            <div className="spacer" />
            <button className="btn small" disabled={suggesting} onClick={runSuggestions}>
              {suggesting ? '枚举试算中…' : '生成建议(尽量少动箱)'}
            </button>
            {suggestions.some((s) => s.projectedPass) && (
              <button className="btn ghost small" onClick={applyAllPass}>一键应用到合规</button>
            )}
          </div>
          {!result.checks.every((c) => c.passed) && (
            <div className="row-flex" style={{ margin: '10px 0', padding: 10, background: 'var(--bg-panel-2)', borderRadius: 8 }}>
              <button className="btn ghost small" disabled={groupBusy} onClick={runGroupPlan}>
                {groupBusy ? '成组试算中…' : '成组降层: 清空外侧视线走廊'}
              </button>
              {groupPlan ? (
                groupPlan.pass ? (
                  <>
                    <span className="muted">清空外侧 {groupPlan.clearedRows.length} 个 row、移 {groupPlan.movedCount} 箱后可全部合规</span>
                    <button className="btn small" onClick={applyGroupPlan}>应用该方案</button>
                  </>
                ) : (
                  <span className="muted">即使清空到中央 row 仍不合规, 需整体降低前部箱高</span>
                )
              ) : (
                <span className="muted" style={{ fontSize: 11 }}>单箱降层无法收敛时(宽扇形), 按 row 由外向内成批清空</span>
              )}
            </div>
          )}
          {suggestions.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>
              {result.checks.every((c) => c.passed) ? '当前配载已全部合规, 无需动箱。' : '点击上方按钮, 系统逐列试算降层并按"合规优先 → 改善量 → 动箱数"排序。'}
            </p>
          ) : (
            <table>
              <thead><tr><th>箱列</th><th>当前顶高</th><th>降后顶高</th><th>动箱</th><th>降后船首盲区</th><th>降后最大扇形</th><th>改善</th><th>合规</th><th></th></tr></thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.cellKey}>
                    <td className="mono">{s.cellKey}</td>
                    <td>{s.currentTopZ.toFixed(2)} m</td>
                    <td>{s.proposedTopZ.toFixed(2)} m</td>
                    <td>{s.containersMoved}</td>
                    <td>{Number.isFinite(s.projectedBowBlind) ? `${s.projectedBowBlind.toFixed(1)} m` : '全盲'}</td>
                    <td>{s.projectedMaxSectorDeg.toFixed(1)}°</td>
                    <td style={{ color: 'var(--ok)' }}>−{s.improvementM.toFixed(1)} m</td>
                    <td><span className={`badge ${s.projectedPass ? 'ok' : 'warn'}`}>{s.projectedPass ? '通过' : '改善'}</span></td>
                    <td><button className="btn small" onClick={() => applySuggestion(s)}>应用</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div className="panel">
          <h2>眼位选择(可多选合并视线)</h2>
          <div className="pill-tabs">
            {ship.eyePositions.map((e) => (
              <button key={e.id} className={`tag-chip ${selectedEyes.includes(e.id) ? 'active' : ''}`} onClick={() => toggleEye(e.id)}>
                {e.name}
                {e.mullions.length > 0 && <span className="muted" style={{ marginLeft: 6 }}>竖梃×{e.mullions.length}</span>}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            多选时同方位取最小盲区(两人分站左右的合并视野); 窗框竖梃仅在所有选中眼位都被挡时计盲。
          </p>
          <div className="row-flex" style={{ marginTop: 8 }}>
            <div className="stat"><span className="num" style={{ color: Number.isFinite(result.bowBlindDistance) && result.bowBlindDistance > distLimit ? 'var(--bad)' : 'var(--ok)' }}>
              {Number.isFinite(result.bowBlindDistance) ? `${result.bowBlindDistance.toFixed(1)} m` : '∞'}
            </span><span className="lbl">船首盲区(自船首)</span></div>
            <div className="stat"><span className="num">{result.totalBlindArcDeg.toFixed(1)}°</span><span className="lbl">前向盲区总弧(货物)</span></div>
            <div className="stat"><span className="num">{result.elapsedMs.toFixed(0)} ms</span><span className="lbl">本次求解耗时</span></div>
          </div>
        </div>

        <div className="panel" style={{ textAlign: 'center' }}>
          <h2 style={{ textAlign: 'left' }}>极坐标盲区图</h2>
          <PolarChart result={result} size={400} distanceLimit={distLimit} />
        </div>

        <div className="panel">
          <h2>SOLAS V/22 逐项判定</h2>
          {result.checks.map((c) => (
            <div key={c.id} className={`check-row ${c.passed ? 'pass' : 'fail'}`}>
              <span className={`badge ${c.passed ? 'ok' : 'bad'}`}>{c.passed ? '通过' : '不过'}</span>
              <div>
                <div>{c.label}</div>
                <div className="reg">{c.regulation} · {c.detail}</div>
              </div>
              <div className="vals">
                <div className="actual" style={{ color: c.passed ? 'var(--ok)' : 'var(--bad)' }}>{c.actual}</div>
                <div className="limit">限值 {c.limit}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>盲区扇形({result.sectors.length})</h2>
          <table>
            <thead><tr><th>起始</th><th>结束</th><th>扇形角</th><th>最大盲距</th><th>性质</th></tr></thead>
            <tbody>
              {result.sectors.map((s, i) => (
                <tr key={i}>
                  <td>{s.azFrom.toFixed(2)}°</td>
                  <td>{s.azTo.toFixed(2)}°</td>
                  <td style={s.angleDeg > 10 ? { color: 'var(--bad)', fontWeight: 700 } : {}}>{s.hullInherent ? '固有(豁免)' : `${s.angleDeg.toFixed(2)}°`}</td>
                  <td>{Number.isFinite(s.maxBlindDistance) ? `${s.maxBlindDistance.toFixed(1)} m` : '∞'}</td>
                  <td><span className={`badge ${s.hullInherent ? 'mt' : 'dg'}`}>{s.hullInherent ? '船体' : '货物/设备'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
