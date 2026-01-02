import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { Autocomplete } from '@react-google-maps/api'

export default function EditItemModal({ tripId, dayId, days = [], itemToEdit, onClose, onSave, tripMembers = [], is24hr = true, isLoaded, currentItemsCount = 0 }) {
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [autocompleteDep, setAutocompleteDep] = useState(null)
  const [autocompleteArr, setAutocompleteArr] = useState(null)
  const [autocompleteHotel, setAutocompleteHotel] = useState(null)
  
  const [formData, setFormData] = useState({
    name: '', category: 'activity', start_time: '', end_time: '',
    location_name: '', google_place_id: '', 
    address: '', phone: '', website: '', 
    rating: '', cost: '', notes: '',
    opening_hours: '',
    attachment_url: '', 
    attachment_type: ''
  })

  const [details, setDetails] = useState({
    sub_type: 'flight_train', company: '', vehicle_number: '', travelers: [], 
    departure_terminal: '', arrival_terminal: '', dep_offset: null, arr_offset: null, duration_text: '', arrival_day_offset: 0,
    checkin_time: '', checkin_counter: '', lounge_name: '', arrival_location: '', 
    distance_text: '', google_duration: 0, buffer_time: 0,
    checkin_date: '', checkout_date: '', agent: '', phone: '', currency: 'TWD', is_paid: false
  })

  // --- 初始化 Effect ---
  useEffect(() => {
    if (itemToEdit) {
      let formattedHours = ''
      if (itemToEdit.opening_hours) {
          if (typeof itemToEdit.opening_hours === 'object' && itemToEdit.opening_hours.text) formattedHours = itemToEdit.opening_hours.text 
          else if (typeof itemToEdit.opening_hours === 'string') formattedHours = itemToEdit.opening_hours
      }
      setFormData({
        name: itemToEdit.name || '', category: itemToEdit.category || 'activity',
        start_time: itemToEdit.start_time || '', end_time: itemToEdit.end_time || '',
        location_name: itemToEdit.location_name || '', google_place_id: itemToEdit.google_place_id || '',
        address: itemToEdit.address || '', phone: itemToEdit.phone || '', website: itemToEdit.website || '', 
        opening_hours: formattedHours, rating: itemToEdit.rating || '', cost: itemToEdit.cost || '', notes: itemToEdit.notes || '',
        attachment_url: itemToEdit.attachment_url || '',
        attachment_type: itemToEdit.attachment_type || ''
      })
      const savedDetails = itemToEdit.category === 'transport' ? itemToEdit.transport_details : itemToEdit.accommodation_details
      if (savedDetails) setDetails(prev => ({ ...prev, ...savedDetails }))
    } else {
      setFormData({
        name: '', category: 'activity', start_time: '', end_time: '',
        location_name: '', google_place_id: '', address: '', phone: '', website: '', 
        rating: '', cost: '', notes: '', opening_hours: '',
        attachment_url: '', attachment_type: ''
      })
      setDetails({
        sub_type: 'flight_train', company: '', vehicle_number: '', travelers: tripMembers.length > 0 ? [{ name: tripMembers[0].email, seat: '', booking_ref: '', cost: '' }] : [],
        departure_terminal: '', arrival_terminal: '', dep_offset: null, arr_offset: null, duration_text: '', arrival_day_offset: 0,
        checkin_time: '', checkin_counter: '', lounge_name: '', arrival_location: '', 
        distance_text: '', google_duration: 0, buffer_time: 0,
        checkin_date: '', checkout_date: '', agent: '', phone: '', currency: 'TWD', is_paid: false
      })
      const currentDayObj = days.find(d => d.id === dayId)
      if (currentDayObj) setDetails(prev => ({ ...prev, checkin_date: currentDayObj.day_date }))
    }
  }, [itemToEdit, tripMembers, dayId, days])

  // --- 自動計算 (交通) ---
  useEffect(() => { 
    if (formData.category !== 'transport') return
    if (details.sub_type === 'flight_train') calculateDurationFlight() 
    else if (details.sub_type === 'car_bus') calculateEndTimeCar()
  }, [formData.start_time, formData.end_time, details.dep_offset, details.arr_offset, details.arrival_day_offset, details.google_duration, details.buffer_time, details.sub_type, formData.category])

  useEffect(() => {
      if (formData.category === 'transport' && formData.location_name && details.arrival_location) {
          if (details.sub_type === 'car_bus') {
              calculateRoute(formData.location_name, details.arrival_location)
          } else if (details.sub_type === 'public') {
              calculateTransitRoute(formData.location_name, details.arrival_location, formData.start_time)
          }
      }
  }, [formData.location_name, details.arrival_location, details.sub_type, formData.category])

  const calculateDurationFlight = () => {
    const { start_time, end_time } = formData
    if (!start_time || !end_time) { setDetails(prev => ({ ...prev, duration_text: '' })); return }
    const [sH, sM] = start_time.split(':').map(Number); const [eH, eM] = end_time.split(':').map(Number)
    const startMinsLocal = sH * 60 + sM; const endMinsLocal = eH * 60 + eM
    const offsetMins = (details.arrival_day_offset || 0) * 24 * 60
    const dOff = details.dep_offset !== null ? details.dep_offset : 0
    const aOff = details.arr_offset !== null ? details.arr_offset : 0
    const startMinsUTC = startMinsLocal - dOff; const endMinsUTC = (endMinsLocal + offsetMins) - aOff
    let diff = endMinsUTC - startMinsUTC
    const h = Math.floor(diff / 60); const m = diff % 60
    if (h < 0) { setDetails(prev => ({ ...prev, duration_text: '' })); return }
    const isAuto = (details.dep_offset !== null && details.arr_offset !== null) ? '🤖 ' : ''
    setDetails(prev => ({ ...prev, duration_text: `${isAuto}${h}h ${m}m` }))
  }

  const calculateEndTimeCar = () => {
      const totalMins = (details.google_duration || 0) + (parseInt(details.buffer_time) || 0)
      if (totalMins > 0) {
          const h = Math.floor(totalMins / 60); const m = Math.floor(totalMins % 60)
          setDetails(prev => ({ ...prev, duration_text: `🚗 ${h}h ${m}m` }))
      }
  }

  const calculateRoute = async (dep, arr) => {
      if (!isLoaded || !window.google) return
      const directionsService = new window.google.maps.DirectionsService()
      directionsService.route({ origin: dep, destination: arr, travelMode: window.google.maps.TravelMode.DRIVING }, (result, status) => {
          if (status === window.google.maps.DirectionsStatus.OK) {
              const leg = result.routes[0].legs[0]
              setDetails(prev => ({ ...prev, distance_text: leg.distance.text, google_duration: Math.ceil(leg.duration.value / 60) }))
          }
      })
  }

  const calculateTransitRoute = (origin, destination, depTimeStr) => {
      if (!isLoaded || !window.google) return;
      const directionsService = new window.google.maps.DirectionsService();
      directionsService.route({
          origin: origin, destination: destination, travelMode: window.google.maps.TravelMode.TRANSIT,
      }, (result, status) => {
          if (status === window.google.maps.DirectionsStatus.OK) { processRouteResult(result, depTimeStr, 'TRANSIT'); }
          else {
              console.warn("Transit failed, trying WALKING...");
              directionsService.route({ origin, destination, travelMode: window.google.maps.TravelMode.WALKING }, (resW, statW) => {
                  if (statW === window.google.maps.DirectionsStatus.OK) processRouteResult(resW, depTimeStr, 'WALKING');
              });
          }
      });
  }

  const processRouteResult = (result, depTimeStr, mode) => {
      const leg = result.routes[0].legs[0];
      const realMins = Math.ceil(leg.duration.value / 60);
      const buffMins = Math.ceil(realMins * 1.2); 
      const bufferValue = buffMins - realMins;

      setDetails(prev => ({
          ...prev, distance_text: leg.distance.text, google_duration: realMins,
          buffer_time: bufferValue,
          duration_text: `${mode === 'WALKING' ? '🚶' : '🚌'} ${Math.floor(buffMins/60)}h ${buffMins%60}m`
      }));
      const startTime = depTimeStr || formData.start_time;
      if (startTime) {
          const [h, m] = startTime.split(':').map(Number);
          const date = new Date(); date.setHours(h); date.setMinutes(m + buffMins);
          const newH = date.getHours().toString().padStart(2, '0'); const newM = date.getMinutes().toString().padStart(2, '0');
          setFormData(prev => ({ ...prev, end_time: `${newH}:${newM}` }));
          if (date.getHours() < h) setDetails(prev => ({...prev, arrival_day_offset: 1}));
      }
  }

  const applySuggestedTime = () => {
      if (!formData.start_time) return
      const totalMins = (details.google_duration || 0) + (parseInt(details.buffer_time) || 0)
      const [h, m] = formData.start_time.split(':').map(Number)
      const date = new Date(); date.setHours(h); date.setMinutes(m + totalMins)
      const newH = date.getHours().toString().padStart(2, '0'); const newM = date.getMinutes().toString().padStart(2, '0')
      setFormData(prev => ({ ...prev, end_time: `${newH}:${newM}` }))
      if (date.getHours() < h || (date.getHours() == h && date.getMinutes() < m)) { setDetails(prev => ({...prev, arrival_day_offset: 1})) } 
      else { setDetails(prev => ({...prev, arrival_day_offset: 0})) }
  }

  const handleFileUpload = async (event) => {
    try {
      setUploading(true)
      if (!event.target.files || event.target.files.length === 0) throw new Error('請選擇檔案')
      const file = event.target.files[0]
      const fileExt = file.name.split('.').pop()
      const fileName = `${tripId}_${Date.now()}.${fileExt}`
      const filePath = fileName

      const { error: uploadError } = await supabase.storage.from('TRIP-ATTACHMENT').upload(filePath, file)
      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('TRIP-ATTACHMENT').getPublicUrl(filePath)
      
      setFormData(prev => ({
          ...prev, attachment_url: data.publicUrl,
          attachment_type: file.type.startsWith('image/') ? 'image' : 'pdf'
      }))
    } catch (error) { 
        console.error(error);
        alert('上傳失敗: ' + error.message) 
    } finally { setUploading(false) }
  }

  const createArrivalItem = async () => {
    if (!days.length) { alert("⚠️ 無法讀取天數資料"); return }
    const currentIndex = days.findIndex(d => d.id === dayId)
    const targetIndex = currentIndex + details.arrival_day_offset
    if (targetIndex < days.length) {
        const targetDay = days[targetIndex]
        const arrivalPayload = {
            trip_id: tripId, trip_day_id: targetDay.id,
            name: formData.name, category: 'transport',
            location_name: details.arrival_location || formData.location_name,
            address: formData.address, website: formData.website,
            cost: formData.cost ? parseFloat(formData.cost) : 0, notes: formData.notes,
            start_time: formData.end_time || null, end_time: formData.end_time || null, 
            transport_details: { ...details, is_arrival_card: true, original_start_time: formData.start_time, arrival_day_offset: 0 },
            sort_order: 0
        }
        const { error } = await supabase.from('itinerary_items').insert([arrivalPayload])
        if (error) alert('❌ 建立失敗'); else { alert(`🎉 已在 Day ${targetDay.day_number} 複製抵達行程！`); onSave() }
    } else { alert("⚠️ 超出旅行日期範圍") }
  }

  const createDailyStays = async () => {
      if (!details.checkin_date || !details.checkout_date) return
      const start = new Date(details.checkin_date); const end = new Date(details.checkout_date)
      const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) 
      const startIndex = days.findIndex(d => d.day_date === details.checkin_date)
      if (startIndex === -1) return

      for (let i = 1; i < diffDays; i++) {
          const targetIndex = startIndex + i
          if (targetIndex >= days.length) break
          const targetDay = days[targetIndex]
          const stayPayload = {
              trip_id: tripId, trip_day_id: targetDay.id,
              name: `🏨 住宿: ${formData.name}`, category: 'accommodation',
              location_name: formData.location_name, address: formData.address,
              sort_order: 9000, 
              accommodation_details: { ...details, is_generated_stay: true }
          }
          await supabase.from('itinerary_items').insert([stayPayload])
      }
      alert(`🎉 已自動生成 ${diffDays - 1} 晚的續住行程！`)
  }

  const onDepPlaceChanged = () => {
    if (autocompleteDep) {
      const place = autocompleteDep.getPlace()
      if (['activity', 'food', 'other'].includes(formData.category)) {
          let hours = ''
          if (place.opening_hours && place.opening_hours.weekday_text) hours = place.opening_hours.weekday_text.join('\n')
          setFormData(prev => ({
              ...prev, location_name: place.name, name: prev.name || place.name, 
              address: place.formatted_address || '', phone: place.formatted_phone_number || '', 
              website: place.website || '', opening_hours: hours, rating: place.rating || '', google_place_id: place.place_id
          }))
      } else {
          setFormData(prev => ({ ...prev, location_name: place.name, name: prev.name || place.name }))
          if (place.utc_offset_minutes !== undefined) setDetails(prev => ({ ...prev, dep_offset: place.utc_offset_minutes }))
      }
    }
  }

  const onArrPlaceChanged = () => {
    if (autocompleteArr) {
      const place = autocompleteArr.getPlace()
      setDetails(prev => ({ ...prev, arrival_location: place.name, arr_offset: place.utc_offset_minutes !== undefined ? place.utc_offset_minutes : prev.arr_offset }))
    }
  }
  const onHotelPlaceChanged = () => {
    if (autocompleteHotel) {
      const place = autocompleteHotel.getPlace()
      setFormData(prev => ({ ...prev, location_name: place.name, name: prev.name || place.name, address: place.formatted_address, website: place.website, rating: place.rating, google_place_id: place.place_id }))
      if (place.formatted_phone_number) setDetails(prev => ({ ...prev, phone: place.formatted_phone_number }))
    }
  }

  const handleDelete = async () => {
    if (!itemToEdit) return
    if (!window.confirm('確定要刪除嗎？')) return
    setLoading(true)
    try {
      await supabase.from('itinerary_items').delete().eq('id', itemToEdit.id)
      onSave(); onClose()
    } catch (error) { alert('刪除失敗'); } finally { setLoading(false) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      let newSortOrder = 0;
      if (itemToEdit) {
          newSortOrder = itemToEdit.sort_order;
      } else {
          newSortOrder = formData.category === 'accommodation' ? 9000 : currentItemsCount + 1;
      }

      const payload = {
        trip_id: tripId, trip_day_id: dayId, ...formData,
        start_time: formData.start_time || null, 
        end_time: formData.end_time || null, 
        rating: formData.rating ? parseFloat(formData.rating) : null,
        cost: formData.cost ? parseFloat(formData.cost) : 0,
        opening_hours: formData.opening_hours ? { text: formData.opening_hours } : null,
        transport_details: formData.category === 'transport' ? details : null,
        accommodation_details: formData.category === 'accommodation' ? details : null,
        attachment_url: formData.attachment_url,
        attachment_type: formData.attachment_type,
        sort_order: newSortOrder
      }

      if (itemToEdit) {
        await supabase.from('itinerary_items').update(payload).eq('id', itemToEdit.id)
      } else {
        const { error } = await supabase.from('itinerary_items').insert([payload])
        if (error) throw error
        if (formData.category === 'transport' && details.arrival_day_offset > 0) await createArrivalItem()
        if (formData.category === 'accommodation' && details.checkin_date !== details.checkout_date) await createDailyStays()
      }
      onSave(); onClose()
    } catch (error) { alert('Error: ' + error.message) } finally { setLoading(false) }
  }

  const updateTraveler = (idx, field, val) => { const n=[...details.travelers]; n[idx][field]=val; setDetails({...details, travelers:n}) }
  const addTraveler = () => { setDetails(prev => ({ ...prev, travelers: [...prev.travelers, { name: '', seat: '', booking_ref: '', cost: '' }] })) }
  const removeTraveler = (idx) => { setDetails(prev => ({ ...prev, travelers: details.travelers.filter((_, i) => i !== idx) })) }

  const categories = [ { value: 'activity', label: '🎡 景點/活動' }, { value: 'food', label: '🍴 餐廳/美食' }, { value: 'accommodation', label: '🛏️ 住宿' }, { value: 'transport', label: '🚆 交通/航班' }, { value: 'note', label: '📝 筆記/檔案' }, { value: 'other', label: '📝 其他' } ]
  if (!isLoaded) return <div style={{padding:'20px'}}>Google Maps Loading...</div>

  return (
    <div className="modal-overlay">
      {/* ✨ CSS Styling Block */}
      <style>{`
        .modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0,0,0,0.6);
            display: flex; alignItems: center; justifyContent: center;
            z-index: 2000;
        }
        .modal-content {
            background: white; padding: 25px; borderRadius: 12px;
            width: 700px; maxWidth: 95%; maxHeight: 90vh; overflow-y: auto;
        }
        h2 { margin-top: 0; }
        
        /* 📱 Responsive Grid System */
        .form-row { display: flex; gap: 10px; margin-bottom: 10px; }
        .form-col { flex: 1; }
        .form-col-2 { flex: 2; }
        
        @media (max-width: 600px) {
            .form-row { flex-direction: column; gap: 10px; }
            .modal-content { padding: 15px; }
        }

        /* 📱 Mobile Input Zoom Prevention (Font size 16px) */
        input, select, textarea {
            width: 100%; padding: 10px;
            font-size: 16px; /* ✨ Key fix for iOS zoom */
            border: 1px solid #ccc; borderRadius: 6px;
            box-sizing: border-box;
        }

        label {
            font-size: 14px; color: #666; display: block;
            margin-bottom: 4px; fontWeight: bold;
        }
        
        .section-title {
            font-size: 14px; fontWeight: bold; color: #007bff;
            border-bottom: 1px solid #eee; padding-bottom: 5px; margin: 15px 0 10px 0;
        }
        
        .btn-group { display: flex; gap: 10px; margin-top: 15px; }
        .btn { flex: 1; padding: 12px; border: none; borderRadius: 6px; cursor: pointer; font-weight: bold; font-size: 16px; }
        .btn-save { background: #007bff; color: white; }
        .btn-cancel { background: #e0e0e0; color: #333; }
        .btn-delete { background: #dc3545; color: white; }
        
        .transport-options { display: flex; margin-bottom: 15px; border-bottom: 1px solid #ddd; }
        .transport-btn { flex: 1; padding: 10px; border: none; cursor: pointer; background: #f0f0f0; }
        .transport-btn.active { background: white; border-bottom: 2px solid #007bff; }
      `}</style>

      <div className="modal-content">
        <h2>{itemToEdit ? '✏️ 編輯行程' : '➕ 新增行程'}</h2>
        <form onSubmit={handleSubmit}>
          
          <div style={{ marginBottom: '10px' }}>
            <select value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {/* ================= 筆記模式 (Note) ================= */}
          {formData.category === 'note' && (
              <div style={{ background: '#fff9c4', padding: '15px', borderRadius: '8px', border: '1px solid #fff59d' }}>
                  <div className="section-title">📝 筆記與附件</div>
                  <div style={{marginBottom:'10px'}}>
                      <label>標題</label>
                      <input placeholder="標題 (例如: 電子機票)" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                  </div>
                  <div style={{marginBottom:'10px'}}>
                      <label>內容</label>
                      <textarea placeholder="輸入內容..." rows="4" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
                  </div>
                  <div>
                      <label>📎 附件 (圖片/PDF)</label>
                      <input type="file" accept="image/*,application/pdf" onChange={handleFileUpload} disabled={uploading} style={{marginTop:'5px'}} />
                      {uploading && <span style={{fontSize:'12px', color:'blue'}}> 上傳中...</span>}
                      {formData.attachment_url && (
                          <div style={{marginTop:'10px', padding:'10px', border:'1px solid #ddd', borderRadius:'6px', background:'white', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                              <a href={formData.attachment_url} target="_blank" rel="noreferrer" style={{textDecoration:'none', color:'#007bff', display:'flex', alignItems:'center', gap:'5px', fontSize:'14px'}}>
                                  <span style={{fontSize:'18px'}}>{formData.attachment_type === 'image' ? '🖼️' : '📄'}</span>
                                  <span>{formData.attachment_type === 'image' ? '已附加圖片 (點擊查看)' : '已附加 PDF (點擊查看)'}</span>
                              </a>
                              <button type="button" onClick={() => setFormData({...formData, attachment_url:'', attachment_type:''})} style={{color:'#dc3545', border:'1px solid #dc3545', background:'white', borderRadius:'4px', padding:'2px 8px', cursor:'pointer', fontSize:'12px'}}>🗑️ 移除</button>
                          </div>
                      )}
                  </div>
              </div>
          )}

          {/* ================= 交通區塊 ================= */}
          {formData.category === 'transport' && (
            <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #e9ecef' }}>
              <div className="transport-options">
                  <button type="button" onClick={() => setDetails({...details, sub_type:'flight_train'})} className={`transport-btn ${details.sub_type==='flight_train'?'active':''}`}>✈️ 航班/火車</button>
                  <button type="button" onClick={() => setDetails({...details, sub_type:'car_bus'})} className={`transport-btn ${details.sub_type==='car_bus'?'active':''}`}>🚗 自駕/接送</button>
                  <button type="button" onClick={() => setDetails({...details, sub_type:'public'})} className={`transport-btn ${details.sub_type==='public'?'active':''}`}>🚌 大眾運輸</button>
              </div>

              {details.sub_type !== 'public' && (
                  <div className="form-row">
                    <div className="form-col">
                        <label>{details.sub_type==='flight_train'?'公司':'租車/司機'}</label>
                        <input placeholder="名稱" value={details.company} onChange={e => setDetails({...details, company: e.target.value})} />
                    </div>
                    <div className="form-col">
                        <label>{details.sub_type==='flight_train'?'班次':'預約代號'}</label>
                        <input placeholder="編號" value={details.vehicle_number} onChange={e => setDetails({...details, vehicle_number: e.target.value})} />
                    </div>
                  </div>
              )}
              
              <div className="section-title">🛫 起訖點 (Google Route)</div>
              <div style={{marginBottom:'10px'}}>
                <label>📍 出發地點</label>
                <Autocomplete onLoad={setAutocompleteDep} onPlaceChanged={onDepPlaceChanged}><input placeholder="搜尋出發地" value={formData.location_name} onChange={e => setFormData({...formData, location_name: e.target.value})} /></Autocomplete>
                {details.sub_type === 'flight_train' && <input placeholder="出發航廈" value={details.departure_terminal} onChange={e => setDetails({...details, departure_terminal: e.target.value})} style={{marginTop:'5px'}} />}
              </div>
              <div style={{marginBottom:'10px'}}>
                <label>🏁 抵達地點</label>
                <Autocomplete onLoad={setAutocompleteArr} onPlaceChanged={onArrPlaceChanged}><input placeholder="搜尋抵達地" value={details.arrival_location} onChange={e => setDetails({...details, arrival_location: e.target.value})} /></Autocomplete>
                {details.sub_type === 'flight_train' && <input placeholder="抵達航廈" value={details.arrival_terminal} onChange={e => setDetails({...details, arrival_terminal: e.target.value})} style={{marginTop:'5px'}} />}
              </div>
              
              {(details.sub_type === 'car_bus' || details.sub_type === 'public') && (
                  <div style={{background: '#fff3cd', padding:'10px', borderRadius:'6px', marginBottom:'10px', border:'1px solid #ffeeba'}}>
                      <div style={{display:'flex', justifyContent:'space-between', fontSize:'13px', color:'#856404', fontWeight:'bold', marginBottom:'5px'}}>
                          <span>📏 {details.distance_text || '--'}</span>
                          <span>{details.sub_type==='public'?'🚌':'🚗'} Google: {details.google_duration ? Math.floor(details.google_duration) + ' min' : '--'}</span>
                      </div>
                      <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                          <label style={{color:'#856404', marginBottom:0}}>Buffer:</label>
                          <input type="number" placeholder="分" value={details.buffer_time} onChange={e => setDetails({...details, buffer_time: e.target.value})} style={{width:'80px'}} />
                      </div>
                  </div>
              )}

              <div style={{ background:'#e3f2fd', padding:'10px', borderRadius:'6px' }}>
                <div className="form-row">
                    <div className="form-col">
                        <label>出發時間</label>
                        <input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} />
                    </div>
                    <div className="form-col">
                         <label>抵達時間</label>
                         <div style={{display:'flex', gap:'5px'}}>
                             <input type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} style={{flex:1}} />
                             <select value={details.arrival_day_offset} onChange={e => setDetails({...details, arrival_day_offset: parseInt(e.target.value)})} style={{width:'80px'}}>
                                 <option value={0}>當日</option><option value={1}>+1</option><option value={2}>+2</option>
                             </select>
                         </div>
                         {(details.sub_type === 'car_bus' || details.sub_type === 'public') && details.google_duration > 0 && 
                            <button type="button" onClick={applySuggestedTime} style={{fontSize:'12px', width:'100%', marginTop:'5px', padding: '5px', background:'#28a745', color:'white', border:'none', borderRadius:'4px', cursor:'pointer'}}>套用建議時間</button>
                         }
                    </div>
                </div>
                <div>
                    <label>時長</label>
                    <input value={details.duration_text} onChange={e => setDetails({...details, duration_text: e.target.value})} style={{background:'white'}} />
                </div>
              </div>

              {details.arrival_day_offset > 0 && <button type="button" onClick={createArrivalItem} style={{width: '100%', marginTop: '10px', padding: '10px', background: '#e3f2fd', color: '#0056b3', border: '1px dashed #0056b3', borderRadius: '6px', cursor: 'pointer', fontWeight:'bold'}}>⬇️ 補救：生成抵達行程</button>}

              {details.sub_type !== 'public' && (
                <>
                  <div className="section-title">👥 同行旅伴</div>
                  {details.travelers.map((t, index) => (
                    <div key={index} className="form-row" style={{ alignItems: 'center' }}>
                      <div className="form-col-2">
                          <input list={`m-${index}`} placeholder="姓名" value={t.name} onChange={e => updateTraveler(index, 'name', e.target.value)} />
                          <datalist id={`m-${index}`}>{tripMembers.map(m => <option key={m.id} value={m.email} />)}</datalist>
                      </div>
                      <div className="form-col"><input placeholder={details.sub_type==='car_bus'?'備註':'代號'} value={t.booking_ref} onChange={e => updateTraveler(index, 'booking_ref', e.target.value)} /></div>
                      <div className="form-col"><input placeholder="座位" value={t.seat} onChange={e => updateTraveler(index, 'seat', e.target.value)} /></div>
                      <div className="form-col"><input placeholder="$" type="number" value={t.cost} onChange={e => updateTraveler(index, 'cost', e.target.value)} /></div>
                      <button type="button" onClick={() => removeTraveler(index)} style={{background:'#ff4d4f', color:'white', border:'none', borderRadius:'4px', width:'40px', height:'40px', fontSize:'20px', cursor:'pointer'}}>×</button>
                    </div>
                  ))}
                  <button type="button" onClick={addTraveler} style={{ marginTop: '5px', padding: '8px', background: '#fff', border: '1px dashed #007bff', color: '#007bff', borderRadius: '6px', cursor: 'pointer', width: '100%' }}>+ 新增旅伴</button>
                </>
              )}
            </div>
          )}

          {/* ================= 住宿區塊 ================= */}
          {formData.category === 'accommodation' && (
             <div style={{ background: '#fff5f0', padding: '15px', borderRadius: '8px', border: '1px solid #ffd6c2' }}>
                <div className="section-title">🏨 住宿詳情</div>
                <div style={{marginBottom:'10px'}}>
                    <label>📍 搜尋飯店</label>
                    <Autocomplete onLoad={setAutocompleteHotel} onPlaceChanged={onHotelPlaceChanged}><input placeholder="輸入名稱 (Google)" value={formData.location_name} onChange={e => setFormData({...formData, location_name: e.target.value})} /></Autocomplete>
                    <div className="form-row" style={{marginTop:'10px'}}>
                        <div className="form-col-2"><input placeholder="地址" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} /></div>
                        <div className="form-col"><input placeholder="電話" value={details.phone} onChange={e => setDetails({...details, phone: e.target.value})} /></div>
                    </div>
                    <input placeholder="網址" value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} style={{marginTop:'10px'}} />
                </div>
                <div className="form-row">
                    <div className="form-col" style={{background:'white', padding:'10px', borderRadius:'6px', border:'1px solid #eee'}}>
                        <label style={{color:'#e65100'}}>📥 Check-in</label>
                        <input type="date" value={details.checkin_date} onChange={e => setDetails({...details, checkin_date: e.target.value})} style={{marginBottom:'5px'}} />
                        <input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} />
                    </div>
                    <div className="form-col" style={{background:'white', padding:'10px', borderRadius:'6px', border:'1px solid #eee'}}>
                        <label style={{color:'#e65100'}}>📤 Check-out</label>
                        <input type="date" value={details.checkout_date} onChange={e => setDetails({...details, checkout_date: e.target.value})} style={{marginBottom:'5px'}} />
                        <input type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} />
                    </div>
                </div>
                <div className="form-row" style={{marginTop:'10px'}}>
                    <div className="form-col">
                        <input placeholder="Agent (Agoda...)" list="agents" value={details.agent} onChange={e => setDetails({...details, agent: e.target.value})} />
                        <datalist id="agents"><option value="Booking"/><option value="Agoda"/><option value="Airbnb"/></datalist>
                    </div>
                    <div className="form-col">
                        <div style={{display:'flex', gap:'5px'}}>
                             <input type="number" placeholder="$" value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} style={{flex:2}} />
                             <input placeholder="幣" value={details.currency} onChange={e => setDetails({...details, currency: e.target.value})} style={{flex:1}} />
                        </div>
                    </div>
                    <div className="form-col">
                         <select value={details.is_paid} onChange={e => setDetails({...details, is_paid: e.target.value === 'true'})} style={{color: details.is_paid ? '#28a745':'#dc3545', fontWeight:'bold'}}>
                             <option value="false">❌ 未付</option><option value="true">✅ 已付</option>
                         </select>
                    </div>
                </div>
             </div>
          )}

          {/* ================= 一般行程 ================= */}
          {!['transport', 'accommodation', 'note'].includes(formData.category) && (
            <>
               <div style={{ marginBottom: '10px' }}><input placeholder="名稱" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required /></div>
               <div style={{border: '1px solid #ccc', padding:'10px', borderRadius:'6px', marginBottom: '10px'}}>
                <label>📍 地點搜尋</label>
                <Autocomplete onLoad={setAutocompleteDep} onPlaceChanged={onDepPlaceChanged}>
                    <input placeholder="搜尋地點 (例如: 清水寺)" value={formData.location_name} onChange={e => setFormData({...formData, location_name: e.target.value})} />
                </Autocomplete>
                <input placeholder="地址" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} style={{marginTop:'10px', background:'#f9f9f9'}} />
                <div style={{marginTop:'10px'}}>
                    <div className="form-row">
                        <div className="form-col"><input placeholder="電話" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} /></div>
                        <div className="form-col"><input placeholder="官方網址" value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} /></div>
                    </div>
                    <div>
                        <label style={{fontSize:'12px', color:'#666', marginBottom:'2px'}}>🕒 營業時間</label>
                        <textarea placeholder="自動抓取營業時間，或手動輸入" rows="4" value={formData.opening_hours} onChange={e => setFormData({...formData, opening_hours: e.target.value})} style={{fontFamily:'monospace', fontSize:'12px', resize:'vertical'}} />
                    </div>
                </div>
               </div>
               <div className="form-row">
                   <div className="form-col"><label>開始</label><input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} /></div>
                   <div className="form-col"><label>結束</label><input type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} /></div>
               </div>
               <input type="number" placeholder="費用" value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} />
            </>
          )}

          {formData.category !== 'note' && (
              <textarea placeholder="備註" rows="3" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} style={{resize:'vertical'}} />
          )}
          
          <div className="btn-group">
            {itemToEdit && <button type="button" onClick={handleDelete} className="btn btn-delete">刪除</button>}
            <button type="button" onClick={onClose} className="btn btn-cancel">取消</button>
            <button type="submit" disabled={loading} className="btn btn-save">儲存</button>
          </div>
        </form>
      </div>
    </div>
  )
}