import { useState, useEffect, useCallback, useRef } from "react";

const CREDS_STORAGE_KEY = "nexussdlc.creds.v1";
const JIRA_ISSUES_STORAGE_KEY = "nexussdlc.jira.openIssues.v1";
const ENV = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};

function normalizeJiraBaseUrl(rawUrl = "") {
  const input = String(rawUrl).trim();
  if (!input) return "";
  try {
    const parsed = new URL(input.startsWith("http") ? input : `https://${input}`);
    return parsed.origin;
  } catch {
    return input.replace(/\/+$/, "");
  }
}

function firstEnv(...keys) {
  for (const key of keys) {
    const value = ENV?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function sanitizeSecret(value = "") {
  return String(value).replace(/\s+/g, "");
}

function envCredOverrides() {
  const jiraUrl = normalizeJiraBaseUrl(firstEnv("JIRA_URL", "VITE_JIRA_URL"));
  const jiraEmail = firstEnv("JIRA_EMAIL", "VITE_JIRA_EMAIL");
  const jiraToken = firstEnv("JIRA_TOKEN", "VITE_JIRA_TOKEN");
  const jiraProjectKey = firstEnv("JIRA_KEY", "VITE_JIRA_KEY").toUpperCase();
  const githubToken = firstEnv("GITHUB_TOKEN", "VITE_GITHUB_TOKEN");
  const githubUsername = firstEnv("GITHUB_USERNAME", "VITE_GITHUB_USERNAME");
  const githubRepo = firstEnv("GITHUB_REPO", "VITE_GITHUB_REPO");
  const githubOwner = firstEnv("GITHUB_OWNER", "VITE_GITHUB_OWNER");

  const out = {};
  if (jiraUrl) out.jiraUrl = jiraUrl;
  if (jiraEmail) out.jiraEmail = jiraEmail;
  if (jiraToken) out.jiraToken = jiraToken;
  if (jiraProjectKey) out.jiraProjectKey = jiraProjectKey;
  if (githubToken) out.githubToken = githubToken;
  if (githubUsername) out.githubUsername = githubUsername;
  if (githubRepo) out.githubRepo = githubRepo;
  if (githubOwner) out.githubOwner = githubOwner;
  return out;
}

// In-memory caches for the current app session.
const JIRA_MEM_CACHE = {
  projects: null,
  issuesByJql: new Map(),
};

const GITHUB_MEM_CACHE = {
  repos: null,
  repoMetaByFullName: new Map(), // fullName -> { branches, langs }
};

function isIssueDone(issue) {
  const statusName = String(issue?.fields?.status?.name || "").toLowerCase();
  const statusCategory = String(issue?.fields?.status?.statusCategory?.key || "").toLowerCase();
  return (
    statusCategory === "done" ||
    statusName.includes("done") ||
    statusName.includes("closed") ||
    statusName.includes("resolved")
  );
}

function mergeOpenIssues(existing = [], incoming = []) {
  const map = new Map();
  for (const issue of existing) {
    if (issue?.key) map.set(issue.key, issue);
  }
  for (const issue of incoming) {
    if (issue?.key) map.set(issue.key, issue);
  }
  return [...map.values()].filter((issue) => !isIssueDone(issue));
}

function hasRepoWriteAccess(repoMeta) {
  const perms = repoMeta?.permissions || {};
  return Boolean(perms.admin || perms.maintain || perms.push);
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
═══════════════════════════════════════════════════════════════════════════ */
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Outfit:wght@300;400;500;600;700;800&family=Fraunces:opsz,wght@9..144,300;9..144,600;9..144,700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg0:#f4f7fb;--bg1:#ffffff;--bg2:#f7f9fc;--bg3:#eef3f9;--bg4:#e6edf7;--bg5:#dbe5f3;
  --border:#d8e2ef;--border2:#c3d3e8;
  --t0:#172235;--t1:#4f627d;--t2:#6e819c;--t3:#97a8bf;
  --cyan:#0ea5e9;--cyan2:#0284c7;--cdim:#0ea5e91c;
  --green:#16a34a;--gdim:#16a34a1a;
  --amber:#d97706;--adim:#d977061a;
  --red:#dc2626;--rdim:#dc26261a;
  --purple:#7c3aed;--pdim:#7c3aed1a;
  --blue:#2563eb;--bdim:#2563eb1a;
  --pink:#db2777;--pkdim:#db27771a;
  --mono:'JetBrains Mono',monospace;
  --ui:'Outfit',sans-serif;
  --display:'Fraunces',serif;
  --r:10px;--rl:16px;--tr:0.16s cubic-bezier(.4,0,.2,1);
}
html,body,#root{height:100%;background:var(--bg0)}
body{font-family:var(--ui);color:var(--t0);overflow:hidden}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--bg5);border-radius:2px}

/* ── APP SHELL ── */
.shell{display:flex;flex-direction:column;height:100vh;background:var(--bg0);
  background-image:
    radial-gradient(ellipse 70% 55% at 12% -10%, #dbeafe 0%, transparent 68%),
    radial-gradient(ellipse 70% 55% at 100% 0%, #f5d0fe 0%, transparent 70%),
    linear-gradient(180deg, #f8fbff 0%, #f3f7fc 100%)}
.topbar{height:56px;background:color-mix(in oklab,var(--bg1) 92%,#ffffff 8%);border-bottom:1px solid var(--border);
  display:flex;align-items:center;padding:0 16px;gap:12px;z-index:100;flex-shrink:0}
.brand{display:flex;align-items:center;gap:8px;margin-right:4px;flex-shrink:0}
.brand-hex{width:30px;height:30px;background:linear-gradient(135deg,var(--cyan),var(--blue));
  clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
  display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;
  color:#fff;font-family:var(--mono)}
.brand-name{font-family:var(--display);font-size:17px;font-weight:600;
  background:linear-gradient(90deg,var(--cyan),var(--blue));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.nav-strip{display:flex;gap:1px;flex:1;overflow-x:auto;min-width:0}
.nav-btn{padding:5px 12px;border:none;background:transparent;color:var(--t1);
  font-family:var(--ui);font-size:12.5px;cursor:pointer;border-radius:var(--r);
  display:flex;align-items:center;gap:6px;transition:all var(--tr);white-space:nowrap;flex-shrink:0}
.nav-btn:hover{background:var(--bg3);color:var(--t0)}
.nav-btn.on{background:#e0efff;color:#0b63d9;border:1px solid #bfdcff}
.nav-dot{width:6px;height:6px;border-radius:50%;background:var(--green);
  box-shadow:0 0 5px var(--green);animation:blink 2.2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
.user-chip{display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0}
.uc-name{font-family:var(--mono);font-size:11px;color:var(--t1)}
.role-tag{padding:3px 8px;border-radius:99px;font-family:var(--mono);font-size:9px;
  font-weight:700;letter-spacing:.8px;text-transform:uppercase}
.rt-mgr{background:var(--pdim);color:var(--purple);border:1px solid var(--purple)}
.rt-dev{background:var(--gdim);color:var(--green);border:1px solid var(--green)}
.rt-lead{background:var(--adim);color:var(--amber);border:1px solid var(--amber)}

/* ── LAYOUT ── */
.body-wrap{display:flex;flex:1;overflow:hidden}
.left-rail{width:255px;flex-shrink:0;background:var(--bg1);border-right:1px solid var(--border);
  display:flex;flex-direction:column;overflow:hidden}
.rail-tabs{display:flex;background:var(--bg0);border-bottom:1px solid var(--border);flex-shrink:0}
.rail-tab{flex:1;padding:8px 4px;border:none;background:transparent;color:var(--t2);
  font-family:var(--mono);font-size:10px;cursor:pointer;transition:all var(--tr);
  letter-spacing:.5px;text-transform:uppercase}
.rail-tab.on{background:var(--bg2);color:var(--cyan);border-bottom:1px solid var(--cyan)}
.rail-scroll{flex:1;overflow-y:auto;padding:10px}
.rail-section-hd{font-family:var(--mono);font-size:9px;letter-spacing:2px;
  text-transform:uppercase;color:var(--t3);margin-bottom:8px;margin-top:4px}
.main-content{flex:1;overflow-y:auto;padding:20px 22px;min-width:0}

/* ── TICKET CARDS ── */
.tcard{padding:10px 11px;border-radius:var(--r);border:1px solid var(--border);
  background:var(--bg2);margin-bottom:6px;cursor:pointer;transition:all var(--tr)}
.tcard:hover{border-color:var(--border2);background:#f0f6ff;box-shadow:0 6px 20px #6b8ab114}
.tcard.sel{border-color:var(--cyan);background:var(--cdim)}
.tcard-id{font-family:var(--mono);font-size:10px;color:var(--cyan);
  display:flex;align-items:center;gap:5px;margin-bottom:3px}
.tcard-title{font-size:12px;color:var(--t0);line-height:1.4;margin-bottom:5px}
.tcard-meta{display:flex;gap:4px;flex-wrap:wrap}

/* ── CHIPS ── */
.chip{padding:1px 6px;border-radius:3px;font-size:9px;font-family:var(--mono);
  font-weight:700;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}
.c-todo{background:var(--bg5);color:var(--t1)}
.c-prog{background:var(--bdim);color:var(--blue)}
.c-rev{background:var(--adim);color:var(--amber)}
.c-done{background:var(--gdim);color:var(--green)}
.c-high{background:var(--rdim);color:var(--red)}
.c-med{background:var(--adim);color:var(--amber)}
.c-low{background:var(--gdim);color:var(--green)}
.c-story{background:var(--gdim);color:var(--green)}
.c-bug{background:var(--rdim);color:var(--red)}
.c-task{background:var(--bdim);color:var(--blue)}
.c-sub{background:var(--pdim);color:var(--purple)}
.c-epic{background:var(--pkdim);color:var(--pink)}

/* ── PANELS ── */
.panel{background:color-mix(in oklab,var(--bg1) 90%,#ffffff 10%);border:1px solid var(--border);border-radius:var(--rl);
  margin-bottom:14px;overflow:hidden;box-shadow:0 10px 30px #8ea7c21a}
.ph{padding:11px 16px;border-bottom:1px solid var(--border);background:var(--bg2);
  display:flex;align-items:center;gap:9px}
.ph-icon{width:26px;height:26px;border-radius:5px;display:flex;align-items:center;
  justify-content:center;font-size:13px;flex-shrink:0}
.phtitle{font-family:var(--display);font-size:13.5px;font-weight:600;color:var(--t0);flex:1}
.pb{padding:16px}

/* ── BUTTONS ── */
.btn{padding:6px 13px;border-radius:var(--r);font-family:var(--mono);font-size:11px;
  font-weight:600;cursor:pointer;transition:all var(--tr);border:1px solid;
  letter-spacing:.4px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-c{background:linear-gradient(135deg,#0ea5e9,#2563eb);border-color:#1d4ed8;color:#fff}
.btn-c:hover:not(:disabled){filter:brightness(1.04);box-shadow:0 10px 20px #2563eb40}
.btn-g{background:linear-gradient(135deg,#22c55e,#16a34a);border-color:#15803d;color:#fff}
.btn-g:hover:not(:disabled){filter:brightness(1.04);box-shadow:0 10px 20px #16a34a33}
.btn-p{background:linear-gradient(135deg,#8b5cf6,#7c3aed);border-color:#6d28d9;color:#fff}
.btn-p:hover:not(:disabled){filter:brightness(1.04)}
.btn-a{background:linear-gradient(135deg,#f59e0b,#d97706);border-color:#b45309;color:#fff}
.btn-a:hover:not(:disabled){filter:brightness(1.04)}
.btn-r{background:linear-gradient(135deg,#ef4444,#dc2626);border-color:#b91c1c;color:#fff}
.btn-r:hover:not(:disabled){filter:brightness(1.04)}
.btn-n{background:var(--bg2);border-color:var(--border2);color:var(--t1)}
.btn-n:hover:not(:disabled){background:var(--bg3);color:var(--t0)}
.btn-pk{background:linear-gradient(135deg,#ec4899,#db2777);border-color:#be185d;color:#fff}
.btn-pk:hover:not(:disabled){filter:brightness(1.04)}

/* ── INPUTS ── */
.inp{width:100%;padding:8px 11px;background:var(--bg2);border:1px solid var(--border);
  border-radius:var(--r);color:var(--t0);font-family:var(--ui);font-size:13px;
  outline:none;transition:border-color var(--tr),box-shadow var(--tr)}
.inp:focus{border-color:#60a5fa;box-shadow:0 0 0 4px #60a5fa22;background:#fff}
.inp::placeholder{color:var(--t3)}
.inp-mono{font-family:var(--mono);font-size:12px;letter-spacing:1px}
.inp-sm{padding:6px 10px;font-size:12px}
.sel{padding:7px 10px;background:var(--bg2);border:1px solid var(--border);
  border-radius:var(--r);color:var(--t0);font-family:var(--mono);font-size:11px;
  outline:none;cursor:pointer;transition:border-color var(--tr)}
.sel:focus{border-color:var(--cyan)}
.sel option{background:var(--bg2)}
.textarea{width:100%;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);
  border-radius:var(--r);color:var(--t0);font-family:var(--mono);font-size:11.5px;
  resize:vertical;outline:none;transition:border-color var(--tr);line-height:1.65}
.textarea:focus{border-color:var(--cyan)}
.label{display:block;font-family:var(--mono);font-size:9px;letter-spacing:1.5px;
  text-transform:uppercase;color:var(--t2);margin-bottom:5px}
.fg{margin-bottom:12px}

/* ── API LOG ── */
.api-log{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);
  padding:10px 12px;font-family:var(--mono);font-size:11px;line-height:1.7;
  max-height:220px;overflow-y:auto}
.log-line{display:flex;gap:8px;align-items:baseline;margin-bottom:2px}
.log-ts{color:var(--t3);font-size:10px;flex-shrink:0}
.log-method{font-weight:700;font-size:10px;flex-shrink:0}
.log-url{color:var(--t1);font-size:10.5px;word-break:break-all}
.log-status{font-size:10px;flex-shrink:0;margin-left:auto}
.m-get{color:var(--blue)}
.m-post{color:var(--green)}
.m-put{color:var(--amber)}
.m-del{color:var(--red)}
.m-patch{color:var(--purple)}
.s-ok{color:var(--green)}
.s-err{color:var(--red)}
.s-load{color:var(--amber);animation:blink 1s infinite}

/* ── AI OUTPUT ── */
.ai-out{background:linear-gradient(160deg,#f3fbff,#eef8ff);border:1px solid #7dd3fc55;
  border-radius:var(--r);padding:14px;font-family:var(--mono);font-size:11.5px;
  line-height:1.8;color:#1e3a5f;white-space:pre-wrap;word-break:break-word;
  max-height:480px;overflow-y:auto;position:relative}
.ai-out::before{content:'◉ AI ENGINE OUTPUT';display:block;font-size:9px;
  letter-spacing:2px;color:var(--cyan);margin-bottom:8px;padding-bottom:7px;
  border-bottom:1px solid #00d4ff18}
.cur{display:inline-block;width:7px;height:13px;background:var(--cyan);
  animation:blink .7s infinite;vertical-align:middle;margin-left:2px}

/* ── GRID ── */
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.gc2{grid-column:span 2}

/* ── STAT CARD ── */
.stat{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);
  padding:14px;transition:border-color var(--tr)}
.stat:hover{border-color:var(--border2)}
.stat-val{font-family:var(--display);font-size:28px;font-weight:600;line-height:1;margin-bottom:3px}
.stat-lbl{font-family:var(--mono);font-size:9px;letter-spacing:1.5px;
  text-transform:uppercase;color:var(--t2)}
.stat-sub{font-size:11px;color:var(--t2);margin-top:4px}

/* ── NOTICES ── */
.info{display:flex;gap:8px;padding:9px 12px;background:#dbeafe;border-left:3px solid var(--cyan);
  border-radius:0 var(--r) var(--r) 0;font-size:12px;color:var(--t0);line-height:1.5;margin-bottom:10px}
.warn{display:flex;gap:8px;padding:9px 12px;background:#ffedd5;border-left:3px solid var(--amber);
  border-radius:0 var(--r) var(--r) 0;font-size:12px;color:var(--t0);line-height:1.5;margin-bottom:10px}
.success{display:flex;gap:8px;padding:9px 12px;background:#dcfce7;border-left:3px solid var(--green);
  border-radius:0 var(--r) var(--r) 0;font-size:12px;color:var(--t0);line-height:1.5;margin-bottom:10px}
.err{display:flex;gap:8px;padding:9px 12px;background:#fee2e2;border-left:3px solid var(--red);
  border-radius:0 var(--r) var(--r) 0;font-size:12px;color:var(--t0);line-height:1.5;margin-bottom:10px}

/* ── MISC ── */
.divider{height:1px;background:var(--border);margin:14px 0}
.row{display:flex;align-items:center;gap:8px}
.row-wrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.col{display:flex;flex-direction:column;gap:8px}
.sp{flex:1}
.sec-title{font-family:var(--display);font-size:19px;font-weight:600;
  color:var(--t0);margin-bottom:3px}
.sec-sub{font-size:12.5px;color:var(--t1);margin-bottom:16px;line-height:1.5}
.mono{font-family:var(--mono)}
.sm{font-size:11.5px}.xs{font-size:10.5px}.xxs{font-size:10px}
.muted{color:var(--t2)}.text-c{color:var(--cyan)}.text-g{color:var(--green)}
.text-a{color:var(--amber)}.text-r{color:var(--red)}.text-p{color:var(--purple)}
.mt4{margin-top:4px}.mt8{margin-top:8px}.mt12{margin-top:12px}.mt16{margin-top:16px}
.mb8{margin-bottom:8px}.mb12{margin-bottom:12px}
.tab-row{display:flex;gap:2px;background:var(--bg0);padding:3px;
  border-radius:var(--r);border:1px solid var(--border);margin-bottom:14px}
.tab-item{padding:5px 12px;border-radius:4px;border:none;background:transparent;
  color:var(--t1);font-size:11px;font-family:var(--mono);cursor:pointer;
  transition:all var(--tr);white-space:nowrap}
.tab-item.on{background:var(--bg3);color:var(--t0)}
.badge{padding:2px 7px;border-radius:4px;font-family:var(--mono);font-size:9px;
  font-weight:700;letter-spacing:.5px;border:1px solid}
.conn-badge{background:var(--gdim);color:var(--green);border-color:var(--green)}
.dis-badge{background:var(--rdim);color:var(--red);border-color:var(--red)}
.enc-tag{display:inline-flex;align-items:center;gap:3px;font-family:var(--mono);
  font-size:9px;color:var(--green);background:var(--gdim);padding:2px 6px;
  border-radius:3px;border:1px solid var(--green)}
.progress{height:3px;background:var(--bg5);border-radius:99px;overflow:hidden}
.progress-fill{height:100%;border-radius:99px;
  background:linear-gradient(90deg,var(--cyan),var(--blue));transition:width .5s ease}
.code-block{background:var(--bg0);border:1px solid var(--border);border-radius:var(--r);
  padding:14px;font-family:var(--mono);font-size:11px;line-height:1.7;color:var(--t0);
  overflow-x:auto;white-space:pre;max-height:320px;overflow-y:auto}
.spin{animation:spin .9s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── LOGIN & SETUP ── */
.fullpage{min-height:100vh;display:flex;flex-direction:column;align-items:center;
  justify-content:center;padding:24px;background:var(--bg0);
  background-image:radial-gradient(ellipse 70% 50% at 20% 20%,#dbeafe 0%,transparent 65%),radial-gradient(ellipse 70% 50% at 100% 0%,#f5d0fe 0%,transparent 68%)}
.login-card{background:color-mix(in oklab,var(--bg1) 92%,#ffffff 8%);border:1px solid var(--border);border-radius:18px;
  padding:32px;width:100%;max-width:430px;position:relative}
.login-card::before{content:'';position:absolute;top:0;left:15%;right:15%;height:1px;
  background:linear-gradient(90deg,transparent,var(--cyan),transparent)}
.brand-big{text-align:center;margin-bottom:36px}
.brand-big h1{font-family:var(--display);font-size:36px;font-weight:600;
  background:linear-gradient(135deg,var(--cyan) 0%,var(--blue) 50%,var(--purple) 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.brand-big p{font-family:var(--mono);font-size:10px;color:var(--t2);
  letter-spacing:2.5px;text-transform:uppercase;margin-top:6px}
.role-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px}
.role-opt{padding:12px 8px;border:1px solid var(--border);border-radius:var(--r);
  background:var(--bg2);color:var(--t1);cursor:pointer;text-align:center;
  font-family:var(--ui);font-size:12px;transition:all var(--tr);
  display:flex;flex-direction:column;align-items:center;gap:5px}
.role-opt:hover{border-color:var(--cyan);background:var(--bg3);color:var(--t0)}
.role-opt.on{border-color:var(--cyan);background:var(--cdim);color:var(--cyan)}
.submit-btn{width:100%;padding:12px;background:linear-gradient(135deg,#2563eb,#0ea5e9);
  border:1px solid #1d4ed8;border-radius:var(--r);color:#fff;
  font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:1.5px;
  cursor:pointer;transition:all var(--tr)}
.submit-btn:hover{filter:brightness(1.03);box-shadow:0 12px 26px #2563eb40}
.setup-wrap{min-height:100vh;overflow-y:auto;background:var(--bg0);
  background-image:radial-gradient(ellipse 70% 40% at 15% 10%,#dbeafe 0%,transparent 60%),radial-gradient(ellipse 70% 40% at 90% 0%,#f5d0fe 0%,transparent 65%);
  padding:36px 24px}
.setup-inner{max-width:960px;margin:0 auto}
.setup-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;margin-top:20px}
.setup-card{background:var(--bg1);border:1px solid var(--border);border-radius:var(--rl);
  padding:22px;transition:border-color var(--tr),box-shadow var(--tr)}
.setup-card:hover{border-color:var(--border2);box-shadow:0 12px 28px #8ea7c226}
.setup-card.connected{border-color:var(--green)}
.sc-head{display:flex;align-items:center;gap:9px;margin-bottom:14px}
.sc-icon{font-size:22px}.sc-title{font-family:var(--display);font-size:15px;font-weight:600}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   JIRA API SERVICE
═══════════════════════════════════════════════════════════════════════════ */
class JiraAPI {
  constructor(baseUrl, email, token) {
    this.baseUrl = normalizeJiraBaseUrl(baseUrl);
    this.email = String(email || "").trim();
    this.token = sanitizeSecret(token);
  }

  async req(method, path, body) {
    const res = await fetch("/api/jira/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api: "core",
        baseUrl: this.baseUrl,
        email: this.email,
        token: this.token,
        method,
        path,
        body,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.errorMessages?.[0] || data.message || `HTTP ${res.status}`;
      throw new Error(`${detail} [${method} ${path}]`);
    }
    return data;
  }

  async reqAgile(method, path, body) {
    const res = await fetch("/api/jira/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api: "agile",
        baseUrl: this.baseUrl,
        email: this.email,
        token: this.token,
        method,
        path,
        body,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.errorMessages?.[0] || data.message || `HTTP ${res.status}`;
      throw new Error(`${detail} [${method} /rest/agile/1.0${path}]`);
    }
    return data;
  }

  // ── PROJECTS ──
  getProjects()          { return this.req("GET", "/project/search?maxResults=50"); }
  getProject(key)        { return this.req("GET", `/project/${key}`); }

  // ── ISSUES ──
  searchIssues(jql, fields = "summary,status,assignee,priority,issuetype,description,subtasks,comment,labels,sprint", max = 50) {
    return this.req("POST", "/search/jql", { jql, maxResults: max, fields: fields.split(",") });
  }
  getIssue(key)          { return this.req("GET", `/issue/${key}?expand=renderedFields,transitions`); }
  createIssue(payload)   { return this.req("POST", "/issue", payload); }
  updateIssue(key, payload) { return this.req("PUT", `/issue/${key}`, payload); }
  deleteIssue(key)       { return this.req("DELETE", `/issue/${key}`); }
  bulkCreateIssues(arr)  { return this.req("POST", "/issue/bulk", { issueUpdates: arr }); }

  // ── TRANSITIONS ──
  getTransitions(key)    { return this.req("GET", `/issue/${key}/transitions`); }
  doTransition(key, tid, comment) {
    const body = { transition: { id: tid } };
    if (comment) body.update = { comment: [{ add: { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }] } } }] };
    return this.req("POST", `/issue/${key}/transitions`, body);
  }

  // ── COMMENTS ──
  getComments(key)       { return this.req("GET", `/issue/${key}/comment?orderBy=-created`); }
  addComment(key, text)  {
    return this.req("POST", `/issue/${key}/comment`, {
      body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
    });
  }
  updateComment(key, cid, text) {
    return this.req("PUT", `/issue/${key}/comment/${cid}`, {
      body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
    });
  }
  deleteComment(key, cid) { return this.req("DELETE", `/issue/${key}/comment/${cid}`); }

  // ── ASSIGNEE ──
  getUsers(query = "")   { return this.req("GET", `/user/search?query=${encodeURIComponent(query)}&maxResults=20`); }
  assignIssue(key, accountId) { return this.req("PUT", `/issue/${key}/assignee`, { accountId }); }
  unassignIssue(key)     { return this.req("PUT", `/issue/${key}/assignee`, { accountId: null }); }

  // ── SUBTASKS ──
  createSubtask(parentKey, projectKey, summary, desc = "") {
    return this.req("POST", "/issue", {
      fields: {
        project: { key: projectKey },
        parent: { key: parentKey },
        issuetype: { name: "Subtask" },
        summary,
        description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: desc }] }] }
      }
    });
  }

  // ── LABELS & PRIORITY ──
  updateLabels(key, labels)   { return this.req("PUT", `/issue/${key}`, { fields: { labels } }); }
  updatePriority(key, name)   { return this.req("PUT", `/issue/${key}`, { fields: { priority: { name } } }); }
  updateSummary(key, summary) { return this.req("PUT", `/issue/${key}`, { fields: { summary } }); }
  updateDescription(key, text) {
    return this.req("PUT", `/issue/${key}`, {
      fields: {
        description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
      }
    });
  }

  // ── WORKLOGS ──
  addWorklog(key, seconds, comment = "") {
    return this.req("POST", `/issue/${key}/worklog`, { timeSpentSeconds: seconds, comment });
  }

  // ── SPRINTS (via Agile API) ──
  getBoards()            { return this.reqAgile("GET", "/board"); }
  getSprints(boardId)    { return this.reqAgile("GET", `/board/${boardId}/sprint?state=active,future`); }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GITHUB API SERVICE
═══════════════════════════════════════════════════════════════════════════ */
class GitHubAPI {
  constructor(token) {
    this.token = sanitizeSecret(token);
  }

  async req(method, path, body) {
    const res = await fetch("/api/github/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: this.token,
        method,
        path,
        body,
      }),
    });
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const parts = [data.message || `HTTP ${res.status}`];
      const acceptedPerms = data?.github?.acceptedPermissions;
      const oauthScopes = data?.github?.oauthScopes;
      if (acceptedPerms) parts.push(`required-permissions: ${acceptedPerms}`);
      if (oauthScopes) parts.push(`token-scopes: ${oauthScopes}`);
      if ((data.message || "").toLowerCase().includes("resource not accessible by personal access token")) {
        parts.push("grant repo write access to this repository (classic PAT: repo; fine-grained PAT: Contents Read and write)");
      }
      throw new Error(parts.join(" | "));
    }
    return data;
  }

  // ── USER & REPOS ──
  getUser()              { return this.req("GET", "/user"); }
  listRepos(page = 1)    { return this.req("GET", `/user/repos?per_page=50&page=${page}&sort=updated&type=all`); }
  getRepo(owner, repo)   { return this.req("GET", `/repos/${owner}/${repo}`); }
  async findAccessibleRepoByName(repoName, maxPages = 3) {
    const needle = String(repoName || "").toLowerCase();
    for (let page = 1; page <= maxPages; page++) {
      const repos = await this.listRepos(page);
      if (!Array.isArray(repos) || repos.length === 0) break;
      const hit = repos.find(r => String(r?.name || "").toLowerCase() === needle);
      if (hit) return hit;
      if (repos.length < 50) break;
    }
    return null;
  }
  async findAccessibleRepo(owner, repoName, maxPages = 3) {
    const ownerNeedle = String(owner || "").toLowerCase();
    const nameNeedle = String(repoName || "").toLowerCase();
    let fallback = null;
    for (let page = 1; page <= maxPages; page++) {
      const repos = await this.listRepos(page);
      if (!Array.isArray(repos) || repos.length === 0) break;
      for (const repo of repos) {
        const currentName = String(repo?.name || "").toLowerCase();
        if (currentName !== nameNeedle) continue;
        const currentOwner = String(repo?.owner?.login || "").toLowerCase();
        if (ownerNeedle && currentOwner === ownerNeedle) return repo;
        if (!fallback) fallback = repo;
      }
      if (repos.length < 50) break;
    }
    return fallback;
  }
  getLanguages(owner, repo) { return this.req("GET", `/repos/${owner}/${repo}/languages`); }

  // ── BRANCHES ──
  listBranches(owner, repo)  { return this.req("GET", `/repos/${owner}/${repo}/branches?per_page=50`); }
  getBranch(owner, repo, b)  { return this.req("GET", `/repos/${owner}/${repo}/branches/${encodeURIComponent(b)}`); }
  createBranch(owner, repo, newBranch, fromSHA) {
    return this.req("POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${newBranch}`, sha: fromSHA
    });
  }
  deleteBranch(owner, repo, branch) {
    return this.req("DELETE", `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`);
  }
  getRef(owner, repo, branch) {
    return this.req("GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  }

  // ── FILES / CONTENTS ──
  getContents(owner, repo, path, ref = "") {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return this.req("GET", `/repos/${owner}/${repo}/contents/${path}${q}`);
  }
  pushFile(owner, repo, path, content, message, branch, sha = null) {
    const body = { message, content: btoa(unescape(encodeURIComponent(content))), branch };
    if (sha) body.sha = sha;
    return this.req("PUT", `/repos/${owner}/${repo}/contents/${path}`, body);
  }
  deleteFile(owner, repo, path, sha, message, branch) {
    return this.req("DELETE", `/repos/${owner}/${repo}/contents/${path}`, { message, sha, branch });
  }
  getTree(owner, repo, sha, recursive = true) {
    return this.req("GET", `/repos/${owner}/${repo}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`);
  }

  // ── COMMITS ──
  listCommits(owner, repo, branch = "", page = 1) {
    const b = branch ? `&sha=${encodeURIComponent(branch)}` : "";
    return this.req("GET", `/repos/${owner}/${repo}/commits?per_page=20&page=${page}${b}`);
  }
  getCommit(owner, repo, sha) { return this.req("GET", `/repos/${owner}/${repo}/commits/${sha}`); }

  // ── PULL REQUESTS ──
  listPRs(owner, repo, state = "open") {
    return this.req("GET", `/repos/${owner}/${repo}/pulls?state=${state}&per_page=30`);
  }
  getPR(owner, repo, num)  { return this.req("GET", `/repos/${owner}/${repo}/pulls/${num}`); }
  createPR(owner, repo, title, head, base, body, draft = false) {
    return this.req("POST", `/repos/${owner}/${repo}/pulls`, { title, head, base, body, draft });
  }
  updatePR(owner, repo, num, payload) {
    return this.req("PATCH", `/repos/${owner}/${repo}/pulls/${num}`, payload);
  }
  mergePR(owner, repo, num, title, method = "squash") {
    return this.req("PUT", `/repos/${owner}/${repo}/pulls/${num}/merge`, {
      merge_method: method, commit_title: title
    });
  }
  closePR(owner, repo, num) { return this.updatePR(owner, repo, num, { state: "closed" }); }

  // ── REVIEWS ──
  listReviews(owner, repo, num) { return this.req("GET", `/repos/${owner}/${repo}/pulls/${num}/reviews`); }
  createReview(owner, repo, num, body, event = "COMMENT") {
    return this.req("POST", `/repos/${owner}/${repo}/pulls/${num}/reviews`, { body, event });
  }
  getPRFiles(owner, repo, num) { return this.req("GET", `/repos/${owner}/${repo}/pulls/${num}/files`); }

  // ── ISSUES / COMMENTS ──
  listIssueComments(owner, repo, num) {
    return this.req("GET", `/repos/${owner}/${repo}/issues/${num}/comments`);
  }
  addIssueComment(owner, repo, num, body) {
    return this.req("POST", `/repos/${owner}/${repo}/issues/${num}/comments`, { body });
  }

  // ── ACTIONS / CI ──
  listWorkflows(owner, repo) { return this.req("GET", `/repos/${owner}/${repo}/actions/workflows`); }
  listRuns(owner, repo, workflow_id) {
    return this.req("GET", `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs?per_page=10`);
  }
  triggerWorkflow(owner, repo, workflow_id, ref, inputs = {}) {
    return this.req("POST", `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`, { ref, inputs });
  }

  // ── LABELS & MILESTONES ──
  listLabels(owner, repo) { return this.req("GET", `/repos/${owner}/${repo}/labels`); }
  addLabel(owner, repo, name, color) { return this.req("POST", `/repos/${owner}/${repo}/labels`, { name, color }); }
}

/* ═══════════════════════════════════════════════════════════════════════════
   AI SERVICE (Groq API via Backend Proxy)
═══════════════════════════════════════════════════════════════════════════ */
const AI_BACKEND_URL = "http://localhost:8787";

async function callAI(system, user, onChunk, apiKey = "", model = "llama-3.3-70b-versatile") {
  try {
    const res = await fetch(`${AI_BACKEND_URL}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        system,
        messages: [{ role: "user", content: user }],
        model: model,
        maxTokens: 1000,
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      throw new Error(err.message || `AI API ${res.status}`);
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    onChunk(text);
    return text;
  } catch (err) {
    if (err.message.includes("fetch") || err.message.includes("Failed") || err.message.includes("NetworkError")) {
      throw new Error("Backend not running. Please run 'npm run dev:be' first on port 8787.");
    }
    throw err;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [screen, setScreen] = useState("login"); // login | setup | app
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("developer");
  const [uname, setUname] = useState("");
  const [creds, setCreds] = useState(() => {
    const defaults = {
      jiraUrl: "",
      jiraEmail: "",
      jiraToken: "",
      jiraProjectKey: "",
      githubToken: "",
      githubUsername: "",
      githubRepo: "",
      githubOwner: "",
      groqKey: "",
      aiModel: "llama-3.3-70b-versatile",
      jiraOk: false, githubOk: false, groqOk: false,
    };
    const envOverrides = envCredOverrides();
    try {
      const raw = localStorage.getItem(CREDS_STORAGE_KEY);
      if (!raw) return { ...defaults, ...envOverrides };
      const saved = JSON.parse(raw);
      return {
        ...defaults,
        ...saved,
        ...envOverrides,
        githubOwner: envOverrides.githubOwner || envOverrides.githubUsername || saved?.githubOwner || saved?.githubUsername || "",
      };
    } catch {
      return { ...defaults, ...envOverrides };
    }
  });
  const [activeTab, setActiveTab] = useState("jira");
  const [workflowSeed, setWorkflowSeed] = useState({ jiraKey: "" });
  const [logs, setLogs] = useState([]);
  const jiraRef = useRef(null);
  const ghRef   = useRef(null);

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = STYLES;
    document.head.appendChild(s);
    return () => s.remove();
  }, []);

  useEffect(() => {
    localStorage.setItem(CREDS_STORAGE_KEY, JSON.stringify(creds));
  }, [creds]);

  const addLog = useCallback((method, url, status) => {
    setLogs(p => [...p.slice(-80), {
      ts: new Date().toLocaleTimeString("en",{hour12:false}),
      method, url, status
    }]);
  }, []);

  useEffect(() => {
    jiraRef.current = creds.jiraOk
      ? new JiraAPI(creds.jiraUrl, creds.jiraEmail, creds.jiraToken)
      : null;
    ghRef.current = creds.githubOk
      ? new GitHubAPI(creds.githubToken)
      : null;
  }, [
    creds.jiraOk, creds.jiraUrl, creds.jiraEmail, creds.jiraToken,
    creds.githubOk, creds.githubToken,
  ]);

  const handleConnect = async (svc) => {
    if (svc === "jira") {
      const missing = [];
      if (!creds.jiraUrl?.trim()) missing.push("Jira URL");
      if (!creds.jiraEmail?.trim()) missing.push("Account Email");
      if (!creds.jiraToken?.trim()) missing.push("Jira Token");
      if (!creds.jiraProjectKey?.trim()) missing.push("Project Key");
      if (missing.length) {
        window.alert(`Jira Cloud needs 4 fields: ${missing.join(", ")}`);
        return;
      }
      try {
        const jiraUrl = normalizeJiraBaseUrl(creds.jiraUrl);
        const jiraEmail = creds.jiraEmail.trim();
        const jiraToken = sanitizeSecret(creds.jiraToken);
        const projectKey = creds.jiraProjectKey.trim().toUpperCase();
        const jira = new JiraAPI(jiraUrl, jiraEmail, jiraToken);
        await jira.req("GET", "/myself");
        await jira.getProject(projectKey);
        await jira.searchIssues(`project = ${projectKey} ORDER BY created DESC`, "summary", 1);
      } catch (e) {
        window.alert(`Jira connect failed: ${e.message}. Check URL/email/token and Browse permission for the project key.`);
        setCreds(p => ({ ...p, jiraOk: false }));
        return;
      }
    }
    if (svc === "github") {
      const missing = [];
      if (!creds.githubToken?.trim()) missing.push("Token");
      if (!creds.githubUsername?.trim()) missing.push("Username");
      if (!creds.githubRepo?.trim()) missing.push("Repo");
      if (missing.length) {
        window.alert(`GitHub needs 3 fields: ${missing.join(", ")}`);
        return;
      }
      try {
        const github = new GitHubAPI(creds.githubToken.trim());
        const username = creds.githubUsername.trim();
        const repoInput = creds.githubRepo.trim();
        const normalized = repoInput
          .replace(/^https?:\/\/github\.com\//i, "")
          .replace(/\.git$/i, "")
          .replace(/^\/+|\/+$/g, "");
        let resolvedOwner = username;
        let resolvedRepo = normalized;
        if (normalized.includes("/")) {
          const [ownerFromRepo, repoFromRepo] = normalized.split("/", 2);
          resolvedOwner = ownerFromRepo;
          resolvedRepo = repoFromRepo;
        }

        await github.getUser();
        const matched = await github.findAccessibleRepo(resolvedOwner, resolvedRepo);
        if (!matched) {
          throw new Error(`Repo "${resolvedOwner}/${resolvedRepo}" not found in token-accessible repos`);
        }
        if (!hasRepoWriteAccess(matched)) {
          throw new Error(`Token can read but cannot write to ${matched.owner?.login}/${matched.name}. Required: repo write (classic PAT: repo; fine-grained PAT: Contents Read and write).`);
        }
        resolvedOwner = matched.owner?.login || resolvedOwner;
        resolvedRepo = matched.name || resolvedRepo;

        setCreds(p => ({
          ...p,
          githubUsername: resolvedOwner,
          githubOwner: resolvedOwner,
          githubRepo: resolvedRepo,
          githubOk: true,
        }));
        return;
      } catch (e) {
        window.alert(`GitHub connect failed: ${e.message}`);
        setCreds(p => ({ ...p, githubOk: false }));
        return;
      }
    }
    if (svc === "jira") {
      setCreds(p => ({
        ...p,
        jiraUrl: normalizeJiraBaseUrl(p.jiraUrl),
        jiraProjectKey: (p.jiraProjectKey || "").trim().toUpperCase(),
        jiraOk: true,
      }));
      return;
    }
    if (svc === "groq") {
      if (!creds.groqKey?.trim()) {
        window.alert("Please enter a Groq API key first.");
        return;
      }
      setCreds(p => ({
        ...p,
        groqOk: true,
      }));
      return;
    }
    setCreds(p => ({
      ...p,
      githubOwner: p.githubUsername || p.githubOwner,
      [`${svc}Ok`]: true,
    }));
  };

  const handleLogin = () => {
    if (!uname.trim()) return;
    setUser({ name: uname, role });
    setScreen((creds.jiraOk || creds.githubOk || creds.groqOk) ? "app" : "setup");
  };

  const handleEnterPlatform = () => {
    setScreen("app");
  };

  if (screen === "login")
    return <LoginScreen role={role} setRole={setRole} uname={uname} setUname={setUname} onLogin={handleLogin} />;
  if (screen === "setup")
    return <SetupScreen creds={creds} setCreds={setCreds} onConnect={handleConnect} onEnter={handleEnterPlatform} />;

  const tabs = [
    { id:"jira",      label:"Jira",       icon:"🟦" },
    { id:"github",    label:"GitHub",     icon:"🐙" },
    { id:"workflow",  label:"Workflow",   icon:"🔄" },
    { id:"aitools",   label:"AI Tools",   icon:"⚡" },
    { id:"apilog",    label:"API Log",    icon:"📡" },
    { id:"settings",  label:"Settings",   icon:"⚙" },
  ];
  const roleCls = { manager:"rt-mgr", developer:"rt-dev", lead:"rt-lead" };

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <div className="brand-hex">AI</div>
          <span className="brand-name">NexusSDLC</span>
        </div>
        <div className="nav-strip">
          {tabs.map(t => (
            <button key={t.id} className={`nav-btn ${activeTab===t.id?"on":""}`} onClick={()=>setActiveTab(t.id)}>
              {t.icon} {t.label}
              {t.id==="apilog" && logs.length > 0 && (
                <span className="badge conn-badge" style={{padding:"0 5px"}}>{logs.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="user-chip">
          <div className="nav-dot"/>
          <span className="uc-name">{user?.name}</span>
          <span className={`role-tag ${roleCls[user?.role]}`}>{user?.role}</span>
          <button className="btn btn-n btn-sm" style={{padding:"3px 8px"}} onClick={()=>setScreen("setup")}>⚙</button>
        </div>
      </div>
      <div className="body-wrap">
        <AppContent
          activeTab={activeTab}
          creds={creds} setCreds={setCreds}
          jira={jiraRef} gh={ghRef}
          user={user}
          logs={logs} addLog={addLog}
          onConnect={handleConnect}
          onLaunchWorkflow={(issue) => {
            setWorkflowSeed({ jiraKey: issue?.key || "" });
            setActiveTab("workflow");
          }}
          workflowSeed={workflowSeed}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   APP CONTENT ROUTER
═══════════════════════════════════════════════════════════════════════════ */
function AppContent({ activeTab, creds, setCreds, jira, gh, user, logs, addLog, onConnect, onLaunchWorkflow, workflowSeed }) {
  const props = { creds, jira, gh, user, addLog };
  return (
    <div style={{flex:1,overflow:"auto"}}>
      {activeTab === "jira"     && <JiraTab {...props} onLaunchWorkflow={onLaunchWorkflow} />}
      {activeTab === "github"   && <GitHubTab {...props} />}
      {activeTab === "workflow" && <WorkflowTab {...props} workflowSeed={workflowSeed} creds={creds} />}
      {activeTab === "aitools"  && <AIToolsTab creds={creds} />}
      {activeTab === "apilog"   && <APILogTab logs={logs} />}
      {activeTab === "settings" && <SettingsTab creds={creds} setCreds={setCreds} onConnect={onConnect} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   JIRA TAB — Full CRUD
═══════════════════════════════════════════════════════════════════════════ */
function JiraTab({ creds, jira, addLog, onLaunchWorkflow }) {
  const [sub, setSub] = useState("fetch");
  const [issues, setIssues] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selIssue, setSelIssue] = useState(null);
  const [transitions, setTransitions] = useState([]);
  const [comments, setComments] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState({});
  const [msg, setMsg] = useState(null);
  const [jql, setJql] = useState("project = PROJ ORDER BY created DESC");

  const api = jira.current;

  useEffect(() => {
    if (creds.jiraOk && api) {
      fetchIssues(true);
    }
  }, []);

  const [form, setForm] = useState({ project:"", summary:"", description:"", type:"Story", priority:"Medium", label:"" });
  const [editForm, setEditForm] = useState({});
  const [commentText, setCommentText] = useState("");
  const [worklogDays, setWorklogDays] = useState("0.5");
  const [editMode, setEditMode] = useState("manual");
  const [aiOutput, setAiOutput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiEditField, setAiEditField] = useState("summary");
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [aiGenLoading, setAiGenLoading] = useState({});
  const [aiGenOutput, setAiGenOutput] = useState({});
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [subtaskForm, setSubtaskForm] = useState({ summary: "", description: "", priority: "Medium", assignee: "" });
  const [subtaskAiLoading, setSubtaskAiLoading] = useState(false);
  const [subtaskDrafts, setSubtaskDrafts] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'key', direction: 'asc' });
  const [filterConfig, setFilterConfig] = useState({ key: '', type: '', status: '' });

  const wrap = async (key, label, fn, url) => {
    if (!api) { setMsg({ t:"warn", m:"Connect Jira credentials first." }); return; }
    setLoading(p=>({...p,[key]:true}));
    setMsg(null);
    addLog(label.split(" ")[0].toUpperCase(), url || "jira/api", "loading");
    try {
      const r = await fn();
      addLog(label.split(" ")[0].toUpperCase(), url || "jira/api", "200 OK");
      setMsg({ t:"ok", m:`✓ ${label} succeeded` });
      return r;
    } catch(e) {
      addLog(label.split(" ")[0].toUpperCase(), url || "jira/api", `ERROR: ${e.message}`);
      setMsg({ t:"err", m:`✗ ${e.message}` });
    } finally {
      setLoading(p=>({...p,[key]:false}));
    }
  };

  const generateFieldWithAI = async (field) => {
    if (!creds.groqKey) {
      setMsg({ t: "err", m: "Enter Groq API key in Settings first." });
      return;
    }
    
    // If generating summary, do it separately
    if (field === "summary") {
      setAiGenLoading(p => ({ ...p, [field]: true }));
      setAiGenOutput(p => ({ ...p, [field]: "" }));
      
      const fullPrompt = `You are a senior product manager. Generate a concise, clear Jira ticket summary (max 100 chars). Return ONLY the summary text. Example: "Implement user authentication with OAuth2"`;

      try {
        const result = await callAI(
          "You are an expert Jira ticket writer. Return ONLY the requested content, no additional explanation.",
          fullPrompt,
          (chunk) => setAiGenOutput(p => ({ ...p, [field]: chunk })),
          creds.groqKey,
          creds.aiModel || "llama-3.3-70b-versatile"
        );
        setAiGenOutput(p => ({ ...p, [field]: result }));
      } catch (e) {
        setAiGenOutput(p => ({ ...p, [field]: `Error: ${e.message}` }));
      }
      setAiGenLoading(p => ({ ...p, [field]: false }));
      return;
    }
    
    // For description fields, generate ALL sections together
    const descFields = ["objective", "scope", "plan", "tech", "tests", "acceptance"];
    
    // Set loading for all description fields
    descFields.forEach(f => setAiGenLoading(p => ({ ...p, [f]: true })));
    
    const issueSummary = form.summary || "New feature request";
    const issueType = form.type || "Story";
    
    const userPrompt = `Generate a complete Jira ticket description for: "${issueSummary}"

Issue Type: ${issueType}

Write ONLY valid markdown with these exact sections (no preamble):

## Objective
[2-3 sentences about the goal]

## Scope
### In Scope:
- [items included]

### Out of Scope:
- [items excluded]

## Plan of Action
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Technical Requirements
- **Tech Stack:** [technologies]
- **Dependencies:** [libraries/packages]
- **API Contracts:** [endpoints]
- **Non-Functional:** [performance, security]

## Test Cases
### TC-1: [Test Title]
- **Precondition:** [setup]
- **Steps:** [actions]
- **Expected Result:** [outcome]

### TC-2: [Test Title]
- **Precondition:** [setup]
- **Steps:** [actions]
- **Expected Result:** [outcome]

## Acceptance Criteria
[ ] [Criterion 1]
[ ] [Criterion 2]
[ ] [Criterion 3]`;

    try {
      await callAI(
        "You are an expert Jira ticket writer. Return ONLY the markdown content for a Jira ticket description with all sections filled in.",
        userPrompt,
        (chunk) => {
          // Parse the generated content into individual fields
          const lines = chunk.split("\n");
          let currentSection = "";
          let sectionContent = {};
          
          lines.forEach(line => {
            if (line.startsWith("## Objective")) currentSection = "objective";
            else if (line.startsWith("### In Scope:")) currentSection = "scope_in";
            else if (line.startsWith("### Out of Scope:")) currentSection = "scope_out";
            else if (line.startsWith("## Plan of Action")) currentSection = "plan";
            else if (line.startsWith("## Technical")) currentSection = "tech";
            else if (line.startsWith("## Test Cases") || line.startsWith("### TC-")) currentSection = "tests";
            else if (line.startsWith("## Acceptance")) currentSection = "acceptance";
            else if (currentSection) {
              if (!sectionContent[currentSection]) sectionContent[currentSection] = "";
              sectionContent[currentSection] += line + "\n";
            }
          });
          
          // Update each field
          descFields.forEach(f => {
            let content = sectionContent[f] || "";
            // Clean up content
            content = content.trim();
            setAiGenOutput(p => ({ ...p, [f]: content }));
          });
        },
        creds.groqKey,
        creds.aiModel || "llama-3.3-70b-versatile"
      );
    } catch (e) {
      descFields.forEach(f => setAiGenOutput(p => ({ ...p, [f]: `Error: ${e.message}` })));
    }
    descFields.forEach(f => setAiGenLoading(p => ({ ...p, [f]: false })));
  };

  const fetchProjects = async (force = false) => {
    if (!force && Array.isArray(JIRA_MEM_CACHE.projects)) {
      setProjects(JIRA_MEM_CACHE.projects);
      setMsg({ t:"ok", m:`✓ Loaded ${JIRA_MEM_CACHE.projects.length} projects from memory` });
      return;
    }
    const r = await wrap("proj","GET projects", ()=>api.getProjects(), `/rest/api/3/project/search`);
    if (r) {
      const values = r.values || [];
      JIRA_MEM_CACHE.projects = values;
      setProjects(values);
    }
  };

  const fetchIssues = async (force = false) => {
    const effectiveJql = getEffectiveJql();
    if (!force && JIRA_MEM_CACHE.issuesByJql.has(effectiveJql)) {
      const cached = JIRA_MEM_CACHE.issuesByJql.get(effectiveJql);
      setIssues((prev) => mergeOpenIssues(prev, cached.issues || []));
      setMsg({ t:"ok", m:"✓ Loaded issues from memory cache" });
      return;
    }
    const r = await wrap("fetch","POST search", ()=>api.searchIssues(effectiveJql), "/rest/api/3/search/jql");
    if (r) {
      const incoming = (r.issues || []).filter((issue) => !isIssueDone(issue));
      let merged = [];
      setIssues((prev) => {
        merged = mergeOpenIssues(prev, incoming);
        return merged;
      });
      const payload = { issues: merged, total: merged.length };
      JIRA_MEM_CACHE.issuesByJql.set(effectiveJql, payload);
      setMsg({ t:"ok", m:`✓ Synced ${incoming.length} issues (showing ${merged.length} open issues)` });
    }
  };

  const selectIssue = async (issue, isSubtask = false) => {
    if (!isSubtask) setSub("issue-detail");
    setAiOutput("");
    setAiEditPrompt("");
    setShowSubtaskForm(false);
    setSubtaskDrafts([]);
    setSubtaskForm({ summary: "", description: "", priority: "Medium", assignee: "" });
    
    const detail = await wrap("detail","GET issue", ()=>api.getIssue(issue.key), `/rest/api/3/issue/${issue.key}`);
    
    if (!detail) {
      setMsg({ t: "err", m: `Issue ${issue.key} not found - may have been deleted from Jira` });
      if (!isSubtask) {
        setIssues(prev => {
          const updated = prev.filter(i => i.key !== issue.key);
          localStorage.setItem(JIRA_ISSUES_STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });
        if (selIssue?.key === issue.key) setSelIssue(null);
      }
      return;
    }
    
    const fullIssue = detail;
    setSelIssue(fullIssue);
    setEditForm({ 
      summary: fullIssue.fields?.summary || "", 
      description: adfToText(fullIssue.fields?.description) || "",
      priority: fullIssue.fields?.priority?.name || "Medium" 
    });
    const [tr, cmt] = await Promise.all([
      wrap("trans","GET transitions", ()=>api.getTransitions(fullIssue.key), `/rest/api/3/issue/${fullIssue.key}/transitions`),
      wrap("cmt","GET comments", ()=>api.getComments(fullIssue.key), `/rest/api/3/issue/${fullIssue.key}/comment`),
    ]);
    if (tr) setTransitions(tr.transitions || []);
    if (cmt) setComments(cmt.comments || []);
  };

  const createIssue = async () => {
    const { project, summary, description, type, label } = form;
    if (!project || !summary) { setMsg({ t:"warn", m:"Project key and summary required." }); return; }
    await wrap("create","POST create", ()=>api.createIssue({ project:{key:project}, summary, description: { type:"doc", version:1, content:[{type:"paragraph",content:[{type:"text",text:description||""}]}] }, issuetype:{name:type}, priority:{name:form.priority||"Medium"}, labels: label ? [label] : [] }), "/rest/api/3/issue");
    fetchIssues(true);
  };

  const sortedAndFilteredIssues = () => {
    let result = [...issues];
    
    if (filterConfig.key) {
      result = result.filter(i => i.key.toLowerCase().includes(filterConfig.key.toLowerCase()));
    }
    if (filterConfig.type) {
      result = result.filter(i => (i.fields.issuetype?.name || '').toLowerCase() === filterConfig.type.toLowerCase());
    }
    if (filterConfig.status) {
      result = result.filter(i => (i.fields.status?.name || '').toLowerCase().includes(filterConfig.status.toLowerCase()));
    }
    
    if (sortConfig.key) {
      result.sort((a, b) => {
        let aVal, bVal;
        if (sortConfig.key === 'key') {
          aVal = a.key || '';
          bVal = b.key || '';
        } else if (sortConfig.key === 'type') {
          aVal = a.fields.issuetype?.name || '';
          bVal = b.fields.issuetype?.name || '';
        } else if (sortConfig.key === 'status') {
          aVal = a.fields.status?.name || '';
          bVal = b.fields.status?.name || '';
        } else if (sortConfig.key === 'priority') {
          const priorityOrder = { 'Highest': 1, 'High': 2, 'Medium': 3, 'Low': 4, 'Lowest': 5 };
          aVal = priorityOrder[a.fields.priority?.name] || 6;
          bVal = priorityOrder[b.fields.priority?.name] || 6;
        } else if (sortConfig.key === 'summary') {
          aVal = a.fields.summary || '';
          bVal = b.fields.summary || '';
        } else if (sortConfig.key === 'assignee') {
          aVal = a.fields.assignee?.displayName || '';
          bVal = b.fields.assignee?.displayName || '';
        }
        
        if (typeof aVal === 'string') {
          return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }
    
    return result;
  };

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return '⇅';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const getUniqueTypes = () => {
    const types = new Set();
    issues.forEach(i => { if (i.fields.issuetype?.name) types.add(i.fields.issuetype.name); });
    return Array.from(types);
  };

  const getUniqueStatuses = () => {
    const statuses = new Set();
    issues.forEach(i => { if (i.fields.status?.name) statuses.add(i.fields.status.name); });
    return Array.from(statuses);
  };

  const generateSubtaskWithAI = async () => {
    if (!creds.groqKey) {
      setMsg({ t: "err", m: "Enter Groq API key in Settings first." });
      return;
    }
    if (!subtaskForm.summary.trim()) {
      setMsg({ t: "warn", m: "Enter a subtask summary first." });
      return;
    }
    
    setSubtaskAiLoading(true);
    
    const parentSummary = selIssue?.fields?.summary || "Feature";
    const subtaskName = subtaskForm.summary;
    
    const userPrompt = `Generate a subtask description for: "${subtaskName}"

Parent Epic/Story: "${parentSummary}"

Write ONLY valid markdown with these exact sections (no preamble):

## Objective
[2-3 sentences about the goal of this subtask]

## Scope
### In Scope:
- [items included in this subtask]

### Out of Scope:
- [items excluded from this subtask]

## Plan of Action
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Technical Requirements
- **Tech Stack:** [technologies needed]
- **Dependencies:** [libraries/packages]
- **API Contracts:** [endpoints if any]

## Test Cases
### TC-1: [Test Title]
- **Precondition:** [setup]
- **Steps:** [actions]
- **Expected Result:** [outcome]

## Acceptance Criteria
[ ] [Criterion 1]
[ ] [Criterion 2]`;

    try {
      let generatedContent = "";
      await callAI(
        "You are an expert Jira ticket writer. Return ONLY the markdown content with all sections filled in.",
        userPrompt,
        (chunk) => { generatedContent += chunk; },
        creds.groqKey,
        creds.aiModel || "llama-3.3-70b-versatile"
      );
      
      const lines = generatedContent.split("\n");
      let currentSection = "";
      let sectionContent = {};
      
      lines.forEach(line => {
        if (line.startsWith("## Objective")) currentSection = "objective";
        else if (line.startsWith("### In Scope:")) currentSection = "scope_in";
        else if (line.startsWith("### Out of Scope:")) currentSection = "scope_out";
        else if (line.startsWith("## Plan of Action")) currentSection = "plan";
        else if (line.startsWith("## Technical")) currentSection = "tech";
        else if (line.startsWith("## Test Cases") || line.startsWith("### TC-")) currentSection = "tests";
        else if (line.startsWith("## Acceptance")) currentSection = "acceptance";
        else if (currentSection) {
          if (!sectionContent[currentSection]) sectionContent[currentSection] = "";
          sectionContent[currentSection] += line + "\n";
        }
      });
      
      const newDraft = {
        id: Date.now(),
        summary: subtaskName,
        priority: subtaskForm.priority,
        description: generatedContent,
        sections: sectionContent,
        createdWithAI: true
      };
      
      setSubtaskDrafts(p => [...p, newDraft]);
      setSubtaskForm({ summary: "", description: "", priority: "Medium", assignee: "" });
      setMsg({ t: "ok", m: "✓ Subtask draft added to list" });
    } catch (e) {
      setMsg({ t: "err", m: `AI Error: ${e.message}` });
    }
    setSubtaskAiLoading(false);
  };

  const addManualSubtaskDraft = () => {
    if (!subtaskForm.summary.trim()) {
      setMsg({ t: "warn", m: "Enter a subtask summary." });
      return;
    }
    const newDraft = {
      id: Date.now(),
      summary: subtaskForm.summary,
      priority: subtaskForm.priority,
      description: subtaskForm.description,
      sections: {},
      createdWithAI: false
    };
    setSubtaskDrafts(p => [...p, newDraft]);
    setSubtaskForm({ summary: "", description: "", priority: "Medium", assignee: "" });
    setMsg({ t: "ok", m: "✓ Subtask draft added to list" });
  };

  const removeSubtaskDraft = (id) => {
    setSubtaskDrafts(p => p.filter(d => d.id !== id));
  };

  const addSubtaskToJira = async (draft) => {
    if (!selIssue) return;
    const parentProject = selIssue.fields?.project?.key || form.project;
    
    const result = await wrap("subtask", "POST create subtask", () => api.createSubtask(selIssue.key, parentProject, draft.summary, draft.description), "/rest/api/3/issue");
    
    if (result) {
      setMsg({ t: "ok", m: `✓ Subtask ${result.key} added to ${selIssue.key}` });
      removeSubtaskDraft(draft.id);
      await selectIssue(selIssue);
      fetchIssues(true);
    }
  };

  const deleteIssue = async (key) => {
    if (!window.confirm(`Delete ${key}?`)) return;
    await wrap("del","DELETE issue", ()=>api.deleteIssue(key), `/rest/api/3/issue/${key}`);
    setIssues(p=>p.filter(i=>i.key!==key));
    const effectiveJql = getEffectiveJql();
    if (JIRA_MEM_CACHE.issuesByJql.has(effectiveJql)) {
      const current = JIRA_MEM_CACHE.issuesByJql.get(effectiveJql);
      JIRA_MEM_CACHE.issuesByJql.set(effectiveJql, {
        ...current,
        issues: (current.issues || []).filter(i => i.key !== key),
        total: Math.max(0, (current.total ?? (current.issues || []).length) - 1),
      });
    }
    if (selIssue?.key === key) setSelIssue(null);
    fetchIssues(true);
  };

  const doTransition = async (tid) => {
    await wrap("tr","POST transition", ()=>api.doTransition(selIssue.key, tid), `/rest/api/3/issue/${selIssue.key}/transitions`);
    await selectIssue(selIssue);
    fetchIssues(true);
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    await wrap("addcmt","POST comment", ()=>api.addComment(selIssue.key, commentText), `/rest/api/3/issue/${selIssue.key}/comment`);
    setCommentText("");
    const r = await api.getComments(selIssue.key);
    setComments(r.comments || []);
  };

  const addWorklog = async () => {
    const hoursPerDay = 8;
    const seconds = Math.round(parseFloat(worklogDays) * hoursPerDay * 3600) || 28800;
    await wrap("wl","POST worklog", ()=>api.addWorklog(selIssue.key, seconds), `/rest/api/3/issue/${selIssue.key}/worklog`);
  };

  const fetchUsers = async () => {
    const r = await wrap("users","GET users", ()=>api.getUsers(""), "/rest/api/3/user/search");
    if (r) setUsers(Array.isArray(r) ? r : []);
  };

  const updateIssueWithAi = async () => {
    if (!selIssue) return;
    const descContent = editForm.description || "";
    const updatePayload = {
      fields: {
        summary: editForm.summary,
        description: { type:"doc", version:1, content:[{type:"paragraph",content:[{type:"text",text:descContent}]}]},
        priority: { name: editForm.priority || "Medium" }
      }
    };
    await wrap("upd","PUT update issue", ()=>api.updateIssue(selIssue.key, updatePayload), `/rest/api/3/issue/${selIssue.key}`);
    fetchIssues(true);
    setMsg({ t:"ok", m:`✓ Updated ${selIssue.key}` });
  };

  const runAiEdit = async () => {
    if (!selIssue || !aiEditPrompt.trim()) return;
    setAiLoading(true);
    setAiOutput("");
    const currentValue = selIssue.fields?.[aiEditField] || "";
    const systemPrompt = `You are an expert Jira ticket editor. Given the current value of a ticket field and user's instructions, provide the improved version. Return ONLY the new value for the field, nothing else. Be concise and follow Jira conventions.`;
    const userPrompt = `Field: ${aiEditField}\n\nCurrent value:\n${currentValue}\n\nUser instruction:\n${aiEditPrompt}\n\nProvide the updated ${aiEditField}:`;
    try {
      await callAI(systemPrompt, userPrompt, (chunk) => setAiOutput(chunk), creds.groqKey, creds.aiModel || "llama-3.3-70b-versatile");
    } catch(e) {
      setAiOutput(`AI Error: ${e.message}`);
    }
    setAiLoading(false);
  };

  const applyAiEdit = () => {
    if (!aiOutput.trim()) return;
    setEditForm(p => ({ ...p, [aiEditField]: aiOutput.trim() }));
    setAiOutput("");
    setAiEditPrompt("");
  };

  const generateAllDescriptionSections = async () => {
    if (!creds.groqKey) {
      setMsg({ t: "err", m: "Enter Groq API key in Settings first." });
      return;
    }
    
    const descFields = ["objective", "scope", "plan", "tech", "tests", "acceptance"];
    descFields.forEach(f => setAiGenLoading(p => ({ ...p, [f]: true })));
    setAiGenOutput(p => ({ ...p, allLoading: true }));
    
    const issueSummary = editForm.summary || selIssue?.fields?.summary || "Feature request";
    const issueType = selIssue?.fields?.issuetype?.name || "Story";
    
    const userPrompt = `Generate a complete Jira ticket description for: "${issueSummary}"

Issue Type: ${issueType}

Write ONLY valid markdown with these exact sections (no preamble, no intro text):

## Objective
[2-3 sentences about the goal]

## Scope
### In Scope:
- [items included]

### Out of Scope:
- [items excluded]

## Plan of Action
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Technical Requirements
- **Tech Stack:** [technologies]
- **Dependencies:** [libraries/packages]
- **API Contracts:** [endpoints]
- **Non-Functional:** [performance, security]

## Test Cases
### TC-1: [Test Title]
- **Precondition:** [setup]
- **Steps:** [actions]
- **Expected Result:** [outcome]

### TC-2: [Test Title]
- **Precondition:** [setup]
- **Steps:** [actions]
- **Expected Result:** [outcome]

## Acceptance Criteria
[ ] [Criterion 1]
[ ] [Criterion 2]
[ ] [Criterion 3]`;

    try {
      await callAI(
        "You are an expert Jira ticket writer. Return ONLY the markdown content with all sections completely filled in based on the issue summary provided.",
        userPrompt,
        (chunk) => {
          const lines = chunk.split("\n");
          let currentSection = "";
          let sectionContent = {};
          
          lines.forEach(line => {
            if (line.startsWith("## Objective")) currentSection = "objective";
            else if (line.startsWith("### In Scope:")) currentSection = "scope_in";
            else if (line.startsWith("### Out of Scope:")) currentSection = "scope_out";
            else if (line.startsWith("## Plan of Action")) currentSection = "plan";
            else if (line.startsWith("## Technical")) currentSection = "tech";
            else if (line.startsWith("## Test Cases") || line.startsWith("### TC-")) currentSection = "tests";
            else if (line.startsWith("## Acceptance")) currentSection = "acceptance";
            else if (currentSection) {
              if (!sectionContent[currentSection]) sectionContent[currentSection] = "";
              sectionContent[currentSection] += line + "\n";
            }
          });
          
          descFields.forEach(f => {
            let content = sectionContent[f] || "";
            content = content.trim();
            setAiGenOutput(p => ({ ...p, [f]: content }));
          });
        },
        creds.groqKey,
        creds.aiModel || "llama-3.3-70b-versatile"
      );
      setMsg({ t: "ok", m: "✓ All description sections generated! Review and click 'Apply All' to use." });
    } catch (e) {
      setMsg({ t: "err", m: `AI Error: ${e.message}` });
      descFields.forEach(f => setAiGenOutput(p => ({ ...p, [f]: "" })));
    }
    descFields.forEach(f => setAiGenLoading(p => ({ ...p, [f]: false })));
    setAiGenOutput(p => ({ ...p, allLoading: false }));
  };

  const applyAllDescriptionSections = () => {
    const descFields = ["objective", "scope", "plan", "tech", "tests", "acceptance"];
    const newDescription = descFields.map(f => {
      const labels = { objective: "Objective", scope: "Scope", plan: "Plan of Action", tech: "Technical Requirements", tests: "Test Cases", acceptance: "Acceptance Criteria" };
      return `## ${labels[f]}\n${aiGenOutput[f] || ""}`;
    }).join("\n\n");
    
    setEditForm(p => ({ ...p, description: newDescription }));
    
    const descContent = newDescription;
    const updatePayload = {
      fields: {
        summary: editForm.summary || selIssue?.fields?.summary,
        description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: descContent }] }] },
        priority: { name: editForm.priority || selIssue?.fields?.priority?.name || "Medium" }
      }
    };
    
    wrap("upd", "PUT update issue", () => api.updateIssue(selIssue.key, updatePayload), `/rest/api/3/issue/${selIssue.key}`)
      .then(() => {
        fetchIssues(true);
        setAiGenOutput({});
        setMsg({ t: "ok", m: `✓ All sections generated and saved to ${selIssue.key}` });
      });
  };

  const getEffectiveJql = () => {
    const key = creds.jiraProjectKey?.trim().toUpperCase();
    return key ? jql.replace(/\bPROJ\b/g, key) : jql;
  };

  const adfToText = (node) => {
    if (!node) return "";
    if (Array.isArray(node)) return node.map(adfToText).join("");
    if (typeof node === "string") return node;
    if (node.type === "text") return node.text || "";
    if (node.type === "hardBreak") return "\n";
    if (Array.isArray(node.content)) {
      const body = node.content.map(adfToText).join("");
      if (["paragraph", "heading", "bulletList", "orderedList", "listItem"].includes(node.type)) return `${body}\n`;
      return body;
    }
    return "";
  };

  const commentPreview = (comment) => {
    return (
      comment?.body?.content?.[0]?.content?.[0]?.text ||
      adfToText(comment?.body) ||
      "(rich text)"
    );
  };

  const statusClass = (status) => {
    const n = status?.name || status || "";
    if (n?.includes("done") || n?.includes("closed")) return "c-done";
    if (n?.includes("progress") || n?.includes("in")) return "c-prog";
    if (n?.includes("review")) return "c-rev";
    return "c-todo";
  };

  const priorityCls = (p) => {
    if (p?.toLowerCase()==="highest"||p?.toLowerCase()==="high") return "c-high";
    if (p?.toLowerCase()==="medium") return "c-med";
    return "c-low";
  };

  return (
    <div className="body-wrap" style={{overflow:"hidden"}}>
      <div className="left-rail">
        <div className="rail-tabs">
          <button className={`rail-tab ${sub==="fetch"?"on":""}`} onClick={()=>setSub("fetch")}>ISSUES</button>
          <button className={`rail-tab ${sub==="projects"?"on":""}`} onClick={()=>{setSub("projects");fetchProjects();}}>PROJ</button>
          <button className={`rail-tab ${sub==="create"?"on":""}`} onClick={()=>setSub("create")}>+ NEW</button>
        </div>
        <div className="rail-scroll">
          {sub === "fetch" && (
            <>
              <div className="rail-section-hd">JQL QUERY</div>
              <input className="inp inp-sm mono mb8" value={jql} onChange={e=>setJql(e.target.value)}
                style={{fontSize:10,width:"100%"}} />
              <button className="btn btn-c" style={{width:"100%",marginBottom:10}} onClick={fetchIssues}
                disabled={loading.fetch}>
                {loading.fetch ? <><span className="spin">⟳</span> Fetching...</> : "⚡ Fetch Issues"}
              </button>
              {issues.map(i=>(
                <div key={i.key} className={`tcard ${selIssue?.key===i.key?"sel":""}`}
                  onClick={()=>selectIssue(i)}>
                  <div className="tcard-id">
                    <span className={`chip ${i.fields.issuetype?.name==="Bug"?"c-bug":i.fields.issuetype?.name==="Subtask"?"c-sub":"c-task"}`}>
                      {i.fields.issuetype?.name}
                    </span>
                    {i.key}
                  </div>
                  <div className="tcard-title">{i.fields.summary}</div>
                  <div className="tcard-meta">
                    <span className={`chip ${statusClass(i.fields.status)}`}>{i.fields.status?.name}</span>
                    <span className={`chip ${priorityCls(i.fields.priority?.name)}`}>{i.fields.priority?.name}</span>
                    {i.fields.assignee && <span className="chip c-todo">👤 {i.fields.assignee.displayName?.split(" ")[0]}</span>}
                  </div>
                </div>
              ))}
              {issues.length === 0 && !loading.fetch && (
                <div className="muted xs mono mt8" style={{textAlign:"center"}}>No issues. Fetch or check JQL.</div>
              )}
            </>
          )}
          {sub === "projects" && (
            <>
              <button className="btn btn-c" style={{width:"100%",marginBottom:10}} onClick={fetchProjects}>
                {loading.proj ? <span className="spin">⟳</span> : "⚡"} Load Projects
              </button>
              {projects.map(p=>(
                <div key={p.key} className="tcard" onClick={()=>{setForm(f=>({...f,project:p.key}));setSub("create");}}>
                  <div className="tcard-id">{p.key}</div>
                  <div className="tcard-title">{p.name}</div>
                  <div className="tcard-meta"><span className="chip c-task">{p.projectTypeKey}</span></div>
                </div>
              ))}
            </>
          )}
          {sub === "create" && (
            <div style={{fontSize:11,color:"var(--t1)",textAlign:"center",padding:"12px 0"}}>
              Fill form on right →
            </div>
          )}
        </div>
      </div>

      <div className="main-content">
        {msg && <div className={msg.t==="ok"?"success":msg.t==="warn"?"warn":"err"}>{msg.m}</div>}

        {!creds.jiraOk && (
          <div className="warn">⚠ Jira not connected. Go to Settings → Jira to enter credentials.
            &nbsp;<button className="btn btn-a btn-sm" style={{padding:"3px 8px"}} onClick={()=>{}}>Open Settings</button>
          </div>
        )}

        <div className="tab-row">
          {[
            {id:"fetch",l:"🔍 Issues"},
            {id:"create",l:"+ Create"},
            {id:"issue-detail",l:"📋 Detail"},
            {id:"transitions",l:"🔀 Transitions"},
            {id:"comments",l:"💬 Comments"},
            {id:"users",l:"👥 Users"},
          ].map(t=>(
            <button key={t.id} className={`tab-item ${sub===t.id?"on":""}`} onClick={()=>setSub(t.id)}>{t.l}</button>
          ))}
        </div>

        {/* ISSUES TABLE */}
        {sub === "fetch" && (
          <div>
            <div className="row-wrap mb12">
              <div className="sec-title">Jira Issues</div>
              <div className="sp"/>
              <span className="xs muted mono">POST /rest/api/3/search/jql</span>
              <span className="badge" style={{background:"var(--gdim)",color:"var(--green)",borderColor:"var(--green)"}}>
                {issues.length} results
              </span>
              <button className="btn btn-n btn-sm" style={{padding:"4px 8px",fontSize:10}} onClick={() => fetchIssues(true)} disabled={loading.fetch}>
                {loading.fetch?<span className="spin">⟳</span>:"↻"} Reload
              </button>
            </div>
            <div className="panel">
              <div className="ph">
                <div className="ph-icon" style={{background:"var(--bdim)"}}>🔍</div>
                <div className="phtitle">JQL Search & Filters</div>
              </div>
              <div className="pb">
                <div className="fg">
                  <label className="label">JQL Query</label>
                  <div className="row">
                    <input className="inp inp-sm mono" value={jql} onChange={e=>setJql(e.target.value)} style={{flex:1,fontSize:11}} />
                    <button className="btn btn-c" onClick={fetchIssues} disabled={loading.fetch}>
                      {loading.fetch?<span className="spin">⟳</span>:"⚡"} Search
                    </button>
                  </div>
                </div>
                <div className="row-wrap" style={{gap:6}}>
                  {["project = PROJ ORDER BY created DESC",
                    "assignee = currentUser() AND status != Done",
                    "status = 'In Progress' ORDER BY priority",
                    "issuetype = Bug AND priority = High",
                    "sprint in openSprints()"].map(q=>(
                    <button key={q} className="btn btn-n" style={{fontSize:9,padding:"2px 7px"}}
                      onClick={()=>setJql(q)}>{q.slice(0,32)}…</button>
                  ))}
                </div>
              </div>
            </div>

            {issues.length > 0 && (
              <div className="panel">
                <div className="ph">
                  <div className="ph-icon" style={{background:"var(--bdim)"}}>📋</div>
                  <div className="phtitle">Results ({sortedAndFilteredIssues().length} of {issues.length})</div>
                </div>
                <div className="pb" style={{padding:"12px",background:"var(--bg2)"}}>
                  <div className="row-wrap mb12" style={{gap:"8px"}}>
                    <div className="fg" style={{marginBottom:0,minWidth:120}}>
                      <label className="label">Filter Key</label>
                      <input className="inp inp-sm" placeholder="Search key..." value={filterConfig.key} 
                        onChange={e=>setFilterConfig(p=>({...p,key:e.target.value}))} style={{fontSize:11}} />
                    </div>
                    <div className="fg" style={{marginBottom:0,minWidth:120}}>
                      <label className="label">Filter Type</label>
                      <select className="sel" style={{width:"100%",fontSize:11}} value={filterConfig.type} 
                        onChange={e=>setFilterConfig(p=>({...p,type:e.target.value}))}>
                        <option value="">All Types</option>
                        {getUniqueTypes().map(t=>(
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div className="fg" style={{marginBottom:0,minWidth:140}}>
                      <label className="label">Filter Status</label>
                      <select className="sel" style={{width:"100%",fontSize:11}} value={filterConfig.status} 
                        onChange={e=>setFilterConfig(p=>({...p,status:e.target.value}))}>
                        <option value="">All Statuses</option>
                        {getUniqueStatuses().map(s=>(
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    {(filterConfig.key || filterConfig.type || filterConfig.status) && (
                      <button className="btn btn-n btn-sm" style={{alignSelf:"flex-end",padding:"6px 10px"}} 
                        onClick={()=>setFilterConfig({key:'',type:'',status:''})}>Clear Filters</button>
                    )}
                  </div>
                </div>
                <div className="pb" style={{padding:0}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{borderBottom:"1px solid var(--border)"}}>
                        {[
                          {id:"key",l:"Key"},
                          {id:"summary",l:"Summary"},
                          {id:"type",l:"Type"},
                          {id:"status",l:"Status"},
                          {id:"priority",l:"Priority"},
                          {id:"assignee",l:"Assignee"},
                          {id:"action",l:"Action"}
                        ].map(h=>(
                          <th key={h.id} style={{padding:"8px 12px",textAlign:"left",fontFamily:"var(--mono)",
                            fontSize:9,letterSpacing:1.5,textTransform:"uppercase",color:"var(--t2)",
                            background:"var(--bg2)",cursor:h.id==="action"?"default":"pointer"}}
                            onClick={h.id!=="action"?()=>handleSort(h.id):null}>
                            {h.l} {h.id !== "action" && <span style={{marginLeft:4,fontSize:10}}>{getSortIcon(h.id)}</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAndFilteredIssues().map((i,idx)=>(
                        <tr key={i.key} style={{borderBottom:"1px solid var(--border)",
                          background: selIssue?.key === i.key ? "var(--cdim)" : (idx % 2 === 0 ? "var(--bg1)" : "transparent")}}
                          className="tcard-row">
                          <td style={{padding:"8px 12px",fontFamily:"var(--mono)",fontSize:11,color:"var(--cyan)"}}>{i.key}</td>
                          <td style={{padding:"8px 12px",maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{i.fields.summary}</td>
                          <td style={{padding:"8px 12px"}}><span className={`chip ${i.fields.issuetype?.name==="Bug"?"c-bug":"c-task"}`}>{i.fields.issuetype?.name}</span></td>
                          <td style={{padding:"8px 12px"}}><span className={`chip ${statusClass(i.fields.status)}`}>{i.fields.status?.name}</span></td>
                          <td style={{padding:"8px 12px"}}><span className={`chip ${priorityCls(i.fields.priority?.name)}`}>{i.fields.priority?.name}</span></td>
                          <td style={{padding:"8px 12px",fontSize:11,color:"var(--t1)"}}>{i.fields.assignee?.displayName||"—"}</td>
                          <td style={{padding:"8px 12px"}}>
                            <div className="row" style={{gap:4}}>
                              <button className="btn btn-c" style={{padding:"2px 7px",fontSize:9}} onClick={()=>selectIssue(i)}>View</button>
                              <button className="btn btn-r" style={{padding:"2px 7px",fontSize:9}} onClick={()=>deleteIssue(i.key)}>Del</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CREATE ISSUE */}
        {sub === "create" && (
          <div>
            <div className="sec-title mb12">Create Jira Issue <span className="xs muted">with AI Assistance</span></div>
            <div className="warn xs mb12">Endpoint: <span className="mono text-c">POST /rest/api/3/issue</span></div>
            <div className="panel">
              <div className="ph"><div className="ph-icon" style={{background:"var(--gdim)"}}>+</div><div className="phtitle">New Issue</div></div>
              <div className="pb">
                <div className="g2">
                  <div className="fg">
                    <label className="label">Project Key *</label>
                    <input className="inp inp-sm mono" placeholder="e.g. PROJ" value={form.project}
                      onChange={e=>setForm(p=>({...p,project:e.target.value}))} />
                  </div>
                  <div className="fg">
                    <label className="label">Issue Type</label>
                    <select className="sel" style={{width:"100%"}} value={form.type} onChange={e=>setForm(p=>({...p,type:e.target.value}))}>
                      {["Story","Bug","Task","Sub-task","Epic"].map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="fg">
                  <label className="label">Summary *</label>
                  <div className="row">
                    <input className="inp inp-sm" placeholder="Issue summary" value={form.summary}
                      onChange={e=>setForm(p=>({...p,summary:e.target.value}))} />
                    <button className="btn btn-p" style={{marginLeft:8,whiteSpace:"nowrap"}} onClick={()=>generateFieldWithAI("summary")} disabled={aiGenLoading.summary}>
                      {aiGenLoading.summary?<span className="spin">⟳</span>:"⚡"} AI
                    </button>
                  </div>
                  {aiGenOutput.summary && !aiGenLoading.summary && (
                    <div style={{marginTop:8}}>
                      <div className="ai-out" style={{maxHeight:80,padding:"8px 10px"}}>{aiGenOutput.summary}</div>
                      <button className="btn btn-g btn-sm mt4" onClick={()=>{setForm(p=>({...p,summary:aiGenOutput.summary}));setAiGenOutput(x=>({...x,summary:""}))}}>Apply</button>
                    </div>
                  )}
                </div>
                
                <div className="divider"/>
                <div className="sec-sub mb8">Description (AI-Generated Sections)</div>
                
                {["objective","scope","plan","tech","tests","acceptance"].map(field => {
                  const labels = { objective:"Objective", scope:"Scope", plan:"Plan of Action", tech:"Technical Requirements", tests:"Test Cases", acceptance:"Acceptance Criteria" };
                  return (
                    <div key={field} className="fg">
                      <label className="label">{labels[field]}</label>
                      <div className="row">
                        <textarea 
                          className="textarea" 
                          rows={field === "scope" || field === "tech" ? 4 : 3} 
                          placeholder={`Describe ${labels[field].toLowerCase()}...`}
                          value={aiGenOutput[field] || ""}
                          onChange={e=>setAiGenOutput(p=>({...p,[field]:e.target.value}))}
                        />
                        <button className="btn btn-p" style={{marginLeft:8,whiteSpace:"nowrap",alignSelf:"flex-start"}} onClick={()=>generateFieldWithAI(field, aiGenOutput[field])} disabled={aiGenLoading[field]}>
                          {aiGenLoading[field]?<span className="spin">⟳</span>:"⚡"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                
                <button className="btn btn-g mt8" onClick={createIssue} disabled={loading.create}>
                  {loading.create?<span className="spin">⟳</span>:"+"} Create Issue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ISSUE DETAIL */}
        {sub === "issue-detail" && (
          <div>
            {!selIssue ? (
              <div className="info">← Select an issue from the Fetch tab to view details.</div>
            ) : (
              <>
                <div className="row-wrap mb12">
                  <div>
                    <div className="sec-title">{selIssue.key}</div>
                    <div className="row mt4">
                      <span className={`chip ${statusClass(selIssue.fields?.status)}`}>{selIssue.fields?.status?.name}</span>
                      <span className={`chip ${priorityCls(selIssue.fields?.priority?.name)}`}>{selIssue.fields?.priority?.name}</span>
                    </div>
                  </div>
                  <div className="sp"/>
                  {(selIssue.fields?.issuetype?.name === "Story" || selIssue.fields?.issuetype?.name === "Epic") && (
                    <button className="btn btn-p" onClick={() => setShowSubtaskForm(!showSubtaskForm)}>+ Subtasks ({selIssue.fields?.subtasks?.length || 0})</button>
                  )}
                  <button className="btn btn-c" onClick={()=>onLaunchWorkflow?.(selIssue)}>🚀 Launch Workflow</button>
                  <button className="btn btn-r" onClick={()=>deleteIssue(selIssue.key)}>🗑 Delete</button>
                </div>
                <div className="panel">
                  <div className="ph"><div className="ph-icon" style={{background:"var(--adim)"}}>✏</div>
                    <div className="phtitle">Edit Issue</div>
                    <span className="xs muted mono sp">PUT /rest/api/3/issue/{selIssue.key}</span>
                  </div>
                  <div className="pb">
                    <div className="tab-row mb12" style={{maxWidth:320}}>
                      <button className={`tab-item ${editMode==="manual"?"on":""}`} onClick={()=>setEditMode("manual")}>✏ Manual</button>
                      <button className={`tab-item ${editMode==="ai"?"on":""}`} onClick={()=>setEditMode("ai")}>⚡ AI Mode</button>
                    </div>
                    
                    {editMode === "manual" ? (
                      <div>
                        <div className="fg">
                          <label className="label">Summary</label>
                          <div className="row">
                            <input className="inp inp-sm" value={editForm.summary||""} onChange={e=>setEditForm(p=>({...p,summary:e.target.value}))} />
                            <button className="btn btn-p" style={{marginLeft:8}} onClick={()=>generateFieldWithAI("summary", editForm.summary)} disabled={aiGenLoading.summary}>
                              {aiGenLoading.summary?<span className="spin">⟳</span>:"⚡"} AI
                            </button>
                          </div>
                          {aiGenOutput.summary && !aiGenLoading.summary && (
                            <div style={{marginTop:8}}>
                              <div className="ai-out" style={{maxHeight:80,padding:"8px 10px"}}>{aiGenOutput.summary}</div>
                              <button className="btn btn-g btn-sm mt4" onClick={()=>{setEditForm(p=>({...p,summary:aiGenOutput.summary}));setAiGenOutput(x=>({...x,summary:""}))}}>Apply</button>
                            </div>
                          )}
                        </div>
                        <div className="fg">
                          <label className="label">Description</label>
                          <textarea className="textarea" rows={6} value={editForm.description||""} onChange={e=>setEditForm(p=>({...p,description:e.target.value}))} placeholder="Enter description with sections: Objective, Scope, Plan, Tech, Tests, Acceptance..." />
                        </div>
                        <div className="g2">
                          <div className="fg">
                            <label className="label">Priority</label>
                            <select className="sel" style={{width:"100%"}} value={editForm.priority||"Medium"} onChange={e=>setEditForm(p=>({...p,priority:e.target.value}))}>
                              {["Highest","High","Medium","Low","Lowest"].map(t=><option key={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                        <button className="btn btn-g" onClick={updateIssueWithAi} disabled={loading.upd}>
                          {loading.upd?<span className="spin">⟳</span>:"💾"} Save Changes
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="panel" style={{background:"var(--pdim)",borderColor:"var(--purple)",marginBottom:16}}>
                          <div className="pb">
                            <div className="sec-sub mb8">🚀 AI Description Generator</div>
                            <div className="xs muted mb8">Generate all description sections at once: Objective, Scope, Plan of Action, Technical Requirements, Test Cases, Acceptance Criteria</div>
                            <button className="btn btn-p" onClick={generateAllDescriptionSections} disabled={aiGenOutput.allLoading || aiLoading}>
                              {aiGenOutput.allLoading || aiLoading ? <span className="spin">⟳</span> : "⚡"} Generate All Description Sections
                            </button>
                            {(Object.values(aiGenOutput).some(v => v && typeof v === 'string' && v.length > 0) && !aiGenOutput.allLoading) && (
                              <div style={{marginTop:12}}>
                                <div className="sec-sub mb4">Generated Sections Preview:</div>
                                {["objective","scope","plan","tech","tests","acceptance"].map(field => {
                                  const labels = { objective:"Objective", scope:"Scope", plan:"Plan of Action", tech:"Technical Requirements", tests:"Test Cases", acceptance:"Acceptance Criteria" };
                                  return aiGenOutput[field] ? (
                                    <div key={field} className="fg">
                                      <label className="label">{labels[field]}</label>
                                      <div className="ai-out" style={{maxHeight:80,padding:"8px 10px",fontSize:11}}>{aiGenOutput[field]}</div>
                                    </div>
                                  ) : null;
                                })}
                                <button className="btn btn-g mt8" onClick={applyAllDescriptionSections} disabled={loading.upd}>
                                  {loading.upd ? <span className="spin">⟳</span> : "💾"} Apply All & Save to Jira
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="divider mb12"/>
                        <div className="sec-sub mb8">Or Edit Single Section</div>
                        <div className="fg">
                          <label className="label">Select Section to Edit</label>
                          <select className="sel" style={{width:"100%"}} value={aiEditField} onChange={e=>setAiEditField(e.target.value)}>
                            <option value="summary">Summary</option>
                            <option value="objective">Objective</option>
                            <option value="scope">Scope</option>
                            <option value="plan">Plan of Action</option>
                            <option value="tech">Technical Requirements</option>
                            <option value="tests">Test Cases</option>
                            <option value="acceptance">Acceptance Criteria</option>
                          </select>
                        </div>
                        <div className="fg">
                          <label className="label">AI Edit Instruction</label>
                          <textarea className="textarea" rows={2} value={aiEditPrompt} onChange={e=>setAiEditPrompt(e.target.value)} placeholder={`Describe how to improve the ${aiEditField}...`} />
                        </div>
                        <div className="row-wrap" style={{gap:8}}>
                          <button className="btn btn-p" onClick={runAiEdit} disabled={aiLoading||!aiEditPrompt.trim()}>
                            {aiLoading?<span className="spin">⟳</span>:"⚡"} Generate with AI
                          </button>
                          {aiOutput && !aiLoading && (
                            <button className="btn btn-g" onClick={applyAiEdit}>✓ Apply to Form</button>
                          )}
                        </div>
                        {(aiOutput || aiLoading) && (
                          <div className="ai-out mt12" style={{maxHeight:200}}>
                            {aiOutput}
                            {aiLoading && <span className="cur"/>}
                          </div>
                        )}
                        {aiOutput && !aiLoading && (
                          <div className="mt8">
                            <button className="btn btn-g" onClick={updateIssueWithAi} disabled={loading.upd}>
                              {loading.upd?<span className="spin">⟳</span>:"💾"} Save AI Changes to Jira
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* CREATE SUBTASK PANEL */}
                {showSubtaskForm && (selIssue.fields?.issuetype?.name === "Story" || selIssue.fields?.issuetype?.name === "Epic") && (
                  <div className="panel" style={{borderColor:"var(--purple)"}}>
                    <div className="ph"><div className="ph-icon" style={{background:"var(--pdim)"}}>+</div>
                      <div className="phtitle">Subtasks for {selIssue.key}</div>
                      <span className="xs muted mono sp">{selIssue.fields?.subtasks?.length || 0} in Jira + {subtaskDrafts.length} draft</span>
                    </div>
                    <div className="pb">
                      
                      {/* Existing Jira Subtasks */}
                      {selIssue.fields?.subtasks && selIssue.fields.subtasks.length > 0 && (
                        <div className="mb16">
                          <div className="sec-sub mb8">In Jira</div>
                          {selIssue.fields.subtasks.map(st => (
                            <div key={st.id} className="chip c-sub" style={{marginRight:6,marginBottom:6,display:"inline-block"}}>
                              {st.key}: {st.fields?.summary}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Draft Subtasks */}
                      {subtaskDrafts.length > 0 && (
                        <div className="mb16">
                          <div className="sec-sub mb8">Drafts (click + to add to Jira)</div>
                          {subtaskDrafts.map((draft) => (
                            <div key={draft.id} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"10px 12px",marginBottom:8}}>
                              <div className="row mb4">
                                <span className="xs mono text-c" style={{fontWeight:600,flex:1}}>{draft.summary}</span>
                                <span className="chip c-task" style={{marginRight:6}}>{draft.priority}</span>
                                {draft.createdWithAI && <span className="chip" style={{background:"var(--pdim)",color:"var(--purple)",marginRight:6}}>AI</span>}
                              </div>
                              {draft.description && (
                                <div className="xs muted" style={{maxHeight:60,overflow:"hidden",marginBottom:8,whiteSpace:"pre-wrap"}}>
                                  {draft.description.slice(0, 200)}...
                                </div>
                              )}
                              <div className="row" style={{gap:6}}>
                                <button className="btn btn-g btn-sm" onClick={() => addSubtaskToJira(draft)} disabled={loading.subtask}>
                                  + Add to Jira
                                </button>
                                <button className="btn btn-r btn-sm" onClick={() => removeSubtaskDraft(draft.id)}>
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <div className="divider"/>
                      <div className="sec-sub mb8">Add New Subtask</div>
                      
                      <div className="fg">
                        <label className="label">Summary</label>
                        <input className="inp inp-sm" placeholder="Enter subtask summary" value={subtaskForm.summary}
                          onChange={e=>setSubtaskForm(p=>({...p,summary:e.target.value}))} />
                      </div>
                      
                      <div className="g2 mb8">
                        <div className="fg" style={{marginBottom:0}}>
                          <label className="label">Priority</label>
                          <select className="sel" style={{width:"100%"}} value={subtaskForm.priority} onChange={e=>setSubtaskForm(p=>({...p,priority:e.target.value}))}>
                            {["Highest","High","Medium","Low","Lowest"].map(t=><option key={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                      
                      <div className="row-wrap" style={{gap:8,marginTop:8}}>
                        <button className="btn btn-p" onClick={generateSubtaskWithAI} disabled={subtaskAiLoading || !subtaskForm.summary.trim()}>
                          {subtaskAiLoading ? <span className="spin">⟳</span> : "⚡"} Generate with AI & Add Draft
                        </button>
                        <button className="btn btn-g" onClick={addManualSubtaskDraft} disabled={!subtaskForm.summary.trim()}>
                          + Add Manual Draft
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="panel">
                  <div className="ph"><div className="ph-icon" style={{background:"var(--bdim)"}}>🧾</div>
                    <div className="phtitle">Ticket Details (Exact from Jira)</div>
                  </div>
                  <div className="pb">
                    <div className="g2">
                      <div className="fg"><label className="label">Issue Key</label><div className="xs mono text-c">{selIssue.key}</div></div>
                      <div className="fg"><label className="label">Issue Type</label><div className="xs">{selIssue.fields?.issuetype?.name || "—"}</div></div>
                      <div className="fg"><label className="label">Status</label><div className="xs">{selIssue.fields?.status?.name || "—"}</div></div>
                      <div className="fg"><label className="label">Priority</label><div className="xs">{selIssue.fields?.priority?.name || "—"}</div></div>
                      <div className="fg"><label className="label">Assignee</label><div className="xs">{selIssue.fields?.assignee?.displayName || "Unassigned"}</div></div>
                      <div className="fg"><label className="label">Reporter</label><div className="xs">{selIssue.fields?.reporter?.displayName || "—"}</div></div>
                      <div className="fg"><label className="label">Created</label><div className="xs">{selIssue.fields?.created ? new Date(selIssue.fields.created).toLocaleString() : "—"}</div></div>
                      <div className="fg"><label className="label">Updated</label><div className="xs">{selIssue.fields?.updated ? new Date(selIssue.fields.updated).toLocaleString() : "—"}</div></div>
                    </div>
                    <div className="fg">
                      <label className="label">Labels</label>
                      <div className="row-wrap">
                        {(selIssue.fields?.labels || []).length === 0 && <span className="xs muted">No labels</span>}
                        {(selIssue.fields?.labels || []).map((lb)=>(
                          <span key={lb} className="chip c-task">{lb}</span>
                        ))}
                      </div>
                    </div>
                    <div className="fg">
                      <label className="label">Summary</label>
                      <div className="xs" style={{lineHeight:1.6,fontWeight:500}}>{selIssue.fields?.summary || "—"}</div>
                    </div>
                    <div className="fg">
                      <label className="label">Description (Rendered from Jira)</label>
                      {selIssue.renderedFields?.description ? (
                        <div className="xs" style={{lineHeight:1.7,padding:"10px 12px",background:"var(--bg2)",borderRadius:"var(--r)",border:"1px solid var(--border)"}} dangerouslySetInnerHTML={{ __html: selIssue.renderedFields.description }} />
                      ) : (
                        <div className="xs" style={{lineHeight:1.7,whiteSpace:"pre-wrap",padding:"10px 12px",background:"var(--bg2)",borderRadius:"var(--r)",border:"1px solid var(--border)"}}>
                          {adfToText(selIssue.fields?.description) || "No description"}
                        </div>
                      )}
                    </div>
                    {selIssue.fields?.attachment && selIssue.fields.attachment.length > 0 && (
                      <div className="fg">
                        <label className="label">Attachments</label>
                        <div className="row-wrap">
                          {selIssue.fields.attachment.map(a => (
                            <a key={a.id} href={a.content} target="_blank" rel="noreferrer" className="chip c-task" style={{textDecoration:"none"}}>{a.filename}</a>
                          ))}
                        </div>
                      </div>
                    )}
                    {selIssue.fields?.subtasks && selIssue.fields.subtasks.length > 0 && (
                      <div className="fg">
                        <label className="label">Subtasks ({selIssue.fields.subtasks.length})</label>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {selIssue.fields.subtasks.map(st => (
                            <div key={st.id} 
                              className="row" 
                              style={{padding:"8px 10px",background:"var(--bg2)",borderRadius:"var(--r)",border:"1px solid var(--border)",cursor:"pointer",alignItems:"center"}}
                              onClick={async () => {
                                const subDetail = await wrap("subtask","GET subtask", ()=>api.getIssue(st.key), `/rest/api/3/issue/${st.key}`);
                                if (subDetail) {
                                  selectIssue(subDetail, true);
                                } else {
                                  setMsg({ t: "err", m: `Subtask ${st.key} not found - may have been deleted` });
                                }
                              }}>
                              <span className="mono" style={{fontSize:11,color:"var(--cyan)"}}>{st.key}</span>
                              <span style={{flex:1,fontSize:11,marginLeft:8}}>{st.fields?.summary}</span>
                              <span className={`chip ${st.fields?.status?.name?.includes("done")||st.fields?.status?.name?.includes("closed")?"c-done":st.fields?.status?.name?.includes("progress")?"c-prog":"c-todo"}`}>{st.fields?.status?.name||"—"}</span>
                              <span className="chip c-sub">{st.fields?.issuetype?.name||"Subtask"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {selIssue.fields?.sprint && (
                      <div className="fg">
                        <label className="label">Sprint</label>
                        <div className="xs">{selIssue.fields.sprint.name || selIssue.fields.sprint}</div>
                      </div>
                    )}
                    {selIssue.fields?.storyPoints && (
                      <div className="fg">
                        <label className="label">Story Points</label>
                        <div className="xs">{selIssue.fields.storyPoints}</div>
                      </div>
                    )}
                    {selIssue.fields?.fixVersions && selIssue.fields.fixVersions.length > 0 && (
                      <div className="fg">
                        <label className="label">Fix Versions</label>
                        <div className="row-wrap">
                          {selIssue.fields.fixVersions.map(v => (
                            <span key={v.id} className="chip c-done">{v.name}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selIssue.fields?.components && selIssue.fields.components.length > 0 && (
                      <div className="fg">
                        <label className="label">Components</label>
                        <div className="row-wrap">
                          {selIssue.fields.components.map(c => (
                            <span key={c.id} className="chip c-task">{c.name}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="panel">
                  <div className="ph"><div className="ph-icon" style={{background:"var(--gdim)"}}>💬</div>
                    <div className="phtitle">Comments ({comments.length})</div>
                  </div>
                  <div className="pb">
                    <div className="row mb12">
                      <textarea className="textarea" style={{flex:1}} rows={2} value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="Write a comment..." />
                      <button className="btn btn-g" style={{marginLeft:8}} onClick={addComment} disabled={loading.addcmt||!commentText.trim()}>
                        {loading.addcmt?<span className="spin">⟳</span>:"💬"} Post
                      </button>
                    </div>
                    {comments.length === 0 && <div className="muted xs">No comments yet.</div>}
                    {comments.map(c=>(
                      <div key={c.id} style={{padding:"10px 12px",background:"var(--bg2)",borderRadius:"var(--r)",marginBottom:8,border:"1px solid var(--border)"}}>
                        <div className="row mb8">
                          <span className="xs mono text-c">{c.author?.displayName || "Unknown"}</span>
                          <span className="xs muted">{c.created ? new Date(c.created).toLocaleString() : ""}</span>
                          <div className="sp"/>
                          <button className="btn btn-r" style={{padding:"1px 6px",fontSize:9}}
                            onClick={()=>wrap("delcmt","DELETE comment",()=>api.deleteComment(selIssue.key,c.id),`/comment/${c.id}`).then(()=>setComments(p=>p.filter(x=>x.id!==c.id)))}>
                            Del
                          </button>
                        </div>
                        <div className="xs" style={{color:"var(--t1)",lineHeight:1.6,whiteSpace:"pre-wrap"}}>
                          {commentPreview(c)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="panel">
                  <div className="ph"><div className="ph-icon" style={{background:"var(--pdim)"}}>⏱</div>
                    <div className="phtitle">Log Work</div>
                    <span className="xs muted mono sp">POST /rest/api/3/issue/{selIssue.key}/worklog</span>
                  </div>
                  <div className="pb">
                    <div className="row">
                      <label className="label" style={{marginBottom:0,marginRight:8}}>Days:</label>
                      <input className="inp inp-sm mono" style={{width:100}} type="number" step="0.5" min="0" value={worklogDays} onChange={e=>setWorklogDays(e.target.value)} placeholder="0.5" />
                      <span className="xs muted">= {Math.round(parseFloat(worklogDays||"0") * 8)} hours</span>
                      <div className="sp"/>
                      <button className="btn btn-p" onClick={addWorklog} disabled={loading.wl}>+ Log Work</button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TRANSITIONS */}
        {sub === "transitions" && (
          <div>
            <div className="sec-title mb12">Status Transitions</div>
            <div className="warn xs mb12">
              <span className="mono text-c">GET /rest/api/3/issue/{"{key}"}/transitions</span> → <span className="mono text-g">POST /rest/api/3/issue/{"{key}"}/transitions</span>
            </div>
            {!selIssue ? (
              <div className="info">Select an issue first.</div>
            ) : (
              <div className="panel">
                <div className="ph">
                  <div className="ph-icon" style={{background:"var(--cdim)"}}>🔀</div>
                  <div className="phtitle">Available Transitions for {selIssue.key}</div>
                  <span className={`chip ${statusClass(selIssue.fields?.status)}`}>{selIssue.fields?.status?.name}</span>
                </div>
                <div className="pb">
                  {transitions.length === 0 && <div className="info">No transitions available.</div>}
                  {transitions.map(t=>(
                    <div key={t.id} style={{padding:"10px 14px",background:"var(--bg2)",borderRadius:"var(--r)",marginBottom:8,border:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10}}>
                      <span className="xs text-c">{t.name}</span>
                      <div className="sp"/>
                      <button className="btn btn-c" onClick={()=>doTransition(t.id)} disabled={loading.tr}>Apply</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* COMMENTS TAB */}
        {sub === "comments" && (
          <div>
            <div className="sec-title mb12">Comments Management</div>
            {!selIssue ? (
              <div className="info">Select an issue first.</div>
            ) : (
              <div className="panel">
                <div className="ph"><div className="ph-icon" style={{background:"var(--gdim)"}}>💬</div>
                  <div className="phtitle">Add Comment to {selIssue.key}</div>
                </div>
                <div className="pb">
                  <div className="row mb12">
                    <textarea className="textarea" style={{flex:1}} rows={3} value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="Write a comment..." />
                  </div>
                  <button className="btn btn-g" onClick={addComment} disabled={loading.addcmt||!commentText.trim()}>
                    {loading.addcmt?<span className="spin">⟳</span>:"💬"} Post Comment
                  </button>
                  <div className="divider"/>
                  <div className="sec-sub mb8">All Comments ({comments.length})</div>
                  {comments.map(c=>(
                    <div key={c.id} style={{padding:"10px 12px",background:"var(--bg2)",borderRadius:"var(--r)",marginBottom:8,border:"1px solid var(--border)"}}>
                      <div className="row mb8">
                        <span className="xs mono text-c">{c.author?.displayName || "Unknown"}</span>
                        <span className="xs muted">{c.created ? new Date(c.created).toLocaleString() : ""}</span>
                        <div className="sp"/>
                        <button className="btn btn-r" style={{padding:"1px 6px",fontSize:9}} onClick={()=>wrap("delcmt","DELETE comment",()=>api.deleteComment(selIssue.key,c.id),`/comment/${c.id}`).then(()=>setComments(p=>p.filter(x=>x.id!==c.id)))}>Del</button>
                      </div>
                      <div className="xs" style={{color:"var(--t1)",whiteSpace:"pre-wrap"}}>{commentPreview(c)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* USERS */}
        {sub === "users" && (
          <div>
            <div className="sec-title mb12">Jira Users</div>
            <div className="warn xs mb12">Endpoint: <span className="mono text-c">GET /rest/api/3/user/search</span></div>
            <div className="panel">
              <div className="ph"><div className="ph-icon" style={{background:"var(--pdim)"}}>👥</div>
                <div className="phtitle">Search Users</div>
              </div>
              <div className="pb">
                <div className="row mb12">
                  <button className="btn btn-p" onClick={fetchUsers} disabled={loading.users}>
                    {loading.users?<span className="spin">⟳</span>:"👥"} Load Users
                  </button>
                  {selIssue && <span className="xs muted">Assign to {selIssue.key}</span>}
                </div>
                <div className="g2">
                  {users.map(u=>(
                    <div key={u.accountId} style={{padding:"10px 12px",background:"var(--bg2)",borderRadius:"var(--r)",border:"1px solid var(--border)",display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:28,height:28,borderRadius:"50%",background:"var(--bg4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>👤</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="xs mono text-c">{u.displayName}</div>
                        <div className="xxs muted" style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.emailAddress}</div>
                      </div>
                      {selIssue && (
                        <button className="btn btn-g" style={{padding:"2px 7px",fontSize:9}}
                          onClick={()=>wrap("assign","PUT assign",()=>api.assignIssue(selIssue.key,u.accountId),`/issue/${selIssue.key}/assignee`)}>
                          Assign
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   GITHUB TAB
═══════════════════════════════════════════════════════════════════════════ */
function GitHubTab({ creds, gh, addLog }) {
  const api = gh.current;
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [branches, setBranches] = useState([]);
  const [commits, setCommits] = useState([]);
  const [prs, setPRs] = useState([]);
  const [sub, setSub] = useState("repos");

  const wrap = async (key, label, fn) => {
    if (!api) { setMsg({ t: "warn", m: "Connect GitHub first" }); return; }
    setLoading(true);
    try {
      const r = await fn();
      setMsg({ t: "ok", m: `✓ ${label}` });
      return r;
    } catch (e) {
      setMsg({ t: "err", m: e.message });
    } finally {
      setLoading(false);
    }
  };

  const loadRepos = async () => {
    const r = await wrap("repos", "Loaded repos", () => api.listRepos());
    if (r) setRepos(r);
  };

  const loadBranches = async (owner, repo) => {
    const r = await wrap("branches", "Loaded branches", () => api.listBranches(owner, repo));
    if (r) setBranches(r);
  };

  const loadCommits = async (owner, repo) => {
    const r = await wrap("commits", "Loaded commits", () => api.listCommits(owner, repo));
    if (r) setCommits(r);
  };

  const loadPRs = async (owner, repo) => {
    const r = await wrap("prs", "Loaded PRs", () => api.listPRs(owner, repo));
    if (r) setPRs(r);
  };

  return (
    <div className="main-content">
      <div className="sec-title mb12">🐙 GitHub</div>
      {msg && <div className={msg.t === "ok" ? "success" : msg.t === "warn" ? "warn" : "err"}>{msg.m}</div>}
      
      <div className="tab-row mb12">
        {["repos", "branches", "commits", "prs"].map(s => (
          <button key={s} className={`tab-item ${sub === s ? "on" : ""}`} onClick={() => setSub(s)}>{s.toUpperCase()}</button>
        ))}
      </div>

      {sub === "repos" && (
        <div className="panel">
          <div className="ph"><div className="ph-icon" style={{ background: "var(--bdim)" }}>📦</div>
            <div className="phtitle">Repositories</div>
          </div>
          <div className="pb">
            <button className="btn btn-c mb12" onClick={loadRepos} disabled={loading}>⚡ Load Repos</button>
            <div className="g2">
              {repos.map(r => (
                <div key={r.id} className="tcard" onClick={() => { setSelectedRepo(r); loadBranches(r.owner.login, r.name); loadPRs(r.owner.login, r.name); }}>
                  <div className="tcard-id">{r.name}</div>
                  <div className="tcard-title">{r.description || "No description"}</div>
                  <div className="tcard-meta">
                    <span className="chip c-task">{r.language || "—"}</span>
                    <span className="chip c-todo">⭐ {r.stargazers_count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {sub === "branches" && selectedRepo && (
        <div className="panel">
          <div className="ph"><div className="ph-icon" style={{ background: "var(--gdim)" }}>🌿</div>
            <div className="phtitle">Branches - {selectedRepo.name}</div>
          </div>
          <div className="pb">
            {branches.map(b => (
              <div key={b.name} className="row" style={{ padding: "8px", borderBottom: "1px solid var(--border)" }}>
                <span className="mono">{b.name}</span>
                <span className="xs muted"> - {b.commit.sha.slice(0, 7)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sub === "commits" && selectedRepo && (
        <div className="panel">
          <div className="ph"><div className="ph-icon" style={{ background: "var(--pdim)" }}>📜</div>
            <div className="phtitle">Commits - {selectedRepo.name}</div>
          </div>
          <div className="pb">
            {commits.map(c => (
              <div key={c.sha} style={{ padding: "8px", borderBottom: "1px solid var(--border)" }}>
                <div className="mono" style={{ fontSize: 11 }}>{c.sha.slice(0, 7)}</div>
                <div className="xs">{c.commit?.message}</div>
                <div className="xxs muted">{c.commit?.author?.date}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sub === "prs" && selectedRepo && (
        <div className="panel">
          <div className="ph"><div className="ph-icon" style={{ background: "var(--cdim)" }}>🔀</div>
            <div className="phtitle">Pull Requests - {selectedRepo.name}</div>
          </div>
          <div className="pb">
            {prs.length === 0 && <div className="muted xs">No open PRs</div>}
            {prs.map(pr => (
              <div key={pr.number} style={{ padding: "8px", borderBottom: "1px solid var(--border)" }}>
                <div className="row">
                  <span className="mono text-c">#{pr.number}</span>
                  <span className="chip c-prog">{pr.state}</span>
                </div>
                <div className="xs">{pr.title}</div>
                <div className="xxs muted">{pr.user?.login} • {pr.created_at}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AI TOOLS TAB
═══════════════════════════════════════════════════════════════════════════ */
function AIToolsTab({ creds }) {
  const [tool, setTool] = useState("codegen");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const runAI = async () => {
    if (!creds?.groqKey) { setMsg({ t: "err", m: "Set Groq key in Settings" }); return; }
    setLoading(true);
    setOutput("");
    try {
      let system = "You are a helpful AI assistant.";
      let user = input;
      
      if (tool === "codegen") {
        system = "You are an expert full-stack developer. Generate clean, production-ready code.";
        user = `Write code for: ${input}`;
      } else if (tool === "review") {
        system = "You are an expert code reviewer. Provide constructive feedback.";
        user = `Review this code: ${input}`;
      } else if (tool === "explain") {
        system = "You are an expert at explaining code clearly.";
        user = `Explain this: ${input}`;
      } else if (tool === "refactor") {
        system = "You are an expert at refactoring code to be cleaner and more efficient.";
        user = `Refactor this code: ${input}`;
      }

      await callAI(system, user, (chunk) => setOutput(p => p + chunk), creds.groqKey, creds.aiModel || "llama-3.3-70b-versatile");
      setMsg({ t: "ok", m: "✓ Done" });
    } catch (e) {
      setMsg({ t: "err", m: e.message });
    }
    setLoading(false);
  };

  return (
    <div className="main-content">
      <div className="sec-title mb12">⚡ AI Tools</div>
      {msg && <div className={msg.t === "ok" ? "success" : msg.t === "warn" ? "warn" : "err"}>{msg.m}</div>}
      
      <div className="panel">
        <div className="ph"><div className="ph-icon" style={{ background: "var(--pdim)" }}>🔧</div>
          <div className="phtitle">Select Tool</div>
        </div>
        <div className="pb">
          <div className="tab-row mb12" style={{ maxWidth: 400 }}>
            {[
              { id: "codegen", label: "Code Gen" },
              { id: "review", label: "Code Review" },
              { id: "explain", label: "Explain" },
              { id: "refactor", label: "Refactor" }
            ].map(t => (
              <button key={t.id} className={`tab-item ${tool === t.id ? "on" : ""}`} onClick={() => setTool(t.id)}>{t.label}</button>
            ))}
          </div>
          
          <div className="fg">
            <label className="label">Input</label>
            <textarea className="textarea" rows={6} value={input} onChange={e => setInput(e.target.value)} placeholder={tool === "codegen" ? "Describe what code to generate..." : "Paste code here..."} />
          </div>
          
          <button className="btn btn-p" onClick={runAI} disabled={loading || !input.trim()}>
            {loading ? <span className="spin">⟳</span> : "⚡"} Run AI
          </button>
          
          {output && (
            <div className="fg mt12">
              <label className="label">Output</label>
              <div className="ai-out" style={{ maxHeight: 400 }}>{output}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   API LOG TAB
═══════════════════════════════════════════════════════════════════════════ */
function APILogTab({ logs }) {
  return (
    <div className="main-content">
      <div className="sec-title mb12">📡 API Log</div>
      <div className="panel">
        <div className="ph"><div className="ph-icon" style={{ background: "var(--bdim)" }}>📋</div>
          <div className="phtitle">Request Log ({logs.length})</div>
        </div>
        <div className="pb">
          {logs.length === 0 && <div className="muted xs">No API calls yet</div>}
          {logs.slice().reverse().map((l, i) => (
            <div key={i} className="log-line">
              <span className="log-ts">{l.ts}</span>
              <span className={`chip ${l.method === "GET" ? "c-prog" : l.method === "POST" ? "c-done" : l.method === "PUT" ? "c-rev" : "c-high"}`}>{l.method}</span>
              <span className="mono" style={{ fontSize: 10 }}>{l.url}</span>
              <span className={l.status?.includes("200") ? "text-g" : l.status?.includes("20") ? "text-g" : "text-r"}>{l.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SETTINGS TAB
═══════════════════════════════════════════════════════════════════════════ */
function SettingsTab({ creds, setCreds, onConnect }) {
  const [show, setShow] = useState({});
  const [jiraDiag, setJiraDiag] = useState(null);
  const [jiraDiagLoading, setJiraDiagLoading] = useState(false);
  const [jiraTicketKey, setJiraTicketKey] = useState("");
  const [jiraTicket, setJiraTicket] = useState(null);
  const [jiraTicketLoading, setJiraTicketLoading] = useState(false);
  const [jiraTicketEdit, setJiraTicketEdit] = useState({});
  const [jiraTicketMsg, setJiraTicketMsg] = useState(null);
  const [ticketEditMode, setTicketEditMode] = useState("manual");
  const [ticketAiOutput, setTicketAiOutput] = useState("");
  const [ticketAiLoading, setTicketAiLoading] = useState(false);
  const [ticketAiPrompt, setTicketAiPrompt] = useState("");
  const [ticketAiField, setTicketAiField] = useState("summary");
  const toggle = (k) => setShow(p=>({...p,[k]:!p[k]}));
  const inp = (key, placeholder, isSecret=false) => (
    <div className="row">
      <input
        className="inp inp-sm" style={{flex:1,fontFamily:"var(--mono)",fontSize:11,letterSpacing:isSecret&&!show[key]?2:0}}
        type={isSecret&&!show[key]?"password":"text"}
        placeholder={placeholder}
        value={creds[key]||""}
        onChange={e=>setCreds(p=>({...p,[key]:e.target.value}))}
      />
      {isSecret && <button className="btn btn-n" style={{padding:"4px 8px",fontSize:11}} onClick={()=>toggle(key)}>{show[key]?"🙈":"👁"}</button>}
    </div>
  );

  const fetchJiraTicketFromSettings = async () => {
    if (!creds.jiraOk || !jiraTicketKey.trim()) {
      setJiraTicketMsg({ t:"warn", m:"Connect Jira first and enter a ticket key." });
      return;
    }
    setJiraTicketLoading(true);
    setJiraTicketMsg(null);
    try {
      const jira = new JiraAPI(creds.jiraUrl, creds.jiraEmail, creds.jiraToken);
      const ticket = await jira.req("GET", `/issue/${jiraTicketKey.trim()}?expand=renderedFields`);
      setJiraTicket(ticket);
      setJiraTicketEdit({
        summary: ticket.fields?.summary || "",
        description: ticket.fields?.description ? (ticket.renderedFields?.description ? ticket.fields.description : JSON.stringify(ticket.fields.description)) : "",
        priority: ticket.fields?.priority?.name || "Medium"
      });
      setJiraTicketMsg({ t:"ok", m:`✓ Loaded ${jiraTicketKey}` });
    } catch(e) {
      setJiraTicketMsg({ t:"err", m:`✗ ${e.message}` });
      setJiraTicket(null);
    }
    setJiraTicketLoading(false);
  };

  const saveJiraTicketFromSettings = async () => {
    if (!jiraTicket) return;
    setJiraTicketLoading(true);
    setJiraTicketMsg(null);
    try {
      const jira = new JiraAPI(creds.jiraUrl, creds.jiraEmail, creds.jiraToken);
      await jira.req("PUT", `/issue/${jiraTicket.key}`, {
        fields: {
          summary: jiraTicketEdit.summary,
          description: { type:"doc", version:1, content:[{type:"paragraph",content:[{type:"text",text:jiraTicketEdit.description||""}]}] },
          priority: { name: jiraTicketEdit.priority }
        }
      });
      setJiraTicketMsg({ t:"ok", m:`✓ Saved ${jiraTicket.key}` });
      fetchJiraTicketFromSettings();
    } catch(e) {
      setJiraTicketMsg({ t:"err", m:`✗ ${e.message}` });
    }
    setJiraTicketLoading(false);
  };

  const runTicketAiEdit = async () => {
    if (!jiraTicket || !ticketAiPrompt.trim()) return;
    setTicketAiLoading(true);
    setTicketAiOutput("");
    const currentValue = jiraTicket.fields?.[ticketAiField] || "";
    const systemPrompt = `You are an expert Jira ticket editor. Given the current value of a ticket field and user's instructions, provide the improved version. Return ONLY the new value for the field, nothing else. Be concise and follow Jira conventions.`;
    const userPrompt = `Field: ${ticketAiField}\n\nCurrent value:\n${currentValue}\n\nUser instruction:\n${ticketAiPrompt}\n\nProvide the updated ${ticketAiField}:`;
    try {
      await callAI(systemPrompt, userPrompt, (chunk) => setTicketAiOutput(chunk), creds.groqKey, creds.aiModel || "llama-3.3-70b-versatile");
    } catch(e) {
      setTicketAiOutput(`AI Error: ${e.message}`);
    }
    setTicketAiLoading(false);
  };

  const applyTicketAiEdit = () => {
    if (!ticketAiOutput.trim()) return;
    setJiraTicketEdit(p => ({ ...p, [ticketAiField]: ticketAiOutput.trim() }));
    setTicketAiOutput("");
    setTicketAiPrompt("");
  };

  const adfToTextLocal = (node) => {
    if (!node) return "";
    if (Array.isArray(node)) return node.map(adfToTextLocal).join("");
    if (typeof node === "string") return node;
    if (node.type === "text") return node.text || "";
    if (node.type === "hardBreak") return "\n";
    if (Array.isArray(node.content)) {
      const body = node.content.map(adfToTextLocal).join("");
      if (["paragraph", "heading", "bulletList", "orderedList", "listItem"].includes(node.type)) return `${body}\n`;
      return body;
    }
    return "";
  };

  const runJiraAuthDebug = async () => {
    setJiraDiagLoading(true);
    setJiraDiag(null);
    const cleanedToken = sanitizeSecret(creds.jiraToken);
    const tokenWhitespaceChars = Math.max(0, String(creds.jiraToken || "").length - cleanedToken.length);
    const used = {
      jiraUrl: normalizeJiraBaseUrl(creds.jiraUrl),
      jiraEmail: creds.jiraEmail,
      jiraProjectKey: (creds.jiraProjectKey || "").trim().toUpperCase(),
      jiraTokenLen: cleanedToken.length,
      jiraTokenWhitespaceChars: tokenWhitespaceChars,
      jiraTokenPreview: cleanedToken ? `${cleanedToken.slice(0, 6)}...${cleanedToken.slice(-4)}` : "",
    };
    try {
      const jira = new JiraAPI(creds.jiraUrl, creds.jiraEmail, cleanedToken);
      const steps = {};

      const myself = await jira.req("GET", "/myself");
      steps.myself = "ok";

      const project = await jira.getProject((creds.jiraProjectKey || "").trim().toUpperCase());
      steps.project = "ok";

      const search = await jira.searchIssues(`project = ${(creds.jiraProjectKey || "").trim().toUpperCase()} ORDER BY created DESC`, "summary", 1);
      steps.search = "ok";

      setJiraDiag({
        ok: true,
        used: { ...used, jiraUrl: jira.baseUrl },
        steps,
        myself: {
          accountId: myself.accountId,
          emailAddress: myself.emailAddress,
          displayName: myself.displayName,
        },
        project: {
          id: project.id,
          key: project.key,
          name: project.name,
        },
        search: {
          issues: Array.isArray(search.issues) ? search.issues.length : 0,
          isLast: search.isLast,
          nextPageToken: search.nextPageToken || null,
        },
      });
    } catch (e) {
      setJiraDiag({
        ok: false,
        used,
        error: e.message,
      });
    } finally {
      setJiraDiagLoading(false);
    }
  };

  return (
    <div className="main-content">
      <div className="sec-title mb12">⚙ Credentials & API Settings</div>
      <div className="info mb12">🔒 All keys stored in component state only. Never sent to external servers except their own APIs.</div>

      <div className="g3" style={{gap:14}}>
        {/* Jira */}
        <div className="panel">
          <div className="ph">
            <div className="ph-icon" style={{background:"var(--bdim)"}}>🟦</div>
            <div className="phtitle">Jira Cloud</div>
            <span className={`badge ${creds.jiraOk?"conn-badge":"dis-badge"}`}>{creds.jiraOk?"✓ Connected":"Disconnected"}</span>
          </div>
          <div className="pb">
            <span className="enc-tag mb8">🔒 Basic Auth (email:token)</span>
            <div className="fg mt8">
              <label className="label">Instance URL</label>
              {inp("jiraUrl","https://yourorg.atlassian.net")}
            </div>
            <div className="fg">
              <label className="label">Email</label>
              {inp("jiraEmail","you@company.com")}
            </div>
            <div className="fg">
              <label className="label">API Token</label>
              {inp("jiraToken","Atlassian API Token",true)}
              <div className="xxs muted mt4">Get from: id.atlassian.com/manage-profile/security/api-tokens</div>
            </div>
            <div className="fg">
              <label className="label">Project Key</label>
              {inp("jiraProjectKey","ABC")}
              <div className="xxs muted mt4">Example: ENG, PROJ, APP</div>
            </div>
            <div className="info xs mb8">
              Auth header: <span className="mono text-c">Authorization: Basic base64(email:token)</span>
            </div>
            <div className="warn xs mb8">
              ⚠ Jira calls are routed through backend API: <span className="mono text-a">/api/jira/request</span>.
            </div>
            <button className="btn btn-c" style={{width:"100%"}} onClick={()=>onConnect("jira")}>
              {creds.jiraOk?"↺ Reconnect":"⚡ Connect Jira"}
            </button>
            <button className="btn btn-n mt8" style={{width:"100%"}} onClick={runJiraAuthDebug} disabled={jiraDiagLoading}>
              {jiraDiagLoading ? "⟳ Testing Jira Auth..." : "🧪 Test Jira Auth (Show API Response)"}
            </button>
            {jiraDiag && (
              <div className={`${jiraDiag.ok ? "success" : "err"} xs mt8`}>
                <div className="mono" style={{whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                  {JSON.stringify(jiraDiag, null, 2)}
                </div>
              </div>
            )}

            <div className="divider"/>
            <div className="xxs muted mono mb8">JIRA REST API v3 ENDPOINTS</div>
            {[
              ["GET","/rest/api/3/project/search","List projects"],
              ["POST","/rest/api/3/search/jql","Search issues (JQL)"],
              ["POST","/rest/api/3/issue","Create issue"],
              ["PUT","/rest/api/3/issue/{key}","Update issue"],
              ["DELETE","/rest/api/3/issue/{key}","Delete issue"],
              ["GET","/rest/api/3/issue/{key}/transitions","Get transitions"],
              ["POST","/rest/api/3/issue/{key}/transitions","Move status"],
              ["POST","/rest/api/3/issue/{key}/comment","Add comment"],
              ["DELETE","/rest/api/3/issue/{key}/comment/{id}","Delete comment"],
              ["PUT","/rest/api/3/issue/{key}/assignee","Assign user"],
              ["POST","/rest/api/3/issue/{key}/worklog","Log work"],
              ["GET","/rest/api/3/user/search","Search users"],
            ].map(([m,ep,d])=>(
              <div key={`${m}:${ep}`} className="row xs mb4" style={{gap:6}}>
                <span className={`chip ${m==="GET"?"c-prog":m==="POST"?"c-done":m==="PUT"?"c-rev":"c-bug"}`}>{m}</span>
                <span className="mono text-c" style={{fontSize:9,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ep}</span>
                <span className="muted" style={{fontSize:9,flexShrink:0}}>{d}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Jira Ticket Editor */}
        <div className="panel">
          <div className="ph">
            <div className="ph-icon" style={{background:"var(--cdim)"}}>🟦</div>
            <div className="phtitle">Jira Ticket Editor</div>
            <span className="badge" style={{background:"var(--adim)",color:"var(--amber)",borderColor:"var(--amber)"}}>AI + Manual</span>
          </div>
          <div className="pb">
            {jiraTicketMsg && <div className={`${jiraTicketMsg.t==="ok"?"success":jiraTicketMsg.t==="warn"?"warn":"err"} mb8`}>{jiraTicketMsg.m}</div>}
            <div className="row mb12">
              <input className="inp inp-sm mono" style={{flex:1}} placeholder="Enter ticket key (e.g. PROJ-123)" value={jiraTicketKey} onChange={e=>setJiraTicketKey(e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&fetchJiraTicketFromSettings()} />
              <button className="btn btn-c" onClick={fetchJiraTicketFromSettings} disabled={jiraTicketLoading||!creds.jiraOk}>
                {jiraTicketLoading?<span className="spin">⟳</span>:"🔍"} Load
              </button>
            </div>
            
            {jiraTicket && (
              <>
                <div className="row-wrap mb12" style={{gap:6}}>
                  <span className="chip c-prog mono text-c" style={{fontSize:11}}>{jiraTicket.key}</span>
                  <span className="chip c-todo">{jiraTicket.fields?.issuetype?.name}</span>
                  <span className="chip c-todo">{jiraTicket.fields?.status?.name}</span>
                  <span className="chip c-todo">{jiraTicket.fields?.priority?.name}</span>
                </div>

                <div className="tab-row mb12" style={{maxWidth:280}}>
                  <button className={`tab-item ${ticketEditMode==="manual"?"on":""}`} onClick={()=>setTicketEditMode("manual")}>✏ Manual</button>
                  <button className={`tab-item ${ticketEditMode==="ai"?"on":""}`} onClick={()=>setTicketEditMode("ai")}>⚡ AI Mode</button>
                </div>

                {ticketEditMode === "manual" ? (
                  <div>
                    <div className="fg">
                      <label className="label">Summary</label>
                      <input className="inp inp-sm" value={jiraTicketEdit.summary||""} onChange={e=>setJiraTicketEdit(p=>({...p,summary:e.target.value}))} />
                    </div>
                    <div className="fg">
                      <label className="label">Description</label>
                      <textarea className="textarea" rows={3} value={jiraTicketEdit.description||""} onChange={e=>setJiraTicketEdit(p=>({...p,description:e.target.value}))} placeholder="Enter description..." />
                    </div>
                    <div className="g2">
                      <div className="fg">
                        <label className="label">Priority</label>
                        <select className="sel" style={{width:"100%"}} value={jiraTicketEdit.priority||"Medium"} onChange={e=>setJiraTicketEdit(p=>({...p,priority:e.target.value}))}>
                          {["Highest","High","Medium","Low","Lowest"].map(t=><option key={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                    <button className="btn btn-g" onClick={saveJiraTicketFromSettings} disabled={jiraTicketLoading}>
                      {jiraTicketLoading?<span className="spin">⟳</span>:"💾"} Save Changes
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="fg">
                      <label className="label">Select Field to Edit</label>
                      <select className="sel" style={{width:"100%"}} value={ticketAiField} onChange={e=>setTicketAiField(e.target.value)}>
                        <option value="summary">Summary</option>
                        <option value="description">Description</option>
                      </select>
                    </div>
                    <div className="fg">
                      <label className="label">Current {ticketAiField}</label>
                      <div className="xs" style={{padding:"8px 10px",background:"var(--bg2)",borderRadius:"var(--r)",border:"1px solid var(--border)",whiteSpace:"pre-wrap",maxHeight:80,overflow:"auto"}}>
                        {jiraTicket.fields?.[ticketAiField] ? adfToTextLocal(jiraTicket.fields?.[ticketAiField]) || jiraTicket.fields?.[ticketAiField] : "(empty)"}
                      </div>
                    </div>
                    <div className="fg">
                      <label className="label">AI Edit Instruction</label>
                      <textarea className="textarea" rows={2} value={ticketAiPrompt} onChange={e=>setTicketAiPrompt(e.target.value)} placeholder={`Describe how to improve the ${ticketAiField}...`} />
                    </div>
                    <div className="row-wrap" style={{gap:8}}>
                      <button className="btn btn-p" onClick={runTicketAiEdit} disabled={ticketAiLoading||!ticketAiPrompt.trim()}>
                        {ticketAiLoading?<span className="spin">⟳</span>:"⚡"} Generate with AI
                      </button>
                      {ticketAiOutput && !ticketAiLoading && (
                        <button className="btn btn-g" onClick={applyTicketAiEdit}>✓ Apply</button>
                      )}
                    </div>
                    {(ticketAiOutput || ticketAiLoading) && (
                      <div className="ai-out mt12" style={{maxHeight:160}}>
                        {ticketAiOutput}
                        {ticketAiLoading && <span className="cur"/>}
                      </div>
                    )}
                    {ticketAiOutput && !ticketAiLoading && (
                      <div className="mt8">
                        <button className="btn btn-g" onClick={saveJiraTicketFromSettings} disabled={jiraTicketLoading}>
                          {jiraTicketLoading?<span className="spin">⟳</span>:"💾"} Save AI Changes to Jira
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="divider"/>
                <div className="xxs muted mono mb8">EXACT JIRA DETAILS</div>
                <div className="g2">
                  <div className="fg"><label className="label">Assignee</label><div className="xs">{jiraTicket.fields?.assignee?.displayName || "Unassigned"}</div></div>
                  <div className="fg"><label className="label">Reporter</label><div className="xs">{jiraTicket.fields?.reporter?.displayName || "—"}</div></div>
                  <div className="fg"><label className="label">Created</label><div className="xs">{jiraTicket.fields?.created ? new Date(jiraTicket.fields.created).toLocaleString() : "—"}</div></div>
                  <div className="fg"><label className="label">Updated</label><div className="xs">{jiraTicket.fields?.updated ? new Date(jiraTicket.fields.updated).toLocaleString() : "—"}</div></div>
                </div>
                <div className="fg">
                  <label className="label">Labels</label>
                  <div className="row-wrap">
                    {(jiraTicket.fields?.labels || []).length === 0 && <span className="xs muted">No labels</span>}
                    {(jiraTicket.fields?.labels || []).map((lb)=>(
                      <span key={lb} className="chip c-task">{lb}</span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* GitHub */}
        <div className="panel">
          <div className="ph">
            <div className="ph-icon" style={{background:"var(--gdim)"}}>🐙</div>
            <div className="phtitle">GitHub REST API</div>
            <span className={`badge ${creds.githubOk?"conn-badge":"dis-badge"}`}>{creds.githubOk?"✓ Connected":"Disconnected"}</span>
          </div>
          <div className="pb">
            <span className="enc-tag mb8">🔒 Bearer Token Auth</span>
            <div className="fg mt8">
              <label className="label">Personal Access Token (PAT) or GitHub App Token</label>
              {inp("githubToken","ghp_xxxxxxxxxxxx",true)}
              <div className="xxs muted mt4">Scopes needed: repo, write:packages, read:user</div>
            </div>
            <div className="fg">
              <label className="label">Username</label>
              {inp("githubUsername","myusername")}
            </div>
            <div className="fg">
              <label className="label">Repo</label>
              {inp("githubRepo","my-repo")}
            </div>
            <div className="info xs mb8">
              Auth header: <span className="mono text-c">Authorization: Bearer {"{token}"}</span><br/>
              GitHub API supports CORS ✓ — direct browser calls work.
            </div>
            <button className="btn btn-g" style={{width:"100%"}} onClick={()=>onConnect("github")}>
              {creds.githubOk?"↺ Reconnect":"⚡ Connect GitHub"}
            </button>

            <div className="divider"/>
            <div className="xxs muted mono mb8">GITHUB REST API ENDPOINTS</div>
            {[
              ["GET","/user","Auth check"],
              ["GET","/user/repos","List repos"],
              ["GET","/repos/{o}/{r}/languages","Language detection"],
              ["GET","/repos/{o}/{r}/branches","List branches"],
              ["POST","/repos/{o}/{r}/git/refs","Create branch"],
              ["DELETE","/repos/{o}/{r}/git/refs/heads/{b}","Delete branch"],
              ["GET","/repos/{o}/{r}/git/ref/heads/{b}","Get branch SHA"],
              ["PUT","/repos/{o}/{r}/contents/{path}","Push/update file"],
              ["GET","/repos/{o}/{r}/commits","List commits"],
              ["POST","/repos/{o}/{r}/pulls","Create PR"],
              ["GET","/repos/{o}/{r}/pulls","List PRs"],
              ["PUT","/repos/{o}/{r}/pulls/{n}/merge","Merge PR"],
              ["PATCH","/repos/{o}/{r}/pulls/{n}","Update/close PR"],
              ["POST","/repos/{o}/{r}/pulls/{n}/reviews","Create review"],
              ["GET","/repos/{o}/{r}/pulls/{n}/files","PR changed files"],
              ["POST","/repos/{o}/{r}/issues/{n}/comments","Add comment"],
              ["GET","/repos/{o}/{r}/actions/workflows","List workflows"],
              ["POST","/repos/{o}/{r}/actions/workflows/{id}/dispatches","Trigger workflow"],
            ].map(([m,ep,d])=>(
              <div key={`${m}:${ep}`} className="row xs mb4" style={{gap:6}}>
                <span className={`chip ${m==="GET"?"c-prog":m==="POST"?"c-done":m==="PUT"?"c-rev":m==="PATCH"?"c-sub":"c-bug"}`}>{m}</span>
                <span className="mono text-c" style={{fontSize:9,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ep}</span>
                <span className="muted" style={{fontSize:9,flexShrink:0}}>{d}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI / Groq */}
        <div className="panel">
          <div className="ph">
            <div className="ph-icon" style={{background:"var(--cdim)"}}>⚡</div>
            <div className="phtitle">Groq AI Engine</div>
            <span className={`badge ${creds.groqKey?"conn-badge":"dis-badge"}`}>{creds.groqKey?"✓ Connected":"Disconnected"}</span>
          </div>
          <div className="pb">
            <span className="enc-tag mb8">🔒 API Key Auth</span>
            <div className="fg mt8">
              <label className="label">Groq API Key (gsk_...)</label>
              {inp("groqKey","gsk_xxxxxxxxxxxx",true)}
              <div className="xxs muted mt4">Get from: <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a></div>
            </div>
            <div className="fg">
              <label className="label">AI Model</label>
              <select className="sel" style={{width:"100%"}} value={creds.aiModel || "llama-3.3-70b-versatile"} onChange={e=>setCreds(p=>({...p,aiModel:e.target.value}))}>
                <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Fast)</option>
                <option value="llama-3.1-8b-instant">Llama 3.1 8B (Fastest)</option>
                <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                <option value="gemma2-9b-it">Gemma 2 9B</option>
              </select>
            </div>
            <div className="info xs mb8">
              ✓ Groq API routes through backend to avoid CORS issues.<br/>
              Default model: Llama 3.3 70B Versatile
            </div>
            <button className="btn btn-c" style={{width:"100%"}} onClick={()=>onConnect("groq")}>
              {creds.groqKey?"↺ Update Key":"⚡ Connect AI"}
            </button>
          </div>
        </div>

        {/* CORS Guide */}
        <div className="panel">
          <div className="ph">
            <div className="ph-icon" style={{background:"var(--adim)"}}>🔧</div>
            <div className="phtitle">CORS Proxy Setup for Jira</div>
          </div>
          <div className="pb">
            <div className="warn xs mb8">Jira Cloud blocks direct browser CORS. Use a proxy.</div>
            <div className="xxs muted mono mb8">OPTION 1: Express proxy (Node.js)</div>
            <div className="code-block" style={{fontSize:10,maxHeight:120}}>
{`// proxy.js
app.use('/api/jira', createProxyMiddleware({
  target: process.env.JIRA_URL,
  changeOrigin: true,
  pathRewrite: {'^/api/jira': '/rest/api/3'},
  on: { proxyReq: (pr) => {
    pr.setHeader('Authorization',
      'Basic ' + Buffer.from(EMAIL+':'+TOKEN).toString('base64'));
  }}
}))`}
            </div>
            <div className="xxs muted mono mt8 mb8">OPTION 2: AWS Lambda proxy</div>
            <div className="code-block" style={{fontSize:10,maxHeight:80}}>
{`// lambda/jira-proxy.py
import boto3, requests
def handler(event, ctx):
  secret = boto3.client('secretsmanager').get_secret_value(SecretId='jira-token')
  # proxy request with stored credentials`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   WORKFLOW TAB — Jira + GitHub end-to-end
═══════════════════════════════════════════════════════════════════════════ */
function WorkflowTab({ jira, gh, addLog, workflowSeed, creds }) {
  const [step, setStep] = useState(0);
  const [jiraKey, setJiraKey] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [repoOptions, setRepoOptions] = useState([]);
  const [branchName, setBranchName] = useState("");
  const [prTitle, setPRTitle] = useState("");
  const [prURL, setPRURL] = useState("");
  const [logs2, setLogs2] = useState([]);
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState(null);
  const [baseBranch, setBaseBranch] = useState("main");
  const [codeFiles, setCodeFiles] = useState([]);
  const [genLoading, setGenLoading] = useState(false);
  const [genOutput, setGenOutput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedRepoPath, setSelectedRepoPath] = useState("");
  const [msg, setMsg] = useState(null);

  const steps = [
    "Select Ticket","Create Branch","Generate Code","Push Code","Create PR","Review","Done"
  ];

  const log = (msg, t="info") => setLogs2(p=>[...p.slice(-50), {msg,t,ts:new Date().toLocaleTimeString()}]);
  const parseRepoInput = () => {
    const trimmed = repoInput.trim();
    const normalized = trimmed
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/^\/+|\/+$/g, "");
    const [owner, repo] = normalized.split("/", 2);
    if (!owner || !repo) throw new Error("GitHub repo must be in owner/repo format");
    return { owner, repo };
  };

  useEffect(() => {
    if (workflowSeed?.jiraKey) setJiraKey(workflowSeed.jiraKey);
  }, [workflowSeed?.jiraKey]);

  useEffect(() => {
    let active = true;
    const loadRepos = async () => {
      if (!gh.current) return;
      if (Array.isArray(GITHUB_MEM_CACHE.repos) && GITHUB_MEM_CACHE.repos.length > 0) {
        if (active) {
          setRepoOptions(GITHUB_MEM_CACHE.repos);
          if (!repoInput) {
            const first = GITHUB_MEM_CACHE.repos[0];
            setRepoInput(`${first.owner?.login}/${first.name}`);
          }
        }
        return;
      }
      try {
        const repos = await gh.current.listRepos();
        GITHUB_MEM_CACHE.repos = repos;
        if (!active) return;
        setRepoOptions(repos);
        if (!repoInput && repos[0]) setRepoInput(`${repos[0].owner?.login}/${repos[0].name}`);
      } catch {
        if (active) setRepoOptions([]);
      }
    };
    loadRepos();
    return () => { active = false; };
  }, [gh, repoInput]);

  const adfToText = (node) => {
    if (!node) return "";
    if (Array.isArray(node)) return node.map(adfToText).join("");
    if (typeof node === "string") return node;
    if (node.type === "text") return node.text || "";
    if (node.type === "hardBreak") return "\n";
    if (Array.isArray(node.content)) {
      const body = node.content.map(adfToText).join("");
      if (["paragraph","heading","bulletList","orderedList","listItem"].includes(node.type)) return `${body}\n`;
      return body;
    }
    return "";
  };

  const parseGeneratedFiles = (text) => {
    const files = [];
    const cleanText = text.replace(/\n{3,}/g, '\n\n').trim();
    const lines = cleanText.split('\n');
    let inCodeBlock = false;
    let currentCodeBlock = "";
    let currentFileName = "";
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.includes('```')) {
        if (inCodeBlock) {
          if (currentFileName && currentCodeBlock.trim()) {
            files.push({ name: currentFileName, content: currentCodeBlock.trim() });
          }
          currentCodeBlock = "";
          currentFileName = "";
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          continue;
        }
      } else if (inCodeBlock) {
        currentCodeBlock += line + '\n';
      } else {
        const fileMatch = line.match(/^(?:File|Path|Filename):\s*[`"]?([a-zA-Z0-9_\-\\/.]+)[`"]?/i);
        if (fileMatch) {
          if (currentFileName && currentCodeBlock.trim()) {
            files.push({ name: currentFileName, content: currentCodeBlock.trim() });
          }
          currentFileName = fileMatch[1];
          currentCodeBlock = "";
        }
      }
    }
    
    if (currentFileName && currentCodeBlock.trim()) {
      files.push({ name: currentFileName, content: currentCodeBlock.trim() });
    }
    
    return files;
  };

  const generateCodeWithAI = async () => {
    if (!creds?.groqKey) {
      setMsg({t:"err",m:"Groq API key required in Settings"});
      return;
    }
    if (!issue) {
      setMsg({t:"warn",m:"Load ticket first"});
      return;
    }

    setGenLoading(true);
    setGenOutput("");
    setCodeFiles([]);
    setMsg(null);
    log("Generating code with AI...","info");

    const summary = issue.fields?.summary || "";
    const description = adfToText(issue.fields?.description) || "";
    const issueType = issue.fields?.issuetype?.name || "Task";

    const systemPrompt = `You are an expert full-stack developer. Generate complete, production-ready code files based on the Jira ticket description.
    - Output multiple files if needed (e.g., frontend component, backend API, tests, config files)
    - Include proper imports, types, and error handling
    - Use modern best practices (React, Node.js, TypeScript, etc.)
    - If creating multiple files, clearly label each file with "File: <filename>" before the code
    - Do NOT include markdown code block fences unless explicitly asked
    - Each file should be complete and ready to use`;

    const userPrompt = `Generate code for this Jira ticket:

**Ticket Key:** ${issue.key}
**Type:** ${issueType}
**Title:** ${summary}

**Description:**
${description || "No description provided. Generate code based on the title and best practices."}

Generate complete, working code files. If multiple files are needed (e.g., component + API + test), output each one separately with the filename clearly indicated at the start of each file using "File: filename.ext"`;

    try {
      let fullOutput = "";
      await callAI(systemPrompt, userPrompt, (chunk) => {
        fullOutput += chunk;
        setGenOutput(fullOutput);
      }, creds.groqKey, creds.aiModel || "llama-3.3-70b-versatile");
      
      const parsedFiles = parseGeneratedFiles(fullOutput);
      setCodeFiles(parsedFiles);
      
      if (parsedFiles.length > 0) {
        setMsg({t:"ok",m:`✓ Generated ${parsedFiles.length} file(s)`});
        log(`✓ Generated ${parsedFiles.length} file(s)`,"ok");
      } else {
        setMsg({t:"warn",m:"Could not parse files. Check raw output below."});
        log("⚠ Could not parse files","warn");
      }
    } catch(e) {
      setMsg({t:"err",m:e.message});
      log(`✗ ${e.message}`,"err");
    }
    
    setGenLoading(false);
  };

  const toggleFileSelection = (idx) => {
    setSelectedFiles(p => p.includes(idx) ? p.filter(i => i !== idx) : [...p, idx]);
  };

  const updateFileContent = (idx, newContent) => {
    setCodeFiles(p => p.map((f, i) => i === idx ? {...f, content: newContent} : f));
  };

  const updateFileName = (idx, newName) => {
    setCodeFiles(p => p.map((f, i) => i === idx ? {...f, name: newName} : f));
  };

  const removeFile = (idx) => {
    setCodeFiles(p => p.filter((_, i) => i !== idx));
    setSelectedFiles(p => p.filter(i => i !== idx));
  };

  const addNewFile = () => {
    const ext = codeFiles.length === 0 ? "js" : "ts";
    setCodeFiles(p => [...p, { name: `new-file.${ext}`, content: "// New file content" }]);
  };

  const runStep = async () => {
    setLoading(true);
    try {
      if (step===0) { // fetch ticket
        if (!jira.current) throw new Error("Connect Jira first");
        log(`Fetching ${jiraKey}...`,"info");
        const r = await jira.current.getIssue(jiraKey);
        addLog("GET",`/rest/api/3/issue/${jiraKey}`,"200 OK");
        setIssue(r);
        const bn = `feature/${jiraKey.toLowerCase()}-${Date.now().toString(36).slice(-4)}`;
        setBranchName(bn);
        setPRTitle(`${jiraKey}: ${r.fields.summary}`);
        log(`✓ Got: ${r.fields.summary}`,"ok");
        setStep(1);
      } else if (step===1) { // create branch
        if (!gh.current) throw new Error("Connect GitHub first");
        const { owner, repo } = parseRepoInput();
        log(`Loading repository details...`,"info");
        const repoMeta = await gh.current.getRepo(owner, repo);
        if (!hasRepoWriteAccess(repoMeta)) {
          throw new Error(`Token cannot create branch on ${owner}/${repo}. Grant write access.`);
        }
        const base = repoMeta?.default_branch || "main";
        setBaseBranch(base);
        addLog("GET",`/repos/${owner}/${repo}`,"200 OK");
        log(`Getting SHA of ${base}...`,"info");
        const ref = await gh.current.getRef(owner,repo,base);
        addLog("GET",`/repos/${owner}/${repo}/git/ref/heads/${base}`,"200 OK");
        log(`Creating branch ${branchName}...`,"info");
        await gh.current.createBranch(owner,repo,branchName,ref.object.sha);
        addLog("POST",`/repos/${owner}/${repo}/git/refs`,"201 Created");
        log(`✓ Branch ${branchName} created`,"ok");
        setStep(2);
      } else if (step===2) { // gen code - now uses AI
        await generateCodeWithAI();
        if (codeFiles.length > 0 || genOutput) {
          setStep(3);
        }
      } else if (step===3) { // push
        if (!gh.current) throw new Error("Connect GitHub first");
        const { owner, repo } = parseRepoInput();
        
        const filesToPush = selectedFiles.length > 0 ? selectedFiles.map(i => codeFiles[i]) : codeFiles;
        if (!filesToPush.length) {
          throw new Error("No files to push. Generate or select files first.");
        }
        
        log(`Pushing ${filesToPush.length} file(s) to ${branchName}...`,"info");
        
        for (const file of filesToPush) {
          const filePath = file.name.startsWith('/') ? file.name.slice(1) : file.name;
          const fullPath = selectedRepoPath ? `${selectedRepoPath}/${filePath}` : filePath;
          
          try {
            let sha = null;
            try { sha = (await gh.current.getContents(owner, repo, fullPath, branchName)).sha; } catch {}
            
            await gh.current.pushFile(owner, repo, fullPath, file.content, `feat(${jiraKey}): add ${file.name}`, branchName, sha);
            addLog("PUT",`/repos/${owner}/${repo}/contents/${fullPath}`,"201 Created");
            log(`✓ Pushed: ${file.name}`,"ok");
          } catch(e) {
            log(`⚠ Failed to push ${file.name}: ${e.message}`,"warn");
          }
        }
        
        setStep(4);
      } else if (step===4) { // create PR
        if (!gh.current) throw new Error("Connect GitHub first");
        const { owner, repo } = parseRepoInput();
        log("Creating pull request...","info");
        const pr = await gh.current.createPR(owner,repo,prTitle,branchName,baseBranch,
          `## Jira Ticket\n${jiraKey}: ${issue?.fields?.summary}\n\n## Changes\n- Auto-generated implementation\n\n## Testing\n- [ ] Unit tests added`);
        addLog("POST",`/repos/${owner}/${repo}/pulls`,"201 Created");
        setPRURL(pr.html_url);
        log(`✓ PR #${pr.number} created`,"ok");
        
        if (jira.current) {
          try {
            const prComment = `🔗 Pull Request Created\n\n**PR #${pr.number}:** ${prTitle}\n**Branch:** ${branchName}\n**Link:** ${pr.html_url}\n**Repo:** ${owner}/${repo}`;
            await jira.current.addComment(jiraKey, prComment);
            addLog("POST",`/issue/${jiraKey}/comment`,"201 Created");
            log(`✓ Added PR comment to ${jiraKey}`,"ok");
          } catch(e) {
            log(`⚠ Could not add PR comment: ${e.message}`,"warn");
          }
          try {
            const tr = await jira.current.getTransitions(jiraKey);
            const inReview = tr.transitions.find(t=>t.name.toLowerCase().includes("review")||t.name.toLowerCase().includes("progress"));
            if (inReview) { await jira.current.doTransition(jiraKey,inReview.id); addLog("POST",`/issue/${jiraKey}/transitions`,"204"); log(`✓ Jira ${jiraKey} → ${inReview.name}`,"ok"); }
          } catch {
            // Jira transition is optional.
          }
        }
        setStep(5);
      } else if (step===5) { // done
        log("✓ Workflow complete! Approve PR on GitHub.","ok");
        setStep(6);
      }
    } catch(e) {
      log(`✗ ${e.message}`,"err");
      setMsg({t:"err",m:e.message});
    }
    setLoading(false);
  };

  return (
    <div className="main-content">
      <div className="sec-title mb12">🔄 End-to-End Workflow</div>
      <div className="sec-sub">Jira → Branch → Code → Push → PR → Merge in one guided flow</div>

      <div style={{display:"flex",gap:0,marginBottom:20,overflowX:"auto",paddingBottom:4}}>
        {steps.map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",flexShrink:0}}>
            <div style={{padding:"5px 12px",borderRadius:"var(--r)",border:"1px solid",
              background:i<step?"var(--gdim)":i===step?"var(--cdim)":"var(--bg3)",
              color:i<step?"var(--green)":i===step?"var(--cyan)":"var(--t2)",
              borderColor:i<step?"var(--green)":i===step?"var(--cyan)":"var(--border)",
              fontSize:10,fontFamily:"var(--mono)",whiteSpace:"nowrap",
              boxShadow:i===step?"0 0 8px var(--cdim)":"none",
              animation:i===step?"blink 2s infinite":"none"}}>
              {i<step?"✓ ":""}{s}
            </div>
            {i<steps.length-1 && <div style={{width:18,height:1,background:"var(--border)",flexShrink:0}}/>}
          </div>
        ))}
      </div>

      <div className="g2" style={{gap:16}}>
        <div>
          <div className="panel">
            <div className="ph"><div className="ph-icon" style={{background:"var(--cdim)"}}>⚙</div>
              <div className="phtitle">Configuration</div>
            </div>
            <div className="pb">
              <div className="fg">
                <label className="label">Jira Issue Key</label>
                <input className="inp inp-sm mono" placeholder="PROJ-101" value={jiraKey} onChange={e=>setJiraKey(e.target.value.toUpperCase())} />
              </div>
              <div className="fg">
                <label className="label">GitHub Repo</label>
                <select className="sel" style={{width:"100%"}} value={repoInput} onChange={e=>setRepoInput(e.target.value)}>
                  {repoOptions.length===0 && <option value="">No repos loaded</option>}
                  {repoOptions.map((r)=> {
                    const full = `${r.owner?.login}/${r.name}`;
                    return <option key={full} value={full}>{full}</option>;
                  })}
                </select>
              </div>
              {step>=1 && (
                <div className="fg">
                  <label className="label">Branch Name</label>
                  <input className="inp inp-sm mono" value={branchName} onChange={e=>setBranchName(e.target.value)} />
                </div>
              )}
              {step>=2 && (
                <div className="fg">
                  <label className="label">Folder Path (optional)</label>
                  <input className="inp inp-sm mono" placeholder="src/components" value={selectedRepoPath} onChange={e=>setSelectedRepoPath(e.target.value)} />
                </div>
              )}
              {step>=4 && (
                <div className="fg">
                  <label className="label">PR Title</label>
                  <input className="inp inp-sm" value={prTitle} onChange={e=>setPRTitle(e.target.value)} />
                </div>
              )}
              <button className="btn btn-c" style={{width:"100%"}} onClick={runStep} disabled={loading||step>=6}>
                {loading ? <><span className="spin">⟳</span> Running…</> : step>=6 ? "✓ Complete" : `▶ Run: ${steps[step]}`}
              </button>
              {step>0 && step<6 && <button className="btn btn-n mt8" style={{width:"100%",fontSize:10}} onClick={()=>{setStep(0);setLogs2([]);setIssue(null);setPRURL("");}}>↺ Reset</button>}
            </div>
          </div>

          <div className="panel">
            <div className="ph"><div className="ph-icon" style={{background:"var(--bdim)"}}>📡</div>
              <div className="phtitle">Current Step APIs</div>
            </div>
            <div className="pb">
              {[
                [{m:"GET",c:"text-c",ep:"/rest/api/3/issue/{key}"},{m:"GET",c:"text-c",ep:"/rest/api/3/issue/{key}/transitions"}],
                [{m:"GET",c:"text-c",ep:"/repos/{owner}/{repo}/git/ref/heads/main"},{m:"POST",c:"text-g",ep:"/repos/{owner}/{repo}/git/refs"}],
                [{m:"POST",c:"text-g",ep:"/v1/messages (AI Engine)"}],
                [{m:"PUT",c:"text-a",ep:"/repos/{owner}/{repo}/contents/{path}"}],
                [{m:"POST",c:"text-g",ep:"/repos/{owner}/{repo}/pulls"},{m:"POST",c:"text-g",ep:"/rest/api/3/issue/{key}/transitions"}],
                [{m:"POST",c:"text-g",ep:"/repos/{owner}/{repo}/pulls/{num}/reviews"}],
                [{m:"PUT",c:"text-a",ep:"/repos/{owner}/{repo}/pulls/{num}/merge"},{m:"POST",c:"text-g",ep:"/rest/api/3/issue/{key}/transitions"}],
              ][Math.min(step,6)].map((e,i)=>(
                <div key={i} className="row xs mb8">
                  <span className={`chip ${e.m==="GET"?"c-prog":e.m==="POST"?"c-done":e.m==="PUT"?"c-rev":"c-high"}`}>{e.m}</span>
                  <span className={`mono ${e.c}`}>{e.ep}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="ph"><div className="ph-icon" style={{background:"var(--gdim)"}}>📋</div>
              <div className="phtitle">Execution Log</div>
            </div>
            <div className="api-log" style={{maxHeight:300}}>
              {logs2.length===0 && <span className="muted xs">Workflow logs will appear here...</span>}
              {logs2.map((l,i)=>(
                <div key={i} className="log-line">
                  <span className="log-ts">{l.ts}</span>
                  <span style={{color:l.t==="ok"?"var(--green)":l.t==="err"?"var(--red)":"var(--cyan)"}}>{l.msg}</span>
                </div>
              ))}
            </div>
          </div>

          {step>=2 && (
            <div className="panel" style={{borderColor:"var(--purple)"}}>
              <div className="ph">
                <div className="ph-icon" style={{background:"var(--pdim)"}}>💻</div>
                <div className="phtitle">AI Generated Files</div>
                <span className="sp"/>
                <span className="xs muted">{codeFiles.length} file(s)</span>
              </div>
              <div className="pb">
                {step===2 && !codeFiles.length && !genLoading && (
                  <div className="row" style={{gap:8}}>
                    <button className="btn btn-p" onClick={generateCodeWithAI} disabled={!issue}>
                      ⚡ Generate Code from Description
                    </button>
                    <span className="xs muted">Uses ticket description to generate code</span>
                  </div>
                )}
                
                {genLoading && (
                  <div className="info">Generating code from ticket description...</div>
                )}
                
                {codeFiles.length > 0 && (
                  <div className="mb12">
                    <div className="row mb8">
                      <button className="btn btn-g btn-sm" onClick={() => selectedFiles.length === codeFiles.length ? setSelectedFiles([]) : setSelectedFiles(codeFiles.map((_, i) => i))}>
                        {selectedFiles.length === codeFiles.length ? "Deselect All" : "Select All"}
                      </button>
                      <button className="btn btn-n btn-sm" onClick={addNewFile}>+ Add File</button>
                      <span className="xs muted">{selectedFiles.length} selected</span>
                    </div>
                    
                    {codeFiles.map((file, idx) => (
                      <div key={idx} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"10px",marginBottom:8}}>
                        <div className="row mb8">
                          <input 
                            type="checkbox" 
                            checked={selectedFiles.includes(idx)} 
                            onChange={() => toggleFileSelection(idx)}
                            style={{marginRight:8}}
                          />
                          <input 
                            className="inp inp-sm mono" 
                            style={{flex:1,fontSize:11}} 
                            value={file.name}
                            onChange={(e) => updateFileName(idx, e.target.value)}
                          />
                          <button className="btn btn-r btn-sm" style={{padding:"2px 6px"}} onClick={() => removeFile(idx)}>×</button>
                        </div>
                        <textarea 
                          className="textarea" 
                          style={{fontSize:10,minHeight:80}}
                          value={file.content}
                          onChange={(e) => updateFileContent(idx, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
                
                {genOutput && !codeFiles.length && (
                  <div className="fg">
                    <label className="label">Raw AI Output (could not parse files)</label>
                    <textarea className="textarea" style={{fontSize:10,minHeight:100}} value={genOutput} readOnly />
                  </div>
                )}
                
                {msg && <div className={msg.t==="ok"?"success":msg.t==="warn"?"warn":"err"}>{msg.m}</div>}
              </div>
            </div>
          )}

          {prURL && (
            <div className="success">
              ✓ Pull Request created: <a href={prURL} target="_blank" rel="noreferrer" style={{color:"var(--cyan)"}}>{prURL}</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   LOGIN & SETUP SCREENS
═══════════════════════════════════════════════════════════════════════════ */
function LoginScreen({ role, setRole, uname, setUname, onLogin }) {
  return (
    <div className="fullpage">
      <div className="login-card">
        <div className="brand-big">
          <h1>NexusSDLC</h1>
          <p>Jira · GitHub · AI · Production Platform</p>
        </div>
        <div style={{fontFamily:"var(--mono)",fontSize:9,letterSpacing:1.5,color:"var(--t2)",textTransform:"uppercase",marginBottom:10}}>Select Role</div>
        <div className="role-grid">
          {[{r:"manager",i:"🧑‍💼",l:"Manager"},{r:"developer",i:"👨‍💻",l:"Developer"},{r:"lead",i:"🧑‍🔬",l:"Team Lead"}].map(({r,i,l})=>(
            <button key={r} className={`role-opt ${role===r?"on":""}`} onClick={()=>setRole(r)}>
              <span style={{fontSize:20}}>{i}</span><span>{l}</span>
            </button>
          ))}
        </div>
        <div className="fg">
          <label className="label">Your Name</label>
          <input className="inp" placeholder="Enter your name" value={uname} onChange={e=>setUname(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onLogin()} />
        </div>
        <button className="submit-btn" onClick={onLogin}>⌁ LAUNCH PLATFORM</button>
      </div>
    </div>
  );
}

function SetupScreen({ creds, setCreds, onConnect, onEnter }) {
  const [show, setShow] = useState({});
  const toggle = k => setShow(p=>({...p,[k]:!p[k]}));
  const connected = [creds.jiraOk,creds.githubOk,creds.groqOk].filter(Boolean).length;

  return (
    <div className="setup-wrap">
      <div className="setup-inner">
        <div style={{textAlign:"center",marginBottom:8}}>
          <div style={{fontFamily:"var(--display)",fontSize:28,fontWeight:600,background:"linear-gradient(135deg,var(--cyan),var(--blue))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>
            Connect Your Services
          </div>
          <div style={{color:"var(--t1)",fontSize:13,marginTop:6}}>Enter credentials to enable live Jira + GitHub + AI workflows</div>
        </div>

        <div className="setup-grid">
          {/* JIRA */}
          <div className={`setup-card ${creds.jiraOk?"connected":""}`}>
            <div className="sc-head">
              <span className="sc-icon">🟦</span>
              <span className="sc-title">Jira Cloud</span>
              <div style={{marginLeft:"auto"}}>
                <span className={`badge ${creds.jiraOk?"conn-badge":"dis-badge"}`}>{creds.jiraOk?"✓ Connected":"—"}</span>
              </div>
            </div>
            <span className="enc-tag" style={{marginBottom:10,display:"inline-flex"}}>🔒 Basic Auth</span>
            <div className="fg">
              <label className="label">Jira Instance URL</label>
              <input className="inp inp-sm" placeholder="https://yourorg.atlassian.net" value={creds.jiraUrl||""} onChange={e=>setCreds(p=>({...p,jiraUrl:e.target.value}))} />
            </div>
            <div className="fg">
              <label className="label">Atlassian Account Email</label>
              <input className="inp inp-sm" placeholder="you@company.com" value={creds.jiraEmail||""} onChange={e=>setCreds(p=>({...p,jiraEmail:e.target.value}))} />
            </div>
            <div className="fg">
              <label className="label">API Token</label>
              <div className="row">
                <input className="inp inp-sm" type={show.jt?"text":"password"} placeholder="Atlassian API token"
                  style={{flex:1,fontFamily:"var(--mono)",letterSpacing:show.jt?0:2}}
                  value={creds.jiraToken||""} onChange={e=>setCreds(p=>({...p,jiraToken:e.target.value}))} />
                <button className="btn btn-n" style={{padding:"4px 8px",fontSize:11}} onClick={()=>toggle("jt")}>{show.jt?"🙈":"👁"}</button>
              </div>
            </div>
            <div className="fg">
              <label className="label">Project Key</label>
              <input className="inp inp-sm mono" placeholder="ABC" value={creds.jiraProjectKey||""} onChange={e=>setCreds(p=>({...p,jiraProjectKey:e.target.value.toUpperCase()}))} />
            </div>
            <div className="warn xs mb8">Backend mode enabled: Jira calls go through server API.</div>
            <button className="btn btn-c" style={{width:"100%"}} onClick={()=>onConnect("jira")}>
              {creds.jiraOk?"↺ Reconnect":"⚡ Connect Jira"}
            </button>
          </div>

          {/* GITHUB */}
          <div className={`setup-card ${creds.githubOk?"connected":""}`}>
            <div className="sc-head">
              <span className="sc-icon">🐙</span>
              <span className="sc-title">GitHub</span>
              <div style={{marginLeft:"auto"}}>
                <span className={`badge ${creds.githubOk?"conn-badge":"dis-badge"}`}>{creds.githubOk?"✓ Connected":"—"}</span>
              </div>
            </div>
            <span className="enc-tag" style={{marginBottom:10,display:"inline-flex"}}>🔒 Bearer Token</span>
            <div className="fg">
              <label className="label">Personal Access Token (Classic)</label>
              <div className="row">
                <input className="inp inp-sm" type={show.gh?"text":"password"} placeholder="ghp_xxxxxxxxxxxx"
                  style={{flex:1,fontFamily:"var(--mono)",letterSpacing:show.gh?0:2}}
                  value={creds.githubToken||""} onChange={e=>setCreds(p=>({...p,githubToken:e.target.value}))} />
                <button className="btn btn-n" style={{padding:"4px 8px",fontSize:11}} onClick={()=>toggle("gh")}>{show.gh?"🙈":"👁"}</button>
              </div>
              <div className="xxs muted mt4">Scopes: repo, read:user, workflow</div>
            </div>
            <div className="fg">
              <label className="label">Username</label>
              <input className="inp inp-sm mono" placeholder="myusername" value={creds.githubUsername||""} onChange={e=>setCreds(p=>({...p,githubUsername:e.target.value,githubOwner:e.target.value}))} />
            </div>
            <div className="fg">
              <label className="label">Repo</label>
              <input className="inp inp-sm mono" placeholder="my-repo" value={creds.githubRepo||""} onChange={e=>setCreds(p=>({...p,githubRepo:e.target.value}))} />
            </div>
            <div className="info xs mb8">✓ GitHub API supports CORS — works directly from browser.</div>
            <button className="btn btn-g" style={{width:"100%"}} onClick={()=>onConnect("github")}>
              {creds.githubOk?"↺ Reconnect":"⚡ Connect GitHub"}
            </button>
          </div>

          {/* GROK AI */}
          <div className={`setup-card ${creds.groqOk?"connected":""}`}>
            <div className="sc-head">
              <span className="sc-icon">⚡</span>
              <span className="sc-title">Groq AI Engine</span>
              <div style={{marginLeft:"auto"}}>
                <span className={`badge ${creds.groqOk?"conn-badge":"dis-badge"}`}>{creds.groqOk?"✓ Connected":"—"}</span>
              </div>
            </div>
            <span className="enc-tag" style={{marginBottom:10,display:"inline-flex"}}>🔒 API Key Auth</span>
            <div className="fg">
              <label className="label">Groq API Key</label>
              <div className="row">
                <input className="inp inp-sm" type={show.gk?"text":"password"} placeholder="gsk_xxxxxxxxxxxx"
                  style={{flex:1,fontFamily:"var(--mono)",letterSpacing:show.gk?0:2}}
                  value={creds.groqKey||""} onChange={e=>setCreds(p=>({...p,groqKey:e.target.value}))} />
                <button className="btn btn-n" style={{padding:"4px 8px",fontSize:11}} onClick={()=>toggle("gk")}>{show.gk?"🙈":"👁"}</button>
              </div>
              <div className="xxs muted mt4">Get from: <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a></div>
            </div>
            <div className="info xs mb8">Powers: Code Gen · PR Review · Ticket Enhance · Test Gen · Architecture</div>
            <button className="btn btn-c" style={{width:"100%"}} onClick={()=>onConnect("groq")}>
              {creds.groqOk?"↺ Reconnect":"⚡ Connect AI Engine"}
            </button>
          </div>
        </div>

        <div style={{marginTop:24,display:"flex",alignItems:"center",gap:16,justifyContent:"center"}}>
          <button className="submit-btn" style={{width:"auto",padding:"13px 40px"}} onClick={onEnter}>
            → ENTER PLATFORM
          </button>
          <span style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--t2)"}}>{connected}/3 connected</span>
        </div>
      </div>
    </div>
  );
}
