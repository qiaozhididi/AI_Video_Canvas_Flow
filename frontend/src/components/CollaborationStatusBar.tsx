import { useCollabStore } from '@/stores/collabStore';

/** 顶部协作状态提示条：显示持锁数与在线人数 */
export function CollaborationStatusBar() {
  const myLocks = useCollabStore((s) => s.myLocks);
  const nodeLocks = useCollabStore((s) => s.nodeLocks);
  const onlineUsers = useCollabStore((s) => s.onlineUsers);

  const myLockCount = Object.keys(myLocks).length;
  const otherLockCount = Object.values(nodeLocks).filter(
    (l) => !myLocks[l.node_id],
  ).length;

  if (myLockCount === 0 && otherLockCount === 0) return null;

  return (
    <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-1.5 text-xs text-gray-600">
      {myLockCount > 0 && (
        <span className="text-blue-600">你正在编辑 {myLockCount} 个节点</span>
      )}
      {otherLockCount > 0 && (
        <span className="text-orange-600">{otherLockCount} 个节点被他人锁定</span>
      )}
      <span className="ml-auto text-gray-400">在线 {onlineUsers.length} 人</span>
    </div>
  );
}
