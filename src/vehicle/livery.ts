/**
 * Car colours keyed by the material names in public/models/car.glb, so the livery can be tuned
 * without re-exporting the model. Shared by the diorama car and the graybox slice.
 */
export const LIVERY: Record<string, { color: string; emissive?: string; kind?: 'paint' | 'glass' | 'flat' }> = {
  paint: { color: '#e4573a', kind: 'paint' },
  paint_roof: { color: '#f3ecdc', kind: 'paint' },
  stripe: { color: '#f3ecdc', kind: 'paint' },
  stripe_dark: { color: '#23505c', kind: 'paint' },
  trim: { color: '#2b2a30' },
  underbody: { color: '#232228' },
  glass: { color: '#2c3e4e', kind: 'glass' },
  light_head: { color: '#fff6d8', emissive: '#8a8468' },
  light_tail: { color: '#d8322c', emissive: '#5a0d0c' },
  light_amber: { color: '#f2a23a', emissive: '#5a3508' },
  lamp_pod: { color: '#f4f1e6', emissive: '#6b6858' },
  tire: { color: '#2a292d' },
  rim: { color: '#f1ece0', kind: 'paint' },
  metal: { color: '#8f9198' },
  flap: { color: '#c93a2c' },
  plate: { color: '#f2eedf' },
};
