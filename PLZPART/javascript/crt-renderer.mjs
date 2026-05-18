// Display renderer for the Second Reality PLZ plasma.
//
// Upscales the 320x400 VGA signal to the canvas's CSS size with LINEAR
// texture filtering and applies a CRT-style colour correction: decode the
// source as sRGB into linear light, apply a mild saturation boost (CRT
// phosphors look a touch more vivid than sRGB primaries), then re-encode
// with a slightly higher display gamma (2.4 vs sRGB's effective 2.2) for
// deeper shadows. No spatial effects — no blur, no scanlines, no mask, no
// halation.

const QUAD_VS = `#version 300 es
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const COLOR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSource;
uniform float uGamma;
uniform float uSaturation;

void main() {
  vec3 srgb = texture(uSource, vUV).rgb;
  vec3 lin = pow(max(srgb, 0.0), vec3(2.2));
  float luma = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  lin = mix(vec3(luma), lin, uSaturation);
  vec3 outC = pow(max(lin, 0.0), vec3(1.0 / uGamma));
  fragColor = vec4(outC, 1.0);
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

export const DEFAULT_CRT_PARAMS = Object.freeze({
  gamma: 2.4,
  saturation: 1.1,
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

    this.program = linkProgram(gl, QUAD_VS, COLOR_FS);
    this.uniforms = {
      uSource: gl.getUniformLocation(this.program, "uSource"),
      uGamma: gl.getUniformLocation(this.program, "uGamma"),
      uSaturation: gl.getUniformLocation(this.program, "uSaturation"),
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
    gl.uniform1f(this.uniforms.uGamma, this.params.gamma);
    gl.uniform1f(this.uniforms.uSaturation, this.params.saturation);

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
