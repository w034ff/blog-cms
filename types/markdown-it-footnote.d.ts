// markdown-it-footnote ships no types, and @types/markdown-it-footnote would be a dependency
// added for a single line. The plugin's whole surface is the default export: a markdown-it plugin
// taking no options (index.mjs — `export default function footnote_plugin (md)`).
declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';

  const footnotePlugin: PluginSimple;
  export default footnotePlugin;
}
