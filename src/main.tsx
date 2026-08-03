import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Building2, Check, ChevronLeft, Clock3, ExternalLink, FileCheck2, LogOut, MapPin, Navigation, Pencil, Plus, Search, Send, ShieldCheck, Trash2, UserCog, Users, X } from 'lucide-react';
import './styles.css';

type Role = 'owner' | 'manager';
type Category = 'work_site' | 'reporting_point';
type PlaceType = 'station' | 'segment';
type User = { id:number; username:string; full_name:string; role:Role; is_active:boolean; must_change_password:boolean };
type Session = { token:string; user:User };
type Employee = { id:number; id_number:string; full_name:string; must_change_password:boolean };
type EmployeeSession = { token:string; employee:Employee };
type LocationItem = { id:number; category:Category; place_type:PlaceType; name:string; km:string; waze_url:string; maps_url:string; coordinates:string; notes:string; created_at:string; updated_at:string };
type LocationDraft = Omit<LocationItem,'id'|'created_at'|'updated_at'>;
type LocationRequest = LocationDraft & { id:number; status:'pending'|'approved'|'rejected'; review_note:string; submitted_by_name:string; created_at:string; reviewed_at:string|null };
type DuplicateMatch = Pick<LocationItem,'id'|'name'|'km'|'category'|'place_type'|'waze_url'|'maps_url'> & { reasons:string[] };
type ApiDetail = string|{code?:string;message?:string;matches?:DuplicateMatch[]};

class ApiError extends Error {
  status:number;
  detail:ApiDetail;
  constructor(status:number,detail:ApiDetail){super(typeof detail==='string'?detail:detail.message||'אירעה שגיאה');this.status=status;this.detail=detail}
}

const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const blankLocation = (category:Category):LocationDraft => ({category,place_type:'segment',name:'',km:'',waze_url:'',maps_url:'',coordinates:'',notes:''});
const categoryName=(value:Category)=>value==='work_site'?'אתר עבודה':'נקודת דיווח';
const typeName=(value:PlaceType)=>value==='station'?'תחנה':'קטע';
const PASSENGER_STATION_MARKER='[תחנת נוסעים רכבת ישראל]';
const hebrewCollator=new Intl.Collator('he',{sensitivity:'base',numeric:true});
const sortByName=(a:LocationItem,b:LocationItem)=>hebrewCollator.compare(a.name,b.name);
const isPassengerStation=(item:LocationItem)=>item.notes.includes(PASSENGER_STATION_MARKER);

async function request<T>(path:string, options:RequestInit={}, token?:string):Promise<T> {
  let response:Response;
  try{response=await fetch(`${API}${path}`, { ...options, headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(options.headers||{})} })}catch{throw new ApiError(0,'לא הצלחנו להתחבר לשרת. יש לבדוק את החיבור ולנסות שוב.')}
  if (!response.ok) {
    let detail:ApiDetail='אירעה שגיאה';
    try { const body=await response.json(); detail=body.detail||detail; } catch { /* ignore */ }
    throw new ApiError(response.status,detail);
  }
  if (response.status===204) return undefined as T;
  return response.json();
}

function InternalApp() {
  const [session,setSession]=useState<Session|null>(()=>{try{return JSON.parse(localStorage.getItem('danel_location_session')||sessionStorage.getItem('danel_location_session')||'null')}catch{return null}});
  const [items,setItems]=useState<LocationItem[]>([]);
  const [requests,setRequests]=useState<LocationRequest[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [view,setView]=useState<Category|'approvals'>('work_site');
  const [placeType,setPlaceType]=useState<PlaceType|'all'>('all');
  const [query,setQuery]=useState('');
  const [editing,setEditing]=useState<LocationItem|LocationDraft|null>(null);
  const [usersOpen,setUsersOpen]=useState(false);
  const [approvalDuplicate,setApprovalDuplicate]=useState<{id:number;matches:DuplicateMatch[]}|null>(null);

  const logout=()=>{localStorage.removeItem('danel_location_session');sessionStorage.removeItem('danel_location_session');setSession(null);setItems([])};
  const loadAll=()=>{if(!session)return;setLoading(true);Promise.all([request<LocationItem[]>('/locations',{},session.token),request<LocationRequest[]>('/location-requests?request_status=all',{},session.token)]).then(([locations,pending])=>{setItems(locations);setRequests(pending)}).catch(e=>{setError(e.message);logout()}).finally(()=>setLoading(false))};
  useEffect(loadAll,[session?.token]);
  const saveSession=(next:Session,remember=true)=>{localStorage.removeItem('danel_location_session');sessionStorage.removeItem('danel_location_session');(remember?localStorage:sessionStorage).setItem('danel_location_session',JSON.stringify(next));setSession(next)};
  const filtered=useMemo(()=>items.filter(item=>view!=='approvals'&&item.category===view&&!isPassengerStation(item)&&(placeType==='all'||item.place_type===placeType)&&`${item.name} ${item.km} ${item.notes}`.toLowerCase().includes(query.toLowerCase())).sort(sortByName),[items,view,placeType,query]);
  if(!session) return <InternalLogin onLogin={saveSession}/>;
  if(session.user.must_change_password) return <InternalPassword session={session} onChanged={saveSession} onLogout={logout}/>;
  const activeSession=session;

  async function saveLocation(draft:LocationDraft|LocationItem,allowDuplicate=false){
    try{const payload={...draft,allow_duplicate:allowDuplicate};if('id' in draft){const updated=await request<LocationItem>(`/locations/${draft.id}`,{method:'PUT',body:JSON.stringify(payload)},activeSession.token);setItems(items.map(x=>x.id===updated.id?updated:x))}
    else{const created=await request<LocationItem>('/locations',{method:'POST',body:JSON.stringify(payload)},activeSession.token);setItems([...items,created])}setEditing(null)}catch(e){if(e instanceof ApiError&&typeof e.detail!=='string'&&e.detail.code==='duplicate_location')throw e;setError((e as Error).message);throw e}
  }
  async function removeLocation(id:number){if(!confirm('למחוק את המיקום?'))return;try{await request(`/locations/${id}`,{method:'DELETE'},activeSession.token);setItems(items.filter(x=>x.id!==id))}catch(e){setError((e as Error).message)}}
  async function review(id:number,action:'approve'|'reject',allowDuplicate=false){
    const note=action==='reject'?(prompt('סיבת הדחייה (אופציונלי)')||''):'';
    try{await request(`/location-requests/${id}/${action}`,{method:'POST',body:JSON.stringify({note,allow_duplicate:allowDuplicate})},activeSession.token);setApprovalDuplicate(null);loadAll()}catch(e){if(e instanceof ApiError&&typeof e.detail!=='string'&&e.detail.code==='duplicate_location'){setApprovalDuplicate({id,matches:e.detail.matches||[]})}else setError((e as Error).message)}
  }
  const pendingCount=requests.filter(x=>x.status==='pending').length;
  const currentCategory:Category=view==='approvals'?'work_site':view;
  return <main className="app-shell">
    <Header logoText="מאגר מיקומים" sub="מרכז המיקומים התפעולי" name={session.user.full_name} role={session.user.role==='owner'?'בעלים':'מנהל'} onLogout={logout} extra={<><a className="portal-header-link" href="/portal" target="_blank" rel="noreferrer" title="פתיחת כניסת העובדים"><Users size={18}/><span>כניסת עובדים</span></a>{session.user.role==='owner'&&<button type="button" onClick={()=>setUsersOpen(true)} title="ניהול משתמשים"><UserCog size={18}/></button>}</>}/>
    <section className="hero"><div><p className="eyebrow">מרכז מיקומים תפעולי</p><h1>אתרי עבודה ונקודות דיווח</h1><p>כל התחנות, הקטעים, הקילומטרים וקישורי הניווט במקום אחד.</p></div>{view!=='approvals'&&<button className="primary" onClick={()=>setEditing(blankLocation(currentCategory))}><Plus size={18}/> הוספת מיקום</button>}</section>
    <section className="stats"><Stat icon={<Building2/>} label="אתרי עבודה" value={items.filter(x=>x.category==='work_site'&&!isPassengerStation(x)).length}/><Stat icon={<Navigation/>} label="נקודות דיווח" value={items.filter(x=>x.category==='reporting_point'&&!isPassengerStation(x)).length}/><Stat icon={<MapPin/>} label="תחנות נוסעים" value={items.filter(isPassengerStation).length}/><Stat icon={<FileCheck2/>} label="ממתינים לאישור" value={pendingCount}/></section>
    <section className="panel">
      <div className="tabs three-tabs"><button className={view==='work_site'?'active':''} onClick={()=>setView('work_site')}>אתרי עבודה</button><button className={view==='reporting_point'?'active':''} onClick={()=>setView('reporting_point')}>נקודות דיווח</button><button className={view==='approvals'?'active':''} onClick={()=>setView('approvals')}>אישורי מיקומים {pendingCount>0&&<b className="tab-count">{pendingCount}</b>}</button></div>
      {view==='approvals'?<Approvals requests={requests} loading={loading} onReview={review} duplicateWarning={approvalDuplicate}/>:<>
        <div className="toolbar"><label className="search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="חיפוש לפי שם, ק״מ או הערה"/></label><select value={placeType} onChange={e=>setPlaceType(e.target.value as PlaceType|'all')}><option value="all">כל הסוגים</option><option value="station">תחנות</option><option value="segment">קטעים</option></select></div>
        {error&&<div className="error-box">{error}</div>}<LocationCards items={filtered} loading={loading} editable onEdit={setEditing} onDelete={removeLocation}/>
      </>}
    </section>
    {editing&&<LocationModal item={editing} onClose={()=>setEditing(null)} onSave={saveLocation}/>}
    {usersOpen&&<UsersModal session={session} onClose={()=>setUsersOpen(false)}/>}
  </main>
}

function EmployeePortal(){
  const [session,setSession]=useState<EmployeeSession|null>(()=>{try{return JSON.parse(localStorage.getItem('danel_employee_session')||'null')}catch{return null}});
  const [items,setItems]=useState<LocationItem[]>([]);const [mine,setMine]=useState<LocationRequest[]>([]);
  const [view,setView]=useState<Category|'request'>('work_site');const [placeType,setPlaceType]=useState<PlaceType|'all'>('all');const [query,setQuery]=useState('');
  const [requestOpen,setRequestOpen]=useState(false);const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [sessionNotice,setSessionNotice]=useState('');
  const saveSession=(next:EmployeeSession)=>{localStorage.setItem('danel_employee_session',JSON.stringify(next));setSessionNotice('');setError('');setSession(next)};
  const clearSession=(notice='')=>{localStorage.removeItem('danel_employee_session');setSessionNotice(notice);setSession(null);setItems([]);setMine([])};
  const logout=()=>clearSession();
  const load=()=>{if(!session||session.employee.must_change_password)return;setLoading(true);setError('');Promise.all([request<LocationItem[]>('/employee/locations',{},session.token),request<LocationRequest[]>('/employee/location-requests',{},session.token)]).then(([a,b])=>{setItems(a);setMine(b)}).catch(e=>{if(e instanceof ApiError&&e.status===401){clearSession('החיבור הקודם פג. יש להתחבר מחדש כדי להמשיך.');return}setError(e.message)}).finally(()=>setLoading(false))};
  useEffect(load,[session?.token,session?.employee.must_change_password]);
  const filtered=useMemo(()=>items.filter(x=>view!=='request'&&x.category===view&&!isPassengerStation(x)&&(placeType==='all'||x.place_type===placeType)&&`${x.name} ${x.km} ${x.notes}`.toLowerCase().includes(query.toLowerCase())).sort(sortByName),[items,view,placeType,query]);
  if(!session)return <EmployeeLogin onLogin={saveSession} notice={sessionNotice}/>;
  if(session.employee.must_change_password)return <EmployeePassword session={session} onChanged={saveSession} onLogout={logout}/>;
  const activeSession=session;
  async function submitRequest(draft:LocationDraft,allowDuplicate=false){const created=await request<LocationRequest>('/employee/location-requests',{method:'POST',body:JSON.stringify({...draft,allow_duplicate:allowDuplicate})},activeSession.token);setMine([created,...mine]);setRequestOpen(false);setView('request')}
  return <main className="app-shell employee-shell">
    <Header logoText="מאגר מיקומים" sub="קבוצת דנאל" name={session.employee.full_name} role="עובד" onLogout={logout}/>
    <section className="hero employee-hero"><div><p className="eyebrow">מאגר מיקומים לעובדי דנאל</p><h1>מוצאים מיקום ויוצאים לדרך</h1><p>חיפוש מהיר, ניווט ישיר והגשת מיקום חדש — מכל טלפון.</p></div><button className="primary" onClick={()=>setRequestOpen(true)}><Send size={18}/> בקשה להוספת מיקום</button></section>
    <section className="panel">
      <div className="tabs three-tabs"><button className={view==='work_site'?'active':''} onClick={()=>setView('work_site')}>אתרי עבודה</button><button className={view==='reporting_point'?'active':''} onClick={()=>setView('reporting_point')}>נקודות דיווח</button><button className={view==='request'?'active':''} onClick={()=>setView('request')}>הבקשות שלי</button></div>
      {view==='request'?<MyRequests requests={mine}/>:<><div className="toolbar"><label className="search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="חיפוש שם או ק״מ"/></label><select value={placeType} onChange={e=>setPlaceType(e.target.value as PlaceType|'all')}><option value="all">תחנות וקטעים</option><option value="station">תחנות</option><option value="segment">קטעים</option></select></div><LocationCards items={filtered} loading={loading}/></>}
      {error&&<div className="error-box">{error}</div>}
    </section>
    {requestOpen&&<LocationModal item={blankLocation('work_site')} requestMode onClose={()=>setRequestOpen(false)} onSave={(x,allow)=>submitRequest(x as LocationDraft,allow)}/>}
  </main>
}

function Header({logoText,sub,name,role,onLogout,extra}:{logoText:string;sub:string;name:string;role:string;onLogout:()=>void;extra?:React.ReactNode}){
 return <header className="topbar"><div className="brand"><img src="/danel-logo.svg" alt="קבוצת דנאל" className="header-logo"/><div><strong>{logoText}</strong><span>{sub}</span></div></div><div className="user-box"><span>{name}</span><small>{role}</small>{extra}<button onClick={onLogout} title="יציאה"><LogOut size={18}/></button></div></header>
}

function InternalLogin({onLogin}:{onLogin:(session:Session,remember?:boolean)=>void}){
  const[username,setUsername]=useState('');const[password,setPassword]=useState('');const[remember,setRemember]=useState(true);const[error,setError]=useState('');const[loading,setLoading]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setLoading(true);setError('');try{onLogin(await request<Session>('/auth/login',{method:'POST',body:JSON.stringify({username,password})}),remember)}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
  return <LoginLayout title="מאגר מיקומים" lead="כל אתרי העבודה, נקודות הדיווח, התחנות והקטעים במקום אחד — מסודרים, מעודכנים ונגישים מכל מכשיר."><form className="login-card" onSubmit={submit}><MobileLogo/><p className="eyebrow">ברוכים הבאים</p><h2>כניסה למערכת</h2><p className="muted">הזינו את פרטי הזיהוי כדי להיכנס למאגר.</p><label>שם משתמש<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required/></label><label>סיסמה<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label><label className="remember-row"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span>זכור אותי במכשיר הזה</span></label>{error&&<div className="error-box">{error}</div>}<button className="primary wide" disabled={loading}>{loading?'מתחבר...':'כניסה למערכת'} {!loading&&<ChevronLeft size={19}/>}</button><a className="portal-link" href="/portal">כניסת עובדים לפי תעודת זהות</a></form></LoginLayout>
}

function EmployeeLogin({onLogin,notice=''}:{onLogin:(s:EmployeeSession)=>void;notice?:string}){
 const[id,setId]=useState('');const[password,setPassword]=useState('Aa1234');const[error,setError]=useState('');const[loading,setLoading]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();setLoading(true);setError('');try{onLogin(await request<EmployeeSession>('/employee-auth/login',{method:'POST',body:JSON.stringify({id_number:id,password})}))}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
 return <LoginLayout title="מאגר מיקומים" lead="כל מאגרי המיקומים של דנאל זמינים לעובדים במקום אחד, בחיפוש מהיר ומותאם לנייד."><form className="login-card" onSubmit={submit}><MobileLogo/><p className="eyebrow">כניסת עובדים</p><h2>כניסה עם תעודת זהות</h2><p className="muted">בכניסה הראשונה הסיסמה היא <b>Aa1234</b>. לאחר הכניסה תתבקשו לבחור סיסמה אישית.</p>{notice&&<div className="session-notice">{notice}</div>}<label>תעודת זהות<input inputMode="numeric" value={id} onChange={e=>setId(e.target.value.replace(/\D/g,''))} autoComplete="username" required/></label><label>סיסמה<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label>{error&&<div className="error-box">{error}</div>}<button className="primary wide" disabled={loading}>{loading?'בודק פרטים...':'כניסה למאגר'} <ChevronLeft size={19}/></button></form></LoginLayout>
}

function LoginLayout({title,lead,children}:{title:string;lead:string;children:React.ReactNode}){return <main className="login-shell"><section className="login-brand"><div className="brand-glow"/><img src="/danel-logo.svg" alt="קבוצת דנאל" className="login-logo"/><div className="login-copy"><p className="eyebrow light">מרכז המיקומים התפעולי</p><h1>{title}</h1><p className="login-lead">{lead}</p></div><div className="brand-features"><span><ShieldCheck size={20}/> כניסה מאובטחת</span><span><Navigation size={20}/> ניווט מהיר</span><span><MapPin size={20}/> מותאם לנייד</span></div></section><section className="login-panel">{children}</section></main>}
function MobileLogo(){return <div className="mobile-logo"><img src="/danel-logo.svg" alt="קבוצת דנאל"/><strong>מאגר מיקומים</strong></div>}

function InternalPassword({session,onChanged,onLogout}:{session:Session;onChanged:(s:Session)=>void;onLogout:()=>void}){return <PasswordScreen token={session.token} endpoint="/auth/change-password" onChanged={onChanged} onLogout={onLogout}/>}
function EmployeePassword({session,onChanged,onLogout}:{session:EmployeeSession;onChanged:(s:EmployeeSession)=>void;onLogout:()=>void}){return <PasswordScreen token={session.token} endpoint="/employee-auth/change-password" onChanged={onChanged} onLogout={onLogout}/>}
function PasswordScreen<T>({token,endpoint,onChanged,onLogout}:{token:string;endpoint:string;onChanged:(s:T)=>void;onLogout:()=>void}){
 const[current,setCurrent]=useState('');const[next,setNext]=useState('');const[confirmPassword,setConfirm]=useState('');const[error,setError]=useState('');
 async function submit(e:FormEvent){e.preventDefault();if(next!==confirmPassword){setError('אימות הסיסמה אינו תואם');return}try{onChanged(await request<T>(endpoint,{method:'POST',body:JSON.stringify({current_password:current,new_password:next})},token))}catch(e){setError((e as Error).message)}}
 return <LoginLayout title="החלפת סיסמה" lead="בוחרים סיסמה אישית וממשיכים למאגר המיקומים."><form className="login-card" onSubmit={submit}><MobileLogo/><p className="eyebrow">אבטחת החשבון</p><h2>יצירת סיסמה אישית</h2><p className="muted">הסיסמה החדשה צריכה להכיל לפחות 10 תווים.</p><label>סיסמה ראשונית<input type="password" value={current} onChange={e=>setCurrent(e.target.value)} required/></label><label>סיסמה חדשה<input type="password" minLength={10} value={next} onChange={e=>setNext(e.target.value)} required/></label><label>אימות סיסמה<input type="password" minLength={10} value={confirmPassword} onChange={e=>setConfirm(e.target.value)} required/></label>{error&&<div className="error-box">{error}</div>}<button className="primary wide">שמירת סיסמה וכניסה</button><button type="button" className="secondary wide" onClick={onLogout}>יציאה</button></form></LoginLayout>
}

function LocationCards({items,loading,editable,onEdit,onDelete}:{items:LocationItem[];loading:boolean;editable?:boolean;onEdit?:(x:LocationItem)=>void;onDelete?:(id:number)=>void}){
 return <div className="cards">{loading?<div className="empty"><h3>טוען מיקומים...</h3></div>:items.map(item=><article className="location-card" key={item.id}><div className="card-head"><span className="type-pill">{typeName(item.place_type)}</span>{editable&&<div className="card-actions"><button onClick={()=>onEdit?.(item)}><Pencil size={16}/></button><button className="danger" onClick={()=>onDelete?.(item.id)}><Trash2 size={16}/></button></div>}</div><h3>{item.name}</h3><div className="km">ק״מ {item.km||'לא הוזן'}</div>{item.coordinates&&<small>{item.coordinates}</small>}{item.notes&&<p>{item.notes}</p>}<div className="nav-actions">{item.waze_url&&<a href={item.waze_url} target="_blank" rel="noreferrer">פתיחה ב-Waze <ExternalLink size={15}/></a>}{item.maps_url&&<a href={item.maps_url} target="_blank" rel="noreferrer">Google Maps <ExternalLink size={15}/></a>}{!item.waze_url&&!item.maps_url&&<span className="muted">טרם הוזן קישור ניווט</span>}</div></article>)}{!loading&&!items.length&&<div className="empty"><MapPin size={42}/><h3>לא נמצאו מיקומים</h3><p>נסו לשנות את החיפוש או את הסינון.</p></div>}</div>
}

function Approvals({requests,loading,onReview,duplicateWarning}:{requests:LocationRequest[];loading:boolean;onReview:(id:number,a:'approve'|'reject',allowDuplicate?:boolean)=>void;duplicateWarning:{id:number;matches:DuplicateMatch[]}|null}){
 const pending=requests.filter(x=>x.status==='pending');
 return <div className="approval-list">{loading?<div className="empty">טוען בקשות...</div>:pending.map(x=><article className="approval-card" key={x.id}><div><div className="request-meta"><span className="type-pill">{categoryName(x.category)} · {typeName(x.place_type)}</span><span><Clock3 size={15}/>{new Date(x.created_at).toLocaleDateString('he-IL')}</span></div><h3>{x.name}</h3><p><b>ק״מ:</b> {x.km||'לא הוזן'} · <b>הוגש על ידי:</b> {x.submitted_by_name}</p>{x.notes&&<p>{x.notes}</p>}<div className="nav-actions">{x.waze_url&&<a href={x.waze_url} target="_blank" rel="noreferrer">Waze <ExternalLink size={14}/></a>}{x.maps_url&&<a href={x.maps_url} target="_blank" rel="noreferrer">Google Maps <ExternalLink size={14}/></a>}</div>{duplicateWarning?.id===x.id&&<DuplicateWarning matches={duplicateWarning.matches} onCancel={()=>onReview(x.id,'reject')} onContinue={()=>onReview(x.id,'approve',true)} saving={false}/>}</div><div className="review-actions"><button className="approve" onClick={()=>onReview(x.id,'approve')}><Check size={18}/> אישור</button><button className="reject" onClick={()=>onReview(x.id,'reject')}><X size={18}/> דחייה</button></div></article>)}{!loading&&!pending.length&&<div className="empty"><FileCheck2 size={44}/><h3>אין בקשות שממתינות לאישור</h3></div>}</div>
}
function MyRequests({requests}:{requests:LocationRequest[]}){return <div className="approval-list">{requests.map(x=><article className="approval-card my-request" key={x.id}><div><div className="request-meta"><span className={`status-pill ${x.status}`}>{x.status==='pending'?'ממתין לאישור':x.status==='approved'?'אושר':'נדחה'}</span><span>{new Date(x.created_at).toLocaleDateString('he-IL')}</span></div><h3>{x.name}</h3><p>{categoryName(x.category)} · {typeName(x.place_type)} · ק״מ {x.km||'לא הוזן'}</p>{x.review_note&&<p><b>הערת מנהל:</b> {x.review_note}</p>}</div></article>)}{!requests.length&&<div className="empty"><Send size={42}/><h3>עדיין לא הגשת בקשות</h3></div>}</div>}

function useModalLifecycle(onClose:()=>void){
 useEffect(()=>{
   const previousOverflow=document.body.style.overflow;
   document.body.style.overflow='hidden';
   const handleKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};
   window.addEventListener('keydown',handleKey);
   return ()=>{document.body.style.overflow=previousOverflow;window.removeEventListener('keydown',handleKey)};
 },[onClose]);
}

function LocationModal({item,onClose,onSave,requestMode=false}:{item:LocationItem|LocationDraft;onClose:()=>void;onSave:(i:LocationItem|LocationDraft,allowDuplicate:boolean)=>Promise<void>;requestMode?:boolean}){
 useModalLifecycle(onClose);
 const[form,setForm]=useState(item);const[requestLink,setRequestLink]=useState(item.maps_url||item.waze_url||'');const[duplicates,setDuplicates]=useState<DuplicateMatch[]>([]);const[formError,setFormError]=useState('');const[saving,setSaving]=useState(false);
 const set=(key:string,value:string)=>{setDuplicates([]);setForm({...form,[key]:value} as typeof form)};
 const setCombinedType=(value:string)=>{const[category,placeType]=value.split(':') as [Category,PlaceType];setDuplicates([]);setForm({...form,category,place_type:placeType} as typeof form)};
 async function submit(allowDuplicate=false){setSaving(true);setFormError('');try{const payload=requestMode?{...form,navigation_url:requestLink,waze_url:'',maps_url:'',coordinates:''}:form;await onSave(payload,allowDuplicate)}catch(e){if(e instanceof ApiError&&typeof e.detail!=='string'&&e.detail.code==='duplicate_location'){setDuplicates(e.detail.matches||[])}else{setFormError((e as Error).message)}}finally{setSaving(false)}}
 return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><form className="modal" onSubmit={e=>{e.preventDefault();submit(false)}} onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">{requestMode?'בקשת עובד':'ניהול מיקום'}</p><h2>{requestMode?'בקשה להוספת מיקום':'id'in item?'עריכת מיקום':'הוספת מיקום חדש'}</h2></div><button type="button" onClick={e=>{e.preventDefault();e.stopPropagation();onClose()}} aria-label="סגירת חלון">×</button></div>{requestMode?<div className="form-grid request-location-form"><label className="full">סוג<select value={`${form.category}:${form.place_type}`} onChange={e=>setCombinedType(e.target.value)}><option value="work_site:segment">אתר עבודה — קטע</option><option value="work_site:station">אתר עבודה — תחנה</option><option value="reporting_point:segment">נקודת דיווח — קטע</option><option value="reporting_point:station">נקודת דיווח — תחנה</option></select></label><label className="full">שם המיקום<input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="לדוגמה: קטע אשדוד - ניצנים" required/></label><label className="full">ק״מ רכבתי<input value={form.km} onChange={e=>set('km',e.target.value)} placeholder="145+000" required/></label><label className="full">קישור<input type="url" value={requestLink} onChange={e=>{setRequestLink(e.target.value);setDuplicates([])}} placeholder="קישור שיתוף של Waze או Google Maps" required/><small>מספיק להדביק קישור אחד — המערכת תכין ממנו אוטומטית גם Waze וגם Google Maps.</small></label><label className="full">הערות<textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3} placeholder="מידע נוסף שיעזור לזהות את המיקום"/></label></div>:<div className="form-grid"><label>מאגר<select value={form.category} onChange={e=>set('category',e.target.value)}><option value="work_site">אתרי עבודה</option><option value="reporting_point">נקודות דיווח</option></select></label><label>סוג<select value={form.place_type} onChange={e=>set('place_type',e.target.value)}><option value="station">תחנה</option><option value="segment">קטע</option></select></label><label className="full">שם המיקום<input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="לדוגמה: קטע אשדוד - ניצנים" required/></label><label>ק״מ<input value={form.km} onChange={e=>set('km',e.target.value)} placeholder="145+000"/></label><label>קואורדינטות<input value={form.coordinates} onChange={e=>set('coordinates',e.target.value)} placeholder="31.8000, 34.6500"/></label><label className="full">קישור Waze<input value={form.waze_url} onChange={e=>set('waze_url',e.target.value)} placeholder="https://waze.com/ul?..."/></label><label className="full">קישור Google Maps<input value={form.maps_url} onChange={e=>set('maps_url',e.target.value)} placeholder="https://maps.google.com/..."/></label><label className="full">הערות<textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3}/></label></div>}{duplicates.length>0&&<DuplicateWarning matches={duplicates} onCancel={onClose} onContinue={()=>submit(true)} saving={saving}/>} {formError&&<div className="error-box modal-error">{formError}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>ביטול</button><button className="primary" disabled={saving||duplicates.length>0}>{saving?'בודק ושולח...':requestMode?'שליחת בקשה':'שמירת מיקום'}</button></div></form></div>
}

function DuplicateWarning({matches,onCancel,onContinue,saving}:{matches:DuplicateMatch[];onCancel:()=>void;onContinue:()=>void;saving:boolean}){
 return <section className="duplicate-warning"><div className="duplicate-title"><span><AlertTriangle size={22}/></span><div><h3>רגע, ייתכן שהמיקום כבר קיים</h3><p>מצאנו התאמה לפי שם וק״מ או לפי נקודת היעד שבקישור.</p></div></div><div className="duplicate-matches">{matches.map(match=><article key={match.id}><div><strong>{match.name}</strong><small>{categoryName(match.category)} · {typeName(match.place_type)} · ק״מ {match.km||'לא הוזן'}</small><small>{match.reasons.join(' וגם ')}</small></div><div className="nav-actions">{match.waze_url&&<a href={match.waze_url} target="_blank" rel="noreferrer">Waze <ExternalLink size={14}/></a>}{match.maps_url&&<a href={match.maps_url} target="_blank" rel="noreferrer">Google Maps <ExternalLink size={14}/></a>}</div></article>)}</div><div className="duplicate-actions"><button type="button" className="secondary" onClick={onCancel}>נכון, זו כפילות — לא לשלוח</button><button type="button" className="primary" onClick={onContinue} disabled={saving}>זה מיקום אחר — לשלוח בכל זאת</button></div></section>
}

function UsersModal({session,onClose}:{session:Session;onClose:()=>void}){
 useModalLifecycle(onClose);
 const[users,setUsers]=useState<User[]>([]);const[username,setUsername]=useState('');const[fullName,setFullName]=useState('');const[password,setPassword]=useState('');const[employeeId,setEmployeeId]=useState('');const[notice,setNotice]=useState('');const[error,setError]=useState('');
 const load=()=>request<User[]>('/users',{},session.token).then(setUsers).catch(e=>setError(e.message));useEffect(()=>{load()},[]);
 async function add(e:FormEvent){e.preventDefault();try{await request('/users',{method:'POST',body:JSON.stringify({username,full_name:fullName,password,role:'manager'})},session.token);setUsername('');setFullName('');setPassword('');load()}catch(e){setError((e as Error).message)}}
 async function toggle(id:number){try{await request(`/users/${id}/toggle`,{method:'PATCH'},session.token);load()}catch(e){setError((e as Error).message)}}
 async function resetEmployee(e:FormEvent){e.preventDefault();setError('');setNotice('');try{const employee=await request<Employee>('/employee-accounts/reset-password',{method:'POST',body:JSON.stringify({id_number:employeeId})},session.token);setNotice(`הסיסמה של ${employee.full_name} אופסה ל־Aa1234`);setEmployeeId('')}catch(e){setError((e as Error).message)}}
 return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">בעלים בלבד</p><h2>ניהול משתמשים</h2></div><button type="button" onClick={e=>{e.preventDefault();e.stopPropagation();onClose()}} aria-label="סגירת חלון">×</button></div><form className="form-grid" onSubmit={add}><label>שם מלא<input value={fullName} onChange={e=>setFullName(e.target.value)} required/></label><label>שם משתמש<input value={username} onChange={e=>setUsername(e.target.value)} required/></label><label className="full">סיסמה ראשונית<input type="password" minLength={10} value={password} onChange={e=>setPassword(e.target.value)} required/></label><div className="full"><button className="primary"><Plus size={17}/> יצירת מנהל</button></div></form><form className="employee-reset-form" onSubmit={resetEmployee}><div><strong>איפוס כניסת עובד</strong><small>העובד ייכנס שוב עם Aa1234 ויתבקש לבחור סיסמה אישית.</small></div><input inputMode="numeric" value={employeeId} onChange={e=>setEmployeeId(e.target.value.replace(/\D/g,''))} placeholder="תעודת זהות" required/><button className="secondary">איפוס סיסמה</button></form>{notice&&<div className="success-box">{notice}</div>}{error&&<div className="error-box">{error}</div>}<div className="user-list">{users.map(user=><div className="user-row" key={user.id}><div><strong>{user.full_name}</strong><small>{user.username} · {user.role==='owner'?'בעלים':'מנהל'}</small></div><span className={user.is_active?'type-pill':'muted'}>{user.is_active?'פעיל':'מושבת'}</span>{user.role!=='owner'&&<button className="secondary" onClick={()=>toggle(user.id)}>{user.is_active?'השבתה':'הפעלה'}</button>}</div>)}</div></section></div>
}
function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:number}){return <div className="stat"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>}
class AppErrorBoundary extends React.Component<{children:React.ReactNode},{hasError:boolean}>{
 state={hasError:false};
 static getDerivedStateFromError(){return {hasError:true}}
 componentDidCatch(error:unknown){console.error('Danel locations UI error',error);document.body.style.overflow=''}
 render(){
  if(this.state.hasError)return <main className="app-recovery"><img src="/danel-logo.svg" alt="קבוצת דנאל"/><h1>המסך נטען מחדש</h1><p>אירעה תקלה רגעית בתצוגה. לחצו כדי לחזור למערכת.</p><button className="primary" onClick={()=>window.location.reload()}>חזרה למערכת</button></main>;
  return this.props.children;
 }
}
const isEmployeePortal=window.location.pathname.replace(/\/$/,'')==='/portal';
createRoot(document.getElementById('root')!).render(<AppErrorBoundary>{isEmployeePortal?<EmployeePortal/>:<InternalApp/>}</AppErrorBoundary>);
