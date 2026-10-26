import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { ConfigAccess, ListedTool, RegisteredTool, ToolDefinition, ToolHandler, ToolResponse } from '../types/index.js';

// Tool registry: single source of truth for what is exposed AND what is
// callable. Group / availability / read-only / disabled filtering is
// enforced at dispatch too — a hidden tool is not callable by guessing its
// name (the old switch only filtered ListTools).

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  constructor(
    private readonly isServer: boolean,
    private readonly enabledGroups: string[] | null,
    private readonly access: ConfigAccess
  ) {}

  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`);
    }
    this.tools.set(definition.name, { ...definition, handler });
  }

  /** Names of every registered tool (for validating BITBUCKET_DISABLED_TOOLS). */
  names(): string[] {
    return [...this.tools.keys()];
  }

  private isExposed(tool: RegisteredTool): boolean {
    if (tool.availability === 'server_only' && !this.isServer) return false;
    if (this.enabledGroups && !this.enabledGroups.includes(tool.group)) return false;
    if (this.access.readOnly && tool.mutates) return false;
    if (this.access.disabledTools.includes(tool.name)) return false;
    return true;
  }

  /** Definitions for ListTools (name/description/schema/annotations only). */
  listDefinitions(): ListedTool[] {
    return [...this.tools.values()]
      .filter(t => this.isExposed(t))
      .map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }));
  }

  async dispatch(name: string, args: Record<string, unknown>): Promise<ToolResponse> {
    const tool = this.tools.get(name);
    if (!tool || !this.isExposed(tool)) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return tool.handler(args ?? {});
  }
}
