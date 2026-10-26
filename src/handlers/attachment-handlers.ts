import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BitbucketApiClient } from '../core/api-client.js';
import { encodeSegment } from '../core/paths.js';
import { isManageAttachmentsArgs } from '../tools/guards.js';
import { errorContent, textContent } from '../formatting/respond.js';
import type { ToolResponse } from '../types/index.js';

// manage_attachments (Server/DC only): download / delete by numeric id.
// Uploading + embedding is the `attachments` param on add_comment /
// create_pull_request / update_pull_request. Bitbucket has no list API.
// v3: text downloads are capped (config output.attachmentTextMaxKb) so a
// multi-MB log attachment can no longer flood the model context; the raw
// download itself is capped at attachments.maxDownloadMb. `delete` is the
// only write here and is refused under BITBUCKET_READ_ONLY (the tool stays
// listed so downloads keep working in read-only deployments).

export class AttachmentHandlers {
  constructor(private apiClient: BitbucketApiClient) {}

  async handleManageAttachments(args: any): Promise<ToolResponse> {
    if (!isManageAttachmentsArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for manage_attachments');
    }
    if (!this.apiClient.getIsServer()) {
      return errorContent('Attachment management is only supported on Bitbucket Server / Data Center.');
    }

    const { workspace, repository, action, attachment_id } = args;
    const attachmentId = String(attachment_id);
    switch (action) {
      case 'download':
        return this.download(workspace, repository, attachmentId);
      case 'delete':
        if (this.apiClient.getConfig().access.readOnly) {
          return errorContent('Refused: the server is running read-only (BITBUCKET_READ_ONLY); attachment deletion is a write.');
        }
        return this.delete(workspace, repository, attachmentId);
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown action: ${action}`);
    }
  }

  private async download(workspace: string, repository: string, attachmentId: string): Promise<ToolResponse> {
    try {
      const { data, contentType } = await this.apiClient.downloadAttachment(workspace, repository, attachmentId);
      const mime = contentType.split(';')[0].trim() || 'application/octet-stream';
      const sizeKB = (data.length / 1024).toFixed(1);
      const maxBytes = this.apiClient.getConfig().output.attachmentTextMaxKb * 1024;

      if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
        const truncated = data.length > maxBytes;
        const text = data.subarray(0, maxBytes).toString('utf-8');
        return textContent(
          `Attachment ${attachmentId} (${mime}, ${sizeKB} KB${truncated ? `, showing first ${this.apiClient.getConfig().output.attachmentTextMaxKb} KB` : ''})\n\n${text}` +
            (truncated ? `\n\n[truncated — ${sizeKB} KB total]` : '')
        );
      }
      if (mime.startsWith('image/')) {
        return {
          content: [
            { type: 'text', text: `Attachment ${attachmentId} (${mime}, ${sizeKB} KB)` },
            { type: 'image', data: data.toString('base64'), mimeType: mime },
          ],
        };
      }
      return textContent(
        `Attachment ${attachmentId}: ${mime}, ${sizeKB} KB — cannot be displayed as text or image; download it from Bitbucket directly.`
      );
    } catch (error: any) {
      if (error?.isAxiosError && error.status === undefined && /maxContentLength/i.test(String(error.message))) {
        return errorContent(
          `Attachment ${attachmentId} exceeds the ${this.apiClient.getConfig().attachments.maxDownloadMb} MB download cap (BITBUCKET_ATTACHMENT_MAX_DOWNLOAD_MB); download it from Bitbucket directly.`
        );
      }
      return this.apiClient.handleApiError(error, `downloading attachment ${attachmentId} in ${workspace}/${repository}`) as ToolResponse;
    }
  }

  private async delete(workspace: string, repository: string, attachmentId: string): Promise<ToolResponse> {
    try {
      await this.apiClient.makeRequest(
        'delete',
        `/rest/api/1.0/projects/${encodeSegment(workspace, 'workspace')}/repos/${encodeSegment(repository, 'repository')}/attachments/${encodeSegment(attachmentId, 'attachment_id')}`
      );
      return textContent(`Attachment ${attachmentId} deleted from ${workspace}/${repository}.`);
    } catch (error: any) {
      if (error?.isAxiosError && (error.status === 401 || error.status === 403)) {
        return errorContent(
          `Cannot delete attachment ${attachmentId}: permission denied (REPO_ADMIN required on ${workspace}/${repository}).`
        );
      }
      return this.apiClient.handleApiError(error, `deleting attachment ${attachmentId} in ${workspace}/${repository}`) as ToolResponse;
    }
  }
}
