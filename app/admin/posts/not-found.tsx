import { NotFoundContent, notFoundMetadata } from '@/components/NotFoundContent';

export const metadata = notFoundMetadata;

// Inside this shell's layout, which already draws the chrome (components/NotFoundContent.tsx).
export default function NotFound() {
  return <NotFoundContent />;
}
