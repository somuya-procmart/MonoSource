'use client';
import { AuthImage } from './AuthImage';
import { Icon, categoryIcon } from './Icon';
/** Product image with a category glyph fallback. */
export function Thumb({ imageId, category, size = 40 }: { imageId?: string | null; category?: string | null; size?: number }) {
  return <AuthImage assetId={imageId} fallback={<Icon name={categoryIcon(category)} size={Math.round(size * 0.5)} />} />;
}
