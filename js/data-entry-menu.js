// Shared "Data Entry" shortcut for the top bar.
// Shown only to Data Entry and Admin users, on any page that calls setDataEntryMenu(role).
// This is only navigation: access to each page is still enforced by guardRole + Firestore rules.

export const DATA_ENTRY_PAGES = [
  { href: "leave.html",        icon: "📋", name: "Leave Plan" },
  { href: "yeep.html",         icon: "🔧", name: "YEEP" },
  { href: "welfare.html",      icon: "🤝", name: "Welfare" },
  { href: "disciplinary.html", icon: "⚖️", name: "Disciplinary" },
  { href: "eq.html",           icon: "📊", name: "EQ Survey" },
  { href: "cvt.html",          icon: "🎯", name: "Core Value Training" },
  { href: "ta.html",           icon: "👥", name: "Talent Acquisition" },
  { href: "mom.html",          icon: "📝", name: "Meeting Minutes" }
];

const ELIGIBLE = ["admin", "data_entry"];
const MENU_ID  = "deMenu";
const STYLE_ID = "deMenuStyle";
let listenersAttached = false;

const CSS = `
.de-menu{position:relative;display:inline-block;margin-right:12px}
.de-menu-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;border:1px solid #DDE1E7;background:#fff;color:#1E3A5F;font-family:inherit;font-size:.78rem;font-weight:700;cursor:pointer;white-space:nowrap}
.de-menu-btn:hover,.de-menu.open .de-menu-btn{background:#F0F4FA}
.de-caret{font-size:.65rem;transition:transform 150ms}
.de-menu.open .de-caret{transform:rotate(180deg)}
.de-menu-list{display:none;position:absolute;top:calc(100% + 8px);right:0;min-width:230px;background:#fff;border:1px solid #DDE1E7;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.16);padding:6px;z-index:500}
.de-menu.open .de-menu-list{display:block}
.de-menu-list a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;font-size:.82rem;font-weight:500;color:#0F1923;text-decoration:none;white-space:nowrap}
.de-menu-list a:hover,.de-menu-list a:focus-visible{background:#F0F4FA;outline:none}
@media(max-width:600px){
  .de-menu{position:static;margin-right:8px}
  .de-menu-list{position:fixed;left:12px;right:12px;top:56px;min-width:0}
}`;

function closeMenu() {
  const m = document.getElementById(MENU_ID);
  if (!m) return;
  m.classList.remove("open");
  m.querySelector(".de-menu-btn")?.setAttribute("aria-expanded", "false");
}

function attachGlobalListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener("click", e => {
    const m = document.getElementById(MENU_ID);
    if (m && !m.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
}

/** Show the menu for admin / data_entry; remove it for anyone else (or when logged out). */
export function setDataEntryMenu(role) {
  const existing = document.getElementById(MENU_ID);
  if (!ELIGIBLE.includes(role)) { existing?.remove(); return; }
  if (existing) return;                                   // already shown

  const bar = document.querySelector(".topbar-right");
  if (!bar) return;

  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement("style");
    s.id = STYLE_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }

  const wrap = document.createElement("div");
  wrap.id = MENU_ID; wrap.className = "de-menu";
  wrap.innerHTML =
    `<button type="button" class="de-menu-btn" aria-haspopup="true" aria-expanded="false">📝 Data Entry <span class="de-caret">▾</span></button>` +
    `<div class="de-menu-list" role="menu">` +
    DATA_ENTRY_PAGES.map(p => `<a role="menuitem" href="${p.href}"><span>${p.icon}</span>${p.name}</a>`).join("") +
    `</div>`;

  // Sit just before the login status / email badge when the page has one
  const anchor = bar.querySelector("#userStatus") || bar.querySelector("#topbarEmail");
  bar.insertBefore(wrap, anchor && anchor.parentNode === bar ? anchor : bar.firstChild);

  const btn = wrap.querySelector(".de-menu-btn");
  btn.addEventListener("click", () => {
    const open = wrap.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  attachGlobalListeners();
}
