// 等距柱状深度全景: 从眼位向四周渲一圈, 输出深度纹理 dataURL 与每方位最近可见距离
import { mat4Multiply, mat4Perspective, mat4PanoramaView, mat4ShipTransform } from './mat4';
import { trimAngleRad, shipToWater } from '../engine/math3d';
import type { Ship, AzimuthSample, Vec3 } from '../types';

const PANO_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * uModel * vec4(aPos, 1.0); }`;

const PANO_FRAG = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  float depth = gl_FragCoord.z;
  // 近红远蓝的深度色调, 叠加盒色
  vec3 depthCol = mix(vec3(0.95, 0.3, 0.2), vec3(0.2, 0.4, 0.95), depth);
  outColor = vec4(mix(depthCol, uColor, 0.35), 1.0);
}`;

const CUBE = new Float32Array([
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
  -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
  0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
  -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
]);

export interface PanoramaBox {
  min: Vec3;
  max: Vec3;
  color: [number, number, number];
}

export interface PanoramaResult {
  dataUrl: string;
  /** 每个方位角列上的最近遮挡距离(自眼位, m) */
  nearestByAz: number[];
}

function makeProg(gl: WebGL2RenderingContext): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? '着色器编译失败');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, PANO_VERT));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, PANO_FRAG));
  gl.linkProgram(p);
  return p;
}

export class PanoramaRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private fbo: WebGLFramebuffer;
  private colorTex: WebGLTexture;
  private depthTex: WebGLTexture;
  private width: number;
  private sliceH: number;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(gl: WebGL2RenderingContext, width = 1024, sliceHeight = 256) {
    this.gl = gl;
    this.width = width;
    this.sliceH = sliceHeight;
    this.prog = makeProg(gl);
    for (const n of ['uModel', 'uViewProj', 'uColor']) this.loc[n] = gl.getUniformLocation(this.prog, n);
    this.vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);

    this.fbo = gl.createFramebuffer()!;
    this.colorTex = gl.createTexture()!;
    this.depthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, sliceHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, sliceHeight, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(ship: Ship, eye: Vec3, boxes: PanoramaBox[], slices = 96): PanoramaResult {
    const gl = this.gl;
    const tau = trimAngleRad(ship.draftAft, ship.draftFwd, ship.loa);
    shipToWater(eye, tau, ship.draftAft);
    const sliceW = Math.floor(this.width / slices);
    const near = 1;
    const far = 4000;
    const fov = (Math.PI * 2) / slices + 0.02; // 相邻切片略重叠避免缝隙
    const proj = mat4Perspective(fov, sliceW / this.sliceH, near, far);
    const shipMat = mat4ShipTransform(tau, ship.draftAft);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);

    const nearestByAz: number[] = new Array(slices).fill(Infinity);

    for (let i = 0; i < slices; i++) {
      const az = (i / slices) * Math.PI * 2;
      const view = mat4PanoramaView(az, 0);
      const vp = mat4Multiply(proj, view);
      gl.viewport(i * sliceW, 0, sliceW, this.sliceH);
      gl.clearColor(0.05, 0.08, 0.14, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(this.loc.uViewProj, false, vp);

      for (const b of boxes) {
        const cx = (b.min.x + b.max.x) / 2;
        const cy = (b.min.y + b.max.y) / 2;
        const cz = (b.min.z + b.max.z) / 2;
        const ts = new Float32Array(16);
        ts[0] = b.max.x - b.min.x; ts[5] = b.max.y - b.min.y; ts[10] = b.max.z - b.min.z;
        ts[12] = cx; ts[13] = cy; ts[14] = cz; ts[15] = 1;
        const model = mat4Multiply(shipMat, ts);
        gl.uniformMatrix4fv(this.loc.uModel, false, model);
        gl.uniform3fv(this.loc.uColor, b.color);
        gl.drawArrays(gl.TRIANGLES, 0, 36);
      }

      // 读回该切片中心列深度, 反投影为眼空间距离
      const depthBuf = new Float32Array(sliceW * this.sliceH);
      gl.readPixels(i * sliceW, 0, sliceW, this.sliceH, gl.DEPTH_COMPONENT, gl.FLOAT, depthBuf);
      let minNdc = 1;
      for (let yy = 0; yy < this.sliceH; yy++) {
        const d = depthBuf[yy * sliceW + Math.floor(sliceW / 2)];
        if (d < 1 && d > 0) minNdc = Math.min(minNdc, d);
      }
      if (minNdc < 1) {
        const eyeZ = (far + near) / (near - far) + (2 * far * near) / ((near - far) * minNdc);
        nearestByAz[i] = Math.abs(-eyeZ);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // FBO 纹理读回 -> 2D canvas(翻转 Y)生成 dataURL
    const tmp = document.createElement('canvas');
    tmp.width = this.width;
    tmp.height = this.sliceH;
    const ctx = tmp.getContext('2d')!;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
    const pixels = new Uint8Array(this.width * this.sliceH * 4);
    gl.readPixels(0, 0, this.width, this.sliceH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const imageData = ctx.createImageData(this.width, this.sliceH);
    for (let y = 0; y < this.sliceH; y++) {
      const src = (this.sliceH - 1 - y) * this.width * 4;
      imageData.data.set(pixels.subarray(src, src + this.width * 4), y * this.width * 4);
    }
    ctx.putImageData(imageData, 0, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return { dataUrl: tmp.toDataURL('image/png'), nearestByAz };
  }
}

/** 用解析采样结果填充(精度展示以 CPU 为准, GPU 全景负责可视化) */
export function compareWithCpuSamples(nearest: number[], samples: AzimuthSample[]): number {
  let maxDiff = 0;
  for (let i = 0; i < nearest.length; i++) {
    const cpu = samples[Math.round((i / nearest.length) * samples.length)];
    if (!cpu || !Number.isFinite(cpu.blindDistance)) continue;
    if (Number.isFinite(nearest[i])) maxDiff = Math.max(maxDiff, Math.abs(nearest[i] - cpu.blindDistance));
  }
  return maxDiff;
}
