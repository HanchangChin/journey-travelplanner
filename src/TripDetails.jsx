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
    // ✨ 新增：最外層容器設定為相對定位，以便容納絕對定位的背景
    <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden' }}>
      {/* ✨ 新增：流動幾何背景層 (固定在最底層) */}
      <div className="animated-background">
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
        <div className="noise-overlay"></div>
      </div>

      <div className="container trip-details-page" style={{ position: 'relative', zIndex: 1 }}>
        {/* ✨ CSS 樣式定義：加入背景動畫與毛玻璃效果 */}
        <style>{`
          /* ================= 🎨 變數定義 (加入透明度與模糊感) ================= */
          :root {
              /* 淺色模式 */
              /* ✨ 將背景改為帶透明度的白色，以透出後方動畫 */
              --bg-body: rgba(255, 255, 255, 0.7); 
              --bg-sidebar: rgba(255, 255, 255, 0.6);
              --bg-content: rgba(255, 255, 255, 0.6);
              --bg-card: rgba(255, 255, 255, 0.85);
              --bg-input: rgba(255, 255, 255, 0.9);
              --glass-blur: blur(12px); /* 毛玻璃模糊度 */
              
              --text-main: #333333;
              --text-sub: #666666;
              --text-muted: #888888;
              --border-color: rgba(224, 224, 224, 0.5); /* 邊框也透明一點 */
              
              --primary: #007bff;
              --primary-bg: rgba(0, 123, 255, 0.15);
              --primary-border: #007bff;
              
              --card-shadow: 0 4px 15px rgba(0,0,0,0.05); /* 更柔和的陰影 */
              --header-bg-day: rgba(248, 249, 250, 0.7);
              
              --bg-day-selected: rgba(0, 123, 255, 0.2);
              --border-day-selected: #007bff;
              --text-day-selected: #0056b3;

              /* 背景動畫顏色 (淺色系) */
              --bg-shape-1: radial-gradient(circle at center, rgba(100, 220, 255, 0.4) 0%, rgba(255,255,255,0) 70%);
              --bg-shape-2: radial-gradient(circle at center, rgba(200, 150, 255, 0.4) 0%, rgba(255,255,255,0) 70%);
              --bg-shape-3: radial-gradient(circle at center, rgba(100, 255, 200, 0.3) 0%, rgba(255,255,255,0) 70%);
              --bg-base: #f0f8ff; /* 淺色底色 */
          }

          @media (prefers-color-scheme: dark) {
              :root {
                  /* 深色模式 */
                  /* ✨ 將背景改為帶透明度的深色 */
                  --bg-body: rgba(18, 18, 18, 0.7);
                  --bg-sidebar: rgba(30, 30, 30, 0.6);
                  --bg-content: rgba(18, 18, 18, 0.6);
                  --bg-card: rgba(45, 45, 45, 0.85);
                  --bg-input: rgba(42, 42, 42, 0.9);
                  --glass-blur: blur(12px);
                  
                  --text-main: #e0e0e0;
                  --text-sub: #aaaaaa;
                  --text-muted: #777777;
                  --border-color: rgba(51, 51, 51, 0.5);
                  
                  --primary: #646cff;
                  --primary-bg: rgba(26, 59, 92, 0.4);
                  --primary-border: #646cff;
                  
                  --card-shadow: 0 4px 15px rgba(0,0,0,0.2);
                  --header-bg-day: rgba(30, 30, 30, 0.7);

                  --bg-day-selected: rgba(100, 108, 255, 0.25);
                  --border-day-selected: #808aff;
                  --text-day-selected: #ffffff;

                  /* 背景動畫顏色 (深色系 - 深邃宇宙感) */
                  --bg-shape-1: radial-gradient(circle at center, rgba(40, 100, 200, 0.3) 0%, rgba(18,18,18,0) 70%);
                  --bg-shape-2: radial-gradient(circle at center, rgba(120, 50, 200, 0.3) 0%, rgba(18,18,18,0) 70%);
                  --bg-shape-3: radial-gradient(circle at center, rgba(20, 150, 150, 0.2) 0%, rgba(18,18,18,0) 70%);
                  --bg-base: #0a0a12; /* 深色底色 */
              }
          }

          /* ================= 🌊 背景動畫設定 ================= */
          .animated-background {
              position: fixed;
              top: 0; left: 0; width: 100vw; height: 100vh;
              z-index: -1; /* 確保在最底層 */
              background-color: var(--bg-base);
              overflow: hidden;
          }
          
          /* 噪點質感層 */
          .noise-overlay {
              position: absolute;
              top: 0; left: 0; width: 100%; height: 100%;
              /* 使用一個細微的噪點圖片 base64，增加紙張/磨砂質感 */
              background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='4' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.05'/%3E%3C/svg%3E");
              pointer-events: none;
          }

          /* 幾何形狀 (光暈) */
          .shape {
              position: absolute;
              border-radius: 50%;
              filter: blur(60px); /* 強烈模糊製造光暈感 */
              animation-timing-function: ease-in-out;
              animation-iteration-count: infinite;
              animation-direction: alternate;
              opacity: 0.7;
          }
          .shape-1 {
              width: 70vmax; height: 70vmax;
              top: -20%; left: -20%;
              background: var(--bg-shape-1);
              animation-name: move1;
              animation-duration: 25s;
          }
          .shape-2 {
              width: 60vmax; height: 60vmax;
              bottom: -10%; right: -10%;
              background: var(--bg-shape-2);
              animation-name: move2;
              animation-duration: 30s;
          }
          .shape-3 {
              width: 50vmax; height: 50vmax;
              bottom: 20%; left: 20%;
              background: var(--bg-shape-3);
              animation-name: move3;
              animation-duration: 28s;
          }

          @keyframes move1 { from { transform: translate(0, 0) rotate(0deg) scale(1); } to { transform: translate(10%, 15%) rotate(20deg) scale(1.1); } }
          @keyframes move2 { from { transform: translate(0, 0) rotate(0deg) scale(1); } to { transform: translate(-15%, -10%) rotate(-15deg) scale(1.2); } }
          @keyframes move3 { from { transform: translate(0, 0) rotate(0deg) scale(1); } to { transform: translate(5%, -20%) rotate(10deg) scale(0.9); } }

          /* ================= 📐 頁面容器調整 (加入毛玻璃) ================= */
          .trip-details-page {
              color: var(--text-main);
              /* 背景色改為透明，以便顯示後方動畫 */
              background-color: transparent; 
              min-height: 100vh;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          
          a { color: var(--text-sub); text-decoration: none; }
          input { 
              background: var(--bg-input); 
              color: var(--text-main); 
              border: 1px solid var(--border-color); 
              font-size: 16px;
              /* 輸入框也要有一點毛玻璃 */
              backdrop-filter: var(--glass-blur);
          }

          /* ================= 📐 佈局 (Responsive) ================= */
          .layout-container { display: flex; gap: 20px; min-height: 600px; }
          .sidebar { 
              width: 220px; border-right: 1px solid var(--border-color); padding-right: 10px; 
              overflow-y: auto; max-height: 80vh; position: sticky; top: 20px; 
              /* ✨ 側邊欄毛玻璃效果 */
              background: var(--bg-sidebar);
              backdrop-filter: var(--glass-blur);
              border-radius: 12px; /* 加一點圓角讓毛玻璃更明顯 */
              margin-bottom: 20px;
              padding: 10px;
          }
          .content-area { flex: 1; } /* 移除 padding-left，讓卡片更貼邊 */
          
          /* Day Item 樣式 */
          .day-item { 
              padding: 12px 10px; 
              cursor: pointer; 
              margin-bottom: 5px; 
              border-radius: 8px; 
              transition: all 0.2s; 
              border: 1px solid transparent;
          }
          
          .day-item-active {
              background-color: var(--bg-day-selected) !important;
              border-color: var(--border-day-selected) !important;
          }
          .day-item-active .day-item-text-title { color: var(--text-day-selected) !important; }
          .day-item:hover { background-color: var(--border-color); }
          .day-item-text-title { font-weight: bold; color: var(--text-main); font-size: 1rem; }
          .day-item-text-date { font-size: 13px; color: var(--text-sub); margin-top: 2px; }

          /* Day Header (毛玻璃) */
          .day-header { 
              margin-bottom: 20px; 
              padding: 15px; 
              background: var(--header-bg-day); 
              /* ✨ Header 毛玻璃 */
              backdrop-filter: var(--glass-blur);
              border-radius: 10px; 
              border: 1px solid var(--border-color); 
          }
          .day-title-input { 
              font-size: 1.5rem; padding: 8px 12px; border-radius: 6px; flex: 1; min-width: 0; 
              border: 1px solid var(--border-color);
              background: var(--bg-input); /* 確保輸入框有背景 */
          }
          .day-header-date { font-size: 14px; color: var(--text-sub); margin-bottom: 8px; font-weight: bold; }
          .day-header-h2 { margin: 0; white-space: nowrap; font-size: 1.5rem; color: var(--text-main); }

          /* ✨ 卡片毛玻璃效果優化 */
          .card {
              border-radius: 12px; margin-bottom: 12px; cursor: pointer; overflow: hidden;
              background: var(--bg-card); /* 使用半透明背景 */
              backdrop-filter: var(--glass-blur); /* 加入毛玻璃 */
              box-shadow: var(--card-shadow); 
              border: 1px solid var(--border-color);
              transition: transform 0.1s, box-shadow 0.2s;
          }
          .card:hover {
              box-shadow: 0 8px 20px rgba(0,0,0,0.1); /* hover 時加深陰影 */
          }
          .card-hover { cursor: pointer; transition: transform 0.1s; }
          .card-hover:active { transform: scale(0.98); }

          /* --- 手機版樣式 (Max-width: 768px) --- */
          @media (max-width: 768px) {
            .layout-container { flex-direction: column; }
            .sidebar { 
              width: 100%; 
              border-right: none; 
              border-bottom: 1px solid var(--border-color); 
              padding: 5px; /* 調整手機版 padding */
              margin-bottom: 15px;
              display: flex; 
              overflow-x: auto; 
              white-space: nowrap;
              position: relative; top: 0; max-height: auto;
              background: var(--bg-sidebar);
              backdrop-filter: var(--glass-blur);
            }
            .content-area { padding-left: 0; margin-top: 0; }
            
            .day-item { 
              flex: 0 0 auto; width: auto; min-width: 60px; 
              text-align: center; margin-bottom: 0; margin-right: 5px; padding: 4px 6px; 
            }
            .day-item-text-title { font-size: 12px; line-height: 1.2; }
            .day-item-text-date { font-size: 10px; margin-top: 1px; }

            .day-header { padding: 8px 10px; margin-bottom: 10px; }
            .day-header-date { font-size: 12px; margin-bottom: 4px; }
            .day-header-h2 { font-size: 1.1rem; }
            .day-title-input { font-size: 1rem; padding: 4px 8px; }
            
            /* 手機版標題列也要毛玻璃 */
            .header-container {
                 background: var(--bg-card);
                 backdrop-filter: var(--glass-blur);
                 padding: 15px;
                 border-radius: 12px;
                 margin-bottom: 20px;
                 border: 1px solid var(--border-color);
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

        {/* Header Info - 包裹一個容器以應用毛玻璃 */}
        <div className="header-container" style={{ marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-sub)', display:'inline-block', marginBottom:'10px' }}>← 返回列表</Link>
            <button onClick={() => setShowSettings(true)} style={{ padding: '8px 15px', background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius:'20px', cursor:'pointer', color: 'var(--text-main)', backdropFilter: 'var(--glass-blur)' }}>⚙️ 旅行設定</button>
            </div>
            <div>
            <h1 style={{ margin: '0 0 5px 0', fontSize: 'clamp(1.5rem, 5vw, 2.5rem)' }}>{trip.title}</h1>
            <div style={{ color: 'var(--text-sub)', fontSize: '14px', display:'flex', flexWrap: 'wrap', gap: '15px' }}>
                <span>📅 {trip.start_date} ~ {trip.end_date}</span>
                <span>💰 預算: ${trip.budget_goal}</span>
                <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                👫 {trip.trip_members?.length} 人
                </span>
            </div>
            </div>
        </div>

        <div className="layout-container">
          {/* 左側選單 */}
          <div className="sidebar">
            {days.map(day => (
              <div 
                key={day.id} 
                onClick={() => setSelectedDay(day)} 
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
                
                <button onClick={openNewItemModal} style={{ width: '100%', padding: '15px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '50px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}><span>➕</span> 新增行程</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}