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
      {/* ✨ CSS 優化：增強對比度、毛玻璃質感與卡片清晰度 */}
      <style>{`
        /* ================= 🎨 變數定義 (優化版) ================= */
        :root {
            /* 預設使用 Glass 效果 */
            --glass-blur: blur(16px);
            --border-radius-lg: 16px;
            --border-radius-md: 12px;
            
            /* 顏色變數：針對深色背景圖優化 */
            /* 側邊欄背景：稍微透明的白色，增加對比 */
            --bg-sidebar: rgba(255, 255, 255, 0.25);
            
            /* 內容卡片背景 */
            --bg-content-header: rgba(255, 255, 255, 0.6);
            --bg-card: rgba(255, 255, 255, 0.85);
            
            /* 文字顏色 */
            --text-main: #2c3e50;
            --text-sub: #546e7a;
            --text-muted: #7f8c8d;
            
            --border-light: rgba(255, 255, 255, 0.4);
            --border-focus: #007bff;
            
            --primary: #007bff;
            --primary-hover: #0056b3;
            
            /* 天數列表項目樣式 */
            --day-item-bg: rgba(255, 255, 255, 0.4);
            --day-item-bg-hover: rgba(255, 255, 255, 0.6);
            --day-item-bg-active: #ffffff;
            --day-item-shadow-active: 0 8px 20px rgba(0,0,0,0.15);
            --day-item-text-active: #007bff;
            
            --shadow-card: 0 4px 6px rgba(0, 0, 0, 0.05);
        }

        /* 頁面基本布局 */
        .trip-details-page {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: var(--text-main);
            padding-bottom: 50px;
        }

        .layout-container { display: flex; gap: 24px; min-height: 600px; position: relative; }

        /* --- 側邊欄 (Left Sidebar) --- */
        .sidebar { 
            width: 240px; 
            padding: 15px;
            /* 毛玻璃容器 */
            background: var(--bg-sidebar); 
            backdrop-filter: var(--glass-blur);
            border: 1px solid var(--border-light);
            border-radius: var(--border-radius-lg);
            
            overflow-y: auto; 
            max-height: 80vh; 
            position: sticky; 
            top: 20px; 
            box-shadow: 0 4px 15px rgba(0,0,0,0.05);
            
            /* 隱藏捲軸但可捲動 */
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.5) transparent;
        }

        .day-item { 
            padding: 14px 16px; 
            cursor: pointer; 
            margin-bottom: 10px; 
            border-radius: var(--border-radius-md); 
            transition: all 0.25s ease; 
            
            /* 預設狀態：半透明白，確保文字可讀 */
            background: var(--day-item-bg);
            border: 1px solid transparent;
            color: var(--text-main);
        }
        
        .day-item:hover { 
            background: var(--day-item-bg-hover);
            transform: translateY(-1px);
        }

        /* ✨ 關鍵修改：選中狀態更加立體明顯 */
        .day-item-active {
            background-color: var(--day-item-bg-active) !important;
            color: var(--day-item-text-active) !important;
            box-shadow: var(--day-item-shadow-active);
            border-left: 5px solid var(--primary); /* 左側藍色指示條 */
        }
        
        .day-item-active .day-item-text-title {
            color: var(--primary);
            font-weight: 800;
        }
        
        .day-item-active .day-item-text-date {
             color: var(--text-sub);
        }

        .day-item-text-title { font-weight: 600; font-size: 1.05rem; display: flex; justify-content: space-between; }
        .day-item-text-date { font-size: 0.85rem; color: var(--text-sub); margin-top: 4px; opacity: 0.9; }

        /* --- 右側內容區 (Content Area) --- */
        .content-area { flex: 1; }
        
        /* 每日標題 Header */
        .day-header { 
            margin-bottom: 24px; 
            padding: 20px 24px; 
            background: var(--bg-content-header); 
            backdrop-filter: var(--glass-blur); 
            border-radius: var(--border-radius-lg); 
            border: 1px solid var(--border-light);
            box-shadow: 0 4px 15px rgba(0,0,0,0.05);
        }
        
        .day-header-date { font-size: 14px; color: var(--text-sub); margin-bottom: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .day-header-h2 { margin: 0; white-space: nowrap; font-size: 1.8rem; color: var(--text-main); font-weight: 800; letter-spacing: -0.5px; }
        
        /* 標題輸入框優化 */
        .day-title-input { 
            font-size: 1.2rem; 
            padding: 8px 12px; 
            border-radius: 8px; 
            flex: 1; 
            min-width: 0; 
            border: 1px solid rgba(0,0,0,0.1); 
            background: rgba(255,255,255,0.5);
            color: var(--text-main);
            transition: all 0.2s;
        }
        .day-title-input:focus {
            outline: none;
            background: #fff;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.2);
        }

        /* 卡片通用樣式優化 */
        .card {
            background: var(--bg-card);
            border-radius: var(--border-radius-md);
            box-shadow: var(--shadow-card);
            margin-bottom: 16px;
            overflow: hidden;
            transition: transform 0.2s, box-shadow 0.2s;
            border: 1px solid rgba(255,255,255,0.5);
            list-style: none; /* remove li dots */
        }
        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 15px rgba(0,0,0,0.08);
        }

        /* Transport Card specific */
        .card-header { padding: 10px 15px; font-size: 0.9rem; font-weight: bold; display: flex; justify-content: space-between; color: white; }
        .header-blue { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
        .header-green { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: #1f5f45; }
        .header-orange { background: linear-gradient(135deg, #f6d365 0%, #fda085 100%); color: #5d4037; }
        
        .card-body { padding: 15px; }
        
        /* Transport Layout */
        .transport-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .time-col { flex: 1; min-width: 80px; text-align: center; }
        .duration-col { flex: 1.5; text-align: center; display: flex; flex-direction: column; align-items: center; }
        
        .time-text { font-size: 1.2rem; font-weight: bold; color: var(--text-main); position: relative; }
        .offset-text { font-size: 0.7rem; color: #e74c3c; font-weight: bold; position: absolute; top: -5px; right: -10px; }
        .place-text { font-size: 0.9rem; color: var(--text-sub); margin-top: 4px; font-weight: 500; }
        .terminal-text { font-size: 0.8rem; color: var(--text-muted); background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; }
        
        .arrow-graphic { color: #ccc; font-size: 0.8rem; margin: 2px 0; letter-spacing: -1px; }
        .duration-text { font-weight: bold; font-size: 0.9rem; }
        .text-blue { color: #007bff; }
        .text-green { color: #28a745; }
        .sub-info { font-size: 0.75rem; color: var(--text-muted); }
        .text-red { color: #dc3545; }
        .cost-text { margin-top: 5px; font-size: 0.85rem; font-weight: bold; color: #555; background: #eee; padding: 2px 8px; border-radius: 10px; }

        /* Accommodation Layout */
        .acc-info-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
        .acc-name { font-size: 1.1rem; font-weight: bold; color: var(--text-main); }
        .acc-address { font-size: 0.85rem; color: var(--text-sub); margin-top: 3px; }
        .acc-phone { font-size: 0.85rem; color: var(--text-muted); }
        .acc-dates { background: rgba(255,255,255,0.5); padding: 8px; border-radius: 6px; font-size: 0.9rem; display: flex; flex-direction: column; gap: 4px; border: 1px dashed #ddd; }
        .label-orange { color: #e67e22; font-weight: bold; }
        .acc-cost-col { text-align: right; }
        .tag { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; color: white; margin-left: 5px; }
        .tag-green { background: #28a745; }
        .tag-red { background: #dc3545; }
        
        /* General Layout */
        .general-card { display: flex; justify-content: space-between; align-items: center; padding: 15px; }
        .general-left { display: flex; align-items: flex-start; gap: 12px; }
        .category-icon { font-size: 1.5rem; background: #f0f2f5; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
        .general-name { font-weight: bold; font-size: 1rem; color: var(--text-main); }
        .general-sub { font-size: 0.85rem; color: var(--text-sub); margin-top: 2px; }
        .opening-hours-tag { font-size: 0.75rem; background: #fff3cd; color: #856404; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; }
        
        .general-right { text-align: right; min-width: 80px; }
        .time-display { font-weight: bold; color: var(--text-main); font-size: 0.95rem; }
        .duration-display { display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin: 2px 0; }
        .duration-tag { font-size: 0.7rem; background: #e2e6ea; padding: 1px 5px; border-radius: 4px; color: #555; }
        .arrow-small { font-size: 0.7rem; color: #ccc; }

        /* Note Layout */
        .note-card { padding: 15px; border-left: 4px solid #ffc107; }
        .note-title { font-weight: bold; color: var(--text-main); margin-bottom: 5px; }
        .note-content { font-size: 0.9rem; color: var(--text-sub); white-space: pre-wrap; }
        .note-attachment { margin-top: 8px; }
        .attachment-link { display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #ddd; padding: 6px 10px; border-radius: 20px; text-decoration: none; color: #555; font-size: 0.85rem; transition: background 0.2s; }
        .attachment-link:hover { background: #f8f9fa; border-color: #ccc; }
        .attach-arrow { font-size: 0.7rem; color: #999; }

        /* Simple Card */
        .simple-card { cursor: pointer; padding: 12px 15px; background: rgba(255,255,255,0.7); }
        .simple-card-content { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; color: var(--text-sub); }
        .separator { color: #ccc; }
        .icon-text { display: flex; align-items: center; gap: 5px; font-weight: 500; }
        .location-flow { display: flex; align-items: center; gap: 5px; }
        .arrow { color: #999; font-size: 0.8rem; }

        /* RWD: Mobile (Max 768px) */
        @media (max-width: 768px) {
          .layout-container { flex-direction: column; gap: 10px; }
          
          /* Mobile Sidebar: Horizontal Scroll */
          .sidebar { 
            width: 100%; 
            border-right: none; 
            border-bottom: 1px solid var(--border-light); 
            padding: 10px;
            display: flex; 
            overflow-x: auto; 
            white-space: nowrap;
            position: relative;
            top: 0;
            background: var(--bg-sidebar);
            box-shadow: none;
            -webkit-overflow-scrolling: touch; /* smooth scroll ios */
          }
          
          .day-item { 
            flex: 0 0 auto;
            width: auto; 
            min-width: 80px; 
            text-align: center;
            margin-bottom: 0;
            margin-right: 8px; 
            padding: 8px 12px;
            display: block; /* reset flex */
          }
          
          .day-item-active {
              border-left: none;
              border-bottom: 3px solid var(--primary);
              transform: scale(1.02);
          }
          
          .day-item-text-title { font-size: 0.9rem; display: block; text-align: center; }
          .day-item-text-date { font-size: 0.75rem; margin-top: 2px; text-align: center; }

          .content-area { padding: 0 5px; }
          .day-header { padding: 15px; margin-bottom: 15px; }
          .day-header-h2 { font-size: 1.4rem; }
          .day-title-input { font-size: 1rem; padding: 6px; }
          
          /* Card adjustments for mobile */
          .transport-body { flex-direction: column; align-items: stretch; gap: 15px; }
          .duration-col { flex-direction: row; justify-content: center; gap: 10px; padding: 5px 0; border-top: 1px dashed #eee; border-bottom: 1px dashed #eee; }
          .arrow-graphic { display: none; }
          .time-col { display: flex; justify-content: space-between; align-items: center; text-align: left; }
          .place-text { margin-top: 0; }
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

      {/* ✨ 3. 加入 ShareModal (當 showShareModal 為 true 時顯示) */}
      {showShareModal && (
        <ShareModal 
            trip={trip} 
            onClose={() => setShowShareModal(false)} 
            onUpdate={() => queryClient.invalidateQueries(['tripDetails', tripId])} 
        />
      )}

      {/* Header Info */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '0 5px'}}>
        <Link to="/" style={{ textDecoration: 'none', color: '#fff', display:'inline-flex', alignItems: 'center', marginBottom:'15px', fontWeight: 'bold', textShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>← 返回列表</Link>
        <div style={{display:'flex', gap:'10px'}}>
            {/* ✨ 4. 新增分享按鈕 */}
            <button 
                onClick={() => setShowShareModal(true)} 
                style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', borderRadius:'20px', cursor:'pointer', color: '#fff', backdropFilter: 'var(--glass-blur)', fontWeight: '500', transition: 'background 0.2s' }}
                onMouseOver={(e) => e.target.style.background = 'rgba(255,255,255,0.3)'}
                onMouseOut={(e) => e.target.style.background = 'rgba(255,255,255,0.2)'}
            >
                🔗 分享
            </button>
            <button onClick={() => setShowSettings(true)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', borderRadius:'20px', cursor:'pointer', color: '#fff', backdropFilter: 'var(--glass-blur)', fontWeight: '500' }}>⚙️ 設定</button>
        </div>
      </div>
      
      {/* 標題區域，增加文字陰影以適應深色背景 */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '15px', marginBottom: '20px', paddingLeft: '5px' }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: 'clamp(1.8rem, 5vw, 2.5rem)', color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.4)' }}>{trip.title}</h1>
        <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: '15px', display:'flex', flexWrap: 'wrap', gap: '20px', fontWeight: '500' }}>
          <span style={{display:'flex', alignItems:'center', gap:'5px'}}>📅 {trip.start_date} ~ {trip.end_date}</span>
          <span style={{display:'flex', alignItems:'center', gap:'5px'}}>💰 預算: ${trip.budget_goal}</span>
          <span style={{ display: 'inline-flex', alignItems:'center', gap:'5px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
              {/* 每日重點 Header */}
              <div className="day-header">
                <div className="day-header-date">{selectedDay.day_date} <span style={{color: 'var(--primary)'}}>({getWeekday(selectedDay.day_date)})</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
               
              <button onClick={openNewItemModal} style={{ width: '100%', padding: '16px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '50px', boxShadow: '0 4px 12px rgba(0,123,255,0.3)', transition: 'transform 0.2s' }} onMouseOver={(e)=>e.currentTarget.style.transform='scale(1.01)'} onMouseOut={(e)=>e.currentTarget.style.transform='scale(1)'}>
                <span>➕</span> 新增行程
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}