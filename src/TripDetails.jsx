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

  if (isLoading && !trip) return <div className="loading-state">載入行程中...</div>
  if (isError) return <div className="error-state">載入失敗，請檢查網路連線。</div>
  if (!trip) return null

  // --- Card Components ---

  // 🔥 1. TransportCard
  const TransportCard = ({ item }) => {
    const t = item.transport_details || {};
    const travelers = t.travelers || [];
    const isArrivalCard = t.is_arrival_card;
    const isCarMode = t.sub_type === 'car_bus';
    const isPublic = t.sub_type === 'public'; 
    const isSimpleView = isPublic && (!item.start_time || !item.end_time);

    if (isSimpleView) {
      return (
        <div onClick={() => openEditItemModal(item)} className="card simple-card">
          <div className="simple-card-content">
            <span className="icon-text"><span className="icon">🚌</span><span>{t.duration_text || '移動'}</span></span>
            <span className="separator">|</span>
            <span className="location-flow"><span>{item.location_name?.split(' ')[0] || '起點'}</span><span className="arrow">➤</span><span>{t.arrival_location?.split(' ')[0] || '終點'}</span></span>
          </div>
        </div>
      )
    }
    return (
      <div onClick={() => openEditItemModal(item)} className="card transport-card">
        <div className={`card-header ${isCarMode || isPublic ? 'header-green' : 'header-blue'}`}>
          <span>{isPublic ? '🚌' : (isCarMode ? '🚗' : '✈️')} {t.company || '交通'} {t.vehicle_number}</span>
          <span>{travelers.length === 1 ? ((isCarMode||isPublic) ? '' : `PNR: ${travelers[0].booking_ref}`) : `👥 ${travelers.length} 人`}</span>
        </div>
        <div className="card-body transport-body">
          <div className="time-col">
            <div className="time-text">{formatDisplayTime(isArrivalCard ? t.original_start_time : item.start_time)}{isArrivalCard && <sup className="offset-text">-1</sup>}</div>
            <div className="place-text">{item.location_name?.split(' ')[0] || '出發地'}</div>
            <div className="terminal-text">{t.departure_terminal || ''}</div>
          </div>
          <div className="duration-col">
            <div className={`duration-text ${isCarMode||isPublic ? 'text-green' : 'text-blue'}`}>{t.duration_text || '--'}</div>
            <div className="arrow-graphic">────────➝</div>
            {(isCarMode||isPublic) && t.distance_text && <div className="sub-info">📏 {t.distance_text}</div>}
            {(isCarMode||isPublic) && t.buffer_time > 0 && <div className="sub-info text-red">+Buffer {t.buffer_time}m</div>}
            {item.cost > 0 && <div className="cost-text">${item.cost}</div>}
          </div>
          <div className="time-col">
             <div className="time-text">{formatDisplayTime(isArrivalCard ? item.start_time : item.end_time)}{!isArrivalCard && t.arrival_day_offset > 0 && <sup className="offset-text">+{t.arrival_day_offset}</sup>}</div>
            <div className="place-text">{t.arrival_location?.split(' ')[0] || '抵達地'}</div>
            <div className="terminal-text">{t.arrival_terminal || ''}</div>
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
      <div onClick={() => openEditItemModal(item)} className={`card accommodation-card ${isStay ? 'is-stay' : ''}`}>
        <div className="card-header header-orange">
          <span>🛏️ {isStay ? '續住：' : '入住：'} {item.name.replace('🏨 住宿: ', '')}</span>
          <span>{acc.agent || '住宿'}</span>
        </div>
        <div className="card-body">
            <div className="acc-info-row">
                <div>
                    <div className="acc-name">{item.location_name}</div>
                    <div className="acc-address">📍 {item.address}</div>
                    {acc.phone && <div className="acc-phone">📞 {acc.phone}</div>}
                </div>
                <div className="acc-cost-col">
                    {item.cost > 0 && <div className="acc-cost">{acc.currency} ${item.cost}</div>}
                    <div className="acc-status">{acc.is_paid ? <span className="tag tag-green">已付款</span> : <span className="tag tag-red">尚未付款</span>}</div>
                </div>
            </div>
            {!isStay && (
                <div className="acc-dates">
                    <div><span className="label-orange">📥 Check-in:</span> {acc.checkin_date} {formatDisplayTime(item.start_time)}</div>
                    <div><span className="label-orange">📤 Check-out:</span> {acc.checkout_date} {formatDisplayTime(item.end_time)}</div>
                </div>
            )}
            {item.notes && <div className="card-notes">📝 {item.notes}</div>}
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
      <li onClick={() => openEditItemModal(item)} className="card general-card">
        <div className="general-left">
          <div className="category-icon">{getCategoryIcon(item.category)}</div>
          <div>
            <div className="general-name">{item.name}</div>
            {item.address && <div className="general-sub">📍 {item.address}</div>}
            {item.phone && <div className="general-sub">📞 {item.phone}</div>}
            {todayHours && <div className="opening-hours-tag">🕒 {todayHours}</div>}
            {item.notes && <div className="general-sub">📝 {item.notes}</div>}
          </div>
        </div>
        <div className="general-right">
          <div className="time-display">{formatDisplayTime(item.start_time) || '--:--'}</div>
          <div className="duration-display">
            {duration && <span className="duration-tag">{duration}</span>}
            <span className="arrow-small">──➝</span>
          </div>
          <div className="time-display">{formatDisplayTime(item.end_time) || '--:--'}</div>
        </div>
      </li>
    )
  }

  // 🔥 4. NoteCard
  const NoteCard = ({ item }) => {
      return (
          <div onClick={() => openEditItemModal(item)} className="card note-card">
              <div className="note-title">📝 {item.name}</div>
              {item.notes && <div className="note-content">{item.notes}</div>}
              {item.attachment_url && (
                  <div className="note-attachment">
                      <a href={item.attachment_url} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()} className="attachment-link">
                          <span className="attach-icon">{item.attachment_type === 'image' ? '🖼️' : '📄'}</span> 
                          <span>{item.attachment_type === 'image' ? '圖片' : '文件'}</span>
                          <span className="attach-arrow">↗</span>
                      </a>
                  </div>
              )}
          </div>
      )
  }

  const currentDayItems = items.filter(item => item.trip_day_id === selectedDay?.id);

  return (
    <div className="container trip-details-page">
      {/* ✨ CSS 樣式定義：修正深色模式配色 */}
      <style>{`
        /* ================= 🎨 變數定義 (優化配色) ================= */
        :root {
            /* 淺色模式 (保持原樣) */
            --bg-body: #ffffff;
            --bg-sidebar: #ffffff;
            --bg-content: #ffffff;
            --bg-card: #ffffff;
            --bg-input: #ffffff;
            --text-main: #333333;
            --text-sub: #666666;
            --text-muted: #888888;
            --border-color: #e0e0e0;
            
            --primary: #007bff;
            --primary-bg: #e3f2fd; /* 淺藍色背景 */
            --primary-border: #007bff;
            
            --card-shadow: 0 2px 8px rgba(0,0,0,0.08);
            --header-bg-day: #f8f9fa;
            --input-border: #cccccc;
            
            /* 特殊變數：選中天數背景 */
            --bg-day-selected: #e3f2fd;
            --border-day-selected: #007bff;
            --text-day-selected: #007bff;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                /* 深色模式 (重新設計) */
                --bg-body: #121212;
                --bg-sidebar: #1e1e1e;
                --bg-content: #121212;
                --bg-card: #1e1e1e;
                --bg-input: #2a2a2a;
                --text-main: #e0e0e0;
                --text-sub: #aaaaaa;
                --text-muted: #777777;
                --border-color: #333333;
                
                --primary: #646cff; /* 稍微柔和的藍紫色 */
                --primary-bg: #1a3b5c;
                --primary-border: #646cff;
                
                --card-shadow: 0 4px 12px rgba(0,0,0,0.3);
                --header-bg-day: #1e1e1e;
                --input-border: #444444;

                /* 特殊變數：選中天數背景 (修正為半透明藍，而非亮白) */
                --bg-day-selected: rgba(56, 189, 248, 0.15); 
                --border-day-selected: #60a5fa;
                --text-day-selected: #60a5fa;
            }
        }

        /* ================= 📐 全局設定 ================= */
        .trip-details-page {
            color: var(--text-main);
            background-color: var(--bg-body);
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        
        a { color: var(--text-sub); text-decoration: none; }
        input { 
            background: var(--bg-input); 
            color: var(--text-main); 
            border: 1px solid var(--border-color); 
            font-size: 16px; 
        }

        /* ================= 📐 佈局 (Responsive) ================= */
        .layout-container { display: flex; gap: 20px; min-height: 600px; }
        .sidebar { 
            width: 220px; border-right: 1px solid var(--border-color); padding-right: 10px; 
            overflow-y: auto; max-height: 80vh; position: sticky; top: 20px; 
            background: var(--bg-sidebar);
        }
        .content-area { flex: 1; padding-left: 10px; }
        
        /* ⬇️ Day Item 樣式 */
        .day-item { 
            padding: 12px 10px; 
            cursor: pointer; 
            margin-bottom: 5px; 
            border-radius: 8px; 
            transition: all 0.2s; 
            border: 1px solid transparent; /* 預留邊框位置 */
        }
        
        /* ✨ 新增：選中狀態的樣式 */
        .day-item-active {
            background-color: var(--bg-day-selected) !important;
            border-color: var(--border-day-selected) !important;
        }
        .day-item-active .day-item-text-title {
            color: var(--text-day-selected) !important;
        }

        .day-item:hover { background-color: var(--border-color); }
        .day-item-text-title { font-weight: bold; color: var(--text-main); font-size: 1rem; }
        .day-item-text-date { font-size: 13px; color: var(--text-sub); margin-top: 2px; }

        /* Day Header */
        .day-header { 
            margin-bottom: 20px; 
            padding: 15px; 
            background: var(--header-bg-day); 
            border-radius: 10px; 
            border: 1px solid var(--border-color); 
        }
        .day-title-input { 
            font-size: 1.5rem; 
            padding: 8px 12px; 
            border-radius: 6px; 
            flex: 1; min-width: 0; 
            border: 1px solid var(--border-color); /* 明確邊框 */
        }
        .day-header-date { font-size: 14px; color: var(--text-sub); margin-bottom: 8px; font-weight: bold; }
        .day-header-h2 { margin: 0; white-space: nowrap; font-size: 1.5rem; color: var(--text-main); }

        .card-hover { cursor: pointer; transition: transform 0.1s; }
        .card-hover:active { transform: scale(0.98); }

        /* --- 手機版樣式 (Max-width: 768px) --- */
        @media (max-width: 768px) {
          .layout-container { flex-direction: column; }
          .sidebar { 
            width: 100%; 
            border-right: none; 
            border-bottom: 1px solid var(--border-color); 
            padding-right: 0; 
            padding-bottom: 2px; 
            display: flex; 
            overflow-x: auto; 
            white-space: nowrap;
            position: relative;
            top: 0;
            max-height: auto;
            background: var(--bg-body);
          }
          .content-area { padding-left: 0; margin-top: 10px; }
          
          .day-item { 
            flex: 0 0 auto;
            width: auto; 
            min-width: 60px; 
            text-align: center;
            margin-bottom: 0;
            margin-right: 5px; 
            padding: 4px 6px; 
          }
          .day-item-text-title { font-size: 12px; line-height: 1.2; }
          .day-item-text-date { font-size: 10px; margin-top: 1px; }

          .day-header { padding: 8px 10px; margin-bottom: 10px; }
          .day-header-date { font-size: 12px; margin-bottom: 4px; }
          .day-header-h2 { font-size: 1.1rem; }
          .day-title-input { font-size: 1rem; padding: 4px 8px; }
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
        <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-sub)', display:'inline-block', marginBottom:'10px' }}>← 返回列表</Link>
        <button onClick={() => setShowSettings(true)} style={{ padding: '8px 15px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius:'20px', cursor:'pointer', color: 'var(--text-main)' }}>⚙️ 旅行設定</button>
      </div>
      <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '10px' }}>
        <h1 style={{ margin: '0 0 5px 0', fontSize: 'clamp(1.5rem, 5vw, 2.5rem)' }}>{trip.title}</h1>
        <div style={{ color: 'var(--text-sub)', fontSize: '14px', display:'flex', flexWrap: 'wrap', gap: '15px' }}>
          <span>📅 {trip.start_date} ~ {trip.end_date}</span>
          <span>💰 預算: ${trip.budget_goal}</span>
          <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            👫 {trip.trip_members?.length} 人
          </span>
        </div>
      </div>

      <div className="layout-container">
        {/* 左側選單 */}
        <div className="sidebar">
          {days.map(day => (
            <div 
              key={day.id} 
              onClick={() => setSelectedDay(day)} 
              // ✨ 修正：使用 class 來控制樣式，不使用 inline style，以支援 dark mode 變數
              className={`day-item ${selectedDay?.id === day.id ? 'day-item-active' : ''}`}
            >
              <div className="day-item-text-title">Day {day.day_number} {day.title ? <span style={{marginLeft:'3px'}}>{day.title}</span> : ''}</div>
              <div className="day-item-text-date">{day.day_date} <span style={{color: '#ff9800'}}>({getWeekday(day.day_date)})</span></div>
            </div>
          ))}
        </div>

        {/* 右側詳細行程 */}
        <div className="content-area">
          {selectedDay && (
            <>
              {/* 每日重點 Header */}
              <div className="day-header">
                <div className="day-header-date">{selectedDay.day_date} <span style={{color: '#ff9800'}}>({getWeekday(selectedDay.day_date)})</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 className="day-header-h2">Day {selectedDay.day_number}</h2>
                  <input className="day-title-input" type="text" value={selectedDay.title || ''} onChange={handleTitleChange} onBlur={handleTitleUpdate} placeholder="重點 (例: 移動日)" />
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
              
              <button onClick={openNewItemModal} style={{ width: '100%', padding: '15px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '50px' }}><span>➕</span> 新增行程</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}