import {
  Type, Image as ImageIcon, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { CSSProperties } from 'react';

/** 节点 subtype → 图标组件映射（Canvas 与 CanvasNode 共享） */
export const NODE_ICON_MAP: Record<string, ComponentType<{ className?: string; style?: CSSProperties }>> = {
  Type, Image: ImageIcon, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
};
