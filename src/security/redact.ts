export function redact(value: string): string {
  return value
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(^|[\s&])key=[^\s&]+/gi, "$1key=[redacted]")
    .replace(/\bsk-[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z\-_]{10,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const code = String((error as { code: string }).code);
    const message = redact(String((error as { message: string }).message));
    return { code, message };
  }
  return { code: "internal", message: "The request could not be completed." };
}
