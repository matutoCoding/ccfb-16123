# 驾驶台视域核查系统 BVS (Bridge Visibility System)

网页版集装箱船驾驶台视域核查工具，对标 **SOLAS 第 V 章第 22 条**及 MSC/Circ.1149 指导。
纯前端实现：TypeScript + React + **手写 WebGL2 着色器** + IndexedDB 本地存储，无需后端。

## 启动

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
npm run test       # 几何精度 / 扇形识别 / 夜航 / 性能 共 14 项测试
```

首次打开自动在 IndexedDB 播种两条船及三个航次配载：

| 船型 | 配载 | 性质 |
|---|---|---|
| MV ORIENTAL PEARL (8000 TEU, LOA 334m) | V22 欧线出港 | 合规（外侧留视线走廊，三眼合并全判项通过） |
| MV ORIENTAL PEARL (8000 TEU) | V23 美线加班 | 违规（外侧堆满、前部加高，扇形 148° 不过） |
| MV COASTAL TRADER (1800 TEU, LOA 183m) | V08 东南亚支线 | 合规 |

## 五个页面

1. **船型库** — 主尺度、驾驶台/眼位（含窗框竖梃角区间）、舱盖/绑扎桥/克令吊/前桅等固定遮挡物 AABB 摆放；支持配载软件 bay 位文本导入（`BAY/ROW/TIER` 与 CSV 两种语法）。
2. **配载编辑** — bay/row/tier 网格放箱，20/40 尺、高箱 HC、危险品 DG（IMDG 类别）、空箱 MT 标记；右键删箱、单列降层。
3. **吃水纵倾** — 首尾吃水输入，船体绕 AP 龙骨坐标旋转，各眼位实时眼高联动；压载前后视域对比。
4. **视域核查** — 多眼位切换/双眼合并、SOLAS 逐项判定、极坐标盲区图、WebGL2 三维场景（水面盲区铺色、擦边箱列高亮、点列试算降层）、自动降层建议（单箱 + 成组清空外侧走廊）、夜航号灯核查、等距柱状深度全景。
5. **航次报告** — 每航次出港结果归档，内嵌极坐标快照与三维截图，可打印/导出 PDF，港口国检查直接出示。

## 几何引擎（精度关键）

视域计算**不使用 GPU 深度缓冲**（像素量化无法保证米级精度），而采用 CPU 解析几何：

- 船体坐标系 → 水面坐标系的纵倾旋转（`shipToWater`），遮挡盒随纵倾成为 OBB；
- 对每个方位角取过眼位的垂直平面，求 OBB 截面凸多边形；
- 上切线 = 截面各顶点俯角正切 `(eye.z − z_v)/r_v` 的最小值，水面交点 `R = h / min(...)`；
- 平吃水、箱顶为矩形远上角时退化为手算公式 `R = h·d/(h−h₀)`，浮点级一致；
- 船体固有盲区（船壳/艏楼）豁免 SOLAS 扇形角度判项，仅货物/设备/竖梃遮挡计入 10°/20°；
- 舷外延伸不足 1m 的擦边遮挡不计盲区（PSC 实操口径）。

### 硬指标验证（`tests/visibility.test.ts`）

- **精度**：平吃水单箱与手算公式误差 < 0.01m；纵倾实船单箱端到端误差 < 1m；
- **性能**：8000 箱级满载、0.25° 步长全圆 1440 方位、三眼位求解 < 200ms（实测 30–180ms）。

## 目录结构

```
src/
  engine/      math3d(坐标变换/OBB) stowage(配载几何/bay文本) visibility(求解核心) suggest(降层) night(号灯)
  webgl/       mat4 renderer(三维场景) panorama(等距柱状全景) —— 全部 GLSL 手写
  db/          IndexedDB 封装
  data/        种子船型与配载生成
  pages/       五个页面
  components/  PolarChart / View3D / ErrorBoundary
```
