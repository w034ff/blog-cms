import { IconSvg } from './IconSvg';
import { CAPTION_SHAPES } from './icon-shapes';

// A picture with a line under it — "caption this image". The geometry, and why the line is outside
// the frame, live with the shapes.
export function CaptionIcon() {
  return <IconSvg shapes={CAPTION_SHAPES} />;
}
