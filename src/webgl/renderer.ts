// WebGL2 三维场景渲染器: 船体/集装箱/遮挡物/眼位/水面盲区铺色, 支持拾取与截图
import { mat4Identity, mat4Multiply, mat4Perspective, mat4LookAt, mat4ShipTransform, type Mat4 } from './mat4';
import { trimAngleRad, shipToWater } from '../engine/math3d';
import type { Ship, AzimuthSample, Vec3 } from '../types';
import type { SceneBox } from '../engine/visibility';

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProj * w;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uEye;
uniform int uMode; // 0 正常着色 1 纯色 2 发光高亮
out vec4 outColor;
void main() {
  if (uMode == 1) { outColor = vec4(uColor, uAlpha); return; }
  if (uMode == 2) {
    outColor = vec4(uColor * 1.35, uAlpha);
    return;
  }
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.5, -0.6, 0.8));
  float diff = max(dot(n, lightDir), 0.0);
  vec3 viewDir = normalize(uEye - vWorld);
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.25;
  vec3 col = uColor * (0.35 + 0.65 * diff) + vec3(fres);
  outColor = vec4(col, uAlpha);
}`;

// 线框/线段着色
const LINE_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;
const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor, 1.0); }`;

export interface RenderBox {
  id: string;
  min: Vec3;
  max: Vec3;
  color: [number, number, number];
  cellKey?: string;
  kind: string;
}

export interface CameraState {
  yaw: number;   // 绕 z
  pitch: number; // 俯仰
  dist: number;
  target: [number, number, number];
}

interface GPUMesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  count: number;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('程序链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

const CUBE_VERTS = new Float32Array([
  // pos(3) normal(3), 每面 6 顶点
  -0.5, -0.5, 0.5, 0, 0, 1, 0.5, -0.5, 0.5, 0, 0, 1, 0.5, 0.5, 0.5, 0, 0, 1,
  0.5, 0.5, 0.5, 0, 0, 1, -0.5, 0.5, 0.5, 0, 0, 1, -0.5, -0.5, 0.5, 0, 0, 1,
  0.5, -0.5, -0.5, 0, 0, -1, -0.5, -0.5, -0.5, 0, 0, -1, -0.5, 0.5, -0.5, 0, 0, -1,
  -0.5, 0.5, -0.5, 0, 0, -1, 0.5, 0.5, -0.5, 0, 0, -1, 0.5, -0.5, -0.5, 0, 0, -1,
  -0.5, 0.5, 0.5, 0, 1, 0, 0.5, 0.5, 0.5, 0, 1, 0, 0.5, 0.5, -0.5, 0, 1, 0,
  0.5, 0.5, -0.5, 0, 1, 0, -0.5, 0.5, -0.5, 0, 1, 0, -0.5, 0.5, 0.5, 0, 1, 0,
  -0.5, -0.5, -0.5, 0, -1, 0, 0.5, -0.5, -0.5, 0, -1, 0, 0.5, -0.5, 0.5, 0, -1, 0,
  0.5, -0.5, 0.5, 0, -1, 0, -0.5, -0.5, 0.5, 0, -1, 0, -0.5, -0.5, -0.5, 0, -1, 0,
  0.5, -0.5, 0.5, 1, 0, 0, 0.5, -0.5, -0.5, 1, 0, 0, 0.5, 0.5, -0.5, 1, 0, 0,
  0.5, 0.5, -0.5, 1, 0, 0, 0.5, 0.5, 0.5, 1, 0, 0, 0.5, -0.5, 0.5, 1, 0, 0,
  -0.5, -0.5, -0.5, -1, 0, 0, -0.5, -0.5, 0.5, -1, 0, 0, -0.5, 0.5, 0.5, -1, 0, 0,
  -0.5, 0.5, 0.5, -1, 0, 0, -0.5, 0.5, -0.5, -1, 0, 0, -0.5, -0.5, -0.5, -1, 0, 0,
]);

export class SceneRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private lineProg: WebGLProgram;
  private cubeMesh: GPUMesh;
  private uniformLocations: Record<string, WebGLUniformLocation | null> = {};
  private lineLocations: Record<string, WebGLUniformLocation | null> = {};
  private boxes: RenderBox[] = [];
  private highlighted = new Set<string>();
  private selected: string | null = null;
  private camera: CameraState = { yaw: -0.5, pitch: 0.55, dist: 260, target: [150, 0, 8] };
  private ship!: Ship;
  private tau = 0;
  private blindMesh: GPUMesh | null = null;
  private waterMesh: GPUMesh | null = null;
  private eyeMarkers: { pos: Vec3; color: [number, number, number]; label: string }[] = [];
  private activeEyePos: Vec3 | null = null;
  private nightMode = false;
  onPick?: (box: RenderBox | null) => void;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.prog = program(gl, VERT, FRAG);
    this.lineProg = program(gl, LINE_VERT, LINE_FRAG);
    for (const n of ['uModel', 'uViewProj', 'uColor', 'uAlpha', 'uEye', 'uMode']) {
      this.uniformLocations[n] = gl.getUniformLocation(this.prog, n);
    }
    for (const n of ['uViewProj', 'uColor']) {
      this.lineLocations[n] = gl.getUniformLocation(this.lineProg, n);
    }
    this.cubeMesh = this.uploadMesh(CUBE_VERTS);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private uploadMesh(data: Float32Array): GPUMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    return { vao, vbo, count: data.length / 6 };
  }

  setShip(ship: Ship) {
    this.ship = ship;
    this.tau = trimAngleRad(ship.draftAft, ship.draftFwd, ship.loa);
    this.camera.target = [ship.loa * 0.45, 0, ship.eyeHeight * 0.25];
    this.camera.dist = ship.loa * 0.85;
    this.eyeMarkers = ship.eyePositions.map((e, i) => ({
      pos: e.pos,
      color: i === 0 ? ([1, 0.85, 0.2] as [number, number, number]) : ([0.3, 0.9, 1] as [number, number, number]),
      label: e.name,
    }));
  }

  setBoxes(boxes: RenderBox[]) {
    this.boxes = boxes;
  }

  setHighlight(ids: string[]) {
    this.highlighted = new Set(ids);
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  setNightMode(on: boolean) {
    this.nightMode = on;
  }

  setActiveEye(pos: Vec3 | null) {
    this.activeEyePos = pos;
  }

  setCamera(cam: Partial<CameraState>) {
    Object.assign(this.camera, cam);
  }

  getCamera(): CameraState {
    return { ...this.camera };
  }

  /** 由视域采样构建水面盲区扇形铺盖 */
  setBlindOverlay(samples: AzimuthSample[], eye: Vec3) {
    const gl = this.gl;
    const eyeW = shipToWater(eye, this.tau, this.ship.draftAft);
    const verts: number[] = [];
    const step = (samples[1]?.azimuth ?? 0.25) * Math.PI / 180;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (!s.mullionBlocked && (Number.isFinite(s.blindDistance) && s.blindDistance <= 1.0)) continue;
      // 三维铺色只展示前向半弧(270°..360°..90°), 与 SOLAS 考核口径一致
      const forward = s.azimuth <= 90 + 1e-6 || s.azimuth >= 270 - 1e-6;
      if (!forward) continue;
      const a0 = s.azimuth * Math.PI / 180;
      const a1 = a0 + step;
      const rMax = Number.isFinite(s.blindDistance) ? s.blindDistance + this.ship.loa * 0.36 : this.ship.loa * 1.2;
      const r0 = 0.1;
      const p = (a: number, r: number): [number, number, number] => [
        eyeW.x + Math.cos(a) * r,
        eyeW.y - Math.sin(a) * r,
        0.15,
      ];
      const [x0, y0, z0] = p(a0, r0);
      const [x1, y1, z1] = p(a1, r0);
      const [x2, y2, z2] = p(a1, rMax);
      const [x3, y3, z3] = p(a0, rMax);
      const n: [number, number, number] = [0, 0, 1];
      verts.push(x0, y0, z0, ...n, x1, y1, z1, ...n, x2, y2, z2, ...n);
      verts.push(x0, y0, z0, ...n, x2, y2, z2, ...n, x3, y3, z3, ...n);
    }
    if (this.blindMesh) {
      gl.deleteVertexArray(this.blindMesh.vao);
      gl.deleteBuffer(this.blindMesh.vbo);
      this.blindMesh = null;
    }
    if (verts.length) this.blindMesh = this.uploadMesh(new Float32Array(verts));
  }

  private viewProj(): { vp: Mat4; eye: [number, number, number] } {
    const { yaw, pitch, dist, target } = this.camera;
    const eye: [number, number, number] = [
      target[0] + dist * Math.cos(pitch) * Math.cos(yaw),
      target[1] + dist * Math.cos(pitch) * Math.sin(yaw),
      target[2] + dist * Math.sin(pitch),
    ];
    const view = mat4LookAt(eye, target, [0, 0, 1]);
    const proj = mat4Perspective((50 * Math.PI) / 180, this.canvas.width / this.canvas.height, 0.5, 4000);
    return { vp: mat4Multiply(proj, view), eye };
  }

  private drawCube(model: Mat4, color: [number, number, number], alpha: number, mode: number, eye: [number, number, number]) {
    const gl = this.gl;
    const u = this.uniformLocations;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.cubeMesh.vao);
    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniform3fv(u.uColor, color);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform3fv(u.uEye, eye);
    gl.uniform1i(u.uMode, mode);
    gl.drawArrays(gl.TRIANGLES, 0, this.cubeMesh.count);
  }

  private boxModel(min: Vec3, max: Vec3): Mat4 {
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    const sx = max.x - min.x;
    const sy = max.y - min.y;
    const sz = max.z - min.z;
    // model = shipTransform * T * S
    const ts = new Float32Array(16);
    ts[0] = sx; ts[5] = sy; ts[10] = sz;
    ts[12] = cx; ts[13] = cy; ts[14] = cz; ts[15] = 1;
    return mat4Multiply(mat4ShipTransform(this.tau, this.ship.draftAft), ts);
  }

  render() {
    const gl = this.gl;
    const { vp, eye } = this.viewProj();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...(this.nightMode ? ([0.02, 0.03, 0.07, 1] as [number, number, number, number]) : ([0.62, 0.74, 0.84, 1] as [number, number, number, number])));
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const u = this.uniformLocations;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(u.uViewProj, false, vp);

    // 水面(独立网格, 直接绘制)
    if (!this.waterMesh) {
      const size = this.ship.loa * 2.2;
      this.waterMesh = this.uploadMesh(new Float32Array([
        -size, -size, 0, 0, 0, 1, size, -size, 0, 0, 0, 1, size, size, 0, 0, 0, 1,
        -size, -size, 0, 0, 0, 1, size, size, 0, 0, 0, 1, -size, size, 0, 0, 0, 1,
      ]));
    }
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.waterMesh.vao);
    gl.uniformMatrix4fv(u.uModel, false, mat4Identity());
    gl.uniform3fv(u.uColor, this.nightMode ? [0.04, 0.08, 0.16] : [0.18, 0.42, 0.58]);
    gl.uniform1f(u.uAlpha, 0.82);
    gl.uniform3fv(u.uEye, eye);
    gl.uniform1i(u.uMode, 1);
    gl.drawArrays(gl.TRIANGLES, 0, this.waterMesh.count);

    // 盲区铺色
    if (this.blindMesh) {
      gl.bindVertexArray(this.blindMesh.vao);
      gl.uniformMatrix4fv(u.uModel, false, mat4Identity());
      gl.uniform3fv(u.uColor, [1, 0.25, 0.2]);
      gl.uniform1f(u.uAlpha, 0.32);
      gl.uniform1i(u.uMode, 1);
      gl.drawArrays(gl.TRIANGLES, 0, this.blindMesh.count);
    }

    // 实体盒
    for (const b of this.boxes) {
      const isHi = this.highlighted.has(b.id) || (b.cellKey && this.highlighted.has(b.cellKey));
      const isSel = this.selected === b.id || (b.cellKey && this.selected === b.cellKey);
      const mode = isHi || isSel ? 2 : 0;
      const color: [number, number, number] = isSel
        ? [1, 0.9, 0.2]
        : isHi
          ? [1, 0.45, 0.15]
          : b.color;
      this.drawCube(this.boxModel(b.min, b.max), color, b.kind === 'hull' ? 0.92 : 0.96, mode, eye);
    }

    // 眼位标记(小球用缩小立方体代替, 避免额外网格)
    for (const m of this.eyeMarkers) {
      const s = 1.2;
      const model = this.boxModel(
        { x: m.pos.x - s, y: m.pos.y - s, z: m.pos.z - s },
        { x: m.pos.x + s, y: m.pos.y + s, z: m.pos.z + s },
      );
      this.drawCube(model, m.color, 1, 2, eye);
    }
    // 当前激活眼位的视线参考线
    if (this.activeEyePos) {
      this.drawSightRays(this.activeEyePos, vp);
    }
  }

  private drawSightRays(eyeShip: Vec3, vp: Mat4) {
    const gl = this.gl;
    const ew = shipToWater(eyeShip, this.tau, this.ship.draftAft);
    const lines: number[] = [];
    for (let az = -90; az <= 90; az += 15) {
      const a = az * Math.PI / 180;
      const r = 120;
      lines.push(ew.x, ew.y, ew.z, ew.x + Math.cos(a) * r, ew.y - Math.sin(a) * r, ew.z - 2);
    }
    const buf = gl.createBuffer()!;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(this.lineLocations.uViewProj, false, vp);
    gl.uniform3fv(this.lineLocations.uColor, [1, 1, 0.4]);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);
    gl.deleteBuffer(buf);
    gl.deleteVertexArray(vao);
  }

  /** 屏幕坐标拾取 -> 盒(射线与 AABB 船体坐标求交, 取最近) */
  pick(clientX: number, clientY: number): RenderBox | null {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const { vp, eye } = this.viewProj();
    // 反投影得到世界射线
    const inv = invert4(vp);
    const nearP = transform4(inv, [nx, ny, -1, 1]);
    const farP = transform4(inv, [nx, ny, 1, 1]);
    const o = [nearP[0] / nearP[3], nearP[1] / nearP[3], nearP[2] / nearP[3]];
    const f = [farP[0] / farP[3] - o[0], farP[1] / farP[3] - o[1], farP[2] / farP[3] - o[2]];
    const fl = Math.hypot(f[0], f[1], f[2]);
    const dir = [f[0] / fl, f[1] / fl, f[2] / fl];

    const tau = this.tau;
    const c = Math.cos(tau);
    const s = Math.sin(tau);
    // 世界射线 -> 船体坐标
    const toShip = (p: number[]): [number, number, number] => {
      const x = p[0];
      const z = p[2] + this.ship.draftAft * c;
      return [c * x - s * z, p[1], s * x + c * z];
    };
    const oS = toShip(o);
    // 方向旋转: 船 x 轴 (c,0,s), 船 z 轴 (-s,0,c)
    const dS: [number, number, number] = [
      c * dir[0] - s * dir[2],
      dir[1],
      s * dir[0] + c * dir[2],
    ];
    let best: { box: RenderBox; t: number } | null = null;
    for (const b of this.boxes) {
      const t = rayAabb(oS, dS, b.min, b.max);
      if (t !== null && (!best || t < best.t)) best = { box: b, t };
    }
    void eye;
    return best?.box ?? null;
  }

  screenshot(): string {
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  resize(w: number, h: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }
}

function rayAabb(o: number[], d: [number, number, number], min: Vec3, max: Vec3): number | null {
  let tMin = 0;
  let tMax = Infinity;
  const axes: ['x', 'y', 'z'] = ['x', 'y', 'z'];
  for (const ax of axes) {
    const oi = o[ax === 'x' ? 0 : ax === 'y' ? 1 : 2];
    const di = d[ax === 'x' ? 0 : ax === 'y' ? 1 : 2];
    if (Math.abs(di) < 1e-12) {
      if (oi < min[ax] || oi > max[ax]) return null;
    } else {
      const t1 = (min[ax] - oi) / di;
      const t2 = (max[ax] - oi) / di;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
      if (tMin > tMax) return null;
    }
  }
  return tMin;
}

function invert4(m: Mat4): Mat4 {
  const out = new Float32Array(16);
  const a = [...m];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const rows = [0, 1, 2, 3].filter((r) => r !== i);
      const cols = [0, 1, 2, 3].filter((c) => c !== j);
      let det = 0;
      const sub = rows.map((r) => cols.map((c) => a[r * 4 + c]));
      const d2 = (x: number[][]): number =>
        x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) -
        x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) +
        x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0]);
      det = d2(sub);
      const cof = ((i + j) % 2 ? -1 : 1) * det;
      out[j * 4 + i] = cof;
    }
  }
  let det = 0;
  for (let j = 0; j < 4; j++) det += a[j] * out[j * 4];
  for (let k = 0; k < 16; k++) out[k] /= det;
  return out;
}

function transform4(m: Mat4, v: [number, number, number, number]): [number, number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

export function sceneBoxToRender(b: SceneBox): RenderBox {
  const palette: Record<string, [number, number, number]> = {
    hull: [0.32, 0.36, 0.42],
    hatchcover: [0.45, 0.4, 0.32],
    lashing: [0.55, 0.5, 0.42],
    crane: [0.7, 0.55, 0.2],
    foremast: [0.6, 0.62, 0.66],
    wheelhouse: [0.4, 0.55, 0.65],
    container: [0.75, 0.35, 0.28],
  };
  return { id: b.id, min: b.min, max: b.max, color: palette[b.kind] ?? [0.8, 0.8, 0.8], cellKey: b.cellKey, kind: b.kind };
}
