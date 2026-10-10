export function portalPattern(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Open a job portal website first.");
  return `${parsed.protocol}//${parsed.hostname}/*`;
}
