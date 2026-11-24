// 页面 5: 航次报告 —— 每航次出港视域结果归档, 附极坐标图/三维截图/全景, PSC 可直接出示
import { useMemo, useState } from 'react';
import type { Ship, StowagePlan, VoyageReport, VisibilityResult } from '../types';
import { PolarChart } from '../components/PolarChart';
import { uid } from '../lib/id';

interface Props {
  ship: Ship;
  plan: StowagePlan | null;
  reports: VoyageReport[];
  onSave: (r: VoyageReport) => void;
  onDelete: (id: string) => void;
  pendingScreenshot: string | null;
  clearScreenshot: () => void;
  buildResults: () => VisibilityResult[];
}

export function ReportsPage({ ship, plan, reports, onSave, onDelete, pendingScreenshot, clearScreenshot, buildResults }: Props) {
  const [voyageNo, setVoyageNo] = useState(`V${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90) + 10)}`);
  const [port, setPort] = useState('CNSHA');
  const [openId, setOpenId] = useState<string | null>(null);
  const shipReports = useMemo(() => reports.filter((r) => r.shipId === ship.id).sort((a, b) => b.createdAt - a.createdAt), [reports, ship.id]);

  const createReport = () => {
    const results = buildResults();
    const primary = results[0];
    if (!primary) return;
    // 极坐标图离屏绘制
    const off = document.createElement('canvas');
    const size = 520;
    off.width = size;
    off.height = size;
    // 复用 PolarChart 的方式: 直接在隐藏容器里渲染较重, 这里用主结果数据手工绘 dataURL
    const polarImage = drawPolarOffline(primary, size, Math.min(2 * ship.loa, 500));
    const report: VoyageReport = {
      id: uid('rpt'),
      shipId: ship.id,
      shipName: ship.name,
      stowageId: plan?.id ?? '',
      stowageName: plan?.name ?? '',
      voyageNo,
      departurePort: port,
      departureTime: Date.now(),
      draftAft: ship.draftAft,
      draftFwd: ship.draftFwd,
      results,
      polarImage,
      sceneImage: pendingScreenshot ?? '',
      notes: `SOLAS V/22 核查: ${primary.checks.every((c) => c.passed) ? '全部通过' : '存在不过项'}`,
      createdAt: Date.now(),
    };
    onSave(report);
    clearScreenshot();
    setOpenId(report.id);
  };

  const opened = shipReports.find((r) => r.id === openId) ?? null;

  return (
    <div className="page grid" style={{ gridTemplateColumns: '340px 1fr', alignItems: 'start' }}>
      <div className="panel">
        <h2>生成出港报告</h2>
        <label className="field" style={{ marginBottom: 8 }}>航次号
          <input value={voyageNo} onChange={(e) => setVoyageNo(e.target.value)} />
        </label>
        <label className="field" style={{ marginBottom: 8 }}>离港港口(UN/LOCODE)
          <input value={port} onChange={(e) => setPort(e.target.value)} />
        </label>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          配载: {plan?.name ?? '无'}<br />
          吃水: {ship.draftAft.toFixed(2)} / {ship.draftFwd.toFixed(2)} m
        </div>
        {pendingScreenshot ? (
          <div style={{ marginBottom: 8 }}>
            <img src={pendingScreenshot} alt="截图" style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)' }} />
            <div className="muted" style={{ fontSize: 11 }}>已附三维截图(来自视域核查页)</div>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 11 }}>提示: 可先在视域核查页点"三维截图", 报告会自动带上。</p>
        )}
        <button className="btn" style={{ width: '100%' }} onClick={createReport} disabled={!plan}>归档当前视域结果</button>

        <h2 style={{ marginTop: 18 }}>历史航次 ({shipReports.length})</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
          {shipReports.map((r) => {
            const pass = r.results[0]?.checks.every((c) => c.passed);
            return (
              <div key={r.id} className={`tag-chip ${r.id === openId ? 'active' : ''}`} style={{ display: 'block' }}
                onClick={() => setOpenId(r.id)}>
                <div className="row-flex">
                  <b>{r.voyageNo}</b>
                  <span className={`badge ${pass ? 'ok' : 'bad'}`}>{pass ? '合规' : '不过'}</span>
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {r.departurePort} · {new Date(r.departureTime).toLocaleDateString()} · 盲 {Number.isFinite(r.results[0]?.bowBlindDistance) ? r.results[0].bowBlindDistance.toFixed(1) : '∞'}m
                </div>
              </div>
            );
          })}
          {shipReports.length === 0 && <span className="muted">暂无报告</span>}
        </div>
      </div>

      <div className="panel">
        {!opened ? (
          <div className="muted">选择左侧航次查看完整报告, 港口国检查时可直接展示本页或打印。</div>
        ) : (
          <div>
            <div className="row-flex">
              <h2 style={{ margin: 0 }}>{opened.shipName} — {opened.voyageNo}</h2>
              <div className="spacer" />
              <button className="btn ghost small" onClick={() => window.print()}>打印 / 导出 PDF</button>
              <button className="btn danger small" onClick={() => { onDelete(opened.id); setOpenId(null); }}>删除</button>
            </div>
            <table style={{ marginTop: 10 }}>
              <tbody>
                <tr><td>离港</td><td>{opened.departurePort} · {new Date(opened.departureTime).toLocaleString()}</td></tr>
                <tr><td>配载</td><td>{opened.stowageName}</td></tr>
                <tr><td>首尾吃水</td><td>{opened.draftAft.toFixed(2)} m / {opened.draftFwd.toFixed(2)} m</td></tr>
                <tr><td>眼位</td><td>{opened.results.map((r) => r.eyeName).join('；')}</td></tr>
              </tbody>
            </table>

            <h3>SOLAS V/22 判定汇总</h3>
            {opened.results.flatMap((r) => r.checks).filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i).map((c) => (
              <div key={c.id} className={`check-row ${c.passed ? 'pass' : 'fail'}`}>
                <span className={`badge ${c.passed ? 'ok' : 'bad'}`}>{c.passed ? '通过' : '不过'}</span>
                <div><div>{c.label}</div><div className="reg">{c.regulation}</div></div>
                <div className="vals"><div className="actual">{c.actual}</div><div className="limit">{c.limit}</div></div>
              </div>
            ))}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              <div>
                <h3>极坐标盲区图(归档快照)</h3>
                <img src={opened.polarImage} alt="polar" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
              </div>
              <div>
                <h3>三维场景截图</h3>
                {opened.sceneImage
                  ? <img src={opened.sceneImage} alt="scene" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
                  : <div className="muted">该报告未附三维截图</div>}
              </div>
            </div>

            <h3>各眼位详细结果</h3>
            {opened.results.map((r) => (
              <div key={r.eyeId} style={{ marginBottom: 12 }}>
                <PolarChart result={r} size={300} distanceLimit={Math.min(2 * ship.loa, 500)} />
                <div className="muted" style={{ fontSize: 11 }}>{r.eyeName} · 步长 {r.stepDeg}° · 求解 {r.elapsedMs.toFixed(0)} ms · 船首盲区 {Number.isFinite(r.bowBlindDistance) ? r.bowBlindDistance.toFixed(1) : '∞'} m</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 离线极坐标图(与 PolarChart 同口径), 输出 dataURL 供报告归档 */
function drawPolarOffline(result: VisibilityResult, size: number, distanceLimit: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 46;
  ctx.fillStyle = '#0f1620';
  ctx.fillRect(0, 0, size, size);
  const finite = result.samples.map((s) => s.blindDistance).filter((d) => Number.isFinite(d));
  const range = Math.max(...finite, distanceLimit, 100);
  const rad = (d: number) => Math.min(1, d / range) * R;

  ctx.strokeStyle = '#26324a';
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2); ctx.stroke();
  }
  for (let az = 0; az < 360; az += 30) {
    const a = (-az * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
    ctx.strokeStyle = az % 90 === 0 ? '#3d4f70' : '#1e2a40'; ctx.stroke();
    ctx.fillStyle = '#aab8d4'; ctx.font = az % 90 === 0 ? 'bold 13px sans-serif' : '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(az === 0 ? '000' : String(az).padStart(3, '0'), cx + Math.sin(a) * (R + 18), cy - Math.cos(a) * (R + 18) + 4);
  }
  const step = result.stepDeg;
  for (const s of result.samples) {
    const blind = s.mullionBlocked || !Number.isFinite(s.blindDistance) || s.blindDistance > 0.5;
    if (!blind) continue;
    const d = Number.isFinite(s.blindDistance) ? s.blindDistance : range;
    const a0 = (-s.azimuth * Math.PI) / 180;
    const a1 = (-(s.azimuth + step) * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rad(d), Math.PI / 2 + a0, Math.PI / 2 + a1, true);
    ctx.closePath();
    ctx.fillStyle = s.mullionBlocked ? 'rgba(150,110,220,0.55)' : s.blockerKind === 'hull' ? 'rgba(120,130,150,0.45)' : 'rgba(235,84,72,0.72)';
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = '#ffd45e'; ctx.fill();
  return canvas.toDataURL('image/png');
}
