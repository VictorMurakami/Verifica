import { renderShareImage } from "./_share/share-image";
import { SITE_TITLE } from "@/lib/site";

export const dynamic = "force-static";
export const alt = SITE_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderShareImage(size);
}
