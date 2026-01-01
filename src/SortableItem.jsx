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
    touchAction: 'none' // 防止手機滾動干擾拖拉
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {/* 這裡我們把 listeners (拖拉事件) 綁在一個 "把手" 上，或者綁在整個 div 上。
         為了方便，我們先綁在整個 div 上，但為了避免影響點擊，
         通常建議在卡片左側做一個 ::: 符號當作把手。
      */}
      <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
          <div {...listeners} style={{cursor: 'grab', fontSize:'20px', color:'#ccc', padding:'5px'}}>
             ⋮⋮ 
          </div>
          <div style={{flex:1}}>
             {props.children}
          </div>
      </div>
    </div>
  );
}