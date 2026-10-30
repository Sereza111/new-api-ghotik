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

const VERTEX_SHADER = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

out vec2 vUv;

void main() {
  vec2 position = POSITIONS[gl_VertexID];
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uViewport;
uniform vec2 uPointer;
uniform vec3 uAccent;
uniform float uTime;
uniform float uScene;
uniform float uHover;
uniform float uFlowProgress;
uniform float uSelected;
uniform float uSeed;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float noise21(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), local.x),
    mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0)), local.x),
    local.y
  );
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  for (int octave = 0; octave < 4; octave += 1) {
    value += amplitude * noise21(point);
    point = rotation * point * 2.03 + 17.13;
    amplitude *= 0.5;
  }
  return value;
}

float ridge(float value) {
  return 1.0 - abs(value * 2.0 - 1.0);
}

float softLine(float value, float center, float innerWidth, float outerWidth) {
  return 1.0 - smoothstep(innerWidth, outerWidth, abs(value - center));
}

float ellipseMask(vec2 point, vec2 center, vec2 radius, float feather) {
  float distanceToCenter = length((point - center) / radius);
  return 1.0 - smoothstep(1.0 - feather, 1.0 + feather, distanceToCenter);
}

float capsuleMask(vec2 point, vec2 start, vec2 end, float radius) {
  vec2 aspect = vec2(uViewport.x / max(uViewport.y, 1.0), 1.0);
  vec2 scaledPoint = point * aspect;
  vec2 scaledStart = start * aspect;
  vec2 scaledEnd = end * aspect;
  vec2 segment = scaledEnd - scaledStart;
  float amount = clamp(
    dot(scaledPoint - scaledStart, segment) / max(dot(segment, segment), 0.00001),
    0.0,
    1.0
  );
  float distanceToSegment = length(scaledPoint - (scaledStart + segment * amount));
  return 1.0 - smoothstep(radius * 0.72, radius, distanceToSegment);
}

mat2 rotate2d(float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, -sine, sine, cosine);
}

vec2 rotateMasked(
  vec2 point,
  vec2 pivot,
  vec2 center,
  vec2 radius,
  float angle
) {
  float mask = ellipseMask(point, center, radius, 0.20);
  vec2 rotated = pivot + rotate2d(-angle) * (point - pivot);
  return mix(point, rotated, mask);
}

vec2 bendFinger(
  vec2 point,
  vec2 tip,
  vec2 pivot,
  float radius,
  float phase,
  float response
) {
  float mask = capsuleMask(point, tip, pivot, radius);
  float idle =
    sin(uTime * 0.52 + phase) * 0.034 +
    sin(uTime * 0.23 + phase * 1.7) * 0.008;
  float pointerBend = (uPointer.x - 0.5) * response * uHover * 0.032;
  float angle = clamp(idle + pointerBend, -0.058, 0.058);
  vec2 rotated = pivot + rotate2d(-angle) * (point - pivot);
  return mix(point, rotated, mask * 0.92);
}

float flowRoute(vec2 point) {
  float route = 0.0;
  float y = point.y;

  if (uScene < 0.5) {
    float spread = smoothstep(0.15, 0.86, y);
    float sway = sin(y * 11.0 - uTime * 0.72 + uSeed * 8.0) * 0.025;
    float fork = (0.025 + spread * 0.205) * smoothstep(0.12, 0.31, y);
    route = max(
      softLine(point.x, 0.5 + sway - fork, 0.018, 0.075),
      softLine(point.x, 0.5 + sway + fork, 0.018, 0.075)
    );
    route = max(
      route,
      softLine(point.x, 0.5 + sway, 0.018, 0.085) *
        (1.0 - smoothstep(0.30, 0.55, y))
    );
  } else if (uScene < 1.5) {
    float fan =
      smoothstep(0.04, 0.28, y) *
      (1.0 - smoothstep(0.35, 0.53, y));
    float wobble = sin(y * 18.0 - uTime * 0.94 + uSeed * 11.0) * 0.012;
    route = softLine(point.x, 0.5 - 0.25 * fan + wobble, 0.010, 0.043);
    route = max(route, softLine(point.x, 0.5 - 0.125 * fan - wobble, 0.010, 0.043));
    route = max(route, softLine(point.x, 0.5, 0.010, 0.044));
    route = max(route, softLine(point.x, 0.5 + 0.125 * fan + wobble, 0.010, 0.043));
    route = max(route, softLine(point.x, 0.5 + 0.25 * fan - wobble, 0.010, 0.043));

    float eyeDistance = length((point - vec2(0.492, 0.49)) / vec2(0.105, 0.070));
    float eyeOrbit = 1.0 - smoothstep(0.085, 0.24, abs(eyeDistance - 1.0));
    route = max(route, eyeOrbit * (1.0 - smoothstep(0.62, 0.82, y)));

    float lowerSplit = smoothstep(0.50, 0.78, y) * 0.20;
    route = max(route, softLine(point.x, 0.5 - lowerSplit + wobble, 0.018, 0.070));
    route = max(route, softLine(point.x, 0.5 + lowerSplit - wobble, 0.018, 0.070));
  } else if (uScene < 2.5) {
    float fan = smoothstep(0.08, 0.50, y) * (1.0 - smoothstep(0.56, 0.78, y));
    float spread = 0.035 + fan * 0.315;
    float feather = sin(y * 15.0 - uTime * 0.52) * 0.025;
    route = softLine(point.x, 0.5 - spread + feather, 0.035, 0.120);
    route = max(route, softLine(point.x, 0.5 + spread - feather, 0.035, 0.120));
    route = max(
      route,
      softLine(point.x, 0.5 + feather * 0.25, 0.025, 0.115) *
        smoothstep(0.36, 0.62, y)
    );
  } else {
    float meander =
      sin(y * 8.0 - uTime * 0.34 + uSeed * 9.0) *
      (0.035 + smoothstep(0.18, 0.78, y) * 0.18);
    route = softLine(point.x, 0.5 + meander, 0.030, 0.105);
    route = max(
      route,
      softLine(point.x, 0.5 - meander * 0.72, 0.022, 0.080) *
        smoothstep(0.30, 0.62, y)
    );
    float pool = smoothstep(0.68, 0.96, y) *
      (1.0 - smoothstep(0.38, 0.50, abs(point.x - 0.5)));
    route = max(route, pool * 0.92);
  }

  return clamp(route, 0.0, 1.0);
}

vec2 flowCoordinates(vec2 point) {
  vec2 flowPoint = point;
  if (uScene < 0.5) {
    flowPoint.x += sin(point.y * 9.0 - uTime * 0.52) * 0.12;
  } else if (uScene < 1.5) {
    flowPoint.x += sin(point.y * 16.0 + uTime * 0.38) * 0.055;
  } else if (uScene < 2.5) {
    flowPoint.x += (point.x - 0.5) * point.y * 0.34;
  } else {
    flowPoint.x += sin(point.y * 6.0 - uTime * 0.24) * 0.20;
    flowPoint.y *= 0.82;
  }
  return flowPoint;
}

float panelMask(vec2 uv) {
  float topWidth = 0.49 * clamp((1.0 - uv.y) / 0.12, 0.0, 1.0);
  float bottomWidth = 0.49 * clamp(uv.y / 0.12, 0.0, 1.0);
  float halfWidth = min(topWidth, bottomWidth);
  float antialias = 1.6 / max(uViewport.x, 1.0);
  return 1.0 - smoothstep(halfWidth - antialias, halfWidth + antialias, abs(uv.x - 0.5));
}

float panelInterior(vec2 uv) {
  float topWidth = 0.49 * clamp((1.0 - uv.y) / 0.12, 0.0, 1.0);
  float bottomWidth = 0.49 * clamp(uv.y / 0.12, 0.0, 1.0);
  float edgeDistance = min(topWidth, bottomWidth) - abs(uv.x - 0.5);
  float sideGuard = smoothstep(0.008, 0.027, edgeDistance);
  float endGuard = smoothstep(0.012, 0.042, uv.y) * smoothstep(0.012, 0.042, 1.0 - uv.y);
  return sideGuard * endGuard;
}

vec2 sceneWarp(vec2 uv) {
  vec2 point = vec2(uv.x, 1.0 - uv.y);
  float edgeGuard =
    smoothstep(0.035, 0.115, point.x) *
    smoothstep(0.035, 0.115, 1.0 - point.x) *
    smoothstep(0.075, 0.15, point.y) *
    smoothstep(0.075, 0.15, 1.0 - point.y);
  float frontY = -0.08 + uFlowProgress * 1.18;
  float awakened =
    uHover *
    (1.0 - smoothstep(frontY - 0.035, frontY + 0.13, point.y));
  float motionBoost = 1.0 + awakened * 1.18;

  if (uScene < 0.5) {
    float crown = ellipseMask(point, vec2(0.50, 0.225), vec2(0.18, 0.065), 0.28);
    float skull = ellipseMask(point, vec2(0.50, 0.345), vec2(0.18, 0.12), 0.24);
    float chest = ellipseMask(point, vec2(0.49, 0.505), vec2(0.32, 0.19), 0.26);
    float tentacles = ellipseMask(point, vec2(0.50, 0.735), vec2(0.49, 0.24), 0.24);
    float breath = sin(uTime * 0.58 + uSeed) * 0.016 * motionBoost;
    point.x -= (point.x - 0.49) * breath * chest;
    point.y += sin(uTime * 0.46 + 1.2) * 0.0065 * crown * motionBoost;
    point.x += sin(point.y * 34.0 - uTime * 0.82) * 0.0125 * tentacles * edgeGuard * motionBoost;
    point.y += sin(point.x * 22.0 + uTime * 0.54) * 0.0045 * tentacles * edgeGuard * motionBoost;
    point = rotateMasked(
      point,
      vec2(0.50, 0.41),
      vec2(0.50, 0.345),
      vec2(0.18, 0.12),
      sin(uTime * 0.34 + 0.7) * 0.012 * motionBoost
    );
  } else if (uScene < 1.5) {
    point = bendFinger(point, vec2(0.287, 0.297), vec2(0.384, 0.503), 0.018, 0.0, -0.9);
    point = bendFinger(point, vec2(0.374, 0.248), vec2(0.444, 0.494), 0.017, 1.1, -0.5);
    point = bendFinger(point, vec2(0.492, 0.226), vec2(0.500, 0.484), 0.019, 2.0, 0.0);
    point = bendFinger(point, vec2(0.598, 0.235), vec2(0.563, 0.493), 0.018, 2.8, 0.5);
    point = bendFinger(point, vec2(0.827, 0.365), vec2(0.613, 0.531), 0.021, 3.7, 1.0);

    vec2 eyeCenter = vec2(0.500, 0.484);
    float eye = ellipseMask(point, eyeCenter, vec2(0.140, 0.047), 0.22);
    vec2 autonomousLook = vec2(sin(uTime * 0.23 + 1.2), cos(uTime * 0.19)) * 0.35;
    vec2 pointerLook = clamp((uPointer - 0.5) * 2.0, vec2(-1.0), vec2(1.0));
    vec2 look = mix(autonomousLook, pointerLook, uHover);
    point -= look * vec2(0.014, 0.008) * eye;

    float blinkClock = mod(uTime + 1.7, 7.3);
    float blink = exp(-pow((blinkClock - 0.16) / 0.085, 2.0));
    float eyeScale = max(0.24, 1.0 - blink * eye * 0.78);
    point.y = eyeCenter.y + (point.y - eyeCenter.y) / eyeScale;

    float snakes = ellipseMask(point, vec2(0.50, 0.755), vec2(0.49, 0.18), 0.22);
    point.x += sin(point.y * 42.0 + uTime * 0.68) * 0.011 * snakes * edgeGuard * motionBoost;
    point.y += sin(point.x * 25.0 - uTime * 0.44) * 0.0038 * snakes * edgeGuard * motionBoost;
  } else if (uScene < 2.5) {
    float wingRight = ellipseMask(point, vec2(0.76, 0.37), vec2(0.27, 0.25), 0.24);
    float ribbonsLeft = ellipseMask(point, vec2(0.22, 0.38), vec2(0.25, 0.24), 0.24);
    float torso = ellipseMask(point, vec2(0.53, 0.53), vec2(0.29, 0.28), 0.24);
    float lowerCloth = ellipseMask(point, vec2(0.51, 0.70), vec2(0.32, 0.22), 0.22);
    float wingPulse = sin(uTime * 0.48 + uSeed) * 0.018 * motionBoost;
    point.x -= (point.x - 0.51) * wingPulse * (wingRight + ribbonsLeft);
    point.y += sin(uTime * 0.54 + 0.7) * 0.0075 * torso * motionBoost;
    point.y += sin(point.x * 32.0 - uTime * 0.62) * 0.0055 * wingRight * edgeGuard * motionBoost;
    point.x += sin(point.y * 30.0 - uTime * 0.48) * 0.009 * lowerCloth * edgeGuard * motionBoost;
    point = rotateMasked(
      point,
      vec2(0.51, 0.35),
      vec2(0.50, 0.295),
      vec2(0.12, 0.105),
      sin(uTime * 0.36) * 0.014 * motionBoost
    );
  } else {
    float ribs = ellipseMask(point, vec2(0.51, 0.52), vec2(0.34, 0.20), 0.24);
    float lower = ellipseMask(point, vec2(0.51, 0.70), vec2(0.48, 0.22), 0.24);
    float flowers = ellipseMask(point, vec2(0.50, 0.64), vec2(0.31, 0.17), 0.22);
    float breath = sin(uTime * 0.49 + uSeed) * 0.018 * motionBoost;
    point.x -= (point.x - 0.51) * breath * ribs;
    point.x += sin(point.y * 35.0 + uTime * 0.46) * 0.010 * lower * edgeGuard * motionBoost;
    point.y += sin(uTime * 0.44 + 2.0) * 0.005 * flowers * motionBoost;
    point = rotateMasked(
      point,
      vec2(0.50, 0.37),
      vec2(0.51, 0.285),
      vec2(0.34, 0.13),
      sin(uTime * 0.33 + 0.4) * 0.017 * motionBoost
    );
  }

  vec2 parallax = (uPointer - 0.5) * vec2(0.0065, 0.0042) * uHover * edgeGuard;
  point -= parallax;
  point = clamp(point, vec2(0.002), vec2(0.998));
  return vec2(point.x, 1.0 - point.y);
}

void main() {
  float shape = panelMask(vUv);
  if (shape <= 0.001) discard;

  vec2 warpedUv = sceneWarp(vUv);
  vec4 staticTextureColor = texture(uTexture, vUv);
  vec4 movedTextureColor = texture(uTexture, warpedUv);
  vec4 textureColor = mix(staticTextureColor, movedTextureColor, panelInterior(vUv));
  vec3 color = textureColor.rgb;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float engraving = smoothstep(0.42, 0.88, luminance);
  vec2 topUv = vec2(vUv.x, 1.0 - vUv.y);

  vec2 smokePoint = vec2(topUv.x * 2.2, topUv.y) * 3.15;
  float smokeRegion = 1.0;
  vec2 flow = vec2(0.0);

  if (uScene < 0.5) {
    flow = vec2(sin(topUv.y * 5.0 + uTime * 0.22) * 0.28, -uTime * 0.055);
    smokeRegion = smoothstep(0.16, 0.58, topUv.y);
  } else if (uScene < 1.5) {
    flow = vec2(sin(topUv.y * 7.0 - uTime * 0.18) * 0.18, -uTime * 0.072);
    smokeRegion = smoothstep(0.18, 0.46, topUv.y) * (1.0 - smoothstep(0.90, 1.0, topUv.y));
  } else if (uScene < 2.5) {
    flow = vec2((topUv.x - 0.5) * 0.42, -uTime * 0.062);
    smokeRegion = 1.0 - smoothstep(0.83, 0.99, topUv.y);
  } else {
    flow = vec2(sin(topUv.y * 4.0 + uTime * 0.16) * 0.16, -uTime * 0.038);
    smokeRegion = smoothstep(0.34, 0.72, topUv.y);
  }

  float smokeLarge = fbm(smokePoint + flow + uSeed * 4.17);
  float smokeFine = fbm(smokePoint * 1.83 - flow * 1.4 + 11.7 + uSeed);
  float smoke = smoothstep(0.49, 0.79, smokeLarge * 0.73 + smokeFine * 0.27);
  float darkArea = 1.0 - smoothstep(0.12, 0.56, luminance);
  float borderGuard =
    smoothstep(0.035, 0.12, vUv.x) *
    smoothstep(0.035, 0.12, 1.0 - vUv.x) *
    smoothstep(0.07, 0.15, vUv.y) *
    smoothstep(0.07, 0.15, 1.0 - vUv.y);
  float smokeAmount = smoke * darkArea * smokeRegion * borderGuard;
  vec2 refraction = vec2(
    noise21(smokePoint * 2.2 + flow + 4.1),
    noise21(smokePoint * 2.2 - flow + 9.7)
  ) - 0.5;
  vec3 refracted = texture(
    uTexture,
    clamp(warpedUv + refraction * 0.004 * smokeAmount, vec2(0.002), vec2(0.998))
  ).rgb;
  color = mix(color, refracted, smokeAmount * 0.48);
  vec3 smokeColor = mix(vec3(0.30), uAccent, 0.72);
  color += smokeColor * smokeAmount * mix(0.22, 0.31, uHover);

  vec3 liquidColor = mix(
    vec3(0.72, 0.91, 1.0),
    uAccent * 1.55 + vec3(0.08),
    0.54
  );
  float flowPassed = 0.0;

  // Each draw covers one card, so this uniform branch skips the expensive pass on idle cards.
  if (uHover > 0.002) {
  vec2 cryoPoint = flowCoordinates(topUv);
  float route = flowRoute(topUv);
  float frontNoise =
    (fbm(vec2(topUv.x * 5.2 + uSeed * 7.0, topUv.x * 1.8 - uTime * 0.16)) - 0.5) *
    0.135;
  float frontY = -0.08 + uFlowProgress * 1.18;
  float raggedY = topUv.y + frontNoise;
  float passed = 1.0 - smoothstep(frontY - 0.030, frontY + 0.085, raggedY);
  float front = exp(-pow((raggedY - frontY) / 0.060, 2.0));
  flowPassed = passed;
  float trail = passed *
    (1.0 - smoothstep(frontY + 0.20, frontY + 0.58, raggedY));
  float postPass = smoothstep(0.91, 1.0, uFlowProgress) *
    (0.34 + 0.13 * sin(uTime * 0.72 + uSeed * 13.0));
  float streamCoverage = max(trail, postPass * (0.34 + route * 0.66));

  float fallSpeed = uScene < 0.5
    ? 0.76
    : (uScene < 1.5 ? 1.08 : (uScene < 2.5 ? 0.58 : 0.40));
  float flowNoise = fbm(vec2(
    cryoPoint.x * 5.8 + uSeed * 12.0,
    cryoPoint.y * 3.6 - uTime * fallSpeed
  ));
  float fineFlow = fbm(vec2(
    cryoPoint.x * 12.0 - uTime * 0.13,
    cryoPoint.y * 7.2 - uTime * 1.12 + uSeed * 19.0
  ));
  float filaments = pow(
    clamp(ridge(flowNoise) * 0.62 + ridge(fineFlow) * 0.42, 0.0, 1.0),
    4.8
  );
  float vapor = smoothstep(
    0.40,
    0.82,
    fbm(cryoPoint * vec2(3.2, 4.6) + vec2(uSeed * 8.0, -uTime * 0.34))
  );
  float sourceMist =
    (1.0 - smoothstep(0.01, 0.16, topUv.y)) *
    (0.30 + vapor * 0.46) *
    (0.32 + front * 0.68);
  float channel = filaments * (0.10 + route * 0.84) * streamCoverage;
  float trailingVapor = vapor * (0.10 + route * 0.32) * streamCoverage;
  float frontFoam = front * (0.34 + route * 0.78) * (0.48 + ridge(fineFlow) * 0.52);
  float liquidCore = smoothstep(0.36, 0.88, route) *
    (0.34 + filaments * 0.66) * streamCoverage;
  float dropletPhase =
    sin(topUv.y * (uScene > 2.5 ? 13.0 : 17.0) - uTime * fallSpeed * 1.7 + uSeed * 20.0) *
    0.5 + 0.5;
  float droplets = smoothstep(0.78, 0.98, dropletPhase) *
    route * streamCoverage *
    (0.35 + 0.65 * smoothstep(0.18, 0.84, topUv.y));
  float lowerTextGuard = 1.0 - smoothstep(0.72, 0.94, topUv.y) * 0.62;
  float cryoAmount =
    clamp(channel + trailingVapor + frontFoam + sourceMist * 0.25, 0.0, 1.35) *
    uHover * borderGuard * lowerTextGuard;

  vec2 liquidNormal = vec2(
    noise21(cryoPoint * 18.0 + vec2(-uTime * 0.41, 3.7)),
    noise21(cryoPoint * 18.0 + vec2(9.1, -uTime * 0.77))
  ) - 0.5;
  float refractStrength = cryoAmount * (0.006 + frontFoam * 0.010);
  vec3 liquidRefraction = texture(
    uTexture,
    clamp(warpedUv + liquidNormal * refractStrength, vec2(0.002), vec2(0.998))
  ).rgb;
  color = mix(color, liquidRefraction, clamp(cryoAmount * 0.62, 0.0, 0.78));

  color *= 1.0 - clamp(cryoAmount * 0.11, 0.0, 0.13);
  float flowInkGuard = 0.42 + darkArea * 0.58;
  float frontInkGuard = 0.46 + darkArea * 0.34 + engraving * 0.20;
  color += liquidColor * channel * uHover * 0.34 * flowInkGuard * borderGuard;
  color += mix(liquidColor, vec3(0.90, 0.98, 1.0), 0.48) *
    liquidCore * uHover * 0.20 * flowInkGuard * borderGuard;
  color += vec3(0.93, 0.98, 1.0) * droplets * uHover * 0.16 * borderGuard;
  color += mix(liquidColor, vec3(0.90, 0.97, 1.0), 0.66) * frontFoam * uHover * 0.48 * frontInkGuard * borderGuard;
  color += liquidColor * (trailingVapor + sourceMist * 0.45) * uHover * 0.15 * flowInkGuard * borderGuard;
  }

  color += uAccent * engraving * (0.018 + uSelected * 0.015);

  float sceneEnergy = 0.0;
  if (uScene < 0.5) {
    sceneEnergy =
      ellipseMask(topUv, vec2(0.50, 0.225), vec2(0.24, 0.095), 0.30) *
      (0.50 + 0.50 * sin(uTime * 1.15));
  } else if (uScene < 1.5) {
    float eyeDistance = length((topUv - vec2(0.492, 0.490)) / vec2(0.12, 0.085));
    sceneEnergy = 1.0 - smoothstep(0.07, 0.20, abs(eyeDistance - 1.0));
  } else if (uScene < 2.5) {
    float wingHalo = ellipseMask(topUv, vec2(0.60, 0.38), vec2(0.43, 0.25), 0.28);
    float torsoCut = ellipseMask(topUv, vec2(0.52, 0.53), vec2(0.19, 0.24), 0.24);
    sceneEnergy = wingHalo * (1.0 - torsoCut) * (0.52 + 0.48 * sin(uTime * 0.82 + 1.4));
  } else {
    float skullHalo = ellipseMask(topUv, vec2(0.50, 0.30), vec2(0.35, 0.15), 0.28);
    float flowerHalo = ellipseMask(topUv, vec2(0.50, 0.67), vec2(0.37, 0.16), 0.25);
    sceneEnergy = max(skullHalo * 0.72, flowerHalo * (0.50 + 0.50 * sin(uTime * 0.91)));
  }
  color += liquidColor * sceneEnergy * (0.025 + uHover * flowPassed * 0.105) * borderGuard;

  if (uScene > 0.5 && uScene < 1.5) {
    vec2 eyeCenter = vec2(0.500, 0.484);
    vec2 autonomousLook = vec2(sin(uTime * 0.23 + 1.2), cos(uTime * 0.19)) * 0.35;
    vec2 pointerLook = clamp((uPointer - 0.5) * 2.0, vec2(-1.0), vec2(1.0));
    vec2 look = mix(autonomousLook, pointerLook, uHover);
    vec2 pupilCenter = eyeCenter + look * vec2(0.016, 0.006);
    float pupil = ellipseMask(topUv, pupilCenter, vec2(0.026, 0.013), 0.30);
    float glint = ellipseMask(topUv, pupilCenter + vec2(-0.008, -0.004), vec2(0.0045), 0.35);
    color *= 1.0 - pupil * 0.18;
    color += vec3(0.62, 0.88, 0.84) * glint * (0.38 + uHover * 0.52);
  }

  float vignette = 1.0 - smoothstep(0.18, 0.58, length((vUv - 0.5) * vec2(0.86, 0.36)));
  color *= mix(0.91, 1.015, vignette);
  color *= 1.0 + uSelected * 0.025;

  float grain = (hash21(gl_FragCoord.xy + uSeed * 137.0) - 0.5) * 0.026;
  color += grain;
  outColor = vec4(color, shape * staticTextureColor.a);
}
`

const SCENES = {
  avaritia: {
    index: 0,
    accent: [0.52, 0.4, 0.16],
    seed: 0.17,
    flowDuration: 2.25,
  },
  invidia: {
    index: 1,
    accent: [0.12, 0.46, 0.38],
    seed: 0.43,
    flowDuration: 2.15,
  },
  superbia: {
    index: 2,
    accent: [0.22, 0.48, 0.61],
    seed: 0.71,
    flowDuration: 2.45,
  },
  luxuria: {
    index: 3,
    accent: [0.52, 0.14, 0.22],
    seed: 0.91,
    flowDuration: 2.8,
  },
}

const mountedRoots = new WeakMap()
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message =
      gl.getShaderInfoLog(shader) || 'Unknown shader compile error'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown shader link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error(`Unable to load card texture: ${url}`))
    image.src = url
  })
}

function createTexture(gl, image) {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  return texture
}

function dispatch(root, type, detail) {
  root.dispatchEvent(new CustomEvent(type, { detail }))
}

export function mountGothicCards(root, options = {}) {
  const existing = mountedRoots.get(root)
  if (existing) return existing

  const stage = root.querySelector('[data-arcana-stage]') || root
  const cardElements = [...root.querySelectorAll('[data-arcana-card]')]
  if (cardElements.length === 0) {
    throw new Error('No [data-arcana-card] elements found')
  }

  const canvas = document.createElement('canvas')
  canvas.className = 'arcana-fx-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  stage.append(canvas)

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  })

  let destroyed = false
  let paused = false
  let visible = true
  let ready = false
  let frame = 0
  let lastTime = performance.now()
  let lastPaint = 0
  let stageRect = null
  let program = null
  let vertexArray = null
  let textures = []
  let resizeQueued = true
  const cleanup = []
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const saveData = navigator.connection?.saveData === true
  const fps = clamp(Number(options.fps) || (coarsePointer ? 24 : 30), 12, 60)
  const maxDpr = Number(options.maxDpr) || (coarsePointer ? 1.15 : 1.35)
  const states = cardElements.map((element, index) => {
    const scene =
      SCENES[element.dataset.scene] || Object.values(SCENES)[index % 4]
    return {
      element,
      scene,
      texture: null,
      rect: null,
      pointer: [0.5, 0.5],
      pointerTarget: [0.5, 0.5],
      hover: 0,
      hoverTarget: 0,
      flowAge: 0,
      flowProgress: 0,
      pointerInside: false,
      focusInside: false,
      selected: element.classList.contains('is-selected'),
    }
  })

  const controller = {
    ready: null,
    pause() {
      paused = true
    },
    resume() {
      paused = false
      lastTime = performance.now()
      requestFrame()
    },
    refresh() {
      resizeQueued = true
      requestFrame()
    },
    setSelected(index) {
      states.forEach((state, stateIndex) => {
        state.selected = stateIndex === index
        state.element.classList.toggle('is-selected', state.selected)
      })
      requestFrame()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      cancelAnimationFrame(frame)
      cleanup.splice(0).forEach((dispose) => dispose())
      textures.forEach((texture) => gl?.deleteTexture(texture))
      if (vertexArray) gl?.deleteVertexArray(vertexArray)
      if (program) gl?.deleteProgram(program)
      canvas.remove()
      root.classList.remove('is-fx-ready')
      mountedRoots.delete(root)
    },
  }
  mountedRoots.set(root, controller)

  function fail(error) {
    if (destroyed) return
    ready = false
    root.classList.remove('is-fx-ready')
    canvas.hidden = true
    dispatch(root, 'arcana-fx:error', { error })
    console.warn('[Arcana cards] WebGL fallback enabled:', error)
  }

  if (!gl || saveData) {
    const reason = saveData
      ? new Error('Data saver is enabled')
      : new Error('WebGL2 is unavailable')
    fail(reason)
    controller.ready = Promise.resolve(controller)
    return controller
  }

  function listen(target, type, handler, settings) {
    target.addEventListener(type, handler, settings)
    cleanup.push(() => target.removeEventListener(type, handler, settings))
  }

  states.forEach((state) => {
    listen(state.element, 'pointerenter', () => {
      if (!state.pointerInside && !state.focusInside) {
        state.flowAge = 0
        state.flowProgress = 0
      }
      state.pointerInside = true
      state.hoverTarget = 1
      requestFrame()
    })
    listen(state.element, 'pointerleave', () => {
      state.pointerInside = false
      state.hoverTarget = state.focusInside ? 1 : 0
      state.pointerTarget = [0.5, 0.5]
    })
    listen(state.element, 'pointermove', (event) => {
      const bounds = state.element.getBoundingClientRect()
      state.pointerTarget = [
        clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
        clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
      ]
    })
    listen(state.element, 'focusin', () => {
      if (!state.pointerInside && !state.focusInside) {
        state.flowAge = 0
        state.flowProgress = 0
      }
      state.focusInside = true
      state.hoverTarget = 1
      requestFrame()
    })
    listen(state.element, 'focusout', () => {
      state.focusInside = false
      state.hoverTarget = state.pointerInside ? 1 : 0
    })
  })

  listen(root, 'change', () => {
    states.forEach((state) => {
      const input = state.element.querySelector('input[type="radio"]')
      state.selected = Boolean(input?.checked)
    })
    requestFrame()
  })

  const scroller = root.querySelector('.arcana-cards__grid')
  if (scroller) {
    listen(
      scroller,
      'scroll',
      () => {
        resizeQueued = true
        requestFrame()
      },
      { passive: true }
    )
  }
  listen(
    window,
    'scroll',
    () => {
      resizeQueued = true
      requestFrame()
    },
    { passive: true }
  )
  listen(document, 'visibilitychange', () => {
    lastTime = performance.now()
    requestFrame()
  })
  listen(reducedMotion, 'change', () => {
    lastTime = performance.now()
    requestFrame()
  })

  const resizeObserver = new ResizeObserver(() => {
    resizeQueued = true
    requestFrame()
  })
  resizeObserver.observe(stage)
  cardElements.forEach((card) => resizeObserver.observe(card))
  cleanup.push(() => resizeObserver.disconnect())

  const intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      lastTime = performance.now()
      requestFrame()
    },
    { rootMargin: '160px' }
  )
  intersectionObserver.observe(stage)
  cleanup.push(() => intersectionObserver.disconnect())

  listen(canvas, 'webglcontextlost', (event) => {
    event.preventDefault()
    fail(new Error('WebGL context lost'))
  })
  listen(canvas, 'webglcontextrestored', () => {
    controller.destroy()
    mountGothicCards(root, options)
  })

  function updateLayout() {
    stageRect = stage.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
    const width = Math.max(1, Math.round(stageRect.width * dpr))
    const height = Math.max(1, Math.round(stageRect.height * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    states.forEach((state) => {
      const rect = state.element.getBoundingClientRect()
      state.rect = {
        x: rect.left - stageRect.left,
        y: rect.top - stageRect.top,
        width: rect.width,
        height: rect.height,
      }
    })
    resizeQueued = false
  }

  function smoothState(state, elapsed) {
    const hoverRate = state.hoverTarget > state.hover ? 7.5 : 4.5
    const hoverBlend = 1 - Math.exp(-elapsed * hoverRate)
    const pointerBlend = 1 - Math.exp(-elapsed * 7)
    state.hover += (state.hoverTarget - state.hover) * hoverBlend
    state.pointer[0] +=
      (state.pointerTarget[0] - state.pointer[0]) * pointerBlend
    state.pointer[1] +=
      (state.pointerTarget[1] - state.pointer[1]) * pointerBlend
    if (state.hoverTarget > 0 || state.hover > 0.002) {
      state.flowAge += elapsed
      state.flowProgress = clamp(state.flowAge / state.scene.flowDuration, 0, 1)
    }
  }

  let uniforms

  function draw(now) {
    if (!ready || destroyed) return
    if (resizeQueued || !stageRect) updateLayout()

    const dpr = canvas.width / Math.max(stageRect.width, 1)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.scissor(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    gl.bindVertexArray(vertexArray)

    states.forEach((state) => {
      const rect = state.rect
      const viewportX = Math.round(rect.x * dpr)
      const viewportY = Math.round(canvas.height - (rect.y + rect.height) * dpr)
      const viewportWidth = Math.max(1, Math.round(rect.width * dpr))
      const viewportHeight = Math.max(1, Math.round(rect.height * dpr))
      const left = clamp(viewportX, 0, canvas.width)
      const bottom = clamp(viewportY, 0, canvas.height)
      const right = clamp(viewportX + viewportWidth, 0, canvas.width)
      const top = clamp(viewportY + viewportHeight, 0, canvas.height)
      if (right <= left || top <= bottom) return

      gl.viewport(viewportX, viewportY, viewportWidth, viewportHeight)
      gl.scissor(left, bottom, right - left, top - bottom)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, state.texture)
      gl.uniform2f(uniforms.viewport, viewportWidth, viewportHeight)
      gl.uniform2f(uniforms.pointer, state.pointer[0], state.pointer[1])
      gl.uniform3fv(uniforms.accent, state.scene.accent)
      gl.uniform1f(uniforms.time, now / 1000)
      gl.uniform1f(uniforms.scene, state.scene.index)
      gl.uniform1f(
        uniforms.hover,
        reducedMotion.matches ? state.hoverTarget : state.hover
      )
      gl.uniform1f(
        uniforms.flowProgress,
        reducedMotion.matches && state.hoverTarget > 0 ? 1 : state.flowProgress
      )
      gl.uniform1f(uniforms.selected, state.selected ? 1 : 0)
      gl.uniform1f(uniforms.seed, state.scene.seed)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    })

    gl.bindVertexArray(null)
    gl.disable(gl.SCISSOR_TEST)
  }

  function requestFrame() {
    if (destroyed || frame) return
    frame = requestAnimationFrame(tick)
  }

  function tick(now) {
    frame = 0
    if (destroyed || !ready || paused || !visible || document.hidden) return

    const elapsedMs = clamp(now - lastTime, 0, 80)
    lastTime = now
    states.forEach((state) => smoothState(state, elapsedMs / 1000))

    const frameInterval = 1000 / fps
    if (now - lastPaint >= frameInterval || reducedMotion.matches) {
      draw(reducedMotion.matches ? 3200 : now)
      lastPaint = now
    }

    if (!reducedMotion.matches) requestFrame()
  }

  async function initialize() {
    try {
      program = createProgram(gl)
      vertexArray = gl.createVertexArray()
      uniforms = {
        viewport: gl.getUniformLocation(program, 'uViewport'),
        pointer: gl.getUniformLocation(program, 'uPointer'),
        accent: gl.getUniformLocation(program, 'uAccent'),
        time: gl.getUniformLocation(program, 'uTime'),
        scene: gl.getUniformLocation(program, 'uScene'),
        hover: gl.getUniformLocation(program, 'uHover'),
        flowProgress: gl.getUniformLocation(program, 'uFlowProgress'),
        selected: gl.getUniformLocation(program, 'uSelected'),
        seed: gl.getUniformLocation(program, 'uSeed'),
      }
      gl.useProgram(program)
      gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0)

      const images = await Promise.all(
        states.map((state) => {
          const url = new URL(state.element.dataset.art, document.baseURI).href
          return loadImage(url)
        })
      )
      if (destroyed) return controller

      textures = images.map((image) => createTexture(gl, image))
      states.forEach((state, index) => {
        state.texture = textures[index]
      })

      updateLayout()
      ready = true
      canvas.hidden = false
      draw(performance.now())

      // Keep the static artwork visible until WebGL has reached the compositor.
      await new Promise((resolve) => requestAnimationFrame(resolve))
      if (destroyed || gl.isContextLost()) return controller
      draw(performance.now())

      const glError = gl.getError()
      if (glError !== gl.NO_ERROR) {
        throw new Error(`WebGL card draw failed with error ${glError}`)
      }

      await new Promise((resolve) => requestAnimationFrame(resolve))
      if (destroyed || gl.isContextLost()) return controller
      root.classList.add('is-fx-ready')
      dispatch(root, 'arcana-fx:ready', { cards: states.length })
      requestFrame()
      return controller
    } catch (error) {
      fail(error)
      return controller
    }
  }

  controller.ready = initialize()
  return controller
}

document
  .querySelectorAll('[data-arcana-fx][data-auto-mount]')
  .forEach((root) => {
    mountGothicCards(root)
  })
