import 'server-only';
import sharp, { type Metadata, type Sharp } from 'sharp';

// Longest side an uploaded picture keeps, in px. The column is 768px (`max-w-3xl`), so this still
// holds a 2× render, and leaves the zoom dialog (cms-features.md「画像の拡大」) room to enlarge into.
export const MAX_IMAGE_EDGE = 2000;

// Only lossy formats take a quality; PNG is re-encoded losslessly.
const JPEG_QUALITY = 85;
const WEBP_QUALITY = 85;

// sharp's format name → the extension lib/uploads.ts stores it under.
const EXTENSIONS = new Map<string, string>([
  ['png', 'png'],
  ['jpeg', 'jpg'],
  ['gif', 'gif'],
  ['webp', 'webp'],
]);

export type PreparedImage = { bytes: Buffer; ext: string };

/**
 * The bytes to store for an upload, and the extension its content (not its claimed type) calls for.
 * Drops EXIF / XMP / IPTC and text chunks, bakes EXIF orientation into the pixels, and shrinks the
 * longest side to {@link MAX_IMAGE_EDGE}, keeping the format. An image with nothing to drop or
 * shrink, and every animated one, comes back byte-for-byte. Resolves to `null` for bytes that are
 * not a readable PNG, JPEG, GIF or WebP.
 */
export async function prepareUploadImage(input: Buffer): Promise<PreparedImage | null> {
  try {
    const meta = await sharp(input).metadata();
    const ext = EXTENSIONS.get(meta.format);
    if (!ext) return null;
    // Resizing frames risks breaking the animation, and a GIF carries no EXIF.
    if (meta.format === 'gif' || (meta.pages ?? 1) > 1) return { bytes: input, ext };
    // Re-encoding a lossy image costs a generation, so an image is rewritten only when it has to be.
    if (!carriesMetadata(meta) && !isOversized(meta)) return { bytes: input, ext };

    const pipeline = sharp(input).autoOrient().resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const bytes = await encode(pipeline, meta.format).toBuffer();
    return { bytes, ext };
  } catch {
    return null;
  }
}

// An ICC profile is not listed: it says nothing about the author, and sharp's default output
// converts to sRGB and drops it anyway once the image is rewritten for another reason.
function carriesMetadata(meta: Metadata): boolean {
  return (
    meta.exif !== undefined ||
    meta.xmp !== undefined ||
    meta.iptc !== undefined ||
    meta.tifftagPhotoshop !== undefined ||
    (meta.comments?.length ?? 0) > 0
  );
}

function isOversized(meta: Metadata): boolean {
  return Math.max(meta.width, meta.height) > MAX_IMAGE_EDGE;
}

function encode(pipeline: Sharp, format: string): Sharp {
  switch (format) {
    case 'jpeg':
      return pipeline.jpeg({ quality: JPEG_QUALITY });
    case 'webp':
      return pipeline.webp({ quality: WEBP_QUALITY });
    default:
      return pipeline.png();
  }
}
