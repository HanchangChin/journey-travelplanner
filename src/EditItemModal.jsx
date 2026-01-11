import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { Autocomplete } from '@react-google-maps/api'

// ✨ 修改 1: 在參數中加入 initialSortOrder 和 onMove
export default function EditItemModal({ tripId, dayId, days = [], itemToEdit, onClose, onSave, tripMembers = [], is24hr = true, isLoaded, currentItemsCount = 0, initialSortOrder = null, onMove }) {
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
    attachment_type: '',
    is_reserved: false,
    reservation_agent: '',
    reservation_advance_time: '',
    currency: 'TWD'
  })

  const [details, setDetails] = useState({
    sub_type: 'flight_train', company: '', vehicle_number: '', travelers: [], 
    departure_terminal: '', arrival_terminal: '', dep_offset: null, arr_offset: null, duration_text: '', arrival_day_offset: 0,
    checkin_time: '', checkin_counter: '', lounge_name: '', arrival_location: '', 
    distance_text: '', google_duration: 0, buffer_time: 0,
    checkin_date: '', checkout_date: '', agent: '', phone: '', currency: 'TWD', is_paid: false
  })

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
        attachment_type: itemToEdit.attachment_type || '',
        is_reserved: itemToEdit.is_reserved || false,
        reservation_agent: itemToEdit.reservation_agent || '',
        reservation_advance_time: itemToEdit.reservation_advance_time || '',
        currency: itemToEdit.currency || 'TWD'
      })
      const savedDetails = itemToEdit.category === 'transport' ? itemToEdit.transport_details : itemToEdit.accommodation_details
      if (savedDetails) setDetails(prev => ({ ...prev, ...savedDetails }))
    } else {
      setFormData({
        name: '', category: 'activity', start_time: '', end_time: '',
        location_name: '', google_place_id: '', address: '', phone: '', website: '', 
        rating: '', cost: '', notes: '', opening_hours: '',
        attachment_url: '', attachment_type: '',
        is_reserved: false, reservation_agent: '', reservation_advance_time: '',
        currency: 'TWD'
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
            location_name: formData.location_name,
            address: formData.address, website: formData.website,
            cost: formData.cost ? parseFloat(formData.cost) : 0, notes: formData.notes,
            start_time: formData.end_time || null, end_time: formData.end_time || null, 
            transport_details: { ...details, is_arrival_card: true, original_start_time: formData.start_time, arrival_day_offset: 0 },
            sort_order: 0,
            currency: formData.currency
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
              accommodation_details: { ...details, is_generated_stay: true },
              currency: formData.currency
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
          // ✨ 修改 2: 插入順序邏輯 (優先權：住宿固定 > 指定插入 > 預設最後)
          if (formData.category === 'accommodation') {
              newSortOrder = 9000;
          } else if (initialSortOrder) {
              newSortOrder = initialSortOrder;
          } else {
              newSortOrder = (currentItemsCount + 1) * 1024; // 配合前一步驟建議的間隔，確保後續插入有空間
          }
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
        is_reserved: formData.is_reserved,
        reservation_agent: formData.reservation_agent,
        reservation_advance_time: formData.reservation_advance_time,
        currency: formData.currency,
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
      <style>{`
        /* ✨ 關鍵修正：確保深色模式下的輸入框樣式正確 ✨ */
        :root {
            /* 預設 (淺色模式) */
            --modal-bg: #ffffff;
            --text-color: #333333;
            --text-sub: #666666;
            --input-bg: #ffffff;
            --input-border: #cccccc;
            --btn-gray: #f0f0f0;
            
            --bg-transport: #f8f9fa;
            --border-transport: #e9ecef;
            --bg-transport-sub: #fff3cd;
            --border-transport-sub: #ffeeba;
            --text-transport-sub: #856404;
            --bg-transport-time: #e3f2fd;
            
            --bg-acc: #fff5f0;
            --border-acc: #ffd6c2;
            --bg-acc-sub: #ffffff;
            --text-acc-label: #e65100;
            
            --bg-note: #fff9c4;
            --border-note: #fff59d;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                /* 深色模式：強制輸入框為深色，文字為淺色 */
                --modal-bg: #1e1e1e;
                --text-color: #e0e0e0;
                --text-sub: #aaaaaa;
                --input-bg: #2d2d2d; /* 深色背景 */
                --input-border: #444444;
                --btn-gray: #333333;
                
                --bg-transport: #252526;
                --border-transport: #333333;
                --bg-transport-sub: #4d442b;
                --border-transport-sub: #665d3e;
                --text-transport-sub: #ffd700;
                --bg-transport-time: #1a3b5c;
                
                --bg-acc: #3d241c;
                --border-acc: #5e3a2e;
                --bg-acc-sub: #1e1e1e;
                --text-acc-label: #ffab91;
                
                --bg-note: #424228;
                --border-note: #666640;
            }
        }

        .modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0,0,0,0.6);
            backdrop-filter: blur(5px);
            display: flex; align-items: center; justify-content: center;
            z-index: 2000;
            padding: 20px;
            padding-top: calc(env(safe-area-inset-top) + 20px); 
            padding-bottom: max(20px, env(safe-area-inset-bottom));
            box-sizing: border-box;
        }
        
        .modal-content {
            background: var(--modal-bg);
            color: var(--text-color);
            border-radius: 16px;
            width: 560px; maxWidth: 100%; max-height: 100%;
            display: flex; flex-direction: column;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            border: 1px solid var(--border-transport); /* 微調邊框顏色 */
            overflow: hidden;
            backdrop-filter: blur(10px);
        }
        
        .modal-header {
            padding: 20px 20px 15px 20px;
            border-bottom: 1px solid var(--input-border);
            background: var(--modal-bg);
            z-index: 10;
        }
        .modal-header h2 { margin: 0; font-size: 1.3rem; font-weight: 700; }

        .modal-body {
            padding: 20px;
            overflow-y: auto; flex: 1; -webkit-overflow-scrolling: touch; 
        }

        .modal-footer {
            padding: 15px 20px 20px 20px;
            border-top: 1px solid var(--input-border);
            background: var(--modal-bg);
            z-index: 10;
            padding-bottom: max(20px, calc(env(safe-area-inset-bottom) / 2));
        }
        
        input, select, textarea {
            width: 100%; padding: 10px; font-size: 16px; 
            border: 1px solid var(--input-border); 
            background-color: var(--input-bg) !important; /* 強制背景色 */
            color: var(--text-color) !important; /* 強制文字顏色 */
            border-radius: 8px;
            box-sizing: border-box;
            transition: border-color 0.2s;
        }
        input:focus, select:focus, textarea:focus { outline: none; border-color: #007bff; }
        
        label { font-size: 13px; color: var(--text-sub); display: block; margin-bottom: 6px; font-weight: 600; }
        .form-row { display: flex; gap: 12px; margin-bottom: 12px; }
        .form-col { flex: 1; }
        .form-col-2 { flex: 2; }
        
        .section-title { 
            font-size: 14px; font-weight: bold; color: #007bff; 
            border-bottom: 1px solid var(--input-border); 
            padding-bottom: 8px; margin: 20px 0 12px 0; 
        }
        
        .btn-group { display: flex; gap: 10px; }
        .btn { flex: 1; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 15px; transition: opacity 0.2s; }
        .btn:active { opacity: 0.8; }
        .btn-save { background: #007bff; color: white; }
        .btn-cancel { background: var(--btn-gray); color: var(--text-color); }
        .btn-delete { background: #dc3545; color: white; }
        .btn-move { background: #28a745; color: white; }
        
        .transport-options { display: flex; margin-bottom: 15px; background: var(--btn-gray); padding: 4px; border-radius: 8px; }
        .transport-btn { flex: 1; padding: 8px; border: none; cursor: pointer; background: transparent; color: var(--text-sub); font-size: 13px; border-radius: 6px; font-weight: 500; }
        .transport-btn.active { background: var(--modal-bg); color: #007bff; font-weight: bold; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        
        .section-transport { background: var(--bg-transport); padding: 15px; border-radius: 10px; border: 1px solid var(--border-transport); }
        .section-transport-sub { background: var(--bg-transport-sub); padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-transport-sub); }
        .text-transport-sub { color: var(--text-transport-sub); }
        .section-transport-time { background: var(--bg-transport-time); padding: 12px; border-radius: 8px; }
        
        .section-acc { background: var(--bg-acc); padding: 15px; border-radius: 10px; border: 1px solid var(--border-acc); }
        .section-acc-sub { background: var(--bg-acc-sub); padding: 10px; border-radius: 8px; border: 1px solid var(--border-transport); }
        .text-acc-label { color: var(--text-acc-label); }
        
        .section-note { background: var(--bg-note); padding: 15px; border-radius: 10px; border: 1px solid var(--border-note); }

        @media (max-width: 600px) {
            .modal-content { width: 100%; height: auto; border-radius: 16px 16px 0 0; position: absolute; bottom: 0; }
            .form-row { flex-direction: column; gap: 10px; }
            .modal-overlay { padding: 0; align-items: flex-end; }
        }
      `}</style>

      <div className="modal-content">
        <div className="modal-header">
            <h2>{itemToEdit ? '✏️ 編輯行程' : '➕ 新增行程'}</h2>
        </div>

        <div className="modal-body">
            <form id="edit-form" onSubmit={handleSubmit}>
            
            <div style={{ marginBottom: '15px' }}>
                <label>類型</label>
                <select value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
            </div>

            {/* ================= 筆記模式 (Note) ================= */}
            {formData.category === 'note' && (
                <div className="section-note">
                    <div className="section-title" style={{marginTop:0}}>📝 筆記與附件</div>
                    <div style={{marginBottom:'10px'}}>
                        <label>標題</label>
                        <input placeholder="標題 (例如: 電子機票)" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                    </div>
                    <div style={{marginBottom:'10px'}}>
                        <label>內容</label>
                        <textarea placeholder="輸入內容..." rows="4" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} style={{resize:'vertical'}} />
                    </div>
                    <div>
                        <label>📎 附件 (圖片/PDF)</label>
                        <input type="file" accept="image/*,application/pdf" onChange={handleFileUpload} disabled={uploading} style={{marginTop:'5px', padding:'5px'}} />
                        {uploading && <span style={{fontSize:'12px', color:'#007bff'}}> 上傳中...</span>}
                        {formData.attachment_url && (
                            <div style={{marginTop:'10px', padding:'8px', border:'1px solid var(--input-border)', borderRadius:'6px', background:'var(--input-bg)', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                                <a href={formData.attachment_url} target="_blank" rel="noreferrer" style={{textDecoration:'none', color:'#007bff', display:'flex', alignItems:'center', gap:'5px', fontSize:'13px'}}>
                                    <span style={{fontSize:'16px'}}>{formData.attachment_type === 'image' ? '🖼️' : '📄'}</span>
                                    <span>{formData.attachment_type === 'image' ? '已附加圖片' : '已附加 PDF'}</span>
                                </a>
                                <button type="button" onClick={() => setFormData({...formData, attachment_url:'', attachment_type:''})} style={{color:'#dc3545', border:'1px solid #dc3545', background:'transparent', borderRadius:'4px', padding:'2px 6px', cursor:'pointer', fontSize:'12px'}}>🗑️ 移除</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ================= 交通區塊 ================= */}
            {formData.category === 'transport' && (
                <div className="section-transport">
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
                    <div className="section-transport-sub">
                        <div style={{display:'flex', justifyContent:'space-between', fontSize:'12px', fontWeight:'bold', marginBottom:'5px'}} className="text-transport-sub">
                            <span>📏 {details.distance_text || '--'}</span>
                            <span>{details.sub_type==='public'?'🚌':'🚗'} Google: {details.google_duration ? Math.floor(details.google_duration) + ' min' : '--'}</span>
                        </div>
                        <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                            <label style={{marginBottom:0}} className="text-transport-sub">Buffer:</label>
                            <input type="number" placeholder="分" value={details.buffer_time} onChange={e => setDetails({...details, buffer_time: e.target.value})} style={{width:'70px'}} />
                        </div>
                    </div>
                )}

                <div className="section-transport-time">
                    <div className="form-row">
                        <div className="form-col">
                            <label>出發時間</label>
                            <input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} />
                        </div>
                        <div className="form-col">
                            <label>抵達時間</label>
                            <div style={{display:'flex', gap:'5px'}}>
                                <input type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} style={{flex:1}} />
                                <select value={details.arrival_day_offset} onChange={e => setDetails({...details, arrival_day_offset: parseInt(e.target.value)})} style={{width:'70px'}}>
                                    <option value={-1}>-1</option><option value={0}>當日</option><option value={1}>+1</option><option value={2}>+2</option>
                                </select>
                            </div>
                            {(details.sub_type === 'car_bus' || details.sub_type === 'public') && details.google_duration > 0 && 
                                <button type="button" onClick={applySuggestedTime} style={{fontSize:'12px', width:'100%', marginTop:'5px', padding: '6px', background:'#28a745', color:'white', border:'none', borderRadius:'4px', cursor:'pointer'}}>套用建議時間</button>
                            }
                        </div>
                    </div>
                    <div>
                        <label>時長</label>
                        <input value={details.duration_text} onChange={e => setDetails({...details, duration_text: e.target.value})} />
                    </div>
                </div>

                <div style={{marginTop:'10px', background:'rgba(255,255,255,0.1)', padding:'10px', borderRadius:'8px', border:'1px dashed var(--border-transport-sub)'}}>
                    <label>💰 交通總費用</label>
                    <div style={{display:'flex', gap:'5px'}}>
                        <input type="number" placeholder="總費用" value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} style={{flex:2}} />
                        <input placeholder="幣別 (TWD)" value={formData.currency} onChange={e => setFormData({...formData, currency: e.target.value})} style={{flex:1}} />
                    </div>
                </div>

                {details.arrival_day_offset > 0 && <button type="button" onClick={createArrivalItem} style={{width: '100%', marginTop: '10px', padding: '8px', background: 'var(--bg-transport-time)', color: '#0056b3', border: '1px dashed #0056b3', borderRadius: '6px', cursor: 'pointer', fontWeight:'bold', fontSize:'13px'}}>⬇️ 補救：生成抵達行程</button>}

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
                        <button type="button" onClick={() => removeTraveler(index)} style={{background:'#ff4d4f', color:'white', border:'none', borderRadius:'4px', width:'32px', height:'32px', fontSize:'18px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center'}}>×</button>
                        </div>
                    ))}
                    <button type="button" onClick={addTraveler} style={{ marginTop: '5px', padding: '8px', background: 'transparent', border: '1px dashed #007bff', color: '#007bff', borderRadius: '6px', cursor: 'pointer', width: '100%', fontSize:'13px' }}>+ 新增旅伴</button>
                    </>
                )}
                </div>
            )}

            {/* ================= 住宿區塊 ================= */}
            {formData.category === 'accommodation' && (
                <div className="section-acc">
                    <div className="section-title" style={{marginTop:0}}>🏨 住宿詳情</div>
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
                        <div className="form-col section-acc-sub">
                            <label className="text-acc-label">📥 Check-in</label>
                            <input type="date" value={details.checkin_date} onChange={e => setDetails({...details,checkin_date: e.target.value})} style={{marginBottom:'5px'}} />
                            <input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} />
                        </div>
                        <div className="form-col section-acc-sub">
                            <label className="text-acc-label">📤 Check-out</label>
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

            {/* ================= 一般行程 (包含 Food, Activity, Other) ================= */}
            {!['transport', 'accommodation', 'note'].includes(formData.category) && (
                <>
                <div style={{ marginBottom: '10px' }}><input placeholder="名稱" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required /></div>
                <div style={{border: '1px solid var(--input-border)', padding:'15px', borderRadius:'10px', marginBottom: '15px'}}>
                    <label>📍 地點搜尋</label>
                    <Autocomplete onLoad={setAutocompleteDep} onPlaceChanged={onDepPlaceChanged}>
                        <input placeholder="搜尋地點 (例如: 清水寺)" value={formData.location_name} onChange={e => setFormData({...formData, location_name: e.target.value})} />
                    </Autocomplete>
                    <input placeholder="地址" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} style={{marginTop:'10px'}} />
                    <div style={{marginTop:'10px'}}>
                        <div className="form-row">
                            <div className="form-col"><input placeholder="電話" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} /></div>
                            <div className="form-col"><input placeholder="官方網址" value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} /></div>
                        </div>
                        <div>
                            <label style={{color:'var(--text-sub)', marginBottom:'2px'}}>🕒 營業時間</label>
                            <textarea placeholder="自動抓取營業時間，或手動輸入" rows="4" value={formData.opening_hours} onChange={e => setFormData({...formData, opening_hours: e.target.value})} style={{fontFamily:'monospace', fontSize:'13px', resize:'vertical'}} />
                        </div>
                    </div>
                </div>
                
                {/* 預約區塊 (僅 Food) */}
                {formData.category === 'food' && (
                    <div style={{ marginTop: '10px', marginBottom: '15px', padding: '15px', background: 'var(--bg-transport)', borderRadius: '10px', border: '1px solid var(--border-transport)' }}>
                        <div className="section-title" style={{ marginTop: 0 }}>🍴 餐廳訂位資訊</div>
                        <div className="form-row">
                            <div className="form-col">
                                <label>是否預約</label>
                                <select 
                                    value={formData.is_reserved ? 'true' : 'false'} 
                                    onChange={e => setFormData({ ...formData, is_reserved: e.target.value === 'true' })}
                                    style={{ color: formData.is_reserved ? '#28a745' : '#666', fontWeight: formData.is_reserved ? 'bold' : 'normal' }}
                                >
                                    <option value="false">❌ 未預約 / 不需要</option>
                                    <option value="true">✅ 已預約</option>
                                </select>
                            </div>
                            <div className="form-col">
                                <label>預約管道 (Agent)</label>
                                <input placeholder="電話 / OpenTable / 官網" value={formData.reservation_agent} onChange={e => setFormData({ ...formData, reservation_agent: e.target.value })} />
                            </div>
                        </div>
                        <div style={{ marginTop: '5px' }}>
                             <label>開放預約時間 (多久前)</label>
                             <input placeholder="例如: 30天前 / 每月1號" value={formData.reservation_advance_time} onChange={e => setFormData({ ...formData, reservation_advance_time: e.target.value })} />
                        </div>
                    </div>
                )}

                <div className="form-row">
                    <div className="form-col"><label>開始</label><input type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} /></div>
                    <div className="form-col"><label>結束</label><input type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} /></div>
                </div>
                
                <div style={{marginTop:'10px'}}>
                    <label>費用</label>
                    <div style={{display:'flex', gap:'5px'}}>
                        <input type="number" placeholder="費用" value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} style={{flex:2}} />
                        <input placeholder="幣別 (TWD)" value={formData.currency} onChange={e => setFormData({...formData, currency: e.target.value})} style={{flex:1}} />
                    </div>
                </div>
                </>
            )}

            {formData.category !== 'note' && (
                <div style={{marginTop:'15px'}}>
                    <label>備註</label>
                    <textarea placeholder="備註..." rows="3" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} style={{resize:'vertical'}} />
                </div>
            )}
            </form>
        </div>

        <div className="modal-footer">
            <div className="btn-group">
                {itemToEdit && <button type="button" onClick={handleDelete} className="btn btn-delete">刪除</button>}
                {itemToEdit && onMove && <button type="button" onClick={onMove} className="btn btn-move">移動</button>}
                <button type="button" onClick={onClose} className="btn btn-cancel">取消</button>
                <button type="submit" form="edit-form" disabled={loading} className="btn btn-save">儲存</button>
            </div>
        </div>
      </div>
    </div>
  )
}