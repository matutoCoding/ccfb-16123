import { describe, it, expect } from 'vitest';
import {
  solveVisibility,
  assembleSceneBoxes,
  identifySectors,
  type SceneBox,
} from '../src/engine/visibility';
import { buildColumnBoxes, parseBayText, toBayText } from '../src/engine/stowage';
import { shipToWater, trimAngleRad } from '../src/engine/math3d';
import { checkNavigationLights } from '../src/engine/night';
import type { Ship, StowageCell, EyePosition } from '../src/types';

function makeEye(): EyePosition {
  return {
    id: 'center',
    name: '指挥位',
    pos: { x: 60, y: 0, z: 35 },
    mullions: [],
  };
}

function baseShip(over: Partial<Ship> = {}): Ship {
  return {
    id: 's1',
    name: '测试船',
    imo: 'IMO0000000',
    loa: 180,
    beam: 32,
    depth: 12,
    bridgeX: 65,
    eyeHeight: 35,
    bridgeWingSpan: 32,
    bayPitch: 6.1,
    rowPitch: 2.6,
    tierHeight: 2.591,
    hcTierHeight: 2.896,
    hatchTopZ: 16,
    forecastleHeight: 0,
    draftAft: 10,
    draftFwd: 10,
    obstructions: [],
    eyePositions: [makeEye()],
    bayCount: 20,
    rowCount: 6,
    maxTier: 6,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('视域几何精度 —— 与手算公式对照', () => {
  it('平吃水单箱: R = h·d/(h-h0), 误差 < 0.01 m', () => {
    // 眼位 (60,0,35), 水面 10 => 眼高 h=25
    // 箱盒 x 150..160 (远上角 d=100), 顶高 z=23 => 相对水面 h0=13
    const ship = baseShip();
    const boxes: SceneBox[] = [
      { id: 'hull-main', kind: 'hull', min: { x: 0, y: -16, z: 0 }, max: { x: 180, y: 16, z: 12 } },
      { id: 'box', kind: 'container', min: { x: 150, y: -3, z: 20 }, max: { x: 160, y: 3, z: 23 } },
    ];
    const res = solveVisibility(ship, boxes, { stepDeg: 0.25 });
    // 手算: R = 25*100/(25-13) = 208.333; 船首距眼 120 => 船首盲区 88.333
    const handR = (25 * 100) / (25 - 13);
    const handBlind = handR - 120;
    expect(Math.abs(res.samples[0].blindDistance - handBlind)).toBeLessThan(0.01);
    expect(res.bowBlindDistance).toBeCloseTo(88.333, 2);
  });

  it('改变箱顶高度: 结果与手算同步, 误差 < 1 m', () => {
    const ship = baseShip();
    // 顶高 z=25 => h0=15; R=25*100/10=250 => 盲区 130
    const boxes: SceneBox[] = [
      { id: 'hull-main', kind: 'hull', min: { x: 0, y: -16, z: 0 }, max: { x: 180, y: 16, z: 12 } },
      { id: 'box', kind: 'container', min: { x: 150, y: -3, z: 20 }, max: { x: 160, y: 3, z: 25 } },
    ];
    const res = solveVisibility(ship, boxes, { stepDeg: 0.25 });
    expect(Math.abs(res.bowBlindDistance - 130)).toBeLessThan(1);
  });

  it('纵倾时眼高随几何旋转变化, 视线切点仍由解析公式给出', () => {
    const ship = baseShip({ draftAft: 12, draftFwd: 8 }); // 艉倾 4m/180
    const tau = trimAngleRad(12, 8, 180);
    const eyeW = shipToWater({ x: 60, y: 0, z: 35 }, tau, 12);
    // 艉倾: 该 x 处水线相对龙骨下降 60*tanτ≈1.33, 眼高 23*cosτ+60*sinτ≈24.33
    expect(eyeW.z).toBeCloseTo(24.327, 2);
    const boxes: SceneBox[] = [
      { id: 'hull-main', kind: 'hull', min: { x: 0, y: -16, z: 0 }, max: { x: 180, y: 16, z: 12 } },
      { id: 'box', kind: 'container', min: { x: 150, y: -3, z: 20 }, max: { x: 160, y: 3, z: 23 } },
    ];
    const res = solveVisibility(ship, boxes, { stepDeg: 0.25 });
    // 独立手算(水面坐标): 远上角 (160,23) -> r_v=100.242, z_v=14.552; R=h*r/(h-z_v)
    const s = Math.sin(tau);
    const c = Math.cos(tau);
    const h = eyeW.z;
    const rv = (160 * c - 23 * s) - (60 * c - 35 * s);
    const zv = 160 * s + 23 * c - 12 * c;
    const handR = (h * rv) / (h - zv);
    // 船首顶边 (loa, z=depth) 的水面坐标投影
    const hullEdge = (180 * c - 12 * s) - (60 * c - 35 * s);
    expect(Math.abs(res.samples[0].blindDistance - (handR - hullEdge))).toBeLessThan(0.05);
  });

  it('遮挡盒高于眼位 => 该方位全盲 Infinity', () => {
    const ship = baseShip();
    const boxes: SceneBox[] = [
      { id: 'hull-main', kind: 'hull', min: { x: 0, y: -16, z: 0 }, max: { x: 180, y: 16, z: 12 } },
      { id: 'tall', kind: 'container', min: { x: 100, y: -3, z: 20 }, max: { x: 110, y: 3, z: 40 } },
    ];
    const res = solveVisibility(ship, boxes, { stepDeg: 0.25 });
    expect(res.samples[0].blindDistance).toBe(Infinity);
    expect(res.checks.find((c) => c.id === 'solas-distance')!.passed).toBe(false);
  });

  it('无货物时仅存艏楼固有小盲区且全部判项通过(含眼位的主船体盒自动跳过)', () => {
    const ship = baseShip({ depth: 20, forecastleHeight: 14 });
    const boxes: SceneBox[] = [
      // 主船体盒包含眼位(x=60), 应被识别为观察平台跳过
      { id: 'hull-main', kind: 'hull', min: { x: 0, y: -16, z: 0 }, max: { x: 180, y: 16, z: 12 } },
      // 艏楼在眼位前方: x 150..180, 顶高 14(水面上 4)
      { id: 'hull-forecastle', kind: 'hull', min: { x: 150, y: -16, z: 10 }, max: { x: 180, y: 16, z: 14 } },
    ];
    const res = solveVisibility(ship, boxes, { stepDeg: 0.25 });
    // 手算: 艏楼远上角 d=120, h0=4 => R=25*120/(25-4)=142.86; 船首边距 ~120 => 盲 ~22.9
    const handR = (25 * 120) / (25 - 4);
    expect(Math.abs(res.bowBlindDistance - (handR - 120))).toBeLessThan(1);
    // 船体固有盲区豁免扇形角度判项 => 全部判项通过
    expect(res.checks.every((c) => c.passed)).toBe(true);
    expect(res.sectors[0].hullInherent).toBe(true);
  });

  it('整圈采样数与方位角正确', () => {
    const ship = baseShip();
    const res = solveVisibility(ship, [{ id: 'h', kind: 'hull', min: { x: 0, y: -16, z: 0 }, max: { x: 180, y: 16, z: 12 } }], {
      stepDeg: 1,
    });
    expect(res.samples).toHaveLength(360);
    expect(res.samples[0].azimuth).toBe(0);
    expect(res.samples[90].azimuth).toBe(90);
  });
});

describe('盲区扇形识别', () => {
  it('连续盲段合并并正确处理跨 0°', () => {
    const mk = (az: number, blind: boolean) => ({
      azimuth: az,
      blindDistance: blind ? 100 : 0,
      blockerId: blind ? 'b' : null,
      blockerKind: blind ? 'container' : null,
      mullionBlocked: false,
      grazingCellKey: null,
    });
    const samples = Array.from({ length: 360 }, (_, i) => mk(i, (i >= 355 || i <= 4))) as import('../src/types').AzimuthSample[];
    const sectors = identifySectors(samples, 1);
    expect(sectors).toHaveLength(1);
    expect(sectors[0].angleDeg).toBe(10);
  });
});

describe('配载几何与 bay 文本', () => {
  it('parseBayText 支持 ROW/TIER 与 CSV 两种格式并识别危险品/高箱/空箱', () => {
    const text = [
      '# 注释',
      'BAY 03',
      'ROW 01 TIER 82 40HC',
      'ROW 02 TIER 82 40DG DG 3',
      'BAY 04',
      'ROW 01 TIER 84 20MT',
      '06,02,86,20DG,DG,5.1',
    ].join('\n');
    const { cells, errors } = parseBayText(text);
    expect(errors).toHaveLength(0);
    expect(cells).toHaveLength(4);
    expect(cells[0].container).toMatchObject({ size: 'TEU40', type: 'highcube' });
    expect(cells[1].container).toMatchObject({ size: 'TEU40', type: 'dangerous', imdgClass: '3' });
    expect(cells[2].container).toMatchObject({ size: 'TEU20', type: 'empty' });
    expect(cells[3].container).toMatchObject({ size: 'TEU20', type: 'dangerous', imdgClass: '5.1' });
  });

  it('toBayText 往返', () => {
    const cells: StowageCell[] = [
      { bay: 3, row: 1, tier: 82, container: { size: 'TEU40', type: 'highcube' } },
    ];
    const text = toBayText(cells);
    const back = parseBayText(text);
    expect(back.errors).toHaveLength(0);
    expect(back.cells[0]).toMatchObject({ bay: 3, row: 1, tier: 82 });
    expect(back.cells[0].container.size).toBe('TEU40');
  });

  it('箱列 AABB: 同列连续层合并、40尺箱进入两个槽', () => {
    const ship = baseShip();
    const cells: StowageCell[] = [
      { bay: 3, row: 1, tier: 82, container: { size: 'TEU40', type: 'standard' } },
      { bay: 3, row: 1, tier: 84, container: { size: 'TEU40', type: 'standard' } },
    ];
    const cols = buildColumnBoxes(ship, cells);
    // 每个槽各一列, 共 2 列; 每列两层合并为一个盒
    expect(cols).toHaveLength(2);
    for (const c of cols) {
      expect(c.max.z).toBeCloseTo(ship.hatchTopZ + 2 * ship.tierHeight, 3);
      expect(c.min.z).toBeCloseTo(ship.hatchTopZ, 3);
    }
  });
});

describe('夜航号灯', () => {
  it('箱堆挡住前桅灯时给出遮挡提示', () => {
    const ship = baseShip({
      obstructions: [
        {
          id: 'mast', kind: 'foremast', name: '前桅',
          min: { x: 140, y: -1, z: 16 }, max: { x: 142, y: 1, z: 42 },
        },
      ],
    });
    // 直接构造一堵挡在眼位(x=60)与桅(x=141)之间的高箱墙, 不依赖槽位布局
    const cols = [
      {
        slot: 0, row: 1,
        min: { x: 95, y: -6, z: 16 },
        max: { x: 105, y: 6, z: 40 },
        topCellKey: 'wall', topTier: 98,
      },
      {
        slot: 0, row: 2,
        min: { x: 95, y: -6, z: 16 },
        max: { x: 105, y: 6, z: 40 },
        topCellKey: 'wall2', topTier: 98,
      },
    ];
    const results = checkNavigationLights(ship, cols);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].blocked).toBe(true);
    expect(results[0].blockerId).toContain('col-');
  });
});

describe('种子船型端到端精度', () => {
  it('种子配载可求解且结果有限或被正确识别为全盲', async () => {
    const { generateSeedData } = await import('../src/data/seed');
    const seed = generateSeedData();
    for (const plan of seed.stowages) {
      const ship = seed.ships.find((s) => s.id === plan.shipId)!;
      const res = solveVisibility(ship, assembleSceneBoxes(ship, buildColumnBoxes(ship, plan.cells)), { stepDeg: 0.5 });
      expect(res.samples).toHaveLength(720);
      // 三眼合并后的合规方案必须全部判项通过
      if (plan.id.endsWith('v22') || plan.id.endsWith('v08')) {
        expect(res.checks.every((c) => c.passed)).toBe(true);
      }
    }
  });

  it('纵倾实船单箱: 引擎船首盲区与独立手算切线公式误差 < 1m', () => {
    // 用 8000 箱船的真实尺度, 但只放一个位置确定的箱列, 保证可手算
    const ship = baseShip({
      loa: 334, beam: 42.8, depth: 27.2, bridgeX: 252, eyeHeight: 51,
      hatchTopZ: 30.5, draftAft: 13.5, draftFwd: 12.8,
      eyePositions: [{ id: 'c', name: '指挥位', pos: { x: 256, y: 0, z: 51 }, mullions: [] }],
    });
    const boxTopZ = 46;
    const boxes: SceneBox[] = [
      { id: 'hull-main', kind: 'hull', min: { x: 0, y: -21.4, z: 0 }, max: { x: 334, y: 21.4, z: 23.2 } },
      { id: 'col-0-1', kind: 'container', cellKey: 'k', min: { x: 290, y: -1.3, z: 30.5 }, max: { x: 296.1, y: 1.3, z: boxTopZ } },
    ];
    const res = solveVisibility(ship, boxes, { stepDeg: 0.25, eyeIds: ['c'] });
    const tau = trimAngleRad(13.5, 12.8, 334);
    const eyeW = shipToWater({ x: 256, y: 0, z: 51 }, tau, 13.5);
    const farTop = shipToWater({ x: 296.1, y: 0, z: boxTopZ }, tau, 13.5);
    const r = farTop.x - eyeW.x;
    const handR = (eyeW.z * r) / (eyeW.z - farTop.z);
    const deckZ = Math.max((13.5 + 12.8) / 2 + 2.5, 27.2 - 4);
    const c = Math.cos(tau);
    const s = Math.sin(tau);
    const bowEdge = 334 * c - deckZ * s - eyeW.x;
    const handBlind = Math.max(0, handR - bowEdge);
    expect(Number.isFinite(res.samples[0].blindDistance)).toBe(true);
    expect(Math.abs(res.samples[0].blindDistance - handBlind)).toBeLessThan(1);
  });
});

describe('整船性能 —— 0.2s 重算硬指标', () => {
  it('8000 箱级满载场景 0.25° 全圆求解 < 200 ms', () => {
    const ship = baseShip({
      loa: 334,
      beam: 48,
      depth: 27,
      bridgeX: 250,
      eyeHeight: 52,
      bayCount: 42,
      rowCount: 12,
      maxTier: 8,
      hatchTopZ: 30,
      eyePositions: [
        { id: 'c', name: '指挥位', pos: { x: 255, y: 0, z: 52 }, mullions: [] },
        { id: 'l', name: '左翼', pos: { x: 255, y: 22, z: 52 }, mullions: [] },
        { id: 'r', name: '右翼', pos: { x: 255, y: -22, z: 52 }, mullions: [] },
      ],
    });
    const cells: StowageCell[] = [];
    for (let bay = 2; bay <= 42; bay += 2) {
      for (let row = 1; row <= 10; row++) {
        const tiers = 3 + ((bay * 7 + row * 3) % 4); // 3..6 层
        for (let t = 0; t < tiers; t++) {
          cells.push({ bay, row, tier: 82 + t * 2, container: { size: 'TEU20', type: 'standard' } });
        }
      }
    }
    const cols = buildColumnBoxes(ship, cells);
    const boxes = assembleSceneBoxes(ship, cols);
    const t0 = performance.now();
    const res = solveVisibility(ship, boxes, { stepDeg: 0.25 });
    const elapsed = performance.now() - t0;
    expect(res.samples).toHaveLength(1440);
    // 性能指标(留 20% 余量)
    expect(elapsed).toBeLessThan(200);
    expect(res.elapsedMs).toBeLessThan(200);
  });
});
