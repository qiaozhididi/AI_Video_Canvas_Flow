import { useState, useCallback } from 'react';

export interface MenuState {
  visible: boolean;
  position: { x: number; y: number };
  type: 'node' | 'pane' | null;
  targetNodeId: string | null;
}

const INITIAL_STATE: MenuState = {
  visible: false,
  position: { x: 0, y: 0 },
  type: null,
  targetNodeId: null,
};

export function useContextMenu() {
  const [menuState, setMenuState] = useState<MenuState>(INITIAL_STATE);

  const openNodeMenu = useCallback((event: React.MouseEvent, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuState({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      type: 'node',
      targetNodeId: nodeId,
    });
  }, []);

  const openPaneMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setMenuState({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      type: 'pane',
      targetNodeId: null,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuState(INITIAL_STATE);
  }, []);

  return { menuState, openNodeMenu, openPaneMenu, closeMenu };
}
