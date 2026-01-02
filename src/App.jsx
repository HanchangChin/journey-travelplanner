import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { BrowserRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom'
import { Auth } from '@supabase/auth-ui-react' 
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { 
  QueryClient, 
  QueryClientProvider, 
  useQuery, 
  useQueryClient 
} from '@tanstack/react-query' // 導入 React Query
import CreateTrip from './CreateTrip'
import TripDetails from './TripDetails'

// 初始化 React Query 客戶端 (全域)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 分鐘內視為資料新鮮，不重複抓取
      gcTime: 1000 * 60 * 60 * 24, // 離線快取保留 24 小時
      retry: 2, // 網路失敗自動重試 2 次
    },
  },
})

// --- 元件：登入頁面 ---
function Login({ session }) {
  const navigate = useNavigate()
  useEffect(() => {
    if (session) navigate('/')
  }, [session, navigate])

  if (!session) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'transparent' }}>
        <div style={{ width: '100%', maxWidth: '400px', padding: '40px', background: 'white', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          <h2 style={{textAlign:'center', marginBottom:'20px', color:'#333'}}>🌍 歡迎回來</h2>
          <Auth 
            supabaseClient={supabase} 
            appearance={{ theme: ThemeSupa }}
            providers={[]} 
            theme="light"
          />
        </div>
      </div>
    )
  }
  return null
}

// --- 元件：首頁 (具備離線能力) ---
function Home({ session }) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // 使用 React Query 抓取資料 (自動處理快取與離線顯示)
  const { data: trips = [], isLoading, isRefetching } = useQuery({
    queryKey: ['trips', session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trips')
        .select('*, trip_days(*), trip_destinations(*)')
        .order('start_date', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!session?.user?.id, // 只有登入才執行
  })

  // 分類行程 (從快取的 trips 中分類)
  const today = new Date().setHours(0, 0, 0, 0)
  const upcomingTrips = trips
    .filter(t => (t.end_date ? new Date(t.end_date) : new Date(t.start_date)) >= today)
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
  
  const pastTrips = trips
    .filter(t => (t.end_date ? new Date(t.end_date) : new Date(t.start_date)) < today)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))

  const handleTripCreated = () => {
    queryClient.invalidateQueries(['trips']) // 重新整理資料
    setShowCreateModal(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    queryClient.clear() // 清除快取
  }

  const TripCard = ({ trip, isPast }) => (
    <div 
      onClick={() => navigate(`/trip/${trip.id}`)}
      className="card"
      style={{ 
        cursor: 'pointer', opacity: isPast ? 0.6 : 1,
        borderLeft: isPast ? '4px solid #666' : '4px solid #646cff'
      }}
    >
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
        <h3 style={{ margin: 0, color: isPast ? '#aaa' : '#646cff', fontSize: '1.2rem' }}>{trip.title}</h3>
        {isPast && <span style={{fontSize: '12px', background: '#444', color: '#ccc', padding: '3px 8px', borderRadius: '10px'}}>已封存</span>}
      </div>
      <div style={{color: '#aaa', fontSize: '14px', display:'flex', gap:'15px', alignItems:'center'}}>
        <span>📅 {trip.start_date} ~ {trip.end_date}</span>
        <span style={{background:'#2a2a2a', color:'#646cff', padding:'2px 8px', borderRadius:'10px', fontSize:'12px'}}>{trip.trip_days?.length || 0} 天</span>
      </div>
      <div style={{marginTop: '12px', fontSize: '14px', color: '#ddd'}}>
        📍 {trip.trip_destinations?.map(d => d.location_name).join(', ') || '尚未規劃地點'}
      </div>
    </div>
  )

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
        <div>
          <h1 style={{ margin: 0 }}>🌍 Journey Travel Planner</h1>
          <p style={{ color: '#aaa', margin: '5px 0 0 0' }}>{session?.user?.email} 的旅程</p>
          {isRefetching && <span style={{fontSize: '10px', color: '#646cff'}}>同步中...</span>}
        </div>
        <button onClick={handleLogout} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #444', borderRadius: '6px', fontSize: '12px' }}>登出</button>
      </div>

      <div style={{ marginBottom: '50px' }}>
        <h3 style={{ borderBottom: '2px solid #646cff', paddingBottom: '10px', margin: '0 0 20px 0' }}>🛫 我的旅行 ({upcomingTrips.length})</h3>
        {isLoading ? (
          <p>讀取中...</p>
        ) : upcomingTrips.length > 0 ? (
          upcomingTrips.map(trip => <TripCard key={trip.id} trip={trip} isPast={false} />)
        ) : (
          <div style={{ textAlign: 'center', padding: '60px', background: '#1e1e1e', borderRadius: '16px', color: '#888', border: '1px dashed #444' }}>還沒有即將出發的行程，點擊下方開始規劃！</div>
        )}
      </div>

      {pastTrips.length > 0 && (
        <div style={{ marginBottom: '100px' }}>
          <h3 style={{ borderBottom: '1px solid #444', paddingBottom: '10px', margin: '0 0 20px 0', color: '#888' }}>🗄️ 過去旅行 ({pastTrips.length})</h3>
          {pastTrips.map(trip => <TripCard key={trip.id} trip={trip} isPast={true} />)}
        </div>
      )}

      <div style={{ textAlign: 'center', position: 'relative', zIndex: 10 }}>
        <button onClick={() => setShowCreateModal(true)} style={{ padding: '16px 40px', fontSize: '1.1rem', background: 'linear-gradient(135deg, #646cff 0%, #535bf2 100%)', boxShadow: '0 8px 20px rgba(100, 108, 255, 0.3)' }}>✨ 開始規劃新旅行</button>
      </div>

      {showCreateModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: '#1e1e1e', padding: '40px', borderRadius: '24px', width: '90%', maxWidth: '550px', position: 'relative', border: '1px solid #333', animation: 'fadeIn 0.3s ease' }}>
            <button onClick={() => setShowCreateModal(false)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', fontSize: '28px', color: '#666' }}>×</button>
            <h2 style={{ marginTop: 0, textAlign: 'center', color: 'white' }}>✈️ 建立新旅程</h2>
            <div style={{borderBottom:'1px solid #333', margin:'20px 0'}}></div>
            <CreateTrip onTripCreated={handleTripCreated} userId={session?.user?.id} />
          </div>
        </div>
      )}
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}

// --- 主程式路由 (進入點加入 Provider) ---
export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div style={{height:'100vh', display:'flex', justifyContent:'center', alignItems:'center', background:'#121212', color:'white'}}>載入中...</div>

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={!session ? <Navigate to="/login" /> : <Home session={session} />} />
          <Route path="/login" element={<Login session={session} />} />
          <Route path="/trip/:tripId" element={!session ? <Navigate to="/login" /> : <TripDetails />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}