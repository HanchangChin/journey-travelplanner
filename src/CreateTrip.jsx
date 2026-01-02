import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

export default function CreateTrip({ onTripCreated, userId, tripToEdit = null, onTripDeleted }) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    startDate: '',
    endDate: '',
    budget: '',
    destinations: '',
    companions: '' 
  })

  // 1. 資料回填邏輯 (確認編輯模式)
  useEffect(() => {
    if (tripToEdit) {
      setFormData({
        title: tripToEdit.title || '',
        startDate: tripToEdit.start_date || '',
        endDate: tripToEdit.end_date || '',
        budget: tripToEdit.budget_goal ? tripToEdit.budget_goal.toString() : '',
        destinations: tripToEdit.trip_destinations?.map(d => d.location_name).join(', ') || '',
        companions: tripToEdit.trip_members?.map(m => m.email).join(', ') || ''
      })
    } else {
      setFormData({ title: '', startDate: '', endDate: '', budget: '', destinations: '', companions: '' })
    }
  }, [tripToEdit])

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  // 2. 刪除邏輯
  const handleDelete = async () => {
    if (!window.confirm('確定要刪除這個行程嗎？此動作無法復原。')) return

    setLoading(true)
    try {
      const { error } = await supabase.from('trips').delete().eq('id', tripToEdit.id)
      if (error) throw error
      alert('🗑️ 行程已刪除')
      if (onTripDeleted) onTripDeleted() 
    } catch (error) {
      alert('刪除失敗: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // 3. 提交邏輯 (包含新增與編輯)
  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (tripToEdit) {
        // --- 🅰️ 編輯模式 (Edit Mode) ---
        // 這裡只更新 trips 表的欄位，不更動目的地與旅伴，以免破壞關聯資料
        const { error: updateError } = await supabase
          .from('trips')
          .update({
            title: formData.title,
            start_date: formData.startDate,
            end_date: formData.endDate,
            budget_goal: formData.budget ? parseFloat(formData.budget) : null,
          })
          .eq('id', tripToEdit.id)

        if (updateError) throw updateError
        alert('✅ 行程更新成功！')
        if (onTripCreated) onTripCreated()

      } else {
        // --- 🅱️ 建立模式 (Create Mode) ---
        const { data: tripData, error: tripError } = await supabase
          .from('trips')
          .insert([{
            title: formData.title,
            start_date: formData.startDate,
            end_date: formData.endDate,
            budget_goal: formData.budget ? parseFloat(formData.budget) : null,
            user_id: userId
          }])
          .select()
          .single()

        if (tripError) throw tripError
        const tripId = tripData.id

        // 處理目的地
        if (formData.destinations) {
          const places = formData.destinations.split(/[,，]/).map(s => s.trim()).filter(s => s)
          if (places.length > 0) {
            const destinationRecords = places.map(place => ({ trip_id: tripId, location_name: place, country_code: 'XX' }))
            await supabase.from('trip_destinations').insert(destinationRecords)
          }
        }

        // 處理同行旅伴
        if (formData.companions) {
          const members = formData.companions.split(/[,，]/).map(s => s.trim()).filter(s => s)
          if (members.length > 0) {
            const memberRecords = members.map(name => ({ trip_id: tripId, email: name, role: 'editor' }))
            await supabase.from('trip_members').insert(memberRecords)
          }
        }

        // 自動展開每日行程
        const start = new Date(formData.startDate)
        const end = new Date(formData.endDate)
        const diffTime = Math.abs(end - start)
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1 
        
        const dayRecords = []
        for (let i = 0; i < diffDays; i++) {
          const currentDayDate = new Date(start)
          currentDayDate.setDate(start.getDate() + i)
          dayRecords.push({ trip_id: tripId, day_number: i + 1, day_date: currentDayDate.toISOString().split('T')[0], title: `Day ${i + 1}` })
        }
        
        const { error: daysError } = await supabase.from('trip_days').insert(dayRecords)
        if (daysError) throw daysError

        alert('🎉 旅行建立成功！')
        setFormData({ title: '', startDate: '', endDate: '', budget: '', destinations: '', companions: '' })
        if (onTripCreated) onTripCreated()
      }

    } catch (error) {
      alert('錯誤: ' + error.message)
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="form-container">
      {/* ✨ CSS 樣式：響應式設計 + 防止自動縮放 */}
      <style>{`
        .form-container {
          padding: 0 10px 20px 10px;
          max-width: 800px;
          margin: 0 auto;
        }
        .form-group {
          margin-bottom: 15px;
        }
        /* 電腦版並排，手機版自動垂直 */
        .form-row {
          display: flex;
          gap: 15px;
        }
        .form-col {
          flex: 1;
        }
        label {
          display: block;
          margin-bottom: 6px;
          font-size: 14px;
          color: #888;
        }
        /* ✨ 關鍵修正：Font-size 16px 防止 iOS/Xcode 自動放大 */
        input {
          width: 100%;
          padding: 12px;
          font-size: 16px; 
          box-sizing: border-box;
          border-radius: 8px;
          border: 1px solid #444; 
          background-color: #2a2a2a; 
          color: white;
          outline: none;
          transition: border-color 0.2s;
        }
        input:focus {
          border-color: #646cff;
        }
        /* 唯讀欄位的樣式 */
        input:disabled {
          background-color: #1a1a1a;
          color: #666;
          border-color: #333;
          cursor: not-allowed;
        }
        
        /* 按鈕樣式 */
        .btn {
          width: 100%;
          padding: 14px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .btn:active { opacity: 0.8; }
        .btn-primary { background: linear-gradient(135deg, #646cff 0%, #535bf2 100%); color: white; }
        .btn-danger { background: #d32f2f; color: white; }
        .btn-group { display: flex; gap: 10px; margin-top: 20px; }

        /* 📱 手機版 RWD 設定 (小於 600px) */
        @media (max-width: 600px) {
          .form-row {
            flex-direction: column; /* 垂直堆疊 */
            gap: 15px;
          }
          .form-container {
            padding: 0;
          }
        }
      `}</style>

      <form onSubmit={handleSubmit}>
        
        {/* 第一列：標題 */}
        <div className="form-group">
            <label>旅行標題</label>
            <input name="title" placeholder="如: 東京五日遊" value={formData.title} onChange={handleChange} required />
        </div>
        
        {/* 第二列：日期 */}
        <div className="form-group form-row">
          <div className="form-col">
            <label>開始日期</label>
            <input type="date" name="startDate" value={formData.startDate} onChange={handleChange} required />
          </div>
          <div className="form-col">
            <label>結束日期</label>
            <input type="date" name="endDate" value={formData.endDate} onChange={handleChange} required />
          </div>
        </div>

        {/* 第三列：目的地與預算 */}
        <div className="form-group form-row">
            <div className="form-col" style={{ flex: 2 }}>
                <label>目的地 {tripToEdit && <span style={{fontSize:'12px', color:'#d32f2f'}}>(編輯模式下鎖定)</span>}</label>
                <input 
                  name="destinations" 
                  placeholder="如: 大阪, 京都" 
                  value={formData.destinations} 
                  onChange={handleChange} 
                  disabled={!!tripToEdit}
                  title={tripToEdit ? "請在詳細行程頁面管理地點" : ""}
                />
            </div>
            <div className="form-col" style={{ flex: 1 }}>
                <label>預算 (TWD)</label>
                <input name="budget" type="number" placeholder="$" value={formData.budget} onChange={handleChange} />
            </div>
        </div>

        {/* 第四列：同行旅伴 */}
        <div className="form-group">
            <label>同行旅伴 {tripToEdit && <span style={{fontSize:'12px', color:'#d32f2f'}}>(編輯模式下鎖定)</span>}</label>
            <input 
              name="companions" 
              placeholder="用逗號分隔，例如: 小明, 小華" 
              value={formData.companions} 
              onChange={handleChange} 
              disabled={!!tripToEdit} 
              title={tripToEdit ? "請在詳細行程頁面管理旅伴" : ""}
            />
        </div>

        {/* 按鈕區域 */}
        <div className="btn-group">
            {tripToEdit && (
                <button 
                    type="button" 
                    onClick={handleDelete}
                    disabled={loading}
                    className="btn btn-danger"
                    style={{ flex: 1 }}
                >
                    {loading ? '...' : '刪除行程'}
                </button>
            )}
            
            <button 
                type="submit" 
                disabled={loading} 
                className="btn btn-primary"
                style={{ flex: 2 }}
            >
                {loading ? '處理中...' : (tripToEdit ? '儲存變更' : '開始規劃')}
            </button>
        </div>
      </form>
    </div>
  )
}