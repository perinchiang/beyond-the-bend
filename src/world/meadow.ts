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
  float bank = smoothstep(116.0, 121.0, p.y + 0.09 * p.x + torn);
  return vec2(hay, bank);
}
`;
