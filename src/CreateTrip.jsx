import { useState } from 'react'
import { supabase } from './supabaseClient'

// ✨ 1. 在 props 中接收 userId
export default function CreateTrip({ onTripCreated, userId }) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    startDate: '',
    endDate: '',
    budget: '',
    destinations: '',
    companions: '' 
  })

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      // ✨ 2. 建立 Trip 時加入 user_id
      const { data: tripData, error: tripError } = await supabase
        .from('trips')
        .insert([{
          title: formData.title,
          start_date: formData.startDate,
          end_date: formData.endDate,
          budget_goal: formData.budget ? parseFloat(formData.budget) : null,
          user_id: userId // 👈 這裡加入 user_id
        }])
        .select()
        .single()

      if (tripError) throw tripError
      const tripId = tripData.id

      // 2. 處理目的地
      if (formData.destinations) {
        const places = formData.destinations.split(/[,，]/).map(s => s.trim()).filter(s => s)
        if (places.length > 0) {
          const destinationRecords = places.map(place => ({
            trip_id: tripId,
            location_name: place,
            country_code: 'XX'
          }))
          await supabase.from('trip_destinations').insert(destinationRecords)
        }
      }

      // 3. 處理同行旅伴
      if (formData.companions) {
        const members = formData.companions.split(/[,，]/).map(s => s.trim()).filter(s => s)
        if (members.length > 0) {
          const memberRecords = members.map(name => ({
            trip_id: tripId,
            email: name, 
            role: 'editor'
          }))
          await supabase.from('trip_members').insert(memberRecords)
        }
      }

      // 4. 自動展開每日行程
      const start = new Date(formData.startDate)
      const end = new Date(formData.endDate)
      const diffTime = Math.abs(end - start)
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1 
      
      const dayRecords = []
      for (let i = 0; i < diffDays; i++) {
        const currentDayDate = new Date(start)
        currentDayDate.setDate(start.getDate() + i)
        dayRecords.push({
          trip_id: tripId,
          day_number: i + 1,
          day_date: currentDayDate.toISOString().split('T')[0],
          title: `Day ${i + 1}`
        })
      }
      
      const { error: daysError } = await supabase.from('trip_days').insert(dayRecords)
      if (daysError) throw daysError

      alert('🎉 旅行建立成功！')
      setFormData({ title: '', startDate: '', endDate: '', budget: '', destinations: '', companions: '' })
      if (onTripCreated) onTripCreated()
      
    } catch (error) {
      alert('錯誤: ' + error.message)
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '0 20px 20px 20px' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        
        {/* 第一列：標題 */}
        <div>
            <label style={{display:'block', marginBottom:'5px', fontSize:'14px', color:'#666'}}>旅行標題</label>
            <input name="title" placeholder="如: 東京五日遊" value={formData.title} onChange={handleChange} required style={{width:'100%', padding:'10px', fontSize:'16px', boxSizing:'border-box', borderRadius:'6px', border:'1px solid #ccc'}}/>
        </div>
        
        {/* 第二列：日期 */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{flex:1}}>
            <label style={{display:'block', marginBottom:'5px', fontSize:'14px', color:'#666'}}>開始日期</label>
            <input type="date" name="startDate" value={formData.startDate} onChange={handleChange} required style={{width:'100%', padding:'10px', boxSizing:'border-box', borderRadius:'6px', border:'1px solid #ccc'}}/>
          </div>
          <div style={{flex:1}}>
            <label style={{display:'block', marginBottom:'5px', fontSize:'14px', color:'#666'}}>結束日期</label>
            <input type="date" name="endDate" value={formData.endDate} onChange={handleChange} required style={{width:'100%', padding:'10px', boxSizing:'border-box', borderRadius:'6px', border:'1px solid #ccc'}}/>
          </div>
        </div>

        {/* 第三列：目的地與預算 */}
        <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{flex:2}}>
                <label style={{display:'block', marginBottom:'5px', fontSize:'14px', color:'#666'}}>目的地</label>
                <input name="destinations" placeholder="如: 大阪, 京都" value={formData.destinations} onChange={handleChange} style={{width:'100%', padding:'10px', boxSizing:'border-box', borderRadius:'6px', border:'1px solid #ccc'}}/>
            </div>
            <div style={{flex:1}}>
                <label style={{display:'block', marginBottom:'5px', fontSize:'14px', color:'#666'}}>預算 (TWD)</label>
                <input name="budget" type="number" placeholder="$" value={formData.budget} onChange={handleChange} style={{width:'100%', padding:'10px', boxSizing:'border-box', borderRadius:'6px', border:'1px solid #ccc'}}/>
            </div>
        </div>

        {/* 第四列：同行旅伴 */}
        <div>
            <label style={{display:'block', marginBottom:'5px', fontSize:'14px', color:'#666'}}>同行旅伴</label>
            <input 
            name="companions" 
            placeholder="用逗號分隔，例如: 小明, 小華" 
            value={formData.companions} 
            onChange={handleChange} 
            style={{width:'100%', padding:'10px', boxSizing:'border-box', borderRadius:'6px', border:'1px solid #ccc'}}
            />
        </div>

        <button type="submit" disabled={loading} style={{ width:'100%', padding: '12px', background: '#007bff', color: '#fff', border: 'none', borderRadius:'6px', cursor: 'pointer', fontSize:'16px', fontWeight:'bold', marginTop:'10px' }}>
          {loading ? '處理中...' : '開始規劃'}
        </button>
      </form>
    </div>
  )
}