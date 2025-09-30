import type { AutoGroupDuplicatesOutput } from '@/ai/flows/auto-group-duplicates';

export type AppFile = {
  handle: FileSystemFileHandle;
  parentHandle: FileSystemDirectoryHandle;
  name: string;
  path: string;
};

export type DuplicateGroup = AutoGroupDuplicatesOutput['duplicateGroups'][0];

export type DuplicateGroupWithSelection = DuplicateGroup & {
  id: string;
  selection: Set<string>;
  similarityScore?: number;
};
