'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Plus, Trash2, Download, Search, ChevronLeft, ChevronRight, DollarSign, Briefcase, Coffee, Undo2, FileSpreadsheet, Pencil, X, CalendarDays, Moon, Sun } from 'lucide-react'
import ExcelJS from 'exceljs'

type Theme = 'midnight' | 'abyss' | 'daylight'
type Who = 'Me' | 'Partner' | 'Shared'
type TxType = 'expense' | 'income'
type ExpenseTag = 'Reimbursable' | 'Personal'

interface Transaction {
  id: string
  date: string
  type: TxType
  category: string
  amount: number
  note: string
  who: Who
  tag?: ExpenseTag
}

interface MonthData {
  startingAmount: number
  transactions: Transaction[]
}

interface CatDef {
  name: string
  emoji: string
  color: string
}

const CUSTOM_CAT_COLORS = ['#f43f5e', '#0ea5e9', '#a855f7', '#14b8a6', '#f59e0b', '#64748b', '#e11d48', '#6366f1']

const EXPENSE_CATS: CatDef[] = [
  { name: 'Housing',       emoji: '🏠', color: '#ef4444' },
  { name: 'Transport',     emoji: '🚗', color: '#f97316' },
  { name: 'Groceries',     emoji: '🛒', color: '#eab308' },
  { name: 'Dining',        emoji: '🍔', color: '#84cc16' },
  { name: 'Entertainment', emoji: '🎬', color: '#22c55e' },
  { name: 'Health',        emoji: '💊', color: '#06b6d4' },
  { name: 'Shopping',      emoji: '👗', color: '#3b82f6' },
  { name: 'Subscriptions', emoji: '📱', color: '#8b5cf6' },
  { name: 'Utilities',     emoji: '⚡', color: '#ec4899' },
  { name: 'Other',         emoji: '📦', color: '#6b7280' },
]

const INCOME_CATS: CatDef[] = [
  { name: 'Salary',       emoji: '💼', color: '#10b981' },
  { name: 'Freelance',    emoji: '💰', color: '#34d399' },
  { name: 'Investment',   emoji: '📈', color: '#059669' },
  { name: 'Gift',         emoji: '🎁', color: '#047857' },
  { name: 'Other Income', emoji: '💵', color: '#065f46' },
]

const ALL_CATS = [...EXPENSE_CATS, ...INCOME_CATS]

// catMeta is defined inside the component to include custom categories

function monthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function formatEur(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(n)
}

export default function BudgetDash() {
  const today = new Date()
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [data, setData]   = useState<Record<string, MonthData>>({})
  const [loaded, setLoaded] = useState(false)
  const [theme, setTheme]   = useState<Theme>('midnight')
  const [search, setSearch]     = useState('')
  const [filterWho, setFilterWho] = useState<Who | 'All'>('All')
  const [filterCat, setFilterCat] = useState('All')
  const [filterTag, setFilterTag] = useState<ExpenseTag | 'All'>('All')
  const [startingInput, setStartingInput] = useState('')
  const [editingStarting, setEditingStarting] = useState(false)

  const [form, setForm] = useState({
    type: 'expense' as TxType,
    category: EXPENSE_CATS[0].name,
    amount: '',
    note: '',
    who: 'Shared' as Who,
    tag: 'Personal' as ExpenseTag,
    date: today.toISOString().slice(0, 10),
  })

  const [editingTxId, setEditingTxId] = useState<string | null>(null)

  // Custom categories
  const [customExpenseCats, setCustomExpenseCats] = useState<CatDef[]>([])
  const [customIncomeCats, setCustomIncomeCats] = useState<CatDef[]>([])
  const [addingCat, setAddingCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatEmoji, setNewCatEmoji] = useState('🏷️')

  // Who names (editable)
  const [whoNames, setWhoNames] = useState<Record<Who, string>>({ Me: 'Me', Partner: 'Partner', Shared: 'Both' })
  const [editingWhoNames, setEditingWhoNames] = useState(false)

  // EUR exchange rate
  const [eurRate, setEurRate] = useState<number | null>(null)
  const toEur = useCallback((usd: number) => eurRate != null ? usd * eurRate : null, [eurRate])

  // Calendar
  const [calOpen, setCalOpen] = useState(false)
  const [calView, setCalView] = useState<'month' | 'week' | 'day'>('month')
  const [calDate, setCalDate] = useState(today) // the focal date for week/day views

  // Undo stack
  const MAX_UNDO = 50
  const undoStackRef = useRef<Record<string, MonthData>[]>([])
  const [undoCount, setUndoCount] = useState(0)

  const pushUndo = useCallback(() => {
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), structuredClone(data)]
    setUndoCount(undoStackRef.current.length)
  }, [data])

  function undo() {
    if (undoStackRef.current.length === 0) return
    const prev = undoStackRef.current.pop()!
    setUndoCount(undoStackRef.current.length)
    setData(prev)
  }

  // Contextual undo hints — show inline near the action that just happened
  const [lastAction, setLastAction] = useState<'add' | 'delete' | 'starting' | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showUndoHint(action: 'add' | 'delete' | 'starting') {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setLastAction(action)
    undoTimerRef.current = setTimeout(() => setLastAction(null), 5000)
  }

  function handleUndo() {
    undo()
    setLastAction(null)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }

  useEffect(() => {
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current) }
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('budget-dash')
      if (stored) setData(JSON.parse(stored))
      const storedCats = localStorage.getItem('budget-dash-custom-cats')
      if (storedCats) {
        const parsed = JSON.parse(storedCats)
        if (parsed.expense) setCustomExpenseCats(parsed.expense)
        if (parsed.income) setCustomIncomeCats(parsed.income)
      }
      const storedNames = localStorage.getItem('budget-dash-who-names')
      if (storedNames) setWhoNames(JSON.parse(storedNames))
      const storedTheme = localStorage.getItem('budget-dash-theme')
      if (storedTheme) setTheme(JSON.parse(storedTheme))
    } catch {}
    setLoaded(true)
  }, [])

  // Fetch USD→EUR exchange rate (ECB data via Frankfurter)
  useEffect(() => {
    let stale = false
    fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR')
      .then((r) => r.json())
      .then((d) => { if (!stale && d.rates?.EUR) setEurRate(d.rates.EUR) })
      .catch(() => {})
    return () => { stale = true }
  }, [])

  useEffect(() => {
    if (!loaded) return
    localStorage.setItem('budget-dash', JSON.stringify(data))
  }, [data, loaded])

  // Apply theme to documentElement and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!loaded) return
    localStorage.setItem('budget-dash-theme', JSON.stringify(theme))
  }, [theme, loaded])

  const key = monthKey(year, month)
  const monthData: MonthData = data[key] ?? { startingAmount: 0, transactions: [] }

  function setMonthData(patch: Partial<MonthData>) {
    setData((prev) => ({
      ...prev,
      [key]: { ...monthData, ...patch },
    }))
  }

  // Sync starting input when month changes
  useEffect(() => {
    setStartingInput(String(monthData.startingAmount || ''))
    setEditingStarting(false)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const expenses = useMemo(() => monthData.transactions.filter((t) => t.type === 'expense'), [monthData.transactions])
  const incomes = useMemo(() => monthData.transactions.filter((t) => t.type === 'income'), [monthData.transactions])
  const totalExpenses = useMemo(() => expenses.reduce((s, t) => s + t.amount, 0), [expenses])
  const totalIncome = useMemo(() => incomes.reduce((s, t) => s + t.amount, 0), [incomes])
  const balance = monthData.startingAmount + totalIncome - totalExpenses

  // Work vs non-work totals
  const workExpenses = useMemo(() => expenses.filter((t) => t.tag === 'Reimbursable').reduce((s, t) => s + t.amount, 0), [expenses])
  const nonWorkExpenses = useMemo(() => expenses.filter((t) => t.tag !== 'Reimbursable').reduce((s, t) => s + t.amount, 0), [expenses])

  // Who breakdown
  const byWho = useMemo(() => {
    const map: Record<string, number> = { Me: 0, Partner: 0, Shared: 0 }
    expenses.forEach((t) => { map[t.who] = (map[t.who] ?? 0) + t.amount })
    return map
  }, [expenses])

  // Filtered transactions
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return monthData.transactions.filter((t) => {
      if (filterWho !== 'All' && t.who !== filterWho) return false
      if (filterCat !== 'All' && t.category !== filterCat) return false
      if (filterTag !== 'All' && (t.tag ?? 'Personal') !== filterTag) return false
      if (q && !t.category.toLowerCase().includes(q) && !t.note.toLowerCase().includes(q) && !t.who.toLowerCase().includes(q)) return false
      return true
    })
  }, [monthData.transactions, search, filterWho, filterCat, filterTag])

  // Pie chart data
  const pieData = useMemo(() => {
    const map: Record<string, number> = {}
    expenses.forEach((t) => { map[t.category] = (map[t.category] ?? 0) + t.amount })
    return Object.entries(map).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0)
  }, [expenses])

  // Bar chart data
  const barData = useMemo(() => {
    const days = daysInMonth(year, month)
    const map: Record<number, { income: number; expense: number }> = {}
    for (let d = 1; d <= days; d++) map[d] = { income: 0, expense: 0 }
    monthData.transactions.forEach((t) => {
      const d = new Date(t.date).getDate()
      if (map[d]) {
        if (t.type === 'expense') map[d].expense += t.amount
        else map[d].income += t.amount
      }
    })
    return Object.entries(map).map(([day, vals]) => ({ day: Number(day), ...vals }))
  }, [monthData.transactions, year, month])

  // Progress bar
  const budget = monthData.startingAmount
  const spentRatio = budget > 0 ? Math.min(totalExpenses / budget, 1) : 0
  const progressColor = spentRatio < 0.7 ? '#22c55e' : spentRatio < 0.9 ? '#eab308' : '#ef4444'

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }

  function commitStarting() {
    const val = Math.max(0, Number(startingInput) || 0)
    if (val !== monthData.startingAmount) { pushUndo(); showUndoHint('starting') }
    setMonthData({ startingAmount: val })
    setStartingInput(String(val))
    setEditingStarting(false)
  }

  function addTransaction() {
    if (!form.amount || isNaN(Number(form.amount))) return
    pushUndo()
    showUndoHint('add')
    const tx: Transaction = {
      id: crypto.randomUUID(),
      date: form.date,
      type: form.type,
      category: form.category,
      amount: Math.abs(Number(form.amount)),
      note: form.note,
      who: form.who,
      tag: form.type === 'expense' ? form.tag : undefined,
    }
    setMonthData({ transactions: [...monthData.transactions, tx] })
    setForm((f) => ({ ...f, amount: '', note: '' }))
  }

  function deleteTransaction(id: string) {
    pushUndo()
    showUndoHint('delete')
    setMonthData({ transactions: monthData.transactions.filter((t) => t.id !== id) })
    if (editingTxId === id) setEditingTxId(null)
  }

  function startEdit(tx: Transaction) {
    setEditingTxId(tx.id)
    setForm({
      type: tx.type,
      category: tx.category,
      amount: String(tx.amount),
      note: tx.note,
      who: tx.who,
      tag: tx.tag ?? 'Personal',
      date: tx.date,
    })
  }

  function cancelEdit() {
    setEditingTxId(null)
    setForm((f) => ({ ...f, amount: '', note: '' }))
  }

  function saveEdit() {
    if (!editingTxId || !form.amount || isNaN(Number(form.amount))) return
    pushUndo()
    setMonthData({
      transactions: monthData.transactions.map((t) =>
        t.id === editingTxId
          ? {
              ...t,
              type: form.type,
              category: form.category,
              amount: Math.abs(Number(form.amount)),
              note: form.note,
              who: form.who,
              tag: form.type === 'expense' ? form.tag : undefined,
              date: form.date,
            }
          : t
      ),
    })
    setEditingTxId(null)
    setForm((f) => ({ ...f, amount: '', note: '' }))
  }

  async function exportExcel() {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(MONTH_NAMES[month] + ' ' + year)

    // Column definitions
    ws.columns = [
      { header: 'Date',     key: 'date',     width: 14 },
      { header: 'Type',     key: 'type',     width: 10 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Amount',   key: 'amount',   width: 14 },
      { header: 'Who',      key: 'who',      width: 12 },
      { header: 'Tag',      key: 'tag',      width: 12 },
      { header: 'Note',     key: 'note',     width: 30 },
    ]

    // Header row styling
    const headerRow = ws.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e293b' } }
    headerRow.alignment = { horizontal: 'center' }

    // Add data rows
    const sorted = [...monthData.transactions].sort((a, b) => a.date.localeCompare(b.date))
    sorted.forEach((t) => {
      const row = ws.addRow({
        date: t.date,
        type: t.type.charAt(0).toUpperCase() + t.type.slice(1),
        category: catMeta(t.category).emoji + ' ' + t.category,
        amount: t.amount,
        who: whoNames[t.who as Who],
        tag: t.tag ?? '',
        note: t.note,
      })

      // Row background: light red for expense, light green for income
      const bgColor = t.type === 'expense' ? 'FFFEF2F2' : 'FFF0FDF4'
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } },
        }
      })

      // Category cell - use the category's own color
      const catColor = catMeta(t.category).color.replace('#', 'FF')
      const catCell = row.getCell('category')
      catCell.font = { bold: true, color: { argb: catColor } }

      // Amount cell - red or green
      const amountCell = row.getCell('amount')
      amountCell.numFmt = '$#,##0.00'
      amountCell.font = {
        bold: true,
        color: { argb: t.type === 'expense' ? 'FFef4444' : 'FF22c55e' },
      }

      // Tag cell coloring
      if (t.tag) {
        const tagCell = row.getCell('tag')
        tagCell.font = {
          color: { argb: t.tag === 'Reimbursable' ? 'FF6366f1' : 'FFf59e0b' },
          bold: true,
        }
      }

      // Who cell coloring
      const whoCell = row.getCell('who')
      const whoColors: Record<string, string> = { Me: 'FF3b82f6', Partner: 'FFec4899', Shared: 'FF8b5cf6' }
      whoCell.font = { color: { argb: whoColors[t.who] ?? 'FF64748b' } }
    })

    // Summary section below the data
    const gapRow = sorted.length + 3
    const summaryStart = gapRow

    const summaryItems = [
      ['Starting Amount', monthData.startingAmount],
      ['Total Income', totalIncome],
      ['Total Expenses', totalExpenses],
      ['Balance', balance],
    ]
    summaryItems.forEach(([label, value], i) => {
      const row = ws.getRow(summaryStart + i)
      row.getCell(1).value = label as string
      row.getCell(1).font = { bold: true, color: { argb: 'FF334155' } }
      row.getCell(2).value = value as number
      row.getCell(2).numFmt = '$#,##0.00'
      const colors = ['FF64748b', 'FF22c55e', 'FFef4444', (balance >= 0 ? 'FF3b82f6' : 'FFef4444')]
      row.getCell(2).font = { bold: true, color: { argb: colors[i] } }
    })

    // Generate and download
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `budget-${key}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Merged category lists (preset + custom)
  const allExpenseCats = useMemo(() => [...EXPENSE_CATS, ...customExpenseCats], [customExpenseCats])
  const allIncomeCats = useMemo(() => [...INCOME_CATS, ...customIncomeCats], [customIncomeCats])
  const allCats = useMemo(() => [...allExpenseCats, ...allIncomeCats], [allExpenseCats, allIncomeCats])

  function catMeta(name: string) {
    return allCats.find((c) => c.name === name) ?? ALL_CATS.find((c) => c.name === name) ?? { emoji: '🏷️', color: '#9ca3af' }
  }
  const cats = form.type === 'expense' ? allExpenseCats : allIncomeCats

  // Save custom categories
  useEffect(() => {
    if (!loaded) return
    localStorage.setItem('budget-dash-custom-cats', JSON.stringify({ expense: customExpenseCats, income: customIncomeCats }))
  }, [customExpenseCats, customIncomeCats, loaded])

  // Save who names
  useEffect(() => {
    if (!loaded) return
    localStorage.setItem('budget-dash-who-names', JSON.stringify(whoNames))
  }, [whoNames, loaded])

  function addCustomCategory() {
    const name = newCatName.trim()
    if (!name) return
    const existing = allCats.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (existing) return
    const colorIdx = (customExpenseCats.length + customIncomeCats.length) % CUSTOM_CAT_COLORS.length
    const cat: CatDef = { name, emoji: newCatEmoji || '🏷️', color: CUSTOM_CAT_COLORS[colorIdx] }
    if (form.type === 'expense') setCustomExpenseCats((prev) => [...prev, cat])
    else setCustomIncomeCats((prev) => [...prev, cat])
    setForm((f) => ({ ...f, category: name }))
    setNewCatName('')
    setNewCatEmoji('🏷️')
    setAddingCat(false)
  }

  // Work/non-work pie data
  const workPieData = [
    { name: 'Reimbursable', value: workExpenses, color: '#6366f1' },
    { name: 'Personal', value: nonWorkExpenses, color: '#f59e0b' },
  ].filter((d) => d.value > 0)

  // Calendar helpers
  const txByDate = useMemo(() => {
    const map: Record<string, Transaction[]> = {}
    monthData.transactions.forEach((t) => {
      ;(map[t.date] ??= []).push(t)
    })
    return map
  }, [monthData.transactions])

  // Build calendar month grid (6 weeks max)
  const calMonthGrid = useMemo(() => {
    const first = new Date(year, month, 1)
    const startDay = first.getDay() // 0=Sun
    const days = daysInMonth(year, month)
    const cells: { date: Date; inMonth: boolean }[] = []
    // previous month padding
    for (let i = startDay - 1; i >= 0; i--) {
      const d = new Date(year, month, -i)
      cells.push({ date: d, inMonth: false })
    }
    // current month
    for (let d = 1; d <= days; d++) {
      cells.push({ date: new Date(year, month, d), inMonth: true })
    }
    // next month padding to fill last row
    while (cells.length % 7 !== 0) {
      const d = cells.length - startDay - days + 1
      cells.push({ date: new Date(year, month + 1, d), inMonth: false })
    }
    return cells
  }, [year, month])

  // Week view: get the week containing calDate
  const calWeekDays = useMemo(() => {
    const d = new Date(calDate)
    const day = d.getDay()
    const sun = new Date(d)
    sun.setDate(d.getDate() - day)
    return Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(sun)
      dt.setDate(sun.getDate() + i)
      return dt
    })
  }, [calDate])

  function fmtDateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function dayTotal(dateKey: string, type: TxType) {
    return (txByDate[dateKey] ?? []).filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0)
  }

  function calPrevPeriod() {
    if (calView === 'month') prevMonth()
    else if (calView === 'week') setCalDate((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
    else setCalDate((d) => { const n = new Date(d); n.setDate(n.getDate() - 1); return n })
  }

  function calNextPeriod() {
    if (calView === 'month') nextMonth()
    else if (calView === 'week') setCalDate((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })
    else setCalDate((d) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n })
  }

  // Sync calDate when month changes
  useEffect(() => {
    setCalDate(new Date(year, month, 1))
  }, [year, month])

  const calPeriodLabel = calView === 'month'
    ? `${MONTH_NAMES[month]} ${year}`
    : calView === 'week'
      ? `${calWeekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${calWeekDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : calDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  // Chart colors derived from theme
  const chartColors = useMemo(() => ({
    axis: theme === 'daylight' ? '#94a3b8' : theme === 'abyss' ? '#525252' : '#64748b',
    tooltipBg: theme === 'daylight' ? '#ffffff' : theme === 'abyss' ? '#0a0a0a' : '#1e293b',
    tooltipBorder: theme === 'daylight' ? '#e2e8f0' : theme === 'abyss' ? '#2a2a2a' : '#334155',
    tooltipText: theme === 'daylight' ? '#1e293b' : '#e2e8f0',
  }), [theme])

  const tooltipStyle = { backgroundColor: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, borderRadius: '8px', color: chartColors.tooltipText }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Budget Dash</h1>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-tertiary)]">
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={() => setCalOpen((v) => !v)}
            className={`font-semibold w-40 text-center flex items-center justify-center gap-1.5 py-1 rounded-lg transition-colors ${calOpen ? 'text-[var(--c-accent)] bg-[var(--c-accent-bg-subtle)]' : 'text-[var(--text-secondary)] hover:text-[var(--c-accent)]'}`}
          >
            <CalendarDays size={14} />
            {MONTH_NAMES[month]} {year}
          </button>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-tertiary)]">
            <ChevronRight size={20} />
          </button>
          <button
            onClick={exportExcel}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] rounded-lg border border-[var(--border-input)] transition-colors"
          >
            <FileSpreadsheet size={14} /> Export
          </button>
          {/* Theme toggle */}
          <div className="inline-flex rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] p-0.5">
            {([
              { key: 'midnight' as Theme, icon: <Moon size={13} />, label: 'Midnight' },
              { key: 'abyss' as Theme, icon: <Moon size={13} className="fill-current" />, label: 'Abyss' },
              { key: 'daylight' as Theme, icon: <Sun size={13} />, label: 'Daylight' },
            ]).map((t) => (
              <button
                key={t.key}
                onClick={() => setTheme(t.key)}
                title={t.label}
                className={`p-1.5 rounded-md transition-all ${
                  theme === t.key
                    ? 'bg-[var(--c-accent-bg)] text-[var(--c-accent)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {t.icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar Panel */}
      {calOpen && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-main)] p-4 space-y-3">
          {/* Calendar header: view tabs + period nav */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(['month', 'week', 'day'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setCalView(v)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    calView === v
                      ? 'bg-[var(--c-accent-bg)] text-[var(--c-accent)] border border-[var(--c-accent-border)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-input)]'
                  }`}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={calPrevPeriod} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-medium text-[var(--text-secondary)] min-w-48 text-center">{calPeriodLabel}</span>
              <button onClick={calNextPeriod} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
            <button
              onClick={() => { setCalDate(today); if (calView === 'month') { setYear(today.getFullYear()); setMonth(today.getMonth()) } }}
              className="px-2.5 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-md border border-[var(--border-subtle)] transition-colors"
            >
              Today
            </button>
          </div>

          {/* Month view */}
          {calView === 'month' && (
            <div>
              <div className="grid grid-cols-7 gap-px mb-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="text-center text-[10px] font-medium text-[var(--text-faint)] py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px">
                {calMonthGrid.map((cell, i) => {
                  const dk = fmtDateKey(cell.date)
                  const txs = txByDate[dk] ?? []
                  const exp = dayTotal(dk, 'expense')
                  const inc = dayTotal(dk, 'income')
                  const isToday = dk === fmtDateKey(today)
                  return (
                    <button
                      key={i}
                      onClick={() => { setCalDate(cell.date); setCalView('day') }}
                      className={`relative p-1.5 rounded-lg text-left min-h-[3.5rem] transition-colors ${
                        cell.inMonth ? 'hover:bg-[var(--bg-elevated)]' : 'opacity-30'
                      } ${isToday ? 'ring-1 ring-[var(--c-accent-border)]' : ''}`}
                    >
                      <div className={`text-xs font-medium ${isToday ? 'text-[var(--c-accent)]' : cell.inMonth ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-faint)]'}`}>
                        {cell.date.getDate()}
                      </div>
                      {txs.length > 0 && cell.inMonth && (
                        <div className="mt-0.5 space-y-0.5">
                          {exp > 0 && <div className="text-[9px] text-[var(--c-expense)] truncate">-{formatCurrency(exp)}</div>}
                          {inc > 0 && <div className="text-[9px] text-[var(--c-income)] truncate">+{formatCurrency(inc)}</div>}
                        </div>
                      )}
                      {txs.length > 0 && cell.inMonth && (
                        <div className="absolute top-1 right-1.5 flex gap-0.5">
                          {txs.slice(0, 3).map((tx) => (
                            <span key={tx.id} className="w-1 h-1 rounded-full" style={{ backgroundColor: catMeta(tx.category).color }} />
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Week view */}
          {calView === 'week' && (
            <div>
              <div className="grid grid-cols-7 gap-2">
                {calWeekDays.map((d) => {
                  const dk = fmtDateKey(d)
                  const txs = txByDate[dk] ?? []
                  const exp = dayTotal(dk, 'expense')
                  const inc = dayTotal(dk, 'income')
                  const isToday = dk === fmtDateKey(today)
                  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                  return (
                    <button
                      key={dk}
                      onClick={() => { setCalDate(d); setCalView('day') }}
                      className={`rounded-lg p-2 text-left transition-colors hover:bg-[var(--bg-elevated)] ${isToday ? 'ring-1 ring-[var(--c-accent-border)]' : ''}`}
                    >
                      <div className="text-[10px] text-[var(--text-faint)] font-medium">{dayNames[d.getDay()]}</div>
                      <div className={`text-sm font-semibold ${isToday ? 'text-[var(--c-accent)]' : 'text-[var(--text-secondary)]'}`}>{d.getDate()}</div>
                      <div className="mt-1 space-y-0.5 min-h-[3rem]">
                        {exp > 0 && <div className="text-[10px] text-[var(--c-expense)]">-{formatCurrency(exp)}</div>}
                        {inc > 0 && <div className="text-[10px] text-[var(--c-income)]">+{formatCurrency(inc)}</div>}
                        {txs.map((tx) => (
                          <div key={tx.id} className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] truncate">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: catMeta(tx.category).color }} />
                            {catMeta(tx.category).emoji} {formatCurrency(tx.amount)}
                          </div>
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Day view */}
          {calView === 'day' && (() => {
            const dk = fmtDateKey(calDate)
            const txs = txByDate[dk] ?? []
            const exp = dayTotal(dk, 'expense')
            const inc = dayTotal(dk, 'income')
            return (
              <div>
                <div className="flex items-center gap-4 mb-3">
                  {exp > 0 && <span className="text-sm text-[var(--c-expense)] font-medium">Expenses: {formatCurrency(exp)}</span>}
                  {inc > 0 && <span className="text-sm text-[var(--c-income)] font-medium">Income: {formatCurrency(inc)}</span>}
                  {txs.length === 0 && <span className="text-sm text-[var(--text-faint)]">No transactions</span>}
                </div>
                {txs.length > 0 && (
                  <div className="space-y-1">
                    {txs.map((tx) => {
                      const meta = catMeta(tx.category)
                      return (
                        <div key={tx.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)] transition-colors">
                          <span className="text-lg">{meta.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--text-secondary)]">{tx.category}</span>
                              <span className="text-xs text-[var(--text-faint)]">{whoNames[tx.who as Who]}</span>
                              {tx.tag && (
                                <span className={`text-[10px] px-1 py-0.5 rounded-full ${
                                  tx.tag === 'Reimbursable'
                                    ? 'bg-[var(--c-tag-reimb-bg)] text-[var(--c-accent)] border border-[var(--c-tag-reimb-border)]'
                                    : 'bg-[var(--c-tag-personal-bg)] text-[var(--c-tag-personal)] border border-[var(--c-tag-personal-border)]'
                                }`}>{tx.tag}</span>
                              )}
                            </div>
                            {tx.note && <p className="text-xs text-[var(--text-faint)] truncate">{tx.note}</p>}
                          </div>
                          <div className="text-right">
                            <div
                              className="text-sm font-semibold"
                              style={{ color: tx.type === 'expense' ? 'var(--expense-color)' : 'var(--income-color)' }}
                            >
                              {tx.type === 'expense' ? '-' : '+'}{formatCurrency(tx.amount)}
                            </div>
                            {toEur(tx.amount) != null && (
                              <div className="text-[10px] text-[var(--text-faint)]">{tx.type === 'expense' ? '-' : '+'}{formatEur(toEur(tx.amount)!)}</div>
                            )}
                          </div>
                          <button
                            onClick={() => { startEdit(tx); setCalOpen(false) }}
                            className="p-1 text-[var(--text-faint)] hover:text-[var(--c-accent)] transition-all"
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Starting Amount Input */}
      <div className="bg-gradient-to-r from-[var(--banner-from)] to-[var(--banner-to)] rounded-xl border border-[var(--banner-border)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--c-accent-bg)] rounded-lg">
              <DollarSign size={20} className="text-[var(--c-accent)]" />
            </div>
            <div>
              <p className="text-xs text-[var(--c-accent)] font-medium">Starting Amount for {MONTH_NAMES[month]}</p>
              <p className="text-xs text-[var(--banner-text-dim)]">How much do you have at the start of this month?</p>
            </div>
          </div>
          {editingStarting ? (
            <div className="flex items-center gap-2">
              <span className="text-xl text-[var(--c-accent)]">$</span>
              <input
                autoFocus
                type="number"
                min="0"
                step="0.01"
                className="w-40 bg-[var(--bg-card)] border border-[var(--btn-primary)] rounded-lg px-3 py-2 text-xl font-bold text-[var(--text-primary)] outline-none focus:border-[var(--c-accent)]"
                value={startingInput}
                onChange={(e) => setStartingInput(e.target.value)}
                onBlur={commitStarting}
                onKeyDown={(e) => e.key === 'Enter' && commitStarting()}
              />
              <button onClick={commitStarting} className="px-3 py-2 bg-[var(--btn-primary)] text-white rounded-lg text-sm hover:bg-[var(--btn-primary-hover)] transition-colors">
                Set
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditingStarting(true)}
                className="text-2xl font-bold text-[var(--text-primary)] hover:text-[var(--c-accent)] transition-colors"
              >
                {monthData.startingAmount > 0 ? formatCurrency(monthData.startingAmount) : 'Set amount →'}
              </button>
              {monthData.startingAmount > 0 && toEur(monthData.startingAmount) != null && (
                <span className="text-sm text-[var(--text-faint)]">({formatEur(toEur(monthData.startingAmount)!)})</span>
              )}
              {lastAction === 'starting' && (
                <button
                  onClick={handleUndo}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--c-accent)] bg-[var(--c-accent-bg-subtle)] border border-indigo-500/20 rounded-md hover:bg-[var(--c-accent-bg)] transition-all"
                >
                  <Undo2 size={11} /> Undo
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Transaction + Transactions side by side */}
      <div className="grid md:grid-cols-12 gap-4 items-start">

      {/* Add Transaction */}
      <div className="md:col-span-7 bg-[var(--bg-card)] rounded-xl border border-[var(--border-main)] p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[var(--text-primary)] text-lg flex items-center gap-2">
            {editingTxId ? <><Pencil size={18} className="text-[var(--btn-edit)]" /> Edit Transaction</> : <><Plus size={18} className="text-[var(--c-accent)]" /> Add Transaction</>}
          </h2>
          {editingTxId && (
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-subtle)] transition-colors"
            >
              <X size={12} /> Cancel
            </button>
          )}
        </div>

        {/* Type toggle */}
        <div className="flex gap-2">
          {(['expense', 'income'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                const defaultCat = t === 'expense' ? EXPENSE_CATS[0].name : INCOME_CATS[0].name
                setForm((f) => ({ ...f, type: t, category: defaultCat }))
              }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                form.type === t
                  ? t === 'expense'
                    ? 'bg-[var(--c-expense-bg)] text-[var(--c-expense)] border-2 border-[var(--c-expense-border)]'
                    : 'bg-[var(--c-income-bg)] text-[var(--c-income)] border-2 border-[var(--c-income-border)]'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border-2 border-transparent hover:bg-[var(--bg-hover)]'
              }`}
            >
              {t === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>

        {/* Category pills */}
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] block mb-2">Category</label>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <button
                key={c.name}
                onClick={() => setForm((f) => ({ ...f, category: c.name }))}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all ${
                  form.category === c.name
                    ? 'bg-[var(--c-accent-bg)] text-[var(--text-primary)] border border-[var(--c-accent-border-strong)] shadow-sm shadow-[var(--c-accent-border)]'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <span className="text-base">{c.emoji}</span> {c.name}
              </button>
            ))}
            {addingCat ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  maxLength={4}
                  value={newCatEmoji}
                  onChange={(e) => setNewCatEmoji(e.target.value)}
                  className="w-10 px-1 py-2 text-center text-base bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg outline-none focus:border-[var(--c-accent)]"
                />
                <input
                  autoFocus
                  type="text"
                  placeholder="Name"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustomCategory(); if (e.key === 'Escape') setAddingCat(false) }}
                  className="w-28 px-2 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg text-[var(--text-secondary)] placeholder-[var(--text-faint)] outline-none focus:border-[var(--c-accent)]"
                />
                <button onClick={addCustomCategory} className="px-2 py-2 bg-[var(--btn-primary)] text-white rounded-lg text-xs hover:bg-[var(--btn-primary-hover)] transition-colors">Add</button>
                <button onClick={() => { setAddingCat(false); setNewCatName(''); setNewCatEmoji('🏷️') }} className="p-2 text-[var(--text-faint)] hover:text-[var(--text-tertiary)] transition-colors"><X size={14} /></button>
              </div>
            ) : (
              <button
                onClick={() => setAddingCat(true)}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm bg-[var(--bg-elevated)] text-[var(--text-faint)] border border-dashed border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-tertiary)] transition-all"
              >
                <Plus size={14} /> Custom
              </button>
            )}
          </div>
        </div>

        {/* Amount + Date row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-2">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[var(--text-muted)] font-semibold">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-full pl-8 pr-4 py-3 text-lg font-semibold bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-faint)] outline-none focus:border-[var(--c-accent)] focus:ring-1 focus:ring-[var(--c-accent-border)] transition-all"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] block mb-2">Date</label>
            <input
              type="date"
              className="w-full px-4 py-3 text-sm bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg text-[var(--text-secondary)] outline-none focus:border-[var(--c-accent)] focus:ring-1 focus:ring-[var(--c-accent-border)] transition-all"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
        </div>

        {/* Who + Tag row */}
        <div className={`grid grid-cols-1 ${form.type === 'expense' ? 'md:grid-cols-2' : ''} gap-4`}>
          {/* Who segmented toggle */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs font-medium text-[var(--text-muted)]">Who</label>
              <button
                onClick={() => setEditingWhoNames((v) => !v)}
                className="p-0.5 text-[var(--text-faint)] hover:text-[var(--c-accent)] transition-colors"
                title="Rename"
              >
                <Pencil size={10} />
              </button>
            </div>
            {editingWhoNames ? (
              <div className="flex gap-1.5 items-center">
                {(['Me', 'Partner', 'Shared'] as const).map((who) => (
                  <input
                    key={who}
                    type="text"
                    maxLength={12}
                    className="w-full px-2 py-1.5 text-sm text-center bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg text-[var(--text-secondary)] outline-none focus:border-[var(--c-accent)]"
                    value={whoNames[who]}
                    onChange={(e) => setWhoNames((prev) => ({ ...prev, [who]: e.target.value || who }))}
                  />
                ))}
                <button
                  onClick={() => setEditingWhoNames(false)}
                  className="p-1.5 text-[var(--text-faint)] hover:text-[var(--text-tertiary)] transition-colors flex-shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="inline-flex rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] p-0.5">
                {(['Me', 'Partner', 'Shared'] as const).map((who) => {
                  const colors: Record<Who, string> = {
                    Me: 'bg-[var(--c-who-me-bg)] text-[var(--c-who-me)] border border-[var(--c-who-me-border)]',
                    Partner: 'bg-[var(--c-who-partner-bg)] text-[var(--c-who-partner)] border border-[var(--c-who-partner-border)]',
                    Shared: 'bg-[var(--c-who-shared-bg)] text-[var(--c-who-shared)] border border-[var(--c-who-shared-border)]',
                  }
                  return (
                    <button
                      key={who}
                      onClick={() => setForm((f) => ({ ...f, who }))}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        form.who === who
                          ? colors[who] + ' shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent'
                      }`}
                    >
                      {whoNames[who]}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Tag segmented toggle (expense only) */}
          {form.type === 'expense' && (
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] block mb-2">Tag</label>
              <div className="inline-flex rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] p-0.5">
                {(['Personal', 'Reimbursable'] as const).map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setForm((f) => ({ ...f, tag }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      form.tag === tag
                        ? tag === 'Reimbursable'
                          ? 'bg-[var(--c-accent-bg)] text-[var(--c-accent)] border border-[var(--c-accent-border)] shadow-sm'
                          : 'bg-[var(--c-tag-personal-bg)] text-[var(--c-tag-personal)] border border-[var(--c-tag-personal-border)] shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent'
                    }`}
                  >
                    {tag === 'Reimbursable' ? <Briefcase size={13} /> : <Coffee size={13} />}
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Note + Save */}
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Add a note (optional)"
            className="flex-1 px-4 py-3 text-sm bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg text-[var(--text-secondary)] placeholder-[var(--text-faint)] outline-none focus:border-[var(--c-accent)] focus:ring-1 focus:ring-[var(--c-accent-border)] transition-all"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && (editingTxId ? saveEdit() : addTransaction())}
          />
          {editingTxId ? (
            <button
              onClick={saveEdit}
              className="px-6 py-3 bg-[var(--btn-edit)] text-white rounded-lg font-semibold hover:bg-[var(--btn-edit-hover)] transition-colors flex items-center gap-2 text-sm whitespace-nowrap"
            >
              <Pencil size={16} /> Save
            </button>
          ) : (
            <>
              <button
                onClick={addTransaction}
                className="px-6 py-3 bg-[var(--btn-primary)] text-white rounded-lg font-semibold hover:bg-[var(--btn-primary-hover)] transition-colors flex items-center gap-2 text-sm whitespace-nowrap"
              >
                <Plus size={16} /> Add
              </button>
              {lastAction === 'add' && (
                <button
                  onClick={handleUndo}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--c-tag-personal)] bg-[var(--c-tag-personal-bg-subtle)] border border-amber-500/20 rounded-lg hover:bg-[var(--c-tag-personal-bg)] transition-all"
                >
                  <Undo2 size={11} /> Undo
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Transactions */}
      <div className="md:col-span-5 bg-[var(--bg-card)] rounded-xl border border-[var(--border-main)] p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-[var(--text-secondary)]">Transactions</h2>
            {lastAction === 'delete' && (
              <button
                onClick={handleUndo}
                className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--c-expense)] bg-[var(--c-expense-bg-subtle)] border border-red-500/20 rounded-md hover:bg-[var(--c-expense-bg)] transition-all"
              >
                <Undo2 size={11} /> Undo delete
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              type="text"
              placeholder="Search..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg text-[var(--text-secondary)] placeholder-[var(--text-faint)]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="text-xs bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg px-1.5 py-1.5 text-[var(--text-secondary)]"
            value={filterWho}
            onChange={(e) => setFilterWho(e.target.value as Who | 'All')}
          >
            <option value="All">Who</option>
            <option value="Me">{whoNames.Me}</option>
            <option value="Partner">{whoNames.Partner}</option>
            <option value="Shared">{whoNames.Shared}</option>
          </select>
          <select
            className="text-xs bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg px-1.5 py-1.5 text-[var(--text-secondary)]"
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
          >
            <option value="All">Category</option>
            {allCats.map((c) => (
              <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>
            ))}
          </select>
          <select
            className="text-xs bg-[var(--bg-input)] border border-[var(--border-input)] rounded-lg px-1.5 py-1.5 text-[var(--text-secondary)]"
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value as ExpenseTag | 'All')}
          >
            <option value="All">Tag</option>
            <option value="Reimbursable">Reimbursable</option>
            <option value="Personal">Personal</option>
          </select>
        </div>

        {/* Transaction list */}
        {filtered.length === 0 ? (
          <p className="text-[var(--text-faint)] text-sm text-center py-6">No transactions found</p>
        ) : (
          <div className="space-y-1 flex-1 overflow-y-auto max-h-[28rem]">
            {[...filtered].sort((a, b) => b.date.localeCompare(a.date)).map((t) => {
              const meta = catMeta(t.category)
              const tag = t.tag ?? (t.type === 'expense' ? 'Personal' : null)
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors group ${
                    editingTxId === t.id
                      ? 'bg-[var(--c-tag-personal-bg-subtle)] border border-amber-500/30'
                      : 'hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  <span className="text-base w-6 flex-shrink-0">{meta.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-[var(--text-secondary)] truncate">{t.category}</span>
                      <span className="text-xs text-[var(--text-faint)]">{whoNames[t.who as Who]}</span>
                      {tag && (
                        <span className={`text-[10px] px-1 py-0.5 rounded-full ${
                          tag === 'Reimbursable'
                            ? 'bg-[var(--c-tag-reimb-bg)] text-[var(--c-accent)] border border-[var(--c-tag-reimb-border)]'
                            : 'bg-[var(--c-tag-personal-bg)] text-[var(--c-tag-personal)] border border-[var(--c-tag-personal-border)]'
                        }`}>
                          {tag}
                        </span>
                      )}
                    </div>
                    {t.note && <p className="text-xs text-[var(--text-faint)] truncate">{t.note}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div
                      className="text-sm font-semibold"
                      style={{ color: t.type === 'expense' ? 'var(--expense-color)' : 'var(--income-color)' }}
                    >
                      {t.type === 'expense' ? '-' : '+'}{formatCurrency(t.amount)}
                    </div>
                    {toEur(t.amount) != null && (
                      <div className="text-[10px] text-[var(--text-faint)]">{t.type === 'expense' ? '-' : '+'}{formatEur(toEur(t.amount)!)}</div>
                    )}
                    <div className="text-[10px] text-[var(--text-faint)]">{t.date}</div>
                  </div>
                  <button
                    onClick={() => startEdit(t)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-faint)] hover:text-[var(--c-accent)] transition-all"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => deleteTransaction(t.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-faint)] hover:text-[var(--c-expense)] transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      </div>{/* end grid */}

      {/* Summary Overview */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-main)] p-5 space-y-4">
        <h2 className="font-semibold text-[var(--text-primary)] text-lg">Monthly Overview</h2>

        {/* Balance cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[var(--bg-elevated)] rounded-lg p-3 border border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--text-muted)]">Starting</p>
            <p className="text-lg font-bold text-[var(--text-secondary)]">{formatCurrency(monthData.startingAmount)}</p>
            {toEur(monthData.startingAmount) != null && <p className="text-xs text-[var(--text-faint)]">{formatEur(toEur(monthData.startingAmount)!)}</p>}
          </div>
          <div className="bg-[var(--bg-elevated)] rounded-lg p-3 border border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--c-income)]">Income</p>
            <p className="text-lg font-bold text-[var(--c-income)]">{formatCurrency(totalIncome)}</p>
            {toEur(totalIncome) != null && <p className="text-xs text-[var(--text-faint)]">{formatEur(toEur(totalIncome)!)}</p>}
          </div>
          <div className="bg-[var(--bg-elevated)] rounded-lg p-3 border border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--c-expense)]">Expenses</p>
            <p className="text-lg font-bold text-[var(--c-expense)]">{formatCurrency(totalExpenses)}</p>
            {toEur(totalExpenses) != null && <p className="text-xs text-[var(--text-faint)]">{formatEur(toEur(totalExpenses)!)}</p>}
          </div>
          <div className="bg-[var(--bg-elevated)] rounded-lg p-3 border border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--c-who-me)]">Balance</p>
            <p className={`text-lg font-bold ${balance >= 0 ? 'text-[var(--c-who-me)]' : 'text-[var(--c-expense)]'}`}>{formatCurrency(balance)}</p>
            {toEur(balance) != null && <p className="text-xs text-[var(--text-faint)]">{formatEur(toEur(balance)!)}</p>}
          </div>
        </div>

        {/* Budget progress */}
        {budget > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm text-[var(--text-muted)]">
              <span>Budget used</span>
              <span>{Math.round(spentRatio * 100)}%</span>
            </div>
            <div className="h-3 bg-[var(--bg-input)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${spentRatio * 100}%`, backgroundColor: progressColor }}
              />
            </div>
            <div className="flex justify-between text-xs text-[var(--text-faint)]">
              <span>{formatCurrency(totalExpenses)} spent{toEur(totalExpenses) != null && ` (${formatEur(toEur(totalExpenses)!)})`}</span>
              <span>{formatCurrency(budget)} limit{toEur(budget) != null && ` (${formatEur(toEur(budget)!)})`}</span>
            </div>
          </div>
        )}

        {/* Who breakdown + Reimbursable/Personal */}
        <div className="grid md:grid-cols-3 gap-3">
          {/* By person */}
          <div className="bg-[var(--bg-elevated)] rounded-lg p-3 border border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--text-muted)] mb-2 font-medium">Expenses by Person</p>
            {(['Me', 'Partner', 'Shared'] as const).map((who) => (
              <div key={who} className="flex justify-between text-sm py-0.5">
                <span className="text-[var(--text-tertiary)]">{whoNames[who]}</span>
                <div className="text-right">
                  <span className="text-[var(--text-secondary)] font-medium">{formatCurrency(byWho[who] ?? 0)}</span>
                  {toEur(byWho[who] ?? 0) != null && <span className="text-[10px] text-[var(--text-faint)] ml-1">({formatEur(toEur(byWho[who] ?? 0)!)})</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Reimbursable vs Personal */}
          <div className="bg-[var(--bg-elevated)] rounded-lg p-3 border border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--text-muted)] mb-2 font-medium">Reimbursable vs Personal</p>
            <div className="flex justify-between text-sm py-0.5">
              <span className="flex items-center gap-1.5 text-[var(--c-accent)]"><Briefcase size={12} /> Reimbursable</span>
              <div className="text-right">
                <span className="text-[var(--text-secondary)] font-medium">{formatCurrency(workExpenses)}</span>
                {toEur(workExpenses) != null && <span className="text-[10px] text-[var(--text-faint)] ml-1">({formatEur(toEur(workExpenses)!)})</span>}
              </div>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="flex items-center gap-1.5 text-[var(--c-tag-personal)]"><Coffee size={12} /> Personal</span>
              <div className="text-right">
                <span className="text-[var(--text-secondary)] font-medium">{formatCurrency(nonWorkExpenses)}</span>
                {toEur(nonWorkExpenses) != null && <span className="text-[10px] text-[var(--text-faint)] ml-1">({formatEur(toEur(nonWorkExpenses)!)})</span>}
              </div>
            </div>
            {totalExpenses > 0 && (
              <div className="mt-2 h-2 bg-[var(--progress-track)] rounded-full overflow-hidden flex">
                {workExpenses > 0 && (
                  <div className="h-full bg-indigo-500" style={{ width: `${(workExpenses / totalExpenses) * 100}%` }} />
                )}
                {nonWorkExpenses > 0 && (
                  <div className="h-full bg-amber-500" style={{ width: `${(nonWorkExpenses / totalExpenses) * 100}%` }} />
                )}
              </div>
            )}
          </div>

          {/* Quick stats */}
          <div className="bg-[var(--bg-elevated)] rounded-lg p-3 border border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--text-muted)] mb-2 font-medium">Quick Stats</p>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-[var(--text-tertiary)]">Transactions</span>
              <span className="text-[var(--text-secondary)] font-medium">{monthData.transactions.length}</span>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-[var(--text-tertiary)]">Avg expense</span>
              <span className="text-[var(--text-secondary)] font-medium">{expenses.length > 0 ? formatCurrency(totalExpenses / expenses.length) : '$0.00'}</span>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-[var(--text-tertiary)]">Top category</span>
              <span className="text-[var(--text-secondary)] font-medium text-right truncate ml-2">
                {pieData.length > 0 ? (() => { const top = [...pieData].sort((a, b) => b.value - a.value)[0]; return catMeta(top.name).emoji + ' ' + top.name })() : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Pie - Spending by Category */}
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-main)] p-4">
          <h2 className="font-semibold text-[var(--text-secondary)] mb-3">Spending by Category</h2>
          {pieData.length === 0 ? (
            <p className="text-[var(--text-faint)] text-sm text-center py-8">No expenses yet</p>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={65}>
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={catMeta(entry.name).color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => { const n = Number(v); const eur = toEur(n); return eur != null ? `${formatCurrency(n)} (${formatEur(eur)})` : formatCurrency(n) }}
                    contentStyle={tooltipStyle}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1 text-sm">
                {[...pieData].sort((a, b) => b.value - a.value).map((d) => {
                  const meta = catMeta(d.name)
                  return (
                    <div key={d.name} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }} />
                      <span className="flex-1 text-[var(--text-muted)] truncate">{meta.emoji} {d.name}</span>
                      <span className="font-medium text-[var(--text-secondary)]">{formatCurrency(d.value)}</span>
                      {toEur(d.value) != null && <span className="text-[10px] text-[var(--text-faint)]">({formatEur(toEur(d.value)!)})</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Bar - Daily Activity */}
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-main)] p-4">
          <h2 className="font-semibold text-[var(--text-secondary)] mb-3">Daily Activity</h2>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={barData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: chartColors.axis }} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: chartColors.axis }} />
              <Tooltip
                formatter={(v) => { const n = Number(v); const eur = toEur(n); return eur != null ? `${formatCurrency(n)} (${formatEur(eur)})` : formatCurrency(n) }}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="expense" fill="#ef4444" name="Expense" radius={[2,2,0,0]} />
              <Bar dataKey="income"  fill="#22c55e" name="Income"  radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Reimbursable/Personal pie */}
        {workPieData.length > 0 && (
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-main)] p-4">
            <h2 className="font-semibold text-[var(--text-secondary)] mb-3">Reimbursable vs Personal Expenses</h2>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={workPieData} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={65}>
                    {workPieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => { const n = Number(v); const eur = toEur(n); return eur != null ? `${formatCurrency(n)} (${formatEur(eur)})` : formatCurrency(n) }}
                    contentStyle={tooltipStyle}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {workPieData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-sm text-[var(--text-muted)]">{d.name}</span>
                    <span className="text-sm font-medium text-[var(--text-secondary)]">{formatCurrency(d.value)}</span>
                    <span className="text-xs text-[var(--text-faint)]">({totalExpenses > 0 ? Math.round((d.value / totalExpenses) * 100) : 0}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
