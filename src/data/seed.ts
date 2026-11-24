// 种子数据: 自动生成 8000 箱 / 1800 箱两条船及若干航次配载
import type { Ship, StowagePlan, StowageCell, Container, Obstruction, EyePosition, Vec3 } from '../types';
import { uid } from '../lib/id';

interface ShipSpec {
  id: string;
  name: string;
  imo: string;
  loa: number;
  beam: number;
  depth: number;
  bridgeX: number;
  eyeHeight: number;
  wingSpan: number;
  bayCount: number;
  rowCount: number;
  maxTier: number;
  hatchTopZ: number;
  forecastleHeight: number;
  hasCranes: boolean;
  mullionDeg: [number, number][];
}

function makeObstructions(spec: ShipSpec): Obstruction[] {
  const obs: Obstruction[] = [];
  const half = spec.beam / 2;
  // 舱盖: 每个 bay 槽一块, 厚度 1.2m; 槽位与 stowage.slotCenterX 同口径
  const pitch = 6.1;
  const bowLimit = spec.loa * 0.82;
  const hatchStart = bowLimit - spec.bayCount * pitch;
  for (let i = 0; i < spec.bayCount; i++) {
    const cx = hatchStart + (i + 0.5) * pitch;
    obs.push({
      id: uid('obs'),
      kind: 'hatchcover',
      name: `舱盖 No.${i + 1}`,
      min: { x: cx - pitch / 2, y: -half + 1, z: spec.hatchTopZ - 1.2 },
      max: { x: cx + pitch / 2, y: half - 1, z: spec.hatchTopZ },
    });
  }
  // 绑扎桥: 每 4 个槽一道, 位于两舱之间, 高出舱盖 8m
  for (let i = 3; i < spec.bayCount; i += 4) {
    const cx = hatchStart + i * pitch;
    obs.push({
      id: uid('obs'),
      kind: 'lashing',
      name: `绑扎桥 L${i}`,
      min: { x: cx - 0.4, y: -half + 1.5, z: spec.hatchTopZ },
      max: { x: cx + 0.4, y: half - 1.5, z: spec.hatchTopZ + 8 },
    });
  }
  // 克令吊(仅支线船): 4 台, 圆柱按包围盒处理, 吊臂向前
  if (spec.hasCranes) {
    const nCrane = 4;
    for (let k = 0; k < nCrane; k++) {
      const cx = hatchStart + ((k + 0.5) * spec.bayCount * pitch) / nCrane;
      obs.push({
        id: uid('obs'),
        kind: 'crane',
        name: `克令吊 C${k + 1}`,
        min: { x: cx - 2.2, y: -2.2, z: spec.hatchTopZ },
        max: { x: cx + 2.2, y: 2.2, z: spec.hatchTopZ + 22 },
      });
      // 吊臂(水平前伸, 高 20m)
      obs.push({
        id: uid('obs'),
        kind: 'crane',
        name: `克令吊臂 C${k + 1}`,
        min: { x: cx, y: -0.8, z: spec.hatchTopZ + 19 },
        max: { x: cx + 24, y: 0.8, z: spec.hatchTopZ + 20.5 },
      });
    }
  }
  // 前桅: 船首 88% 位置, 基座在艏楼甲板, 向上 26m
  const mastX = spec.loa * 0.88;
  const mastBase = spec.forecastleHeight;
  // 前桅为细杆(横截面 0.5m), 桅顶控制在眼高下方 2m, 只产生窄扇形而非全盲;
  // 桅顶灯平台另由夜航核查的灯位定义, 不计入实体遮挡盒。
  const mastTop = Math.min(mastBase + 22, spec.eyeHeight - 2);
  obs.push({
    id: uid('obs'),
    kind: 'foremast',
    name: '前桅',
    min: { x: mastX - 0.25, y: -0.25, z: mastBase },
    max: { x: mastX + 0.25, y: 0.25, z: mastTop },
  });
  return obs;
}

function makeEyes(spec: ShipSpec): EyePosition[] {
  const mullions = spec.mullionDeg.map<EyePosition['mullions'][number]>(([f, t]) => ({ azFrom: f, azTo: t, label: '窗框竖梃' }));
  const base: Vec3 = { x: spec.bridgeX + 4, y: 0, z: spec.eyeHeight };
  return [
    { id: 'eye-center', name: '指挥位(驾驶台中央)', pos: base, mullions },
    { id: 'eye-port', name: '左翼瞭望位', pos: { ...base, y: spec.wingSpan / 2 }, mullions: [] },
    { id: 'eye-stbd', name: '右翼瞭望位', pos: { ...base, y: -spec.wingSpan / 2 }, mullions: [] },
  ];
}

export function buildShip(spec: ShipSpec, draftAft: number, draftFwd: number): Ship {
  const now = Date.now();
  return {
    id: spec.id,
    name: spec.name,
    imo: spec.imo,
    loa: spec.loa,
    beam: spec.beam,
    depth: spec.depth,
    bridgeX: spec.bridgeX,
    eyeHeight: spec.eyeHeight,
    bridgeWingSpan: spec.wingSpan,
    bayPitch: 6.1,
    rowPitch: 2.6,
    tierHeight: 2.591,
    hcTierHeight: 2.896,
    hatchTopZ: spec.hatchTopZ,
    forecastleHeight: spec.forecastleHeight,
    draftAft,
    draftFwd,
    obstructions: makeObstructions(spec),
    eyePositions: makeEyes(spec),
    bayCount: spec.bayCount,
    rowCount: spec.rowCount,
    maxTier: spec.maxTier,
    createdAt: now,
    updatedAt: now,
  };
}

const SPECS: ShipSpec[] = [
  {
    id: 'ship-8000',
    name: 'MV ORIENTAL PEARL (8000 TEU)',
    imo: 'IMO9837214',
    loa: 334,
    beam: 42.8,
    depth: 27.2,
    bridgeX: 252,
    eyeHeight: 51,
    wingSpan: 44,
    bayCount: 40,
    rowCount: 10,
    maxTier: 9,
    hatchTopZ: 30.5,
    forecastleHeight: 26.5,
    hasCranes: false,
    mullionDeg: [[-3, -1.5], [1.5, 3]],
  },
  {
    id: 'ship-1800',
    name: 'MV COASTAL TRADER (1800 TEU)',
    imo: 'IMO9451872',
    loa: 183,
    beam: 27.6,
    depth: 15.2,
    bridgeX: 26,
    eyeHeight: 32,
    wingSpan: 28,
    bayCount: 22,
    rowCount: 6,
    maxTier: 6,
    hatchTopZ: 17.5,
    forecastleHeight: 14.5,
    hasCranes: true,
    mullionDeg: [[-4, -2], [2, 4]],
  },
];

/** 确定性伪随机(种子固定, 每次生成一致) */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface StowSpec {
  shipId: string;
  id: string;
  name: string;
  seed: number;
  /** 装载率 0..1 */
  loadFactor: number;
  /** 前部 bay 额外加高的层数(制造/避免视域问题) */
  forwardBoost: number;
  /** 外侧 row 堆箱层数(0 = 外侧留空作视线走廊, 合规); 违规航次设 >0 堆满 */
  outerTiers: number;
  dgRate: number;
  hcRate: number;
  mtRate: number;
}

function buildStowage(ship: Ship, ss: StowSpec): StowagePlan {
  const rand = rng(ss.seed);
  const cells: StowageCell[] = [];
  const put = (bay: number, row: number, tier: number, cont: Container) =>
    cells.push({ bay, row, tier, container: cont });

  // 横向: 保留中央 2/3 row 作为主堆区, 外侧 1/3 row 由 outerTiers 控制(视线走廊)
  const totalRows = ship.rowCount * 2;
  const innerRowLimit = Math.round(totalRows * 0.66); // 中央 row 数(对称)
  const isOuter = (row: number) => Math.abs(row - (ship.rowCount + 0.5)) > innerRowLimit / 2 - 0.25;

  for (let slot = 0; slot < ship.bayCount; slot++) {
    const bayNo = slot * 2 + 2;
    // 前 1/3 为前部(靠近船首, 影响视域最大)
    const forward = slot >= ship.bayCount * 0.66;
    const mid = !forward && slot >= ship.bayCount * 0.33;
    // 甲板箱层数: 以眼高为硬约束
    const maxAllowed = Math.floor((ship.eyeHeight - ship.hatchTopZ - 1.5) / ship.tierHeight);
    for (let row = 1; row <= totalRows; row++) {
      const outer = isOuter(row);
      if (outer && ss.outerTiers === 0) continue; // 合规航次: 外侧留空, 形成视线走廊
      if (rand() > ss.loadFactor) continue;
      let finalTiers: number;
      if (outer) {
        // 外侧仅按指定层数(违规航次堆高才会挡视线)
        finalTiers = Math.min(ss.outerTiers + (forward ? ss.forwardBoost : 0), ship.maxTier);
      } else {
        const baseTiers = forward
          ? Math.max(2, Math.min(maxAllowed - 1, 3 + Math.floor(rand() * 2)))
          : mid
            ? Math.max(2, Math.min(maxAllowed, maxAllowed - 1 + Math.floor(rand() * 2)))
            : Math.max(1, Math.min(maxAllowed, maxAllowed - 2 + Math.floor(rand() * 2)));
        finalTiers = Math.min(ship.maxTier, baseTiers + (forward ? ss.forwardBoost : 0));
      }
      for (let t = 0; t < finalTiers; t++) {
        const roll = rand();
        let cont: Container;
        if (roll < ss.mtRate) cont = { size: 'TEU20', type: 'empty' };
        else if (roll < ss.mtRate + ss.hcRate) cont = { size: 'TEU20', type: 'highcube' };
        else if (roll < ss.mtRate + ss.hcRate + ss.dgRate)
          cont = { size: 'TEU20', type: 'dangerous', imdgClass: ['1.4', '3', '5.1', '8', '9'][Math.floor(rand() * 5)] };
        else cont = { size: 'TEU20', type: 'standard', weight: 8 + rand() * 18 };
        put(bayNo, row, 82 + t * 2, cont);
      }
    }
  }
  const now = Date.now();
  return {
    id: ss.id,
    shipId: ss.shipId,
    name: ss.name,
    cells,
    notes: `自动生成, 装载率 ${(ss.loadFactor * 100).toFixed(0)}%, ${cells.length} 箱位`,
    createdAt: now,
    updatedAt: now,
  };
}

export interface SeedBundle {
  ships: Ship[];
  stowages: StowagePlan[];
}

export function generateSeedData(): SeedBundle {
  const big = buildShip(SPECS[0], 13.5, 12.8);
  const small = buildShip(SPECS[1], 8.6, 7.9);

  // 8000 箱船: 一个出港合规航次(外侧留视线走廊) + 一个外侧堆满/前部超高的不合规航次
  const bigOk = buildStowage(big, {
    shipId: big.id, id: 'stow-big-v22', name: 'V22 欧线出港配载(合规)',
    seed: 2201, loadFactor: 0.86, forwardBoost: 0, outerTiers: 0, dgRate: 0.04, hcRate: 0.18, mtRate: 0.12,
  });
  const bigBad = buildStowage(big, {
    shipId: big.id, id: 'stow-big-v23', name: 'V23 美线加班配载(外侧堆满·前部超高)',
    seed: 2302, loadFactor: 0.93, forwardBoost: 2, outerTiers: 5, dgRate: 0.05, hcRate: 0.22, mtRate: 0.06,
  });

  // 1800 箱船: 一个合规航次(外侧留走廊)
  const smallVoy = buildStowage(small, {
    shipId: small.id, id: 'stow-small-v08', name: 'V08 东南亚支线配载(合规)',
    seed: 803, loadFactor: 0.78, forwardBoost: 0, outerTiers: 0, dgRate: 0.03, hcRate: 0.15, mtRate: 0.18,
  });

  return { ships: [big, small], stowages: [bigOk, bigBad, smallVoy] };
}
