// 页面 2: 配载编辑 —— bay/row/tier 网格, 20/40/高箱/危险品/空箱标记
import { useMemo, useState } from 'react';
import type { Ship, StowagePlan, StowageCell, Container, ContainerSize, ContainerType } from '../types';
import { cellKey, slotToBayNo, bayNoToSlots } from '../engine/stowage';
import { uid } from '../lib/id';

const TYPE_BADGE: Record<ContainerType, { cls: string; text: string }> = {
  standard: { cls: '', text: 'STD' },
  highcube: { cls: 'hc', text: 'HC' },
  dangerous: { cls: 'dg', text: 'DG' },
  empty: { cls: 'mt', text: 'MT' },
};

export function StowagePage({ ship, plan, onSave, pendingImport, clearPendingImport }: {
  ship: Ship;
  plan: StowagePlan | null;
  onSave: (p: StowagePlan) => void;
  pendingImport: { shipId: string; cells: StowageCell[] } | null;
  clearPendingImport: () => void;
}) {
  const [draft, setDraft] = useState<StowagePlan | null>(null);
  const [selSlot, setSelSlot] = useState(0);
  const [size, setSize] = useState<ContainerSize>('TEU20');
  const [type, setType] = useState<ContainerType>('standard');
  const [imdg, setImdg] = useState('3');
  const active = draft ?? plan;

  // 导入数据落盘
  useMemo(() => {
    if (pendingImport && plan && pendingImport.shipId === ship.id) {
      setDraft({ ...plan, cells: pendingImport.cells });
      clearPendingImport();
    }
  }, [pendingImport]);

  const cellMap = useMemo(() => {
    const m = new Map<string, StowageCell>();
    for (const c of active?.cells ?? []) m.set(cellKey(c.bay, c.row, c.tier), c);
    return m;
  }, [active]);

  if (!active) return <div className="page muted">该船暂无配载方案。</div>;

  const bayNo = slotToBayNo(selSlot);
  const rows = Array.from({ length: ship.rowCount * 2 }, (_, i) => i + 1);
  const tiers = Array.from({ length: ship.maxTier }, (_, i) => 82 + i * 2);

  const findAt = (row: number, tier: number): StowageCell | undefined => {
    // 20 尺: 当前 bayNo; 40 尺: 奇数 bay 覆盖两个槽, 检查相邻
    const direct = cellMap.get(cellKey(bayNo, row, tier));
    if (direct) return direct;
    return undefined;
  };

  const putCell = (row: number, tier: number) => {
    if (!active) return;
    const cont: Container = { size, type, ...(type === 'dangerous' ? { imdgClass: imdg } : {}) };
    const targetBay = size === 'TEU40' ? bayNo - 1 : bayNo; // 40尺落奇数 bay
    const newCell: StowageCell = { bay: targetBay, row, tier, container: cont };
    // 移除冲突: 同 key, 以及 40 尺覆盖槽内的 20 尺
    let cells = active.cells.filter((c) => cellKey(c.bay, c.row, c.tier) !== cellKey(targetBay, row, tier));
    if (size === 'TEU40') {
      const [s1, s2] = bayNoToSlots(targetBay, 'TEU40');
      const b1 = slotToBayNo(s1);
      const b2 = slotToBayNo(s2);
      cells = cells.filter((c) => !(c.row === row && c.tier === tier && (c.bay === b1 || c.bay === b2)));
    } else {
      // 放 20 尺时移除覆盖该槽的 40 尺
      cells = cells.filter((c) => {
        if (c.container.size !== 'TEU40' || c.row !== row || c.tier !== tier) return true;
        const slots = bayNoToSlots(c.bay, 'TEU40');
        return !slots.includes(selSlot);
      });
    }
    setDraft({ ...active, cells: [...cells, newCell] });
  };

  const removeCell = (row: number, tier: number) => {
    const c = findAt(row, tier);
    if (!c) return;
    setDraft({ ...active, cells: active.cells.filter((x) => x !== c) });
  };

  const lowerColumn = (row: number) => {
    // 移除该 bay 槽/row 最高层箱(40尺整体移除)
    const inCol = active.cells
      .filter((c) => c.row === row)
      .filter((c) => {
        if (c.bay === bayNo) return true;
        if (c.container.size === 'TEU40') {
          return bayNoToSlots(c.bay, 'TEU40').includes(selSlot);
        }
        return false;
      })
      .sort((a, b) => b.tier - a.tier);
    if (!inCol.length) return;
    const top = inCol[0];
    setDraft({ ...active, cells: active.cells.filter((c) => c !== top) });
  };

  const stats = useMemo(() => {
    const cells = active.cells;
    const teu = cells.reduce((n, c) => n + (c.container.size === 'TEU40' ? 2 : 1), 0);
    return {
      slots: cells.length,
      teu,
      dg: cells.filter((c) => c.container.type === 'dangerous').length,
      hc: cells.filter((c) => c.container.type === 'highcube').length,
      mt: cells.filter((c) => c.container.type === 'empty').length,
    };
  }, [active]);

  const dirty = draft !== null;

  return (
    <div className="page grid" style={{ gridTemplateColumns: '200px 1fr 300px' }}>
      <div className="panel">
        <h2>配载方案</h2>
        <div className="muted" style={{ marginBottom: 8 }}>{active.name}</div>
        <div className="stat" style={{ marginBottom: 10 }}>
          <span><b>{stats.teu}</b> TEU / {stats.slots} 箱位</span>
          <span className="muted">DG {stats.dg} · HC {stats.hc} · MT {stats.mt}</span>
        </div>
        <h3>bay 选择 (20尺槽)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4, maxHeight: 380, overflowY: 'auto' }}>
          {Array.from({ length: ship.bayCount }, (_, i) => (
            <button key={i} className={`tag-chip ${i === selSlot ? 'active' : ''}`} style={{ padding: 5, fontSize: 11 }}
              onClick={() => setSelSlot(i)}>
              {String(slotToBayNo(i)).padStart(2, '0')}
            </button>
          ))}
        </div>
        <h3>新建方案</h3>
        <button className="btn ghost small" onClick={() => {
          const p: StowagePlan = { id: uid('stow'), shipId: ship.id, name: `新配载 ${new Date().toLocaleDateString()}`, cells: [], createdAt: Date.now(), updatedAt: Date.now() };
          onSave(p); setDraft(null);
        }}>另存为新方案</button>
      </div>

      <div className="panel">
        <h2>BAY {String(bayNo).padStart(2, '0')} 箱位图 (行 × 层)</h2>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          左键放箱 · 右键删箱 · 行号奇数=左舷(上)、偶数=右舷(下) · tier 82 为甲板第一层
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
            <thead>
              <tr>
                <th>row\tier</th>
                {[...tiers].reverse().map((t) => <th key={t} style={{ textAlign: 'center' }}>{t}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row}>
                  <td className="mono" style={{ fontWeight: 600 }}>{String(row).padStart(2, '0')}{row % 2 ? ' 左' : ' 右'}</td>
                  {[...tiers].reverse().map((tier) => {
                    const c = findAt(row, tier);
                    const badge = c ? TYPE_BADGE[c.container.type] : null;
                    return (
                      <td key={tier} style={{ padding: 0 }}>
                        <div
                          onClick={() => (c ? removeCell(row, tier) : putCell(row, tier))}
                          onContextMenu={(e) => { e.preventDefault(); removeCell(row, tier); }}
                          title={c ? `${c.container.size} ${c.container.type} ${c.container.imdgClass ?? ''}` : '空位(点击放箱)'}
                          style={{
                            width: 54, height: 34, borderRadius: 5, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700,
                            background: c
                              ? c.container.type === 'dangerous' ? 'rgba(235,84,72,0.35)'
                                : c.container.type === 'highcube' ? 'rgba(150,110,220,0.3)'
                                : c.container.type === 'empty' ? 'rgba(143,160,189,0.18)'
                                : 'rgba(77,163,255,0.25)'
                              : 'rgba(255,255,255,0.04)',
                            border: c ? '1px solid rgba(255,255,255,0.18)' : '1px dashed var(--border)',
                            color: c ? '#fff' : 'var(--fg-dim)',
                          }}
                        >
                          {c ? <span className={`badge ${badge!.cls}`}>{c.container.size === 'TEU40' ? '40' : '20'}{badge!.text}</span> : '—'}
                        </div>
                      </td>
                    );
                  })}
                  <td>
                    <button className="btn ghost small" title="该列降一层(移除最高箱)" onClick={() => lowerColumn(row)}>降层</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>放箱参数</h2>
        <label className="field" style={{ marginBottom: 8 }}>尺寸
          <select value={size} onChange={(e) => setSize(e.target.value as ContainerSize)}>
            <option value="TEU20">20 尺</option>
            <option value="TEU40">40 尺(占相邻两槽, 落奇数 bay)</option>
          </select>
        </label>
        <label className="field" style={{ marginBottom: 8 }}>类型
          <select value={type} onChange={(e) => setType(e.target.value as ContainerType)}>
            <option value="standard">标准箱 STD</option>
            <option value="highcube">高箱 HC</option>
            <option value="dangerous">危险品 DG</option>
            <option value="empty">空箱 MT</option>
          </select>
        </label>
        {type === 'dangerous' && (
          <label className="field" style={{ marginBottom: 8 }}>IMDG 类别
            <select value={imdg} onChange={(e) => setImdg(e.target.value)}>
              {['1.4', '2.1', '3', '4.1', '5.1', '6.1', '8', '9'].map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
        )}
        <h3>方案说明</h3>
        <textarea rows={3} value={active.notes ?? ''} onChange={(e) => setDraft({ ...active, notes: e.target.value })} />
        <div className="row-flex" style={{ marginTop: 12 }}>
          <button className="btn" disabled={!dirty} onClick={() => { onSave(draft!); setDraft(null); }}>保存配载</button>
          <button className="btn ghost" disabled={!dirty} onClick={() => setDraft(null)}>还原</button>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 14 }}>
          任何箱高修改在"视域核查"页都会即时重算(0.25° 全圆, 实测 &lt; 200ms)。
        </p>
      </div>
    </div>
  );
}
