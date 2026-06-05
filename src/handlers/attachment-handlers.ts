import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../utils/api-client.js';
import { isManageAttachmentsArgs } from '../types/guards.js';

/**
 * Manage existing repository attachments (Bitbucket Server / Data Center only).
 *
 * Uploading + embedding attachments into comments/PR descriptions is handled by the
 * `attachments` flag on add_comment / create_pull_request / update_pull_request.
 * This tool covers the two documented, by-numeric-id operations: download and delete.
 * Bitbucket has no API to LIST attachments, so that action is intentionally absent.
 */
export class AttachmentHandlers {
  constructor(
    private apiClient: BitbucketApiClient,
    private baseUrl: string
  ) {}

  async handleManageAttachments(args: any) {
    if (!isManageAttachmentsArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for manage_attachments');
    }

    if (!this.apiClient.getIsServer()) {
      return {
        content: [
          {
            type: 'text',
            text:
              'Attachment management is only supported on Bitbucket Server / Data Center. ' +
              'Bitbucket Cloud has no public attachment API.',
          },
        ],
        isError: true,
      };
    }

    const { workspace, repository, action, attachment_id } = args;
    const attachmentId = String(attachment_id);

    switch (action) {
      case 'download':
        return this.downloadAttachment(workspace, repository, attachmentId);
      case 'delete':
        return this.deleteAttachment(workspace, repository, attachmentId);
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown action: ${action}`);
    }
  }

  private async downloadAttachment(workspace: string, repository: string, attachmentId: string) {
    try {
      const { data, contentType } = await this.apiClient.downloadAttachment(
        workspace,
        repository,
        attachmentId
      );
      const mime = contentType.split(';')[0].trim() || 'application/octet-stream';
      const sizeKB = (data.length / 1024).toFixed(1);

      if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
        return {
          content: [
            {
              type: 'text',
              text: `**Attachment ${attachmentId}** (${mime}, ${sizeKB} KB)\n\n${data.toString('utf-8')}`,
            },
          ],
        };
      }

      if (mime.startsWith('image/')) {
        return {
          content: [
            { type: 'text', text: `**Attachment ${attachmentId}** (${mime}, ${sizeKB} KB)` },
            { type: 'image', data: data.toString('base64'), mimeType: mime },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text:
              `**Attachment ${attachmentId}**\n**Type**: ${mime}\n**Size**: ${sizeKB} KB\n\n` +
              'This attachment cannot be displayed as text or an image. Download it directly from Bitbucket.',
          },
        ],
      };
    } catch (error) {
      return this.apiClient.handleApiError(
        error,
        `downloading attachment ${attachmentId} in ${workspace}/${repository}`
      );
    }
  }

  private async deleteAttachment(workspace: string, repository: string, attachmentId: string) {
    try {
      await this.apiClient.makeRequest(
        'delete',
        `/rest/api/1.0/projects/${workspace}/repos/${repository}/attachments/${attachmentId}`
      );
      return {
        content: [
          {
            type: 'text',
            text: `Attachment ${attachmentId} deleted successfully from ${workspace}/${repository}.`,
          },
        ],
      };
    } catch (error: any) {
      // Bitbucket returns 401/403 (AuthorisationException) when the user lacks
      // REPO_ADMIN — surface that clearly instead of the generic "check your token".
      if (error?.isAxiosError && (error.status === 401 || error.status === 403)) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Cannot delete attachment ${attachmentId}: permission denied. ` +
                `Deleting attachments requires REPO_ADMIN permission on ${workspace}/${repository}.`,
            },
          ],
          isError: true,
        };
      }
      return this.apiClient.handleApiError(
        error,
        `deleting attachment ${attachmentId} in ${workspace}/${repository}`
      );
    }
  }
}
