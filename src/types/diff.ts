// Types for unified-diff parsing and glob filtering.

export type DiffSection = {
  filePath: string;
  oldPath?: string; // for renamed files
  content: string;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  isBinary: boolean;
};

export type DiffFilterOptions = {
  includePatterns?: string[];
  excludePatterns?: string[];
  filePath?: string;
};

export type DiffFilteredResult = {
  sections: DiffSection[];
  metadata: {
    totalFiles: number;
    includedFiles: number;
    excludedFiles: number;
    excludedFileList: string[];
  };
};
