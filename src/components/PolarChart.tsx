// 极坐标盲区图: 方位角 0° 船首向上, 半径为自眼位盲区距离; 红色=盲, 绿色=清晰
import { useEffect, useRef } from 'react';
import type { VisibilityResult, BlindSector } from '../types';

interface Props {
  result: VisibilityResult | null;
  size?: number;
  /** SOLAS 距离限制(2LOA/500m 取小)画成参考环 */
  distanceLimit?: number;
  /** 点击方位回调 */
  onAzimuthClick?: (az: number) => void;
}

export function PolarChart({ result, size = 420, distanceLimit, onAzimuthClick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 46;

    ctx.clearRect(0, 0, size, size);
    // 背景
    ctx.fillStyle = '#0f1620';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 26, 0, Math.PI * 2);
    ctx.fill();

    if (!result) {
      ctx.fillStyle = '#7e8aa0';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('暂无视域结果', cx, cy);
      return;
    }

    // 半径量程: 取有限盲区 95 分位与限制的较大者, 全盲给固定量程
    const finite = result.samples.map((s) => s.blindDistance).filter((d) => Number.isFinite(d));
    const sorted = [...finite].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 100;
    const range = Math.max(p95 * 1.15, distanceLimit ?? 0, 100);
    const rad = (d: number) => Math.min(1, d / range) * R;

    // 网格环
    ctx.strokeStyle = '#26324a';
    ctx.fillStyle = '#8fa0bb';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${Math.round((range * i) / 4)}m`, cx, cy - (R * i) / 4 - 2);
    }
    // 方位射线与刻度
    for (let az = 0; az < 360; az += 30) {
      const a = (-az * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
      ctx.strokeStyle = az % 90 === 0 ? '#3d4f70' : '#1e2a40';
      ctx.stroke();
      ctx.fillStyle = '#aab8d4';
      ctx.font = az % 90 === 0 ? 'bold 12px system-ui' : '10px system-ui';
      const lx = cx + Math.sin(a) * (R + 16);
      const ly = cy - Math.cos(a) * (R + 16) + 4;
      const label = az === 0 ? '000° 船首' : az === 90 ? '090° 右' : az === 180 ? '180° 船尾' : az === 270 ? '270° 左' : `${String(az).padStart(3, '0')}°`;
      ctx.fillText(label, lx, ly);
    }

    // SOLAS 距离参考环
    if (distanceLimit && distanceLimit < range) {
      ctx.beginPath();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = '#e8b04b';
      ctx.arc(cx, cy, rad(distanceLimit), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 盲区扇形: 逐样本画小三角
    const step = result.stepDeg;
    for (const s of result.samples) {
      const blind = s.mullionBlocked || !Number.isFinite(s.blindDistance) || s.blindDistance > 0.5;
      if (!blind) continue;
      const d = Number.isFinite(s.blindDistance) ? s.blindDistance : range;
      const a0 = (-s.azimuth * Math.PI) / 180;
      const a1 = (-(s.azimuth + step) * Math.PI) / 180;
      const r = rad(d);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, Math.PI / 2 + a0, Math.PI / 2 + a1, true);
      ctx.closePath();
      ctx.fillStyle = s.mullionBlocked ? 'rgba(150,110,220,0.55)' : s.blockerKind === 'hull' ? 'rgba(120,130,150,0.45)' : 'rgba(235,84,72,0.72)';
      ctx.fill();
    }

    // 识别出的扇形边界描边 + 标注
    ctx.font = '11px system-ui';
    for (const sec of result.sectors as BlindSector[]) {
      if (sec.hullInherent) continue;
      const a0 = (-sec.azFrom * Math.PI) / 180;
      const a1 = (-sec.azTo * Math.PI) / 180;
      const r = rad(Number.isFinite(sec.maxBlindDistance) ? sec.maxBlindDistance : range);
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI / 2 + a0, Math.PI / 2 + a1, true);
      ctx.strokeStyle = '#ff6b5e';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
      const mid = (-(sec.azFrom + sec.azTo) / 2) * Math.PI / 180;
      ctx.fillStyle = '#ffd0cc';
      ctx.fillText(`${sec.angleDeg.toFixed(1)}°`, cx + Math.sin(mid) * (r + 12), cy - Math.cos(mid) * (r + 12));
    }

    // 中心点(眼位)
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd45e';
    ctx.fill();

    // 图例
    const legendY = size - 14;
    const items: [string, string][] = [
      ['货物盲区', 'rgba(235,84,72,0.72)'],
      ['船体固有', 'rgba(120,130,150,0.6)'],
      ['窗框竖梃', 'rgba(150,110,220,0.7)'],
    ];
    let lx = 18;
    ctx.textAlign = 'left';
    ctx.font = '11px system-ui';
    for (const [label, color] of items) {
      ctx.fillStyle = color;
      ctx.fillRect(lx, legendY - 9, 12, 10);
      ctx.fillStyle = '#c6d2ea';
      ctx.fillText(label, lx + 16, legendY);
      lx += 92;
    }
  }, [result, size, distanceLimit]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onAzimuthClick || !result || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    let az = (-Math.atan2(y, x) * 180) / Math.PI - 90;
    if (az < 0) az += 360;
    onAzimuthClick(Math.round(az / result.stepDeg) * result.stepDeg);
  };

  return <canvas ref={ref} style={{ width: size, height: size, cursor: onAzimuthClick ? 'crosshair' : 'default' }} onClick={handleClick} />;
}
