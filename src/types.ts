// 全局领域类型定义 —— 船舶、配载、视域、报告
// 坐标系(船体坐标系): x 指向船首(+), y 指向左舷(+), z 垂直向上(+), 原点在船尾基线(keel at AP)

export type Vec3 = { x: number; y: number; z: number };

/** 固定遮挡物类型 */
export type ObstructionKind =
  | 'hull'        // 船体/艏楼(基础遮挡)
  | 'hatchcover'  // 舱盖
  | 'lashing'     // 绑扎桥
  | 'crane'       // 克令吊
  | 'foremast'    // 前桅
  | 'wheelhouse'; // 驾驶台自身结构

export interface Obstruction {
  id: string;
  kind: ObstructionKind;
  name: string;
  /** AABB 角点(船体坐标系) */
  min: Vec3;
  max: Vec3;
}

/** 指挥/瞭望眼位 */
export interface EyePosition {
  id: string;
  name: string;
  /** 相对船体原点的坐标 */
  pos: Vec3;
  /** 窗框竖梃: 以眼位为中心的水平遮挡角区间(度, 相对船首 0°, 顺时针为正/右舷为负按约定统一取 0..360) */
  mullions: { azFrom: number; azTo: number; label?: string }[];
}

export interface Ship {
  id: string;
  name: string;
  imo: string;
  /** 船长 LOA m */
  loa: number;
  /** 型宽 */
  beam: number;
  /** 型深 */
  depth: number;
  /** 驾驶台前端 x */
  bridgeX: number;
  /** 眼高(基线起, m) —— 指挥位默认眼高 */
  eyeHeight: number;
  /** 驾驶台两翼间距 */
  bridgeWingSpan: number;
  /** 箱位参数 */
  bayPitch: number;   // 20尺箱位纵向间距 ~6.1
  rowPitch: number;   // 箱位横向间距 ~2.6
  tierHeight: number; // 标准箱层高 2.591
  hcTierHeight: number; // 高箱层高 2.896
  /** 舱口盖顶面高(基线起) */
  hatchTopZ: number;
  /** 艏楼高(基线起), 无艏楼则 0 */
  forecastleHeight: number;
  /** 船尾吃水 m */
  draftAft: number;
  /** 船首吃水 m */
  draftFwd: number;
  obstructions: Obstruction[];
  eyePositions: EyePosition[];
  /** bay 行数等布局参数(配载用) */
  bayCount: number;       // 20尺 bay 数
  rowCount: number;       // 单侧行数(总列数 = 2*rowCount 含中缝)
  maxTier: number;
  createdAt: number;
  updatedAt: number;
}

export type ContainerSize = 'TEU20' | 'TEU40';
export type ContainerType = 'standard' | 'highcube' | 'dangerous' | 'empty';

export interface Container {
  size: ContainerSize;
  type: ContainerType;
  /** 危险品类别(如 1.4, 3, 5.1), 仅 dangerous */
  imdgClass?: string;
  weight?: number; // t
}

/**
 * 配载: 以 20尺 bay 槽为键。
 * key 格式: `${bay}-${row}-${tier}`; 40尺箱占两个相邻 bay 槽(仅奇数 bay 起始)。
 * bay 编号: 1,3,5... 船首向; row: 左舷 01,03... 右舷 02,04...
 */
export interface StowageCell {
  bay: number;
  row: number;
  tier: number;
  container: Container;
}

export interface StowagePlan {
  id: string;
  shipId: string;
  name: string;
  cells: StowageCell[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** 每个方位角的视域采样结果 */
export interface AzimuthSample {
  /** 方位角 0..360, 0=船首, 顺时针(向右舷) */
  azimuth: number;
  /** 水面盲区距离 m; Infinity = 全盲(遮挡物高于眼位) */
  blindDistance: number;
  /** 致盲遮挡物 id; hull 表示船体自身 */
  blockerId: string | null;
  blockerKind: ObstructionKind | 'container' | null;
  /** 是否被窗框竖梃遮挡 */
  mullionBlocked: boolean;
  /** 擦边箱列 key(用于高亮), 若有 */
  grazingCellKey: string | null;
}

export interface BlindSector {
  azFrom: number;
  azTo: number;
  /** 扇形角(度); 仅船舶船体固有盲区时为 0(豁免 SOLAS 扇形角度判项, 几何范围仍保留) */
  angleDeg: number;
  maxBlindDistance: number;
  blockerIds: string[];
  /** 仅由船体固有遮挡造成, 豁免 10°/20° 判项 */
  hullInherent?: boolean;
}

export interface SolasCheck {
  id: string;
  label: string;
  regulation: string;
  passed: boolean;
  actual: string;
  limit: string;
  detail: string;
}

export interface VisibilityResult {
  eyeId: string;
  eyeName: string;
  stepDeg: number;
  samples: AzimuthSample[];
  sectors: BlindSector[];
  /** 船首方向(0°)盲区长度 */
  bowBlindDistance: number;
  /** 前向 180° 半弧内盲区扇形总角度 */
  totalBlindArcDeg: number;
  checks: SolasCheck[];
  /** 计算耗时 ms */
  elapsedMs: number;
}

export interface VoyageReport {
  id: string;
  shipId: string;
  shipName: string;
  stowageId: string;
  stowageName: string;
  voyageNo: string;
  departurePort: string;
  departureTime: number;
  draftAft: number;
  draftFwd: number;
  results: VisibilityResult[];
  /** 极坐标图 dataURL */
  polarImage: string;
  /** 三维截图 dataURL */
  sceneImage: string;
  /** 深度全景 dataURL */
  panoramaImage?: string;
  notes?: string;
  createdAt: number;
}

/** 降层建议项 */
export interface LoweringSuggestion {
  cellKey: string;
  bay: number;
  row: number;
  tier: number;
  /** 当前层顶高 */
  currentTopZ: number;
  /** 降一层后顶高 */
  proposedTopZ: number;
  /** 移动箱量(40尺=2 bay 槽计 1 箱, 但影响列统计) */
  containersMoved: number;
  /** 降后船首盲区 m */
  projectedBowBlind: number;
  /** 降后最大扇形角 */
  projectedMaxSectorDeg: number;
  /** 降后是否全部合规 */
  projectedPass: boolean;
  improvementM: number;
}
