// 页面 3: 吃水纵倾 —— 首尾吃水、纵倾角、实时眼高、压载前后方案对比
import { useMemo, useState } from 'react';
import type { Ship } from '../types';
import { trimAngleRad, shipToWater, RAD2DEG } from '../engine/math3d';
import { buildColumnBoxes } from '../engine/stowage';
import { assembleSceneBoxes, solveVisibility } from '../engine/visibility';

export function TrimPage({ ship, plan, onSave }: {
  ship: Ship;
  plan: { cells: unknown[] } | null;
  onSave: (s: Ship) => void;
}) {
  const [draftAft, setDraftAft] = useState(ship.draftAft);
  const [draftFwd, setDraftFwd] = useState(ship.draftFwd);
  const [baseline, setBaseline] = useState<{ aft: number; fwd: number } | null>(null);

  const tau = trimAngleRad(draftAft, draftFwd, ship.loa);
  const trimDeg = tau * RAD2DEG;
  const trimM = draftAft - draftFwd;

  const eyeRows = useMemo(
    () =>
      ship.eyePositions.map((e) => {
        const w = shipToWater(e.pos, tau, draftAft);
        return { name: e.name, height: w.z, x: w.x, y: w.y };
      }),
    [ship.eyePositions, tau, draftAft],
  );

  const quick = useMemo(() => {
    const probe: Ship = { ...ship, draftAft, draftFwd };
    const cols = buildColumnBoxes(probe, (plan?.cells as never[]) ?? []);
    return solveVisibility(probe, assembleSceneBoxes(probe, cols), { stepDeg: 1 });
  }, [ship, plan, draftAft, draftFwd]);

  const baselineResult = useMemo(() => {
    if (!baseline) return null;
    const probe: Ship = { ...ship, draftAft: baseline.aft, draftFwd: baseline.fwd };
    const cols = buildColumnBoxes(probe, (plan?.cells as never[]) ?? []);
    return solveVisibility(probe, assembleSceneBoxes(probe, cols), { stepDeg: 1 });
  }, [baseline, ship, plan]);

  const dirty = draftAft !== ship.draftAft || draftFwd !== ship.draftFwd;

  return (
    <div className="page grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="panel">
        <h2>吃水与纵倾</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label className="field">船尾吃水 dA (m)
            <input type="number" step={0.01} value={draftAft} onChange={(e) => setDraftAft(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="field">船首吃水 dF (m)
            <input type="number" step={0.01} value={draftFwd} onChange={(e) => setDraftFwd(parseFloat(e.target.value) || 0)} />
          </label>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 14 }}>
          <div className="stat"><span className="num">{trimM.toFixed(2)} m</span><span className="lbl">吃水差 (dA−dF, +艉倾)</span></div>
          <div className="stat"><span className="num">{trimDeg.toFixed(3)}°</span><span className="lbl">纵倾角 τ</span></div>
          <div className="stat"><span className="num">{((ship.depth - (draftAft + draftFwd) / 2)).toFixed(2)} m</span><span className="lbl">中部平均干舷</span></div>
        </div>

        <h3>各眼位实时眼高(相对水面)</h3>
        <table>
          <thead><tr><th>眼位</th><th>水面坐标 x (m)</th><th>y (m)</th><th>眼高 z (m)</th></tr></thead>
          <tbody>
            {eyeRows.map((r) => (
              <tr key={r.name}><td>{r.name}</td><td>{r.x.toFixed(2)}</td><td>{r.y.toFixed(2)}</td><td><b>{r.height.toFixed(3)}</b></td></tr>
            ))}
          </tbody>
        </table>

        <div className="row-flex" style={{ marginTop: 14 }}>
          <button className="btn" disabled={!dirty} onClick={() => onSave({ ...ship, draftAft, draftFwd })}>应用到船型</button>
          <button className="btn ghost" onClick={() => { setDraftAft(ship.draftAft); setDraftFwd(ship.draftFwd); }}>重置为已存值</button>
        </div>

        <h3>纵倾示意(侧视)</h3>
        <svg viewBox="0 0 400 150" style={{ width: '100%', background: '#0a1322', borderRadius: 8 }}>
          <line x1="0" y1="110" x2="400" y2="110" stroke="#3d6b96" strokeWidth="2" />
          <text x="6" y="106" fill="#7fb2e0" fontSize="10">水线</text>
          <g transform={`rotate(${trimDeg} 200 90)`}>
            <rect x="40" y="70" width="320" height="34" rx="4" fill="#3a475c" stroke="#6b7c99" />
            <rect x="250" y="30" width="70" height="40" rx="3" fill="#4a6480" stroke="#8fb0d4" />
            <circle cx="285" cy="26" r="4" fill="#ffd45e" />
          </g>
          <text x="330" y="140" fill="#9fb4d4" fontSize="11">τ = {trimDeg.toFixed(3)}° ({trimM.toFixed(2)} m)</text>
        </svg>
      </div>

      <div className="panel">
        <h2>压载前后对比</h2>
        <div className="row-flex" style={{ marginBottom: 10 }}>
          <button className="btn ghost small" onClick={() => setBaseline({ aft: draftAft, fwd: draftFwd })}>
            把当前吃水记为"压载前"
          </button>
          {baseline && <button className="btn ghost small" onClick={() => setBaseline(null)}>清除基准</button>}
        </div>
        <table>
          <thead>
            <tr><th>指标</th><th>{baseline ? `压载前 (${baseline.aft}/${baseline.fwd}m)` : '压载前(未设置)'}</th><th>当前 ({draftAft}/{draftFwd}m)</th><th>变化</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>纵倾角</td>
              <td>{baseline ? `${(trimAngleRad(baseline.aft, baseline.fwd, ship.loa) * RAD2DEG).toFixed(3)}°` : '—'}</td>
              <td>{trimDeg.toFixed(3)}°</td>
              <td>{baseline ? `${(trimDeg - trimAngleRad(baseline.aft, baseline.fwd, ship.loa) * RAD2DEG).toFixed(3)}°` : '—'}</td>
            </tr>
            <tr>
              <td>船首盲区 (m)</td>
              <td>{baseline ? baselineResult!.bowBlindDistance.toFixed(1) : '—'}</td>
              <td>{Number.isFinite(quick.bowBlindDistance) ? quick.bowBlindDistance.toFixed(1) : '全盲'}</td>
              <td>
                {baseline && Number.isFinite(quick.bowBlindDistance)
                  ? `${(quick.bowBlindDistance - baselineResult!.bowBlindDistance).toFixed(1)} m`
                  : '—'}
              </td>
            </tr>
            <tr>
              <td>最大单扇形</td>
              <td>{baseline ? `${baselineResult!.sectors.reduce((m, s) => Math.max(m, s.angleDeg), 0).toFixed(1)}°` : '—'}</td>
              <td>{quick.sectors.reduce((m, s) => Math.max(m, s.angleDeg), 0).toFixed(1)}°</td>
              <td>—</td>
            </tr>
            <tr>
              <td>前向盲区总弧</td>
              <td>{baseline ? `${baselineResult!.totalBlindArcDeg.toFixed(1)}°` : '—'}</td>
              <td>{quick.totalBlindArcDeg.toFixed(1)}°</td>
              <td>—</td>
            </tr>
            <tr>
              <td>合规</td>
              <td>{baseline ? (baselineResult!.checks.every((c) => c.passed) ? '✅' : '❌') : '—'}</td>
              <td>{quick.checks.every((c) => c.passed) ? '✅' : '❌'}</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
          对比采用 1° 粗扫保证交互流畅; 正式核查在视域核查页以 0.25° 精算。纵倾通过绕 AP 龙骨的坐标旋转进入求解,
          眼高、箱体高度与水线交点全部联动。
        </p>
      </div>
    </div>
  );
}
