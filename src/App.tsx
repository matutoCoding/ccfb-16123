import { useState } from 'react';
import { useAppState } from './state/useAppState';
import { ShipLibraryPage } from './pages/ShipLibraryPage';
import { StowagePage } from './pages/StowagePage';
import { TrimPage } from './pages/TrimPage';
import { VisibilityPage } from './pages/VisibilityPage';
import { ReportsPage } from './pages/ReportsPage';
import { buildColumnBoxes } from './engine/stowage';
import { assembleSceneBoxes, solveVisibility } from './engine/visibility';
import type { StowageCell, VisibilityResult } from './types';

type PageKey = 'ship' | 'stowage' | 'trim' | 'visibility' | 'report';

const NAV: { key: PageKey; label: string }[] = [
  { key: 'ship', label: '船型库' },
  { key: 'stowage', label: '配载编辑' },
  { key: 'trim', label: '吃水纵倾' },
  { key: 'visibility', label: '视域核查' },
  { key: 'report', label: '航次报告' },
];

export default function App() {
  const app = useAppState();
  const [page, setPage] = useState<PageKey>('visibility');
  const [pendingImport, setPendingImport] = useState<{ shipId: string; cells: StowageCell[] } | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (!app.state.ready) {
    return <div style={{ padding: 40, color: '#8fa0bd' }}>正在初始化 IndexedDB 并生成种子船型…</div>;
  }

  const ship = app.state.ships.find((s) => s.id === app.state.currentShipId) ?? null;
  const plan = app.state.stowages.find((p) => p.id === app.state.currentStowageId) ?? null;
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const buildAllEyeResults = (): VisibilityResult[] => {
    if (!ship) return [];
    const cols = buildColumnBoxes(ship, plan?.cells ?? []);
    const boxes = assembleSceneBoxes(ship, cols);
    // 首项为全眼位合并结果(与核查页口径一致), 其后附各单眼位详情
    const merged = solveVisibility(ship, boxes, { stepDeg: 0.25 });
    const perEye = ship.eyePositions.map((e) => solveVisibility(ship, boxes, { stepDeg: 0.25, eyeIds: [e.id] }));
    return [merged, ...perEye];
  };

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>驾驶台视域核查系统 <span style={{ color: 'var(--accent)' }}>BVS</span></h1>
          <div className="sub">SOLAS V/22 · WebGL2 + 解析几何 · IndexedDB 本地存储</div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={page === n.key ? 'active' : ''} onClick={() => setPage(n.key)}>{n.label}</button>
          ))}
        </nav>
        <div className="header-right">
          <select
            value={app.state.currentShipId ?? ''}
            onChange={(e) => app.selectShip(e.target.value)}
          >
            {app.state.ships.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={app.state.currentStowageId ?? ''}
            onChange={(e) => app.selectStowage(e.target.value || null)}
          >
            <option value="">— 选择配载 —</option>
            {app.state.stowages.filter((p) => p.shipId === ship?.id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </header>

      {page === 'ship' && ship && (
        <ShipLibraryPage
          ships={app.state.ships}
          currentId={ship.id}
          onSelect={app.selectShip}
          onSave={(s) => { app.saveShip(s); flash('船型已保存'); }}
          onDelete={(id) => { if (confirm('确认删除该船型及其配置?')) { app.deleteShip(id); flash('已删除'); } }}
          onImportBay={(shipId, json) => {
            try {
              const cells = JSON.parse(json) as StowageCell[];
              setPendingImport({ shipId, cells });
              setPage('stowage');
              flash(`已解析 ${cells.length} 个箱位, 请到配载编辑页保存`);
            } catch {
              flash('导入数据解析失败');
            }
          }}
        />
      )}

      {page === 'stowage' && ship && (
        <StowagePage
          ship={ship}
          plan={plan}
          pendingImport={pendingImport}
          clearPendingImport={() => setPendingImport(null)}
          onSave={(p) => { app.saveStowage(p); flash('配载已保存, 视域将自动重算'); }}
        />
      )}

      {page === 'trim' && ship && (
        <TrimPage ship={ship} plan={plan} onSave={(s) => { app.saveShip(s); flash('吃水纵倾已应用'); }} />
      )}

      {page === 'visibility' && ship && (
        <VisibilityPage
          ship={ship}
          plan={plan}
          onApplyCells={(cells) => {
            if (!plan) return;
            app.saveStowage({ ...plan, cells });
            flash('降层方案已回写配载');
          }}
          onScreenshot={(url) => { setScreenshot(url); flash('三维截图已捕获, 可在航次报告页归档'); }}
        />
      )}

      {page === 'report' && ship && (
        <ReportsPage
          ship={ship}
          plan={plan}
          reports={app.state.reports}
          onSave={app.saveReport}
          onDelete={app.deleteReport}
          pendingScreenshot={screenshot}
          clearScreenshot={() => setScreenshot(null)}
          buildResults={buildAllEyeResults}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
