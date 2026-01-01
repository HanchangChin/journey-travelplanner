import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { BrowserRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom'
import { Auth } from '@supabase/auth-ui-react' // 需安裝 npm install @supabase/auth-ui-react @supabase/auth-ui-shared
import { ThemeSupa } from '@supabase/auth-ui-shared'
import CreateTrip from './CreateTrip'
import TripDetails from './TripDetails'

// 0. 登入頁面元件
function Login({ session }) {
  const navigate = useNavigate()

  useEffect(() => {
    if (session) {
      navigate('/') // 已登入則跳轉首頁
    }
  }, [session, navigate])

  if (!session) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f8f9fa' }}>
        <div style={{ width: '100%', maxWidth: '400px', padding: '40px', background: 'white', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <h2 style={{textAlign:'center', marginBottom:'20px', color:'#333'}}>🌍 歡迎回來</h2>
          <Auth 
            supabaseClient={supabase} 
            appearance={{ theme: ThemeSupa }}
            providers={[]} // 若有 Google 登入可加 ['google']
            theme="light"
          />
        </div>
      </div>
    )
  }
  return null
}

// 1. 首頁元件 (Home) - 需接收 session 以獲取 user_id
function Home({ session }) {
  const [upcomingTrips, setUpcomingTrips] = useState([]) 
  const [pastTrips, setPastTrips] = useState([])         
  const [showCreateModal, setShowCreateModal] = useState(false) 
  const navigate = useNavigate()

  async function fetchTrips() {
    // 啟用 RLS 後，Supabase 會自動根據登入者過濾資料
    const { data, error } = await supabase
      .from('trips')
      .select('*, trip_days(*), trip_destinations(*)')
      .order('start_date', { ascending: false }) 
    
    if (error) console.error('Error:', error)

    if (data) {
      const today = new Date()
      today.setHours(0, 0, 0, 0) 

      const upcoming = []
      const past = []

      data.forEach(trip => {
        const tripDate = trip.end_date ? new Date(trip.end_date) : new Date(trip.start_date)
        if (tripDate < today) {
          past.push(trip)
        } else {
          upcoming.push(trip)
        }
      })

      upcoming.sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
      past.sort((a, b) => new Date(b.start_date) - new Date(a.start_date))

      setUpcomingTrips(upcoming)
      setPastTrips(past)
    }
  }

  // 監聽 session 變化，有登入才撈資料
  useEffect(() => { 
      if (session) fetchTrips() 
  }, [session])

  const handleTripCreated = () => {
    fetchTrips()
    setShowCreateModal(false)
  }

  const handleLogout = async () => {
      await supabase.auth.signOut()
      // App 層級的 onAuthStateChange 會處理跳轉
  }

  const TripCard = ({ trip, isPast }) => (
    <div 
      onClick={() => navigate(`/trip/${trip.id}`)}
      style={{ 
        padding: '20px', border: '1px solid #e0e0e0', borderRadius: '12px', 
        background: isPast ? '#f5f5f5' : 'white', cursor: 'pointer', marginBottom: '15px',
        transition: 'all 0.2s ease', boxShadow: isPast ? 'none' : '0 2px 8px rgba(0,0,0,0.05)',
        opacity: isPast ? 0.7 : 1, position: 'relative', overflow: 'hidden'
      }}
      onMouseOver={e => !isPast && (e.currentTarget.style.transform = 'translateY(-2px)', e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)')}
      onMouseOut={e => !isPast && (e.currentTarget.style.transform = 'none', e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)')}
    >
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
        <h3 style={{ margin: 0, color: isPast ? '#666' : '#007bff', fontSize: '1.2rem' }}>{trip.title}</h3>
        {isPast ? <span style={{fontSize: '12px', background: '#ddd', color: '#666', padding: '3px 8px', borderRadius: '10px'}}>已封存</span> : <span style={{color: '#ccc'}}>➜</span>}
      </div>
      <div style={{color: '#666', fontSize: '14px', display:'flex', gap:'15px', alignItems:'center'}}>
        <span>📅 {trip.start_date} ~ {trip.end_date}</span>
        <span style={{background:'#e3f2fd', color:'#007bff', padding:'2px 8px', borderRadius:'10px', fontSize:'12px'}}>{trip.trip_days?.length || 0} 天</span>
      </div>
      <div style={{marginTop: '8px', fontSize: '14px', color: '#444'}}>
        📍 {trip.trip_destinations?.map(d => d.location_name).join(', ') || '尚未規劃地點'}
      </div>
    </div>
  )

  return (
    <div style={{ padding: '40px 20px', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif', paddingBottom: '100px' }}>
      
      {/* 標題區 (含登出按鈕) */}
      <div style={{ textAlign: 'center', marginBottom: '40px', position: 'relative' }}>
        <h1 style={{ margin: '0 0 10px 0', fontSize: '2.5rem' }}>🌍 Journey Travel Planner</h1>
        <p style={{ color: '#666' }}>{session?.user?.email} 的旅程</p>
        <button 
            onClick={handleLogout}
            style={{ position: 'absolute', right: 0, top: 0, padding: '5px 10px', background: 'transparent', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', color: '#666', fontSize: '12px' }}
        >
            登出
        </button>
      </div>

      {/* 1. 即將出發 */}
      <div style={{ marginBottom: '40px' }}>
        <h3 style={{ borderBottom: '2px solid #007bff', paddingBottom: '10px', margin: '0 0 20px 0', color: '#333' }}>
          🛫 我的旅行 ({upcomingTrips.length})
        </h3>
        {upcomingTrips.length > 0 ? (
          upcomingTrips.map(trip => <TripCard key={trip.id} trip={trip} isPast={false} />)
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', background: '#f8f9fa', borderRadius: '12px', color: '#888' }}>
            還沒有即將出發的行程，點擊下方按鈕開始規劃！
          </div>
        )}
      </div>

      {/* 2. 過去旅行 */}
      {pastTrips.length > 0 && (
        <div>
          <h3 style={{ borderBottom: '1px solid #ddd', paddingBottom: '10px', margin: '0 0 20px 0', color: '#888' }}>
            🗄️ 過去旅行 ({pastTrips.length})
          </h3>
          {pastTrips.map(trip => <TripCard key={trip.id} trip={trip} isPast={true} />)}
        </div>
      )}

      {/* 3. 建立按鈕 */}
      <div style={{ textAlign: 'center', marginTop: '40px' }}>
        <button 
          onClick={() => setShowCreateModal(true)}
          style={{ padding: '15px 40px', fontSize: '18px', fontWeight: 'bold', background: 'linear-gradient(to right, #007bff, #0056b3)', color: 'white', border: 'none', borderRadius: '50px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(0, 123, 255, 0.4)', transition: 'transform 0.2s', display: 'inline-flex', alignItems: 'center', gap: '10px' }}
          onMouseOver={e => e.currentTarget.style.transform = 'scale(1.05)'}
          onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          <span>✨</span> 開始規劃新旅行
        </button>
      </div>

      {/* 4. 建立新旅行 Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, backdropFilter: 'blur(3px)' }}>
          <div style={{ background: 'white', padding: '30px', borderRadius: '16px', width: '90%', maxWidth: '550px', position: 'relative', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', animation: 'fadeIn 0.3s ease' }}>
            <button onClick={() => setShowCreateModal(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'transparent', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#999' }}>×</button>
            <h2 style={{ marginTop: 0, textAlign: 'center', color: '#333' }}>✈️ 建立新旅程</h2>
            <div style={{borderBottom:'1px solid #eee', margin:'15px 0'}}></div>
            {/* ✨ 傳遞 userId 給 CreateTrip */}
            <CreateTrip onTripCreated={handleTripCreated} userId={session?.user?.id} />
          </div>
        </div>
      )}
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}

// 3. 主程式路由 (Root)
export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 1. 初始化檢查 Session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    // 2. 監聽登入狀態變化 (Login/Logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
      return <div style={{height:'100vh', display:'flex', justifyContent:'center', alignItems:'center'}}>Loading...</div>
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* 如果沒 Session 導向 Login；有 Session 顯示 Home */}
        <Route path="/" element={!session ? <Navigate to="/login" /> : <Home session={session} />} />
        
        {/* Login 頁面 */}
        <Route path="/login" element={<Login session={session} />} />
        
        {/* 詳細頁保護 */}
        <Route path="/trip/:tripId" element={!session ? <Navigate to="/login" /> : <TripDetails />} />
      </Routes>
    </BrowserRouter>
  )
}