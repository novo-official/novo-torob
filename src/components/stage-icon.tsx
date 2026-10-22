import { Compass, MessageSquareText, Scale, Store } from "lucide-react";

const ICONS = { compass: Compass, store: Store, scale: Scale, message: MessageSquareText } as const;

export function StageIcon({ name, size = 22 }: { name: keyof typeof ICONS; size?: number }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden size={size} />;
}
