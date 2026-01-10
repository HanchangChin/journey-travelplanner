import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function SortableItem(props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1, // 拖拉時變半透明
    position: 'relative',
    touchAction: 'pan-y' // ✨ 允許垂直滾動，只在把手區域才觸發拖拽
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
          {/* ✨ 把手區域：綁定 listeners，設置 touchAction: 'none' 以允許拖拽 */}
          <div 
            {...listeners} 
            style={{
              cursor: 'grab', 
              fontSize:'20px', 
              color:'#ccc', 
              padding:'5px 8px',
              touchAction: 'none', // 把手區域不允許滾動，只允許拖拽
              userSelect: 'none',
              WebkitUserSelect: 'none',
              flexShrink: 0
            }}
          >
             ⋮⋮ 
          </div>
          {/* ✨ 內容區域：不綁定 listeners，允許正常滾動和點擊 */}
          <div style={{flex:1, touchAction: 'pan-y'}}>
             {props.children}
          </div>
      </div>
    </div>
  );
}