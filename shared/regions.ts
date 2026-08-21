export const REGION_PRIORITY = [
  'global',
  'germany',
  'baden-wuerttemberg',
  'bayern',
  'berlin',
  'brandenburg',
  'bremen',
  'hamburg',
  'hessen',
  'mecklenburg-vorpommern',
  'niedersachsen',
  'nrw',
  'rheinland-pfalz',
  'saarland',
  'sachsen',
  'sachsen-anhalt',
  'schleswig-holstein',
  'thueringen',
] as const;

export type Region = (typeof REGION_PRIORITY)[number];

export const STATE_REGIONS: Region[] = REGION_PRIORITY.filter(
  (region) => region !== 'global' && region !== 'germany'
);

export function isRegion(value: string): value is Region {
  return (REGION_PRIORITY as readonly string[]).includes(value);
}
