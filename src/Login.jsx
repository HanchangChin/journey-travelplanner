import { useEffect } from 'react'
import { supabase } from './supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { useNavigate } from 'react-router-dom'

export default function Login({ session }) {
  const navigate = useNavigate()

  useEffect(() => {
    // 如果已經登入，踢回首頁
    if (session) {
      navigate('/')
    }
  }, [session, navigate])

  if (!session) {
    return (
      <div style={{ 
        display: 'flex', justifyContent: 'center', alignItems: 'center', 
        height: '100vh', background: '#f5f5f5' 
      }}>
        <div style={{ 
          width: '100%', maxWidth: '400px', padding: '40px', 
          background: 'white', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' 
        }}>
          <h2 style={{textAlign:'center', marginBottom:'20px'}}>🌍 歡迎回來</h2>
          <Auth 
            supabaseClient={supabase} 
            appearance={{ theme: ThemeSupa }} 
            providers={[]} // 這裡可以填 ['google'] 如果你有設 Google 登入
            theme="light"
          />
        </div>
      </div>
    )
  }
  
  return null
}