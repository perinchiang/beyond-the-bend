import { smoothstep } from '../core/noise';

// The meadow beside the first bend after the rice fields.
const centreX = 54, centreZ = 72, innerRadius = 46, outerRadius = 58;
export function groundGrassCover(x: number, z: number) {
  return 1 - smoothstep(innerRadius, outerRadius, Math.hypot(x - centreX, z - centreZ));
}

export const groundGrassPaint = /* glsl */ `
float groundGrass(vec2 p, float patchNoise, float footprint) {
  float cover = 1.0 - smoothstep(${innerRadius}.0, ${outerRadius}.0,
    distance(p, vec2(${centreX}.0, ${centreZ}.0)));
  float detail = 1.0 - smoothstep(0.045, 0.19, footprint);
  if (cover <= 0.0) return 0.0;
  float growth = smoothstep(0.28, 0.65, patchNoise);
  float gust = sin(dot(p, vec2(0.19, 0.09)) - uTime * 1.55 + patchNoise * 1.8);
  // Unresolved leaves catch the light together; the meadow wash stays in place.
  float sheen = cover * growth * gust * 0.024;
  if (detail <= 0.0) return sheen;

  // Each mark has a fixed root. Wind bends its centre line towards the tip.
  vec2 grid = rot2(p, 0.56) / vec2(0.76, 0.85);
  vec2 cell = floor(grid);
  float seed = hash21(cell);
  vec2 root = vec2(0.38 + 0.24 * seed, 0.10 + 0.18 * hash21(cell + 5.2));
  vec2 local = fract(grid) - root;
  float t = clamp(local.y / (0.34 + 0.32 * seed), 0.0, 1.0);

  float lean = (seed - 0.4) * 0.24 * t + (0.09 + 0.19 * gust) * t*t;
  float width = mix(0.061, 0.018, t);
  float aa = max(0.006, footprint / 0.76);
  float mark = 1.0 - smoothstep(width - aa, width + aa, abs(local.x - lean));
  mark *= smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.72, 1.0, t));
  return sheen + mark * cover * detail * growth
    * mix(-0.095, 0.14, seed);
}
`;

// Land-use colours are fixed in world space so the grass growing on a field
// follows the same bank and cut line as the underlying gouache wash.
export const meadowMasks = /* glsl */ `
vec2 meadowMasks(vec2 p, float torn) {
  vec2 field = p - vec2(-24.0, 72.0);
  // A long windrow and a short sloping headland join near the southern bend.
  float longEdge = abs(field.y + 0.095 * field.x + 3.4 * sin(field.x / 28.0)) - 30.0;
  float end = abs(field.x - 0.28 * field.y) - 78.0;
  float corner = clamp(0.5 + 0.5 * (longEdge - end) / 19.0, 0.0, 1.0);
  float outline = mix(end, longEdge, corner) + 19.0 * corner * (1.0 - corner);
  float hay = 1.0 - smoothstep(-1.4, 2.3, outline + torn);
  // A narrow uncut strip runs along the uphill boundary and dies away
  // before the road. The dry passes stop at this blue-green margin.
  float margin = field.y + 0.095 * field.x + 3.4 * sin(field.x / 28.0) + 33.0;
  float headland = (1.0 - smoothstep(1.2, 5.8, abs(margin + 0.4*torn)))
    * (1.0 - smoothstep(58.0, 79.0, abs(field.x)));
  float bank = smoothstep(116.0, 121.0, p.y + 0.09 * p.x + torn);
  return vec2(hay, max(bank, headland));
}
`;
