import { useEffect, useState, Fragment } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import TripSettingsModal from './TripSettingsModal'
import EditItemModal from './EditItemModal'
import { useJsApiLoader } from '@react-google-maps/api'

// ✨ DND Kit Imports
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableItem } from './SortableItem';

const GOOGLE_MAPS_API_KEY = "你的_GOOGLE_MAPS_API_KEY" // ⚠️ 請確認填入
const LIBRARIES = ['places']

export default function TripDetails() {
  const { tripId } = useParams()
  const [trip, setTrip] = useState(null)
  const [days, setDays] = useState([])
  const [items, setItems] = useState([]) 
  const [selectedDay, setSelectedDay] = useState(null)
  
  const [showSettings, setShowSettings] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)

  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries: LIBRARIES })

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
  async function fetchData() {
    const { data: tripData } = await supabase.from('trips').select('*, trip_members(*)').eq('id', tripId).single()
    setTrip(tripData)
    const { data: daysData } = await supabase.from('trip_days').select('*').eq('trip_id', tripId).order('day_number')
    setDays(daysData)
    if (daysData?.length > 0 && !selectedDay) setSelectedDay(prev => prev ? prev : daysData[0])
    fetchItems()
  }

  useEffect(() => { fetchData() }, [tripId])

  async function fetchItems() {
    const { data: itemsData } = await supabase
      .from('itinerary_items')
      .select('*')
      .eq('trip_id', tripId)
      .order('sort_order', { ascending: true }) 
      .order('start_time', { ascending: true })
    
    // 讓住宿沉底
    itemsData.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        if (a.category === 'accommodation') return 1;
        if (b.category === 'accommodation') return -1;
        return 0;
    });

    setItems(itemsData)
  }

  const handleTitleUpdate = async (e) => { await supabase.from('trip_days').update({ title: e.target.value }).eq('id', selectedDay.id) }
  const handleTitleChange = (e) => {
    const newTitle = e.target.value; setSelectedDay({ ...selectedDay, title: newTitle });
    setDays(days.map(d => d.id === selectedDay.id ? { ...d, title: newTitle } : d))
  }

  const openNewItemModal = () => { setEditingItem(null); setShowItemModal(true); }
  const openEditItemModal = (item) => { setEditingItem(item); setShowItemModal(true); }

  // DND 邏輯
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
    } catch (error) {
        console.error('排序更新失敗:', error);
        alert('排序儲存失敗: ' + error.message);
        fetchItems(); 
    }
  };

  if (!trip) return <div>載入中...</div>

  // --- Card Components ---

  // 🔥 1. TransportCard (簡化大眾運輸)
  const TransportCard = ({ item }) => {
    const t = item.transport_details || {};
    const travelers = t.travelers || [];
    const isArrivalCard = t.is_arrival_card;
    const isCarMode = t.sub_type === 'car_bus';
    const isPublic = t.sub_type === 'public'; 

    const isSimpleView = isPublic && (!item.start_time || !item.end_time);

    if (isSimpleView) {
      return (
        <div 
          onClick={() => openEditItemModal(item)}
          style={{ 
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            padding: '8px 15px', marginBottom: '10px', borderRadius: '20px', 
            background: '#f3f4f6', border: '1px solid #e5e7eb',
            color: '#4b5563', cursor: 'pointer', fontSize: '13px', fontWeight: '500', gap: '10px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '14px' }}>🚌</span>
            <span>{t.duration_text || '移動'}</span>
          </span>
          <span style={{ color: '#d1d5db' }}>|</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#374151' }}>
            <span>{item.location_name?.split(' ')[0] || '起點'}</span>
            <span style={{ color: '#9ca3af', fontSize: '10px' }}>➤</span>
            <span>{t.arrival_location?.split(' ')[0] || '終點'}</span>
          </span>
        </div>
      )
    }

    return (
      <div onClick={() => openEditItemModal(item)} style={{ border: '1px solid #b3d7ff', borderRadius: '8px', marginBottom: '10px', background: 'linear-gradient(to right, #f0f8ff, #ffffff)', cursor: 'pointer', boxShadow: '0 3px 6px rgba(0,123,255,0.1)', overflow: 'hidden' }}>
        <div style={{ background: (isCarMode || isPublic) ? '#28a745' : '#007bff', color: 'white', padding: '8px 15px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold' }}>
          <span>{isPublic ? '🚌' : (isCarMode ? '🚗' : '✈️')} {t.company || '交通'} {t.vehicle_number}</span>
          <span>{travelers.length === 1 ? ((isCarMode||isPublic) ? '' : `PNR: ${travelers[0].booking_ref}`) : `👥 ${travelers.length} 人`}</span>
        </div>
        <div style={{ padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', position: 'relative', display: 'inline-block' }}>{formatDisplayTime(isArrivalCard ? t.original_start_time : item.start_time)}{isArrivalCard && <sup style={{ color: '#d9534f', fontSize: '10px', marginLeft: '2px', fontWeight: 'bold' }}>-1</sup>}</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginTop: '4px' }}>{item.location_name?.split(' ')[0] || '出發地'}</div>
            <div style={{ fontSize: '12px', color: '#666' }}>{t.departure_terminal || ''}</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', color: '#999', fontSize: '12px' }}>
            <div style={{fontWeight:'bold', color: (isCarMode||isPublic) ? '#28a745' : '#007bff'}}>{t.duration_text || '--'}</div>
            <div style={{ fontSize: '20px', color: '#ccc' }}>────────➝</div>
            {(isCarMode||isPublic) && t.distance_text && <div style={{fontSize:'11px', color:'#555'}}>📏 {t.distance_text}</div>}
            {(isCarMode||isPublic) && t.buffer_time > 0 && <div style={{fontSize:'11px', color:'#d9534f'}}>+Buffer {t.buffer_time}m</div>}
            {item.cost > 0 && <div style={{ color: '#28a745', fontWeight: 'bold', marginTop:'2px' }}>${item.cost}</div>}
          </div>
          <div style={{ textAlign: 'center', flex: 1 }}>
             <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', position: 'relative', display: 'inline-block' }}>{formatDisplayTime(isArrivalCard ? item.start_time : item.end_time)}{!isArrivalCard && t.arrival_day_offset > 0 && <sup style={{ color: '#d9534f', fontSize: '10px', marginLeft: '2px', fontWeight: 'bold' }}>+{t.arrival_day_offset}</sup>}</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginTop: '4px' }}>{t.arrival_location?.split(' ')[0] || '抵達地'}</div>
            <div style={{ fontSize: '12px', color: '#666' }}>{t.arrival_terminal || ''}</div>
          </div>
        </div>
      </div>
    )
  }

  // 🔥 2. AccommodationCard
  const AccommodationCard = ({ item }) => {
    const acc = item.accommodation_details || {};
    const isStay = acc.is_generated_stay; 
    return (
      <div onClick={() => openEditItemModal(item)} style={{ border: '1px solid #ffd6c2', borderRadius: '8px', marginBottom: '10px', background: isStay ? '#fffcf9' : 'linear-gradient(to right, #fff5f0, #ffffff)', cursor: 'pointer', boxShadow: '0 3px 6px rgba(230, 81, 0, 0.1)', overflow: 'hidden' }}>
        <div style={{ background: '#ff7043', color: 'white', padding: '8px 15px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold' }}>
          <span>🛏️ {isStay ? '續住：' : '入住：'} {item.name.replace('🏨 住宿: ', '')}</span>
          <span>{acc.agent || '住宿'}</span>
        </div>
        <div style={{ padding: '15px' }}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                <div>
                    <div style={{fontSize:'16px', fontWeight:'bold', color:'#d84315'}}>{item.location_name}</div>
                    <div style={{fontSize:'13px', color:'#666', marginTop:'4px'}}>📍 {item.address}</div>
                    {acc.phone && <div style={{fontSize:'13px', color:'#666'}}>📞 {acc.phone}</div>}
                </div>
                <div style={{textAlign:'right'}}>
                    {item.cost > 0 && <div style={{fontSize:'16px', fontWeight:'bold', color:'#d84315'}}>{acc.currency} ${item.cost}</div>}
                    <div style={{marginTop:'5px'}}>{acc.is_paid ? <span style={{background:'#e8f5e9', color:'#2e7d32', padding:'2px 8px', borderRadius:'10px', fontSize:'11px', border:'1px solid #a5d6a7'}}>已付款</span> : <span style={{background:'#ffebee', color:'#c62828', padding:'2px 8px', borderRadius:'10px', fontSize:'11px', border:'1px solid #ef9a9a'}}>尚未付款</span>}</div>
                </div>
            </div>
            {!isStay && (
                <div style={{marginTop:'15px', paddingTop:'10px', borderTop:'1px dashed #ffd6c2', display:'flex', gap:'20px', fontSize:'13px', color:'#555'}}>
                    <div><span style={{fontWeight:'bold', color:'#e65100'}}>📥 Check-in:</span> {acc.checkin_date} {formatDisplayTime(item.start_time)}</div>
                    <div><span style={{fontWeight:'bold', color:'#e65100'}}>📤 Check-out:</span> {acc.checkout_date} {formatDisplayTime(item.end_time)}</div>
                </div>
            )}
            {item.notes && <div style={{marginTop:'10px', fontSize:'13px', color:'#888'}}>📝 {item.notes}</div>}
        </div>
      </div>
    )
  }

  // 🔥 3. GeneralCard
  const GeneralCard = ({ item }) => {
    const duration = calculateDuration(item.start_time, item.end_time); 
    const getCategoryIcon = (cat) => { switch(cat) { case 'food': return '🍴'; case 'accommodation': return '🛏️'; default: return '🎡'; } }
    const todayHours = getTodayOpeningHours(selectedDay.day_date, item.opening_hours);
    return (
      <li onClick={() => openEditItemModal(item)} style={{ padding: '15px', border: '1px solid #e0e0e0', marginBottom: '10px', borderRadius: '8px', background: 'white', cursor: 'pointer', transition: '0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1 }}>
          <div style={{ fontSize: '28px' }}>{getCategoryIcon(item.category)}</div>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '1.2em', color: '#333' }}>{item.name}</div>
            {item.address && <div style={{ fontSize: '13px', color: '#666', marginTop:'2px' }}>📍 {item.address}</div>}
            {item.phone && <div style={{ fontSize: '13px', color: '#666' }}>📞 {item.phone}</div>}
            {todayHours && <div style={{ fontSize: '12px', color: '#d9534f', background: '#fff5f5', padding: '2px 6px', borderRadius: '4px', marginTop:'4px', display:'inline-block', border:'1px solid #ffcccc' }}>🕒 {todayHours}</div>}
            {item.notes && <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>📝 {item.notes}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '180px', justifyContent: 'flex-end' }}>
          <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>{formatDisplayTime(item.start_time) || '--:--'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '60px' }}>
            {duration && <span style={{ fontSize: '10px', background: '#e3f2fd', color: '#007bff', padding: '2px 6px', borderRadius: '10px', marginBottom:'2px' }}>{duration}</span>}
            <span style={{ color: '#ccc', fontSize: '12px' }}>──➝</span>
          </div>
          <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>{formatDisplayTime(item.end_time) || '--:--'}</div>
        </div>
      </li>
    )
  }

  // 🔥 4. ✨ NoteCard (修正：將圖片改為附件按鈕)
  const NoteCard = ({ item }) => {
      return (
          <div onClick={() => openEditItemModal(item)} style={{ background: '#fffde7', border: '1px solid #fff59d', borderRadius: '8px', padding: '15px', marginBottom: '10px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <div style={{fontWeight:'bold', color:'#fbc02d', marginBottom:'5px', fontSize:'1.1em'}}>📝 {item.name}</div>
              {item.notes && <div style={{whiteSpace:'pre-wrap', fontSize:'14px', color:'#555', marginBottom: item.attachment_url ? '10px' : '0'}}>{item.notes}</div>}
              
              {/* ✨ 修正：無論是圖片或 PDF，都顯示為一個可點擊的附件按鈕 */}
              {item.attachment_url && (
                  <div style={{marginTop:'5px'}}>
                      <a 
                        href={item.attachment_url} 
                        target="_blank" 
                        rel="noreferrer" 
                        onClick={(e)=>e.stopPropagation()} // 防止點擊連結時觸發卡片編輯
                        style={{
                            display:'inline-flex', alignItems:'center', gap:'6px', 
                            padding:'6px 12px', background:'#fff', border:'1px solid #ddd', borderRadius:'20px', 
                            textDecoration:'none', color:'#333', fontSize:'13px', transition:'0.2s',
                            boxShadow:'0 1px 2px rgba(0,0,0,0.05)'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = '#f9f9f9'}
                        onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                      >
                          <span style={{fontSize:'16px'}}>{item.attachment_type === 'image' ? '🖼️' : '📄'}</span> 
                          <span>{item.attachment_type === 'image' ? '檢視圖片附件' : '檢視文件附件'}</span>
                          <span style={{color:'#999', fontSize:'10px'}}>↗</span>
                      </a>
                  </div>
              )}
          </div>
      )
  }

  // Filter items for current day
  const currentDayItems = items.filter(item => item.trip_day_id === selectedDay?.id);

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      {showSettings && <TripSettingsModal trip={trip} onClose={() => setShowSettings(false)} onUpdate={fetchData} />}
      
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
          onSave={fetchItems} 
        />
      )}

      {/* Header Info */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <Link to="/" style={{ textDecoration: 'none', color: '#666', display:'inline-block', marginBottom:'10px' }}>← 返回列表</Link>
        <button onClick={() => setShowSettings(true)} style={{ padding: '8px 15px', background: '#f0f0f0', border: '1px solid #ccc', borderRadius:'20px', cursor:'pointer' }}>⚙️ 旅行設定</button>
      </div>
      <div style={{ borderBottom: '1px solid #eee', paddingBottom: '10px', marginBottom: '20px' }}>
        <h1 style={{ margin: '0 0 10px 0' }}>{trip.title}</h1>
        <div style={{ color: '#666', fontSize: '14px', display:'flex', gap:'20px' }}>
          <span>📅 {trip.start_date} ~ {trip.end_date}</span>
          <span>💰 預算: ${trip.budget_goal}</span>
          <span>👫 {trip.trip_members?.map(m => m.email).join(', ') || '無旅伴'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', minHeight: '600px' }}>
        {/* 左側選單 */}
        <div style={{ width: '220px', borderRight: '1px solid #eee', paddingRight: '10px', overflowY: 'auto' }}>
          {days.map(day => (
            <div key={day.id} onClick={() => setSelectedDay(day)} style={{ padding: '12px 10px', cursor: 'pointer', marginBottom: '5px', borderRadius: '8px', background: selectedDay?.id === day.id ? '#e3f2fd' : 'transparent', borderLeft: selectedDay?.id === day.id ? '4px solid #007bff' : '4px solid transparent' }}>
              <div style={{ fontWeight: 'bold', color: '#333' }}>Day {day.day_number} {day.title ? <span style={{marginLeft:'5px'}}>{day.title}</span> : ''}</div>
              <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>{day.day_date} <span style={{color: '#ff9800'}}>({getWeekday(day.day_date)})</span></div>
            </div>
          ))}
        </div>

        {/* 右側詳細行程 (支援 DND) */}
        <div style={{ flex: 1, paddingLeft: '10px' }}>
          {selectedDay && (
            <>
              <div style={{ marginBottom: '20px', padding: '15px', background: '#f8f9fa', borderRadius: '10px' }}>
                <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px', fontWeight: 'bold' }}>{selectedDay.day_date} <span style={{color: '#ff9800'}}>({getWeekday(selectedDay.day_date)})</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ margin: 0 }}>Day {selectedDay.day_number}</h2>
                  <input type="text" value={selectedDay.title || ''} onChange={handleTitleChange} onBlur={handleTitleUpdate} placeholder="重點 (例: 移動日)" style={{ fontSize: '1.2em', padding: '5px 10px', border: '1px solid #ccc', borderRadius: '6px', flex: 1 }} />
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
                             // ✨ 渲染 NoteCard
                             if (item.category === 'note') return <NoteCard item={item} />
                             return <GeneralCard item={item} />
                          })()}
                       </SortableItem>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              
              <button onClick={openNewItemModal} style={{ width: '100%', padding: '15px', background: '#007bff', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><span>➕</span> 新增行程</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}