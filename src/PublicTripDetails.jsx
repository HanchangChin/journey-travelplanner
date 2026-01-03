import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'

// 簡化版的展示元件，不需要 DND 和 Modal
export default function PublicTripDetails() {
  const { shareToken } = useParams()
  const [trip, setTrip] = useState(null)
  const [days, setDays] = useState([])
  const [items, setItems] = useState([])
  const [selectedDay, setSelectedDay] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Helpers (與原本相同)
  const getWeekday = (dateString) => new Date(dateString).toLocaleDateString('zh-TW', { weekday: 'short' })
  const formatDisplayTime = (timeStr) => timeStr ? timeStr.substring(0, 5) : '--:--'

  useEffect(() => {
    async function fetchPublicTrip() {
      try {
        // 1. 用 share_token 找 trip
        const { data: tripData, error: tripError } = await supabase
          .from('trips')
          .select('*, trip_members(*)')
          .eq('share_token', shareToken)
          .single()
        
        if (tripError || !tripData) throw new Error('行程不存在或已關閉分享')

        // 2. 找 days
        const { data: daysData } = await supabase.from('trip_days').select('*').eq('trip_id', tripData.id).order('day_number')
        
        // 3. 找 items
        const { data: itemsData } = await supabase.from('itinerary_items').select('*').eq('trip_id', tripData.id).order('sort_order').order('start_time')

        // 排序邏輯
        itemsData.sort((a, b) => {
            if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
            if (a.category === 'accommodation') return 1;
            if (b.category === 'accommodation') return -1;
            return 0;
        });

        setTrip(tripData)
        setDays(daysData || [])
        setItems(itemsData || [])
        if (daysData?.length > 0) setSelectedDay(daysData[0])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchPublicTrip()
  }, [shareToken])

  if (loading) return <div style={{padding:'40px', textAlign:'center', color:'white'}}>載入分享行程中...</div>
  if (error) return <div style={{padding:'40px', textAlign:'center', color:'#ff6b6b'}}>⚠️ {error} <br/><Link to="/" style={{color:'white', marginTop:'20px', display:'inline-block'}}>回首頁</Link></div>

  const currentDayItems = items.filter(item => item.trip_day_id === selectedDay?.id)

  // 簡單的卡片渲染 (Read-Only)
  const ReadOnlyCard = ({ item }) => (
    <div style={{
        background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(10px)',
        marginBottom: '10px', borderRadius: '12px', padding: '15px',
        borderLeft: `4px solid ${item.category === 'transport' ? '#007bff' : item.category === 'accommodation' ? '#ff7043' : '#28a745'}`,
        boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
    }}>
        <div style={{display:'flex', justifyContent:'space-between'}}>
            <div style={{fontWeight:'bold', fontSize:'16px', color:'#333'}}>{item.name}</div>
            <div style={{fontWeight:'bold', color:'#666'}}>{formatDisplayTime(item.start_time)}</div>
        </div>
        {item.notes && <div style={{fontSize:'13px', color:'#666', marginTop:'5px'}}>📝 {item.notes}</div>}
        {item.location_name && <div style={{fontSize:'12px', color:'#888', marginTop:'2px'}}>📍 {item.location_name}</div>}
    </div>
  )

  return (
    <div className="container" style={{maxWidth:'800px', margin:'0 auto', paddingBottom:'50px'}}>
      {/* 標題區 */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: '15px', marginBottom: '20px' }}>
        <h1 style={{ margin: '0 0 5px 0', color: 'white', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{trip.title}</h1>
        <div style={{ color: '#ddd', fontSize: '14px' }}>
          📅 {trip.start_date} ~ {trip.end_date} 
          <span style={{marginLeft:'15px'}}>👀 檢視模式</span>
        </div>
      </div>

      {/* 橫向天數選單 */}
      <div style={{ display: 'flex', overflowX: 'auto', gap: '10px', paddingBottom: '10px', marginBottom:'15px' }}>
        {days.map(day => (
          <div 
            key={day.id} 
            onClick={() => setSelectedDay(day)}
            style={{
              padding: '8px 15px', borderRadius: '20px', cursor: 'pointer', flexShrink: 0,
              background: selectedDay?.id === day.id ? '#007bff' : 'rgba(255,255,255,0.2)',
              color: 'white', border: '1px solid rgba(255,255,255,0.2)',
              textAlign:'center'
            }}
          >
            <div style={{fontWeight:'bold', fontSize:'14px'}}>Day {day.day_number}</div>
            <div style={{fontSize:'11px', opacity:0.8}}>{day.day_date}</div>
          </div>
        ))}
      </div>

      {/* 行程列表 */}
      <div>
        {selectedDay && (
            <>
                <h3 style={{color:'white', margin:'0 0 15px 0'}}>Day {selectedDay.day_number} {selectedDay.title && `- ${selectedDay.title}`}</h3>
                {currentDayItems.length === 0 ? <div style={{color:'#ccc', fontStyle:'italic'}}>本日無行程</div> : 
                 currentDayItems.map(item => <ReadOnlyCard key={item.id} item={item} />)
                }
            </>
        )}
      </div>
      
      <div style={{marginTop:'40px', textAlign:'center'}}>
          <Link to="/" style={{color:'white', textDecoration:'underline'}}>我也要規劃行程 (Journey Planner)</Link>
      </div>
    </div>
  )
}