import { createClient } from '@supabase/supabase-js'

// 使用 import.meta.env 來讀取 .env 檔案裡的變數
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 建立 Supabase 連線客戶端
export const supabase = createClient(supabaseUrl, supabaseAnonKey)