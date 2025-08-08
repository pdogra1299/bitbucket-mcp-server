import { BitbucketApiClient } from '../utils/api-client.js';
import { 
  BitbucketServerSearchRequest,
  BitbucketServerSearchResult,
  FormattedSearchResult
} from '../types/bitbucket.js';
import { formatSearchResults, formatCodeSearchOutput } from '../utils/formatters.js';

interface SearchContext {
  assignment: string[];
  declaration: string[];
  usage: string[];
  exact: string[];
  any: string[];
}

function buildContextualPatterns(searchTerm: string): SearchContext {
  return {
    assignment: [
      `${searchTerm} =`,           // Variable assignment
      `${searchTerm}:`,            // Object property, JSON key
      `= ${searchTerm}`,           // Right-hand assignment
    ],
    declaration: [
      `${searchTerm} =`,           // Variable definition
      `${searchTerm}:`,            // Object key, parameter definition
      `function ${searchTerm}`,    // Function declaration
      `class ${searchTerm}`,       // Class declaration
      `interface ${searchTerm}`,   // Interface declaration
      `const ${searchTerm}`,       // Const declaration
      `let ${searchTerm}`,         // Let declaration
      `var ${searchTerm}`,         // Var declaration
    ],
    usage: [
      `.${searchTerm}`,            // Property/method access
      `${searchTerm}(`,            // Function call
      `${searchTerm}.`,            // Method chaining
      `${searchTerm}[`,            // Array/object access
      `(${searchTerm}`,            // Parameter usage
    ],
    exact: [
      `"${searchTerm}"`,           // Exact quoted match
    ],
    any: [
      `"${searchTerm}"`,           // Exact match
      `${searchTerm} =`,           // Assignment
      `${searchTerm}:`,            // Object property
      `.${searchTerm}`,            // Property access
      `${searchTerm}(`,            // Function call
      `function ${searchTerm}`,    // Function definition
      `class ${searchTerm}`,       // Class definition
    ]
  };
}

function buildSmartQuery(
  searchTerm: string, 
  searchContext: string = 'any',
  includePatterns: string[] = []
): string {
  const contextPatterns = buildContextualPatterns(searchTerm);
  
  let patterns: string[] = [];
  
  // Add patterns based on context
  if (searchContext in contextPatterns) {
    patterns = [...contextPatterns[searchContext as keyof SearchContext]];
  } else {
    patterns = [...contextPatterns.any];
  }
  
  // Add user-provided patterns
  if (includePatterns && includePatterns.length > 0) {
    patterns = [...patterns, ...includePatterns];
  }
  
  // Remove duplicates and join with OR
  const uniquePatterns = [...new Set(patterns)];
  
  // If only one pattern, return it without parentheses
  if (uniquePatterns.length === 1) {
    return uniquePatterns[0];
  }
  
  // Wrap each pattern in quotes for safety and join with OR
  const quotedPatterns = uniquePatterns.map(pattern => `"${pattern}"`);
  return `(${quotedPatterns.join(' OR ')})`;
}

export class SearchHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string
  ) {}

  async handleSearchCode(args: any) {
    try {
      const { 
        workspace, 
        repository, 
        search_query, 
        search_context = 'any',
        file_pattern, 
        include_patterns = [],
        limit = 25, 
        start = 0 
      } = args;

      if (!workspace || !search_query) {
        throw new Error('Workspace and search_query are required');
      }

      // Only works for Bitbucket Server currently
      if (!this.apiClient.getIsServer()) {
        throw new Error('Code search is currently only supported for Bitbucket Server');
      }

      // Build the enhanced query string
      let query = `project:${workspace}`;
      if (repository) {
        query += ` repo:${repository}`;
      }
      if (file_pattern) {
        query += ` path:${file_pattern}`;
      }
      
      // Build smart search patterns
      const smartQuery = buildSmartQuery(search_query, search_context, include_patterns);
      query += ` ${smartQuery}`;

      // Prepare the request payload
      const payload: BitbucketServerSearchRequest = {
        query: query.trim(),
        entities: { 
          code: {
            start: start,
            limit: limit
          }
        }
      };

      // Make the API request (no query params needed, pagination is in payload)
      const response = await this.apiClient.makeRequest<BitbucketServerSearchResult>(
        'post',
        `/rest/search/latest/search?avatarSize=64`,
        payload
      );

      const searchResult = response;

      // Use simplified formatter for cleaner output
      const simplifiedOutput = formatCodeSearchOutput(searchResult);

      // Prepare pagination info
      const hasMore = searchResult.code?.isLastPage === false;
      const nextStart = hasMore ? (searchResult.code?.nextStart || start + limit) : undefined;
      const totalCount = searchResult.code?.count || 0;

      // Build a concise response with search context info
      let resultText = `Code search results for "${search_query}"`;
      if (search_context !== 'any') {
        resultText += ` (context: ${search_context})`;
      }
      resultText += ` in ${workspace}`;
      if (repository) {
        resultText += `/${repository}`;
      }
      
      // Show the actual search query used
      resultText += `\n\nSearch query: ${query.trim()}`;
      resultText += `\n\n${simplifiedOutput}`;
      
      if (totalCount > 0) {
        resultText += `\n\nTotal matches: ${totalCount}`;
        if (hasMore) {
          resultText += ` (showing ${start + 1}-${start + (searchResult.code?.values?.length || 0)})`;
        }
      }

      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to search code: ${errorMessage}`,
            details: error.response?.data
          }, null, 2)
        }],
        isError: true
      };
    }
  }
}
