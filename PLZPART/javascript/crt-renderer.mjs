// Display renderer for the Second Reality PLZ plasma.
//
// Upscales the 320x400 VGA signal to the canvas's CSS size and applies a
// 3x3 Gaussian blur sized in source-pixel units. With sigma below 1 source
// pixel the filter softens the nearest-neighbour staircase you would
// otherwise see at fractional scales without smearing detail across
// neighbouring source pixels.
//
// This replaces an earlier multi-pass CRT pipeline (scan beam, RGB stripe
// mask, halation) that produced visible wobble and banding at common
// devicePixelRatios. The UI still labels the mode "Monitor" — that's what
// your browser is doing here, just a touch softer than nearest-neighbour.

const QUAD_VS = `#version 300 es
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// 9x9 Gaussian in source-pixel coordinates. Sigma is measured in source
// pixels, so the blur footprint is constant relative to source pixels
// regardless of how much the browser stretches the canvas. Radius 4 keeps
// truncation imperceptible for sigma up to ~2 (the slider's max). LINEAR
// source filtering means each tap is itself a bilinear sample at a
// fractional source position, so output pixels between source samples stay
// smooth. A max() guard on twoS2 lets sigma == 0 collapse cleanly to the
// centre sample without producing NaN.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uSourceSize;
uniform float uBlurSigma;

const int RADIUS = 4;

void main() {
  vec2 srcPx = vUV * uSourceSize;
  vec2 texel = 1.0 / uSourceSize;
  float twoS2 = max(2.0 * uBlurSigma * uBlurSigma, 1e-6);
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for (int dy = -RADIUS; dy <= RADIUS; ++dy) {
    for (int dx = -RADIUS; dx <= RADIUS; ++dx) {
      vec2 off = vec2(float(dx), float(dy));
      float w = exp(-dot(off, off) / twoS2);
      vec2 uv = (srcPx + off) * texel;
      acc += texture(uSource, uv).rgb * w;
      wSum += w;
    }
  }
  fragColor = vec4(acc / wSum, 1.0);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Display shader compile failed: ${log}`);
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
    throw new Error(`Display shader link failed: ${log}`);
  }
  return program;
}

function createSourceTexture(gl, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// Sigma is in source-pixel units. 0.4 source pixels gives FWHM ~0.94
// source pixels: softens pixel edges, does not smear neighbours together.
export const DEFAULT_CRT_PARAMS = Object.freeze({
  blurSigma: 0.4,
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
      throw new Error("WebGL2 is required for the display renderer");
    }
    this.gl = gl;

    this.program = linkProgram(gl, QUAD_VS, BLUR_FS);
    this.uniforms = {
      uSource: gl.getUniformLocation(this.program, "uSource"),
      uSourceSize: gl.getUniformLocation(this.program, "uSourceSize"),
      uBlurSigma: gl.getUniformLocation(this.program, "uBlurSigma"),
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

    this.sourceTexture = createSourceTexture(gl, sourceWidth, sourceHeight);
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

    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0,
      0, 0,
      this.sourceWidth, this.sourceHeight,
      gl.RGBA, gl.UNSIGNED_BYTE,
      rgbaSource,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(this.uniforms.uSource, 0);
    gl.uniform2f(this.uniforms.uSourceSize, this.sourceWidth, this.sourceHeight);
    gl.uniform1f(this.uniforms.uBlurSigma, this.params.blurSigma);

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  setParams(params) {
    this.params = { ...this.params, ...params };
  }

  dispose() {
    const gl = this.gl;
    if (this.program) gl.deleteProgram(this.program);
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    if (this.quadVBO) gl.deleteBuffer(this.quadVBO);
    if (this.quadVAO) gl.deleteVertexArray(this.quadVAO);
  }
}
