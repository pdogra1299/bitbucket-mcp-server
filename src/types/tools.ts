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

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: object;
  group: ToolGroup;
  availability: ToolAvailability;
};

export type RegisteredTool = ToolDefinition & {
  handler: ToolHandler;
};
