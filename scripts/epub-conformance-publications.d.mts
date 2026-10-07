export function archiveProperties(file: string): Promise<{
  readonly multiDisk: boolean;
  readonly compressionMethods: readonly number[];
  readonly versionNeededValues: readonly number[];
}>;
export function generatePublication(
  suite: string,
  directory: string,
  outputDirectory: string,
): ReturnType<typeof archiveProperties>;
