// 列主序 4x4 矩阵 (Float32Array)
export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Mat4 {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz);
  zx /= len; zy /= len; zz /= len;
  // x = up × z
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  xx /= len; xy /= len; xz /= len;
  // y = z × x
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

/** 等距柱状全景用: 给定方位角/仰角的观察矩阵(眼位在原点) */
export function mat4PanoramaView(azRad: number, elRad: number): Mat4 {
  const ce = Math.cos(elRad);
  const se = Math.sin(elRad);
  const ca = Math.cos(azRad);
  const sa = Math.sin(azRad);
  // 前方向 f
  const fx = ce * ca;
  const fy = -ce * sa;
  const fz = se;
  // 右方向 r = f × worldUp(worldUp=(0,0,1))
  const rx = fy * 1 - fz * 0;
  const ry = fz * 0 - fx * 1;
  const rz = fx * 0 - fy * 0;
  // 上 u = r × f
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const m = new Float32Array(16);
  m[0] = rx; m[1] = ux; m[2] = -fx; m[3] = 0;
  m[4] = ry; m[5] = uy; m[6] = -fy; m[7] = 0;
  m[8] = rz; m[9] = uz; m[10] = -fz; m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
  return m;
}

export function mat4Translate(x: number, y: number, z: number): Mat4 {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** 绕 y(船体横向轴)旋转 τ, 再平移 —— 船体->水面 */
export function mat4ShipTransform(tau: number, draftAft: number): Mat4 {
  const c = Math.cos(tau);
  const s = Math.sin(tau);
  const m = mat4Identity();
  // 船 x -> (c,0,s); 船 z -> (-s,0,c)
  m[0] = c; m[2] = s;
  m[8] = -s; m[10] = c;
  m[14] = -draftAft * c;
  return m;
}
