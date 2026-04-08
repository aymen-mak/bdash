# Budget Dash

A clean, color-coded monthly budgeting dashboard built for couples. Set your starting amount each month, track expenses and income as you go, and see your remaining balance at a glance.

## Features

- **Monthly starting amount**: Set how much you have at the start of each month
- **Checks & balances**: Balance = Starting Amount + Income - Expenses
- **Color-coded categories**: 10 expense + 5 income categories with emojis
- **Who tracking**: Tag each transaction as Me / Partner / Shared
- **Visual breakdown**: Pie chart for spending categories, bar chart for daily activity
- **Budget progress bar**: Color shifts from green to gold to red as you approach your limit
- **Search & filter**: Quick search across categories, notes, and who
- **CSV export**: Download the current month's transactions
- **Local storage**: All data stays in your browser

## Deploy on Vercel

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repository
4. Click Deploy (zero config needed)

## Quick Start (local)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

Next.js 15 + TypeScript + Tailwind CSS + Recharts + Lucide Icons
