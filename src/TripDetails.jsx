import { useEffect, useState, Fragment } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import TripSettingsModal from './TripSettingsModal'
import EditItemModal from './EditItemModal'
import ShareModal from './ShareModal'
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
  const [showShareModal, setShowShareModal] = useState(false)
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
          <div className="general-content">
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
      {/* ✨ CSS 修正：通用型灰底風格 (Universal Gray Theme) */}
      <style>{`
        /* ================= 🎨 變數定義：灰底風格 ================= */
        :root {
            /* 基礎背景：使用舒適的淺灰色，類似 Trello/Notion 的 Dashboard 風格 */
            --bg-body: #F3F4F6; 
            
            /* 側邊欄：白色帶一點透明，與灰底區隔 */
            --bg-sidebar: rgba(255, 255, 255, 0.85);
            
            /* 內容區域標頭：純白 */
            --bg-content-header: #ffffff;
            
            /* 卡片背景：強制純白，確保對比度最高 */
            --bg-card: #ffffff; 
            
            /* 文字顏色：深灰至黑色，閱讀性最佳 */
            --text-main: #1F2937; /* 接近黑色 */
            --text-sub: #4B5563;  /* 深灰色 */
            --text-muted: #9CA3AF; /* 淺灰色 */
            
            /* 邊框線條 */
            --border-light: #E5E7EB;
            
            /* 主色調 */
            --primary: #2563EB; /* 鮮豔的藍色，在灰底上很清楚 */
            --primary-bg: #DBEAFE;
            
            /* 天數選單 */
            --day-item-bg: transparent;
            --day-item-bg-hover: #E5E7EB;
            --day-item-bg-active: #ffffff;
            
            /* 陰影：增加立體感 */
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            
            --glass-blur: blur(8px);
            --border-radius-lg: 16px;
            --border-radius-md: 12px;
        }

        /* 全頁設定：強制背景色，不使用圖片 */
        .trip-details-page {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: var(--text-main);
            background-color: var(--bg-body); /* ✨ 強制灰底 */
            min-height: 100vh;
            padding: 20px;
            box-sizing: border-box;
        }

        .layout-container { display: flex; gap: 24px; min-height: 600px; position: relative; }

        /* --- 側邊欄 (Left Sidebar) --- */
        .sidebar { 
            width: 240px; 
            padding: 16px;
            background: var(--bg-sidebar); 
            backdrop-filter: var(--glass-blur);
            border: 1px solid var(--border-light);
            border-radius: var(--border-radius-lg);
            box-shadow: var(--shadow-sm);
            
            overflow-y: auto; 
            max-height: 80vh; 
            position: sticky; 
            top: 20px; 
        }

        .day-item { 
            padding: 12px 16px; 
            cursor: pointer; 
            margin-bottom: 8px; 
            border-radius: var(--border-radius-md); 
            transition: all 0.2s ease; 
            background: var(--day-item-bg);
            color: var(--text-sub);
            border: 1px solid transparent;
        }
        
        .day-item:hover { 
            background: var(--day-item-bg-hover);
            color: var(--text-main);
        }

        /* 選中狀態：變成白色卡片，浮起來 */
        .day-item-active {
            background-color: var(--day-item-bg-active) !important;
            color: var(--primary) !important;
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--border-light);
            font-weight: bold;
        }
        
        .day-item-active .day-item-text-title { color: var(--primary); }
        .day-item-active .day-item-text-date { color: var(--text-sub); }

        .day-item-text-title { font-weight: 600; font-size: 1rem; }
        .day-item-text-date { font-size: 0.85rem; margin-top: 4px; opacity: 0.8; }

        /* --- 右側內容區 --- */
        .content-area { flex: 1; }
        
        .day-header { 
            margin-bottom: 24px; 
            padding: 24px; 
            background: var(--bg-content-header); 
            border-radius: var(--border-radius-lg); 
            border: 1px solid var(--border-light);
            box-shadow: var(--shadow-sm);
        }
        
        .day-header-date { font-size: 14px; color: var(--text-sub); margin-bottom: 8px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
        .day-header-h2 { margin: 0; white-space: nowrap; font-size: 2rem; color: var(--text-main); font-weight: 800; letter-spacing: -0.5px; }
        
        .day-title-input { 
            font-size: 1.25rem; 
            padding: 10px 16px; 
            border-radius: 8px; 
            flex: 1; 
            min-width: 0; 
            border: 2px solid var(--border-light); 
            background: #FAFAFA;
            color: var(--text-main);
            transition: border-color 0.2s;
        }
        .day-title-input:focus { outline: none; border-color: var(--primary); background: #ffffff; }

        /* 🔥 卡片通用樣式：純白底，深色字，確保任何螢幕都清楚 */
        .card {
            background-color: var(--bg-card) !important; 
            color: var(--text-main) !important;
            border-radius: var(--border-radius-md);
            box-shadow: var(--shadow-sm);
            margin-bottom: 16px;
            overflow: hidden;
            transition: transform 0.2s, box-shadow 0.2s;
            border: 1px solid var(--border-light);
            list-style: none;
        }
        .card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: #d1d5db; }

        /* Transport Card */
        .card-header { padding: 12px 20px; font-size: 0.95rem; font-weight: bold; display: flex; justify-content: space-between; color: white; }
        .header-blue { background: #3B82F6; } /* 純藍 */
        .header-green { background: #10B981; } /* 純綠 */
        .header-orange { background: #F59E0B; } /* 純橘 */
        
        .card-body { padding: 20px; }
        .transport-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .time-col { flex: 1; min-width: 80px; text-align: center; }
        .duration-col { flex: 1.5; text-align: center; display: flex; flex-direction: column; align-items: center; }
        .time-text { font-size: 1.25rem; font-weight: 800; color: var(--text-main); }
        .place-text { font-size: 0.95rem; color: var(--text-sub); margin-top: 4px; font-weight: 600; }
        .terminal-text { font-size: 0.8rem; color: var(--text-muted); background: #F3F4F6; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-top: 6px; }
        
        .arrow-graphic { color: #D1D5DB; font-size: 0.8rem; margin: 4px 0; }
        .duration-text { font-weight: bold; font-size: 0.9rem; color: var(--text-sub); }
        .text-blue { color: #2563EB; }
        .text-green { color: #059669; }
        .cost-text { margin-top: 5px; font-size: 0.85rem; font-weight: bold; color: #4B5563; background: #F3F4F6; padding: 4px 10px; border-radius: 20px; }

        /* General Layout */
        .general-card { display: flex; justify-content: space-between; align-items: center; padding: 20px; }
        .general-left { display: flex; align-items: flex-start; gap: 16px; flex: 1; }
        .category-icon { font-size: 1.8rem; background: #F3F4F6; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; border-radius: 50%; flex-shrink: 0; color: #4B5563; }
        .general-content { display: flex; flex-direction: column; gap: 4px; }
        .general-name { font-weight: 700; font-size: 1.1rem; color: var(--text-main); line-height: 1.4; }
        .general-sub { font-size: 0.9rem; color: var(--text-sub); display: flex; align-items: center; gap: 5px; }
        .opening-hours-tag { font-size: 0.8rem; background: #FEF3C7; color: #92400E; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-top: 4px; align-self: flex-start; }
        
        .general-right { text-align: right; min-width: 90px; padding-left: 10px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; }
        .time-display { font-weight: 800; color: var(--text-main); font-size: 1rem; }
        .duration-display { display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin: 4px 0; }
        .duration-tag { font-size: 0.75rem; background: #F3F4F6; padding: 2px 8px; border-radius: 4px; color: #6B7280; }
        .arrow-small { font-size: 0.7rem; color: #D1D5DB; }

        /* Simple Card */
        .simple-card { cursor: pointer; padding: 14px 20px; background: #ffffff; }
        .simple-card-content { display: flex; align-items: center; gap: 12px; font-size: 0.95rem; color: var(--text-sub); }
        .icon-text { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text-main); }
        
        /* Note Layout */
        .note-card { padding: 20px; border-left: 4px solid #F59E0B; background: #FFFBEB !important; }
        
        /* Header Buttons */
        .header-btn {
            padding: 8px 16px;
            background: #ffffff;
            border: 1px solid var(--border-light);
            border-radius: 20px;
            cursor: pointer;
            color: var(--text-main);
            font-weight: 600;
            box-shadow: var(--shadow-sm);
            transition: all 0.2s;
        }
        .header-btn:hover { background: #F9FAFB; border-color: #D1D5DB; }
        .header-btn-primary { background: var(--primary); color: white; border-color: var(--primary); }
        .header-btn-primary:hover { background: #1D4ED8; }

        /* RWD: Mobile */
        @media (max-width: 768px) {
          .trip-details-page { padding: 10px; }
          .layout-container { flex-direction: column; gap: 16px; }
          .sidebar { 
            width: 100%; 
            border-right: none; 
            border-bottom: 1px solid var(--border-light); 
            padding: 12px;
            display: flex; 
            overflow-x: auto; 
            white-space: nowrap;
            background: #ffffff;
          }
          .day-item { min-width: 80px; text-align: center; margin-right: 8px; margin-bottom: 0; padding: 8px 12px; }
          .day-item-active { border-left: none; border-bottom: 3px solid var(--primary); box-shadow: none; border-top: none; border-right: none; }
          .content-area { padding: 0; }
          .general-card { padding: 16px; }
          .general-name { font-size: 1rem; }
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

      {showShareModal && (
        <ShareModal 
            trip={trip} 
            onClose={() => setShowShareModal(false)} 
            onUpdate={() => queryClient.invalidateQueries(['tripDetails', tripId])} 
        />
      )}

      {/* Header Info */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '0 5px'}}>
        <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-sub)', display:'inline-flex', alignItems: 'center', marginBottom:'15px', fontWeight: 'bold' }}>← 返回列表</Link>
        <div style={{display:'flex', gap:'10px'}}>
            <button 
                onClick={() => setShowShareModal(true)} 
                className="header-btn"
            >
                🔗 分享
            </button>
            <button onClick={() => setShowSettings(true)} className="header-btn">⚙️ 設定</button>
        </div>
      </div>
      
      <div style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '20px', marginBottom: '24px', paddingLeft: '5px' }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: 'clamp(1.8rem, 5vw, 2.5rem)', color: 'var(--text-main)', fontWeight: '800' }}>{trip.title}</h1>
        <div style={{ color: 'var(--text-sub)', fontSize: '15px', display:'flex', flexWrap: 'wrap', gap: '24px', fontWeight: '500' }}>
          <span style={{display:'flex', alignItems:'center', gap:'6px'}}>📅 {trip.start_date} ~ {trip.end_date}</span>
          <span style={{display:'flex', alignItems:'center', gap:'6px'}}>💰 預算: ${trip.budget_goal}</span>
          <span style={{ display: 'inline-flex', alignItems:'center', gap:'6px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
              className={`day-item ${selectedDay?.id === day.id ? 'day-item-active' : ''}`}
            >
              <div className="day-item-text-title">Day {day.day_number} {day.title ? <span style={{fontSize:'0.9em', opacity: 0.8}}>{day.title}</span> : ''}</div>
              <div className="day-item-text-date">{day.day_date} ({getWeekday(day.day_date)})</div>
            </div>
          ))}
        </div>

        {/* 右側詳細行程 */}
        <div className="content-area">
          {selectedDay && (
            <>
              <div className="day-header">
                <div className="day-header-date">{selectedDay.day_date} <span style={{color: 'var(--primary)'}}>({getWeekday(selectedDay.day_date)})</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <h2 className="day-header-h2">Day {selectedDay.day_number}</h2>
                  <input className="day-title-input" type="text" value={selectedDay.title || ''} onChange={handleTitleChange} onBlur={handleTitleUpdate} placeholder="輸入當日重點 (例: 移動日)" />
                </div>
              </div>
               
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={currentDayItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
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
               
              <button onClick={openNewItemModal} style={{ width: '100%', padding: '16px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '50px', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)', transition: 'transform 0.2s' }} onMouseOver={(e)=>e.currentTarget.style.transform='scale(1.01)'} onMouseOut={(e)=>e.currentTarget.style.transform='scale(1)'}>
                <span>➕</span> 新增行程
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}