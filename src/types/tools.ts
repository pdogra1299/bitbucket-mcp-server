// Tool registry types.

export type ToolGroup =
  | 'pr_core'
  | 'pr_comments'
  | 'pr_review'
  | 'commits'
  | 'branches'
  | 'files'
  | 'search'
  | 'attachments'
  | 'discovery';

export type ToolAvailability = 'both' | 'server_only';

export type ToolResponse = {
  content: Array<{ type: string; [key: string]: unknown }>;
  isError?: boolean;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;

/** MCP tool annotations (hints only — never a security boundary by themselves). */
export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: object;
  group: ToolGroup;
  availability: ToolAvailability;
  /** True when ANY call can change Bitbucket state; hidden and refused under BITBUCKET_READ_ONLY. */
  mutates: boolean;
  annotations: ToolAnnotations;
};

export type ListedTool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: ToolAnnotations;
};

export type RegisteredTool = ToolDefinition & {
  handler: ToolHandler;
};
