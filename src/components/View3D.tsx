// 三维场景视图组件: 包装 SceneRenderer, 轨道相机交互 + 箱列拾取 + 高亮 + 夜航
import { useEffect, useRef, useState } from 'react';
import { SceneRenderer, type RenderBox, type CameraState } from '../webgl/renderer';
import type { Ship, VisibilityResult } from '../types';
import { shipToWater, trimAngleRad } from '../engine/math3d';

interface Props {
  ship: Ship;
  boxes: RenderBox[];
  result: VisibilityResult | null;
  eyeId: string | null;
  nightMode: boolean;
  height?: number;
  onPickBox?: (box: RenderBox | null) => void;
  selectedCellKey?: string | null;
  registerRenderer?: (r: SceneRenderer) => void;
}

export function View3D({ ship, boxes, result, eyeId, nightMode, height = 560, onPickBox, selectedCellKey, registerRenderer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const dragRef = useRef<{ x: number; y: number; button: number } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new SceneRenderer(canvasRef.current);
    rendererRef.current = r;
    registerRenderer?.(r);
    const parent = canvasRef.current.parentElement!;
    r.resize(parent.clientWidth, height);
    const onResize = () => r.resize(parent.clientWidth, height);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setShip(ship);
  }, [ship]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setBoxes(boxes);
    r.setSelected(selectedCellKey ?? null);
  }, [boxes, selectedCellKey]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !result) return;
    // 擦边箱列高亮: 前向 180° 内参与致盲的箱
    const keys = new Set<string>();
    for (const s of result.samples) {
      if ((s.azimuth <= 90 || s.azimuth >= 270) && s.grazingCellKey && s.blindDistance > 0.5) {
        keys.add(s.grazingCellKey);
      }
    }
    r.setHighlight([...keys]);
    const eye = ship.eyePositions.find((e) => e.id === eyeId) ?? ship.eyePositions[0];
    r.setActiveEye(eye?.pos ?? null);
    r.setBlindOverlay(result.samples, eye.pos);
  }, [result, eyeId, ship]);

  useEffect(() => {
    rendererRef.current?.setNightMode(nightMode);
    rendererRef.current?.render();
  }, [nightMode]);

  useEffect(() => {
    rendererRef.current?.render();
  });

  const onDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, button: e.button };
  };
  const onMove = (e: React.MouseEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      const cam: CameraState = r.getCamera();
      if (dragRef.current.button === 2 || e.shiftKey) {
        cam.dist = Math.max(20, cam.dist * (1 + dy * 0.003));
      } else {
        cam.yaw += dx * 0.006;
        cam.pitch = Math.max(0.08, Math.min(1.45, cam.pitch + dy * 0.006));
      }
      r.setCamera(cam);
      dragRef.current = { ...dragRef.current, x: e.clientX, y: e.clientY };
      r.render();
    } else {
      const box = r.pick(e.clientX, e.clientY);
      setHoverInfo(box ? `${box.kind} ${box.cellKey ? '· ' + box.cellKey : ''}` : null);
    }
  };
  const onUp = (e: React.MouseEvent) => {
    const moved = dragRef.current && Math.hypot(e.clientX - dragRef.current.x, e.clientY - dragRef.current.y) < 5;
    dragRef.current = null;
    if (moved) {
      const box = rendererRef.current?.pick(e.clientX, e.clientY) ?? null;
      onPickBox?.(box);
    }
  };

  const eye = ship.eyePositions.find((e) => e.id === eyeId) ?? ship.eyePositions[0];
  const tau = trimAngleRad(ship.draftAft, ship.draftFwd, ship.loa);
  const eyeW = eye ? shipToWater(eye.pos, tau, ship.draftAft) : null;

  return (
    <div className="canvas-wrap" style={{ position: 'relative' }} onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={canvasRef}
        style={{ height }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => { dragRef.current = null; setHoverInfo(null); }}
      />
      <div style={{ position: 'absolute', left: 10, top: 10, background: 'rgba(8,15,28,0.78)', padding: '6px 10px', borderRadius: 6, fontSize: 11 }} className="muted">
        左键拖动旋转 · Shift/右键拖动缩放 · 单击箱列查看降层效果
        {eyeW && <div>当前眼位水面高度: <b style={{ color: '#ffd45e' }}>{eyeW.z.toFixed(2)} m</b></div>}
      </div>
      {hoverInfo && (
        <div style={{ position: 'absolute', right: 10, bottom: 10, background: 'rgba(8,15,28,0.85)', padding: '5px 10px', borderRadius: 6, fontSize: 11 }}>
          {hoverInfo}
        </div>
      )}
    </div>
  );
}
