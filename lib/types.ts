export type PostFrontmatter = {
  title: string;
  date: string;
  description: string;
  tags: string[];
  category: string;
  draft?: boolean;
};

export type Post = PostFrontmatter & {
  slug: string;
};

export type TagCount = {
  tag: string;
  count: number;
};

export type CategoryCount = {
  category: string;
  count: number;
};
