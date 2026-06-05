/**
 * Helpers for embedding uploaded Bitbucket attachments into comment / PR
 * description Markdown using the `attachment:N/M` reference scheme.
 */

export type AttachmentRender = 'image' | 'link' | 'auto';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?)$/i;

export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name);
}

/**
 * Build the Markdown for a single attachment reference.
 * - `image` → `![name](ref)` (renders inline)
 * - `link`  → `[name](ref)` (renders as a download link)
 * - `auto`  → image when the filename looks like an image, otherwise a link
 */
export function buildAttachmentMarkup(
  ref: string,
  name: string,
  render: AttachmentRender = 'auto'
): string {
  const asImage = render === 'image' || (render === 'auto' && isImageName(name));
  const label = name || 'attachment';
  return asImage ? `![${label}](${ref})` : `[${label}](${ref})`;
}

/**
 * Append attachment Markdown to a comment body / PR description, separated from
 * the existing text by a blank line. Returns the original body unchanged when
 * there are no attachments.
 */
export function appendAttachments(body: string, markups: string[]): string {
  if (!markups.length) return body;
  const block = markups.join('\n');
  const base = body && body.trim().length > 0 ? `${body.replace(/\s+$/, '')}\n\n` : '';
  return `${base}${block}`;
}
