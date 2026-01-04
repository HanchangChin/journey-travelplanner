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

  // ✨ 控制地圖選擇視窗的狀態
  const [mapSelectorAddress, setMapSelectorAddress] = useState(null)

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

  // --- Map Selector Modal Component ---
  const MapSelectorModal = ({ address, onClose }) => {
    if (!address) return null;
    
    const encodedAddress = encodeURIComponent(address);
    const mapLinks = [
        { name: 'Google Maps', url: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, color: '#4285F4' },
        { name: 'Apple Maps', url: `http://maps.apple.com/?q=${encodedAddress}`, color: '#000000' },
        { name: 'Naver Map', url: `https://map.naver.com/v5/search/${encodedAddress}`, color: '#2DB400' },
    ];

    return (
        <div className="map-modal-overlay" onClick={onClose}>
            <div className="map-modal-content" onClick={e => e.stopPropagation()}>
                <h3 style={{margin: '0 0 15px 0', textAlign: 'center'}}>選擇地圖開啟</h3>
                <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                    {mapLinks.map(link => (
                        <a 
                            key={link.name} 
                            href={link.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="map-link-btn"
                            style={{ '--btn-color': link.color }}
                            onClick={onClose}
                        >
                            {link.name} ↗
                        </a>
                    ))}
                </div>
                <button onClick={onClose} className="map-cancel-btn">取消</button>
            </div>
        </div>
    );
  };

  // --- Card Components ---

  // 🔥 1. TransportCard
  const TransportCard = ({ item }) => {
    const t = item.transport_details || {};
    const travelers = t.travelers || [];
    const isArrivalCard = t.is_arrival_card;
    const isCarMode = t.sub_type === 'car_bus';
    const isPublic = t.sub_type === 'public'; 
    const isSimpleView = isPublic && (!item.start_time || !item.end_time);

    // 格式化地點顯示
    const formatLocation = (locName, terminal) => {
        if (!locName) return '未設定地點';
        return terminal ? `${locName} (${terminal})` : locName;
    };

    if (isSimpleView) {
      return (
        <div onClick={() => openEditItemModal(item)} className="card simple-card">
          <div className="simple-card-content">
            <span className="icon-text"><span className="icon">🚌</span><span>{t.duration_text || '移動'}</span></span>
            <span className="separator">|</span>
            <span className="location-flow"><span>{item.location_name || '起點'}</span><span className="arrow">➤</span><span>{t.arrival_location || '終點'}</span></span>
          </div>
        </div>
      )
    }

    return (
      <div onClick={() => openEditItemModal(item)} className="card transport-card">
        {/* Header */}
        <div className={`card-header ${isCarMode || isPublic ? 'header-green' : 'header-blue'}`}>
          <span>{isPublic ? '🚌' : (isCarMode ? '🚗' : '✈️')} {t.company || '交通'} {t.vehicle_number}</span>
          <span>{travelers.length === 1 ? ((isCarMode||isPublic) ? '' : `PNR: ${travelers[0].booking_ref}`) : `👥 ${travelers.length} 人`}</span>
        </div>

        <div className="card-body transport-body-new">
          {/* 上層：時間與耗時資訊 */}
          <div className="transport-time-row">
             <div className="time-big">{formatDisplayTime(isArrivalCard ? t.original_start_time : item.start_time)}{isArrivalCard && <sup className="offset-text">-1</sup>}</div>
             
             <div className="duration-badge">
                <span className="duration-icon">{isCarMode ? '🚗' : (isPublic ? '🚌' : '✈️')}</span>
                <span className="duration-val">{t.duration_text || '--'}</span>
             </div>
             
             <div className="time-big">{formatDisplayTime(isArrivalCard ? item.start_time : item.end_time)}{!isArrivalCard && t.arrival_day_offset > 0 && <sup className="offset-text">+{t.arrival_day_offset}</sup>}</div>
          </div>

          {/* 輔助資訊：距離與 Buffer */}
          {(t.distance_text || t.buffer_time > 0) && (
              <div className="transport-meta-row">
                 {t.distance_text && <span>📏 {t.distance_text}</span>}
                 {t.buffer_time > 0 && <span className="text-red"> (+Buffer {t.buffer_time}m)</span>}
              </div>
          )}

          {/* 下層：起迄點列表 (Timeline Style) */}
          <div className="transport-loc-list">
              {/* 起點 */}
              <div className="loc-item">
                  <div className="timeline-col">
                      <div className="dot dot-start"></div>
                      <div className="line"></div>
                  </div>
                  <div className="loc-content">
                      <div className="loc-label">Departs</div>
                      <div className="loc-name">{formatLocation(item.location_name, t.departure_terminal)}</div>
                  </div>
              </div>
              
              {/* 終點 */}
              <div className="loc-item">
                  <div className="timeline-col">
                      <div className="line-top"></div>
                      <div className="dot dot-end"></div>
                  </div>
                  <div className="loc-content">
                      <div className="loc-label">Arrives</div>
                      <div className="loc-name">{formatLocation(t.arrival_location, t.arrival_terminal)}</div>
                  </div>
              </div>
          </div>

          {/* 顯示備註 */}
          {item.notes && (
            <div className="transport-notes">
               <span className="note-icon">📝</span>
               <span className="note-text">{item.notes}</span>
            </div>
          )}

          {/* 價格顯示在右下角 */}
          {item.cost > 0 && <div className="transport-cost-tag">${item.cost}</div>}
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
                    {/* ✨ 已移除電話顯示 */}
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

    const displayStart = item.start_time ? formatDisplayTime(item.start_time) : '';
    const displayEnd = item.end_time ? formatDisplayTime(item.end_time) : '';

    return (
      <li onClick={() => openEditItemModal(item)} className="card general-card">
        <div className="general-left">
          <div className="category-icon">{getCategoryIcon(item.category)}</div>
          <div className="general-content">
            <div className="general-name">{item.name}</div>
            
            {item.address && (
                <div 
                    className="general-sub map-pin-container" 
                    onClick={(e) => {
                        e.stopPropagation(); 
                        setMapSelectorAddress(item.address);
                    }}
                >
                    <span className="map-pin-icon">📍</span> 
                    <span className="map-pin-hint">開啟地圖</span>
                </div>
            )}
            
            {/* ✨ 已移除電話顯示 */}
            
            {todayHours && <div className="opening-hours-tag">🕒 {todayHours}</div>}
            {item.notes && <div className="general-sub">📝 {item.notes}</div>}
          </div>
        </div>
        <div className="general-right">
          <div className="time-display">{displayStart}</div>
          <div className="duration-display">
            {duration && <span className="duration-tag">{duration}</span>}
            {(displayStart || displayEnd) && <span className="arrow-small">──➝</span>}
          </div>
          <div className="time-display">{displayEnd}</div>
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
      {/* ✨ CSS 設定 */}
      <style>{`
        :root {
            --primary: #3b82f6;       
            --primary-hover: #2563eb;
            --radius-card: 16px;
            --radius-btn: 12px;
            --glass-blur: blur(12px);

            --bg-body: #f8fafc;       
            --bg-sidebar: rgba(255, 255, 255, 0.8);
            --bg-content-header: rgba(255, 255, 255, 0.9);
            
            --bg-card: #ffffff;       
            --border-card: #e2e8f0;   
            --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04);

            --text-main: #0f172a;     
            --text-sub: #475569;
            --text-muted: #94a3b8;
            
            --day-item-hover: #f1f5f9;
            --day-item-active-bg: #ffffff;
            --day-item-active-text: #3b82f6;
            
            --input-bg: #ffffff;
            --input-border: #cbd5e1;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --bg-body: #0f172a;     
                --bg-sidebar: rgba(30, 41, 59, 0.75); 
                --bg-content-header: rgba(30, 41, 59, 0.85);
                --bg-card: #1e293b;     
                --border-card: #334155; 
                --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
                --text-main: #f1f5f9;   
                --text-sub: #cbd5e1;
                --text-muted: #64748b;
                --day-item-hover: #1e293b;
                --day-item-active-bg: #1e293b;
                --day-item-active-text: #60a5fa;
                --input-bg: #0f172a;
                --input-border: #475569;
            }
        }

        .trip-details-page {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: var(--text-main);
            background-color: var(--bg-body); 
            min-height: 100vh;
            padding: 20px;
            box-sizing: border-box;
            
            max-width: 1280px; 
            margin: 0 auto;
            width: 100%;
        }

        .layout-container { display: flex; gap: 24px; min-height: 600px; position: relative; z-index: 1; }

        .sidebar { 
            width: 240px; 
            padding: 16px;
            background: var(--bg-sidebar); 
            backdrop-filter: var(--glass-blur);
            border: 1px solid var(--border-card);
            border-radius: var(--radius-card);
            box-shadow: var(--shadow-card);
            overflow-y: auto; 
            max-height: 80vh; 
            position: sticky; 
            top: 20px; 
        }

        .day-item { 
            padding: 12px 16px; 
            cursor: pointer; 
            margin-bottom: 8px; 
            border-radius: var(--radius-btn); 
            transition: all 0.2s ease; 
            color: var(--text-sub);
            border: 1px solid transparent;
        }
        
        .day-item:hover { background: var(--day-item-hover); color: var(--text-main); }

        .day-item-active {
            background-color: var(--day-item-active-bg) !important;
            color: var(--day-item-active-text) !important;
            box-shadow: var(--shadow-card);
            border: 1px solid var(--border-card);
            font-weight: 600;
        }
        
        .day-item-active .day-item-text-title { color: var(--day-item-active-text); }
        .day-item-active .day-item-text-date { color: var(--text-sub); }

        .day-item-text-title { font-weight: 600; font-size: 1rem; }
        .day-item-text-date { font-size: 0.85rem; margin-top: 4px; opacity: 0.8; }

        .content-area { 
            flex: 1; 
            min-width: 0; 
        }
        
        .card {
            background-color: var(--bg-card) !important; 
            color: var(--text-main) !important;
            border-radius: var(--radius-card);
            box-shadow: var(--shadow-card);
            margin-bottom: 16px;
            overflow: hidden;
            transition: transform 0.2s, box-shadow 0.2s;
            border: 1px solid var(--border-card);
            list-style: none;
            
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
        }
        .card:hover { transform: translateY(-2px); border-color: var(--primary); }

        .transport-card { 
            position: relative; 
        }
        
        .transport-body-new {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .transport-time-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 10px;
            border-bottom: 1px dashed var(--border-card);
        }
        .time-big {
            font-size: 1.5rem;
            font-weight: 800;
            color: var(--text-main);
            letter-spacing: -0.5px;
        }
        .duration-badge {
            background: rgba(59, 130, 246, 0.1);
            color: var(--primary);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .transport-meta-row {
            font-size: 0.8rem;
            color: var(--text-muted);
            text-align: center;
            margin-top: -5px;
        }
        .text-red { color: #ef4444; }

        .transport-loc-list {
            display: flex;
            flex-direction: column;
        }
        .loc-item {
            display: flex;
            gap: 12px;
            position: relative;
            min-height: 40px; 
        }
        
        .timeline-col {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 16px;
            padding-top: 6px;
        }
        .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            border: 2px solid #fff;
            box-shadow: 0 0 0 1px #cbd5e1;
            z-index: 1;
        }
        .dot-start { background: var(--primary); }
        .dot-end { background: #ef4444; } 
        
        .line {
            flex: 1;
            width: 2px;
            background: #e2e8f0;
            margin-top: -2px;
            margin-bottom: -4px;
            min-height: 20px;
        }
        .line-top {
            width: 2px;
            background: #e2e8f0;
            height: 10px;
            margin-bottom: -2px;
        }

        .loc-content { flex: 1; padding-bottom: 12px; }
        .loc-label {
            font-size: 0.7rem;
            text-transform: uppercase;
            color: var(--text-muted);
            font-weight: 600;
            letter-spacing: 0.5px;
            margin-bottom: 2px;
        }
        .loc-name {
            font-size: 1rem;
            color: var(--text-main);
            font-weight: 500;
            line-height: 1.3;
        }

        .transport-notes {
            margin-top: 5px;
            padding: 10px;
            background: rgba(128,128,128,0.05);
            border-radius: 8px;
            font-size: 0.9rem;
            color: var(--text-sub);
            display: flex;
            gap: 8px;
            align-items: flex-start;
        }
        .note-icon { font-size: 1rem; }
        .note-text { line-height: 1.4; white-space: pre-wrap; }

        .transport-cost-tag {
            position: absolute;
            bottom: 15px;
            right: 15px;
            background: #f1f5f9;
            padding: 4px 10px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: bold;
            color: var(--text-sub);
        }

        .card-header { padding: 12px 20px; font-size: 0.95rem; font-weight: bold; display: flex; justify-content: space-between; color: white; }
        .header-blue { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); } 
        .header-green { background: linear-gradient(135deg, #10b981 0%, #059669 100%); } 
        .header-orange { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); } 

        .general-card { display: flex; justify-content: space-between; align-items: center; padding: 20px; }
        .general-left { display: flex; align-items: flex-start; gap: 16px; flex: 1; }
        .category-icon { font-size: 1.8rem; background: rgba(128,128,128,0.1); width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; border-radius: 50%; flex-shrink: 0; color: var(--text-sub); }
        .general-content { display: flex; flex-direction: column; gap: 4px; }
        .general-name { font-weight: 700; font-size: 1.1rem; color: var(--text-main); line-height: 1.4; }
        
        .general-sub { font-size: 0.9rem; color: var(--text-sub); display: flex; align-items: center; gap: 5px; }
        .map-pin-container { cursor: pointer; display: inline-flex; align-items: center; transition: transform 0.1s; padding: 4px 0; }
        .map-pin-container:hover { transform: scale(1.05); }
        .map-pin-icon { font-size: 1.2rem; }
        .map-pin-hint { font-size: 0.8rem; color: var(--primary); text-decoration: underline; margin-left: 2px; }

        .opening-hours-tag { font-size: 0.8rem; background: rgba(245, 158, 11, 0.15); color: #d97706; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-top: 4px; align-self: flex-start; }
        
        .general-right { text-align: right; min-width: 90px; padding-left: 10px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; }
        .time-display { font-weight: 800; color: var(--text-main); font-size: 1rem; min-height: 1rem; }
        .duration-display { display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin: 4px 0; min-height: 1rem; }
        .duration-tag { font-size: 0.75rem; background: rgba(128,128,128,0.1); padding: 2px 8px; border-radius: 4px; color: var(--text-muted); }
        .arrow-small { font-size: 0.7rem; color: var(--text-muted); }

        .simple-card { cursor: pointer; padding: 14px 20px; background: var(--bg-card); }
        .simple-card-content { display: flex; align-items: center; gap: 12px; font-size: 0.95rem; color: var(--text-sub); }
        .icon-text { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text-main); }
        .note-card { padding: 20px; border-left: 4px solid #f59e0b; background: rgba(245, 158, 11, 0.05) !important; }
        
        .header-btn {
            padding: 8px 16px;
            background: var(--bg-card);
            border: 1px solid var(--border-card);
            border-radius: 20px;
            cursor: pointer;
            color: var(--text-main);
            font-weight: 600;
            box-shadow: var(--shadow-card);
            transition: all 0.2s;
        }
        .header-btn:hover { background: var(--day-item-hover); border-color: var(--primary); }
        
        .attachment-link { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-body); border: 1px solid var(--border-card); padding: 6px 12px; border-radius: 20px; text-decoration: none; color: var(--text-sub); font-size: 0.85rem; transition: background 0.2s; }
        .attachment-link:hover { border-color: var(--primary); color: var(--primary); }

        .map-modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); z-index: 9999;
            display: flex; align-items: center; justify-content: center;
        }
        .map-modal-content {
            background: var(--bg-card);
            padding: 24px;
            border-radius: var(--radius-card);
            width: 90%; max-width: 320px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            animation: fadeIn 0.2s ease;
        }
        .map-link-btn {
            display: block; padding: 12px;
            text-align: center;
            border-radius: var(--radius-btn);
            background: #f0f0f0;
            color: white;
            text-decoration: none;
            font-weight: bold;
            background-color: var(--btn-color);
            transition: transform 0.1s;
        }
        .map-link-btn:active { transform: scale(0.98); }
        .map-cancel-btn {
            margin-top: 15px; width: 100%; padding: 10px;
            background: transparent; border: 1px solid var(--border-card);
            border-radius: var(--radius-btn);
            color: var(--text-sub); cursor: pointer;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        @media (max-width: 768px) {
          .trip-details-page { padding: 10px; }
          .layout-container { flex-direction: column; gap: 16px; }
          .sidebar { 
            width: 100%; border-right: none; border-bottom: 1px solid var(--border-card); 
            padding: 12px; display: flex; overflow-x: auto; white-space: nowrap; background: var(--bg-sidebar);
          }
          .day-item { min-width: 80px; text-align: center; margin-right: 8px; margin-bottom: 0; padding: 8px 12px; }
          .day-item-active { border-left: none; border-bottom: 3px solid var(--primary); box-shadow: none; border-top: none; border-right: none; }
          .content-area { padding: 0; }
          .general-card { padding: 16px; }
          .general-name { font-size: 1rem; }
        }
      `}</style>

      {mapSelectorAddress && (
          <MapSelectorModal 
            address={mapSelectorAddress} 
            onClose={() => setMapSelectorAddress(null)} 
          />
      )}

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

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '0 5px', position: 'relative', zIndex: 2}}>
        <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-sub)', display:'inline-flex', alignItems: 'center', marginBottom:'15px', fontWeight: 'bold' }}>← 返回列表</Link>
        <div style={{display:'flex', gap:'10px'}}>
            <button onClick={() => setShowShareModal(true)} className="header-btn">🔗 分享</button>
            <button onClick={() => setShowSettings(true)} className="header-btn">⚙️ 設定</button>
        </div>
      </div>
      
      <div style={{ borderBottom: '1px solid var(--border-card)', paddingBottom: '20px', marginBottom: '24px', paddingLeft: '5px', position: 'relative', zIndex: 2 }}>
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

        <div className="content-area">
          {selectedDay && (
            <>
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