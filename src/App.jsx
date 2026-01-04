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
} from '@tanstack/react-query'
import CreateTrip from './CreateTrip'
import TripDetails from './TripDetails'

// 引入新元件
import ShareModal from './ShareModal.jsx'
import PublicTripDetails from './PublicTripDetails'

// 初始化 React Query 客戶端
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, 
      gcTime: 1000 * 60 * 60 * 24, 
      retry: 2, 
    },
  },
})

// --- 1. Login Page ---
function Login({ session }) {
  const navigate = useNavigate()
  useEffect(() => {
    if (session) navigate('/')
  }, [session, navigate])

  if (!session) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'transparent' }}>
        <div style={{ 
            width: '100%', maxWidth: '400px', padding: '40px', 
            background: 'rgba(255, 255, 255, 0.85)', 
            backdropFilter: 'blur(12px)', 
            borderRadius: '12px', 
            boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
            border: '1px solid rgba(255, 255, 255, 0.3)'
        }}>
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

// --- 2. Home Page ---
function Home({ session }) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingTrip, setEditingTrip] = useState(null)
  
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: trips = [], isLoading, isRefetching } = useQuery({
    queryKey: ['trips', session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trips')
        .select('*, trip_days(*), trip_destinations(*)')
        // ✨ 修正重點：這裡加入過濾條件，只撈取「擁有者」是自己的行程
        // 這樣別人的分享行程就不會出現在您的首頁列表了
        .eq('user_id', session?.user?.id) 
        .order('start_date', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!session?.user?.id, 
  })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const upcomingTrips = trips
    .filter(t => {
      const end = t.end_date ? new Date(t.end_date) : new Date(t.start_date)
      return end >= today
    })
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
  
  const pastTrips = trips
    .filter(t => {
      const end = t.end_date ? new Date(t.end_date) : new Date(t.start_date)
      return end < today
    })
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))

  const openCreateModal = () => { setEditingTrip(null); setShowCreateModal(true) }
  const openEditModal = (trip, e) => { e.stopPropagation(); setEditingTrip(trip); setShowCreateModal(true) }

  const handleTripCreated = () => { queryClient.invalidateQueries(['trips']); setShowCreateModal(false); setEditingTrip(null) }
  const handleTripDeleted = () => { queryClient.invalidateQueries(['trips']); setShowCreateModal(false); setEditingTrip(null) }
  const handleLogout = async () => { await supabase.auth.signOut(); queryClient.clear() }

  const TripCard = ({ trip, isPast }) => (
    <div 
      onClick={() => navigate(`/trip/${trip.id}`)}
      className="card"
      style={{ 
        cursor: 'pointer', 
        opacity: isPast ? 0.8 : 1, 
        borderLeft: isPast ? '4px solid #666' : '4px solid #646cff',
        position: 'relative',
        backgroundColor: isPast ? 'rgba(30, 30, 30, 0.6)' : 'rgba(40, 40, 40, 0.7)', 
        backdropFilter: 'blur(10px)', 
        marginBottom: '15px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        border: '1px solid rgba(255,255,255,0.1)', 
        color: '#eee' 
      }}
    >
      <button 
        onClick={(e) => openEditModal(trip, e)}
        style={{
          position: 'absolute', top: '15px', right: '15px',
          background: 'rgba(255,255,255,0.1)', border: '1px solid #666', borderRadius: '50%',
          width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: '#ccc', zIndex: 5
        }}
        title="編輯行程"
      >✎</button>

      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingRight: '40px'}}>
        <h3 style={{ margin: 0, color: isPast ? '#aaa' : '#8ab4f8', fontSize: '1.2rem' }}>{trip.title}</h3>
        {isPast && <span style={{fontSize: '12px', background: 'rgba(0,0,0,0.5)', color: '#ccc', padding: '3px 8px', borderRadius: '10px'}}>已封存</span>}
      </div>
      <div style={{color: isPast ? '#aaa' : '#ddd', fontSize: '14px', display:'flex', gap:'15px', alignItems:'center'}}>
        <span>📅 {trip.start_date} ~ {trip.end_date}</span>
        <span style={{background: 'rgba(255,255,255,0.1)', color: isPast ? '#aaa':'#8ab4f8', padding:'2px 8px', borderRadius:'10px', fontSize:'12px'}}>{trip.trip_days?.length || 0} 天</span>
      </div>
      <div style={{marginTop: '12px', fontSize: '14px', color: '#bbb'}}>
        📍 {trip.trip_destinations?.map(d => d.location_name).join(', ') || '尚未規劃地點'}
      </div>
    </div>
  )

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
        <div>
          <h1 style={{ margin: 0, color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.6)' }}>🌍 Journey Planner</h1>
          <p style={{ color: '#eee', margin: '5px 0 0 0', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>{session?.user?.email}</p>
          {isRefetching && <span style={{fontSize: '10px', color: '#8ab4f8'}}>同步中...</span>}
        </div>
        <button onClick={handleLogout} style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid #888', borderRadius: '6px', fontSize: '12px', color: 'white', backdropFilter: 'blur(4px)' }}>登出</button>
      </div>

      <div style={{ marginBottom: '50px' }}>
        <h3 style={{ borderBottom: '2px solid #646cff', paddingBottom: '10px', margin: '0 0 20px 0', color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>🛫 我的旅行 ({upcomingTrips.length})</h3>
        {isLoading ? (
          <p style={{color:'white'}}>讀取中...</p>
        ) : upcomingTrips.length > 0 ? (
          upcomingTrips.map(trip => <TripCard key={trip.id} trip={trip} isPast={false} />)
        ) : (
          <div style={{ textAlign: 'center', padding: '60px', background: 'rgba(30,30,30,0.5)', borderRadius: '16px', color: '#ddd', border: '1px dashed #666', backdropFilter: 'blur(5px)' }}>還沒有即將出發的行程，點擊下方開始規劃！</div>
        )}
      </div>

      {pastTrips.length > 0 && (
        <div style={{ marginBottom: '100px' }}>
          <h3 style={{ borderBottom: '1px solid #888', paddingBottom: '10px', margin: '0 0 20px 0', color: '#ccc', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>🗄️ 已封存 ({pastTrips.length})</h3>
          {pastTrips.map(trip => <TripCard key={trip.id} trip={trip} isPast={true} />)}
        </div>
      )}

      <div style={{ textAlign: 'center', position: 'relative', zIndex: 10 }}>
        <button onClick={openCreateModal} style={{ padding: '16px 40px', fontSize: '1.1rem', background: 'linear-gradient(135deg, #646cff 0%, #535bf2 100%)', boxShadow: '0 8px 25px rgba(0,0,0,0.3)', border:'none', color:'white', borderRadius:'30px' }}>✨ 開始規劃新旅行</button>
      </div>

      {showCreateModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: 'rgba(30, 30, 30, 0.9)', padding: '40px', borderRadius: '24px', width: '90%', maxWidth: '550px', position: 'relative', border: '1px solid #444', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)' }}>
            <button onClick={() => setShowCreateModal(false)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', fontSize: '28px', color: '#888' }}>×</button>
            <h2 style={{ marginTop: 0, textAlign: 'center', color: 'white' }}>
              {editingTrip ? '✏️ 編輯行程設定' : '✈️ 建立新旅程'}
            </h2>
            <div style={{borderBottom:'1px solid #444', margin:'20px 0'}}></div>
            <CreateTrip 
              userId={session?.user?.id}
              tripToEdit={editingTrip} 
              onTripCreated={handleTripCreated} 
              onTripDeleted={handleTripDeleted} 
            />
          </div>
        </div>
      )}
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}

// --- 3. 主程式路由 ---
export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bgImage, setBgImage] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })
    
    const savedBg = localStorage.getItem('custom_bg')
    if (savedBg) setBgImage(savedBg)

    return () => subscription.unsubscribe()
  }, [])

  const handleBgUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
        const result = reader.result
        setBgImage(result)
        localStorage.setItem('custom_bg', result)
    }
    reader.readAsDataURL(file)
  }

  const handleResetBg = () => {
      if(window.confirm('確定要恢復預設流動背景嗎？')) {
          setBgImage(null)
          localStorage.removeItem('custom_bg')
      }
  }

  if (loading) return <div style={{height:'100vh', display:'flex', justifyContent:'center', alignItems:'center', background:'#121212', color:'white'}}>載入中...</div>

  return (
    <QueryClientProvider client={queryClient}>
      {/* 全域背景層 */}
      <div className="global-background" style={{ backgroundImage: bgImage ? `url(${bgImage})` : 'none' }}>
          {!bgImage && (
              <>
                  <div className="shape shape-1"></div>
                  <div className="shape shape-2"></div>
                  <div className="shape shape-3"></div>
              </>
          )}
          <div className="noise-overlay"></div>
          <div className="dark-overlay"></div>  
      </div>

      {session && (
          <div className="bg-control">
              <label htmlFor="bg-upload-input" title="更換背景圖片">📷</label>
              <input id="bg-upload-input" type="file" accept="image/*" onChange={handleBgUpload} hidden />
              {bgImage && <button onClick={handleResetBg} title="恢復預設背景">↺</button>}
          </div>
      )}

      {/* CSS 設定：包含背景與形狀動畫 */}
      <style>{`
          .global-background {
              position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
              z-index: -1;
              background-color: #0a0a12;
              background-size: cover;
              background-position: center;
              overflow: hidden;
              transition: background-image 0.5s ease;
          }
          
          .dark-overlay {
              position: absolute; top: 0; left: 0; width: 100%; height: 100%;
              background: rgba(0, 0, 0, 0.4);
              backdrop-filter: blur(3px);
          }
          
          .noise-overlay {
              position: absolute; top: 0; left: 0; width: 100%; height: 100%;
              background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='4' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.05'/%3E%3C/svg%3E");
              pointer-events: none; z-index: 1;
          }

          .bg-control {
              position: fixed; bottom: 20px; right: 20px; z-index: 100;
              display: flex; flex-direction: column; gap: 10px;
          }
          .bg-control label, .bg-control button {
              width: 40px; height: 40px; border-radius: 50%;
              background: rgba(255,255,255,0.2);
              border: 1px solid rgba(255,255,255,0.3);
              backdrop-filter: blur(10px);
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; color: white; font-size: 18px;
              box-shadow: 0 4px 10px rgba(0,0,0,0.3);
              transition: transform 0.2s;
          }
          .bg-control label:hover, .bg-control button:hover { transform: scale(1.1); background: rgba(255,255,255,0.4); }

          .shape {
              position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.6;
              animation: float 20s infinite alternate;
          }
          .shape-1 { width: 60vw; height: 60vw; top: -10%; left: -10%; background: radial-gradient(circle, #4f46e5, transparent); }
          .shape-2 { width: 50vw; height: 50vw; bottom: -10%; right: -10%; background: radial-gradient(circle, #ec4899, transparent); animation-delay: -5s; }
          .shape-3 { width: 40vw; height: 40vw; bottom: 20%; left: 20%; background: radial-gradient(circle, #06b6d4, transparent); animation-delay: -10s; }
          
          @keyframes float { 
              0% { transform: translate(0, 0) scale(1); } 
              100% { transform: translate(10%, 10%) scale(1.1); } 
          }
      `}</style>

      <BrowserRouter>
        <Routes>
          <Route path="/" element={!session ? <Navigate to="/login" /> : <Home session={session} />} />
          <Route path="/login" element={<Login session={session} />} />
          <Route path="/trip/:tripId" element={!session ? <Navigate to="/login" /> : <TripDetails />} />
          <Route path="/share/:shareToken" element={<PublicTripDetails />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}