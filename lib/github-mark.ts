// GitHub's own mark, as one path.
//
// Taken as published, for SPEAKERDECK_MARK_SHAPES' reason (docs/embed-requirements.md §18.8), from
// `icons/mark-github-24.svg` in `primer/octicons`. Scaled to the 21.5 span of the neighbouring marks
// and centred, baked in (an `IconShape` has no transform) at **3 decimals**, since the relative
// curves compound rounding and 2 decimals changed pixels.
//
// **In lib/ because both sides draw it**: the editor's icon set and the published code-block header
// (lib/rehype-code-source.ts, §19.4).
export const GITHUB_MARK_PATH =
  'M10.342 16.809c-2.772 -0.337 -4.724 -2.33 -4.724 -4.913 0 -1.05 0.378 -2.184 1.008 -2.939 -0.273 -0.693 -0.231 -2.163 0.084 -2.772 0.839 -0.105 1.973 0.337 2.645 0.944 0.797 -0.251 1.638 -0.378 2.667 -0.378 1.028 0 1.869 0.126 2.624 0.357 0.651 -0.588 1.806 -1.028 2.645 -0.924 0.294 0.566 0.337 2.037 0.063 2.75 0.673 0.798 1.029 1.87 1.029 2.96 0 2.583 -1.953 4.536 -4.766 4.893 0.713 0.462 1.197 1.469 1.197 2.624v2.184c0 0.63 0.524 0.987 1.154 0.735 3.801 -1.449 6.782 -5.249 6.782 -9.952C22.75 6.437 17.921 1.587 11.979 1.587 6.036 1.587 1.25 6.437 1.25 12.379c0 4.661 2.96 8.525 6.95 9.973 0.566 0.21 1.112 -0.168 1.112 -0.735V19.937a2.711 2.711 0 0 1 -1.008 0.209c-1.386 0 -2.205 -0.755 -2.792 -2.162 -0.231 -0.567 -0.483 -0.903 -0.967 -0.966 -0.252 -0.021 -0.336 -0.126 -0.336 -0.252 0 -0.252 0.421 -0.44 0.839 -0.44 0.609 0 1.134 0.378 1.68 1.154 0.421 0.609 0.861 0.882 1.386 0.882 0.524 0 0.86 -0.189 1.343 -0.672 0.357 -0.356 0.63 -0.671 0.882 -0.881';
