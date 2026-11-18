// Optional, playable art studies selected by the comparison links.
export type StyleStudy = 'oil' | 'print' | 'gouache' | undefined;

export function readStyleStudy(value: string | null): StyleStudy {
  return value === 'oil' || value === 'print' || value === 'gouache' ? value : undefined;
}
