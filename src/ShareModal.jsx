import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'

export default function ShareModal({ trip, onClose, onUpdate }) {
  const [loading, setLoading] = useState(false)
  const [isPublic, setIsPublic] = useState(!!trip.share_token)

  // 帳號共用相關 state
  const [inviteEmail, setInviteEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [members, setMembers] = useState([])
  const [inviting, setInviting] = useState(false)
  const [statusMsg, setStatusMsg] = useState(null)

  // 產生分享連結
  const shareUrl = `${window.location.origin}/share/${trip.share_token || ''}`

  // 載入目前已共享的成員清單
  // 1. 修改 fetchMembers：只撈取真正的註冊帳號（user_id 不為 null），並帶出 email
  const fetchMembers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trip_members')
        .select('id, user_id, email, role, created_at')
        .eq('trip_id', trip.id)
        .not('user_id', 'is', null) // 👈 過濾掉沒有綁定帳號的純文字旅伴，避免 slice(0, 8) 報錯
        .order('created_at', { ascending: true })

      if (error) throw error
      setMembers(data || [])
    } catch (err) {
      console.error('獲取成員失敗:', err.message)
    }
  }, [trip.id])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  // 原有功能：切換公開網頁連結
  const toggleShare = async () => {
    setLoading(true)
    try {
      let newToken = null
      if (!isPublic) {
        newToken = crypto.randomUUID()
      }

      const { error } = await supabase
        .from('trips')
        .update({ share_token: newToken })
        .eq('id', trip.id)

      if (error) throw error

      setIsPublic(!isPublic)
      if (onUpdate) onUpdate()
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

  // 新功能：透過 Email 分享給其他帳號
  const handleInviteUser = async (e) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return

    setInviting(true)
    setStatusMsg(null)

    try {
      const { data, error } = await supabase.rpc('invite_member_by_email', {
        target_trip_id: trip.id,
        invite_email: inviteEmail.trim().toLowerCase(),
        member_role: role,
      })

      if (error) throw error

      setStatusMsg({ type: 'success', text: data?.message || '成功加入成員！' })
      setInviteEmail('')
      fetchMembers()
      if (onUpdate) onUpdate()
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message || '邀請失敗，請確認對方已註冊' })
    } finally {
      setInviting(false)
    }
  }

  // 新功能：移除已共享的成員
  const handleRemoveMember = async (memberUserId) => {
    if (!window.confirm('確定要移除此成員的檢視權限嗎？')) return

    try {
      const { error } = await supabase
        .from('trip_members')
        .delete()
        .eq('trip_id', trip.id)
        .eq('user_id', memberUserId)

      if (error) throw error
      fetchMembers()
      if (onUpdate) onUpdate()
    } catch (err) {
      alert('移除失敗: ' + err.message)
    }
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
        padding: '24px', borderRadius: '20px', width: '90%', maxWidth: '440px',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        maxHeight: '90vh', overflowY: 'auto'
      }}>
        <h3 style={{ marginTop: 0, textAlign: 'center' }}>👥 行程共享與權限</h3>

        {/* 區塊 1: 帳號協作分享 */}
        <div style={{ marginTop: '16px', background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '12px' }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '6px' }}>
            分享給其他註冊帳號
          </div>
          <p style={{ color: '#aaa', fontSize: '12px', margin: '0 0 12px 0' }}>
            輸入對方的註冊 Email，對方登入個人帳號後即可在行程清單中檢視。
          </p>

          <form onSubmit={handleInviteUser} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="email"
                placeholder="輸入對方帳號 Email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                style={{
                  flex: 1,
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid #444',
                  color: '#fff',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '13px'
                }}
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={{
                  background: '#2a2a2a',
                  border: '1px solid #444',
                  color: '#fff',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  fontSize: '13px'
                }}
              >
                <option value="viewer">唯讀</option>
                <option value="editor">可編輯</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={inviting}
              style={{
                padding: '9px 16px',
                borderRadius: '8px',
                border: 'none',
                background: '#0070f3',
                color: 'white',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: inviting ? 'not-allowed' : 'pointer'
              }}
            >
              {inviting ? '加入中...' : '新增成員'}
            </button>
          </form>

          {statusMsg && (
            <div style={{
              marginTop: '10px',
              fontSize: '12px',
              color: statusMsg.type === 'error' ? '#ff6b6b' : '#51cf66'
            }}>
              {statusMsg.text}
            </div>
          )}

          {/* 已分享成員清單 */}
          {members.length > 0 && (
            <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
              <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '8px' }}>已加入的成員 ({members.length})：</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {members.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(0,0,0,0.3)',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                  >
                    <span style={{ color: '#ddd' }}>
                      {m.email || `帳號 ID: ${m.user_id?.slice(0, 8)}...`} ({m.role === 'editor' ? '編輯' : '唯讀'})
                    </span>
                    <button
                      onClick={() => handleRemoveMember(m.user_id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ff6b6b',
                        cursor: 'pointer',
                        padding: '2px 6px'
                      }}
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 區塊 2: 原有公開網頁連結分享 */}
        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: '#aaa', marginBottom: '10px' }}>
            {isPublic ? '🌐 目前任何人擁有公開連結皆可唯讀查看。' : '🔒 公開網頁連結目前處於關閉狀態。'}
          </div>

          <button
            onClick={toggleShare}
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: '20px', border: 'none',
              background: isPublic ? '#dc3545' : '#28a745', color: 'white',
              fontSize: '14px', fontWeight: 'bold', cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
            }}
          >
            {loading ? '處理中...' : (isPublic ? '關閉公開網頁連結' : '開啟公開網頁連結')}
          </button>
        </div>

        {isPublic && (
          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '10px', marginTop: '14px' }}>
            <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '5px' }}>網頁唯讀連結：</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                readOnly
                value={shareUrl}
                style={{
                  flex: 1, background: 'rgba(0,0,0,0.4)',
                  border: 'none', color: '#fff', padding: '6px 10px',
                  borderRadius: '6px', fontSize: '12px'
                }}
              />
              <button
                onClick={copyLink}
                style={{
                  background: '#007bff', color: 'white', border: 'none',
                  borderRadius: '6px', padding: '0 12px', cursor: 'pointer', fontSize: '12px'
                }}
              >
                複製
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: '100%', marginTop: '20px', padding: '10px',
            background: 'transparent', border: '1px solid #555',
            color: '#aaa', borderRadius: '10px', cursor: 'pointer'
          }}
        >
          完成關閉
        </button>
      </div>
    </div>
  )
}