export function moveSpace<T>(
  spaces: readonly T[],
  index: number,
  direction: -1 | 1,
): T[] {
  const targetIndex = index + direction;
  if (index < 0 || index >= spaces.length || targetIndex < 0 || targetIndex >= spaces.length) {
    return [...spaces];
  }
  const reordered = [...spaces];
  [reordered[index], reordered[targetIndex]] = [
    reordered[targetIndex]!,
    reordered[index]!,
  ];
  return reordered;
}
