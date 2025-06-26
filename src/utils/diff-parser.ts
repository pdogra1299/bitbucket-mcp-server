import { minimatch } from 'minimatch';

export interface DiffSection {
  filePath: string;
  oldPath?: string; // For renamed files
  content: string;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  isBinary: boolean;
}

export interface FilterOptions {
  includePatterns?: string[];
  excludePatterns?: string[];
  filePath?: string;
}

export interface FilteredResult {
  sections: DiffSection[];
  metadata: {
    totalFiles: number;
    includedFiles: number;
    excludedFiles: number;
    excludedFileList: string[];
  };
}

export class DiffParser {
  /**
   * Parse a unified diff into file sections
   */
  parseDiffIntoSections(diff: string): DiffSection[] {
    const sections: DiffSection[] = [];
    
    // Split by file boundaries - handle both formats
    const fileChunks = diff.split(/(?=^diff --git)/gm).filter(chunk => chunk.trim());
    
    for (const chunk of fileChunks) {
      const section = this.parseFileSection(chunk);
      if (section) {
        sections.push(section);
      }
    }
    
    return sections;
  }

  /**
   * Parse a single file section from the diff
   */
  private parseFileSection(chunk: string): DiffSection | null {
    const lines = chunk.split('\n');
    if (lines.length === 0) return null;
    
    // Extract file paths from the diff header
    let filePath = '';
    let oldPath: string | undefined;
    let isNew = false;
    let isDeleted = false;
    let isRenamed = false;
    let isBinary = false;
    
    // Look for diff --git line - handle both standard and Bitbucket Server formats
    const gitDiffMatch = lines[0].match(/^diff --git (?:a\/|src:\/\/)(.+?) (?:b\/|dst:\/\/)(.+?)$/);
    if (gitDiffMatch) {
      const [, aPath, bPath] = gitDiffMatch;
      filePath = bPath;
      
      // Check subsequent lines for file status
      for (let i = 1; i < Math.min(lines.length, 10); i++) {
        const line = lines[i];
        
        if (line.startsWith('new file mode')) {
          isNew = true;
        } else if (line.startsWith('deleted file mode')) {
          isDeleted = true;
          filePath = aPath; // Use the original path for deleted files
        } else if (line.startsWith('rename from')) {
          isRenamed = true;
          oldPath = line.replace('rename from ', '');
        } else if (line.includes('Binary files') && line.includes('differ')) {
          isBinary = true;
        } else if (line.startsWith('--- ')) {
          // Alternative way to detect new/deleted
          if (line.includes('/dev/null')) {
            isNew = true;
          }
        } else if (line.startsWith('+++ ')) {
          if (line.includes('/dev/null')) {
            isDeleted = true;
          }
          // Extract path from +++ line if needed - handle both formats
          const match = line.match(/^\+\+\+ (?:b\/|dst:\/\/)(.+)$/);
          if (match && !filePath) {
            filePath = match[1];
          }
        }
      }
    }
    
    // Fallback: try to extract from --- and +++ lines
    if (!filePath) {
      for (const line of lines) {
        if (line.startsWith('+++ ')) {
          const match = line.match(/^\+\+\+ (?:b\/|dst:\/\/)(.+)$/);
          if (match) {
            filePath = match[1];
            break;
          }
        } else if (line.startsWith('--- ')) {
          const match = line.match(/^--- (?:a\/|src:\/\/)(.+)$/);
          if (match) {
            filePath = match[1];
          }
        }
      }
    }
    
    if (!filePath) return null;
    
    return {
      filePath,
      oldPath,
      content: chunk,
      isNew,
      isDeleted,
      isRenamed,
      isBinary
    };
  }

  /**
   * Apply filters to diff sections
   */
  filterSections(sections: DiffSection[], options: FilterOptions): FilteredResult {
    const excludedFileList: string[] = [];
    let filteredSections = sections;
    
    // If specific file path is requested, only keep that file
    if (options.filePath) {
      filteredSections = sections.filter(section => 
        section.filePath === options.filePath || 
        section.oldPath === options.filePath
      );
      
      // Track excluded files
      sections.forEach(section => {
        if (section.filePath !== options.filePath && 
            section.oldPath !== options.filePath) {
          excludedFileList.push(section.filePath);
        }
      });
    } else {
      // Apply exclude patterns first (blacklist)
      if (options.excludePatterns && options.excludePatterns.length > 0) {
        filteredSections = filteredSections.filter(section => {
          const shouldExclude = options.excludePatterns!.some(pattern => 
            minimatch(section.filePath, pattern, { matchBase: true })
          );
          
          if (shouldExclude) {
            excludedFileList.push(section.filePath);
            return false;
          }
          return true;
        });
      }
      
      // Apply include patterns if specified (whitelist)
      if (options.includePatterns && options.includePatterns.length > 0) {
        filteredSections = filteredSections.filter(section => {
          const shouldInclude = options.includePatterns!.some(pattern => 
            minimatch(section.filePath, pattern, { matchBase: true })
          );
          
          if (!shouldInclude) {
            excludedFileList.push(section.filePath);
            return false;
          }
          return true;
        });
      }
    }
    
    return {
      sections: filteredSections,
      metadata: {
        totalFiles: sections.length,
        includedFiles: filteredSections.length,
        excludedFiles: sections.length - filteredSections.length,
        excludedFileList
      }
    };
  }

  /**
   * Reconstruct a unified diff from filtered sections
   */
  reconstructDiff(sections: DiffSection[]): string {
    if (sections.length === 0) {
      return '';
    }
    
    // Join all sections with proper spacing
    return sections.map(section => section.content).join('\n');
  }
}
