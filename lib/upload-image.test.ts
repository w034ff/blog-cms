import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_EDGE, prepareUploadImage } from './upload-image';

function canvas(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#c05020' } });
}

describe('prepareUploadImage', () => {
  it('drops EXIF and bakes the orientation into the pixels', async () => {
    const input = await canvas(400, 200)
      .jpeg()
      .withExif({ IFD0: { Model: 'Test Phone' }, IFD3: { GPSLatitudeRef: 'N' } })
      // Not an IFD0 Orientation tag: sharp writes 1 over that one.
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.includes('Test Phone')).toBe(true);

    const out = await prepareUploadImage(input);
    expect(out?.ext).toBe('jpg');
    const after = await sharp(out?.bytes).metadata();
    expect(after.format).toBe('jpeg');
    expect(after.exif).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    // Rotated a quarter turn: what a viewer honouring the tag showed is now the pixels themselves.
    expect([after.width, after.height]).toEqual([200, 400]);
  });

  it('drops XMP from a PNG without resizing it', async () => {
    const input = await canvas(300, 100)
      .png()
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><secret/></x:xmpmeta>')
      .toBuffer();
    expect((await sharp(input).metadata()).xmp).toBeDefined();

    const out = await prepareUploadImage(input);
    const after = await sharp(out?.bytes).metadata();
    expect(after.xmp).toBeUndefined();
    expect([after.width, after.height]).toEqual([300, 100]);
  });

  it('shrinks the longest side to MAX_IMAGE_EDGE and keeps the format', async () => {
    const input = await canvas(MAX_IMAGE_EDGE * 2, 500)
      .webp()
      .toBuffer();
    const out = await prepareUploadImage(input);
    expect(out?.ext).toBe('webp');
    const after = await sharp(out?.bytes).metadata();
    expect(after.format).toBe('webp');
    expect([after.width, after.height]).toEqual([MAX_IMAGE_EDGE, 250]);
  });

  it('returns a clean image within the limit byte-for-byte', async () => {
    const input = await canvas(MAX_IMAGE_EDGE, 10).png().toBuffer();
    const out = await prepareUploadImage(input);
    expect(out?.ext).toBe('png');
    expect(out?.bytes.equals(input)).toBe(true);
  });

  it('never rewrites a GIF, however large', async () => {
    const input = await canvas(MAX_IMAGE_EDGE + 1, 10)
      .gif()
      .toBuffer();
    const out = await prepareUploadImage(input);
    expect(out?.ext).toBe('gif');
    expect(out?.bytes.equals(input)).toBe(true);
  });

  it('refuses bytes that are not a readable image', async () => {
    expect(await prepareUploadImage(Buffer.from('not an image'))).toBeNull();
    expect(await prepareUploadImage(await canvas(10, 10).tiff().toBuffer())).toBeNull();
  });
});
