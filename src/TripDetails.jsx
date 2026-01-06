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
  
  // 🔥 新增：用來記錄要「插入」的排序位置
  const [insertSortOrder, setInsertSortOrder] = useState(null)

  // ✨ 控制地圖選擇視窗的狀態
  const [mapSelectorAddress, setMapSelectorAddress] = useState(null)

  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_API_KEY, libraries: LIBRARIES })

  // 🚫 只在「非觸控裝置」啟用拖曳排序，避免手機上阻擋正常捲動
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  const sensors = useSensors(
    // 桌機 / 滑鼠裝置才啟用 PointerSensor
    ...(!isTouchDevice ? [useSensor(PointerSensor, { activationConstraint: { distance: 5 } })] : []),
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

  // 🔥 修改：開啟新增 Modal 時，清空插入位置（代表新增到最後）
  const openNewItemModal = () => { 
    setEditingItem(null); 
    setInsertSortOrder(null); // Reset
    setShowItemModal(true); 
  }
  
  const openEditItemModal = (item) => { setEditingItem(item); setShowItemModal(true); }

  // 🔥 新增：處理「插入」特定位置的邏輯
  const handleInsertAfter = (currentItemIndex) => {
    const currentDayItems = items.filter(item => item.trip_day_id === selectedDay?.id);
    const currentItem = currentDayItems[currentItemIndex];
    const nextItem = currentDayItems[currentItemIndex + 1];

    let targetOrder;
    if (nextItem) {
        targetOrder = (currentItem.sort_order + nextItem.sort_order) / 2;
    } else {
        targetOrder = currentItem.sort_order + 100; // 隨意增加
    }

    setEditingItem(null);
    setInsertSortOrder(targetOrder);
    setShowItemModal(true);
  };

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

  // 🔥 新增：GapInserter 元件 (插在行程卡之間的 UI)
  const GapInserter = ({ onInsert }) => (
    <div className="gap-inserter-container" onClick={(e) => e.stopPropagation()}>
        <div className="gap-line"></div>
        <button className="gap-plus-btn" onClick={onInsert}>+</button>
    </div>
  );

  // --- Card Components ---

  // 🔥 1. TransportCard (修改版: 地點與標籤同一行，高度簡潔)
  const TransportCard = ({ item }) => {
    const t = item.transport_details || {};
    const travelers = t.travelers || [];
    const isArrivalCard = t.is_arrival_card;
    const isCarMode = t.sub_type === 'car_bus';
    const isPublic = t.sub_type === 'public'; 
    const isSimpleView = isPublic && (!item.start_time || !item.end_time);

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
        <div className={`card-header ${isCarMode || isPublic ? 'header-green' : 'header-blue'}`}>
          <span>{isPublic ? '🚌' : (isCarMode ? '🚗' : '✈️')} {t.company || '交通'} {t.vehicle_number}</span>
          <span>{travelers.length === 1 ? ((isCarMode||isPublic) ? '' : `PNR: ${travelers[0].booking_ref}`) : `👥 ${travelers.length} 人`}</span>
        </div>

        <div className="card-body transport-body-new">
          <div className="transport-time-row">
             <div className="time-big">{formatDisplayTime(isArrivalCard ? t.original_start_time : item.start_time)}{isArrivalCard && <sup className="offset-text">-1</sup>}</div>
             <div className="duration-badge">
                <span className="duration-icon">{isCarMode ? '🚗' : (isPublic ? '🚌' : '✈️')}</span>
                <span className="duration-val">{t.duration_text || '--'}</span>
             </div>
             <div className="time-big">{formatDisplayTime(isArrivalCard ? item.start_time : item.end_time)}{!isArrivalCard && t.arrival_day_offset > 0 && <sup className="offset-text">+{t.arrival_day_offset}</sup>}</div>
          </div>

          {(t.distance_text || t.buffer_time > 0) && (
              <div className="transport-meta-row">
                 {t.distance_text && <span>📏 {t.distance_text}</span>}
                 {t.buffer_time > 0 && <span className="text-red"> (+Buffer {t.buffer_time}m)</span>}
              </div>
          )}

          <div className="transport-loc-list">
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

          {item.notes && (
            <div className="transport-notes">
               <span className="note-icon">📝</span>
               <span className="note-text">{item.notes}</span>
            </div>
          )}

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
                <div style={{flex: 1}}>
                    <div 
                        className="acc-address map-pin-container"
                        onClick={(e) => {
                            e.stopPropagation();
                            setMapSelectorAddress(item.address);
                        }}
                    >
                        <span className="map-pin-icon">📍</span>
                        <span style={{textDecoration:'underline'}}>{item.address}</span>
                    </div>
                </div>
                
                <div className="acc-cost-status-row">
                    {item.cost > 0 && <div className="acc-cost">{acc.currency} ${item.cost}</div>}
                    <div className="acc-status">
                        {acc.is_paid ? 
                            <span className="tag tag-green">已付款</span> : 
                            <span className="tag tag-red">尚未付款</span>
                        }
                    </div>
                </div>
            </div>

            {!isStay && (
                <div className="acc-dates-inline">
                    <div>
                        <span className="label-orange">📥 Check-in:</span> 
                        <span className="date-val">{acc.checkin_date} {formatDisplayTime(item.start_time)}</span>
                    </div>
                    <div className="date-separator">|</div>
                    <div>
                        <span className="label-orange">📤 Check-out:</span> 
                        <span className="date-val">{acc.checkout_date} {formatDisplayTime(item.end_time)}</span>
                    </div>
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

    const showReservation = item.category === 'food' && (item.is_reserved || item.reservation_agent || item.reservation_advance_time);

    return (
      <li onClick={() => openEditItemModal(item)} className="card general-card">
        <div className="general-left">
          <div className="category-icon">{getCategoryIcon(item.category)}</div>
          <div className="general-content">
            <div className="general-name">{item.name}</div>
            
            {/* 預約資訊 */}
            {showReservation && (
                <div className="general-sub reservation-row">
                    {item.is_reserved ? 
                        <span className="res-tag res-tag-success">✅ 已預約</span> : 
                        <span className="res-tag res-tag-gray">❌ 未預約</span>
                    }
                    {item.reservation_agent && <span>🎫 {item.reservation_agent}</span>}
                    {item.reservation_advance_time && <span>⏰ {item.reservation_advance_time}</span>}
                </div>
            )}

            {/* 地點與營業時間 */}
            {(item.address || todayHours) && (
              <div className="general-sub" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                {item.address && (
                  <div 
                      className="tag-base tag-map"
                      onClick={(e) => {
                          e.stopPropagation(); 
                          setMapSelectorAddress(item.address);
                      }}
                  >
                      <span className="map-pin-icon" style={{fontSize:'1rem'}}>📍</span> 
                      <span>開啟地圖</span>
                  </div>
                )}
                
                {todayHours && <div className="tag-base tag-hours">🕒 {todayHours}</div>}
              </div>
            )}
            
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
          
          {item.cost > 0 && (
              <div className="general-cost">
                  {item.currency || 'TWD'} <span style={{fontWeight:'bold'}}>${item.cost}</span>
              </div>
          )}
        </div>
      </li>
    )
  }

  // 🔥 4. NoteCard (維持收合功能與 SVG Icon)
  const NoteCard = ({ item }) => {
      const [isExpanded, setIsExpanded] = useState(false);

      return (
          <div onClick={() => openEditItemModal(item)} className="card note-card" style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div className="note-title" style={{ margin: 0, flex: 1 }}>
                      📝 {item.name}
                  </div>
                  
                  <button 
                      type="button"
                      onClick={(e) => { 
                          e.stopPropagation(); 
                          setIsExpanded(!isExpanded); 
                      }}
                      style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--text-sub)',
                          transition: 'transform 0.3s ease',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                      }}
                  >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M7 10L12 15L17 10H7Z" />
                      </svg>
                  </button>
              </div>

              {isExpanded && (
                  <div style={{ marginTop: '12px', borderTop: '1px dashed rgba(0,0,0,0.1)', paddingTop: '12px', animation: 'fadeIn 0.2s' }}>
                      {item.notes && (
                          <div 
                              className="note-content" 
                              style={{ 
                                  whiteSpace: 'pre-wrap', 
                                  lineHeight: '1.6',
                                  color: 'var(--text-main)',
                                  fontSize: '0.95rem'
                              }}
                          >
                              {item.notes}
                          </div>
                      )}
                      
                      {item.attachment_url && (
                          <div className="note-attachment" style={{ marginTop: '12px' }}>
                              <a href={item.attachment_url} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()} className="attachment-link">
                                  <span className="attach-icon">{item.attachment_type === 'image' ? '🖼️' : '📄'}</span> 
                                  <span>{item.attachment_type === 'image' ? '圖片' : '文件'}</span>
                                  <span className="attach-arrow">↗</span>
                              </a>
                          </div>
                      )}
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

        /* 🔥 新增 Gap Inserter 樣式 */
        .gap-inserter-container {
            position: relative;
            height: 24px; /* 感應區高度 */
            margin: -12px 0; /* 讓它能夠重疊在卡片的 margin 間隙 */
            display: flex;
            align-items: center;
            justify-content: flex-start;
            padding-left: 25px; /* 左側對齊位置 */
            z-index: 10;
            opacity: 0;
            transition: opacity 0.2s ease;
            cursor: pointer;
        }
        .gap-inserter-container:hover {
            opacity: 1;
        }
        .gap-line {
            position: absolute;
            left: 35px; /* 對齊圖示的中心 */
            top: 0;
            bottom: 0;
            width: 0;
            border-left: 2px dashed #cbd5e1;
        }
        /* 修改後的按鈕樣式：只有 + 號，沒有圓底 */
        .gap-plus-btn {
            background: transparent; /* 移除藍色背景 */
            color: var(--text-muted); /* 平常顯示為灰色，比較不搶眼 */
            border: none;
            
            /* 調整字體大小與位置 */
            font-size: 24px;
            font-weight: 400;
            line-height: 1;
            
            /* 讓點擊範圍保持適中 */
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            
            cursor: pointer;
            z-index: 2;
            margin-left: -3px; /* 微調讓 + 號對齊虛線中心 */
            transition: all 0.2s ease;
        }

        .gap-plus-btn:hover {
            color: var(--primary); /* 滑鼠移上去變藍色 */
            transform: scale(1.2); /* 稍微放大 */
            background: transparent;
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

        .sticky-header {
            position: sticky;
            top: 0;
            z-index: 100; 
            background: var(--bg-body);
            backdrop-filter: var(--glass-blur);
            border-bottom: 1px solid var(--border-card);
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 20px;
            margin: 0 -20px 20px -20px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }

        .header-left { display: flex; align-items: center; gap: 15px; }
        .header-title-group { display: flex; flex-direction: column; }
        .header-title { margin: 0; font-size: 1.2rem; font-weight: 800; color: var(--text-main); line-height: 1.2; }
        .header-meta { font-size: 0.8rem; color: var(--text-sub); display: flex; gap: 10px; margin-top: 2px; }
        .header-right { display: flex; gap: 8px; }

        .header-btn {
            padding: 6px 14px;
            font-size: 0.9rem;
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
            top: 100px; 
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
        .day-item-active { background-color: var(--day-item-active-bg) !important; color: var(--day-item-active-text) !important; box-shadow: var(--shadow-card); border: 1px solid var(--border-card); font-weight: 600; }
        .day-item-active .day-item-text-title { color: var(--day-item-active-text); }
        .day-item-active .day-item-text-date { color: var(--text-sub); }
        .day-item-text-title { font-weight: 600; font-size: 1rem; }
        .day-item-text-date { font-size: 0.85rem; margin-top: 4px; opacity: 0.8; }

        .content-area { flex: 1; min-width: 0; }
        
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

        .transport-card { position: relative; }
        .transport-body-new { padding: 20px; display: flex; flex-direction: column; gap: 15px; }
        .transport-time-row { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px dashed var(--border-card); }
        .time-big { font-size: 1.5rem; font-weight: 800; color: var(--text-main); letter-spacing: -0.5px; }
        .duration-badge { background: rgba(59, 130, 246, 0.1); color: var(--primary); padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 6px; }
        .transport-meta-row { font-size: 0.8rem; color: var(--text-muted); text-align: center; margin-top: -5px; }
        .text-red { color: #ef4444; }
        
        /* ✨ Transport 調整: 高度縮減與單行排列 */
        .transport-loc-list { display: flex; flex-direction: column; }
        .loc-item { display: flex; gap: 12px; position: relative; min-height: 28px; margin-bottom: 6px; } 
        .timeline-col { width: 16px; display: flex; flex-direction: column; align-items: center; padding-top: 4px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #cbd5e1; z-index: 1; }
        .dot-start { background: var(--primary); }
        .dot-end { background: #ef4444; } 
        .line { flex: 1; width: 2px; background: #e2e8f0; margin-top: -2px; margin-bottom: -4px; min-height: 15px; }
        .line-top { width: 2px; background: #e2e8f0; height: 10px; margin-bottom: -2px; }
        
        /* ✨ 新的 Inline 排版樣式 */
        .loc-content { flex: 1; display: flex; align-items: center; gap: 10px; padding-bottom: 0; }
        .loc-label { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; min-width: 60px; margin-bottom: 0; }
        .loc-name { font-size: 1rem; color: var(--text-main); font-weight: 500; line-height: 1.2; }

        .transport-notes { margin-top: 5px; padding: 10px; background: rgba(128,128,128,0.05); border-radius: 8px; font-size: 0.9rem; color: var(--text-sub); display: flex; gap: 8px; align-items: flex-start; }
        .note-icon { font-size: 1rem; }
        .note-text { line-height: 1.4; white-space: pre-wrap; }
        .transport-cost-tag { position: absolute; bottom: 15px; right: 15px; background: #f1f5f9; padding: 4px 10px; border-radius: 8px; font-size: 0.85rem; font-weight: bold; color: var(--text-sub); }

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
        
        .reservation-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; font-size: 0.85rem; }
        .res-tag { padding: 2px 6px; border-radius: 4px; font-weight: 500; }
        .res-tag-success { color: #10b981; background: rgba(16, 185, 129, 0.1); }
        .res-tag-gray { color: #64748b; background: rgba(100, 116, 139, 0.1); }
        
        .general-cost { font-size: 0.85rem; color: var(--text-sub); margin-top: 4px; font-weight: 500; }

        .general-right { text-align: right; min-width: 90px; padding-left: 10px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; }
        .time-display { font-weight: 800; color: var(--text-main); font-size: 1rem; min-height: 1rem; }
        .duration-display { display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin: 4px 0; min-height: 1rem; }
        .duration-tag { font-size: 0.75rem; background: rgba(128,128,128,0.1); padding: 2px 8px; border-radius: 4px; color: var(--text-muted); }
        .arrow-small { font-size: 0.7rem; color: var(--text-muted); }

        .simple-card { cursor: pointer; padding: 14px 20px; background: var(--bg-card); }
        .simple-card-content { display: flex; align-items: center; gap: 12px; font-size: 0.95rem; color: var(--text-sub); }
        .icon-text { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text-main); }
        .note-card { padding: 20px; border-left: 4px solid #f59e0b; background: rgba(245, 158, 11, 0.05) !important; }
        
        .attachment-link { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-body); border: 1px solid var(--border-card); padding: 6px 12px; border-radius: 20px; text-decoration: none; color: var(--text-sub); font-size: 0.85rem; transition: background 0.2s; }
        .attachment-link:hover { border-color: var(--primary); color: var(--primary); }

        /* Accommodation specific */
        .acc-info-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
        .acc-address { font-size: 0.9rem; color: var(--text-sub); }
        .acc-cost-status-row { display: flex; align-items: center; gap: 8px; }
        .acc-cost { font-weight: bold; color: var(--text-main); font-size: 1rem; }
        .acc-status .tag { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; color: white; }
        .tag-green { background: #28a745; }
        .tag-red { background: #dc3545; }
        
        .acc-dates-inline { 
            display: flex; flex-wrap: wrap; gap: 10px; align-items: center; 
            background: rgba(128,128,128,0.03); padding: 8px; border-radius: 8px; border: 1px dashed var(--border-card);
            font-size: 0.85rem; color: var(--text-sub);
        }
        .date-separator { color: var(--text-muted); opacity: 0.5; }
        .label-orange { color: #f59e0b; font-weight: bold; margin-right: 4px; }
        .date-val { font-weight: 500; color: var(--text-main); }

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
        
        .tag-base { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; }
        .tag-map { background: rgba(128, 128, 128, 0.1); color: var(--text-sub); cursor: pointer; transition: background 0.2s; }
        .tag-map:hover { background: rgba(128, 128, 128, 0.2); }
        .tag-hours { background: rgba(245, 158, 11, 0.15); color: #d97706; }

        @media (max-width: 768px) {
          .trip-details-page { padding: 10px; }
          .layout-container { flex-direction: column; gap: 8px; }

          /* 🔥 Mobile Header 調整 */
          .sticky-header {
             padding: 5px 12px; /* 內距減少 */
             margin: 0 -10px 10px -10px;
             min-height: auto;
          }
          .header-title {
             font-size: 0.95rem; /* 標題變小 */
          }
          .header-meta {
             font-size: 0.7rem; /* 副標變小 */
             margin-top: 0;
             gap: 8px;
          }
          .header-left {
             gap: 8px;
          }
          .header-btn {
             padding: 4px 8px;
             font-size: 0.75rem; /* 按鈕變小 */
          }
          
          /* 🔥 Mobile Sidebar (Date bar) 調整 */
          .sidebar { 
            width: 100%; border-right: none; border-bottom: 1px solid var(--border-card); 
            padding: 6px 12px; /* 內距減少，高度變為原有的 ~70% */
            display: flex; overflow-x: auto; white-space: nowrap; background: var(--bg-sidebar);
            position: sticky;
            top: 55px; /* 調整 Sticky 位置配合 Header */
            z-index: 50;
          }
          .day-item { 
             min-width: 60px; /* 寬度稍微縮減 */
             text-align: center; margin-right: 6px; margin-bottom: 0; 
             padding: 4px 8px; /* 內距減少 */
          }
          .day-item-text-title {
             font-size: 0.85rem; /* 字體變小 */
          }
          .day-item-text-date {
             font-size: 0.7rem; /* 字體變小 */
          }

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
          // 🔥 新增：傳遞排序參數給 Modal (需自行確認 Modal 是否有接收此 props)
          initialSortOrder={insertSortOrder}
        />
      )}

      {showShareModal && (
        <ShareModal 
            trip={trip} 
            onClose={() => setShowShareModal(false)} 
            onUpdate={() => queryClient.invalidateQueries(['tripDetails', tripId])} 
        />
      )}

      <div className="sticky-header">
        <div className="header-left">
            <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-sub)', fontSize: '1.1rem', marginRight: '5px' }}>←</Link>
            <div className="header-title-group">
                <h1 className="header-title">{trip.title}</h1>
                <div className="header-meta">
                    <span>{trip.start_date} ~ {trip.end_date}</span>
                    <span>${trip.budget_goal}</span>
                    <span>{(trip.trip_members?.length || 0) + 1} 人</span>
                </div>
            </div>
        </div>
        <div className="header-right">
            <button onClick={() => setShowShareModal(true)} className="header-btn">🔗 分享</button>
            <button onClick={() => setShowSettings(true)} className="header-btn">⚙️ 設定</button>
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
                    {currentDayItems.map((item, index) => (
                        <SortableItem key={item.id} id={item.id}>
                          {(() => {
                             if (item.category === 'transport') return <TransportCard item={item} />
                             if (item.category === 'accommodation') return <AccommodationCard item={item} />
                             if (item.category === 'note') return <NoteCard item={item} />
                             return <GeneralCard item={item} />
                          })()}
                          {/* 🔥 修改：在每個項目下方加入插入點 */}
                          <GapInserter onInsert={() => handleInsertAfter(index)} />
                        </SortableItem>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
                
              <button onClick={openNewItemModal} style={{ width: '100%', padding: '16px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '12px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '50px', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)', transition: 'transform 0.2s' }} onMouseOver={(e)=>e.currentTarget.style.transform='scale(1.01)'} onMouseOut={(e)=>e.currentTarget.style.transform='scale(1)'}>
                <span>➕</span> 新增行程 (最底部)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}