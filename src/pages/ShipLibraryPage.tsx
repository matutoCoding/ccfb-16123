// 页面 1: 船型库 —— 船型参数、眼位、固定遮挡物摆放、bay 位文本导入
import { useMemo, useState } from 'react';
import type { Ship, Obstruction, ObstructionKind, Vec3 } from '../types';
import { uid } from '../lib/id';
import { parseBayText } from '../engine/stowage';

const KIND_LABEL: Record<ObstructionKind, string> = {
  hull: '船体/艏楼',
  hatchcover: '舱盖',
  lashing: '绑扎桥',
  crane: '克令吊',
  foremast: '前桅',
  wheelhouse: '驾驶台',
};

function NumberField({ label, value, onChange, step = 0.1, suffix }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string;
}) {
  return (
    <label className="field">
      {label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function ShipLibraryPage({ ships, currentId, onSelect, onSave, onDelete, onImportBay }: {
  ships: Ship[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onSave: (s: Ship) => void;
  onDelete: (id: string) => void;
  onImportBay: (shipId: string, text: string) => void;
}) {
  const ship = ships.find((s) => s.id === currentId) ?? null;
  const [draft, setDraft] = useState<Ship | null>(null);
  const [bayText, setBayText] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const active = draft ?? ship;

  const dirty = useMemo(() => {
    if (!draft || !ship) return false;
    return JSON.stringify(draft) !== JSON.stringify(ship);
  }, [draft, ship]);

  if (!active) return <div className="page muted">暂无船型, 请先在系统初始化生成或新建。</div>;

  const update = (patch: Partial<Ship>) => setDraft({ ...active, ...patch });
  const updateObs = (id: string, patch: Partial<Obstruction>) =>
    update({ obstructions: active.obstructions.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const updateCorner = (id: string, corner: 'min' | 'max', axis: keyof Vec3, v: number) =>
    updateObs(id, { [corner]: { ...active.obstructions.find((o) => o.id === id)![corner], [axis]: v } });

  const addObs = (kind: ObstructionKind) => {
    const o: Obstruction = {
      id: uid('obs'),
      kind,
      name: KIND_LABEL[kind],
      min: { x: active.loa * 0.7, y: -2, z: active.hatchTopZ },
      max: { x: active.loa * 0.7 + 4, y: 2, z: active.hatchTopZ + 6 },
    };
    update({ obstructions: [...active.obstructions, o] });
  };

  const addEye = () => {
    update({
      eyePositions: [
        ...active.eyePositions,
        { id: uid('eye'), name: `眼位 ${active.eyePositions.length + 1}`, pos: { x: active.bridgeX + 4, y: 0, z: active.eyeHeight }, mullions: [] },
      ],
    });
  };

  const doImport = () => {
    const { cells, errors } = parseBayText(bayText);
    if (errors.length) {
      setImportMsg(`导入失败: ${errors.join('; ')}`);
      return;
    }
    onImportBay(active.id, JSON.stringify(cells));
    setImportMsg(`成功解析 ${cells.length} 个箱位(已送入配载编辑页, 可在那里落盘)`);
  };

  return (
    <div className="page grid" style={{ gridTemplateColumns: '260px 1fr 1fr' }}>
      <div className="panel">
        <h2>船型库</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ships.map((s) => (
            <div
              key={s.id}
              className={`tag-chip ${s.id === currentId ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={() => { onSelect(s.id); setDraft(null); }}
            >
              <div>
                <div>{s.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>LOA {s.loa}m · {s.imo}</div>
              </div>
            </div>
          ))}
        </div>
        <h3>危险操作</h3>
        <button className="btn danger small" onClick={() => onDelete(active.id)}>删除该船型</button>
      </div>

      <div className="panel scroll-y" style={{ maxHeight: 'calc(100vh - 100px)' }}>
        <h2>主尺度与驾驶台</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">船名<input value={active.name} onChange={(e) => update({ name: e.target.value })} /></label>
          <label className="field">IMO<input value={active.imo} onChange={(e) => update({ imo: e.target.value })} /></label>
          <NumberField label="船长 LOA (m)" value={active.loa} onChange={(v) => update({ loa: v })} />
          <NumberField label="型宽 (m)" value={active.beam} onChange={(v) => update({ beam: v })} />
          <NumberField label="型深 (m)" value={active.depth} onChange={(v) => update({ depth: v })} />
          <NumberField label="驾驶台前端 x (m)" value={active.bridgeX} onChange={(v) => update({ bridgeX: v })} />
          <NumberField label="指挥位眼高 (基线起 m)" value={active.eyeHeight} onChange={(v) => update({ eyeHeight: v })} />
          <NumberField label="两翼跨度 (m)" value={active.bridgeWingSpan} onChange={(v) => update({ bridgeWingSpan: v })} />
          <NumberField label="舱盖顶面高 (m)" value={active.hatchTopZ} onChange={(v) => update({ hatchTopZ: v })} />
          <NumberField label="艏楼高 (m, 0=无)" value={active.forecastleHeight} onChange={(v) => update({ forecastleHeight: v })} />
          <NumberField label="bay 间距 (m)" value={active.bayPitch} onChange={(v) => update({ bayPitch: v })} />
          <NumberField label="row 间距 (m)" value={active.rowPitch} onChange={(v) => update({ rowPitch: v })} />
          <NumberField label="标准层高 (m)" value={active.tierHeight} onChange={(v) => update({ tierHeight: v })} step={0.001} />
          <NumberField label="高箱层高 (m)" value={active.hcTierHeight} onChange={(v) => update({ hcTierHeight: v })} step={0.001} />
          <NumberField label="20尺 bay 槽数" value={active.bayCount} onChange={(v) => update({ bayCount: Math.round(v) })} step={1} />
          <NumberField label="单侧 row 数" value={active.rowCount} onChange={(v) => update({ rowCount: Math.round(v) })} step={1} />
          <NumberField label="最大 tier 层数" value={active.maxTier} onChange={(v) => update({ maxTier: Math.round(v) })} step={1} />
        </div>

        <h3>眼位 ({active.eyePositions.length})</h3>
        {active.eyePositions.map((e) => (
          <div key={e.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
            <div className="row-flex" style={{ marginBottom: 6 }}>
              <input value={e.name} onChange={(ev) => update({ eyePositions: active.eyePositions.map((x) => x.id === e.id ? { ...x, name: ev.target.value } : x) })} style={{ flex: 1 }} />
              <button className="btn ghost small" onClick={() => update({ eyePositions: active.eyePositions.filter((x) => x.id !== e.id) })}>删除</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <NumberField label="x" value={e.pos.x} onChange={(v) => update({ eyePositions: active.eyePositions.map((x) => x.id === e.id ? { ...x, pos: { ...x.pos, x: v } } : x) })} />
              <NumberField label="y(左+)" value={e.pos.y} onChange={(v) => update({ eyePositions: active.eyePositions.map((x) => x.id === e.id ? { ...x, pos: { ...x.pos, y: v } } : x) })} />
              <NumberField label="z" value={e.pos.z} onChange={(v) => update({ eyePositions: active.eyePositions.map((x) => x.id === e.id ? { ...x, pos: { ...x.pos, z: v } } : x) })} />
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>
              竖梃遮挡角区间:
              {e.mullions.map((m, mi) => (
                <span key={mi} className="row-flex" style={{ display: 'inline-flex', marginLeft: 8 }}>
                  <input type="number" style={{ width: 70 }} value={m.azFrom} onChange={(ev) => update({ eyePositions: active.eyePositions.map((x) => x.id === e.id ? { ...x, mullions: x.mullions.map((mm, k) => k === mi ? { ...mm, azFrom: parseFloat(ev.target.value) || 0 } : mm) } : x) })} />
                  ~
                  <input type="number" style={{ width: 70 }} value={m.azTo} onChange={(ev) => update({ eyePositions: active.eyePositions.map((x) => x.id === e.id ? { ...x, mullions: x.mullions.map((mm, k) => k === mi ? { ...mm, azTo: parseFloat(ev.target.value) || 0 } : mm) } : x) })} />
                  <button className="btn ghost small" onClick={() => update({ eyePositions: active.eyePositions.map((x) => x.id === e.id ? { ...x, mullions: x.mullions.filter((_, k) => k !== mi) } : x) })}>×</button>
                </span>
              ))}
              <button className="btn ghost small" style={{ marginLeft: 8 }} onClick={() => update({ eyePositions: active.eyePositions.map((x) => x.id === e.id ? { ...x, mullions: [...x.mullions, { azFrom: -2, azTo: -1 }] } : x) })}>+ 竖梃</button>
            </div>
          </div>
        ))}
        <button className="btn ghost small" onClick={addEye}>+ 新增眼位</button>
      </div>

      <div className="panel scroll-y" style={{ maxHeight: 'calc(100vh - 100px)' }}>
        <h2>固定遮挡物 ({active.obstructions.length})</h2>
        <div className="row-flex" style={{ marginBottom: 10 }}>
          {(['hatchcover', 'lashing', 'crane', 'foremast', 'wheelhouse', 'hull'] as ObstructionKind[]).map((k) => (
            <button key={k} className="btn ghost small" onClick={() => addObs(k)}>+ {KIND_LABEL[k]}</button>
          ))}
        </div>
        {active.obstructions.map((o) => (
          <div key={o.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
            <div className="row-flex">
              <strong style={{ fontSize: 12 }}>{KIND_LABEL[o.kind]}</strong>
              <input value={o.name} style={{ flex: 1, padding: '3px 6px' }} onChange={(e) => updateObs(o.id, { name: e.target.value })} />
              <button className="btn danger small" onClick={() => update({ obstructions: active.obstructions.filter((x) => x.id !== o.id) })}>删</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
              {(['x', 'y', 'z'] as const).map((ax) => (
                <NumberField key={`min${ax}`} label={`min.${ax}`} value={o.min[ax]} onChange={(v) => updateCorner(o.id, 'min', ax, v)} step={0.1} />
              ))}
              {(['x', 'y', 'z'] as const).map((ax) => (
                <NumberField key={`max${ax}`} label={`max.${ax}`} value={o.max[ax]} onChange={(v) => updateCorner(o.id, 'max', ax, v)} step={0.1} />
              ))}
            </div>
          </div>
        ))}

        <h2>bay 位文本导入</h2>
        <p className="muted" style={{ fontSize: 11 }}>
          支持格式: <code>BAY 03</code> 分段 + <code>ROW 01 TIER 82 40HC</code>, 或 CSV 行 <code>03,01,82,40DG,DG,3</code>。
          token: 20/40 + STD/HC/DG/MT。
        </p>
        <textarea rows={7} style={{ width: '100%', fontFamily: 'Consolas, monospace', fontSize: 12 }}
          placeholder={'BAY 03\nROW 01 TIER 82 40HC\nROW 02 TIER 82 40DG DG 3'}
          value={bayText} onChange={(e) => setBayText(e.target.value)} />
        <div className="row-flex" style={{ marginTop: 8 }}>
          <button className="btn small" onClick={doImport}>解析并送入配载</button>
          {importMsg && <span className="muted">{importMsg}</span>}
        </div>
      </div>

      {dirty && (
        <div style={{ position: 'fixed', right: 24, bottom: 24, display: 'flex', gap: 10, zIndex: 40 }}>
          <button className="btn" onClick={() => { onSave(draft!); setDraft(null); }}>保存船型修改</button>
          <button className="btn ghost" onClick={() => setDraft(null)}>放弃</button>
        </div>
      )}
    </div>
  );
}
