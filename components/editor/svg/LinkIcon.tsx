import { IconSvg } from './IconSvg';
import { LINK_SHAPES } from './icon-shapes';

// An unbroken chain — "insert a link". Pairs with UnlinkIcon; the geometry lives with the shapes.
export function LinkIcon() {
  return <IconSvg shapes={LINK_SHAPES} />;
}
