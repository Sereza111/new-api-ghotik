/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

type AtmosphereOptions = {
  canvas: HTMLCanvasElement
}

type EngravingOptions = {
  host: HTMLElement
  artCanvas: HTMLCanvasElement
  imageUrl: string
  onReady: (ready: boolean) => void
}

type UniformLocations = Record<string, WebGLUniformLocation | null>

class MotionClock {
  private readonly startedAt: number
  private pausedAt: number
  private pausedDuration = 0
  private paused: boolean

  constructor(paused = false) {
    this.startedAt = performance.now()
    this.pausedAt = paused ? this.startedAt : 0
    this.paused = paused
  }

  time(now = performance.now()): number {
    const end = this.paused ? this.pausedAt : now
    return Math.max(0, end - this.startedAt - this.pausedDuration) / 1000
  }

  setPaused(next: boolean, now = performance.now()): void {
    if (next === this.paused) return
    if (next) {
      this.pausedAt = now
    } else {
      this.pausedDuration += now - this.pausedAt
    }
    this.paused = next
  }
}

const vertexSource = `#version 300 es
  precision highp float;
  out vec2 vUv;
  void main() {
    vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vUv = position;
    gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
  }
`

function compileProgram(
  gl: WebGL2RenderingContext,
  fragmentSource: string
): WebGLProgram {
  function compile(type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('Unable to create WebGL shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Unable to compile shader'
      gl.deleteShader(shader)
      throw new Error(message)
    }
    return shader
  }

  const program = gl.createProgram()
  if (!program) throw new Error('Unable to create WebGL program')
  const vertexShader = compile(gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message =
      gl.getProgramInfoLog(program) || 'Unable to link WebGL program'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

class AtmosphereShader {
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext | null
  private program: WebGLProgram | null = null
  private locations: UniformLocations = {}
  private pointer: [number, number] = [0.5, 0.5]

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    })
    if (!this.gl) return

    const fragmentSource = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 outColor;
      uniform vec2 uResolution;
      uniform vec2 uPointer;
      uniform float uTime;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x),
          f.y
        );
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.52;
        mat2 rotation = mat2(0.82, -0.57, 0.57, 0.82);
        for (int i = 0; i < 4; i++) {
          value += amplitude * noise(p);
          p = rotation * p * 2.03 + 13.7;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution.xy) / min(uResolution.x, uResolution.y);
        float t = uTime * 0.072;
        float r = length(uv);
        float angle = atan(uv.y, uv.x);
        vec2 drift = vec2(t * 0.66, -t * 0.28);
        float broad = fbm(uv * 1.8 + drift);
        float fine = fbm(uv * 4.8 - drift * 1.4 + broad * 1.6);
        float smoke = smoothstep(0.41, 0.76, broad * 0.69 + fine * 0.48);
        smoke *= smoothstep(0.12, 0.58, r) * (1.0 - smoothstep(1.55, 2.25, r));
        float aura = exp(-14.0 * abs(r - 0.61 - sin(angle * 5.0 + t * 2.0) * 0.022));
        float rays = pow(max(0.0, cos(angle * 10.0 + fine * 2.0)), 30.0) * (1.0 - smoothstep(0.25, 1.2, r));
        float cursor = exp(-8.0 * length(uv * 0.42 - (uPointer - 0.5)));

        vec3 color = vec3(0.025, 0.031, 0.032);
        color += mix(vec3(0.11, 0.12, 0.12), vec3(0.22, 0.29, 0.30), fine) * smoke * 0.72;
        color += vec3(0.24, 0.36, 0.40) * aura * 0.18;
        color += vec3(0.32, 0.27, 0.17) * rays * 0.05;
        color += vec3(0.10, 0.16, 0.18) * cursor;
        color += (hash21(gl_FragCoord.xy + fract(uTime) * 97.0) - 0.5) * 0.021;
        color *= 1.0 - smoothstep(0.82, 2.2, r) * 0.58;
        float alpha = clamp(0.12 + smoke * 0.48 + aura * 0.14 + rays * 0.05 + cursor * 0.14, 0.10, 0.64);
        outColor = vec4(color, alpha);
      }
    `

    this.program = compileProgram(this.gl, fragmentSource)
    this.locations = {
      resolution: this.gl.getUniformLocation(this.program, 'uResolution'),
      pointer: this.gl.getUniformLocation(this.program, 'uPointer'),
      time: this.gl.getUniformLocation(this.program, 'uTime'),
    }
    this.resize()
  }

  setPointer(x: number, y: number): void {
    this.pointer = [x, y]
  }

  resize(): void {
    if (!this.gl) return
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 1) * 0.75
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }

  render(time: number): void {
    if (!this.gl || !this.program) return
    this.gl.useProgram(this.program)
    this.gl.uniform2f(
      this.locations.resolution,
      this.canvas.width,
      this.canvas.height
    )
    this.gl.uniform2f(this.locations.pointer, this.pointer[0], this.pointer[1])
    this.gl.uniform1f(this.locations.time, time)
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
  }

  destroy(): void {
    if (this.gl && this.program) this.gl.deleteProgram(this.program)
  }
}

class SpatialEngravingShader {
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext | null
  private readonly onReady: (ready: boolean) => void
  private program: WebGLProgram | null = null
  private locations: UniformLocations = {}
  private readonly image = new Image()
  private texture: WebGLTexture | null = null
  private loaded = false

  constructor(
    canvas: HTMLCanvasElement,
    imageUrl: string,
    onReady: (ready: boolean) => void
  ) {
    this.canvas = canvas
    this.onReady = onReady
    this.gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    })
    if (!this.gl) return

    const fragmentSource = `#version 300 es
      precision highp float;
      in vec2 vUv;
      out vec4 outColor;
      uniform sampler2D uArtwork;
      uniform float uTime;

      mat2 rotate2d(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c);
      }

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float inkAt(vec2 uv) {
        vec3 sampleColor = texture(uArtwork, clamp(uv, 0.001, 0.999)).rgb;
        return dot(sampleColor, vec3(0.299, 0.587, 0.114));
      }

      float boxMask(vec2 local, float feather) {
        vec2 insideA = smoothstep(vec2(0.0), vec2(feather), local);
        vec2 insideB = 1.0 - smoothstep(vec2(1.0 - feather), vec2(1.0), local);
        return insideA.x * insideA.y * insideB.x * insideB.y;
      }

      float ellipseMask(vec2 p, vec2 center, vec2 radius, float feather) {
        float distanceToEdge = length((p - center) / radius);
        return 1.0 - smoothstep(1.0, 1.0 + feather, distanceToEdge);
      }

      float capsuleMask(vec2 p, vec2 a, vec2 b, float radius, float feather) {
        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return 1.0 - smoothstep(radius, radius + feather, length(pa - ba * h));
      }

      float outsideSourceWheel(vec2 sourceUv) {
        vec2 q = sourceUv - vec2(0.50, 0.505);
        q.y *= 518.0 / 345.0;
        return smoothstep(0.222, 0.248, length(q));
      }

      void main() {
        vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
        float t = uTime;
        float ink = 0.0;

        // The wheel is rebuilt without the axle baked into the source image.
        vec2 wheelCenter = vec2(0.50, 0.525);
        float wheelSize = 0.50;
        vec2 wheelLocal = (uv - wheelCenter) / wheelSize;
        float wheelRadius = length(wheelLocal);
        float wheelAngle = atan(wheelLocal.y, wheelLocal.x);
        float wheelRotation = t * 0.040 + sin(t * 0.11) * 0.006 + sin(t * 0.23) * 0.002;
        float rimAngle = wheelAngle - wheelRotation;
        float roughRadius = wheelRadius + sin(rimAngle * 23.0 + 0.7) * 0.0034 + sin(rimAngle * 47.0) * 0.0015;
        float outerRim = 1.0 - smoothstep(0.007, 0.014, abs(roughRadius - 0.470));
        float innerRim = (1.0 - smoothstep(0.006, 0.012, abs(roughRadius - 0.423))) * 0.74;
        float spokeDistance = abs(sin((wheelAngle - wheelRotation) * 4.0)) * wheelRadius;
        spokeDistance += sin(wheelRadius * 91.0 + wheelAngle * 5.0) * 0.0014;
        float spokeWidth = mix(0.006, 0.010, smoothstep(0.12, 0.39, wheelRadius));
        float spokes = (1.0 - smoothstep(spokeWidth, spokeWidth + 0.007, spokeDistance));
        spokes *= smoothstep(0.105, 0.145, wheelRadius) * (1.0 - smoothstep(0.385, 0.420, wheelRadius));
        float repeatedAngle = mod(wheelAngle - wheelRotation + 0.392699, 0.785398) - 0.392699;
        float nodeDistance = length(vec2(wheelRadius - 0.302, repeatedAngle * 0.302));
        float nodeRing = 1.0 - smoothstep(0.005, 0.011, abs(nodeDistance - 0.029));
        float nodeCore = 1.0 - smoothstep(0.005, 0.010, nodeDistance);
        float rimInk = max(outerRim, innerRim);
        float mechanismInk = max(spokes, max(nodeRing, nodeCore));
        float wheelLimit = 1.0 - smoothstep(0.490, 0.505, wheelRadius);
        rimInk *= wheelLimit;
        mechanismInk *= wheelLimit;
        vec2 grainCoordinate = rotate2d(-wheelRotation) * wheelLocal * 410.0;
        vec2 sourceWheelLocal = rotate2d(-wheelRotation) * wheelLocal;
        vec2 sourceWheelUv = vec2(0.50, 0.505) + sourceWheelLocal * vec2(0.505, 0.338);
        float archivalInk = inkAt(sourceWheelUv);
        float printGrain = 0.82 + hash21(floor(grainCoordinate)) * 0.18;
        float printWear = mix(0.82, 1.0, smoothstep(0.16, 0.84, hash21(floor(grainCoordinate * vec2(0.31, 1.17)) + 19.0)));
        float inkDropout = step(0.16, hash21(floor(grainCoordinate * vec2(0.57, 0.73)) + 41.0));
        float archivalVariation = mix(0.60, 1.05, smoothstep(0.12, 0.74, archivalInk));
        rimInk *= printGrain * printWear * mix(0.82, 1.0, inkDropout) * mix(0.88, 1.03, smoothstep(0.12, 0.74, archivalInk));
        mechanismInk *= printGrain * printWear * mix(0.03, 1.0, inkDropout) * archivalVariation;
        float directionalLight = 0.58 + 0.25 * (0.5 + 0.5 * cos(wheelAngle + 2.35));
        float lowerWeight = 0.86 + 0.14 * smoothstep(-0.25, 0.85, sin(wheelAngle));
        rimInk *= (0.88 + directionalLight * 0.12) * (0.96 + lowerWeight * 0.04);
        mechanismInk *= directionalLight * lowerWeight;

        vec2 rearLocal = (uv - wheelCenter) / wheelSize;
        float rearRadius = length(rearLocal);
        float rearAngle = atan(rearLocal.y, rearLocal.x);
        float frontAnnulus = smoothstep(0.396, 0.418, wheelRadius) * (1.0 - smoothstep(0.476, 0.496, wheelRadius));
        float rearAnnulus = smoothstep(0.396, 0.418, rearRadius) * (1.0 - smoothstep(0.482, 0.506, rearRadius));
        float rearRim = rearAnnulus * (1.0 - frontAnnulus * 0.72);
        float sidewall = rearAnnulus * (1.0 - smoothstep(0.00, 0.72, frontAnnulus));
        float rearEdge = 1.0 - smoothstep(0.008, 0.017, abs(rearRadius - 0.488));
        float sidewallGrooves = max(
          1.0 - smoothstep(0.0018, 0.0042, abs(rearRadius - 0.430)),
          max(
            1.0 - smoothstep(0.0018, 0.0042, abs(rearRadius - 0.454)),
            1.0 - smoothstep(0.0018, 0.0042, abs(rearRadius - 0.478))
          )
        );
        float grooveBreaks = step(0.28, hash21(floor(vec2((rearAngle - wheelRotation + 3.14159) * 18.0, rearRadius * 34.0))));
        sidewallGrooves *= sidewall * grooveBreaks;
        float wheelCavity = 1.0 - smoothstep(0.392, 0.430, wheelRadius);
        float frontBevel = smoothstep(0.402, 0.425, wheelRadius) * (1.0 - smoothstep(0.476, 0.496, wheelRadius));
        float fixedHubRadius = length((uv - wheelCenter) / wheelSize);
        float fixedHubRing = 1.0 - smoothstep(0.007, 0.014, abs(fixedHubRadius - 0.080));
        vec2 materialLocal = rotate2d(-wheelRotation) * wheelLocal;
        float engravedHatch = 0.5 + 0.5 * sin((materialLocal.x * 1.55 + materialLocal.y) * 132.0);
        engravedHatch = smoothstep(0.62, 0.94, engravedHatch) * frontBevel;

        // Sphinx and wings breathe and hover above the mechanism.
        vec2 sphinxLocal = (uv - vec2(0.225, 0.035)) / vec2(0.55, 0.28);
        sphinxLocal.y -= sin(t * 0.48) * 0.012;
        sphinxLocal.x = (sphinxLocal.x - 0.5) / (1.0 + sin(t * 0.36) * 0.018) + 0.5;
        vec2 sphinxSource = vec2(0.12, 0.075) + sphinxLocal * vec2(0.76, 0.255);
        float sphinxInk = inkAt(sphinxSource) * boxMask(sphinxLocal, 0.045);
        float sphinxOcclusion = ellipseMask(uv, vec2(0.50, 0.285), vec2(0.225, 0.105), 0.16);

        // Left descending figure rocks independently outside the wheel cutout.
        vec2 leftLocal = (uv - vec2(0.06, 0.285)) / vec2(0.39, 0.52);
        leftLocal -= 0.5;
        leftLocal = rotate2d(sin(t * 0.41) * 0.035) * leftLocal;
        leftLocal += 0.5 + vec2(0.0, sin(t * 0.57) * 0.008);
        vec2 leftSource = vec2(0.025, 0.27) + leftLocal * vec2(0.48, 0.54);
        float leftOcclusion = ellipseMask(uv, vec2(0.300, 0.535), vec2(0.125, 0.195), 0.16);
        leftOcclusion = max(leftOcclusion, capsuleMask(uv, vec2(0.180, 0.385), vec2(0.315, 0.610), 0.070, 0.020));
        leftOcclusion = max(leftOcclusion, capsuleMask(uv, vec2(0.315, 0.500), vec2(0.435, 0.640), 0.052, 0.018));
        float leftSourceOutside = outsideSourceWheel(leftSource);
        float leftInk = inkAt(leftSource) * boxMask(leftLocal, 0.055) * max(leftSourceOutside, leftOcclusion);

        // Right ascending figure moves in counter-phase.
        vec2 rightLocal = (uv - vec2(0.55, 0.275)) / vec2(0.40, 0.54);
        rightLocal -= 0.5;
        rightLocal = rotate2d(-sin(t * 0.41) * 0.032) * rightLocal;
        rightLocal += 0.5 + vec2(0.0, -sin(t * 0.53) * 0.009);
        vec2 rightSource = vec2(0.495, 0.26) + rightLocal * vec2(0.49, 0.56);
        float rightOcclusion = ellipseMask(uv, vec2(0.700, 0.525), vec2(0.125, 0.200), 0.16);
        rightOcclusion = max(rightOcclusion, capsuleMask(uv, vec2(0.660, 0.370), vec2(0.735, 0.595), 0.065, 0.020));
        rightOcclusion = max(rightOcclusion, capsuleMask(uv, vec2(0.735, 0.525), vec2(0.840, 0.700), 0.058, 0.020));
        float rightSourceOutside = outsideSourceWheel(rightSource);
        float rightInk = inkAt(rightSource) * boxMask(rightLocal, 0.055) * max(rightSourceOutside, rightOcclusion);

        // Static axle and platform sit in front of the turning wheel.
        vec2 axleLocal = (uv - vec2(0.455, 0.245)) / vec2(0.09, 0.64);
        vec2 axleSource = vec2(0.455, 0.235) + axleLocal * vec2(0.09, 0.66);
        float axleInk = inkAt(axleSource) * boxMask(axleLocal, 0.075);
        float axleOcclusion = boxMask(axleLocal, 0.10);

        vec2 barLocal = (uv - vec2(0.255, 0.255)) / vec2(0.49, 0.105);
        vec2 barSource = vec2(0.245, 0.245) + barLocal * vec2(0.51, 0.11);
        float barInk = inkAt(barSource) * boxMask(barLocal, 0.09);
        float barOcclusion = boxMask(barLocal, 0.12);

        // The boat floats below the whole assembly.
        vec2 boatLocal = (uv - vec2(0.29, 0.79 + sin(t * 0.38) * 0.004)) / vec2(0.42, 0.17);
        vec2 boatSource = vec2(0.18, 0.805) + boatLocal * vec2(0.64, 0.18);
        float boatInk = inkAt(boatSource) * boxMask(boatLocal, 0.065);
        float boatOcclusion = boxMask(boatLocal, 0.10);

        float foregroundInk = max(max(sphinxInk, max(leftInk, rightInk)), max(axleInk, max(barInk, boatInk)));
        foregroundInk = max(foregroundInk, fixedHubRing * 0.78);
        float characterOcclusion = smoothstep(0.22, 0.82, max(sphinxOcclusion, max(leftOcclusion, rightOcclusion)));
        float structureOcclusion = smoothstep(0.22, 0.82, max(axleOcclusion, barOcclusion));
        float axleCastShadow = capsuleMask(uv, vec2(0.548, 0.345), vec2(0.548, 0.715), 0.012, 0.010);
        float contactShadow = smoothstep(0.16, 0.48, characterOcclusion) * (1.0 - smoothstep(0.58, 0.92, characterOcclusion));
        float leftRimSector = 1.0 - smoothstep(0.36, 0.82, abs(abs(wheelAngle) - 3.14159));
        float rightRimSector = 1.0 - smoothstep(0.30, 0.76, abs(wheelAngle));
        float rimCharacterOcclusion = max(leftOcclusion * leftRimSector, rightOcclusion * rightRimSector);
        rimCharacterOcclusion = smoothstep(0.34, 0.84, rimCharacterOcclusion);
        float characterLineOcclusion = smoothstep(0.12, 0.42, max(sphinxInk, max(leftInk, rightInk)));
        float structureLineOcclusion = smoothstep(0.12, 0.42, max(axleInk, barInk));
        float rimVisibility = (1.0 - rimCharacterOcclusion * 0.12) * (1.0 - characterLineOcclusion * 0.96) * (1.0 - structureLineOcclusion * 0.98) * (1.0 - axleCastShadow * 0.24);
        float mechanismVisibility = (1.0 - characterOcclusion * 0.86) * (1.0 - structureOcclusion * 0.98) * (1.0 - axleCastShadow * 0.56);
        float visibleRimInk = rimInk * rimVisibility;
        float visibleMechanismInk = max(mechanismInk, sidewallGrooves * 0.34) * mechanismVisibility * (1.0 - contactShadow * 0.48);
        ink = max(foregroundInk, max(visibleRimInk * 0.88, visibleMechanismInk * 0.70));

        float pulse = 0.94 + sin(t * 0.32 + uv.y * 5.0) * 0.045;
        float isolatedInk = smoothstep(0.28, 0.86, ink);
        float tone = pow(isolatedInk, 0.72) * pulse;
        vec3 lineColor = mix(vec3(0.42, 0.45, 0.44), vec3(0.82, 0.83, 0.80), tone);
        lineColor += vec3(0.18, 0.13, 0.07) * sphinxInk * 0.10;
        float lineAlpha = smoothstep(0.16, 0.48, isolatedInk) * 0.94;

        float wheelBodyVisibility = (1.0 - characterOcclusion * 0.88) * (1.0 - structureOcclusion * 0.98) * (1.0 - axleCastShadow * 0.62);
        float lowerBody = 0.90 + 0.10 * smoothstep(-0.30, 0.80, sin(wheelAngle));
        float sidewallWeight = sidewall * (0.58 + 0.42 * smoothstep(-0.18, 0.86, sin(wheelAngle)));
        float bodyAlpha = (wheelCavity * 0.04 + frontBevel * 0.34 + engravedHatch * 0.10 + rearRim * 0.34 + sidewallWeight * 0.46 + rearEdge * 0.20) * wheelBodyVisibility * lowerBody;
        bodyAlpha = clamp(bodyAlpha, 0.0, 0.62);
        float bodyLight = 0.5 + 0.5 * cos(wheelAngle + 2.35);
        float materialLight = clamp(bodyLight * 0.46 + sidewallWeight * 0.52 + engravedHatch * 0.16, 0.0, 1.0);
        vec3 bodyColor = mix(vec3(0.026, 0.031, 0.031), vec3(0.150, 0.154, 0.143), materialLight);

        float alpha = lineAlpha + bodyAlpha * (1.0 - lineAlpha);
        vec3 premultiplied = lineColor * lineAlpha + bodyColor * bodyAlpha * (1.0 - lineAlpha);
        outColor = vec4(premultiplied / max(alpha, 0.001), alpha);
      }
    `

    this.program = compileProgram(this.gl, fragmentSource)
    this.locations = {
      artwork: this.gl.getUniformLocation(this.program, 'uArtwork'),
      time: this.gl.getUniformLocation(this.program, 'uTime'),
    }

    this.image.addEventListener('load', this.handleImageLoad)
    this.image.addEventListener('error', this.handleImageError)
    this.image.src = imageUrl
  }

  private readonly handleImageLoad = (): void => {
    this.loadTexture(this.image)
  }

  private readonly handleImageError = (): void => {
    this.onReady(false)
  }

  private loadTexture(image: HTMLImageElement): void {
    const gl = this.gl
    if (!gl || !this.program) return
    this.texture = gl.createTexture()
    if (!this.texture) {
      this.onReady(false)
      return
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    this.loaded = true
    this.resize()
    this.render(0)
    this.onReady(true)
  }

  resize(): void {
    if (!this.gl) return
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6)
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }

  render(time: number): void {
    if (!this.gl || !this.program || !this.loaded) return
    this.gl.useProgram(this.program)
    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture)
    this.gl.uniform1i(this.locations.artwork, 0)
    this.gl.uniform1f(this.locations.time, time)
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
  }

  destroy(): void {
    this.image.removeEventListener('load', this.handleImageLoad)
    this.image.removeEventListener('error', this.handleImageError)
    if (!this.gl) return
    if (this.texture) this.gl.deleteTexture(this.texture)
    if (this.program) this.gl.deleteProgram(this.program)
  }
}

export function createFortuneAtmosphere(
  options: AtmosphereOptions
): () => void {
  const { canvas } = options
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const clock = new MotionClock(reducedMotion.matches)
  let atmosphere = new AtmosphereShader(canvas)
  let frameId: number | null = null
  let lastFrameAt = 0
  let disposed = false
  let contextLost = false

  const draw = (now: number): void => {
    atmosphere.render(clock.time(now))
  }

  const animate = (now: number): void => {
    if (disposed || contextLost || reducedMotion.matches || document.hidden) {
      frameId = null
      return
    }
    if (now - lastFrameAt >= 1000 / 30) {
      lastFrameAt = now
      draw(now)
    }
    frameId = window.requestAnimationFrame(animate)
  }

  const syncAnimation = (): void => {
    const shouldAnimate =
      !disposed && !contextLost && !reducedMotion.matches && !document.hidden
    clock.setPaused(!shouldAnimate)

    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
    if (shouldAnimate) {
      frameId = window.requestAnimationFrame(animate)
    } else if (!contextLost && !document.hidden) {
      draw(performance.now())
    }
  }

  const resize = (): void => {
    atmosphere.resize()
    if (!contextLost && !document.hidden) draw(performance.now())
  }

  const handlePointerMove = (event: PointerEvent): void => {
    if (reducedMotion.matches) return
    const width = window.innerWidth
    const height = window.innerHeight
    if (!width || !height) return
    const x = Math.min(1, Math.max(0, event.clientX / width))
    const y = Math.min(1, Math.max(0, 1 - event.clientY / height))
    atmosphere.setPointer(x, y)
  }

  const handleContextLost = (event: Event): void => {
    event.preventDefault()
    contextLost = true
    syncAnimation()
  }

  const handleContextRestored = (): void => {
    if (disposed) return
    atmosphere.destroy()
    atmosphere = new AtmosphereShader(canvas)
    contextLost = false
    resize()
    syncAnimation()
  }

  window.addEventListener('pointermove', handlePointerMove, { passive: true })
  window.addEventListener('resize', resize, { passive: true })
  window.visualViewport?.addEventListener('resize', resize, { passive: true })
  canvas.addEventListener('webglcontextlost', handleContextLost)
  canvas.addEventListener('webglcontextrestored', handleContextRestored)
  document.addEventListener('visibilitychange', syncAnimation)
  reducedMotion.addEventListener('change', syncAnimation)
  resize()
  syncAnimation()

  return () => {
    disposed = true
    if (frameId !== null) window.cancelAnimationFrame(frameId)
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('resize', resize)
    window.visualViewport?.removeEventListener('resize', resize)
    canvas.removeEventListener('webglcontextlost', handleContextLost)
    canvas.removeEventListener('webglcontextrestored', handleContextRestored)
    document.removeEventListener('visibilitychange', syncAnimation)
    reducedMotion.removeEventListener('change', syncAnimation)
    atmosphere.destroy()
  }
}

export function createFortuneEngraving(options: EngravingOptions): () => void {
  const { host, artCanvas, imageUrl, onReady } = options
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const clock = new MotionClock(reducedMotion.matches)
  let engraving = new SpatialEngravingShader(artCanvas, imageUrl, onReady)
  let frameId: number | null = null
  let isVisible = true
  let disposed = false
  let contextLost = false

  const draw = (now: number): void => {
    engraving.render(clock.time(now))
  }

  const animate = (now: number): void => {
    if (
      disposed ||
      contextLost ||
      reducedMotion.matches ||
      !isVisible ||
      document.hidden
    ) {
      frameId = null
      return
    }
    draw(now)
    frameId = window.requestAnimationFrame(animate)
  }

  const syncAnimation = (): void => {
    const shouldAnimate =
      !disposed &&
      !contextLost &&
      !reducedMotion.matches &&
      isVisible &&
      !document.hidden
    clock.setPaused(!shouldAnimate)
    host.dataset.motionPaused = String(!shouldAnimate)

    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
    if (shouldAnimate) {
      frameId = window.requestAnimationFrame(animate)
    } else if (!contextLost && isVisible && !document.hidden) {
      draw(performance.now())
    }
  }

  const resize = (): void => {
    engraving.resize()
    if (!contextLost && isVisible && !document.hidden) draw(performance.now())
  }

  const handleContextLost = (event: Event): void => {
    event.preventDefault()
    contextLost = true
    onReady(false)
    syncAnimation()
  }

  const handleContextRestored = (): void => {
    if (disposed) return
    engraving.destroy()
    onReady(false)
    engraving = new SpatialEngravingShader(artCanvas, imageUrl, onReady)
    contextLost = false
    resize()
    syncAnimation()
  }

  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
  resizeObserver?.observe(host)
  if (!resizeObserver) {
    window.addEventListener('resize', resize, { passive: true })
  }
  const intersectionObserver =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          ([entry]) => {
            isVisible = entry?.isIntersecting ?? false
            syncAnimation()
          },
          { rootMargin: '120px' }
        )
  intersectionObserver?.observe(host)

  artCanvas.addEventListener('webglcontextlost', handleContextLost)
  artCanvas.addEventListener('webglcontextrestored', handleContextRestored)
  document.addEventListener('visibilitychange', syncAnimation)
  reducedMotion.addEventListener('change', syncAnimation)
  resize()
  syncAnimation()

  return () => {
    disposed = true
    if (frameId !== null) window.cancelAnimationFrame(frameId)
    resizeObserver?.disconnect()
    if (!resizeObserver) window.removeEventListener('resize', resize)
    intersectionObserver?.disconnect()
    artCanvas.removeEventListener('webglcontextlost', handleContextLost)
    artCanvas.removeEventListener('webglcontextrestored', handleContextRestored)
    document.removeEventListener('visibilitychange', syncAnimation)
    reducedMotion.removeEventListener('change', syncAnimation)
    engraving.destroy()
  }
}
