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
    <div className="settings-modal-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000
    }}>
      <style>{`
        .settings-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 3000;
        }
        
        .settings-modal-content {
          background: #ffffff;
          color: #333333;
          padding: 30px;
          border-radius: 12px;
          width: 400px;
          max-width: 90%;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }
        
        .settings-modal-content h2 {
          margin-top: 0;
          color: #333333;
        }
        
        .settings-modal-content label {
          color: #333333;
        }
        
        .settings-modal-content input[type="text"],
        .settings-modal-content input[type="number"] {
          background: #ffffff;
          color: #333333;
          border: 1px solid #cccccc;
        }
        
        .settings-modal-content small {
          color: #666666;
        }
        
        .settings-modal-content .time-format-section {
          background: #f8f9fa;
          border: 1px solid #eeeeee;
        }
        
        .settings-modal-content .time-format-section label {
          color: #333333;
        }
        
        .settings-modal-content .btn-cancel {
          background: #cccccc;
          color: #333333;
        }
        
        @media (prefers-color-scheme: dark) {
          .settings-modal-content {
            background: #1e293b;
            color: #f1f5f9;
          }
          
          .settings-modal-content h2 {
            color: #f1f5f9;
          }
          
          .settings-modal-content label {
            color: #f1f5f9;
          }
          
          .settings-modal-content input[type="text"],
          .settings-modal-content input[type="number"] {
            background: #334155;
            color: #f1f5f9;
            border: 1px solid #475569;
          }
          
          .settings-modal-content input[type="text"]:focus,
          .settings-modal-content input[type="number"]:focus {
            outline: none;
            border-color: #3b82f6;
          }
          
          .settings-modal-content small {
            color: #cbd5e1;
          }
          
          .settings-modal-content .time-format-section {
            background: #334155;
            border: 1px solid #475569;
          }
          
          .settings-modal-content .time-format-section label {
            color: #f1f5f9;
          }
          
          .settings-modal-content .time-format-section span {
            color: #f1f5f9;
          }
          
          .settings-modal-content .btn-cancel {
            background: #475569;
            color: #f1f5f9;
          }
          
          .settings-modal-content .btn-cancel:hover {
            background: #64748b;
          }
        }
      `}</style>
      <div className="settings-modal-content">
        <h2>⚙️ 旅行設定</h2>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label style={{display:'block', marginBottom:'5px', fontWeight:'bold'}}>旅行標題</label>
            <input 
              value={formData.title} 
              onChange={e => setFormData({...formData, title: e.target.value})}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius:'4px' }}
            />
          </div>

          <div>
            <label style={{display:'block', marginBottom:'5px', fontWeight:'bold'}}>預算 (TWD)</label>
            <input 
              type="number"
              value={formData.budget} 
              onChange={e => setFormData({...formData, budget: e.target.value})}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius:'4px' }}
            />
          </div>

          <div>
            <label style={{display:'block', marginBottom:'5px', fontWeight:'bold'}}>同行旅伴</label>
            <input 
              value={formData.companions} 
              onChange={e => setFormData({...formData, companions: e.target.value})}
              placeholder="小明, 小華"
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius:'4px' }}
            />
            <small>使用逗號分隔多人</small>
          </div>

          {/* ✨ 時間格式設定開關 */}
          <div className="time-format-section" style={{ padding: '10px', borderRadius: '6px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>🕒 時間顯示格式</label>
            <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
              <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <input 
                  type="radio" 
                  checked={formData.is_24hr === true} 
                  onChange={() => setFormData({...formData, is_24hr: true})}
                  style={{ marginRight: '5px' }}
                />
                <span>24 小時制 (14:00)</span>
              </label>
              <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <input 
                  type="radio" 
                  checked={formData.is_24hr === false} 
                  onChange={() => setFormData({...formData, is_24hr: false})}
                  style={{ marginRight: '5px' }}
                />
                <span>12 小時制 (下午 2:00)</span>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button type="button" onClick={onClose} className="btn-cancel" style={{ flex: 1, padding: '10px', cursor: 'pointer', border: 'none', borderRadius: '6px', fontWeight: 'bold' }}>取消</button>
            <button type="submit" disabled={loading} style={{ flex: 1, padding: '10px', cursor: loading ? 'not-allowed' : 'pointer', background: '#007bff', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', opacity: loading ? 0.6 : 1 }}>儲存</button>
          </div>
        </form>
      </div>
    </div>
  )
}