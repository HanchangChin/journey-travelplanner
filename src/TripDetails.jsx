import { useEffect, useState, Fragment } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import TripSettingsModal from './TripSettingsModal'
import EditItemModal from './EditItemModal'
import { useJsApiLoader } from '@react-google-maps/api'

// ✨ React Query Imports
import { useQuery, useQueryClient } from '@tanstack/react-query'

// ✨ DND Kit Imports
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableItem } from './SortableItem';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY 
const LIBRARIES = ['places']

export default function TripDetails() {
  const { tripId } = useParams()
  const queryClient = useQueryClient() 

  const [trip, setTrip] = useState(null)
  const [days, setDays] = useState([])
  const [items, setItems] = useState([]) 
  const [selectedDay, setSelectedDay] = useState(null)
  
  const [showSettings, setShowSettings] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)

  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries: LIBRARIES })

  // ✨ 關鍵設定：PointerSensor 的 activationConstraint 
  // 這讓手機使用者可以「滑動頁面」而不會誤觸「拖曳行程」
  // 必須按住移動 5px 以上才會開始拖曳
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), 
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // --- Helpers ---
  const getWeekday = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-TW', { weekday: 'short' })
  }

  const getTodayOpeningHours = (dateString, openingHoursRaw) => {
    if (!openingHoursRaw) return null;
    let fullText = '';
    if (typeof openingHoursRaw === 'object' && openingHoursRaw?.text) fullText = openingHoursRaw.text;
    else if (typeof openingHoursRaw === 'string') { try { const parsed = JSON.parse(openingHoursRaw); fullText = parsed.text || openingHoursRaw; } catch { fullText = openingHoursRaw; } }
    if (!fullText) return null;
    const date = new Date(dateString);
    const dayNameEn = date.toLocaleDateString('en-US', { weekday: 'long' }); 
    const dayNameZh = date.toLocaleDateString('zh-TW', { weekday: 'long' }); 
    const lines = fullText.split('\n');
    return lines.find(line => line.includes(dayNameEn) || line.includes(dayNameZh)) || null;
  }

  const formatDisplayTime = (timeStr) => {
    if (!timeStr) return '--:--'
    if (trip?.is_24hr !== false) return timeStr.substring(0, 5)
    const [h, m] = timeStr.split(':').map(Number); const ampm = h >= 12 ? '下午' : '上午'; const h12 = h % 12 || 12 
    return `${ampm} ${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
  }

  const calculateDuration = (start, end) => {
    if (!start || !end) return '';
    const [startH, startM] = start.split(':').map(Number); const [endH, endM] = end.split(':').map(Number);
    let diff = (endH * 60 + endM) - (startH * 60 + startM); if (diff < 0) diff += 24 * 60;
    const h = Math.floor(diff / 60); const m = diff % 60;
    return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm' : ''}`.trim();
  }

  // --- Data Fetching ---
  const { data: cachedData, isLoading, isError } = useQuery({
    queryKey: ['tripDetails', tripId],
    queryFn: async () => {
      const { data: tripData, error: tripError } = await supabase.from('trips').select('*, trip_members(*)').eq('id', tripId).single()
      if (tripError) throw tripError

      const { data: daysData, error: daysError } = await supabase.from('trip_days').select('*').eq('trip_id', tripId).order('day_number')
      if (daysError) throw daysError

      const { data: itemsData, error: itemsError } = await supabase
        .from('itinerary_items')
        .select('*')
        .eq('trip_id', tripId)
        .order('sort_order', { ascending: true }) 
        .order('start_time', { ascending: true })
      if (itemsError) throw itemsError

      itemsData.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        if (a.category === 'accommodation') return 1;
        if (b.category === 'accommodation') return -1;
        return 0;
      });

      return { trip: tripData, days: daysData, items: itemsData }
    },
    enabled: !!tripId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24,
  })

  useEffect(() => {
    if (cachedData) {
      setTrip(cachedData.trip)
      setDays(cachedData.days)
      setItems(cachedData.items)
      
      if (!selectedDay && cachedData.days?.length > 0) {
        setSelectedDay(cachedData.days[0])
      } else if (selectedDay) {
        const updatedDay = cachedData.days.find(d => d.id === selectedDay.id)
        if (updatedDay) setSelectedDay(updatedDay)
      }
    }
  }, [cachedData])

  const handleTitleUpdate = async (e) => { 
      await supabase.from('trip_days').update({ title: e.target.value }).eq('id', selectedDay.id) 
      queryClient.invalidateQueries(['tripDetails', tripId])
  }
  
  const handleTitleChange = (e) => {
    const newTitle = e.target.value; setSelectedDay({ ...selectedDay, title: newTitle });
    setDays(days.map(d => d.id === selectedDay.id ? { ...d, title: newTitle } : d))
  }

  const openNewItemModal = () => { setEditingItem(null); setShowItemModal(true); }
  const openEditItemModal = (item) => { setEditingItem(item); setShowItemModal(true); }

  const handleRefresh = () => {
      queryClient.invalidateQueries(['tripDetails', tripId])
  }

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentDayItems = items.filter(i => i.trip_day_id === selectedDay.id);
    const oldIndex = currentDayItems.findIndex((item) => item.id === active.id);
    const newIndex = currentDayItems.findIndex((item) => item.id === over.id);
    const newOrder = arrayMove(currentDayItems, oldIndex, newIndex);
    
    const otherItems = items.filter(i => i.trip_day_id !== selectedDay.id);
    setItems([...otherItems, ...newOrder]);

    try {
        const updates = newOrder.map((item, index) => ({
            ...item, 
            trip_id: tripId, 
            sort_order: index + 1
        }));

        const { error } = await supabase.from('itinerary_items').upsert(updates);
        if (error) throw error;
        queryClient.invalidateQueries(['tripDetails', tripId])
    } catch (error) {
        console.error('排序更新失敗:', error);
        alert('排序儲存失敗: ' + error.message);
        handleRefresh();
    }
  };

  if (isLoading && !trip) return <div style={{padding:'20px', textAlign:'center'}}>載入行程中...</div>
  if (isError) return <div style={{padding:'20px', textAlign:'center', color:'red'}}>載入失敗，請檢查網路連線。</div>
  if (!trip) return null

  // --- Card Components (不變) ---
  const TransportCard = ({ item }) => {
    const t = item.transport_details || {};
    const travelers = t.travelers || [];
    const isArrivalCard = t.is_arrival_card;
    const isCarMode = t.sub_type === 'car_bus';
    const isPublic = t.sub_type === 'public'; 
    const isSimpleView = isPublic && (!item.start_time || !item.end_time);

    if (isSimpleView) {
      return (
        <div onClick={() => openEditItemModal(item)} className="card-hover" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px 15px', marginBottom: '10px', borderRadius: '20px', background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#4b5563', fontSize: '13px', fontWeight: '500', gap: '10px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ fontSize: '14px' }}>🚌</span><span>{t.duration_text || '移動'}</span></span>
          <span style={{ color: '#d1d5db' }}>|</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#374151' }}><span>{item.location_name?.split(' ')[0] || '起點'}</span><span style={{ color: '#9ca3af', fontSize: '10px' }}>➤</span><span>{t.arrival_location?.split(' ')[0] || '終點'}</span></span>
        </div>
      )
    }
    return (
      <div onClick={() => openEditItemModal(item)} className="card-hover" style={{ border: '1px solid #b3d7ff', borderRadius: '8px', marginBottom: '10px', background: 'linear-gradient(to right, #f0f8ff, #ffffff)', boxShadow: '0 3px 6px rgba(0,123,255,0.1)', overflow: 'hidden' }}>
        <div style={{ background: (isCarMode || isPublic) ? '#28a745' : '#007bff', color: 'white', padding: '8px 15px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold' }}>
          <span>{isPublic ? '🚌' : (isCarMode ? '🚗' : '✈️')} {t.company || '交通'} {t.vehicle_number}</span>
          <span>{travelers.length === 1 ? ((isCarMode||isPublic) ? '' : `PNR: ${travelers[0].booking_ref}`) : `👥 ${travelers.length} 人`}</span>
        </div>
        <div style={{ padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>{formatDisplayTime(isArrivalCard ? t.original_start_time : item.start_time)}{isArrivalCard && <sup style={{ color: '#d9534f' }}>-1</sup>}</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginTop: '4px' }}>{item.location_name?.split(' ')[0] || '出發地'}</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', color: '#999', fontSize: '12px' }}>
            <div style={{fontWeight:'bold', color: (isCarMode||isPublic) ? '#28a745' : '#007bff'}}>{t.duration_text || '--'}</div>
            <div style={{ fontSize: '20px', color: '#ccc' }}>────────➝</div>
          </div>
          <div style={{ textAlign: 'center', flex: 1 }}>
             <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>{formatDisplayTime(isArrivalCard ? item.start_time : item.end_time)}{!isArrivalCard && t.arrival_day_offset > 0 && <sup style={{ color: '#d9534f' }}>+{t.arrival_day_offset}</sup>}</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginTop: '4px' }}>{t.arrival_location?.split(' ')[0] || '抵達地'}</div>
          </div>
        </div>
      </div>
    )
  }

  const AccommodationCard = ({ item }) => {
    const acc = item.accommodation_details || {};
    const isStay = acc.is_generated_stay; 
    return (
      <div onClick={() => openEditItemModal(item)} className="card-hover" style={{ border: '1px solid #ffd6c2', borderRadius: '8px', marginBottom: '10px', background: isStay ? '#fffcf9' : 'linear-gradient(to right, #fff5f0, #ffffff)', boxShadow: '0 3px 6px rgba(230, 81, 0, 0.1)', overflow: 'hidden' }}>
        <div style={{ background: '#ff7043', color: 'white', padding: '8px 15px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold' }}>
          <span>🛏️ {isStay ? '續住：' : '入住：'} {item.name.replace('🏨 住宿: ', '')}</span>
          <span>{acc.agent || '住宿'}</span>
        </div>
        <div style={{ padding: '15px' }}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                <div>
                    <div style={{fontSize:'16px', fontWeight:'bold', color:'#d84315'}}>{item.location_name}</div>
                    <div style={{fontSize:'13px', color:'#666', marginTop:'4px'}}>📍 {item.address}</div>
                </div>
                <div style={{textAlign:'right'}}>
                    {item.cost > 0 && <div style={{fontSize:'16px', fontWeight:'bold', color:'#d84315'}}>{acc.currency} ${item.cost}</div>}
                </div>
            </div>
            {item.notes && <div style={{marginTop:'10px', fontSize:'13px', color:'#888'}}>📝 {item.notes}</div>}
        </div>
      </div>
    )
  }

  const GeneralCard = ({ item }) => {
    const duration = calculateDuration(item.start_time, item.end_time); 
    const getCategoryIcon = (cat) => { switch(cat) { case 'food': return '🍴'; case 'accommodation': return '🛏️'; default: return '🎡'; } }
    const todayHours = getTodayOpeningHours(selectedDay.day_date, item.opening_hours);
    return (
      <li onClick={() => openEditItemModal(item)} className="card-hover" style={{ padding: '15px', border: '1px solid #e0e0e0', marginBottom: '10px', borderRadius: '8px', background: 'white', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1 }}>
          <div style={{ fontSize: '28px' }}>{getCategoryIcon(item.category)}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', fontSize: '1.2em', color: '#333' }}>{item.name}</div>
            {todayHours && <div style={{ fontSize: '12px', color: '#d9534f', background: '#fff5f5', padding: '2px 6px', borderRadius: '4px', marginTop:'4px', display:'inline-block', border:'1px solid #ffcccc' }}>🕒 {todayHours}</div>}
            {item.notes && <div style={{ fontSize: '13px', color: '#888', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>📝 {item.notes}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '80px', justifyContent: 'flex-end' }}>
          <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>{formatDisplayTime(item.start_time) || '--:--'}</div>
        </div>
      </li>
    )
  }

  const NoteCard = ({ item }) => {
      return (
          <div onClick={() => openEditItemModal(item)} className="card-hover" style={{ background: '#fffde7', border: '1px solid #fff59d', borderRadius: '8px', padding: '15px', marginBottom: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <div style={{fontWeight:'bold', color:'#fbc02d', marginBottom:'5px', fontSize:'1.1em'}}>📝 {item.name}</div>
              {item.notes && <div style={{whiteSpace:'pre-wrap', fontSize:'14px', color:'#555', marginBottom: item.attachment_url ? '10px' : '0'}}>{item.notes}</div>}
              {item.attachment_url && (
                  <div style={{marginTop:'5px'}}>
                      <a href={item.attachment_url} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()} style={{ display:'inline-flex', alignItems:'center', gap:'6px', padding:'6px 12px', background:'#fff', border:'1px solid #ddd', borderRadius:'20px', textDecoration:'none', color:'#333', fontSize:'13px', boxShadow:'0 1px 2px rgba(0,0,0,0.05)' }}>
                          <span style={{fontSize:'16px'}}>{item.attachment_type === 'image' ? '🖼️' : '📄'}</span> 
                          <span>{item.attachment_type === 'image' ? '圖片' : '文件'}</span>
                          <span style={{color:'#999', fontSize:'10px'}}>↗</span>
                      </a>
                  </div>
              )}
          </div>
      )
  }

  const currentDayItems = items.filter(item => item.trip_day_id === selectedDay?.id);

  return (
    <div className="container">
      {/* ✨ CSS 樣式定義：處理響應式佈局 (Mobile vs Desktop) */}
      <style>{`
        .layout-container { display: flex; gap: 20px; min-height: 600px; }
        .sidebar { width: 220px; border-right: 1px solid #eee; padding-right: 10px; overflow-y: auto; max-height: 80vh; position: sticky; top: 20px; }
        .content-area { flex: 1; padding-left: 10px; }
        .day-item { padding: 12px 10px; cursor: pointer; margin-bottom: 5px; border-radius: 8px; transition: all 0.2s; }
        .day-item:hover { background-color: #f0f0f0; }
        .card-hover { cursor: pointer; transition: transform 0.1s; }
        .card-hover:active { transform: scale(0.98); }

        /* 📱 手機/平板模式 */
        @media (max-width: 768px) {
          .layout-container { flex-direction: column; }
          .sidebar { 
            width: 100%; 
            border-right: none; 
            border-bottom: 1px solid #eee; 
            padding-right: 0; 
            padding-bottom: 10px; 
            display: flex; /* 變成橫向排列 */
            overflow-x: auto; /* 支援橫向捲動 */
            white-space: nowrap;
            position: relative;
            top: 0;
            max-height: auto;
          }
          .content-area { padding-left: 0; margin-top: 20px; }
          .day-item { 
            flex: 0 0 auto; /* 防止縮小 */
            width: auto; 
            min-width: 100px; 
            text-align: center;
            margin-bottom: 0;
            margin-right: 10px;
            border-left: none !important;
            border-bottom: 4px solid transparent;
          }
        }
      `}</style>

      {showSettings && <TripSettingsModal trip={trip} onClose={() => setShowSettings(false)} onUpdate={handleRefresh} />}
      
      {showItemModal && selectedDay && (
        <EditItemModal 
          tripId={trip.id} 
          dayId={selectedDay.id} 
          days={days} 
          itemToEdit={editingItem} 
          tripMembers={trip.trip_members} 
          is24hr={trip.is_24hr}
          isLoaded={isLoaded}
          currentItemsCount={currentDayItems.length}
          onClose={() => setShowItemModal(false)} 
          onSave={handleRefresh} 
        />
      )}

      {/* Header Info */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <Link to="/" style={{ textDecoration: 'none', color: '#666', display:'inline-block', marginBottom:'10px' }}>← 返回列表</Link>
        <button onClick={() => setShowSettings(true)} style={{ padding: '8px 15px', background: '#f0f0f0', border: '1px solid #ccc', borderRadius:'20px', cursor:'pointer' }}>⚙️ 旅行設定</button>
      </div>
      <div style={{ borderBottom: '1px solid #eee', paddingBottom: '10px', marginBottom: '20px' }}>
        <h1 style={{ margin: '0 0 10px 0', fontSize: 'clamp(1.5rem, 5vw, 2.5rem)' }}>{trip.title}</h1>
        <div style={{ color: '#666', fontSize: '14px', display:'flex', flexWrap: 'wrap', gap: '15px' }}>
          <span>📅 {trip.start_date} ~ {trip.end_date}</span>
          <span>💰 預算: ${trip.budget_goal}</span>
          {/* 手機版隱藏旅伴 email，避免太長 */}
          <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            👫 {trip.trip_members?.length} 人
          </span>
        </div>
      </div>

      <div className="layout-container">
        {/* 左側選單 (手機變橫向) */}
        <div className="sidebar">
          {days.map(day => (
            <div 
              key={day.id} 
              onClick={() => setSelectedDay(day)} 
              className="day-item"
              style={{ 
                background: selectedDay?.id === day.id ? '#e3f2fd' : 'transparent', 
                // 電腦版是左邊框，手機版利用上面的 style 改成下邊框
                borderLeft: selectedDay?.id === day.id ? '4px solid #007bff' : '4px solid transparent',
                borderBottom: selectedDay?.id === day.id ? '4px solid #007bff' : '4px solid transparent' // 手機版生效
              }}
            >
              <div style={{ fontWeight: 'bold', color: '#333' }}>Day {day.day_number} {day.title ? <span style={{marginLeft:'5px'}}>{day.title}</span> : ''}</div>
              <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>{day.day_date} <span style={{color: '#ff9800'}}>({getWeekday(day.day_date)})</span></div>
            </div>
          ))}
        </div>

        {/* 右側詳細行程 (支援 DND) */}
        <div className="content-area">
          {selectedDay && (
            <>
              <div style={{ marginBottom: '20px', padding: '15px', background: '#f8f9fa', borderRadius: '10px' }}>
                <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px', fontWeight: 'bold' }}>{selectedDay.day_date} <span style={{color: '#ff9800'}}>({getWeekday(selectedDay.day_date)})</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>Day {selectedDay.day_number}</h2>
                  <input type="text" value={selectedDay.title || ''} onChange={handleTitleChange} onBlur={handleTitleUpdate} placeholder="重點 (例: 移動日)" style={{ fontSize: '1.2em', padding: '5px 10px', border: '1px solid #ccc', borderRadius: '6px', flex: 1, minWidth: 0 }} />
                </div>
              </div>
              
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={currentDayItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {currentDayItems.map(item => (
                        <SortableItem key={item.id} id={item.id}>
                          {(() => {
                             if (item.category === 'transport') return <TransportCard item={item} />
                             if (item.category === 'accommodation') return <AccommodationCard item={item} />
                             if (item.category === 'note') return <NoteCard item={item} />
                             return <GeneralCard item={item} />
                          })()}
                        </SortableItem>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              
              <button onClick={openNewItemModal} style={{ width: '100%', padding: '15px', background: '#007bff', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '50px' }}><span>➕</span> 新增行程</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}