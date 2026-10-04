import { IconSvg } from './IconSvg';
import { TRASH_SHAPES } from './icon-shapes';

// A waste basket — "delete this". Worn by the image bubble menu's destructive button, which colours
// it red the way the worded 削除 was coloured.
export function TrashIcon() {
  return <IconSvg shapes={TRASH_SHAPES} />;
}
