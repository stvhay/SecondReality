// WebGL2 CRT renderer for the Second Reality PLZ plasma.
//
// Targets a high-end 1992 NEC MultiSync-class shadow-mask monitor showing
// a 320x400 VGA signal. No geometric distortion (no curvature, no warp,
// no bezel). Effects, in order of application:
//
//   1. CRT-gamma decode of the 6-bit VGA signal into linear light.
//   2. Vertical Gaussian scan-beam profile across three nearest source rows.
//   3. Horizontal Gaussian phosphor spread across three nearest source cols.
//   4. NEC-style staggered shadow-mask triads (R/G/B stripes with row offset).
//   5. Separable Gaussian halation blur, additively blended at low gain.
//   6. sRGB encode for display.
//
// Reference: RetroArch crt-royale (Tatsuya79 / TroggleMonkey). This is a
// simplified pipeline that keeps royale's beam + mask + halation core but
// drops everything tied to geometry (curvature, interlacing, bezel).

const QUAD_VS = `#version 300 es
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const BEAM_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uSourceSize;
uniform vec2 uOutputSize;
uniform float uGamma;
uniform float uScanSigma;
uniform float uPhosphorSigma;
uniform float uMaskStripePx;
uniform float uMaskRowPx;
uniform float uMaskLow;
uniform float uBrightness;

vec3 crtDecode(vec3 c) {
  return pow(max(c, 0.0), vec3(uGamma));
}

vec3 horizontalTap(float srcX, float srcY) {
  vec2 texel = 1.0 / uSourceSize;
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int dx = -1; dx <= 1; ++dx) {
    float xOff = float(dx);
    float w = exp(-(xOff * xOff) / (2.0 * uPhosphorSigma * uPhosphorSigma));
    vec2 uv = vec2((srcX + xOff + 0.5) * texel.x, (srcY + 0.5) * texel.y);
    vec3 c = texture(uSource, uv).rgb;
    acc += crtDecode(c) * w;
    wSum += w;
  }
  return acc / wSum;
}

void main() {
  vec2 outPx = vUV * uOutputSize;
  vec2 srcCoord = vec2(vUV.x * uSourceSize.x - 0.5,
                       vUV.y * uSourceSize.y - 0.5);

  float centerRow = floor(srcCoord.y + 0.5);
  vec3 beam = vec3(0.0);
  float wSum = 0.0;
  for (int dy = -1; dy <= 1; ++dy) {
    float rowY = centerRow + float(dy);
    float dist = srcCoord.y - rowY;
    float w = exp(-(dist * dist) / (2.0 * uScanSigma * uScanSigma));
    beam += horizontalTap(srcCoord.x, rowY) * w;
    wSum += w;
  }
  vec3 lit = beam / wSum;

  // Staggered shadow-mask triads. Each cell of (uMaskStripePx * 3) wide x
  // (uMaskRowPx * 2) tall produces six RGB sub-cells in a 3-phase pattern
  // shifted by one stripe every uMaskRowPx rows -- a coarse approximation
  // of an NEC MultiSync shadow mask.
  float stripeIndex = floor(mod(outPx.x, uMaskStripePx * 3.0) / uMaskStripePx);
  float rowIndex = floor(mod(outPx.y, uMaskRowPx * 2.0) / uMaskRowPx);
  int phase = int(mod(stripeIndex + rowIndex, 3.0));
  vec3 mask;
  if (phase == 0) mask = vec3(1.0, uMaskLow, uMaskLow);
  else if (phase == 1) mask = vec3(uMaskLow, 1.0, uMaskLow);
  else mask = vec3(uMaskLow, uMaskLow, 1.0);

  fragColor = vec4(lit * mask * uBrightness, 1.0);
}
`;

// Separable Gaussian blur for halation. Kernel is symmetric, 25 taps wide.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uInput;
uniform vec2 uTexelDir;
uniform float uSigma;

const int KERNEL_RADIUS = 12;

void main() {
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int i = -KERNEL_RADIUS; i <= KERNEL_RADIUS; ++i) {
    float f = float(i);
    float w = exp(-(f * f) / (2.0 * uSigma * uSigma));
    vec3 c = texture(uInput, vUV + uTexelDir * f).rgb;
    acc += c * w;
    wSum += w;
  }
  fragColor = vec4(acc / wSum, 1.0);
}
`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uLit;
uniform sampler2D uHalation;
uniform float uHalationGain;
uniform float uInvGamma;

vec3 crtEncode(vec3 c) {
  return pow(max(c, 0.0), vec3(uInvGamma));
}

void main() {
  vec3 lit = texture(uLit, vUV).rgb;
  vec3 hal = texture(uHalation, vUV).rgb;
  fragColor = vec4(crtEncode(lit + hal * uHalationGain), 1.0);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`CRT shader compile failed: ${log}`);
  }
  return shader;
}

function linkProgram(gl, vsSource, fsSource) {
  const program = gl.createProgram();
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`CRT shader link failed: ${log}`);
  }
  return program;
}

function createTexture(gl, width, height, { internalFormat = gl.RGBA8, filter = gl.LINEAR } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createFramebuffer(gl, texture) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("CRT framebuffer incomplete");
  }
  return fb;
}

export const DEFAULT_CRT_PARAMS = Object.freeze({
  gamma: 2.2,
  scanSigma: 0.7,
  phosphorSigma: 0.55,
  maskStripePx: 3.0,
  maskRowPx: 2.0,
  maskLow: 0.30,
  brightness: 1.65,
  halationSigma: 4.5,
  halationGain: 0.32,
  maxPixelRatio: 2.0,
});

export class CRTRenderer {
  constructor(canvas, sourceWidth, sourceHeight, params = {}) {
    this.canvas = canvas;
    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;
    this.params = { ...DEFAULT_CRT_PARAMS, ...params };

    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error("WebGL2 is required for the CRT renderer");
    }
    this.gl = gl;

    this.programs = {
      beam: linkProgram(gl, QUAD_VS, BEAM_FS),
      blur: linkProgram(gl, QUAD_VS, BLUR_FS),
      composite: linkProgram(gl, QUAD_VS, COMPOSITE_FS),
    };
    this.uniforms = {
      beam: this._collectUniforms(this.programs.beam, [
        "uSource", "uSourceSize", "uOutputSize",
        "uGamma", "uScanSigma", "uPhosphorSigma",
        "uMaskStripePx", "uMaskRowPx", "uMaskLow", "uBrightness",
      ]),
      blur: this._collectUniforms(this.programs.blur, [
        "uInput", "uTexelDir", "uSigma",
      ]),
      composite: this._collectUniforms(this.programs.composite, [
        "uLit", "uHalation", "uHalationGain", "uInvGamma",
      ]),
    };

    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1,  3, -1,  -1, 3]),
      gl.STATIC_DRAW,
    );
    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.sourceTexture = createTexture(gl, sourceWidth, sourceHeight, {
      internalFormat: gl.RGBA8,
      filter: gl.NEAREST,
    });

    this.fbWidth = 0;
    this.fbHeight = 0;
    this.lit = null;
    this.halH = null;
    this.halV = null;
    this.litFB = null;
    this.halHFB = null;
    this.halVFB = null;
  }

  _collectUniforms(program, names) {
    const gl = this.gl;
    const out = {};
    for (const name of names) {
      out[name] = gl.getUniformLocation(program, name);
    }
    return out;
  }

  _ensureFramebuffers(width, height) {
    if (this.fbWidth === width && this.fbHeight === height) return;
    const gl = this.gl;
    const old = [this.lit, this.halH, this.halV, this.litFB, this.halHFB, this.halVFB];
    for (const obj of old) {
      if (!obj) continue;
      if (obj instanceof WebGLTexture) gl.deleteTexture(obj);
      else gl.deleteFramebuffer(obj);
    }
    this.lit = createTexture(gl, width, height);
    this.halH = createTexture(gl, width, height);
    this.halV = createTexture(gl, width, height);
    this.litFB = createFramebuffer(gl, this.lit);
    this.halHFB = createFramebuffer(gl, this.halH);
    this.halVFB = createFramebuffer(gl, this.halV);
    this.fbWidth = width;
    this.fbHeight = height;
  }

  _bindOutput(fb, width, height) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, width, height);
  }

  _drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(rgbaSource) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.params.maxPixelRatio);
    const cssWidth = Math.max(1, this.canvas.clientWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));

    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    this._ensureFramebuffers(width, height);

    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0,
      0, 0,
      this.sourceWidth, this.sourceHeight,
      gl.RGBA, gl.UNSIGNED_BYTE,
      rgbaSource,
    );

    const p = this.params;

    // Pass 1: source -> lit (scan beam + phosphor spread + mask)
    this._bindOutput(this.litFB, width, height);
    gl.useProgram(this.programs.beam);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(this.uniforms.beam.uSource, 0);
    gl.uniform2f(this.uniforms.beam.uSourceSize, this.sourceWidth, this.sourceHeight);
    gl.uniform2f(this.uniforms.beam.uOutputSize, width, height);
    gl.uniform1f(this.uniforms.beam.uGamma, p.gamma);
    gl.uniform1f(this.uniforms.beam.uScanSigma, p.scanSigma);
    gl.uniform1f(this.uniforms.beam.uPhosphorSigma, p.phosphorSigma);
    gl.uniform1f(this.uniforms.beam.uMaskStripePx, p.maskStripePx);
    gl.uniform1f(this.uniforms.beam.uMaskRowPx, p.maskRowPx);
    gl.uniform1f(this.uniforms.beam.uMaskLow, p.maskLow);
    gl.uniform1f(this.uniforms.beam.uBrightness, p.brightness);
    this._drawQuad();

    // Pass 2: horizontal halation blur of lit -> halH
    this._bindOutput(this.halHFB, width, height);
    gl.useProgram(this.programs.blur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lit);
    gl.uniform1i(this.uniforms.blur.uInput, 0);
    gl.uniform2f(this.uniforms.blur.uTexelDir, 1 / width, 0);
    gl.uniform1f(this.uniforms.blur.uSigma, p.halationSigma);
    this._drawQuad();

    // Pass 3: vertical halation blur of halH -> halV
    this._bindOutput(this.halVFB, width, height);
    gl.useProgram(this.programs.blur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.halH);
    gl.uniform1i(this.uniforms.blur.uInput, 0);
    gl.uniform2f(this.uniforms.blur.uTexelDir, 0, 1 / height);
    gl.uniform1f(this.uniforms.blur.uSigma, p.halationSigma);
    this._drawQuad();

    // Pass 4: composite to canvas
    this._bindOutput(null, width, height);
    gl.useProgram(this.programs.composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lit);
    gl.uniform1i(this.uniforms.composite.uLit, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.halV);
    gl.uniform1i(this.uniforms.composite.uHalation, 1);
    gl.uniform1f(this.uniforms.composite.uHalationGain, p.halationGain);
    gl.uniform1f(this.uniforms.composite.uInvGamma, 1.0 / p.gamma);
    this._drawQuad();
  }

  setParams(params) {
    this.params = { ...this.params, ...params };
  }

  dispose() {
    const gl = this.gl;
    for (const program of Object.values(this.programs)) gl.deleteProgram(program);
    for (const obj of [this.lit, this.halH, this.halV, this.sourceTexture]) {
      if (obj) gl.deleteTexture(obj);
    }
    for (const fb of [this.litFB, this.halHFB, this.halVFB]) {
      if (fb) gl.deleteFramebuffer(fb);
    }
    if (this.quadVBO) gl.deleteBuffer(this.quadVBO);
    if (this.quadVAO) gl.deleteVertexArray(this.quadVAO);
  }
}
