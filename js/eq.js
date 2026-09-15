<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>EQ Survey — E&amp;C Portal</title>
  <link rel="stylesheet" href="style.css"/>
  <style>
    .page{max-width:780px;margin:0 auto;padding:28px 20px 64px}
    .page-head{margin-bottom:24px}
    .page-head h1{font-size:1.2rem;font-weight:700;letter-spacing:-.02em}
    .page-head p{font-size:0.8rem;color:var(--muted);margin-top:4px}
    .controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px}
    .ctrl-label{font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
    .ctrl-select{padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:0.875rem;font-weight:600;color:var(--text);background:var(--surface);outline:none;cursor:pointer}
    .ctrl-select:focus{border-color:var(--navy)}
    .eq-table{width:100%;border-collapse:collapse;font-size:0.875rem}
    .eq-table thead tr{background:#F0F4FA}
    .eq-table th{padding:10px 14px;font-size:0.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--border);text-align:center}
    .eq-table th:first-child{text-align:left}
    .eq-table td{border:1px solid var(--border);vertical-align:middle}
    .eq-table tbody tr:hover td{background:#fafbfc}
    .eq-table tfoot td{background:#EEF3FA;border:1px solid var(--border);font-weight:700;padding:9px 14px;text-align:center}
    .eq-table tfoot td:first-child{text-align:left;color:var(--navy)}
    .eq-input{width:80px;padding:6px 8px;border:1.5px solid var(--border);border-radius:7px;font-family:inherit;font-size:0.875rem;text-align:center;background:#fff;outline:none;transition:border-color 160ms,box-shadow 160ms}
    .eq-input:focus{border-color:var(--navy);box-shadow:0 0 0 3px rgba(30,58,95,.09)}
    .eq-input::-webkit-outer-spin-button,.eq-input::-webkit-inner-spin-button{-webkit-appearance:none}
    .save-bar{display:flex;align-items:center;gap:14px;padding:18px 0;flex-wrap:wrap}
    .btn-save{padding:11px 32px;border-radius:9px;background:var(--navy);color:#fff;border:none;font-family:inherit;font-size:0.875rem;font-weight:700;cursor:pointer;transition:background 160ms}
    .btn-save:hover{background:var(--steel)}
    .btn-save:disabled{opacity:.5;cursor:not-allowed}
    .save-msg{font-size:0.875rem}
    .save-msg.success{color:var(--sage)}
    .save-msg.error{color:var(--rust)}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-brand">
      <div class="brand-icon">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
          <rect x="2" y="2" width="6" height="6" rx="1.5" fill="white"/>
          <rect x="10" y="2" width="6" height="6" rx="1.5" fill="white" opacity=".6"/>
          <rect x="2" y="10" width="6" height="6" rx="1.5" fill="white" opacity=".6"/>
          <rect x="10" y="10" width="6" height="6" rx="1.5" fill="white" opacity=".3"/>
        </svg>
      </div>
      <span class="brand-name">E&amp;C Portal</span>
    </div>
    <div class="topbar-right">
      <a href="index.html"     class="topbar-link">← Home</a>
      <a href="dashboard.html" class="topbar-link">← My Portal</a>
      <span class="user-badge" id="topbarEmail"></span>
      <button class="logout-btn" id="logoutBtn">Log out</button>
    </div>
  </header>

  <div class="page">
    <div class="page-head">
      <h1>📊 EQ Survey</h1>
      <p>Enter monthly EQ survey plan and completion data.</p>
    </div>

    <div class="controls">
      <span class="ctrl-label">Year</span>
      <select class="ctrl-select" id="yearSelect"></select>
    </div>

    <div class="card">
      <table class="eq-table">
        <thead>
          <tr>
            <th style="min-width:120px;text-align:left;">Month</th>
            <th style="width:120px;">Plan</th>
            <th style="width:120px;">Completed</th>
            <th style="width:90px;">Achievement</th>
            <th style="min-width:120px;">Progress</th>
          </tr>
        </thead>
        <tbody id="tableBody">
          <tr><td colspan="5" style="padding:20px;text-align:center;color:var(--muted)">Loading…</td></tr>
        </tbody>
        <tfoot>
          <tr>
            <td>YTD Total</td>
            <td id="totPlan">—</td>
            <td id="totComplete">—</td>
            <td id="totPct">—</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="save-bar">
      <button class="btn-save" id="saveBtn">💾 Save Data</button>
      <span class="save-msg" id="saveMsg"></span>
    </div>
  </div>

  <script type="module" src="js/eq.js"></script>
</body>
</html>
