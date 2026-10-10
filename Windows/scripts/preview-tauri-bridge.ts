export function isTauri(): boolean { return false; }
export async function getProxyPort(): Promise<number | null> { return null; }
export async function withProxyOrigin(path: string): Promise<string> { return path; }
