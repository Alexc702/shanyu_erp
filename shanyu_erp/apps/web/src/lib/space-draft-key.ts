interface RandomUuidSource {
  randomUUID?: () => string;
}

let fallbackSequence = 0;

export function createSpaceDraftKey(
  randomUuidSource: RandomUuidSource | undefined = globalThis.crypto,
): string {
  if (typeof randomUuidSource?.randomUUID === "function") {
    return randomUuidSource.randomUUID();
  }

  fallbackSequence += 1;
  return `space-draft-${fallbackSequence}`;
}
