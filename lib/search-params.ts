// Pure helpers to parse URL search parameters into values with defaults.

export type RawParams = Record<string, string | string[] | undefined>;

export function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function oneOf<T extends string>(options: readonly T[], value: string, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}
