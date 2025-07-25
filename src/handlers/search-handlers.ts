import { BitbucketApiClient } from '../utils/api-client.js';
import { 
  BitbucketServerSearchRequest,
  BitbucketServerSearchResult,
  FormattedSearchResult
} from '../types/bitbucket.js';
import { formatSearchResults, formatCodeSearchOutput } from '../utils/formatters.js';

export class SearchHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string
  ) {}

  async handleSearchCode(args: any) {
    try {
      const { workspace, repository, search_query, file_pattern, limit = 25, start = 0 } = args;

      if (!workspace || !search_query) {
        throw new Error('Workspace and search_query are required');
      }

      // Build the query string
      let query = `project:${workspace}`;
      if (repository) {
        query += ` repo:${repository}`;
      }
      if (file_pattern) {
        query += ` path:${file_pattern}`;
      }
      query += ` ${search_query}`;

      // Only works for Bitbucket Server currently
      if (!this.apiClient.getIsServer()) {
        throw new Error('Code search is currently only supported for Bitbucket Server');
      }

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

      // Build a concise response
      let resultText = `Code search results for "${search_query}" in ${workspace}`;
      if (repository) {
        resultText += `/${repository}`;
      }
      resultText += `:\n\n${simplifiedOutput}`;
      
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
