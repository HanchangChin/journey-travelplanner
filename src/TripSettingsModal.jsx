import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

export default function TripSettingsModal({ trip, onClose, onUpdate }) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    budget: '',
    companions: '',
    is_24hr: true // ✨ 新增：預設 24 小時制
  })

  useEffect(() => {
    if (trip) {
      let initialCompanions = ''
      if (trip.trip_members && trip.trip_members.length > 0) {
        initialCompanions = trip.trip_members.map(m => m.email).join(', ')
      }

      setFormData({
        title: trip.title,
        budget: trip.budget_goal || '',
        companions: initialCompanions,
        is_24hr: trip.is_24hr ?? true // ✨ 讀取設定，如果沒有則預設 true
      })
    }
  }, [trip])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      // 1. 更新 Trips 基本資料
      const { error: tripError } = await supabase
        .from('trips')
        .update({
          title: formData.title,
          budget_goal: formData.budget ? parseFloat(formData.budget) : null,
          is_24hr: formData.is_24hr // ✨ 儲存時間格式設定
        })
        .eq('id', trip.id)

      if (tripError) throw tripError

      // 2. 更新旅伴 (先刪後加策略)
      await supabase.from('trip_members').delete().eq('trip_id', trip.id)

      if (formData.companions) {
        const members = formData.companions.split(/[,，]/).map(s => s.trim()).filter(s => s)
        const memberRecords = members.map(name => ({
          trip_id: trip.id,
          email: name,
          role: 'editor'
        }))
        await supabase.from('trip_members').insert(memberRecords)
      }

      alert('✅ 設定已更新！')
      onUpdate()
      onClose()
    } catch (error) {
      alert('更新失敗: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000
    }}>
      <div style={{ background: 'white', padding: '30px', borderRadius: '12px', width: '400px', maxWidth: '90%' }}>
        <h2 style={{ marginTop: 0 }}>⚙️ 旅行設定</h2>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label style={{display:'block', marginBottom:'5px', fontWeight:'bold'}}>旅行標題</label>
            <input 
              value={formData.title} 
              onChange={e => setFormData({...formData, title: e.target.value})}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', border:'1px solid #ccc', borderRadius:'4px' }}
            />
          </div>

          <div>
            <label style={{display:'block', marginBottom:'5px', fontWeight:'bold'}}>預算 (TWD)</label>
            <input 
              type="number"
              value={formData.budget} 
              onChange={e => setFormData({...formData, budget: e.target.value})}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', border:'1px solid #ccc', borderRadius:'4px' }}
            />
          </div>

          <div>
            <label style={{display:'block', marginBottom:'5px', fontWeight:'bold'}}>同行旅伴</label>
            <input 
              value={formData.companions} 
              onChange={e => setFormData({...formData, companions: e.target.value})}
              placeholder="小明, 小華"
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', border:'1px solid #ccc', borderRadius:'4px' }}
            />
            <small style={{color:'#666'}}>使用逗號分隔多人</small>
          </div>

          {/* ✨ 時間格式設定開關 */}
          <div style={{ background: '#f8f9fa', padding: '10px', borderRadius: '6px', border: '1px solid #eee' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>🕒 時間顯示格式</label>
            <div style={{ display: 'flex', gap: '15px' }}>
              <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <input 
                  type="radio" 
                  checked={formData.is_24hr === true} 
                  onChange={() => setFormData({...formData, is_24hr: true})}
                />
                <span style={{ marginLeft: '5px' }}>24 小時制 (14:00)</span>
              </label>
              <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <input 
                  type="radio" 
                  checked={formData.is_24hr === false} 
                  onChange={() => setFormData({...formData, is_24hr: false})}
                />
                <span style={{ marginLeft: '5px' }}>12 小時制 (下午 2:00)</span>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', cursor: 'pointer', background: '#ccc', border: 'none', borderRadius: '6px' }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 1, padding: '10px', cursor: 'pointer', background: '#007bff', color: 'white', border: 'none', borderRadius: '6px' }}>儲存</button>
          </div>
        </form>
      </div>
    </div>
  )
}