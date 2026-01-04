import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function ShareModal({ trip, onClose, onUpdate }) {
  const [loading, setLoading] = useState(false)
  const [isPublic, setIsPublic] = useState(!!trip.share_token)
  
  // 產生分享連結 (假設網域是 localhost 或 vercel app)
  const shareUrl = `${window.location.origin}/share/${trip.share_token || ''}`

  const toggleShare = async () => {
    setLoading(true)
    try {
      let newToken = null
      
      // 如果原本是不公開，現在要公開 -> 產生 UUID
      if (!isPublic) {
        newToken = crypto.randomUUID()
      } 
      // 如果原本是公開，現在要關閉 -> 設為 NULL
      
      const { error } = await supabase
        .from('trips')
        .update({ share_token: newToken })
        .eq('id', trip.id)

      if (error) throw error
      
      setIsPublic(!isPublic)
      onUpdate() // 通知父元件更新資料
    } catch (error) {
      alert('設定失敗: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl)
    alert('📋 連結已複製！')
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(5px)'
    }}>
      <div style={{
        background: 'rgba(30, 30, 30, 0.95)', color: 'white',
        padding: '30px', borderRadius: '20px', width: '90%', maxWidth: '400px',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
      }}>
        <h3 style={{marginTop:0, textAlign:'center'}}>🔗 分享行程</h3>
        
        <div style={{textAlign:'center', margin:'20px 0'}}>
          <p style={{color:'#aaa', fontSize:'14px'}}>
            {isPublic ? '此行程目前是公開的，任何人擁有連結皆可查看。' : '此行程目前是私密的，只有您與協作者可見。'}
          </p>
          
          <button 
            onClick={toggleShare} 
            disabled={loading}
            style={{
              padding: '10px 20px', borderRadius: '30px', border:'none',
              background: isPublic ? '#dc3545' : '#28a745', color:'white',
              fontSize:'16px', fontWeight:'bold', cursor:'pointer',
              boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
            }}
          >
            {loading ? '處理中...' : (isPublic ? '🔒 關閉分享' : '🌍 開啟公開連結')}
          </button>
        </div>

        {isPublic && (
          <div style={{background:'rgba(255,255,255,0.1)', padding:'15px', borderRadius:'10px', marginTop:'20px'}}>
            <div style={{fontSize:'12px', color:'#aaa', marginBottom:'5px'}}>公開連結：</div>
            <div style={{display:'flex', gap:'10px'}}>
              <input readOnly value={shareUrl} style={{flex:1, background:'rgba(0,0,0,0.3)', border:'none', color:'#fff', padding:'8px', borderRadius:'6px', fontSize:'13px'}} />
              <button onClick={copyLink} style={{background:'#007bff', color:'white', border:'none', borderRadius:'6px', padding:'0 15px', cursor:'pointer'}}>複製</button>
            </div>
          </div>
        )}

        <button onClick={onClose} style={{width:'100%', marginTop:'20px', padding:'12px', background:'transparent', border:'1px solid #555', color:'#aaa', borderRadius:'10px', cursor:'pointer'}}>關閉</button>
      </div>
    </div>
  )
}