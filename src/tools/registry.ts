import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { RegisteredTool, ToolDefinition, ToolHandler, ToolResponse } from '../types/index.js';

// Tool registry: single source of truth for what is exposed AND what is
// callable. Group/availability filtering is enforced at dispatch too — a
// hidden tool is not callable by guessing its name (the old switch only
// filtered ListTools).

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  constructor(
    private readonly isServer: boolean,
    private readonly enabledGroups: string[] | null
  ) {}

  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`);
    }
    this.tools.set(definition.name, { ...definition, handler });
  }

  private isExposed(tool: RegisteredTool): boolean {
    if (tool.availability === 'server_only' && !this.isServer) return false;
    if (this.enabledGroups && !this.enabledGroups.includes(tool.group)) return false;
    return true;
  }

  /** Definitions for ListTools (name/description/schema only). */
  listDefinitions(): Array<{ name: string; description: string; inputSchema: object }> {
    return [...this.tools.values()]
      .filter(t => this.isExposed(t))
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  async dispatch(name: string, args: Record<string, unknown>): Promise<ToolResponse> {
    const tool = this.tools.get(name);
    if (!tool || !this.isExposed(tool)) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return tool.handler(args ?? {});
  }
}
