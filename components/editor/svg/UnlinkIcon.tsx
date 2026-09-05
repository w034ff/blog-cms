import { IconSvg } from './IconSvg';
import { UNLINK_SHAPES } from './icon-shapes';

// A horizontal chain with a slash across it — "remove the link". Same thin-stroke style as the
// other toolbar icons; the geometry, and why the chain is horizontal rather than diagonal, live
// with the shapes.
export function UnlinkIcon() {
  return <IconSvg shapes={UNLINK_SHAPES} />;
}
