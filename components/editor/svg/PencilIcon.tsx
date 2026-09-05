import { IconSvg } from './IconSvg';
import { PENCIL_SHAPES } from './icon-shapes';

// Pencil on a diagonal — "edit". Same thin-stroke style as the other toolbar icons; the geometry
// and the note about why the nib is a separate stroke live with the shapes.
export function PencilIcon() {
  return <IconSvg shapes={PENCIL_SHAPES} />;
}
