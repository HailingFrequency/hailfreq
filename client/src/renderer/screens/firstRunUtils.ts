export function normalizeUrl(input: string): string {
  let s = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}
