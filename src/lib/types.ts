export type AppFile = {
  handle: FileSystemFileHandle;
  parentHandle: FileSystemDirectoryHandle;
  name: string;
  path: string;
  basePath?: string;
};

export type DuplicateGroup = {
  files: string[];
  reason: string;
  similarityScore: number;
};

export type DuplicateGroupWithSelection = DuplicateGroup & {
  id: string;
  selection: Set<string>;
};

    